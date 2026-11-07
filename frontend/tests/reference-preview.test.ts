import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReferenceEvaluation,
  type ReferenceAnnotation,
} from "../src/lib/reference-preview.ts";
import { defaultChecklist, demoConversation } from "../src/lib/fixtures.ts";

test("Excel preview normalizes applicable weights, preserves N/A zero and maps source evidence", () => {
  const source: ReferenceAnnotation = {
    answers: [true, null, null, 15, true, 7, true, false],
    explanations: Array.from({ length: 8 }, () => "Источник m1, m999"),
  };
  const before = JSON.stringify(source);
  const result = buildReferenceEvaluation(
    demoConversation,
    defaultChecklist,
    source,
  );
  // Applicable maximum 65; earned 10+15+15+10.5+5=55.5.
  assert.equal(result.total, 85.38);
  assert.equal(result.results[1].points, 0);
  assert.equal(result.results[1].answer, null);
  assert.equal(result.results[7].points, null);
  assert.deepEqual(result.results[0].evidence[0].messageIds, [
    demoConversation.messages[0].id,
  ]);
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.demo, true);
});

test("Excel preview is independent of editable checklists and rejects invalid source answers", () => {
  const source: ReferenceAnnotation = {
    answers: [true, true, true, 20, true, 10, true, false],
    explanations: Array(8).fill("Источник"),
  };
  const modified = structuredClone(defaultChecklist);
  modified.criteria[0].weight = 999;
  assert.equal(
    buildReferenceEvaluation(demoConversation, modified, source).total,
    100,
  );
  assert.throws(() =>
    buildReferenceEvaluation(demoConversation, modified, {
      ...source,
      answers: [true, true, true, 17, true, 10, true, false],
    } as unknown as ReferenceAnnotation),
  );
});
