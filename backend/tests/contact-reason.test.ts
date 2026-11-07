import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContactReason, Conversation, Evaluation, Workspace } from "../../frontend/src/lib/types.ts";
import { initialChecklist, scoreModelOutput, recalculate, ModelOutputError } from "../src/scoring.ts";
import { buildEvaluationMessages } from "../src/prompt.ts";
import { createStore } from "../src/store.ts";

const conversation: Conversation = {
  id: "test", externalId: "test", groupId: "TEST", channel: "agent chat",
  language: "RU", status: "evaluated", audioUrl: null,
  messages: [
    { id: "test:m0", timestamp: "00:00", speaker: "client", text: "При пополнении ошибка в приложении." },
    { id: "test:m1", timestamp: "00:01", speaker: "client", text: "Повторил, деньги зачислены." },
  ],
};
const reason: ContactReason = {
  taxonomyVersion: 1, primary: "deposit", secondary: ["technical"],
  summary: "Ошибка при пополнении", reason: "Клиент хотел пополнить счёт.", evidenceIds: ["test:m0"],
  resolution: { status: "resolved", reason: "Клиент подтвердил зачисление.", evidenceIds: ["test:m1"] },
};
function raw() {
  return { results: initialChecklist.criteria.map((criterion) => ({
    criterion_id: criterion.id, status: "scored", value: criterion.type === "scale" ? Math.max(...criterion.scale.map((option) => option.value)) : criterion.type !== "flag",
    reason: "Синтетическое подтверждение.", evidence_ids: ["test:m1"], evidence_kind: "messages",
  })) };
}
function evaluated(): Evaluation {
  const result = scoreModelOutput(conversation, initialChecklist, { ...raw(), contact_reason: reason });
  return { id: "test:eval", recordId: conversation.id, createdAt: "2026-11-08T00:00:00Z", checklist: initialChecklist, ...result, originalTotal: result.total, demo: false };
}

test("new metadata is retained without changing scores; legacy model output remains compatible", () => {
  const old = scoreModelOutput(conversation, initialChecklist, raw());
  const current = evaluated();
  assert.equal(old.contactReason, undefined);
  assert.deepEqual(current.contactReason, reason);
  assert.equal(current.total, old.total);
  assert.deepEqual(current.results, old.results);
  assert.equal(current.grossViolation, old.grossViolation);
});

test("model metadata rejects foreign IDs, duplicate IDs, taxonomy mismatch and malformed categories", () => {
  const mutations: ((value: any) => void)[] = [
    (r) => { r.primary = "invented"; },
    (r) => { r.taxonomyVersion = 2; },
    (r) => { r.secondary = ["technical", "technical"]; },
    (r) => { r.secondary = ["deposit"]; },
    (r) => { r.secondary = ["technical", "trading", "documents", "other"]; },
    (r) => { r.evidenceIds = ["foreign:m0"]; },
    (r) => { r.evidenceIds = ["test:m0", "test:m0"]; },
    (r) => { r.resolution.evidenceIds = ["foreign:m0"]; },
    (r) => { r.resolution.evidenceIds = ["test:m1", "test:m1"]; },
    (r) => { r.resolution.status = "probably"; },
    (r) => { r.evidenceIds = []; },
    (r) => { r.resolution.evidenceIds = []; },
    (r) => { r.reason = " "; },
    (r) => { r.extra = true; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(reason);
    mutate(invalid);
    assert.throws(() => scoreModelOutput(conversation, initialChecklist, { ...raw(), contact_reason: invalid }), ModelOutputError);
  }
  assert.throws(() => scoreModelOutput(conversation, initialChecklist, { ...raw(), contact_reason: null }), ModelOutputError);
});

test("unknown is explicit uncertainty, not fabricated evidence or missing classification", () => {
  const unknown: ContactReason = { ...reason, primary: "unknown", secondary: [], evidenceIds: [],
    summary: "Цель не раскрыта", reason: "Клиент не сообщил цель обращения.",
    resolution: { status: "unknown", reason: "Результат не указан.", evidenceIds: [] } };
  const scored = scoreModelOutput(conversation, initialChecklist, { ...raw(), contact_reason: unknown });
  assert.deepEqual(scored.contactReason, unknown);
});

test("model output cannot forge server-owned Laya provenance", () => {
  const forged = { ...reason, classifier: {
    provider: "laya", model: "convaiinnovations/laya-multilingual", revision: "1720e3e3357cfe1e281542e223f8273b0890ca34",
    criterionId: "c2", messageIds: ["test:m0"],
  } };
  assert.throws(() => scoreModelOutput(conversation, initialChecklist, { ...raw(), contact_reason: forged }),
    (error) => error instanceof ModelOutputError && /только сервером/.test(error.message));
});

test("reviewer recalculation and disk reload preserve classification without backfilling old runs", async () => {
  const source = evaluated();
  const original = structuredClone(source);
  source.results[0].answer = false;
  source.results[0].override = { answer: false, reason: "Синтетическая правка", appealId: "appeal" };
  const revised = recalculate(source);
  assert.equal(revised.total, 90);
  assert.equal(revised.originalTotal, 100);
  assert.deepEqual(revised.contactReason, original.contactReason);
  assert.notEqual(revised.contactReason, source.contactReason);
  const legacy = { ...original, id: "test:legacy" };
  delete legacy.contactReason;
  const workspace: Workspace = { conversations: [conversation], checklists: [initialChecklist], evaluations: [revised, legacy], appeals: [] };
  const folder = await mkdtemp(join(tmpdir(), "qulaq-reason-"));
  try {
    const file = join(folder, "workspace.json");
    const store = await createStore(file, workspace);
    assert.deepEqual(store.snapshot().evaluations[0].contactReason, reason);
    const reloaded = await createStore(file, workspace);
    assert.deepEqual(reloaded.snapshot().evaluations[0].contactReason, reason);
    assert.equal(reloaded.snapshot().evaluations[1].contactReason, undefined);
    await assert.rejects(() => store.mutate((draft) => { draft.evaluations[0].contactReason!.evidenceIds = ["foreign"]; }));
    assert.deepEqual(store.snapshot().evaluations[0].contactReason, reason);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("prompt requires purpose classification and explicit resolution evidence independently of quality", () => {
  const system = buildEvaluationMessages(conversation, initialChecklist)[0].content;
  assert.match(system, /contact_reason обязателен/);
  assert.match(system, /primary=deposit, secondary может содержать technical/);
  assert.match(system, /сами по себе НЕ подтверждают решение/);
  assert.match(system, /не смешивая её с качеством/);
});
