import { spawn } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { CONTACT_REASON_GROUPS } from "../../frontend/src/lib/contactReasons.ts";
import type {
  Checklist,
  ContactReason,
  Conversation,
  CriterionResult,
  Evaluation,
} from "../../frontend/src/lib/types.ts";

export const LAYA_MODEL = "convaiinnovations/laya-multilingual";
export const LAYA_REVISION = "1720e3e3357cfe1e281542e223f8273b0890ca34";
type LayaCode =
  | "missing_fragment"
  | "invalid_fragment"
  | "unavailable"
  | "timeout"
  | "invalid_output"
  | "failed";
const errors: Record<LayaCode, string> = {
  missing_fragment:
    "В оценке нет подходящего фрагмента выявления потребности для Laya.",
  invalid_fragment:
    "Фрагмент потребности неполный, слишком длинный или содержит неверные ссылки.",
  unavailable: "Локальный классификатор Laya недоступен.",
  timeout: "Локальный классификатор Laya не завершил обработку вовремя.",
  invalid_output: "Локальный классификатор Laya вернул некорректный результат.",
  failed: "Локальная классификация Laya не выполнена.",
};
export class LayaError extends Error {
  constructor(readonly code: LayaCode) {
    super(errors[code]);
    this.name = "LayaError";
  }
}
export interface NeedFragment {
  text: string;
  language: Conversation["language"];
  criterionId: string;
  messageIds: string[];
}

/** Select only the named need-identification rule, never a custom rule merely called c2. */
export function selectNeedFragment(
  conversation: Conversation,
  checklist: Checklist,
  results: CriterionResult[],
): NeedFragment {
  const criterion = checklist.criteria.find(
    (item) =>
      item.id === "c2" &&
      item.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru") ===
        "выявление потребности",
  );
  const result =
    criterion && results.find((item) => item.criterionId === criterion.id);
  if (!criterion || !result || !result.evidence.length)
    throw new LayaError("missing_fragment");
  const positions = new Map(
    conversation.messages.map((message, index) => [message.id, index]),
  );
  if (positions.size !== conversation.messages.length)
    throw new LayaError("invalid_fragment");
  const evidenceIds = new Set(
    result.evidence.flatMap((item) => item.messageIds),
  );
  if (!evidenceIds.size) throw new LayaError("missing_fragment");
  const selected = new Set<number>();
  for (const id of evidenceIds) {
    const position = positions.get(id);
    if (position === undefined) throw new LayaError("invalid_fragment");
    for (
      let index = Math.max(0, position - 1);
      index <= Math.min(conversation.messages.length - 1, position + 1);
      index++
    )
      selected.add(index);
  }
  const messages = conversation.messages.filter((_, index) =>
    selected.has(index),
  );
  // The persisted provenance contract permits at most 100 exact IDs; never drop context IDs silently.
  if (messages.length > 100) throw new LayaError("invalid_fragment");
  if (
    !messages.some(
      (message) => message.speaker === "client" && message.text.trim(),
    )
  )
    throw new LayaError("invalid_fragment");
  const text = messages
    .map((message) => `[${message.speaker}] ${message.text}`)
    .join("\n");
  if (text.length > 12_000) throw new LayaError("invalid_fragment");
  return {
    text,
    language: conversation.language,
    criterionId: criterion.id,
    messageIds: messages.map((message) => message.id),
  };
}

interface WorkerOutput {
  category: ContactReason["primary"];
  probabilities: Record<string, number>;
  model: string;
  revision: string;
}
function readOutput(text: string): WorkerOutput {
  try {
    const value = JSON.parse(text);
    const ids = CONTACT_REASON_GROUPS.map((group) => group.id);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join() !==
        "category,model,probabilities,revision" ||
      !ids.includes(value.category) ||
      value.model !== LAYA_MODEL ||
      value.revision !== LAYA_REVISION ||
      !value.probabilities ||
      typeof value.probabilities !== "object" ||
      Array.isArray(value.probabilities)
    )
      throw new Error();
    const entries = Object.entries(value.probabilities);
    if (
      entries.length !== ids.length ||
      entries.some(
        ([id, probability]) =>
          !ids.includes(id as ContactReason["primary"]) ||
          typeof probability !== "number" ||
          !Number.isFinite(probability) ||
          probability < 0 ||
          probability > 1,
      )
    )
      throw new Error();
    const values = Object.values(value.probabilities) as number[];
    if (
      Math.abs(values.reduce((sum, probability) => sum + probability, 0) - 1) >
        0.0001 ||
      value.probabilities[value.category] < Math.max(...values)
    )
      throw new Error();
    return value;
  } catch {
    throw new LayaError("invalid_output");
  }
}

export interface LayaOptions {
  pythonPath: string;
  workerPath: string;
  timeoutMs?: number;
}
export type LayaClassifier = (
  conversation: Conversation,
  checklist: Checklist,
  results: CriterionResult[],
  previousContactReason?: ContactReason,
  signal?: AbortSignal,
) => Promise<ContactReason>;

/** No shell, inherited environment, remote model loading or stderr forwarding. */
function runWorker(
  options: LayaOptions,
  fragment: NeedFragment,
  signal?: AbortSignal,
): Promise<WorkerOutput> {
  if (signal?.aborted) return Promise.reject(new LayaError("failed"));
  return new Promise((resolveOutput, reject) => {
    const child = spawn(options.pythonPath, [options.workerPath], {
      shell: false,
      cwd: dirname(options.workerPath),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        HF_HOME: resolve(
          dirname(options.workerPath),
          "../../.local/laya-cache",
        ),
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        HF_HUB_DISABLE_TELEMETRY: "1",
        PYTHONNOUSERSITE: "1",
        PYTHONUNBUFFERED: "1",
        TOKENIZERS_PARALLELISM: "false",
      },
    });
    let settled = false,
      stdoutBytes = 0,
      stderrBytes = 0;
    const chunks: Buffer[] = [];
    const finish = (error?: LayaError, output?: WorkerOutput) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolveOutput(output!);
    };
    const abort = () => finish(new LayaError("failed"));
    const timer = setTimeout(
      () => finish(new LayaError("timeout")),
      options.timeoutMs ?? 120_000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () => finish(new LayaError("unavailable")));
    child.stdin.on("error", () => finish(new LayaError("failed")));
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 65_536) finish(new LayaError("invalid_output"));
      else chunks.push(chunk);
    });
    // Count and discard: Python traceback/model details must never leak into API errors.
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65_536) finish(new LayaError("failed"));
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(new LayaError("failed"));
        return;
      }
      try {
        finish(undefined, readOutput(Buffer.concat(chunks).toString("utf8")));
      } catch {
        finish(new LayaError("invalid_output"));
      }
    });
    if (signal?.aborted) {
      abort();
      return;
    }
    child.stdin.end(
      JSON.stringify({ text: fragment.text, language: fragment.language }),
    );
  });
}

export function createLayaClassifier(options: LayaOptions): LayaClassifier {
  if (
    !isAbsolute(options.pythonPath) ||
    !isAbsolute(options.workerPath) ||
    (options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) ||
        options.timeoutMs < 1 ||
        options.timeoutMs > 120_000))
  )
    throw new Error("Invalid local classifier configuration");
  return async (
    conversation,
    checklist,
    results,
    previousContactReason,
    signal,
  ) => {
    const fragment = selectNeedFragment(conversation, checklist, results);
    const output = await runWorker(options, fragment, signal);
    const quote = conversation.messages
      .find(
        (message) =>
          fragment.messageIds.includes(message.id) &&
          message.speaker === "client" &&
          message.text.trim(),
      )!
      .text.trim();
    return {
      taxonomyVersion: 1,
      primary: output.category,
      secondary: [],
      summary: `Запрос клиента: «${quote.length <= 550 ? quote : `${quote.slice(0, 549)}…`}»`,
      reason:
        "Категория автоматически выбрана локальной моделью Laya по фрагменту критерия «Выявление потребности». Объяснение выбора моделью не генерировалось.",
      evidenceIds: fragment.messageIds,
      resolution:
        previousContactReason?.primary === output.category
          ? structuredClone(previousContactReason.resolution)
          : {
              status: "unknown",
              reason: previousContactReason
                ? "Laya выбрала другую тему обращения. Исход предыдущей темы нельзя переносить на новую категорию без отдельного подтверждения."
                : "Laya определяет тему обращения; подтверждённого исхода в исходной оценке нет.",
              evidenceIds: [],
            },
      classifier: {
        provider: "laya",
        model: output.model,
        revision: output.revision,
        criterionId: fragment.criterionId,
        messageIds: fragment.messageIds,
      },
    };
  };
}

type Outcome = Pick<
  Evaluation,
  | "results"
  | "total"
  | "grossViolation"
  | "contactReason"
  | "classificationError"
>;
/** A classification failure never discards scoring and never masquerades as the previous model category. */
export async function enrichWithLaya<T extends Outcome>(
  outcome: T,
  conversation: Conversation,
  checklist: Checklist,
  classify: LayaClassifier,
  signal?: AbortSignal,
): Promise<
  Omit<T, "contactReason" | "classificationError"> &
    Pick<Evaluation, "contactReason" | "classificationError">
> {
  const {
    contactReason: previousContactReason,
    classificationError: _previousError,
    ...rest
  } = outcome;
  try {
    const contactReason = await classify(
      conversation,
      checklist,
      outcome.results,
      previousContactReason,
      signal,
    );
    return { ...rest, contactReason };
  } catch (error) {
    const failure =
      error instanceof LayaError ? error : new LayaError("failed");
    return {
      ...rest,
      classificationError: {
        provider: "laya",
        code: failure.code,
        message: failure.message,
      },
    };
  }
}
