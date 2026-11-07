import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { Checklist, Conversation } from "../../frontend/src/lib/types.ts";
import { buildEvaluationMessages } from "./prompt.ts";
import { scoreModelOutput } from "./scoring.ts";

type ProviderOptions = {
  enabled?: boolean;
  baseUrl: string;
  model: string;
  getToken: () => string | undefined;
  quotaPath: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxTokens?: number;
};

/** No warmup, model listing, retries, redirects or calls before the one-use gate. */
export function createGatewayEvaluator(options: ProviderOptions) {
  let consumed = false;
  return async ({
    conversation,
    checklist,
    signal,
  }: {
    conversation: Conversation;
    checklist: Checklist;
    signal: AbortSignal;
  }) => {
    if (!options.enabled) throw new Error("EVALUATION_DISABLED");
    if (consumed) throw new Error("ONE_TEST_ALREADY_USED");
    const endpoint = new URL(
      options.baseUrl.replace(/\/$/, "") + "/chat/completions",
    );
    if (
      endpoint.protocol !== "https:" ||
      endpoint.hostname !== "llm.telecom.kz" ||
      endpoint.port ||
      endpoint.username ||
      endpoint.password ||
      endpoint.pathname !== "/v1/chat/completions" ||
      endpoint.search ||
      endpoint.hash
    ) {
      throw new Error("INVALID_LLM_BASE_URL");
    }
    if (!options.model.trim() || options.model.length > 200)
      throw new Error("LLM_MODEL_REQUIRED");
    if (signal.aborted) throw new Error("EVALUATION_CANCELLED");
    if (!conversation.messages.some((message) => message.text.trim()))
      throw new Error("EMPTY_TRANSCRIPT");
    if (
      conversation.messages.reduce(
        (sum, message) => sum + message.text.length,
        0,
      ) > 200_000
    )
      throw new Error("TRANSCRIPT_TOO_LARGE_FOR_MODEL");
    // Secret retrieval is deferred until an explicitly enabled request. Never log it.
    const token = options.getToken();
    if (!token?.trim() || /[\r\n]/.test(token))
      throw new Error("LLM_TOKEN_REQUIRED");
    consumed = true;
    await mkdir(dirname(options.quotaPath), { recursive: true, mode: 0o700 });
    let receipt;
    try {
      receipt = await open(options.quotaPath, "wx", 0o600);
    } catch {
      throw new Error("ONE_TEST_ALREADY_USED");
    }
    try {
      await receipt.writeFile(
        JSON.stringify({ consumedAt: new Date().toISOString() }),
      );
      await receipt.sync();
    } finally {
      await receipt.close();
    }

    // The allowance is consumed BEFORE the request, including failed/ambiguous requests.
    // A restart cannot turn the same authorization into another paid call.
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          max_tokens: options.maxTokens ?? 4096,
          messages: buildEvaluationMessages(conversation, checklist),
        }),
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(options.timeoutMs ?? 90_000),
        ]),
      });
    } catch {
      throw new Error("LLM_REQUEST_FAILED_NO_RETRY");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("LLM_RESPONSE_REJECTED_NO_RETRY");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("LLM_EMPTY_RESPONSE");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new Error("LLM_RESPONSE_TOO_LARGE");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    let raw: unknown;
    try {
      const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const content = envelope?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error();
      raw = JSON.parse(content);
    } catch {
      throw new Error("LLM_INVALID_JSON_RESPONSE");
    }
    return scoreModelOutput(conversation, checklist, raw);
  };
}
