import test from "node:test";
import assert from "node:assert/strict";
import { createApiAdapter, createLocalAdapter } from "../src/lib/adapter.ts";
import { defaultChecklist } from "../src/lib/fixtures.ts";
const workspace = { conversations: [], evaluations: [], appeals: [], checklists: [defaultChecklist] };

test("API URL import is one explicit POST with optional group and never an evaluation", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const adapter = createApiAdapter("/api", (async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json(workspace);
  }) as typeof fetch);
  await adapter.importDatasetUrl(" https://datasets.example.test/api?sig=synthetic ", " CONTROL ");
  assert.deepEqual(calls, [{ url: "/api/datasets/import-url", body: { url: "https://datasets.example.test/api?sig=synthetic", groupId: "CONTROL" } }]);
});

test("API import reports fixed safe errors, never reflects signed links or retries", async () => {
  let calls = 0;
  const adapter = createApiAdapter("/api", (async () => {
    calls++;
    return Response.json({ code: "DATASET_FETCH_FAILED", message: "secret signed link must not be displayed" }, { status: 502 });
  }) as typeof fetch);
  await assert.rejects(adapter.importDatasetUrl("https://datasets.example.test/api"), /API не вернул набор/);
  assert.equal(calls, 1);
  await assert.rejects(createLocalAdapter({storage:null}).importDatasetUrl("https://datasets.example.test/api"), /подключите локальный сервер/);
});
