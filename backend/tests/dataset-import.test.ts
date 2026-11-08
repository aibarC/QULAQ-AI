import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetImporter, DatasetImportError, isPublicDatasetAddress, type DatasetImportDependencies } from "../src/dataset-import.ts";

const publicAddress = { address: "93.184.216.34", family: 4 };
const dataset = (group = "CONTROL") => ({ isSuccess: true, data: {
  dataset_group_id: group, total_records: 1, records: [{ conversation_id: "voice-1", channel: "voice call", language: "KZ",
    transcript: [{ timestamp: "2026-11-08T13:10:00+05:00", speaker: "client", text: "Синтетикалық сұрақ." }],
    audio_url: "https://audio.example.test/record.mp3?signature=synthetic",
  }],
} });
function response(value: unknown, statusCode = 200, headers = {}) {
  return { statusCode, headers, body: (async function* () { yield Buffer.from(JSON.stringify(value)); })() };
}
const code = (name: string) => (error: unknown) => error instanceof DatasetImportError && error.code === name;
const deps: DatasetImportDependencies = { resolve: async () => [publicAddress], transport: async () => response(dataset()) };

test("group inference preserves timestamps/audio and does not store signed API URL", async () => {
  let host = "", sent = "", pinned = "";
  const importer = createDatasetImporter({ resolve: async (hostname) => { host = hostname; return [publicAddress]; },
    transport: async (url, address) => { sent = url.href; pinned = address.address; return response(dataset()); } });
  const result = await importer({ url: "https://datasets.example.test/api?signature=secret" });
  assert.equal(host, "datasets.example.test"); assert.equal(pinned, publicAddress.address);
  assert.equal(sent, "https://datasets.example.test/api?signature=secret");
  assert.equal(result[0].id, "CONTROL:voice-1");
  assert.equal(result[0].messages[0].timestamp, "2026-11-08T13:10:00+05:00");
  assert.equal(result[0].audioUrl, dataset().data.records[0].audio_url);
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("group override replaces group_id and rejects a mismatched response", async () => {
  let sent = "";
  const importer = createDatasetImporter({ ...deps, transport: async (url) => { sent = url.href; return response(dataset()); } });
  await importer({ url: "https://datasets.example.test/api?group_id=DEV&signature=synthetic", groupId: "CONTROL" });
  assert.equal(new URL(sent).searchParams.get("group_id"), "CONTROL");
  assert.equal(new URL(sent).searchParams.get("signature"), "synthetic");
  await assert.rejects(importer({ url: "https://datasets.example.test/api", groupId: "DEV" }), code("INVALID_REMOTE_DATASET"));
});

test("bad URLs and groups reject before DNS or transport", async () => {
  let calls = 0;
  const importer = createDatasetImporter({ resolve: async () => { calls++; return [publicAddress]; }, transport: async () => { calls++; return response(dataset()); } });
  for (const url of ["http://example.test/api", "file:///etc/passwd", "https://user:pass@example.test/api", "https://example.test:8443/api", "https://example.test/api#token", "not a url", "https://example.test/\napi"])
    await assert.rejects(importer({ url }), code("INVALID_DATASET_URL"));
  for (const groupId of ["", "../DEV", "CONTROL group", "x".repeat(101)])
    await assert.rejects(importer({ url: "https://example.test/api", groupId }), code("INVALID_DATASET_URL"));
  assert.equal(calls, 0);
});

test("private/reserved IPv4 and IPv6 including mapped and alternative forms are blocked", async () => {
  for (const address of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:8.8.8.8", "2001:db8::1", "2001::1", "2002:0808:0808::1", "3fff::1"])
    assert.equal(isPublicDatasetAddress(address), false, address);
  assert.equal(isPublicDatasetAddress("8.8.8.8"), true);
  assert.equal(isPublicDatasetAddress("2606:4700:4700::1111"), true);
  let calls = 0;
  const importer = createDatasetImporter({ ...deps, transport: async () => { calls++; return response(dataset()); } });
  for (const host of ["127.1", "2130706433", "0x7f000001", "[::1]", "[::ffff:127.0.0.1]"])
    await assert.rejects(importer({ url: `https://${host}/api` }), code("DATASET_ADDRESS_DENIED"));
  assert.equal(calls, 0);
});

test("every DNS record is checked and transport receives a pinned address without re-resolution", async () => {
  let calls = 0;
  await createDatasetImporter({ resolve: async () => { calls++; return calls === 1 ? [publicAddress] : [{ address: "127.0.0.1", family: 4 }]; },
    transport: async (_url, address) => { assert.deepEqual(address, publicAddress); return response(dataset()); },
  })({ url: "https://rebind.example.test/api" });
  assert.equal(calls, 1);
  for (const addresses of [[], [publicAddress, { address: "10.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 6 }]])
    await assert.rejects(createDatasetImporter({ ...deps, resolve: async () => addresses })({ url: "https://example.test/api" }), code("DATASET_ADDRESS_DENIED"));
});

test("redirects/compression/remote errors fail without retries or sensitive error messages", async () => {
  for (const status of [301, 302, 307, 308, 401, 404, 500]) {
    let calls = 0;
    const importer = createDatasetImporter({ ...deps, transport: async () => { calls++; return response({}, status, { location: "https://127.0.0.1/" }); } });
    await assert.rejects(importer({ url: "https://example.test/api?signature=secret" }), code("DATASET_FETCH_FAILED"));
    assert.equal(calls, 1);
  }
  await assert.rejects(createDatasetImporter({ ...deps, transport: async () => response({}, 200, { "content-encoding": "gzip" }) })({ url: "https://example.test/api" }), code("DATASET_FETCH_FAILED"));
  for (const layer of ["resolve", "transport"] as const) {
    const importer = createDatasetImporter({ ...deps, [layer]: async () => { throw new Error("secret signedURL payload"); } });
    await assert.rejects(importer({ url: "https://example.test/api?signature=secret" }), (error: unknown) => {
      assert.ok(error instanceof DatasetImportError); assert.equal(error.code, "DATASET_FETCH_FAILED");
      assert.ok(!error.message.includes("secret")); return true;
    });
  }
});

test("5MB cap covers header and chunked body; malformed or incomplete datasets reject", async () => {
  const huge = createDatasetImporter({ ...deps, transport: async () => ({ statusCode: 200, headers: {}, body: (async function* () { yield Buffer.alloc(5 * 1024 * 1024); yield Buffer.from("x"); })() }) });
  await assert.rejects(huge({ url: "https://example.test/api" }), code("DATASET_TOO_LARGE"));
  await assert.rejects(createDatasetImporter({ ...deps, transport: async () => response({}, 200, { "content-length": String(6 * 1024 * 1024) }) })({ url: "https://example.test/api" }), code("DATASET_TOO_LARGE"));
  for (const value of [null, {}, "bad-json", { ...dataset(), isSuccess: false }, dataset("../CONTROL"), { ...dataset(), data: { ...dataset().data, total_records: 2 } }, { ...dataset(), data: { dataset_group_id: "CONTROL", total_records: 0, records: [] } }])
    await assert.rejects(createDatasetImporter({ ...deps, transport: async () => response(value) })({ url: "https://example.test/api" }), code("INVALID_REMOTE_DATASET"));
  const invalidJson = createDatasetImporter({ ...deps, transport: async () => ({ statusCode: 200, headers: {}, body: (async function* () { yield Buffer.from("{broken"); })() }) });
  await assert.rejects(invalidJson({ url: "https://example.test/api" }), code("INVALID_REMOTE_DATASET"));
});

test("deadline covers stalled DNS/headers/body and cancellation never starts a transport", async () => {
  for (const layer of ["dns", "headers", "body"] as const) {
    const pending = () => new Promise<never>(() => {});
    const importer = createDatasetImporter({ ...deps, timeoutMs: 10,
      ...(layer === "dns" ? { resolve: pending } : {}),
      ...(layer === "headers" ? { transport: pending } : {}),
      ...(layer === "body" ? { transport: async () => ({ statusCode: 200, headers: {}, body: (async function* () { await pending(); })() }) } : {}),
    });
    await assert.rejects(importer({ url: "https://example.test/api" }), code("DATASET_TIMEOUT"));
  }
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(createDatasetImporter({ ...deps, transport: async () => { calls++; return response(dataset()); } })({ url: "https://example.test/api" }, controller.signal), code("DATASET_TIMEOUT"));
  assert.equal(calls, 0);
});
