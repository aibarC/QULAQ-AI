import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfTranscript, PDF_MAX_BYTES } from "../src/lib/pdf-transcript.ts";
import { makeUploadDataset } from "../src/lib/upload-dataset.ts";

const bytes = (text: string) => new TextEncoder().encode(text).buffer;

test("PDF bounds and signature reject before loading the parser", async () => {
  await assert.rejects(extractPdfTranscript(new ArrayBuffer(0)), /непустым/);
  await assert.rejects(extractPdfTranscript(new ArrayBuffer(PDF_MAX_BYTES + 1)), /5 МБ/);
  await assert.rejects(extractPdfTranscript(bytes("Client: Not a PDF")), /не похож на PDF/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(extractPdfTranscript(bytes("%PDF-1.4"), controller.signal), /отменено/);
});

test("extracted PDF text uses explicit roles and timestamps without invented audio or OCR", async () => {
  const source = { kind: "pdf" as const, name: "conversation.pdf", text: "[00:02] Client: Question\nOperator: Answer" };
  const imported = await makeUploadDataset(source, "EN");
  assert.deepEqual(imported, await makeUploadDataset(source, "EN"));
  const record = imported.dataset.data.records[0];
  assert.ok(record.conversation_id.endsWith("-conversation"));
  assert.equal(record.audio_url, null);
  assert.deepEqual(record.transcript, [
    { timestamp: "00:02", speaker: "client", text: "Question" },
    { timestamp: "", speaker: "operator", text: "Answer" },
  ]);
  await assert.rejects(makeUploadDataset({ ...source, text: "Unlabelled transcript" }, "EN"), /укажите участников/);
});
