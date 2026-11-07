import test from "node:test";
import assert from "node:assert/strict";
import {
  AdapterStateError,
  createApiAdapter,
  createLocalAdapter,
} from "../src/lib/adapter.ts";
import { defaultChecklist, demoConversation } from "../src/lib/fixtures.ts";
import type { Workspace } from "../src/lib/types.ts";

async function previouslyEvaluated() {
  const local = createLocalAdapter({ storage: null, delay: 0 });
  return local.evaluate(demoConversation.id, defaultChecklist.id);
}

test("a delayed queue refresh cannot replace the newer baseline used to confirm an analysis", async () => {
  const old = await previouslyEvaluated();
  const newer = structuredClone(old);
  newer.evaluations[0].id = "newer-run";
  let requests = 0;
  let release!: (value: Response) => void;
  const api = createApiAdapter("/api", async () => {
    requests++;
    if (requests === 2)
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    return new Response(JSON.stringify(requests === 1 ? old : newer));
  });
  await api.load();
  const slowRefresh = api.load();
  await api.load();
  release(new Response(JSON.stringify(old)));
  await slowRefresh;
  await assert.rejects(
    api.evaluate(demoConversation.id, defaultChecklist.id),
    /новую оценку/,
  );
  assert.equal(requests, 4);
});

function queuedApi(states: Workspace[]) {
  const calls: string[] = [];
  const api = createApiAdapter(
    "/api",
    (async (_url, options) => {
      const state = states[calls.length];
      calls.push(options?.method ?? "GET");
      assert.ok(state, "Unexpected request: the adapter must not retry POST");
      return new Response(JSON.stringify(state));
    }) as typeof fetch,
    { pollIntervalMs: 0, evaluationTimeoutMs: 500 },
  );
  return { api, calls };
}

async function rejectsStale(states: Workspace[]) {
  const { api, calls } = queuedApi(states);
  await assert.rejects(
    () => api.evaluate(demoConversation.id, defaultChecklist.id),
    (error) => {
      assert.ok(error instanceof AdapterStateError);
      assert.match(error.message, /новую оценку/);
      assert.deepEqual(error.workspace, states.at(-1));
      assert.equal(error.outcomeUnknown, false);
      return true;
    },
  );
  assert.equal(calls.filter((method) => method === "POST").length, 1);
  return calls;
}

test("an evaluated conversation with only its old result is not a successful new analysis", async () => {
  const baseline = await previouslyEvaluated();
  assert.deepEqual(await rejectsStale([baseline, baseline]), ["GET", "POST"]);
  const pending = structuredClone(baseline);
  pending.conversations[0].status = "evaluating";
  assert.deepEqual(await rejectsStale([baseline, pending, baseline]), [
    "GET",
    "POST",
    "GET",
  ]);
});

test("a new matching run succeeds even when its answers and score equal the previous run", async () => {
  const baseline = await previouslyEvaluated();
  const completed = structuredClone(baseline);
  completed.evaluations.push({
    ...structuredClone(baseline.evaluations[0]),
    id: "new-matching-run",
  });
  const { api, calls } = queuedApi([baseline, completed]);
  const result = await api.evaluate(demoConversation.id, defaultChecklist.id);
  assert.equal(result.evaluations.at(-1)?.id, "new-matching-run");
  assert.deepEqual(calls, ["GET", "POST"]);
});

test("a new result for another checklist or another conversation cannot confirm the requested analysis", async () => {
  const baseline = await previouslyEvaluated();
  const otherChecklist = structuredClone(baseline);
  otherChecklist.evaluations.push({
    ...structuredClone(baseline.evaluations[0]),
    id: "another-checklist-run",
    checklist: { ...structuredClone(defaultChecklist), id: "other-checklist" },
  });
  await rejectsStale([baseline, otherChecklist]);

  const otherConversation = structuredClone(baseline);
  otherConversation.conversations.push({
    ...structuredClone(demoConversation),
    id: "DEMO:other",
  });
  otherConversation.evaluations.push({
    ...structuredClone(baseline.evaluations[0]),
    id: "another-conversation-run",
    recordId: "DEMO:other",
  });
  await rejectsStale([baseline, otherConversation]);
});

test("an existing run observed while evaluating may complete with an updated result", async () => {
  const completed = await previouslyEvaluated();
  const pending = structuredClone(completed);
  pending.conversations[0].status = "evaluating";
  pending.evaluations[0].total = null;
  pending.evaluations[0].originalTotal = null;
  const { api, calls } = queuedApi([pending, pending, completed]);
  const result = await api.evaluate(demoConversation.id, defaultChecklist.id);
  assert.equal(result.evaluations[0].id, pending.evaluations[0].id);
  assert.equal(result.evaluations[0].total, 85);
  assert.deepEqual(calls, ["GET", "POST", "GET"]);
});

test("editing an already completed old run without observing evaluation cannot masquerade as a new run", async () => {
  const baseline = await previouslyEvaluated();
  const edited = structuredClone(baseline);
  edited.evaluations[0].results[0].explanation +=
    " Changed historical explanation.";
  await rejectsStale([baseline, edited]);
});
