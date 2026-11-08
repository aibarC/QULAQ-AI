import test from "node:test";
import assert from "node:assert/strict";
import {
  makeUploadDataset,
  parseTextTranscript,
} from "../src/lib/upload-dataset.ts";
import { parseDataset, parseWorkspace } from "../src/lib/validation.ts";
import { createApiAdapter, AdapterStateError } from "../src/lib/adapter.ts";
import { defaultChecklist, demoConversation } from "../src/lib/fixtures.ts";

test("TXT upload preserves explicit roles and times without inventing either", () => {
  const messages = parseTextTranscript(
    "[00:03] Клиент: Вопрос\nпродолжение\nОператор: Ответ",
  );
  assert.deepEqual(messages, [
    { timestamp: "00:03", speaker: "client", text: "Вопрос\nпродолжение" },
    { timestamp: "", speaker: "operator", text: "Ответ" },
  ]);
  assert.throws(
    () => parseTextTranscript("Текст без роли"),
    /укажите участников/,
  );
});

test("TXT IDs are deterministic while JSON preserves source identity and audio links", async () => {
  const source = {
    kind: "txt" as const,
    name: "chat.txt",
    text: "Client: Question\nOperator: Answer",
  };
  const first = await makeUploadDataset(source, "EN");
  assert.deepEqual(first, await makeUploadDataset(source, "EN"));
  assert.equal(parseDataset(first.dataset, "UPLOAD")[0].id, first.firstId);
  const conversation = structuredClone(demoConversation);
  conversation.audioUrl = "https://invalid.example/audio";
  const json = await makeUploadDataset(
    { kind: "json", name: "set.json", conversations: [conversation] },
    "RU",
  );
  assert.equal(json.dataset.data.records[0].audio_url, conversation.audioUrl);
  assert.equal(json.dataset.data.records[0].conversation_id, conversation.externalId);
  assert.equal(json.dataset.data.dataset_group_id, conversation.groupId);
});

test("disabled model response is explicit, preserves workspace and never retries analysis", async () => {
  const conversation = {
    ...structuredClone(demoConversation),
    demo: false,
    status: "unrated" as const,
  };
  const workspace = {
    conversations: [conversation],
    checklists: [defaultChecklist],
    evaluations: [],
    appeals: [],
  };
  const calls: string[] = [];
  const adapter = createApiAdapter("/api", async (url, init) => {
    calls.push(`${init?.method}:${url}`);
    return String(url).endsWith("/evaluations")
      ? new Response(JSON.stringify({ code: "EVALUATION_DISABLED" }), {
          status: 503,
        })
      : new Response(JSON.stringify(workspace));
  });
  await assert.rejects(
    adapter.evaluate(conversation.id, defaultChecklist.id),
    (error: unknown) => {
      assert.ok(error instanceof AdapterStateError);
      assert.match(error.message, /Вызовы модели отключены/);
      assert.equal(error.workspace.evaluations.length, 0);
      assert.equal(error.outcomeUnknown, false);
      return true;
    },
  );
  assert.deepEqual(calls, ["GET:/api/workspace", "POST:/api/evaluations"]);
});


test("official JSON preserves punctuation and long Unicode IDs across API, file and workspace validation", async () => {
  const externalIds = ["p4-ru-001", "case:/%?# +.001", "界".repeat(300)];
  const source = { isSuccess: true, data: { dataset_group_id: "CONTROL", total_records: externalIds.length,
    records: externalIds.map((id) => ({ conversation_id: id, language: "RU", channel: "voice call",
      audio_url: "https://audio.example.test/record.mp3", transcript: [{ timestamp: "00:01", speaker: "operator", text: "Учебная реплика." }] })) } };
  const apiRecords = parseDataset(source, "CONTROL");
  const uploaded = await makeUploadDataset({ kind: "json", name: "source.json", conversations: apiRecords }, "EN");
  assert.deepEqual(uploaded.dataset, source);
  const fileRecords = parseDataset(uploaded.dataset, "CONTROL");
  assert.deepEqual(fileRecords, apiRecords);
  assert.deepEqual(fileRecords.map((row) => row.externalId), externalIds);
  assert.equal(uploaded.firstId, apiRecords[0].id);
  assert.ok(fileRecords[2].messages[0].id.length > 2000);
  assert.deepEqual(parseWorkspace({ conversations: fileRecords, checklists: [defaultChecklist], evaluations: [], appeals: [] }).conversations, fileRecords);
  const other = await makeUploadDataset({ kind: "json", name: "other.json", conversations: apiRecords.map((row) => ({ ...row, groupId: "OTHER" })) }, "RU");
  assert.notEqual(other.firstId, uploaded.firstId);
  assert.equal(other.dataset.data.records[0].conversation_id, externalIds[0]);
  await assert.rejects(makeUploadDataset({ kind: "json", name: "mixed.json", conversations: [apiRecords[0], { ...apiRecords[1], groupId: "OTHER" }] }, "RU"), /одной группы/);
  await assert.rejects(makeUploadDataset({ kind: "json", name: "duplicate.json", conversations: [apiRecords[0], apiRecords[0]] }, "RU"), /повторяются/);
  await assert.rejects(makeUploadDataset({ kind: "json", name: "invalid.json", conversations: [{ ...apiRecords[0], externalId: "x".repeat(301) }] }, "RU"));
});

test("API adapter uploads official JSON with its original group unchanged", async () => {
  const record = { ...structuredClone(demoConversation), groupId: "CONTROL", externalId: "p4-ru-001" };
  const { dataset } = await makeUploadDataset({ kind: "json", name: "control.json", conversations: [record] }, "RU");
  const records = parseDataset(dataset, "CONTROL");
  let calls = 0;
  const adapter = createApiAdapter("/api", async (url, init) => {
    calls++;
    assert.equal(String(url), "/api/datasets/upload");
    assert.deepEqual(JSON.parse(String(init?.body)), dataset);
    return new Response(JSON.stringify({ conversations: records, checklists: [defaultChecklist], evaluations: [], appeals: [] }));
  });
  const saved = await adapter.uploadDataset(dataset);
  assert.equal(calls, 1);
  assert.equal(saved.conversations[0].externalId, "p4-ru-001");
});

test("XLSX identifies an imported JSON conversation by the unchanged external ID", async () => {
  const { evaluationWorkbook } = await import("../src/lib/export-evaluation.ts");
  const { makeDemoEvaluation } = await import("../src/lib/fixtures.ts");
  const { default: ExcelJS } = await import("exceljs");
  const externalId = "p4-ru-001:/?% + оригинал";
  const { dataset } = await makeUploadDataset({ kind: "json", name: "input.json", conversations: [
    { ...structuredClone(demoConversation), externalId, groupId: "CONTROL" },
  ] }, "RU");
  const imported = parseDataset(dataset, "CONTROL")[0];
  const saved = makeDemoEvaluation(defaultChecklist);
  saved.recordId = imported.id;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await evaluationWorkbook(imported, saved) as never);
  assert.equal(workbook.getWorksheet("Результат")!.getCell("B1").value, externalId);
});
