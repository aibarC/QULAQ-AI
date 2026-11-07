import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { Checklist, Conversation, Evaluation, ClassificationError } from "../../frontend/src/lib/types.ts";
import { buildEvaluationMessages } from "./prompt.ts";
import { buildImprovementMessages, parseImprovementOutput, usesCanonicalAnalysis, TWO_STAGE_VERSION } from "./two-stage-prompts.ts";
import { readModelOutput, withAbort } from "./two-stage-transport.ts";
import { scoreModelOutput } from "./scoring.ts";
import { enrichWithLaya, type LayaClassifier } from "./laya.ts";

export type ProviderOptions = {
  enabled?: boolean;
  baseUrl: string;
  model: string;
  getToken: () => string | undefined;
  /** Optional legacy single-request mode; ordinary manual mode has no quota. */
  oneShot?: boolean;
  quotaPath?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxTokens?: number;
  localClassifier?: LayaClassifier;
};

type EvaluationInput = { conversation: Conversation; checklist: Checklist; signal: AbortSignal };
type ImprovementInput = { conversation: Conversation; evaluation: Evaluation; signal: AbortSignal };

/** No startup calls or retries: each explicit action issues at most one request. */
export function createGatewayProvider(options: ProviderOptions) {
  let consumed = false;
  async function request(conversation: Conversation, messages: { role: "system" | "user"; content: string }[], signal: AbortSignal) {
    if (!options.enabled) throw new Error("EVALUATION_DISABLED");
    if (options.oneShot && consumed) throw new Error("ONE_TEST_ALREADY_USED");
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
    if (options.oneShot) {
      if (!options.quotaPath) throw new Error("ONE_TEST_QUOTA_PATH_REQUIRED");
      consumed = true;
      await mkdir(dirname(options.quotaPath), { recursive: true, mode: 0o700 });
      let receipt;
      try {
        receipt = await open(options.quotaPath, "wx", 0o600);
      } catch {
        throw new Error("ONE_TEST_ALREADY_USED");
      }
      try {
        await receipt.writeFile(JSON.stringify({ consumedAt: new Date().toISOString() }));
        await receipt.sync();
      } finally { await receipt.close(); }
    }

    // One deadline and no automatic retries, including after an ambiguous failure.
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 120_000)]);
    let response: Response;
    try {
      response = await withAbort((options.fetcher ?? fetch)(endpoint, {
        method: "POST", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: options.model, temperature: 0,
          max_tokens: options.maxTokens ?? 16384, stream: true, messages }),
        signal: deadline,
      }), deadline);
    } catch { throw new Error("LLM_REQUEST_FAILED_NO_RETRY"); }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("LLM_RESPONSE_REJECTED_NO_RETRY");
    }
    return readModelOutput(response, deadline);
  }
  return {
    async evaluate({ conversation, checklist, signal }: EvaluationInput): Promise<ReturnType<typeof scoreModelOutput> & { classificationError?: ClassificationError; provenance: { promptVersion: string; transcriptHash: string; model: string } }> {
      // Keep disabled/empty-transcript checks ahead of prompt construction too.
      if (!options.enabled) throw new Error("EVALUATION_DISABLED");
      if (!conversation.messages.some((message) => message.text.trim())) throw new Error("EMPTY_TRANSCRIPT");
      const messages = buildEvaluationMessages(conversation, checklist);
      const raw = await request(conversation, messages, signal);
      const outcome = scoreModelOutput(conversation, checklist, raw);
      const enriched = options.localClassifier
        ? await enrichWithLaya(outcome, conversation, checklist, options.localClassifier, signal) : outcome;
      const canonicalRecord = { conversation_id: conversation.externalId, language: conversation.language,
        channel: conversation.channel, transcript: conversation.messages.map(({ id, speaker, text, timestamp }) => ({ id, speaker, text, timestamp })) };
      return { ...enriched, provenance: {
        promptVersion: usesCanonicalAnalysis(checklist) ? `${TWO_STAGE_VERSION}/analysis` : "dynamic-checklist-v1",
        transcriptHash: createHash("sha256").update(JSON.stringify(canonicalRecord)).digest("hex"), model: options.model,
      } };
    },
    async improve({ conversation, evaluation, signal }: ImprovementInput): Promise<string | null> {
      if (!options.enabled) throw new Error("EVALUATION_DISABLED");
      if (!usesCanonicalAnalysis(evaluation.checklist)) throw new Error("UNSUPPORTED_IMPROVEMENT_CHECKLIST");
      const messages = buildImprovementMessages(conversation, evaluation);
      return parseImprovementOutput(await request(conversation, messages, signal));
    },
  };
}
/** Backwards-compatible analysis-only factory; new callers should share the provider. */
export function createGatewayEvaluator(options: ProviderOptions) {
  return createGatewayProvider(options).evaluate;
}
