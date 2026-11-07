import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp, type AppOptions } from "../src/server.ts";
import { createStore } from "../src/store.ts";
import { LayaError, LAYA_MODEL, LAYA_REVISION } from "../src/laya.ts";
import type {
  Checklist,
  ContactReason,
  Conversation,
  Evaluation,
  Workspace,
} from "../../frontend/src/lib/types.ts";

const rules: Checklist = {
  id: "synthetic-rules",
  name: "Synthetic rules",
  version: 1,
  criteria: [
    {
      id: "clear",
      name: "Clear response",
      description: "Synthetic criterion",
      type: "boolean",
      weight: 100,
      allowNA: true,
      naCondition: "Synthetic N/A",
      scale: [],
    },
    {
      id: "flag",
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
const record: Conversation = {
  id: "DEV:synthetic",
  externalId: "synthetic",
  groupId: "DEV",
  channel: "agent chat",
  language: "RU",
  audioUrl: null,
  status: "unrated",
  demo: false,
  messages: [
    {
      id: "DEV:synthetic:m0",
      timestamp: "00:00",
      speaker: "operator",
      text: "Synthetic reply.",
    },
  ],
};
function rawDataset(group = "DEV") {
  return {
    isSuccess: true,
    data: {
      dataset_group_id: group,
      total_records: 1,
      records: [
        {
          conversation_id: "synthetic",
          language: "RU",
          channel: "agent chat",
          audio_url: null,
          transcript: [
            {
              timestamp: "00:00",
              speaker: "operator",
              text: "Synthetic reply.",
            },
          ],
        },
      ],
    },
  };
}
function outcome(input: Parameters<AppOptions["evaluate"]>[0]) {
  return {
    total: 100,
    grossViolation: false,
    results: input.checklist.criteria.map((criterion) => ({
      criterionId: criterion.id,
      answer: criterion.type === "flag" ? false : true,
      originalAnswer: criterion.type === "flag" ? false : true,
      points: criterion.type === "flag" ? null : criterion.weight,
      explanation: "Synthetic result.",
      evidence: [
        {
          messageIds: [input.conversation.messages[0].id],
          quote: input.conversation.messages[0].text,
          kind: "quote" as const,
        },
      ],
    })),
  };
}
function recalculate(evaluation: Evaluation): Evaluation {
  const next = structuredClone(evaluation);
  next.results.forEach((result) => {
    const criterion = next.checklist.criteria.find(
      (item) => item.id === result.criterionId,
    )!;
    result.points =
      criterion.type === "flag"
        ? null
        : result.answer === true
          ? criterion.weight
          : 0;
  });
  next.total = next.results.reduce(
    (sum, result) => sum + (result.points || 0),
    0,
  );
  next.grossViolation =
    next.results.find((item) => item.criterionId === "flag")?.answer === true;
  return next;
}
async function fixture(t: TestContext, overrides: Partial<AppOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "qulaq-http-"));
  const datasetPath = join(directory, "dev.json");
  await writeFile(datasetPath, JSON.stringify(rawDataset()));
  const initial: Workspace = {
    conversations: [structuredClone(record)],
    checklists: [structuredClone(rules)],
    evaluations: [],
    appeals: [],
  };
  const store = await createStore(join(directory, "workspace.json"), initial);
  const server = createApp({
    store,
    datasetPath,
    initialChecklist: rules,
    evaluate: async (input) => outcome(input),
    recalculate,
    ...overrides,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });
  const post = (
    path: string,
    payload: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });
  return { base, store, post, server };
}
async function settled(store: Awaited<ReturnType<typeof createStore>>) {
  for (let i = 0; i < 200; i++) {
    if (store.snapshot().conversations[0].status !== "evaluating")
      return store.snapshot();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Synthetic job did not finish");
}

async function seedClassifiableEvaluation(store: Awaited<ReturnType<typeof createStore>>) {
  const scored = outcome({ conversation: record, checklist: rules, signal: new AbortController().signal });
  const evaluation: Evaluation = {
    id: "synthetic:existing-evaluation", recordId: record.id, checklist: structuredClone(rules), createdAt: "2026-11-08T00:00:00Z",
    ...scored, originalTotal: scored.total, demo: false,
    contactReason: {
      taxonomyVersion: 1, primary: "other", secondary: [], summary: "Prior synthetic reason", reason: "Prior synthetic explanation",
      evidenceIds: [record.messages[0].id], resolution: { status: "unknown", reason: "Prior outcome unknown", evidenceIds: [] },
    },
  };
  await store.mutate((draft) => {
    draft.evaluations.push(evaluation);
    draft.conversations[0].status = "evaluated";
  });
  return evaluation;
}

test("classify-reason disabled returns 503 without changing saved state or invoking the evaluator", async (t) => {
  let gatewayCalls = 0;
  const f = await fixture(t, { evaluate: async () => { gatewayCalls++; throw new Error("Synthetic gateway forbidden"); } });
  const evaluation = await seedClassifiableEvaluation(f.store);
  const before = f.store.snapshot();
  const response = await f.post(`/api/evaluations/${encodeURIComponent(evaluation.id)}/classify-reason`, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "LOCAL_CLASSIFIER_DISABLED");
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(gatewayCalls, 0);
});

test("classify-reason saves local provenance and clears old errors while preserving every scoring field", async (t) => {
  let gatewayCalls = 0, localCalls = 0;
  const classification: ContactReason = {
    taxonomyVersion: 1, primary: "technical", secondary: [], summary: "Synthetic local classification", reason: "Synthetic local source",
    evidenceIds: [record.messages[0].id], resolution: { status: "unknown", reason: "Synthetic outcome unknown", evidenceIds: [] },
    classifier: { provider: "laya", model: LAYA_MODEL, revision: LAYA_REVISION, criterionId: "clear", messageIds: [record.messages[0].id] },
  };
  const f = await fixture(t, {
    evaluate: async () => { gatewayCalls++; throw new Error("Synthetic gateway forbidden"); },
    classifyReason: async (conversation, evaluation) => {
      localCalls++;
      assert.equal(conversation.id, record.id);
      assert.equal(evaluation.id, "synthetic:existing-evaluation");
      assert.equal(evaluation.total, 100);
      return classification;
    },
  });
  const evaluation = await seedClassifiableEvaluation(f.store);
  await f.store.mutate((draft) => { draft.evaluations[0].classificationError = { provider: "laya", code: "unavailable", message: "Synthetic previous error" }; });
  const response = await f.post(`/api/evaluations/${encodeURIComponent(evaluation.id)}/classify-reason`, {});
  assert.equal(response.status, 200);
  const returned = await response.json() as Workspace;
  assert.deepEqual(returned, f.store.snapshot());
  assert.deepEqual(returned.evaluations[0], { ...evaluation, contactReason: classification });
  assert.equal(returned.evaluations[0].classificationError, undefined);
  assert.equal(returned.conversations[0].status, "evaluated");
  assert.equal(localCalls, 1);
  assert.equal(gatewayCalls, 0);
});

test("classify-reason failure saves safe error but preserves prior classification and scores without gateway calls", async (t) => {
  for (const typedError of [true, false]) {
    await t.test(typedError ? "typed local error" : "unexpected sanitized error", async (t) => {
      let gatewayCalls = 0, localCalls = 0;
      const f = await fixture(t, {
        evaluate: async () => { gatewayCalls++; throw new Error("Synthetic gateway forbidden"); },
        classifyReason: async () => {
          localCalls++;
          throw typedError ? new LayaError("timeout") : new Error("SYNTHETIC_PRIVATE_TRACE");
        },
      });
      const evaluation = await seedClassifiableEvaluation(f.store);
      const response = await f.post(`/api/evaluations/${encodeURIComponent(evaluation.id)}/classify-reason`, {});
      assert.equal(response.status, 200);
      const returned = await response.json() as Workspace;
      assert.deepEqual(returned, f.store.snapshot());
      const { classificationError, ...preserved } = returned.evaluations[0];
      assert.deepEqual(preserved, evaluation);
      assert.equal(classificationError?.provider, "laya");
      assert.equal(classificationError?.code, typedError ? "timeout" : "failed");
      assert.equal(JSON.stringify(returned).includes("SYNTHETIC_PRIVATE_TRACE"), false);
      assert.equal(localCalls, 1);
      assert.equal(gatewayCalls, 0);
    });
  }
});

test("provider is disabled by default and unsafe origins, JSON and oversized bodies are rejected", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    evaluate: async (input) => {
      calls++;
      return outcome(input);
    },
  });
  const disabled = await f.post("/api/evaluations", {
    recordId: record.id,
    checklistId: rules.id,
  });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).code, "EVALUATION_DISABLED");
  assert.equal(calls, 0);
  assert.equal(f.store.snapshot().conversations[0].status, "unrated");
  assert.equal(
    (
      await fetch(`${f.base}/api/workspace`, {
        headers: { Origin: "https://attacker.invalid" },
      })
    ).status,
    403,
  );
  const hostileHost = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      `${f.base}/api/workspace`,
      { headers: { Host: "attacker.invalid" } },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode!));
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(hostileHost, 403);
  assert.equal(
    (
      await fetch(`${f.base}/api/checklists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    ).status,
    422,
  );
  assert.equal(
    (await f.post("/api/checklists", { extra: "x".repeat(5 * 1024 * 1024) }))
      .status,
    413,
  );
  assert.equal(calls, 0);
});

test("chunked bodies also enforce the five megabyte limit with an explicit response", async (t) => {
  const f = await fixture(t);
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      `${f.base}/api/datasets/upload`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode!));
      },
    );
    req.on("error", reject);
    for (let i = 0; i < 6; i++) req.write("x".repeat(1024 * 1024));
    req.end();
  });
  assert.equal(status, 413);
});

test("DEV and UPLOAD imports are idempotent and conflicting transcript IDs do not overwrite history", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.post("/api/datasets/import", { groupId: "DEV" })).status,
    200,
  );
  assert.equal(f.store.snapshot().conversations.length, 1);
  const uploaded = rawDataset("UPLOAD");
  assert.equal((await f.post("/api/datasets/upload", uploaded)).status, 200);
  assert.equal((await f.post("/api/datasets/upload", uploaded)).status, 200);
  assert.equal(f.store.snapshot().conversations.length, 2);
  assert.equal(
    f.store.snapshot().conversations[1].messages[0].id,
    "UPLOAD:synthetic:m0",
  );
  uploaded.data.records[0].transcript[0].text = "Conflicting synthetic reply";
  assert.equal((await f.post("/api/datasets/upload", uploaded)).status, 409);
  assert.equal(
    f.store.snapshot().conversations[1].messages[0].text,
    "Synthetic reply.",
  );
  assert.equal(
    (await f.post("/api/datasets/upload", rawDataset("DEV"))).status,
    422,
  );
});

test("async evaluation returns 202, deduplicates in-flight starts and retains the launch checklist snapshot", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const f = await fixture(t, {
    allowEvaluation: true,
    evaluate: async (input) => {
      calls++;
      await gate;
      return outcome(input);
    },
  });
  const responses = await Promise.all([
    f.post("/api/evaluations", { recordId: record.id, checklistId: rules.id }),
    f.post("/api/evaluations", { recordId: record.id, checklistId: rules.id }),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 202);
    assert.equal((await response.json()).conversations[0].status, "evaluating");
  }
  const changed = structuredClone(rules);
  changed.name = "Version two";
  assert.equal((await f.post("/api/checklists", changed)).status, 200);
  release();
  const state = await settled(f.store);
  assert.equal(calls, 1);
  assert.equal(state.conversations[0].status, "evaluated");
  assert.equal(state.evaluations.length, 1);
  assert.equal(state.evaluations[0].demo, false);
  assert.equal(state.evaluations[0].checklist.version, 1);
  assert.equal(state.checklists[0].version, 2);
  assert.equal((await f.post("/api/checklists", rules)).status, 409);
});

test("async evaluation persists contact reason and serves its unchanged evidence through workspace", async (t) => {
  const contactReason: ContactReason = {
    taxonomyVersion: 1, primary: "technical", secondary: [], summary: "Синтетический сбой",
    reason: "Синтетическое описание проблемы.", evidenceIds: [record.messages[0].id],
    resolution: { status: "unknown", reason: "Результат не подтверждён.", evidenceIds: [] },
  };
  const f = await fixture(t, {
    allowEvaluation: true,
    evaluate: async (input) => ({ ...outcome(input), contactReason }),
  });
  assert.equal((await f.post("/api/evaluations", { recordId: record.id, checklistId: rules.id })).status, 202);
  const state = await settled(f.store);
  assert.deepEqual(state.evaluations[0].contactReason, contactReason);
  assert.equal(state.conversations[0].status, "evaluated");
});

test("provider or invalid output failure preserves the previous evaluation and does not retry", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    allowEvaluation: true,
    evaluate: async (input) => {
      calls++;
      if (calls === 2)
        throw new Error("private provider details must not be returned");
      if (calls === 3) return { ...outcome(input), total: 200 };
      return outcome(input);
    },
  });
  await f.post("/api/evaluations", {
    recordId: record.id,
    checklistId: rules.id,
  });
  const first = await settled(f.store);
  for (let i = 0; i < 2; i++) {
    await f.post("/api/evaluations", {
      recordId: record.id,
      checklistId: rules.id,
    });
    const failed = await settled(f.store);
    assert.equal(failed.conversations[0].status, "error");
    assert.deepEqual(failed.evaluations, first.evaluations);
  }
  assert.equal(calls, 3);
});

test("appeals use immutable result rules, deduplicate pending requests and preserve original scores", async (t) => {
  const f = await fixture(t, { allowEvaluation: true });
  await f.post("/api/evaluations", {
    recordId: record.id,
    checklistId: rules.id,
  });
  const evaluated = await settled(f.store);
  const request = {
    evaluationId: evaluated.evaluations[0].id,
    criterionId: "clear",
    comment: "Synthetic review request",
  };
  await f.post("/api/appeals", request);
  await f.post("/api/appeals", request);
  assert.equal(f.store.snapshot().appeals.length, 1);
  const appeal = f.store.snapshot().appeals[0];
  const path = `/api/appeals/${encodeURIComponent(appeal.id)}/decision`;
  assert.equal(
    (
      await f.post(path, {
        action: "change",
        answer: 3,
        reason: "Invalid answer",
      })
    ).status,
    422,
  );
  assert.equal(f.store.snapshot().appeals[0].status, "pending");
  assert.equal(
    (
      await f.post(path, {
        action: "change",
        answer: false,
        reason: "Synthetic correction",
      })
    ).status,
    200,
  );
  const result = f.store.snapshot().evaluations[0];
  assert.equal(result.total, 0);
  assert.equal(result.originalTotal, 100);
  assert.equal(result.results[0].originalAnswer, true);
  assert.equal(result.results[0].answer, false);
  assert.equal(result.results[0].override?.appealId, appeal.id);
  assert.equal(
    (await f.post(path, { action: "confirm", reason: "Already resolved" }))
      .status,
    409,
  );
});
