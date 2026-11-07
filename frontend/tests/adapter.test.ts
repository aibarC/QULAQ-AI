import test from 'node:test';
import assert from 'node:assert/strict';
import { AdapterStateError, createApiAdapter, createLocalAdapter } from '../src/lib/adapter.ts';
import { demoConversation, defaultChecklist } from '../src/lib/fixtures.ts';
import { parseDataset, parseWorkspace, validateChecklist } from '../src/lib/validation.ts';

const input = { isSuccess: true, data: { dataset_group_id: 'DEV', total_records: 1, records: [{ conversation_id: 'conversation-1', language: 'RU', channel: 'agent chat', audio_url: null, transcript: [{ speaker: 'client', timestamp: '00:00', text: '<img src=x onerror=alert(1)>' }] }] } };
function memory() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, map };
}
const fetcher = async () => new Response(JSON.stringify(input));
const local = (storage = memory()) => createLocalAdapter({ storage, fetcher: fetcher as typeof fetch, delay: 0 });

test('DEV parsing preserves text, produces stable IDs and rejects dangerous audio schemes', () => {
  const first = parseDataset(input, 'DEV');
  const again = parseDataset(input, 'DEV');
  assert.deepEqual(first, again);
  assert.equal(first[0].messages[0].text, '<img src=x onerror=alert(1)>');
  const malicious = structuredClone(input);
  (malicious.data.records[0] as unknown as { audio_url: string }).audio_url = 'javascript:alert(1)';
  assert.throws(() => parseDataset(malicious, 'DEV'));
  assert.throws(() => parseDataset(input, 'CONTROL'));
});

test('real import is idempotent, has no fabricated evaluations and is never persisted', async () => {
  const storage = memory();
  const adapter = local(storage);
  await adapter.load();
  await adapter.importDataset('DEV');
  const result = await adapter.importDataset('DEV');
  assert.equal(result.conversations.length, 2);
  assert.equal(result.evaluations.length, 0);
  assert.equal(result.conversations.find(c => !c.demo)?.status, 'unrated');
  assert.ok(![...storage.map.values()].join('').includes('onerror'));
  await assert.rejects(() => adapter.evaluate('DEV:conversation-1', defaultChecklist.id), /подключите сервер/);
  assert.equal((await adapter.load()).evaluations.length, 0);
});

test('appeal cycle preserves original answer, resolves one shared appeal, and survives reload', async () => {
  const storage = memory();
  const adapter = local(storage);
  let state = await adapter.evaluate(demoConversation.id, defaultChecklist.id);
  const evaluationId = state.evaluations[0].id;
  assert.equal(state.evaluations[0].total, 85);
  state = await adapter.createAppeal(evaluationId, 'empathy', 'Фраза поддержки есть в сообщении 00:28.');
  const appealId = state.appeals[0].id;
  state = await adapter.createAppeal(evaluationId, 'empathy', 'Повторное обращение');
  assert.equal(state.appeals.length, 1);
  await assert.rejects(() => adapter.resolveAppeal(appealId, { action: 'change', answer: 100, reason: 'Причина' }));
  assert.equal((await adapter.load()).appeals[0].status, 'pending');
  state = await adapter.resolveAppeal(appealId, { action: 'change', answer: true, reason: 'Оператор выразил понимание ситуации.' });
  assert.equal(state.appeals[0].status, 'resolved');
  assert.equal(state.evaluations[0].total, 100);
  assert.equal(state.evaluations[0].originalTotal, 85);
  assert.equal(state.evaluations[0].results.find(r => r.criterionId === 'empathy')?.originalAnswer, false);
  assert.equal(state.evaluations[0].results.find(r => r.criterionId === 'empathy')?.answer, true);
  const reloaded = await local(storage).load();
  assert.deepEqual(reloaded, state);
  const another = await adapter.evaluate(demoConversation.id, defaultChecklist.id);
  assert.equal(another.evaluations.length, 2);
  assert.equal(another.evaluations[0].total, 100);
  assert.equal(another.evaluations[1].total, 85);
});

test('checklist editing creates a version without rewriting evaluation snapshots', async () => {
  const adapter = local();
  const original = await adapter.evaluate(demoConversation.id, defaultChecklist.id);
  const changed = structuredClone(original.checklists[0]);
  changed.criteria[0].description = 'Новая формулировка';
  const saved = await adapter.saveChecklist(changed);
  assert.equal(saved.checklists[0].version, 2);
  assert.equal(saved.evaluations[0].checklist.version, 1);
  assert.equal(saved.evaluations[0].checklist.criteria[0].description, defaultChecklist.criteria[0].description);
  await assert.rejects(() => adapter.saveChecklist(changed), /уже изменён/);
  const reevaluated = await adapter.evaluate(demoConversation.id, defaultChecklist.id);
  assert.equal(reevaluated.evaluations[1].total, null);
  assert.equal(reevaluated.evaluations[1].demo, true);
});

test('checklist form validation rejects invalid scales, missing N/A conditions and zero weights', () => {
  const checklist = structuredClone(defaultChecklist);
  checklist.criteria[0].weight = 0;
  assert.throws(() => validateChecklist(checklist));
  checklist.criteria[0].weight = 10;
  checklist.criteria[0].allowNA = true;
  assert.throws(() => validateChecklist(checklist));
  checklist.criteria[0].naCondition = 'Условие';
  checklist.criteria[3].scale.push({ ...checklist.criteria[3].scale[0] });
  assert.throws(() => validateChecklist(checklist));
});

test('API never falls back to mock on failure and restricts base URL to same-origin /api', async () => {
  assert.throws(() => createApiAdapter('https://evil.example/api'));
  const api = createApiAdapter('/api', (async () => new Response('{}', { status: 503 })) as typeof fetch);
  await assert.rejects(() => api.load(), /недоступен/);
  const malformed = createApiAdapter('/api', (async () => new Response(JSON.stringify({ conversations: [] }))) as typeof fetch);
  await assert.rejects(() => malformed.load(), /неизвестного формата/);
});

test('workspace validation rejects evidence pointing outside the selected conversation', async () => {
  const state = await local().evaluate(demoConversation.id, defaultChecklist.id);
  state.evaluations[0].results[0].evidence[0].messageIds = ['missing-message'];
  assert.throws(() => parseWorkspace(state), /отсутствующее сообщение/);
});

test('new and copied version-zero drafts save as version one while persisted schema stays strict', async () => {
  const adapter = local();
  const created = { ...structuredClone(defaultChecklist), id: 'new-checklist', name: 'Новый чек-лист', version: 0 };
  let state = await adapter.saveChecklist(created);
  assert.equal(state.checklists.find(c => c.id === created.id)?.version, 1);
  const copied = { ...structuredClone(defaultChecklist), id: 'copied-checklist', name: 'Копия чек-листа', version: 0 };
  state = await adapter.saveChecklist(copied);
  assert.equal(state.checklists.find(c => c.id === copied.id)?.version, 1);
  assert.equal(state.checklists.length, 3);
  assert.throws(() => validateChecklist(copied));
  await assert.rejects(() => adapter.saveChecklist({ ...copied, id: defaultChecklist.id }), /уже изменён/);
  state.checklists[0].version = 0;
  assert.throws(() => parseWorkspace(state));
});

test('API normalizes new version-zero drafts before sending and accepts server-confirmed v1', async () => {
  const draft = { ...structuredClone(defaultChecklist), id: 'new-api-checklist', version: 0 };
  let body: { version?: number } | undefined;
  const state = await local().load();
  state.checklists.push({ ...draft, version: 1 });
  const api = createApiAdapter('/api', (async (_url, options) => {
    body = JSON.parse(options?.body as string);
    return new Response(JSON.stringify(state));
  }) as typeof fetch);
  const result = await api.saveChecklist(draft);
  assert.equal(body?.version, 1);
  assert.equal(result.checklists.find(c => c.id === draft.id)?.version, 1);
});

test('API evaluation errors retain the returned server error status', async () => {
  const state = await local().load();
  state.conversations[0].status = 'error';
  const api = createApiAdapter('/api', (async () => new Response(JSON.stringify(state))) as typeof fetch);
  await assert.rejects(() => api.evaluate(demoConversation.id, defaultChecklist.id), error => {
    assert.ok(error instanceof AdapterStateError);
    assert.equal(error.workspace.conversations[0].status, 'error');
    return true;
  });
});

test('API polling errors and timeout preserve evaluating state without retrying POST', async () => {
  const state = await local().load();
  state.conversations[0].status = 'evaluating';
  const calls: string[] = [];
  const api = createApiAdapter('/api', (async (_url, options) => {
    calls.push(options?.method ?? 'GET');
    return options?.method === 'POST' || calls.length === 1 ? new Response(JSON.stringify(state)) : new Response('{}', { status: 503 });
  }) as typeof fetch, { pollIntervalMs: 0, evaluationTimeoutMs: 500 });
  await assert.rejects(() => api.evaluate(demoConversation.id, defaultChecklist.id), error => {
    assert.ok(error instanceof AdapterStateError);
    assert.equal(error.workspace.conversations[0].status, 'evaluating');
    return true;
  });
  assert.deepEqual(calls, ['GET', 'POST', 'GET']);
  let posts = 0;
  const timeout = createApiAdapter('/api', (async (_url, options) => {
    if (options?.method === 'POST') posts++;
    return new Response(JSON.stringify(state));
  }) as typeof fetch, { pollIntervalMs: 0, evaluationTimeoutMs: 0 });
  await assert.rejects(() => timeout.evaluate(demoConversation.id, defaultChecklist.id), error => {
    assert.ok(error instanceof AdapterStateError);
    assert.equal(error.workspace.conversations[0].status, 'evaluating');
    assert.match(error.message, /ещё выполняется/);
    return true;
  });
  assert.equal(posts, 1);
});

test('failed DEV restoration retries on load and failed reimport keeps existing records', async () => {
  const storage = memory();
  await local(storage).importDataset('DEV');
  let fail = true;
  let calls = 0;
  const adapter = createLocalAdapter({ storage, delay: 0, fetcher: (async () => {
    calls++;
    return fail ? new Response('{}', { status: 503 }) : new Response(JSON.stringify(input));
  }) as typeof fetch });
  await assert.rejects(() => adapter.load());
  fail = false;
  const state = await adapter.load();
  assert.equal(state.conversations.filter(c => !c.demo).length, 1);
  assert.equal(calls, 2);
  fail = true;
  await assert.rejects(() => adapter.importDataset('DEV'));
  assert.deepEqual(await adapter.load(), state);
});

test('lost evaluation POST response reconciles once with GET without claiming an old result is new', async () => {
  const baseline = await local().evaluate(demoConversation.id, defaultChecklist.id);
  const calls: string[] = [];
  const api = createApiAdapter('/api', (async (_url, options) => {
    calls.push(options?.method ?? 'GET');
    if (options?.method === 'POST') throw new TypeError('Failed to fetch');
    // Same old evaluated run; this must not become a successful new evaluation.
    return new Response(JSON.stringify(baseline));
  }) as typeof fetch);
  await api.load();
  await assert.rejects(() => api.evaluate(demoConversation.id, defaultChecklist.id), error => {
    assert.ok(error instanceof AdapterStateError);
    assert.equal(error.outcomeUnknown, false);
    assert.equal(error.workspace.evaluations[0].id, baseline.evaluations[0].id);
    assert.match(error.message, /Ответ на запуск оценки не получен/);
    return true;
  });
  assert.deepEqual(calls, ['GET', 'POST', 'GET']);
});

test('lost evaluation POST and failed reconciliation preserve baseline and mark unknown outcome', async () => {
  const baseline = await local().load();
  const calls: string[] = [];
  const api = createApiAdapter('/api', (async (_url, options) => {
    calls.push(options?.method ?? 'GET');
    if (calls.length === 1) return new Response(JSON.stringify(baseline));
    throw new TypeError('Failed to fetch');
  }) as typeof fetch);
  await api.load();
  await assert.rejects(() => api.evaluate(demoConversation.id, defaultChecklist.id), error => {
    assert.ok(error instanceof AdapterStateError);
    assert.equal(error.outcomeUnknown, true);
    assert.deepEqual(error.workspace, baseline);
    assert.equal(error.workspace.conversations[0].status, 'unrated');
    assert.match(error.message, /Результат запуска неизвестен/);
    return true;
  });
  assert.deepEqual(calls, ['GET', 'POST', 'GET']);
});
