/** Offline conversion only. This module does not load secrets or model providers. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseDataset, parseWorkspace } from '../../frontend/src/lib/validation.ts';
import { initialChecklist, scoreModelOutput } from '../src/scoring.ts';
import { legacyC6 } from '../src/checklist-migrations.ts';
import { buildSubmission } from '../src/submission-export.ts';
import type { Evaluation, Workspace } from '../../frontend/src/lib/types.ts';

const args = process.argv.slice(2);
function required(name: string) {
  const value = args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Required --${name}=...`);
  return value;
}
const datasetPath = resolve(required('dataset'));
const recordsPath = resolve(required('records'));
const responsesPath = resolve(required('responses'));
const outputPath = resolve(required('output'));
const teamName = required('team');
const groupId = required('group');
const count = Number(required('count'));
const checklistSnapshot = args.find(arg => arg.startsWith('--checklist='))?.slice('--checklist='.length) ?? 'legacy-c6';
assert(['legacy-c6', 'current'].includes(checklistSnapshot), 'Expected --checklist=legacy-c6 or --checklist=current');
assert(count === 65 || count === 10, 'Expected count must be 65 or 10');
const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const dataset = await readJson(datasetPath);
const savedRecords = await readJson(recordsPath);
const savedResponses = await readJson(responsesPath);
const conversations = parseDataset(dataset, groupId);
assert.equal(conversations.length, count);
assert(Array.isArray(savedResponses));
assert.equal(savedResponses.length, count);
assert.equal(new Set(savedResponses.map(row => row.conversation_id)).size, count);
const expectedIds = conversations.map(record => record.externalId).sort();
assert.deepEqual(Object.keys(savedRecords).sort(), expectedIds);
assert.deepEqual(savedResponses.map(row => row.conversation_id).sort(), expectedIds);
const responseMap = new Map(savedResponses.map(row => [row.conversation_id, row]));
const checklist = structuredClone(initialChecklist);
// Historical sources default to the original snapshot. Final C6/C7 runs must
// explicitly select --checklist=current; conversion never changes model answers.
if (checklistSnapshot === 'legacy-c6')
  checklist.criteria[checklist.criteria.findIndex(c => c.id === 'c6')] = structuredClone(legacyC6);
const requestedModels = [...new Set(savedResponses.map(row => {
  assert(typeof row.model === 'string' && row.model.trim(), 'Missing requested model');
  if (row.reported_model !== undefined)
    assert.equal(row.reported_model, row.model, 'Resolve a model alias/report mismatch before export');
  return row.model.trim();
}))];
assert.equal(requestedModels.length, 1, 'Expected one model in this saved run');
const evaluations: Evaluation[] = [];
for (const conversation of conversations) {
  const saved = savedRecords[conversation.externalId];
  assert.equal(saved.language, conversation.language);
  assert.equal(saved.transcript.length, conversation.messages.length);
  const messageMap = new Map<string, string>();
  for (let index = 0; index < conversation.messages.length; index++) {
    const a = saved.transcript[index], b = conversation.messages[index];
    assert.deepEqual({ speaker: a.speaker, text: a.text, timestamp: a.timestamp },
      { speaker: b.speaker, text: b.text, timestamp: b.timestamp }, `Transcript mismatch: ${conversation.externalId}/${index + 1}`);
    assert(typeof a.id === 'string' && !messageMap.has(a.id));
    messageMap.set(a.id, b.id);
  }
  const response = responseMap.get(conversation.externalId)!;
  assert(Array.isArray(response.validation_errors), 'Missing saved validation result');
  if (response.validation_errors.length > 0) {
    // Preserve failed/invalid attempts in the official dataset instead of hiding
    // them, substituting an older success, or turning them into a zero score.
    conversation.status = 'error';
    continue;
  }
  assert.equal(response.http, 200);
  assert.deepEqual(response.validation_errors, []);
  assert.equal(response.sse_done, true);
  assert.equal(response.finish_reason, 'stop');
  assert.equal(typeof response.model, 'string');
  assert.equal(response.reported_model, response.model, 'Resolve a model alias/report mismatch before export');
  const raw = JSON.parse(response.content);
  assert.deepEqual(Object.keys(raw), ['results'], 'This converter accepts criteria-only saved outputs');
  assert(raw.results.every((r: Record<string, unknown>) => !Object.hasOwn(r, 'coaching')), 'Coaching payloads need separate ID normalization');
  assert.deepEqual(response.parsed, raw);
  for (const result of raw.results) {
    result.evidence_ids = result.evidence_ids.map((id: string) => {
      const mapped = messageMap.get(id);
      assert(mapped, `Unknown evidence ID: ${conversation.externalId}/${id}`);
      return mapped;
    });
  }
  const scored = scoreModelOutput(conversation, checklist, raw);
  assert.equal(scored.total, response.score.total, `Stored score mismatch: ${conversation.externalId}`);
  assert.equal(scored.grossViolation, response.score.gross_error);
  conversation.status = 'evaluated';
  evaluations.push({
    id: `saved:${response.version}:${conversation.externalId}`,
    recordId: conversation.id, createdAt: response.started_utc,
    checklist: structuredClone(checklist), results: scored.results,
    total: scored.total, originalTotal: scored.total, grossViolation: scored.grossViolation,
    demo: false,
    provenance: { model: response.model, promptVersion: response.version,
      transcriptHash: createHash('sha256').update(JSON.stringify(saved.transcript)).digest('hex') },
  });
}
const workspace: Workspace = parseWorkspace({ conversations, checklists: [checklist], evaluations, appeals: [] });
const document = buildSubmission(workspace, { groupId, teamName, expectedCount: count as 65 | 10, fallbackModelName: requestedModels[0] });
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
const workspacePath = args.find(arg => arg.startsWith('--workspace-output='))?.slice('--workspace-output='.length);
if (workspacePath) {
  await mkdir(dirname(resolve(workspacePath)), { recursive: true });
  await writeFile(resolve(workspacePath), JSON.stringify(workspace, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
const hashes = {} as Record<string, string>;
for (const [name, path] of [['dataset', datasetPath], ['saved_records', recordsPath], ['saved_responses', responsesPath], ['submission', outputPath]])
  hashes[name] = createHash('sha256').update(await readFile(path)).digest('hex');
console.log(JSON.stringify({ converted: count, successful: evaluations.length, errors: count - evaluations.length, criteria: evaluations.length * 8, checklistSnapshot, team: teamName, models: [...new Set(savedResponses.map(row => row.model))],
  sourceVersions: [...new Set(savedResponses.map(row => row.version))], modelCalls: 0, hashes }, null, 2));
