import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";
import { parseDataset } from "../../frontend/src/lib/validation.ts";
import type { Conversation } from "../../frontend/src/lib/types.ts";

const MAX_BYTES = 5 * 1024 * 1024;
const GROUP_ID = /^[A-Za-z0-9_-]{1,100}$/;
const errors = {
  INVALID_DATASET_URL: [422, "Укажите HTTPS-ссылку набора и корректную группу."],
  DATASET_ADDRESS_DENIED: [422, "Адрес набора должен быть публичным HTTPS-сервером."],
  DATASET_FETCH_FAILED: [502, "Не удалось загрузить набор. Проверьте доступность ссылки; перенаправления не поддерживаются."],
  DATASET_TIMEOUT: [504, "Сервер набора не ответил вовремя. Повтор автоматически не выполнялся."],
  DATASET_TOO_LARGE: [413, "Размер набора превышает 5 МБ."],
  INVALID_REMOTE_DATASET: [422, "Ответ сервера не соответствует формату набора или выбранной группе."],
} as const;
export class DatasetImportError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof errors) {
    super(errors[code][1]);
    this.status = errors[code][0];
  }
}
export type DatasetImportRequest = { url: string; groupId?: string };
export type DatasetUrlImporter = (input: DatasetImportRequest, signal?: AbortSignal) => Promise<Conversation[]>;
type Address = { address: string; family: number };
type RemoteResponse = { statusCode: number; headers: IncomingHttpHeaders; body: AsyncIterable<Uint8Array> };
export type DatasetImportDependencies = {
  resolve?: (hostname: string) => Promise<Address[]>;
  transport?: (url: URL, address: Address, signal: AbortSignal) => Promise<RemoteResponse>;
  timeoutMs?: number;
};

// Accept ordinary public unicast only. Fail closed on reserved, mapped and transition ranges.
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const)
  blocked.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
export function isPublicDatasetAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

function datasetUrl(input: DatasetImportRequest): URL {
  if (typeof input.url !== "string" || input.url.length > 8192 || /[\r\n\x00]/.test(input.url) ||
      (input.groupId !== undefined && (typeof input.groupId !== "string" || !GROUP_ID.test(input.groupId))))
    throw new DatasetImportError("INVALID_DATASET_URL");
  let url: URL;
  try { url = new URL(input.url); } catch { throw new DatasetImportError("INVALID_DATASET_URL"); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash)
    throw new DatasetImportError("INVALID_DATASET_URL");
  if (input.groupId !== undefined) url.searchParams.set("group_id", input.groupId);
  return url;
}

// Keep the hostname for Host/SNI/certificate verification, but pin lookup to the validated IP.
// A fresh Agent-free request cannot reuse a connection resolved under an earlier policy.
function httpsTransport(url: URL, address: Address, signal: AbortSignal): Promise<RemoteResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "GET", agent: false, signal,
      headers: { Accept: "application/json", "Accept-Encoding": "identity" },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      },
    }, (response) => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: response }));
    req.on("error", reject);
    req.end();
  });
}

async function withDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    stop = () => reject(new DatasetImportError("DATASET_TIMEOUT"));
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener("abort", stop); }
}

export function createDatasetImporter(deps: DatasetImportDependencies = {}): DatasetUrlImporter {
  const resolve = deps.resolve ?? ((hostname) => lookup(hostname, { all: true, verbatim: true }));
  const transport = deps.transport ?? httpsTransport;
  const timeoutMs = deps.timeoutMs ?? 20_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("Invalid dataset timeout");
  return async (input, callerSignal) => {
    const url = datasetUrl(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
    const run = async () => {
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const literalFamily = isIP(hostname);
      const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await resolve(hostname);
      if (!addresses.length || addresses.some((item) => !isPublicDatasetAddress(item.address) || isIP(item.address) !== item.family))
        throw new DatasetImportError("DATASET_ADDRESS_DENIED");
      if (signal.aborted) throw new DatasetImportError("DATASET_TIMEOUT");
      const response = await transport(url, addresses[0], signal);
      if (response.statusCode !== 200) throw new DatasetImportError("DATASET_FETCH_FAILED");
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")
        throw new DatasetImportError("DATASET_FETCH_FAILED");
      if (Number(response.headers["content-length"]) > MAX_BYTES) throw new DatasetImportError("DATASET_TOO_LARGE");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_BYTES) throw new DatasetImportError("DATASET_TOO_LARGE");
        chunks.push(chunk);
      }
      let source: unknown;
      try {
        source = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
        const group = (source as { data?: { dataset_group_id?: unknown } })?.data?.dataset_group_id;
        if (typeof group !== "string" || !GROUP_ID.test(group) || (input.groupId !== undefined && input.groupId !== group))
          throw new Error();
        const records = parseDataset(source, group);
        if (!records.length || records.some((record) => !record.messages.some((message) => message.text.trim()))) throw new Error();
        return records;
      } catch { throw new DatasetImportError("INVALID_REMOTE_DATASET"); }
    };
    try { return await withDeadline(run(), signal); }
    catch (error) {
      if (error instanceof DatasetImportError) throw error;
      throw new DatasetImportError(signal.aborted ? "DATASET_TIMEOUT" : "DATASET_FETCH_FAILED");
    } finally {
      clearTimeout(timer);
      // Close rejected/status/oversized response streams too, not only successful requests.
      controller.abort();
    }
  };
}
