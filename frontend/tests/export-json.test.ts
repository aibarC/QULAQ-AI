import test from "node:test";
import assert from "node:assert/strict";
import { evaluationJson } from "../src/lib/export-evaluation-json.ts";
import { demoConversation, defaultChecklist, makeDemoEvaluation } from "../src/lib/fixtures.ts";

function fixture() {
  const conversation = structuredClone(demoConversation);
  conversation.demo = false;
  conversation.externalId = "control/қазақ:001";
  conversation.groupId = "CONTROL";
  conversation.audioUrl = "https://audio.example.test/file?sig=do-not-export";
  const evaluation = makeDemoEvaluation(defaultChecklist);
  evaluation.demo = false;
  return { conversation, evaluation };
}

test("JSON preserves original source ID, saved rule snapshot, totals and traceable evidence without signed URLs", () => {
  const { conversation, evaluation } = fixture();
  const before = structuredClone(evaluation);
  const text = evaluationJson(conversation, evaluation);
  const exported = JSON.parse(text);
  assert.equal(exported.format, "qulaq.evaluation");
  assert.equal(exported.schema_version, 1);
  assert.equal(exported.conversation_id, conversation.externalId);
  assert.equal(exported.dataset_group_id, "CONTROL");
  assert.equal(exported.source_kind, "server");
  assert.equal(exported.total, evaluation.total);
  assert.equal(exported.original_total, evaluation.originalTotal);
  assert.deepEqual(exported.checklist, evaluation.checklist);
  assert.equal(exported.results.length, evaluation.results.length);
  assert.equal(exported.results[0].criterion_name, evaluation.checklist.criteria[0].name);
  assert.equal(exported.results[0].rule_description, evaluation.checklist.criteria[0].description);
  const ids = new Set(exported.transcript.map((m: { message_id: string }) => m.message_id));
  for (const result of exported.results) for (const evidence of result.evidence)
    assert.ok(evidence.message_ids.every((id: string) => ids.has(id)));
  assert.equal(exported.transcript[0].timestamp, conversation.messages[0].timestamp);
  assert.ok(!text.includes("do-not-export"));
  assert.deepEqual(evaluation, before);
});

test("JSON keeps null N/A, review reasons, original answers and explicit preview/demo labels", () => {
  const { conversation, evaluation } = fixture();
  const reviewed = evaluation.results[0];
  reviewed.answer = false; reviewed.originalAnswer = true; reviewed.points = 0;
  reviewed.override = {answer:false,reason:"Причина проверяющего",appealId:"appeal:synthetic"};
  const na = evaluation.results.find(r => r.criterionId === "identity")!;
  na.answer = null; na.originalAnswer = null; na.points = null; na.naReason = "Общий вопрос не требует идентификации";
  const exported = JSON.parse(evaluationJson(conversation, evaluation));
  assert.equal(exported.results[0].reason, "Причина проверяющего");
  assert.equal(exported.results[0].original_reason, reviewed.explanation);
  assert.equal(exported.results[0].original_value, true);
  assert.equal(exported.results.find((r: {criterion_id:string}) => r.criterion_id === "identity").status, "not_applicable");
  assert.equal(exported.results.find((r: {criterion_id:string}) => r.criterion_id === "identity").points, null);
  assert.equal(JSON.parse(evaluationJson(conversation, evaluation, "Excel preview")).source_kind, "preview");
  evaluation.demo = true; conversation.demo = true;
  assert.equal(JSON.parse(evaluationJson(conversation, evaluation)).source_kind, "demo");
});

test("JSON refuses mismatched records, missing criteria and foreign evidence", () => {
  for (const breakData of [
    (e: ReturnType<typeof makeDemoEvaluation>) => {e.recordId = "other";},
    (e: ReturnType<typeof makeDemoEvaluation>) => {e.results.pop();},
    (e: ReturnType<typeof makeDemoEvaluation>) => {e.results[0].evidence[0].messageIds = ["foreign"];},
  ]) {
    const {conversation,evaluation} = fixture(); breakData(evaluation);
    assert.throws(() => evaluationJson(conversation,evaluation));
  }
});

test("explicit reference preview exports against a real record without mutating its provenance", () => {
  const { conversation, evaluation } = fixture();
  evaluation.demo = true;
  const beforeRecord = structuredClone(conversation);
  const beforeEvaluation = structuredClone(evaluation);
  assert.throws(() => evaluationJson(conversation, evaluation), /неизвестным диалогом/);
  const exported = JSON.parse(evaluationJson(conversation, evaluation, "Excel reference preview"));
  assert.equal(exported.source_kind, "preview");
  assert.equal(exported.source_description, "Excel reference preview");
  assert.equal(exported.conversation_id, conversation.externalId);
  assert.deepEqual(conversation, beforeRecord);
  assert.deepEqual(evaluation, beforeEvaluation);
  assert.equal(conversation.demo, false);
});
