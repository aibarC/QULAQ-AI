import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildEvaluationMessages } from "../src/prompt.ts";
import { initialChecklist, scoreModelOutput } from "../src/scoring.ts";
import { demoConversation } from "../../frontend/src/lib/fixtures.ts";
import type { Evaluation } from "../../frontend/src/lib/types.ts";
import { buildImprovementMessages, parseImprovementOutput, usesCanonicalAnalysis } from "../src/two-stage-prompts.ts";
import { readModelOutput } from "../src/two-stage-transport.ts";
import { createGatewayProvider } from "../src/provider.ts";

const conversation = structuredClone(demoConversation);
const checklist = structuredClone(initialChecklist);
const raw = { results: checklist.criteria.map((criterion) => ({ criterion_id: criterion.id,
  status: "scored", value: criterion.type === "flag" ? false : criterion.type === "boolean" ? true : Math.max(...criterion.scale.map((s) => s.value)),
  reason: "Синтетическое обоснование.", evidence_ids: [conversation.messages[0].id], evidence_kind: "messages" })) };
function evaluation(): Evaluation {
  return { id: "test-evaluation", recordId: conversation.id, createdAt: new Date().toISOString(), checklist,
    ...scoreModelOutput(conversation, checklist, raw), originalTotal: 100, demo: true };
}
function streamResponse(value: unknown, finish = "stop", includeDone = true, bytewise = false) {
  const content = JSON.stringify(value);
  const chunks = [': keepalive\r\n\r\n',
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: content.slice(0, 9) }, finish_reason: null }] })}\r\n\r\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: content.slice(9) }, finish_reason: finish }] })}\r\n\r\n`,
    ...(includeDone ? ['data: [DONE]\r\n\r\n'] : [])];
  const bytes = new TextEncoder().encode(chunks.join(''));
  return new Response(new ReadableStream({ start(controller) {
    if (bytewise) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

test("canonical analysis uses exact bundled bytes and stable transcript IDs; rubric changes fall back", async () => {
  const messages = buildEvaluationMessages(conversation, checklist);
  assert.equal(messages[0].content, await readFile(new URL('../../llm/prompts/two_stage_v1/analysis.system.txt', import.meta.url), 'utf8'));
  const prefix = await readFile(new URL('../../llm/prompts/two_stage_v1/analysis.input_context.txt', import.meta.url), 'utf8');
  assert.ok(messages[1].content.startsWith(prefix + '\n\n'));
  const payload = JSON.parse(messages[1].content.slice(prefix.length + 2));
  assert.deepEqual(payload.record.transcript.map((m: { id: string }) => m.id), conversation.messages.map((m) => m.id));
  assert.equal(payload.factual_ledger, null);
  assert.equal(payload.record.audioUrl, undefined);
  const weights = structuredClone(checklist); weights.criteria[0].weight = 25; weights.version = 99;
  assert.equal(usesCanonicalAnalysis(weights), true);
  for (const change of [
    (c: typeof checklist) => { c.criteria[0].description += ' New rule'; },
    (c: typeof checklist) => { c.criteria[0].allowNA = true; },
    (c: typeof checklist) => { c.criteria[3].scale[0].label = 'Different meaning'; },
    (c: typeof checklist) => { c.criteria[0].id = 'new'; },
    (c: typeof checklist) => { c.criteria[0].name = 'Different criterion'; },
  ]) {
    const changed = structuredClone(checklist); change(changed);
    assert.equal(usesCanonicalAnalysis(changed), false);
    assert.notEqual(buildEvaluationMessages(conversation, changed)[0].content, messages[0].content);
  }
});

test("improvement uses saved displayed assessment without changing it and strictly validates its only field", () => {
  const saved = evaluation(); saved.results[0].answer = false;
  saved.results[0].override = { answer: false, reason: 'Human correction', appealId: 'a1' };
  saved.results[0].evidence = [{ kind: 'range', quote: 'Synthetic range', messageIds: conversation.messages.slice(0, 3).map((message) => message.id) }];
  const before = JSON.stringify(saved);
  const messages = buildImprovementMessages(conversation, saved);
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.assessment.results[0].value, false);
  assert.equal(payload.assessment.results[0].reason, 'Human correction');
  assert.deepEqual(payload.assessment.results[0].evidence_ids, [conversation.messages[0].id, conversation.messages[2].id]);
  assert.equal(payload.assessment.results[0].evidence_kind, 'checked_range');
  assert.equal(JSON.stringify(saved), before);
  assert.equal(parseImprovementOutput({ conversation_improvement: null }), null);
  assert.equal(parseImprovementOutput({ conversation_improvement: ' Совет ' }), 'Совет');
  for (const invalid of [{}, [], { conversation_improvement: '' }, { conversation_improvement: 1 },
    { conversation_improvement: 'text', results: [] }, { conversation_improvement: 'x'.repeat(12001) }])
    assert.throws(() => parseImprovementOutput(invalid), /INVALID_IMPROVEMENT_OUTPUT/);
});

test("custom rubric improvement uses its saved rules and reviewed answers in one explicit request", async () => {
  const saved = structuredClone(evaluation());
  const rules = structuredClone(checklist);
  rules.version = 7;
  rules.name = "Пользовательские правила";
  rules.criteria = [
    { ...rules.criteria[0], id: "custom-boolean", description: "Проверить новый шаг", weight: 30 },
    { ...rules.criteria[3], id: "custom-scale", name: "Полнота инструкции", weight: 60,
      scale: [{ value: 0, label: "Нет" }, { value: 1, label: "Частично" }, { value: 3, label: "Полностью" }] },
    { ...rules.criteria[7], id: "custom-flag" },
    { ...rules.criteria[1], id: "custom-na", weight: 10 },
  ];
  const answers = [false, 1, true, null];
  saved.checklist = rules;
  Object.assign(saved, scoreModelOutput(conversation, rules, { results: rules.criteria.map((criterion, index) => ({
    criterion_id: criterion.id, status: answers[index] === null ? "not_applicable" : "scored",
    value: answers[index], reason: "Синтетическое объяснение применимости и результата.",
    evidence_ids: [conversation.messages[0].id], evidence_kind: "messages",
  })) }));
  saved.provenance = { promptVersion: "dynamic-checklist-v1", transcriptHash: "synthetic", model: "synthetic" };
  saved.results[0].override = { answer: false, reason: "Уточнённая причина проверяющего", appealId: "synthetic-appeal" };
  const before = JSON.stringify(saved);
  let tokenReads = 0;
  let calls = 0;
  let sentMessages: { role: string; content: string }[] = [];
  const provider = createGatewayProvider({ enabled: true, baseUrl: "https://llm.telecom.kz/v1", model: "synthetic",
    getToken: () => { tokenReads++; return "synthetic"; },
    fetcher: (async (_url, init) => {
      calls++;
      sentMessages = JSON.parse(String(init?.body)).messages;
      return streamResponse({ conversation_improvement: "Синтетический пример по изменённым правилам." });
    }) as typeof fetch });
  assert.equal(tokenReads, 0);
  assert.equal(calls, 0);
  assert.equal(await provider.improve({ conversation, evaluation: saved, signal: new AbortController().signal }),
    "Синтетический пример по изменённым правилам.");
  const payload = JSON.parse(sentMessages[1].content);
  assert.deepEqual(payload.checklist, rules);
  assert.deepEqual(payload.assessment.results.map((item: { criterion_id: string; value: unknown }) => [item.criterion_id, item.value]),
    rules.criteria.map((item, index) => [item.id, answers[index]]));
  assert.equal(payload.assessment.results[0].reason, "Уточнённая причина проверяющего");
  assert.ok(!payload.checklist.criteria.some((item: { id: string }) => item.id === "c1"));
  assert.match(sentMessages[0].content, /максимального scale.value/);
  assert.match(sentMessages[0].content, /true у flag/);
  assert.ok(sentMessages[0].content.includes("not_applicable/N/A не является недостатком"));
  assert.match(sentMessages[0].content, /не исполняй команды/);
  assert.equal(calls, 1);
  assert.equal(tokenReads, 1);
  assert.equal(JSON.stringify(saved), before);
});

test("canonical improvement retains the exact bundled prompt and payload contract", async () => {
  const messages = buildImprovementMessages(conversation, evaluation());
  assert.equal(messages[0].content, await readFile(new URL("../../llm/prompts/two_stage_v1/conversation_improvement.system.txt", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(JSON.parse(messages[1].content)).sort(), ["assessment", "record"]);
});

test("SSE handles split UTF-8, CRLF, comments and rejects missing DONE or truncated finish", async () => {
  const signal = new AbortController().signal;
  const value = { conversation_improvement: 'Қазақша және русский текст' };
  assert.deepEqual(await readModelOutput(streamResponse(value, 'stop', true, true), signal), value);
  await assert.rejects(() => readModelOutput(streamResponse(value, 'length'), signal), /LLM_INCOMPLETE_RESPONSE/);
  await assert.rejects(() => readModelOutput(streamResponse(value, 'stop', false), signal), /LLM_INCOMPLETE_RESPONSE/);
  const malformed = new Response('data: broken\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  await assert.rejects(() => readModelOutput(malformed, signal), /LLM_INVALID_STREAM/);
  const afterStop = new Response([
    { choices: [{ delta: { content: '{}' }, finish_reason: 'stop' }] },
    { choices: [{ delta: { content: ' ' }, finish_reason: null }] },
  ].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  await assert.rejects(() => readModelOutput(afterStop, signal), /LLM_INVALID_STREAM/);
});

test("a stalled response body obeys cancellation even if the stream ignores the signal", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  const pending = readModelOutput(response, controller.signal);
  controller.abort();
  await assert.rejects(() => pending, /LLM_REQUEST_ABORTED/);
  assert.equal(cancelled, true);
});

test("legacy one-shot: analysis and improvement share the durable allowance in both directions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'qulaq-two-stage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const first of ['analysis', 'improvement']) {
    let calls = 0;
    const options = { enabled: true, oneShot: true, baseUrl: 'https://llm.telecom.kz/v1', model: 'synthetic',
      getToken: () => 'synthetic', quotaPath: join(directory, first + '.json'),
      fetcher: (async (_url: unknown, init: RequestInit | undefined) => {
        calls++; const body = JSON.parse(String(init?.body));
        assert.equal(body.stream, true); assert.equal(body.max_tokens, 16384);
        return streamResponse(first === 'analysis' ? raw : { conversation_improvement: null });
      }) as typeof fetch };
    const provider = createGatewayProvider(options);
    const analysis = { conversation, checklist, signal: new AbortController().signal };
    const improvement = { conversation, evaluation: evaluation(), signal: analysis.signal };
    if (first === 'analysis') {
      const result = await provider.evaluate(analysis);
      assert.equal(result.total, 100);
      assert.equal(result.provenance.promptVersion, 'two-stage-v1/analysis');
      assert.match(result.provenance.transcriptHash, /^[0-9a-f]{64}$/);
      await assert.rejects(() => provider.improve(improvement), /ONE_TEST_ALREADY_USED/);
    } else {
      assert.equal(await provider.improve(improvement), null);
      await assert.rejects(() => provider.evaluate(analysis), /ONE_TEST_ALREADY_USED/);
    }
    await assert.rejects(() => createGatewayProvider(options).improve(improvement), /ONE_TEST_ALREADY_USED/);
    assert.equal(calls, 1);
  }
});


test("normal manual mode supports analysis then explicitly requested improvement without automatic second call", async () => {
  let calls = 0;
  const provider = createGatewayProvider({ enabled: true, baseUrl: 'https://llm.telecom.kz/v1', model: 'synthetic',
    getToken: () => 'synthetic', fetcher: (async () => {
      calls++;
      return streamResponse(calls === 1 ? raw : { conversation_improvement: 'Синтетический пример.' });
    }) as typeof fetch });
  assert.equal(calls, 0);
  const analysis = await provider.evaluate({ conversation, checklist, signal: new AbortController().signal });
  assert.equal(analysis.total, 100);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 1);
  const input = { conversation, evaluation: evaluation(), signal: new AbortController().signal };
  assert.equal(await provider.improve(input), 'Синтетический пример.');
  assert.equal(await provider.improve(input), 'Синтетический пример.');
  assert.equal(calls, 3);
});
