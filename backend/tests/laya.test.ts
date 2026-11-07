import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContactReason, Conversation, CriterionResult } from "../../frontend/src/lib/types.ts";
import { CONTACT_REASON_GROUPS } from "../../frontend/src/lib/contactReasons.ts";
import { createLayaClassifier, enrichWithLaya, LayaError, LAYA_MODEL, LAYA_REVISION, selectNeedFragment } from "../src/laya.ts";
import { initialChecklist } from "../src/scoring.ts";
import { getRuntimeConfig } from "../src/config.ts";

const conversation: Conversation = {
  id: "synthetic-laya", externalId: "synthetic-laya", groupId: "TEST", language: "RU", channel: "agent chat", status: "evaluated", audioUrl: null,
  messages: ["Начало", "Не получается пополнить счёт", "Какая ошибка?", "Синтетическая ошибка", "Проверю", "Конец"].map((text, index) => ({
    id: `synthetic:m${index}`, text, timestamp: `00:0${index}`, speaker: index % 2 ? "client" : "operator",
  })),
};
const results: CriterionResult[] = [{ criterionId: "c2", answer: false, originalAnswer: false, points: 0, explanation: "Synthetic", evidence: [{ kind: "quote", messageIds: ["synthetic:m3", "synthetic:m1"], quote: "Synthetic" }] }];
const previous: ContactReason = {
  taxonomyVersion: 1, primary: "technical", secondary: ["other"], summary: "Old classification", reason: "Synthetic", evidenceIds: ["synthetic:m1"],
  resolution: { status: "unknown", reason: "Synthetic unresolved evidence", evidenceIds: [] },
};
const output = {
  category: "deposit", probabilities: Object.fromEntries(CONTACT_REASON_GROUPS.map((group) => [group.id, group.id === "deposit" ? 1 : 0])),
  model: LAYA_MODEL, revision: LAYA_REVISION,
};
async function worker(t: TestContext, source: string, timeoutMs = 3000) {
  const folder = await mkdtemp(join(tmpdir(), "qulaq-laya-test-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const workerPath = join(folder, "worker.cjs");
  await writeFile(workerPath, source);
  // A synthetic Node worker exercises process isolation; Python/model are never invoked.
  return createLayaClassifier({ pythonPath: process.execPath, workerPath, timeoutMs });
}

test("fragment uses the actual named c2 evidence with adjacent context, unique IDs and transcript order", () => {
  const selected = selectNeedFragment(conversation, initialChecklist, results);
  assert.deepEqual(selected.messageIds, conversation.messages.slice(0, 5).map((message) => message.id));
  assert.equal(selected.text, conversation.messages.slice(0, 5).map((message) => `[${message.speaker}] ${message.text}`).join("\n"));
  assert.equal(selected.criterionId, "c2");
  assert.equal(selected.language, "RU");
  const checklist = structuredClone(initialChecklist);
  checklist.criteria[1].name = "Произвольное другое правило";
  assert.throws(() => selectNeedFragment(conversation, checklist, results), (error) => error instanceof LayaError && error.code === "missing_fragment");
});

test("invalid links, missing client, empty evidence and oversized fragments reject without truncation", () => {
  const wrong = structuredClone(results);
  wrong[0].evidence[0].messageIds.push("foreign:m0");
  assert.throws(() => selectNeedFragment(conversation, initialChecklist, wrong), LayaError);
  assert.throws(() => selectNeedFragment({ ...conversation, messages: conversation.messages.map((message) => ({ ...message, speaker: "operator" })) }, initialChecklist, results), LayaError);
  assert.throws(() => selectNeedFragment(conversation, initialChecklist, [{ ...results[0], evidence: [] }]), LayaError);
  const large = structuredClone(conversation);
  large.messages[1].text = "x".repeat(12000);
  assert.throws(() => selectNeedFragment(large, initialChecklist, results), (error) => error instanceof LayaError && error.code === "invalid_fragment");
});

test("isolated subprocess receives only fragment and language; pinned probabilities produce source-labelled metadata", async (t) => {
  const classifier = await worker(t, `let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
    const value=JSON.parse(input);
    const allowed=['PATH','LANG','LC_ALL','HF_HOME','HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE','HF_HUB_DISABLE_TELEMETRY','PYTHONNOUSERSITE','PYTHONUNBUFFERED','TOKENIZERS_PARALLELISM','__CF_USER_TEXT_ENCODING'];
    if(Object.keys(process.env).some(key=>!allowed.includes(key))||process.env.HF_HUB_OFFLINE!=='1'||process.env.PYTHONNOUSERSITE!=='1'||Object.keys(value).sort().join()!=='language,text'||value.language!=='RU'||!value.text.includes('пополнить'))process.exit(5);
    process.stdout.write(${JSON.stringify(JSON.stringify(output))});
  });`);
  const sameTopic: ContactReason = { ...previous, primary: "deposit", resolution: { status: "resolved", reason: "Синтетическое подтверждение пополнения.", evidenceIds: ["synthetic:m3"] } };
  const classified = await classifier(conversation, initialChecklist, results, sameTopic);
  assert.equal(classified.primary, "deposit");
  assert.deepEqual(classified.secondary, []);
  assert.deepEqual(classified.resolution, sameTopic.resolution);
  assert.notEqual(classified.resolution, sameTopic.resolution);
  assert.match(classified.summary, /Не получается пополнить счёт/);
  assert.match(classified.reason, /не генерировалось/);
  assert.deepEqual(classified.classifier, { provider: "laya", model: LAYA_MODEL, revision: LAYA_REVISION, criterionId: "c2", messageIds: selectNeedFragment(conversation, initialChecklist, results).messageIds });
  assert.equal((await classifier(conversation, initialChecklist, results)).resolution.status, "unknown");
  const differentTopic: ContactReason = { ...previous, resolution: sameTopic.resolution };
  const reclassified = await classifier(conversation, initialChecklist, results, differentTopic);
  assert.equal(reclassified.resolution.status, "unknown");
  assert.deepEqual(reclassified.resolution.evidenceIds, []);
  assert.match(reclassified.resolution.reason, /другую тему/);
  assert.equal(differentTopic.resolution.status, "resolved");
});

test("malformed output, non-pinned models and invalid probability distributions reject", async (t) => {
  for (const value of [
    "not json", JSON.stringify({ ...output, category: "invented" }), JSON.stringify({ ...output, revision: "wrong" }),
    JSON.stringify({ ...output, probabilities: { deposit: 1 } }),
    JSON.stringify({ ...output, probabilities: { ...output.probabilities, technical: 0.2 } }),
    JSON.stringify({ ...output, category: "technical" }),
  ]) {
    const classify = await worker(t, `process.stdin.resume();process.stdout.write(${JSON.stringify(value)});`);
    await assert.rejects(() => classify(conversation, initialChecklist, results), (error) => error instanceof LayaError && error.code === "invalid_output");
  }
});

test("timeout, cancellation, excessive output and stderr failures surface only fixed safe errors", async (t) => {
  const timed = await worker(t, "process.stdin.resume();setTimeout(()=>{},5000)", 50);
  await assert.rejects(() => timed(conversation, initialChecklist, results), (error) => error instanceof LayaError && error.code === "timeout");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => timed(conversation, initialChecklist, results, undefined, controller.signal), (error) => error instanceof LayaError && error.code === "failed");
  const noisy = await worker(t, "process.stdin.resume();process.stderr.write('PRIVATE_SYNTHETIC_TRACE');process.exit(1)");
  await assert.rejects(() => noisy(conversation, initialChecklist, results), (error) => error instanceof LayaError && !error.message.includes("PRIVATE_SYNTHETIC_TRACE"));
  const oversized = await worker(t, "process.stdin.resume();process.stdout.write('x'.repeat(70000))");
  await assert.rejects(() => oversized(conversation, initialChecklist, results), (error) => error instanceof LayaError && error.code === "invalid_output");
});

test("classification failures retain quality results while removing old categories; success clears old errors", async () => {
  const outcome = { results, total: 85, grossViolation: false, contactReason: previous };
  const failed = await enrichWithLaya(outcome, conversation, initialChecklist, async () => { throw new LayaError("unavailable"); });
  assert.equal(failed.contactReason, undefined);
  assert.equal(failed.classificationError?.code, "unavailable");
  assert.equal(failed.total, 85);
  assert.equal(failed.results, results);
  const good = await enrichWithLaya(failed, conversation, initialChecklist, async () => previous);
  assert.equal(good.classificationError, undefined);
  assert.deepEqual(good.contactReason, previous);
  assert.equal(outcome.contactReason, previous);
});

test("local classification is opt-in and never enables a gateway allowance", () => {
  assert.equal(getRuntimeConfig([]).localLaya, false);
  assert.equal(getRuntimeConfig(["--local-laya"]).localLaya, true);
  assert.equal(getRuntimeConfig(["--local-laya"]).allowEvaluation, false);
  assert.throws(() => createLayaClassifier({ pythonPath: "python", workerPath: "/tmp/classify.py" }));
});
