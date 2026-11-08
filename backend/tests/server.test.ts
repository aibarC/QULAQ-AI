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
import { createDatasetImporter, DatasetImportError } from "../src/dataset-import.ts";
import { createGatewayProvider } from "../src/provider.ts";
import { scoreModelOutput } from "../src/scoring.ts";
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
  assert.deepEqual(returned, { ...f.store.snapshot(), capabilities: { evaluationEnabled: false, improvementEnabled: false } });
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
      assert.deepEqual(returned, { ...f.store.snapshot(), capabilities: { evaluationEnabled: false, improvementEnabled: false } });
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
    200,
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


test("improvement is explicit, persists null or text, caches, and never rewrites scores", async (t) => {
  for (const text of [null, "Учебный пример улучшенного ответа."]) {
    let calls = 0;
    const f = await fixture(t, { allowImprovement: true, improve: async () => { calls++; return text; } });
    const original = await seedClassifiableEvaluation(f.store);
    const path = `/api/evaluations/${encodeURIComponent(original.id)}/improvement`;
    const response = await f.post(path, {});
    assert.equal(response.status, 200);
    const returned = await response.json() as Workspace;
    assert.equal(returned.capabilities?.improvementEnabled, true);
    const { improvement, ...unchanged } = returned.evaluations[0];
    assert.deepEqual(unchanged, original);
    assert.equal(improvement?.text, text);
    assert.match(improvement!.assessmentFingerprint, /^[a-f0-9]{64}$/);
    assert.equal((await f.post(path, {})).status, 200);
    assert.equal(calls, 1);
    assert.deepEqual(f.store.snapshot().evaluations[0].improvement, improvement);
    const appealResponse = await f.post("/api/appeals", { evaluationId: original.id, criterionId: "clear", comment: "Synthetic appeal" });
    const appeal = (await appealResponse.json() as Workspace).appeals[0];
    const decision = await f.post(`/api/appeals/${encodeURIComponent(appeal.id)}/decision`, { action: "change", answer: false, reason: "Synthetic review" });
    assert.equal(decision.status, 200);
    assert.equal(f.store.snapshot().evaluations[0].improvement, undefined);
    assert.equal(f.store.snapshot().evaluations[0].originalTotal, original.originalTotal);
  }
});

test("improvement failure stays distinct from null and leaves analysis intact", async (t) => {
  const f = await fixture(t, { allowImprovement: true, improve: async () => { throw new Error("PRIVATE_PROVIDER_DETAIL"); } });
  const original = await seedClassifiableEvaluation(f.store);
  const response = await f.post(`/api/evaluations/${encodeURIComponent(original.id)}/improvement`, {});
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes("PRIVATE_PROVIDER_DETAIL"));
  assert.deepEqual(f.store.snapshot().evaluations[0], original);
});

test("disabled improvement does not invoke provider", async (t) => {
  let calls = 0;
  const f = await fixture(t, { improve: async () => { calls++; return null; } });
  const original = await seedClassifiableEvaluation(f.store);
  assert.equal((await f.post(`/api/evaluations/${encodeURIComponent(original.id)}/improvement`, {})).status, 503);
  assert.equal(calls, 0);
});

test("concurrent review discards stale improvement and duplicate generation is rejected", async (t) => {
  let release!: (value: string) => void;
  let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const f = await fixture(t, { allowImprovement: true, improve: async () => { started(); return new Promise<string>(resolve => { release = resolve; }); } });
  const original = await seedClassifiableEvaluation(f.store);
  const path = `/api/evaluations/${encodeURIComponent(original.id)}/improvement`;
  const pending = f.post(path, {});
  await began;
  assert.equal((await f.post(path, {})).status, 409);
  await f.post("/api/appeals", { evaluationId: original.id, criterionId: "clear", comment: "Synthetic appeal" });
  const appeal = f.store.snapshot().appeals[0];
  assert.equal((await f.post(`/api/appeals/${encodeURIComponent(appeal.id)}/decision`, { action: "change", answer: false, reason: "Concurrent review" })).status, 200);
  release("Stale recommendation");
  assert.equal((await pending).status, 409);
  assert.equal(f.store.snapshot().evaluations[0].improvement, undefined);
  assert.equal(f.store.snapshot().evaluations[0].results[0].answer, false);
});

test("saved additions, deletions and weights drive the next provider analysis without rewriting history", async (t) => {
  const requested: { version: number; ids: string[] }[] = [];
  const provider = createGatewayProvider({
    enabled: true,
    baseUrl: "https://llm.telecom.kz/v1",
    model: "synthetic-only",
    getToken: () => "synthetic-token-not-a-secret",
    fetcher: (async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const data = JSON.parse(request.messages[1].content);
      const criteria = data.checklist.criteria as Checklist["criteria"];
      requested.push({ version: data.checklist.version, ids: criteria.map((item) => item.id) });
      // Derive fake answers from the actual transmitted rules; no network or environment access.
      const raw = { results: criteria.map((criterion) => ({
        criterion_id: criterion.id, status: "scored",
        value: criterion.type === "flag" ? false : criterion.type === "scale" ? 1 : true,
        reason: "Synthetic answer from the current criterion.",
        evidence_ids: [data.transcript[0].id], evidence_kind: "messages",
      })) };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  const f = await fixture(t, { allowEvaluation: true, evaluate: provider.evaluate });
  async function analyze() {
    assert.equal((await f.post("/api/evaluations", { recordId: record.id, checklistId: rules.id })).status, 202);
    const state = await settled(f.store);
    assert.equal(state.conversations[0].status, "evaluated");
    return state;
  }
  const firstState = await analyze();
  const first = structuredClone(firstState.evaluations[0]);
  assert.equal(first.total, 100);

  const added = structuredClone(firstState.checklists[0]);
  added.criteria[0].weight = 70;
  added.criteria.push({
    id: "new-scale", name: "Уточнение следующего шага", description: "Синтетическое новое правило.",
    type: "scale", weight: 30, allowNA: false, naCondition: "",
    scale: [{ value: 0, label: "Нет" }, { value: 1, label: "Частично" }, { value: 2, label: "Да" }],
  });
  assert.equal((await f.post("/api/checklists", added)).status, 200);
  const secondState = await analyze();
  const second = structuredClone(secondState.evaluations[1]);
  assert.equal(second.checklist.version, 2);
  assert.deepEqual(second.results.map((item) => [item.criterionId, item.points]), [["clear", 70], ["flag", null], ["new-scale", 15]]);
  assert.equal(second.total, 85);

  // Current weight denominator is 20, not the old 100; removed criteria must disappear.
  const removed = structuredClone(secondState.checklists[0]);
  removed.criteria = removed.criteria.filter((criterion) => criterion.id !== "clear");
  removed.criteria.find((criterion) => criterion.id === "new-scale")!.weight = 20;
  assert.equal((await f.post("/api/checklists", removed)).status, 200);
  const thirdState = await analyze();
  const third = thirdState.evaluations[2];
  assert.equal(third.checklist.version, 3);
  assert.deepEqual(third.results.map((item) => [item.criterionId, item.points]), [["flag", null], ["new-scale", 50]]);
  assert.equal(third.total, 50);
  assert.deepEqual(requested, [
    { version: 1, ids: ["clear", "flag"] },
    { version: 2, ids: ["clear", "flag", "new-scale"] },
    { version: 3, ids: ["flag", "new-scale"] },
  ]);
  assert.deepEqual(thirdState.evaluations[0], first);
  assert.deepEqual(thirdState.evaluations[1], second);
  const served = await (await fetch(`${f.base}/api/workspace`)).json() as Workspace;
  assert.deepEqual(served.evaluations, JSON.parse(JSON.stringify(thirdState.evaluations)));
});

test("custom checklist improvement uses its saved snapshot even after rules are edited", async (t) => {
  let received: Evaluation | undefined;
  const f = await fixture(t, { allowImprovement: true, improve: async ({ evaluation }) => {
    received = structuredClone(evaluation);
    return "Синтетический пример по сохранённым правилам.";
  } });
  const original = await seedClassifiableEvaluation(f.store);
  await f.store.mutate(draft => {
    draft.evaluations[0].provenance = { promptVersion: "dynamic-checklist-v1", model: "synthetic", transcriptHash: "a".repeat(64) };
    draft.checklists[0].version += 1;
    draft.checklists[0].criteria[0].description = "Different future rule";
  });
  const response = await f.post(`/api/evaluations/${encodeURIComponent(original.id)}/improvement`, {});
  assert.equal(response.status, 200);
  assert.deepEqual(received?.checklist, original.checklist);
  const updated = f.store.snapshot().evaluations[0];
  assert.equal(updated.total, original.total);
  assert.deepEqual(updated.results, original.results);
  assert.equal(updated.improvement?.promptVersion, "dynamic-checklist-v1/conversation_improvement");
});

test("URL import merges a control group idempotently with audio and preserves saved evaluations", async (t) => {
  let gatewayCalls = 0, downloads = 0;
  const source = rawDataset("CONTROL");
  const incoming = source.data.records[0] as { channel: string; audio_url: string | null; transcript: { timestamp: string; speaker: string; text: string }[] };
  incoming.channel = "voice call";
  incoming.audio_url = "https://audio.example.test/control.mp3";
  incoming.transcript[0].timestamp = "2026-11-08T13:10:00+05:00";
  const importer = createDatasetImporter({
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    transport: async (url) => {
      downloads++;
      assert.equal(url.searchParams.get("group_id"), "CONTROL");
      return { statusCode: 200, headers: {}, body: (async function* () { yield Buffer.from(JSON.stringify(source)); })() };
    },
  });
  const f = await fixture(t, { importDatasetUrl: importer, evaluate: async () => { gatewayCalls++; throw new Error("Forbidden model call"); } });
  await seedClassifiableEvaluation(f.store);
  const before = f.store.snapshot();
  const payload = { url: "https://datasets.example.test/api?group_id=DEV&signature=private-api-signature", groupId: "CONTROL" };
  for (let i = 0; i < 2; i++) {
    const response = await f.post("/api/datasets/import-url", payload);
    assert.equal(response.status, 200);
    const state = await response.json() as Workspace;
    assert.equal(state.conversations.length, 2);
    const imported = state.conversations.find((item) => item.groupId === "CONTROL")!;
    assert.equal(imported.audioUrl, incoming.audio_url);
    assert.equal(imported.messages[0].timestamp, incoming.transcript[0].timestamp);
    assert.deepEqual(state.evaluations, JSON.parse(JSON.stringify(before.evaluations)));
    assert.deepEqual(state.appeals, before.appeals);
    assert.ok(!JSON.stringify(state).includes("private-api-signature"));
  }
  const saved = f.store.snapshot();
  incoming.transcript[0].text = "Changed remote content with the same ID";
  assert.equal((await f.post("/api/datasets/import-url", payload)).status, 409);
  assert.deepEqual(f.store.snapshot(), saved);
  assert.equal(downloads, 3);
  assert.equal(gatewayCalls, 0);
});

test("URL import errors are safe and leave workspace untouched", async (t) => {
  const disabled = await fixture(t);
  assert.equal((await disabled.post("/api/datasets/import-url", { url: "https://example.test/api" })).status, 503);
  for (const typed of [true, false]) {
    const f = await fixture(t, { importDatasetUrl: async () => {
      throw typed ? new DatasetImportError("DATASET_TIMEOUT") : new Error("secret signed API URL and response");
    } });
    const before = f.store.snapshot();
    const response = await f.post("/api/datasets/import-url", { url: "https://example.test/api?token=secret" });
    assert.equal(response.status, typed ? 504 : 502);
    const error = await response.json();
    assert.equal(error.code, typed ? "DATASET_TIMEOUT" : "DATASET_FETCH_FAILED");
    assert.ok(!JSON.stringify(error).includes("secret"));
    assert.deepEqual(f.store.snapshot(), before);
  }
});

test("official JSON file IDs survive import, group isolation and scoring without changing existing results", async (t) => {
  const f = await fixture(t, { allowEvaluation: true, evaluate: async ({ conversation, checklist }) =>
    scoreModelOutput(conversation, checklist, { results: checklist.criteria.map((criterion) => ({
      criterion_id: criterion.id, status: "scored", value: criterion.type === "flag" ? false : true,
      reason: "Synthetic checked rule.", evidence_ids: [conversation.messages[0].id], evidence_kind: "messages",
    })) }),
  });
  await seedClassifiableEvaluation(f.store);
  const original = structuredClone(f.store.snapshot().evaluations);
  const source = rawDataset("CONTROL");
  const externalId = "界".repeat(300);
  source.data.records[0].conversation_id = externalId;
  const recordId = `CONTROL:${encodeURIComponent(externalId)}`;
  for (let repeat = 0; repeat < 2; repeat++)
    assert.equal((await f.post("/api/datasets/upload", source)).status, 200);
  const other = structuredClone(source);
  other.data.dataset_group_id = "OTHER";
  assert.equal((await f.post("/api/datasets/upload", other)).status, 200);
  assert.equal(f.store.snapshot().conversations.length, 3);
  assert.equal(f.store.snapshot().conversations.find((item) => item.id === recordId)!.externalId, externalId);
  assert.equal((await f.post("/api/evaluations", { recordId, checklistId: rules.id })).status, 202);
  for (let i = 0; i < 200 && f.store.snapshot().conversations.find((item) => item.id === recordId)!.status === "evaluating"; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  const state = f.store.snapshot();
  const scored = state.evaluations.find((item) => item.recordId === recordId)!;
  assert.ok(scored);
  assert.equal(scored.total, 100);
  assert.equal(scored.results[0].evidence[0].messageIds[0], `${recordId}:m0`);
  assert.deepEqual(state.evaluations.filter((item) => item.recordId !== recordId), original);
  const served = await (await fetch(`${f.base}/api/workspace`)).json() as Workspace;
  assert.equal(served.conversations.find((item) => item.id === recordId)!.externalId, externalId);
  source.data.records[0].transcript[0].text = "Changed source under same original ID";
  assert.equal((await f.post("/api/datasets/upload", source)).status, 409);
  assert.deepEqual(f.store.snapshot(), state);
});

test("official submission endpoint returns direct document without invoking evaluator and gives actionable validation errors", async (t) => {
  let calls = 0;
  const f = await fixture(t, { submissionModelName: "configured-only", evaluate: async (input) => { calls++; return outcome(input); } });
  await f.store.mutate((draft) => {
    draft.conversations = Array.from({ length: 10 }, (_, i) => ({ ...structuredClone(record), id: `PROD:${i}`, externalId: `external-${i}`, groupId: "PROD", status: "unrated", demo: false }));
  });
  const response = await f.post("/api/exports/submission", { groupId: "PROD", teamName: "Amazing Guys", expectedCount: 10 });
  assert.equal(response.status, 200);
  const document = await response.json();
  assert.equal(document.schema_version, "1.0"); assert.equal(document.results.length, 10);
  assert.equal(document.model.name, "configured-only"); assert.equal(document.conversations, undefined);
  assert.ok(document.results.every((r: { status: string }) => r.status === "error"));
  const bad = await f.post("/api/exports/submission", { groupId: "PROD", teamName: "Amazing Guys", expectedCount: 65 });
  assert.equal(bad.status, 422); assert.equal((await bad.json()).code, "SUBMISSION_INVALID");
  assert.equal(calls, 0);
});
