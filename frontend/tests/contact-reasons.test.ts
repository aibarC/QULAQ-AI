import test from "node:test";
import assert from "node:assert/strict";
import { CONTACT_REASON_GROUPS, RESOLUTION_LABELS, type ContactReason } from "../src/lib/contactReasons.ts";
import { parseContactReason, parseWorkspace } from "../src/lib/validation.ts";
import type { Workspace } from "../src/lib/types.ts";

const reason: ContactReason = {
  taxonomyVersion: 1, primary: "documents", secondary: [], summary: "Нужна справка",
  reason: "Клиент запросил справку.", evidenceIds: ["m0"],
  resolution: { status: "unknown", reason: "Получение не подтверждено.", evidenceIds: [] },
};
const workspace: Workspace = {
  conversations: [{ id: "record", externalId: "record", groupId: "TEST", channel: "agent chat", language: "RU", status: "evaluated", audioUrl: null,
    messages: [{ id: "m0", timestamp: "00:00", speaker: "client", text: "Синтетический запрос справки" }] }],
  checklists: [{ id: "check", version: 1, name: "Test", criteria: [{ id: "criterion", name: "Test", description: "Test", type: "boolean", weight: 100, allowNA: false, naCondition: "", scale: [] }] }],
  evaluations: [], appeals: [],
};
workspace.evaluations.push({ id: "evaluation", recordId: "record", checklist: workspace.checklists[0], createdAt: "2026-11-08T00:00:00Z", demo: false, grossViolation: false, total: 100, originalTotal: 100,
  results: [{ criterionId: "criterion", answer: true, originalAnswer: true, points: 100, explanation: "Test", evidence: [] }], contactReason: reason });

test("taxonomy labels are complete and API workspace retains optional contact reason", () => {
  assert.equal(CONTACT_REASON_GROUPS.length, 9);
  assert.equal(new Set(CONTACT_REASON_GROUPS.map((group) => group.id)).size, 9);
  assert.deepEqual(Object.keys(RESOLUTION_LABELS), ["resolved", "unresolved", "unknown"]);
  assert.deepEqual(parseWorkspace(workspace).evaluations[0].contactReason, reason);
  const historic = structuredClone(workspace);
  delete historic.evaluations[0].contactReason;
  assert.equal(parseWorkspace(historic).evaluations[0].contactReason, undefined);
});

test("API validation rejects cross-conversation and duplicate evidence instead of stripping metadata", () => {
  const invalid = structuredClone(workspace);
  invalid.evaluations[0].contactReason!.resolution = { status: "unresolved", reason: "Не решено", evidenceIds: ["missing"] };
  assert.throws(() => parseWorkspace(invalid), /отсутствующее сообщение/);
  assert.throws(() => parseContactReason({ ...reason, evidenceIds: ["m0", "m0"] }, new Set(["m0"])));
  assert.throws(() => parseContactReason({ ...reason, secondary: ["documents"] }, new Set(["m0"])));
  assert.throws(() => parseContactReason({ ...reason, primary: "invented" }, new Set(["m0"])));
});
