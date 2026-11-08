import { DYNAMIC_IMPROVEMENT_VERSION, usesCanonicalAnalysis } from "./two-stage-prompts.ts";
import { LayaError } from "./laya.ts";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import {
  parseDataset,
  validAnswer,
  validateChecklist,
  validateChecklistDraft,
} from "../../frontend/src/lib/validation.ts";
import type {
  Checklist,
  Conversation,
  ContactReason,
  ClassificationError,
  CriterionResult,
  Evaluation,
  Workspace,
} from "../../frontend/src/lib/types.ts";
import type { WorkspaceStore } from "./store.ts";

export interface AppOptions {
  store: WorkspaceStore;
  initialChecklist: Checklist;
  evaluate(input: {
    conversation: Conversation;
    checklist: Checklist;
    signal: AbortSignal;
  }): Promise<{
    results: CriterionResult[];
    total: number | null;
    grossViolation: boolean;
    contactReason?: ContactReason;
    classificationError?: ClassificationError;
    provenance?: Evaluation["provenance"];
  }>;
  improve?(input: { conversation: Conversation; evaluation: Evaluation; signal: AbortSignal }): Promise<string | null>;
  allowImprovement?: boolean;
  recalculate(evaluation: Evaluation): Evaluation;
  allowEvaluation?: boolean;
  classifyReason?: (
    conversation: Conversation,
    evaluation: Evaluation,
  ) => Promise<ContactReason>;
  datasetPath: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const BODY_LIMIT = 5 * 1024 * 1024;
const loopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

function checkLocalRequest(request: IncomingMessage) {
  const remote = request.socket.remoteAddress;
  if (
    !remote ||
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote) ||
    !loopbackHost.test(request.headers.host || "")
  ) {
    throw new HttpError(
      403,
      "LOCAL_ONLY",
      "Доступ разрешён только с этого устройства.",
    );
  }
  const origin = request.headers.origin;
  if (origin) {
    let allowed = false;
    try {
      const url = new URL(origin);
      allowed =
        url.protocol === "http:" &&
        loopbackHost.test(url.host) &&
        url.origin === origin;
    } catch {
      /* Reject malformed origins. */
    }
    if (!allowed)
      throw new HttpError(
        403,
        "ORIGIN_DENIED",
        "Источник запроса не разрешён.",
      );
  }
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
  });
  response.end(JSON.stringify(body));
}

async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  if (
    !/^application\/json(?:\s*;.*)?$/i.test(
      request.headers["content-type"] || "",
    ) ||
    (request.headers["content-encoding"] &&
      request.headers["content-encoding"] !== "identity")
  ) {
    request.resume();
    throw new HttpError(
      415,
      "JSON_REQUIRED",
      "Отправьте данные в формате JSON.",
    );
  }
  if (Number(request.headers["content-length"]) > BODY_LIMIT) {
    request.resume();
    throw new HttpError(
      413,
      "BODY_TOO_LARGE",
      "Максимальный размер запроса — 5 МБ.",
    );
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request.iterator({ destroyOnReturn: false })) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > BODY_LIMIT) {
      request.resume();
      throw new HttpError(
        413,
        "BODY_TOO_LARGE",
        "Максимальный размер запроса — 5 МБ.",
      );
    }
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(422, "INVALID_JSON", "Некорректный JSON запроса.");
  }
}

function field(
  input: Record<string, unknown>,
  key: string,
  maximum = 300,
): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new HttpError(
      422,
      "INVALID_INPUT",
      "Проверьте обязательные поля запроса.",
    );
  }
  return value.trim();
}

function mergeConversations(workspace: Workspace, records: Conversation[]) {
  for (const record of records) {
    const existing = workspace.conversations.find(
      (item) => item.id === record.id,
    );
    if (!existing) {
      workspace.conversations.push(record);
      continue;
    }
    const content = (item: Conversation) =>
      JSON.stringify({
        externalId: item.externalId,
        groupId: item.groupId,
        channel: item.channel,
        language: item.language,
        messages: item.messages.map((message) => [
          message.id,
          message.timestamp,
          message.speaker,
          message.text,
        ]),
        audioUrl: item.audioUrl,
      });
    if (content(existing) !== content(record))
      throw new HttpError(
        409,
        "RECORD_CONFLICT",
        "Диалог с этим ID уже содержит другой текст. Используйте новый ID.",
      );
    // Exact repeats preserve saved scores, appeals and current job status.
  }
}

/** Local MVP only. Provider access is explicitly injected and disabled by default. */
export function createApp(options: AppOptions): Server {
  validateChecklist(options.initialChecklist);
  const { store } = options;
  type Job = {
    id: string;
    conversation: Conversation;
    checklist: Checklist;
    controller: AbortController;
  };
  const jobs = new Map<string, Job>();
  const improving = new Map<string, AbortController>();
  const capabilities = () => ({
    evaluationEnabled: Boolean(options.allowEvaluation),
    improvementEnabled: Boolean(options.allowImprovement && options.improve),
  });
  const reply = (response: ServerResponse, status: number, value: unknown) => {
    const workspace = value as Partial<Workspace> | null;
    send(response, status, workspace && Array.isArray(workspace.evaluations) && Array.isArray(workspace.conversations)
      ? { ...workspace, capabilities: capabilities() } : value);
  };
  const fingerprint = (conversation: Conversation, evaluation: Evaluation) =>
    createHash("sha256").update(JSON.stringify({
      recordId: conversation.id, language: conversation.language, channel: conversation.channel,
      messages: conversation.messages, evaluationId: evaluation.id,
      checklist: evaluation.checklist, results: evaluation.results,
      total: evaluation.total, grossViolation: evaluation.grossViolation,
    })).digest("hex");

  async function execute(job: Job) {
    try {
      if (job.controller.signal.aborted) throw new Error("Cancelled");
      const outcome = await options.evaluate({
        conversation: structuredClone(job.conversation),
        checklist: structuredClone(job.checklist),
        signal: job.controller.signal,
      });
      if (job.controller.signal.aborted) throw new Error("Cancelled");
      const evaluation: Evaluation = {
        id: job.id,
        recordId: job.conversation.id,
        createdAt: new Date().toISOString(),
        checklist: structuredClone(job.checklist),
        demo: false,
        results: outcome.results.map((result) => ({
          ...result,
          originalAnswer: result.answer,
          override: undefined,
        })),
        ...(outcome.provenance ? { provenance: outcome.provenance } : {}),
        total: outcome.total,
        originalTotal: outcome.total,
        grossViolation: outcome.grossViolation,
        ...(outcome.contactReason
          ? { contactReason: structuredClone(outcome.contactReason) }
          : {}),
        ...(outcome.classificationError
          ? {
              classificationError: structuredClone(outcome.classificationError),
            }
          : {}),
      };
      await store.mutate((draft) => {
        const record = draft.conversations.find(
          (item) => item.id === job.conversation.id,
        );
        if (!record || jobs.get(record.id) !== job)
          throw new Error("Unknown job");
        draft.evaluations.push(evaluation);
        record.status = "evaluated";
      });
    } catch {
      // Never expose provider messages, headers, prompts or raw output.
      await store
        .mutate((draft) => {
          const record = draft.conversations.find(
            (item) => item.id === job.conversation.id,
          );
          if (record && jobs.get(record.id) === job) record.status = "error";
        })
        .catch(() => undefined);
    } finally {
      if (jobs.get(job.conversation.id) === job)
        jobs.delete(job.conversation.id);
    }
  }

  const classifying = new Set<string>();
  const server = createServer(async (request, response) => {
    try {
      checkLocalRequest(request);
      const path = new URL(request.url || "/", "http://localhost").pathname;
      if (request.method === "GET" && path === "/api/workspace")
        return reply(response, 200, store.snapshot());
      if (request.method !== "POST")
        throw new HttpError(404, "NOT_FOUND", "Маршрут не найден.");
      const input = await body(request);

      if (path === "/api/datasets/import" || path === "/api/datasets/upload") {
        let records: Conversation[];
        if (path.endsWith("/import")) {
          if (field(input, "groupId") !== "DEV")
            throw new HttpError(
              422,
              "UNKNOWN_DATASET",
              "Локально доступен набор DEV.",
            );
          let source: unknown;
          try {
            source = JSON.parse(await readFile(options.datasetPath, "utf8"));
          } catch {
            throw new HttpError(
              503,
              "DATASET_UNAVAILABLE",
              "Локальный набор DEV недоступен.",
            );
          }
          try {
            records = parseDataset(source, "DEV");
          } catch {
            throw new HttpError(
              422,
              "INVALID_DATASET",
              "Проверьте формат набора DEV.",
            );
          }
        } else {
          try {
            records = parseDataset(input, "UPLOAD");
          } catch {
            throw new HttpError(
              422,
              "INVALID_DATASET",
              "Проверьте формат набора UPLOAD.",
            );
          }
          if (
            !records.length ||
            records.some(
              (record) =>
                !record.messages.some((message) => message.text.trim()),
            )
          )
            throw new HttpError(
              422,
              "EMPTY_TRANSCRIPT",
              "Загрузите непустые транскрипты.",
            );
        }
        return reply(
          response,
          200,
          await store.mutate((draft) => mergeConversations(draft, records)),
        );
      }

      if (path === "/api/checklists") {
        let checklist: Checklist;
        try {
          checklist = validateChecklistDraft(input);
        } catch {
          throw new HttpError(
            422,
            "INVALID_CHECKLIST",
            "Проверьте правила, шкалы и веса чек-листа.",
          );
        }
        const workspace = await store.mutate((draft) => {
          const existing = draft.checklists.find(
            (item) => item.id === checklist.id,
          );
          if (existing && checklist.version !== existing.version)
            throw new HttpError(
              409,
              "CHECKLIST_CONFLICT",
              "Чек-лист уже изменён. Обновите его перед сохранением.",
            );
          if (!existing && checklist.version > 1)
            throw new HttpError(
              422,
              "INVALID_VERSION",
              "Новый чек-лист должен начинаться с первой версии.",
            );
          const next = {
            ...checklist,
            version: existing ? existing.version + 1 : 1,
          };
          if (existing)
            draft.checklists[draft.checklists.indexOf(existing)] = next;
          else draft.checklists.push(next);
        });
        return reply(response, 200, workspace);
      }

      const improvementMatch = /^\/api\/evaluations\/([^/]+)\/improvement$/.exec(path);
      if (improvementMatch) {
        if (!options.allowImprovement || !options.improve)
          throw new HttpError(503, "IMPROVEMENT_DISABLED", "Генерация примера отключена. Требуется отдельное разрешение на запрос модели.");
        let evaluationId: string;
        try { evaluationId = decodeURIComponent(improvementMatch[1]); }
        catch { throw new HttpError(422, "INVALID_INPUT", "Некорректный ID анализа."); }
        const snapshot = store.snapshot();
        const evaluation = snapshot.evaluations.find(item => item.id === evaluationId);
        const conversation = snapshot.conversations.find(item => item.id === evaluation?.recordId);
        if (!evaluation || !conversation || evaluation.demo || conversation.demo)
          throw new HttpError(404, "NOT_FOUND", "Сохранённый анализ не найден.");
        const assessmentFingerprint = fingerprint(conversation, evaluation);
        if (evaluation.improvement?.assessmentFingerprint === assessmentFingerprint)
          return reply(response, 200, snapshot);
        if (improving.has(evaluationId))
          throw new HttpError(409, "IMPROVEMENT_BUSY", "Пример уже готовится. Дождитесь результата.");
        const controller = new AbortController();
        improving.set(evaluationId, controller);
        const deadline = setTimeout(() => controller.abort(), 150_000);
        const disconnected = () => { if (!response.writableEnded) controller.abort(); };
        response.on("close", disconnected);
        try {
          let text: string | null;
          try {
            const aborted = new Promise<never>((_, reject) => {
              controller.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
            });
            text = await Promise.race([options.improve({ conversation, evaluation, signal: controller.signal }), aborted]);
            if (text !== null && (typeof text !== "string" || !text.trim() || text.length > 12_000)) throw new Error("Invalid improvement");
          } catch {
            throw new HttpError(502, "IMPROVEMENT_FAILED", "Не удалось получить пример. Сохранённый анализ не изменён. Автоматический повтор не выполнялся.");
          }
          const workspace = await store.mutate(draft => {
            const current = draft.evaluations.find(item => item.id === evaluationId);
            const record = draft.conversations.find(item => item.id === current?.recordId);
            if (!current || !record || fingerprint(record, current) !== assessmentFingerprint)
              throw new HttpError(409, "ANALYSIS_CHANGED", "Анализ изменился во время генерации. Пример не сохранён.");
            current.improvement = { text, assessmentFingerprint, createdAt: new Date().toISOString(), promptVersion: usesCanonicalAnalysis(evaluation.checklist) ? "two-stage-v1/conversation_improvement" : DYNAMIC_IMPROVEMENT_VERSION };
          });
          return reply(response, 200, workspace);
        } finally {
          clearTimeout(deadline);
          response.off("close", disconnected);
          improving.delete(evaluationId);
        }
      }

      const classifyMatch =
        /^\/api\/evaluations\/([^/]+)\/classify-reason$/.exec(path);
      if (classifyMatch) {
        if (!options.classifyReason)
          throw new HttpError(
            503,
            "LOCAL_CLASSIFIER_DISABLED",
            "Локальная Laya не подключена. Запустите сервер с --local-laya.",
          );
        const evaluationId = decodeURIComponent(classifyMatch[1]);
        if (classifying.size)
          throw new HttpError(
            409,
            "CLASSIFICATION_BUSY",
            "Laya уже обрабатывает разговор. Дождитесь результата.",
          );
        const snapshot = store.snapshot();
        const evaluation = snapshot.evaluations.find(
          (item) => item.id === evaluationId,
        );
        const conversation = snapshot.conversations.find(
          (item) => item.id === evaluation?.recordId,
        );
        if (
          !evaluation ||
          !conversation ||
          evaluation.demo ||
          conversation.demo
        )
          throw new HttpError(
            404,
            "NOT_FOUND",
            "Сохранённый анализ не найден.",
          );
        classifying.add(evaluationId);
        try {
          let classified: ContactReason | undefined;
          let classificationError: ClassificationError | undefined;
          try {
            classified = await options.classifyReason(conversation, evaluation);
          } catch (error) {
            classificationError = {
              provider: "laya",
              code: error instanceof LayaError ? error.code : "failed",
              message:
                error instanceof LayaError
                  ? error.message
                  : "Не удалось классифицировать фрагмент локально. Повтор автоматически не выполняется.",
            };
          }
          const workspace = await store.mutate((draft) => {
            const current = draft.evaluations.find(
              (item) => item.id === evaluationId,
            );
            if (!current)
              throw new HttpError(
                404,
                "NOT_FOUND",
                "Анализ больше не доступен.",
              );
            // Update only classification: concurrent review decisions remain intact.
            if (classified) {
              current.contactReason = classified;
              delete current.classificationError;
            } else {
              current.classificationError = classificationError;
            }
          });
          return reply(response, 200, workspace);
        } finally {
          classifying.delete(evaluationId);
        }
      }

      if (path === "/api/evaluations") {
        if (!options.allowEvaluation)
          throw new HttpError(
            503,
            "EVALUATION_DISABLED",
            "Вызовы модели отключены. Требуется отдельное разрешение на тест.",
          );
        const recordId = field(input, "recordId"),
          checklistId = field(input, "checklistId");
        let created: Job | undefined;
        const workspace = await store.mutate((draft) => {
          const record = draft.conversations.find(
            (item) => item.id === recordId,
          );
          const checklist = draft.checklists.find(
            (item) => item.id === checklistId,
          );
          if (!record || !checklist)
            throw new HttpError(
              404,
              "NOT_FOUND",
              "Диалог или чек-лист не найден.",
            );
          if (record.status === "evaluating") {
            const active = jobs.get(recordId);
            if (active && active.checklist.id !== checklistId)
              throw new HttpError(
                409,
                "ALREADY_EVALUATING",
                "Этот диалог уже оценивается по другому чек-листу.",
              );
            return;
          }
          if (!record.messages.some((message) => message.text.trim()))
            throw new HttpError(422, "EMPTY_TRANSCRIPT", "Транскрипт пуст.");
          created = {
            id: `evaluation:${randomUUID()}`,
            conversation: structuredClone(record),
            checklist: structuredClone(checklist),
            controller: new AbortController(),
          };
          record.status = "evaluating";
        });
        if (created) jobs.set(recordId, created);
        reply(response, 202, workspace);
        if (created) {
          const job = created;
          setImmediate(() => {
            void execute(job);
          });
        }
        return;
      }

      if (path === "/api/appeals") {
        const evaluationId = field(input, "evaluationId"),
          criterionId = field(input, "criterionId"),
          comment = field(input, "comment", 4000);
        return reply(
          response,
          200,
          await store.mutate((draft) => {
            const evaluation = draft.evaluations.find(
              (item) => item.id === evaluationId,
            );
            if (
              !evaluation?.results.some(
                (result) => result.criterionId === criterionId,
              )
            )
              throw new HttpError(
                404,
                "NOT_FOUND",
                "Результат критерия не найден.",
              );
            if (
              draft.appeals.some(
                (item) =>
                  item.evaluationId === evaluationId &&
                  item.criterionId === criterionId &&
                  item.status === "pending",
              )
            )
              return;
            draft.appeals.push({
              id: `appeal:${randomUUID()}`,
              recordId: evaluation.recordId,
              evaluationId,
              criterionId,
              comment,
              createdAt: new Date().toISOString(),
              status: "pending",
            });
          }),
        );
      }

      const decisionPath = /^\/api\/appeals\/([^/]+)\/decision$/.exec(path);
      if (decisionPath) {
        let appealId: string;
        try {
          appealId = decodeURIComponent(decisionPath[1]);
        } catch {
          throw new HttpError(
            422,
            "INVALID_INPUT",
            "Некорректный ID обращения.",
          );
        }
        const reason = field(input, "reason", 4000),
          action = input.action;
        if (action !== "confirm" && action !== "change")
          throw new HttpError(
            422,
            "INVALID_DECISION",
            "Выберите действие проверяющего.",
          );
        return reply(
          response,
          200,
          await store.mutate((draft) => {
            const appeal = draft.appeals.find((item) => item.id === appealId);
            if (!appeal)
              throw new HttpError(404, "NOT_FOUND", "Обращение не найдено.");
            if (appeal.status !== "pending")
              throw new HttpError(
                409,
                "ALREADY_RESOLVED",
                "Обращение уже рассмотрено.",
              );
            const evaluation = draft.evaluations.find(
              (item) => item.id === appeal.evaluationId,
            )!;
            const criterion = evaluation.checklist.criteria.find(
              (item) => item.id === appeal.criterionId,
            )!;
            const result = evaluation.results.find(
              (item) => item.criterionId === appeal.criterionId,
            )!;
            const answer = action === "confirm" ? result.answer : input.answer;
            if (
              !(
                answer === null ||
                typeof answer === "number" ||
                typeof answer === "boolean"
              ) ||
              !validAnswer(criterion, answer)
            )
              throw new HttpError(
                422,
                "INVALID_ANSWER",
                "Выберите допустимый ответ по исходному чек-листу.",
              );
            appeal.status = "resolved";
            appeal.decision = {
              action,
              answer,
              reason,
              createdAt: new Date().toISOString(),
            };
            if (action === "change") {
              delete evaluation.improvement;
              result.answer = answer;
              result.override = { answer, reason, appealId };
              if (answer === null) result.naReason = reason;
              else delete result.naReason;
              const revised = options.recalculate(structuredClone(evaluation));
              if (
                revised.id !== evaluation.id ||
                revised.recordId !== evaluation.recordId ||
                revised.originalTotal !== evaluation.originalTotal ||
                JSON.stringify(revised.checklist) !==
                  JSON.stringify(evaluation.checklist) ||
                revised.results.some(
                  (item) =>
                    item.originalAnswer !==
                    evaluation.results.find(
                      (original) => original.criterionId === item.criterionId,
                    )?.originalAnswer,
                )
              )
                throw new Error("Invalid recalculation");
              draft.evaluations[draft.evaluations.indexOf(evaluation)] =
                revised;
            }
          }),
        );
      }
      throw new HttpError(404, "NOT_FOUND", "Маршрут не найден.");
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        if (error instanceof HttpError)
          reply(response, error.status, {
            code: error.code,
            message: error.message,
          });
        else
          reply(response, 500, {
            code: "INTERNAL_ERROR",
            message:
              "Не удалось сохранить действие. Обновите данные и попробуйте снова.",
          });
      }
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.maxRequestsPerSocket = 100;
  server.on("close", () => {
    for (const job of jobs.values()) job.controller.abort();
    for (const controller of improving.values()) controller.abort();
  });
  return server;
}
