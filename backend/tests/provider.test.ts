import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGatewayEvaluator } from "../src/provider.ts";
import { getRuntimeConfig } from "../src/config.ts";
import { demoConversation } from "../../frontend/src/lib/fixtures.ts";
import { initialChecklist } from "../src/scoring.ts";

// No dotenv loader or runtime entrypoint is imported. Even an accidental omitted
// fetcher must fail locally; this suite can never contact the gateway.
const networkGuard = mock.method(globalThis, "fetch", async () => {
  throw new Error(
    "Unexpected real fetch: provider tests require an injected fetcher",
  );
});
after(() => networkGuard.mock.restore());

const conversation = structuredClone(demoConversation);
const checklist = structuredClone(initialChecklist);
const input = () => ({
  conversation,
  checklist,
  signal: new AbortController().signal,
});
const validRaw = () => ({
  results: checklist.criteria.map((criterion) => ({
    criterion_id: criterion.id,
    status: "scored",
    value:
      criterion.type === "flag"
        ? false
        : criterion.type === "boolean"
          ? true
          : Math.max(...criterion.scale.map((option) => option.value)),
    reason: "Синтетическое объяснение для теста провайдера.",
    evidence_ids: [conversation.messages[0].id],
    evidence_kind: "messages",
  })),
});
const response = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validRaw()) } }],
    }),
  );
const options = (quotaPath: string, fetcher: typeof fetch) => ({
  enabled: true,
  baseUrl: "https://llm.telecom.kz/v1",
  model: "synthetic-test-model",
  getToken: () => "test-token-not-real",
  quotaPath,
  fetcher,
});

test("evaluation defaults disabled before token retrieval or any fetch", async () => {
  let tokenReads = 0;
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return response();
  }) as typeof fetch;
  for (const enabled of [undefined, false]) {
    const evaluator = createGatewayEvaluator({
      ...options("/unused-disabled-quota", fetcher),
      enabled,
      getToken: () => {
        tokenReads++;
        return "test-token-not-real";
      },
    });
    await assert.rejects(() => evaluator(input()), /EVALUATION_DISABLED/);
  }
  assert.equal(tokenReads, 0);
  assert.equal(calls, 0);
  assert.equal(networkGuard.mock.callCount(), 0);
});

test("runtime config is unarmed by default and rejects invalid local ports", () => {
  assert.equal(getRuntimeConfig([]).allowEvaluation, false);
  assert.equal(getRuntimeConfig([]).host, "127.0.0.1");
  assert.equal(getRuntimeConfig(["--port=8001"]).port, 8001);
  assert.equal(
    getRuntimeConfig(["--allow-one-llm-request"]).allowEvaluation,
    true,
  );
  for (const port of ["0", "80", "65536", "NaN", "8000.5"]) {
    assert.throws(
      () => getRuntimeConfig([`--port=${port}`]),
      /Invalid local port/,
    );
  }
});

test("invalid URL, missing model, cancellation and oversized transcript reject before token/fetch", async () => {
  let tokenReads = 0;
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return response();
  }) as typeof fetch;
  const base = {
    ...options("/unused-invalid-quota", fetcher),
    getToken: () => {
      tokenReads++;
      return "test-token-not-real";
    },
  };
  for (const baseUrl of [
    "http://llm.telecom.kz/v1",
    "https://example.invalid/v1",
    "https://llm.telecom.kz/v2",
    "https://llm.telecom.kz:8443/v1",
    "https://llm.telecom.kz/v1?query=1",
    "not-a-url",
  ]) {
    await assert.rejects(() =>
      createGatewayEvaluator({ ...base, baseUrl })(input()),
    );
  }
  for (const model of ["", "   ", "x".repeat(201)]) {
    await assert.rejects(
      () => createGatewayEvaluator({ ...base, model })(input()),
      /LLM_MODEL_REQUIRED/,
    );
  }
  await assert.rejects(
    () =>
      createGatewayEvaluator(base)({ ...input(), signal: AbortSignal.abort() }),
    /EVALUATION_CANCELLED/,
  );
  for (const messages of [
    [],
    [{ ...conversation.messages[0], text: " \n\t " }],
  ]) {
    await assert.rejects(
      () =>
        createGatewayEvaluator(base)({
          ...input(),
          conversation: { ...conversation, messages },
        }),
      /EMPTY_TRANSCRIPT/,
    );
  }
  const large = structuredClone(conversation);
  large.messages[0].text = "x".repeat(200_001);
  await assert.rejects(
    () => createGatewayEvaluator(base)({ ...input(), conversation: large }),
    /TRANSCRIPT_TOO_LARGE_FOR_MODEL/,
  );
  assert.equal(tokenReads, 0);
  assert.equal(calls, 0);
});

test("one enabled synthetic request succeeds, sends no redirect/retry, and persists only a quota receipt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "qulaq-provider-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const quotaPath = join(directory, "quota.json");
  let calls = 0;
  const fetcher = (async (url, init) => {
    calls++;
    assert.equal(String(url), "https://llm.telecom.kz/v1/chat/completions");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "synthetic-test-model");
    assert.equal(body.temperature, 0);
    assert.ok(Array.isArray(body.messages));
    return response();
  }) as typeof fetch;
  const evaluator = createGatewayEvaluator(options(quotaPath, fetcher));
  const result = await evaluator(input());
  assert.equal(result.total, 100);
  assert.equal(result.results.length, checklist.criteria.length);
  await assert.rejects(() => evaluator(input()), /ONE_TEST_ALREADY_USED/);
  assert.equal(calls, 1);
  const receipt = JSON.parse(await readFile(quotaPath, "utf8"));
  assert.deepEqual(Object.keys(receipt), ["consumedAt"]);
  assert.ok(Number.isFinite(Date.parse(receipt.consumedAt)));
});

test(
  "concurrent instances and a restarted evaluator cannot spend a second request",
  { timeout: 5000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "qulaq-provider-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const quotaPath = join(directory, "quota.json");
    let calls = 0;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = (async () => {
      calls++;
      started();
      await gate;
      return response();
    }) as typeof fetch;
    const first = createGatewayEvaluator(options(quotaPath, fetcher));
    const result = first(input());
    try {
      await requested;
      await assert.rejects(() => first(input()), /ONE_TEST_ALREADY_USED/);
      await assert.rejects(
        () => createGatewayEvaluator(options(quotaPath, fetcher))(input()),
        /ONE_TEST_ALREADY_USED/,
      );
    } finally {
      release();
    }
    await result;
    await assert.rejects(
      () => createGatewayEvaluator(options(quotaPath, fetcher))(input()),
      /ONE_TEST_ALREADY_USED/,
    );
    assert.equal(calls, 1);
  },
);

test("failed or unusable provider responses consume the allowance without a retry", async (t) => {
  const failures: Array<[string, () => Promise<Response>, RegExp]> = [
    [
      "network",
      async () => {
        throw new Error("synthetic network failure");
      },
      /LLM_REQUEST_FAILED_NO_RETRY/,
    ],
    [
      "http",
      async () => new Response("synthetic error", { status: 503 }),
      /LLM_RESPONSE_REJECTED_NO_RETRY/,
    ],
    [
      "redirect",
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.invalid" },
        }),
      /LLM_RESPONSE_REJECTED_NO_RETRY/,
    ],
    [
      "json",
      async () => new Response("invalid-json"),
      /LLM_INVALID_JSON_RESPONSE/,
    ],
    [
      "oversized",
      async () => new Response("x".repeat(2_000_001)),
      /LLM_RESPONSE_TOO_LARGE/,
    ],
  ];
  for (const [name, fail, expected] of failures)
    await t.test(name, async (t) => {
      const directory = await mkdtemp(join(tmpdir(), "qulaq-provider-test-"));
      t.after(() => rm(directory, { recursive: true, force: true }));
      const quotaPath = join(directory, "quota.json");
      let calls = 0;
      const fetcher = (async () => {
        calls++;
        return fail();
      }) as typeof fetch;
      await assert.rejects(
        () => createGatewayEvaluator(options(quotaPath, fetcher))(input()),
        expected,
      );
      await assert.rejects(
        () => createGatewayEvaluator(options(quotaPath, fetcher))(input()),
        /ONE_TEST_ALREADY_USED/,
      );
      assert.equal(calls, 1);
    });
});
