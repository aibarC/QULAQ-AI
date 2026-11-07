import test from "node:test";
import assert from "node:assert/strict";
import {
  makeUploadDataset,
  parseTextTranscript,
} from "../src/lib/upload-dataset.ts";
import { parseDataset } from "../src/lib/validation.ts";
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

test("upload IDs are deterministic and JSON imports discard external audio links", async () => {
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
  assert.equal(json.dataset.data.records[0].audio_url, null);
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
