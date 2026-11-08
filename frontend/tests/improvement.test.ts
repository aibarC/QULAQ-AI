import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdapterStateError, createApiAdapter, createLocalAdapter } from "../src/lib/adapter.ts";
import { parseWorkspace } from "../src/lib/validation.ts";
import { defaultChecklist, demoConversation, makeDemoEvaluation } from "../src/lib/fixtures.ts";
import type { Workspace } from "../src/lib/types.ts";
import ConversationImprovement from "../src/components/ConversationImprovement.tsx";

function workspace(): Workspace {
  return { conversations: [structuredClone(demoConversation)], checklists: [structuredClone(defaultChecklist)],
    evaluations: [makeDemoEvaluation(defaultChecklist)], appeals: [],
    capabilities: { evaluationEnabled: true, improvementEnabled: true } };
}
const improvement = { text: "Сначала уточните потребность.", assessmentFingerprint: "a".repeat(64), createdAt: new Date().toISOString(), promptVersion: "two-stage-v1" };

test("workspace roundtrip retains separate recommendation and provenance, rejects invalid metadata", () => {
  const state = workspace();
  state.evaluations[0].improvement = improvement;
  state.evaluations[0].provenance = { promptVersion: "two-stage-v1", transcriptHash: "b".repeat(64), model: "synthetic" };
  const before = structuredClone(state.evaluations[0].results);
  const parsed = parseWorkspace(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(parsed.evaluations[0].improvement, improvement);
  assert.deepEqual(parsed.evaluations[0].results, before);
  assert.deepEqual(parsed.capabilities, state.capabilities);
  state.evaluations[0].improvement = { ...improvement, text: null };
  assert.equal(parseWorkspace(state).evaluations[0].improvement?.text, null);
  state.evaluations[0].improvement.assessmentFingerprint = "bad";
  assert.throws(() => parseWorkspace(state));
});

test("improvement adapter makes one explicit POST; server failure reconciles without retry or fabricated null", async () => {
  const state = workspace();
  const requests: string[] = [];
  const api = createApiAdapter("/api", (async (url, options) => {
    requests.push(`${options?.method} ${url}`);
    if (options?.method === "POST") return new Response("{}", { status: 503 });
    return Response.json(state);
  }) as typeof fetch);
  await assert.rejects(api.improveConversation("evaluation:one"), (error: unknown) => {
    assert.ok(error instanceof AdapterStateError);
    assert.equal(error.workspace.evaluations[0].improvement, undefined);
    assert.deepEqual(error.workspace.evaluations[0].results, state.evaluations[0].results);
    return true;
  });
  assert.deepEqual(requests, ["POST /api/evaluations/evaluation%3Aone/improvement", "GET /api/workspace"]);
  await assert.rejects(createLocalAdapter({ storage: null }).improveConversation("x"), /подключите сервер/);
});

test("separate recommendation renders disabled state, escaped text and explicit model null", () => {
  const evaluation = workspace().evaluations[0];
  const render = () => renderToStaticMarkup(createElement(ConversationImprovement, { evaluation, enabled: false, busy: false, onGenerate: async () => {}, onRefresh: () => {} }));
  assert.match(render(), /disabled/);
  assert.match(render(), /отключена на сервере/);
  evaluation.improvement = { ...improvement, text: "<script>alert(1)</script>" };
  assert.match(render(), /&lt;script&gt;/);
  assert.doesNotMatch(render(), /<script>/);
  evaluation.improvement.text = null;
  assert.match(render(), /Модель не предложила улучшений/);
});

test("custom rubric recommendation is available when gateway is enabled", () => {
  const evaluation = workspace().evaluations[0];
  evaluation.provenance = { promptVersion: "dynamic-checklist-v1", transcriptHash: "a".repeat(64), model: "synthetic" };
  const html = renderToStaticMarkup(createElement(ConversationImprovement, { evaluation, enabled: true, busy: false, onGenerate: async () => {}, onRefresh: () => {} }));
  assert.doesNotMatch(html, /disabled/);
  assert.match(html, /Показать пример/);
});
