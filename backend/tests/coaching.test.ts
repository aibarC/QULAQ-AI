import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Conversation, CriterionCoaching, Evaluation, Workspace } from "../../frontend/src/lib/types.ts";
import { initialChecklist, scoreModelOutput, recalculate, ModelOutputError } from "../src/scoring.ts";
import { buildEvaluationMessages } from "../src/prompt.ts";
import { createStore } from "../src/store.ts";

const conversation: Conversation = {
  id: "coaching", externalId: "coaching", groupId: "TEST", language: "RU", channel: "agent chat", status: "evaluated", audioUrl: null,
  messages: [{ id: "coaching:m0", timestamp: "00:00", speaker: "client", text: "Синтетический вопрос о меню." }],
};
const coaching: CriterionCoaching = {
  response: "Здравствуйте, меня зовут Демо. Подскажите, какой раздел меню вы ищете?",
  explanation: "Приветствие и представление исправляют нарушение правила первого ответа.",
  needsContext: false, messageIds: ["coaching:m0"],
};
function raw() {
  return { results: initialChecklist.criteria.map((criterion, index) => ({
    criterion_id: criterion.id, status: "scored", value: index === 0 ? false : criterion.type === "scale" ? Math.max(...criterion.scale.map((option) => option.value)) : criterion.type !== "flag",
    reason: "Синтетическое объяснение", evidence_ids: ["coaching:m0"], evidence_kind: "messages",
  })) };
}
function withCoaching(value: unknown, index = 0) {
  const data = raw();
  Object.assign(data.results[index], { coaching: value });
  return data;
}

test("failed criteria retain coaching without changing quality scores; old outputs and null pass coaching remain valid", () => {
  const legacy = scoreModelOutput(conversation, initialChecklist, raw());
  const current = scoreModelOutput(conversation, initialChecklist, withCoaching(coaching));
  assert.deepEqual(current.results[0].coaching, coaching);
  assert.equal(legacy.results[0].coaching, undefined);
  assert.equal(current.total, legacy.total);
  assert.equal(current.grossViolation, legacy.grossViolation);
  assert.equal(scoreModelOutput(conversation, initialChecklist, withCoaching(null, 1)).results[1].coaching, undefined);
  const unknown = { ...coaching, response: null, needsContext: true, explanation: "Нужны подтверждённые условия возврата." };
  assert.deepEqual(scoreModelOutput(conversation, initialChecklist, withCoaching(unknown)).results[0].coaching, unknown);
});

test("only original boolean failure, submax scale and gross violation may receive coaching", () => {
  assert.throws(() => scoreModelOutput(conversation, initialChecklist, withCoaching(coaching, 1)), ModelOutputError);
  const na = withCoaching(coaching, 1);
  Object.assign(na.results[1], { status: "not_applicable", value: null });
  assert.throws(() => scoreModelOutput(conversation, initialChecklist, na), ModelOutputError);
  for (const index of [3, 7]) {
    const data = withCoaching(coaching, index);
    assert.throws(() => scoreModelOutput(conversation, initialChecklist, data), ModelOutputError);
    data.results[index].value = index === 3 ? 15 : true;
    assert.deepEqual(scoreModelOutput(conversation, initialChecklist, data).results[index].coaching, coaching);
  }
});

test("unsafe shape, inconsistent missing-context flags, foreign and duplicate messages are rejected", () => {
  const invalid = [
    { ...coaching, response: null }, { ...coaching, needsContext: true },
    { ...coaching, response: " " }, { ...coaching, explanation: " " },
    { ...coaching, response: "x".repeat(2001) }, { ...coaching, explanation: "x".repeat(2001) },
    { ...coaching, messageIds: [] }, { ...coaching, messageIds: ["foreign"] },
    { ...coaching, messageIds: ["coaching:m0", "coaching:m0"] },
    { ...coaching, extra: true }, "use empathy",
  ];
  for (const value of invalid) assert.throws(() => scoreModelOutput(conversation, initialChecklist, withCoaching(value)), ModelOutputError);
});

test("appeal to pass preserves original coaching and disk persistence without inventing coaching for legacy runs", async () => {
  const scored = scoreModelOutput(conversation, initialChecklist, withCoaching(coaching));
  const original: Evaluation = { id: "eval", recordId: conversation.id, createdAt: "2026-11-08T00:00:00Z", checklist: initialChecklist, ...scored, originalTotal: scored.total, demo: false };
  const changed = structuredClone(original);
  changed.results[0].answer = true;
  changed.results[0].override = { answer: true, reason: "Синтетическая ручная проверка", appealId: "appeal" };
  const revised = recalculate(changed);
  assert.equal(revised.total, 100);
  assert.equal(revised.originalTotal, 90);
  assert.deepEqual(revised.results[0].coaching, coaching);
  assert.notEqual(revised.results[0].coaching, original.results[0].coaching);
  const legacy = structuredClone(original);
  legacy.id = "legacy";
  delete legacy.results[0].coaching;
  const workspace: Workspace = { conversations: [conversation], checklists: [initialChecklist], evaluations: [revised, legacy], appeals: [] };
  const folder = await mkdtemp(join(tmpdir(), "qulaq-coaching-"));
  try {
    const path = join(folder, "workspace.json");
    await createStore(path, workspace);
    const restored = (await createStore(path, workspace)).snapshot();
    assert.deepEqual(restored.evaluations[0].results[0].coaching, coaching);
    assert.equal(restored.evaluations[1].results[0].coaching, undefined);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("prompt requires rule-specific coaching and blocks fabricated business promises", () => {
  const system = buildEvaluationMessages(conversation, initialChecklist)[0].content;
  assert.match(system, /coaching обязателен/);
  assert.match(system, /Не обещай сроки, суммы, тарифы/);
  assert.match(system, /needsContext=true требует response=null/);
  assert.match(system, /не отправка клиенту/);
});
