/** The same deadline covers headers and the complete body, including stalled streams. */
export async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("LLM_REQUEST_ABORTED");
  let listener!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    listener = () => reject(new Error("LLM_REQUEST_ABORTED"));
    signal.addEventListener("abort", listener, { once: true });
  });
  try { return await Promise.race([operation, aborted]); }
  finally { signal.removeEventListener("abort", listener); }
}

export async function readModelOutput(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("LLM_EMPTY_RESPONSE");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const streaming = response.headers.get("content-type")?.toLowerCase().includes("text/event-stream");
  let bytes = 0;
  let buffer = "";
  let content = "";
  let done = false;
  let stopped = false;
  function event(frame: string) {
    const data = frame.split("\n").filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, "")).join("\n");
    if (!data) return; // SSE comments, event names and keepalives.
    if (done) throw new Error("LLM_INVALID_STREAM");
    if (data === "[DONE]") { done = true; return; }
    let chunk;
    try { chunk = JSON.parse(data); } catch { throw new Error("LLM_INVALID_STREAM"); }
    if (chunk.error || !Array.isArray(chunk.choices)) throw new Error("LLM_INVALID_STREAM");
    if (!chunk.choices.length) return; // optional usage frame
    if (chunk.choices.length !== 1 || (chunk.choices[0].index ?? 0) !== 0)
      throw new Error("LLM_INVALID_STREAM");
    const choice = chunk.choices[0];
    if (stopped && (choice.delta?.content || choice.finish_reason != null))
      throw new Error("LLM_INVALID_STREAM");
    if (choice.finish_reason != null) {
      if (choice.finish_reason !== "stop") throw new Error("LLM_INCOMPLETE_RESPONSE");
      stopped = true;
    }
    const delta = choice.delta?.content;
    if (delta != null) {
      if (typeof delta !== "string") throw new Error("LLM_INVALID_STREAM");
      content += delta;
    }
  }
  try {
    while (true) {
      const chunk = await withAbort(reader.read(), signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2_000_000) throw new Error("LLM_RESPONSE_TOO_LARGE");
      buffer += decoder.decode(chunk.value, { stream: true });
      if (streaming) {
        // Normalize complete CRLF pairs only; a trailing CR may span chunks.
        buffer = buffer.replace(/\r\n/g, "\n");
        let separator;
        while ((separator = buffer.indexOf("\n\n")) !== -1) {
          event(buffer.slice(0, separator));
          buffer = buffer.slice(separator + 2);
        }
        if (done) {
          // DONE is the protocol terminator; do not wait for connection close.
          if (buffer.trim()) throw new Error("LLM_INVALID_STREAM");
          void reader.cancel().catch(() => undefined);
          break;
        }
      }
    }
    buffer += decoder.decode();
    if (streaming) {
      if (buffer.trim()) event(buffer);
      if (!done || !stopped) throw new Error("LLM_INCOMPLETE_RESPONSE");
    } else {
      // Some compatible gateways return the ordinary envelope despite stream=true.
      let envelope;
      try { envelope = JSON.parse(buffer); } catch { throw new Error("LLM_INVALID_JSON_RESPONSE"); }
      if (envelope?.choices?.[0]?.finish_reason != null && envelope.choices[0].finish_reason !== "stop")
        throw new Error("LLM_INCOMPLETE_RESPONSE");
      content = envelope?.choices?.[0]?.message?.content;
    }
    if (typeof content !== "string") throw new Error("LLM_INVALID_JSON_RESPONSE");
    try { return JSON.parse(content); } catch { throw new Error("LLM_INVALID_JSON_RESPONSE"); }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof Error && /^LLM_/.test(error.message)) throw error;
    throw new Error("LLM_INVALID_STREAM");
  } finally { reader.releaseLock(); }
}
