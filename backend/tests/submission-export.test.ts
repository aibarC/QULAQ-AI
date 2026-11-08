import test from "node:test";
import assert from "node:assert/strict";
import { buildSubmission } from "../src/submission-export.ts";
import { initialChecklist, scoreModelOutput } from "../src/scoring.ts";
import { legacyC6 } from "../src/checklist-migrations.ts";
import type { Workspace, Conversation } from "../../frontend/src/lib/types.ts";
const options = { groupId: "PROD", teamName: "Amazing Guys", expectedCount: 10 as const };
function fixture(): Workspace {
  const workspace: Workspace = { conversations: [], evaluations: [], appeals: [], checklists: [structuredClone(initialChecklist)] };
  for (let i = 0; i < 10; i++) {
    const record: Conversation = { id: `PROD:${i}`, externalId: `real-${i}`, groupId: "PROD", channel: "agent chat", language: "RU", status: "evaluated", audioUrl: null, messages: [
      { id: "a", speaker: "client", timestamp: "00:00", text: "Question" },
      { id: "b", speaker: "bot", timestamp: "00:01", text: "Bot" },
      { id: "c", speaker: "system", timestamp: "00:02", text: "Transfer" },
      { id: "d", speaker: "operator", timestamp: "00:03", text: "Answer" },
    ] };
    const checklist = structuredClone(initialChecklist);
    const scored = scoreModelOutput(record, checklist, { results: checklist.criteria.map((c) => ({ criterion_id: c.id, status: c.id === "c2" ? "not_applicable" : "scored", value: c.id === "c2" ? null : c.type === "flag" ? true : c.type === "scale" ? c.id === "c4" ? 15 : 7 : true, reason: "Confirmed rationale", evidence_kind: "checked_range", evidence_ids: ["a", "d"] })) });
    workspace.conversations.push(record);
    workspace.evaluations.push({ id: `eval-${i}`, recordId: record.id, createdAt: "2026-11-08T00:00:00Z", checklist, ...scored, originalTotal: scored.total, demo: false, provenance: { model: "kimi-k3", promptVersion: "dynamic", transcriptHash: "test" } });
  }
  return workspace;
}
test("official document uses raw scales, N/A, full transcript positions and recomputed score, never transcript text", () => {
  const w = fixture(); const before = structuredClone(w); const out = buildSubmission(w, options);
  assert.equal(out.results.length, 10); assert.equal(out.model.mode, "external_api");
  assert.deepEqual(out.results[0].criteria.map((c) => c.criterion_id), ["contact", "discovery", "identification", "consultation", "empathy", "dialogue", "closure", "critical"]);
  assert.equal(out.results[0].criteria[1].value, null); assert.equal(out.results[0].criteria[5].value, 7);
  assert.deepEqual(out.results[0].criteria[0].evidence_turns, [1, 2, 3, 4]);
  assert.equal(out.results[0].score?.critical_flag, true); assert.ok(out.results[0].score!.final_score > 0);
  assert.equal(JSON.stringify(out).includes('"transcript"'), false); assert.deepEqual(w, before);
});
test("legacy C6 accepted, mixed actual models retained, errors not replaced by old successes", () => {
  const w = fixture(); w.evaluations[0].checklist.criteria[5] = structuredClone(legacyC6);
  w.evaluations[1].provenance!.model = "other-model";
  w.conversations[2].status = "error"; w.conversations[3].status = "unrated";
  const out = buildSubmission(w, options); assert.equal(out.model.name, "kimi-k3, other-model");
  assert.deepEqual(out.results[2].criteria, []); assert.equal(out.results[2].score, null); assert.equal(out.results[3].status, "error");
});
test("all errors export with configured model, pending runs reject, successful missing provenance rejects", () => {
  const w = fixture(); w.evaluations = []; w.conversations.forEach((r) => r.status = "unrated");
  assert.throws(() => buildSubmission(w, options), /модели/);
  assert.equal(buildSubmission(w, { ...options, fallbackModelName: "configured-model" }).results.filter((r) => r.status === "error").length, 10);
  w.conversations[0].status = "evaluating"; assert.throws(() => buildSubmission(w, { ...options, fallbackModelName: "configured-model" }), /Дождитесь/);
  const valid = fixture(); delete valid.evaluations[0].provenance;
  assert.throws(() => buildSubmission(valid, { ...options, fallbackModelName: "configured-model" }), /provenance/);
});
test("rejects wrong count, duplicate ID, latest custom profile, altered weights and definitions", () => {
  const edits: ((w: Workspace) => void)[] = [
    (w) => { w.conversations.pop(); }, (w) => { w.conversations[1].externalId = w.conversations[0].externalId; },
    (w) => { w.evaluations[0].checklist.criteria[0].weight = 11; },
    (w) => { w.evaluations[0].checklist.criteria[0].description += " new"; },
    (w) => { w.evaluations[0].checklist.criteria[3].scale[0].value = 1; },
    (w) => { const latest = structuredClone(w.evaluations[0]); latest.id = "latest"; latest.checklist.criteria.pop(); w.evaluations.push(latest); },
  ];
  for (const edit of edits) { const w = fixture(); edit(w); assert.throws(() => buildSubmission(w, options)); }
});
test("rejects incomplete/duplicate answers, bad scale/NA, tampered scores/flag and evidence/rationale", () => {
  const edits: ((w: Workspace) => void)[] = [
    (w) => { w.evaluations[0].results.pop(); },
    (w) => { w.evaluations[0].results[1] = structuredClone(w.evaluations[0].results[0]); },
    (w) => { w.evaluations[0].results[5].answer = 9; },
    (w) => { w.evaluations[0].results[0].answer = null; },
    (w) => { delete w.evaluations[0].results[1].naReason; },
    (w) => { w.evaluations[0].total = 0; },
    (w) => { w.evaluations[0].grossViolation = false; },
    (w) => { w.evaluations[0].results[0].points = 0; },
    (w) => { w.evaluations[0].results[0].explanation = " "; },
    (w) => { w.evaluations[0].results[0].evidence = []; },
    (w) => { w.evaluations[0].results[0].evidence[0].messageIds = ["missing", "d"]; },
    (w) => { w.evaluations[0].results[0].evidence[0].messageIds = ["d", "a"]; },
    (w) => { w.evaluations[0].results[0].evidence[0].messageIds = ["a", "d", "b"]; },
  ];
  for (const edit of edits) { const w = fixture(); edit(w); assert.throws(() => buildSubmission(w, options)); }
});
