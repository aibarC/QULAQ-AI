import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManagerReport,
  MAX_REPORT_DAYS,
} from "../src/lib/managerReport.ts";
import type {
  Answer,
  Checklist,
  Conversation,
  Evaluation,
  Workspace,
} from "../src/lib/types.ts";

const checklist: Checklist = {
  id: "rules",
  name: "Synthetic rules",
  version: 1,
  criteria: [
    {
      id: "contact",
      name: "Contact",
      description: "Synthetic boolean",
      type: "boolean",
      weight: 30,
      allowNA: true,
      naCondition: "Synthetic N/A",
      scale: [],
    },
    {
      id: "clarity",
      name: "Clarity",
      description: "Synthetic scale",
      type: "scale",
      weight: 70,
      allowNA: true,
      naCondition: "Synthetic N/A",
      scale: [
        { value: 0, label: "None" },
        { value: 4, label: "Partial" },
        { value: 10, label: "Full" },
      ],
    },
    {
      id: "gross",
      name: "Violation",
      description: "Synthetic flag",
      type: "flag",
      weight: 0,
      allowNA: false,
      naCondition: "",
      scale: [],
    },
  ],
};
function conversation(
  id: string,
  language: Conversation["language"] = "RU",
  demo = false,
): Conversation {
  return {
    id,
    externalId: id,
    groupId: "SYNTHETIC",
    language,
    demo,
    channel: "agent chat",
    status: "evaluated",
    audioUrl: null,
    messages: [
      {
        id: `${id}:m0`,
        timestamp: "00:00",
        speaker: "operator",
        text: "Synthetic transcript.",
      },
    ],
  };
}
function evaluation(
  recordId: string,
  id: string,
  createdAt: string,
  total: number | null = 80,
  answers: Answer[] = [true, 10, false],
  rules = checklist,
): Evaluation {
  return {
    id,
    recordId,
    createdAt,
    total,
    originalTotal: 12,
    grossViolation: answers[2] === true,
    demo: false,
    checklist: structuredClone(rules),
    results: rules.criteria.map((criterion, index) => ({
      criterionId: criterion.id,
      answer: answers[index],
      originalAnswer: answers[index],
      points: null,
      explanation: "Synthetic explanation.",
      evidence: [
        {
          messageIds: [`${recordId}:m0`],
          quote: "Synthetic transcript.",
          kind: "quote",
        },
      ],
      ...(answers[index] === null ? { naReason: "Synthetic N/A" } : {}),
    })),
  };
}
const workspace = (
  conversations: Conversation[],
  evaluations: Evaluation[],
): Workspace => ({
  conversations,
  evaluations,
  checklists: [structuredClone(checklist)],
  appeals: [],
});
const november = { start: "2026-11-01", end: "2026-11-30" };

test("period boundaries use Almaty calendar days and include both end dates", () => {
  const ids = ["before", "first", "last", "after"];
  const state = workspace(
    ids.map((id) => conversation(id)),
    [
      evaluation("before", "e0", "2026-10-31T18:59:59.999Z"),
      evaluation("first", "e1", "2026-10-31T19:00:00.000Z", 60),
      evaluation("last", "e2", "2026-11-30T18:59:59.999Z", 100),
      evaluation("after", "e3", "2026-11-30T19:00:00.000Z"),
    ],
  );
  const report = buildManagerReport(state, november);
  assert.deepEqual(
    report.rows.map((row) => row.conversation.id),
    ["last", "first"],
  );
  assert.equal(report.average, 80);
  assert.equal(report.dailyTrend.length, 30);
  assert.deepEqual(report.dailyTrend[0], {
    date: "2026-11-01",
    count: 1,
    scoredCount: 1,
    average: 60,
  });
  assert.deepEqual(report.dailyTrend[1], {
    date: "2026-11-02",
    count: 0,
    scoredCount: 0,
    average: null,
  });
  assert.equal(report.dailyTrend.at(-1)?.count, 1);
});

test("deduplicates inside the period, uses adjusted totals and excludes all synthetic sources", () => {
  const state = workspace(
    [
      conversation("a"),
      conversation("b"),
      conversation("demo", "RU", true),
      conversation("fixture-run"),
    ],
    [
      evaluation("a", "older", "2026-11-02T10:00:00Z", 30),
      evaluation("a", "selected", "2026-11-03T10:00:00Z", 90),
      evaluation("a", "outside-period", "2026-12-03T10:00:00Z", 10),
      evaluation("b", "null-total", "2026-11-03T10:00:00Z", null),
      evaluation("demo", "demo-conversation", "2026-11-03T10:00:00Z", 100),
      {
        ...evaluation(
          "fixture-run",
          "demo-evaluation",
          "2026-11-03T10:00:00Z",
          100,
        ),
        demo: true,
      },
      evaluation("missing-record", "orphan", "2026-11-03T10:00:00Z", 100),
    ],
  );
  const before = structuredClone(state);
  const report = buildManagerReport(state, november);
  assert.equal(report.conversationCount, 2);
  assert.equal(report.scoredCount, 1);
  assert.equal(report.average, 90);
  assert.equal(
    report.dailyTrend.find((day) => day.date === "2026-11-02")?.count,
    0,
  );
  assert.deepEqual(
    report.dailyTrend.find((day) => day.date === "2026-11-03"),
    { date: "2026-11-03", count: 2, scoredCount: 1, average: 90 },
  );
  assert.deepEqual(state, before);
});

test("violations use current answers, scale maximum and flag direction with N/A outside denominators", () => {
  const records = ["pass", "partial", "na"].map((id) => conversation(id));
  const passed = evaluation("pass", "pass-run", "2026-11-10T10:00:00Z", 100, [
    true,
    10,
    false,
  ]);
  passed.results[0].originalAnswer = false; // A corrected criterion must no longer count as a violation.
  const partial = evaluation(
    "partial",
    "partial-run",
    "2026-11-10T10:00:00Z",
    28,
    [false, 4, true],
  );
  partial.results[0].evidence[0].messageIds.push("partial:m0", "foreign:m0");
  const na = evaluation("na", "na-run", "2026-11-10T10:00:00Z", null, [
    null,
    null,
    false,
  ]);
  const report = buildManagerReport(
    workspace(records, [passed, partial, na]),
    november,
  );
  const contact = report.violations.find(
    (group) => group.criterionId === "contact",
  )!;
  const clarity = report.violations.find(
    (group) => group.criterionId === "clarity",
  )!;
  const flag = report.violations.find(
    (group) => group.criterionId === "gross",
  )!;
  assert.deepEqual(
    [contact.occurrences, contact.eligible, contact.rate],
    [1, 2, 0.5],
  );
  assert.deepEqual(
    [clarity.occurrences, clarity.eligible, clarity.rate],
    [1, 2, 0.5],
  );
  assert.deepEqual([flag.occurrences, flag.eligible, flag.rate], [1, 3, 1 / 3]);
  assert.deepEqual(contact.examples, [
    {
      recordId: "partial",
      externalId: "partial",
      evaluationId: "partial-run",
      criterionId: "contact",
      messageIds: ["partial:m0"],
    },
  ]);
});

test("rule versions and different checklist identities are never merged", () => {
  const v2 = { ...structuredClone(checklist), version: 2 };
  const other = { ...structuredClone(checklist), id: "different-rules" };
  const renamed = structuredClone(checklist);
  renamed.criteria[0].name = "Renamed contact";
  const records = ["v1", "v2", "other", "renamed"].map((id) =>
    conversation(id),
  );
  const report = buildManagerReport(
    workspace(
      records,
      [checklist, v2, other, renamed].map((rules, index) =>
        evaluation(
          records[index].id,
          `run-${index}`,
          "2026-11-10T10:00:00Z",
          70,
          [false, 10, false],
          rules,
        ),
      ),
    ),
    november,
  );
  assert.equal(report.violations.length, 4);
  assert.equal(new Set(report.violations.map((group) => group.key)).size, 4);
  assert.ok(
    report.violations.every(
      (group) => group.occurrences === 1 && group.eligible === 1,
    ),
  );
});

test("language filtering, zero totals and timestamp ties have deterministic sample sizes", () => {
  const records = [
    conversation("ru"),
    conversation("kz", "KZ"),
    conversation("en", "EN"),
  ];
  const evaluations = [
    evaluation("ru", "ru-run", "2026-11-10T10:00:00Z", 100),
    evaluation("kz", "a", "2026-11-10T10:00:00Z", 80),
    evaluation("kz", "z", "2026-11-10T10:00:00Z", 0),
    evaluation("en", "en-run", "2026-11-10T10:00:00Z", 70),
  ];
  const first = buildManagerReport(workspace(records, evaluations), {
    ...november,
    language: "KZ",
  });
  const second = buildManagerReport(
    workspace(records, [...evaluations].reverse()),
    { ...november, language: "KZ" },
  );
  assert.deepEqual(first, second);
  assert.equal(first.conversationCount, 1);
  assert.equal(first.scoredCount, 1);
  assert.equal(first.average, 0);
  assert.equal(first.rows[0].evaluation.id, "z");
});

test("empty periods, invalid timestamps and invalid totals do not invent an average", () => {
  const state = workspace(
    [conversation("invalid"), conversation("bad-total")],
    [
      evaluation("invalid", "bad-time", "not a timestamp"),
      evaluation("bad-total", "nonfinite", "2026-11-10T10:00:00Z", Number.NaN),
    ],
  );
  const report = buildManagerReport(state, november);
  assert.equal(report.conversationCount, 1);
  assert.equal(report.scoredCount, 0);
  assert.equal(report.average, null);
  const empty = buildManagerReport(workspace([], []), november);
  assert.equal(empty.average, null);
  assert.equal(empty.violations.length, 0);
  assert.ok(
    empty.dailyTrend.every((day) => day.count === 0 && day.average === null),
  );
});

test("date ranges reject impossible, reversed and oversized input before allocating trend rows", () => {
  const state = workspace([], []);
  for (const options of [
    { start: "2026-02-29", end: "2026-03-01" },
    { start: "2026-11-31", end: "2026-12-02" },
    { start: "", end: "2026-11-01" },
    { start: "2026-11-02", end: "2026-11-01" },
    { start: "2020-01-01", end: "2099-12-31" },
  ])
    assert.throws(() => buildManagerReport(state, options), RangeError);
  const leapYear = buildManagerReport(state, {
    start: "2028-01-01",
    end: "2028-12-31",
  });
  assert.equal(leapYear.dailyTrend.length, MAX_REPORT_DAYS);
  assert.ok(leapYear.dailyTrend.some((day) => day.date === "2028-02-29"));
});

test("added and deleted criteria flow into latest statistics while historical periods retain their snapshots", () => {
  const added = structuredClone(checklist);
  added.version = 2;
  added.criteria.push({ ...structuredClone(checklist.criteria[0]), id: "next-step", name: "Следующий шаг", weight: 25 });
  const removed = structuredClone(added);
  removed.version = 3;
  removed.criteria = removed.criteria.filter((c) => c.id !== "contact");
  const original = evaluation("a", "v1", "2026-11-01T10:00:00Z", 70, [false, 10, false]);
  const afterAdd = evaluation("a", "v2", "2026-11-02T10:00:00Z", 56, [false, 10, false, false], added);
  const afterDelete = evaluation("a", "v3", "2026-11-03T10:00:00Z", 73.68, [10, false, false], removed);
  const state = workspace([conversation("a")], [original, afterAdd, afterDelete]);
  state.checklists = [removed];
  const before = structuredClone(state);
  const latest = buildManagerReport(state, november);
  assert.equal(latest.conversationCount, 1);
  assert.equal(latest.average, 73.68);
  assert.equal(latest.dailyTrend.find((d) => d.date === "2026-11-03")?.average, 73.68);
  assert.deepEqual(latest.violations.map((v) => [v.criterionId, v.checklistVersion, v.eligible]), [["next-step", 3, 1]]);
  const addedPeriod = buildManagerReport(state, { start: "2026-11-02", end: "2026-11-02" });
  assert.equal(addedPeriod.average, 56);
  assert.deepEqual(new Set(addedPeriod.violations.map((v) => v.criterionId)), new Set(["contact", "next-step"]));
  const historical = buildManagerReport(state, { start: "2026-11-01", end: "2026-11-01" });
  assert.equal(historical.average, 70);
  assert.deepEqual(historical.violations.map((v) => v.criterionId), ["contact"]);
  assert.deepEqual(state, before);
});
