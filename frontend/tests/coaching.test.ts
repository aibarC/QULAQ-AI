import test from "node:test";
import assert from "node:assert/strict";
import { isCriterionIssue } from "../src/lib/coaching.ts";
import { parseCriterionCoaching } from "../src/lib/validation.ts";
import type { Criterion, CriterionCoaching } from "../src/lib/types.ts";

const criterion: Criterion = { id: "c", name: "Test", description: "Synthetic rule", type: "boolean", weight: 100, allowNA: true, naCondition: "Synthetic condition", scale: [] };
const coaching: CriterionCoaching = { response: "Здравствуйте!", explanation: "Добавлено приветствие по правилу.", needsContext: false, messageIds: ["m0"] };

test("renderer issue direction hides guidance after a pass or N/A override and respects flags and custom scales", () => {
  assert.equal(isCriterionIssue(criterion, false), true);
  assert.equal(isCriterionIssue(criterion, true), false);
  assert.equal(isCriterionIssue(criterion, null), false);
  assert.equal(isCriterionIssue({ ...criterion, type: "flag" }, true), true);
  assert.equal(isCriterionIssue({ ...criterion, type: "flag" }, false), false);
  const scale: Criterion = { ...criterion, type: "scale", scale: [{ value: 1, label: "Low" }, { value: 3, label: "High" }] };
  assert.equal(isCriterionIssue(scale, 1), true);
  assert.equal(isCriterionIssue(scale, 3), false);
  assert.equal(isCriterionIssue(scale, 2), false);
  assert.equal(isCriterionIssue(scale, NaN), false);
});

test("API coaching requires a failed original result and valid unique source messages", () => {
  assert.deepEqual(parseCriterionCoaching(coaching, criterion, false, new Set(["m0"])), coaching);
  assert.throws(() => parseCriterionCoaching(coaching, criterion, true, new Set(["m0"])));
  assert.throws(() => parseCriterionCoaching(coaching, criterion, null, new Set(["m0"])));
  assert.throws(() => parseCriterionCoaching(coaching, criterion, false, new Set(["other"])));
  assert.throws(() => parseCriterionCoaching({ ...coaching, messageIds: ["m0", "m0"] }, criterion, false, new Set(["m0"])));
  assert.throws(() => parseCriterionCoaching({ ...coaching, needsContext: true }, criterion, false, new Set(["m0"])));
});
