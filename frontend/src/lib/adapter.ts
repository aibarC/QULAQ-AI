import type {
  Checklist,
  DecisionInput,
  Workspace,
  WorkspaceAdapter,
} from "./types";
import {
  defaultChecklist,
  demoConversation,
  makeDemoEvaluation,
  updateDemoTotals,
} from "./fixtures";
import {
  parseDataset,
  parseWorkspace,
  validAnswer,
  validateChecklistDraft,
} from "./validation";

const STORAGE_KEY = "qulaq:teaching-workspace:v1";
const IMPORT_KEY = "qulaq:local-dev-imported:v1";
const clone = <T>(value: T): T => structuredClone(value);
const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
type StoragePort = Pick<Storage, "getItem" | "setItem">;
type LocalOptions = {
  storage?: StoragePort | null;
  fetcher?: typeof fetch;
  delay?: number;
};

/** Preserve the latest confirmed server state even when an operation cannot complete. */
export class AdapterStateError extends Error {
  readonly workspace: Workspace;
  readonly outcomeUnknown: boolean;
  constructor(message: string, workspace: Workspace, outcomeUnknown = false) {
    super(message);
    this.name = "AdapterStateError";
    this.workspace = clone(workspace);
    this.outcomeUnknown = outcomeUnknown;
  }
}

function browserStorage(): StoragePort | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
function initialWorkspace(): Workspace {
  return {
    conversations: [clone(demoConversation)],
    checklists: [clone(defaultChecklist)],
    evaluations: [],
    appeals: [],
  };
}
class EvaluationDisabledError extends Error {}
async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    if (response.status === 503) {
      const error = await response.json().catch(() => null);
      if (error?.code === "EVALUATION_DISABLED")
        throw new EvaluationDisabledError(
          "Сервер подключён. Вызовы модели отключены: анализ станет доступен после отдельного разрешения на тест.",
        );
    }
    if (response.status === 401 || response.status === 403)
      throw new Error(
        "Нет доступа к серверу. Проверьте подключение и права доступа.",
      );
    if (response.status === 404)
      throw new Error(
        "Данные не найдены. Проверьте набор и подключение сервера.",
      );
    if (response.status === 409)
      throw new Error(
        "Данные уже изменились. Обновите страницу и повторите действие.",
      );
    if (response.status === 422)
      throw new Error("Сервер отклонил данные. Проверьте поля формы.");
    if (response.status === 429)
      throw new Error("Слишком много запросов. Повторите немного позже.");
    throw new Error("Сервер недоступен. Повторите запрос позже.");
  }
  const source = await response.text();
  if (source.length > 15_000_000)
    throw new Error("Ответ слишком большой. Загрузите меньший набор.");
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("Сервер вернул некорректный ответ.");
  }
}
async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetcher(url, {
      ...options,
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        "Время ожидания истекло. Результат запроса неизвестен — обновите данные перед повторной отправкой.",
      );
    throw new Error(
      error instanceof Error && error.message === "Failed to fetch"
        ? "Не удалось связаться с сервером. Проверьте соединение."
        : "Не удалось выполнить запрос. Проверьте соединение с сервером.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createLocalAdapter(
  options: LocalOptions = {},
): WorkspaceAdapter {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const fetcher =
    options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const delay = options.delay ?? 450;
  let state = initialWorkspace();
  let loaded = false;
  let devImported = false;
  let chain = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = chain.then(operation, operation);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const persist = (next: Workspace) => {
    // Real DEV transcripts/audio URLs never enter browser storage.
    const teaching: Workspace = {
      conversations: next.conversations.filter((row) => row.demo),
      checklists: next.checklists,
      evaluations: next.evaluations.filter((row) => row.demo),
      appeals: next.appeals.filter((row) =>
        next.evaluations.some((e) => e.id === row.evaluationId && e.demo),
      ),
    };
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(teaching));
      if (devImported) storage?.setItem(IMPORT_KEY, "1");
    } catch {
      /* The workspace remains usable in memory if browser storage is disabled/full. */
    }
  };
  const commit = (next: Workspace): Workspace => {
    state = parseWorkspace(next);
    persist(state);
    return clone(state);
  };
  async function readDev(): Promise<Workspace["conversations"]> {
    const response = await fetchWithTimeout(fetcher, "/__local/dataset");
    return parseDataset(await readResponse(response), "DEV");
  }
  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    try {
      const saved = storage?.getItem(STORAGE_KEY);
      if (saved) {
        const restored = parseWorkspace(JSON.parse(saved));
        // Reject a tampered storage entry containing real data.
        if (
          restored.conversations.every(
            (c) => c.demo === true && c.id === demoConversation.id,
          ) &&
          restored.evaluations.every(
            (e) => e.demo && e.recordId === demoConversation.id,
          )
        )
          state = restored;
      }
    } catch {
      state = initialWorkspace();
    }
    if (storage?.getItem(IMPORT_KEY) === "1") {
      const records = await readDev();
      state.conversations = [
        ...state.conversations.filter((row) => row.demo),
        ...records,
      ];
      devImported = true;
    }
    loaded = true;
  }
  return {
    mode: "local",
    uploadDataset: async () => {
      throw new Error("Для сохранения файла подключите локальный сервер.");
    },
    load: () =>
      serialize(async () => {
        await ensureLoaded();
        await wait(delay / 2);
        return clone(state);
      }),
    importDataset: (groupId) =>
      serialize(async () => {
        await ensureLoaded();
        if (groupId.trim().toUpperCase() !== "DEV")
          throw new Error(
            "Локально доступен набор DEV. Для других наборов подключите сервер.",
          );
        const records = await readDev();
        await wait(delay);
        const next = clone(state);
        const existing = new Map(
          next.conversations.map((row) => [row.id, row]),
        );
        for (const record of records)
          existing.set(record.id, {
            ...record,
            status: existing.get(record.id)?.status ?? record.status,
          });
        next.conversations = [...existing.values()];
        devImported = true;
        return commit(next);
      }),
    saveChecklist: (input) =>
      serialize(async () => {
        await ensureLoaded();
        const checked = validateChecklistDraft(input);
        const next = clone(state);
        const existing = next.checklists.find((row) => row.id === checked.id);
        if (existing && checked.version !== existing.version)
          throw new Error("Чек-лист уже изменён. Откройте актуальную версию.");
        const saved = {
          ...checked,
          version: existing ? existing.version + 1 : 1,
        };
        next.checklists = [
          ...next.checklists.filter((row) => row.id !== checked.id),
          saved,
        ];
        await wait(delay);
        return commit(next);
      }),
    evaluate: (recordId, checklistId) =>
      serialize(async () => {
        await ensureLoaded();
        const record = state.conversations.find((row) => row.id === recordId);
        const checklist = state.checklists.find(
          (row) => row.id === checklistId,
        );
        if (!record || !checklist)
          throw new Error("Диалог или чек-лист не найден. Обновите данные.");
        if (!record.demo) {
          await wait(delay);
          throw new Error(
            "Для оценки реальных диалогов подключите сервер aibarC. Полный учебный сценарий доступен в DEMO-001.",
          );
        }
        const next = clone(state);
        const evaluation = makeDemoEvaluation(checklist);
        next.evaluations.push(evaluation);
        next.conversations = next.conversations.map((row) =>
          row.id === recordId ? { ...row, status: "evaluated" } : row,
        );
        await wait(delay === 0 ? 0 : 1150);
        return commit(next);
      }),
    createAppeal: (evaluationId, criterionId, comment) =>
      serialize(async () => {
        await ensureLoaded();
        if (!comment.trim() || comment.trim().length > 4000)
          throw new Error(
            "Добавьте причину обращения — от 1 до 4000 символов.",
          );
        const evaluation = state.evaluations.find(
          (row) => row.id === evaluationId,
        );
        if (
          !evaluation?.demo ||
          !evaluation.results.some((row) => row.criterionId === criterionId)
        )
          throw new Error("Оценка или критерий не найден.");
        const existing = state.appeals.find(
          (row) =>
            row.evaluationId === evaluationId &&
            row.criterionId === criterionId &&
            row.status === "pending",
        );
        if (existing) return clone(state);
        const next = clone(state);
        next.appeals.push({
          id: `demo-appeal-${crypto.randomUUID()}`,
          recordId: evaluation.recordId,
          evaluationId,
          criterionId,
          comment: comment.trim(),
          createdAt: new Date().toISOString(),
          status: "pending",
        });
        await wait(delay);
        return commit(next);
      }),
    resolveAppeal: (appealId, decision) =>
      serialize(async () => {
        await ensureLoaded();
        if (!decision.reason.trim() || decision.reason.trim().length > 4000)
          throw new Error("Добавьте причину решения — от 1 до 4000 символов.");
        if (!["confirm", "change"].includes(decision.action))
          throw new Error("Выберите действие проверяющего.");
        const next = clone(state);
        const appeal = next.appeals.find((row) => row.id === appealId);
        if (!appeal || appeal.status !== "pending")
          throw new Error("Обращение уже рассмотрено или не найдено.");
        const evaluation = next.evaluations.find(
          (row) => row.id === appeal.evaluationId,
        );
        const criterion = evaluation?.checklist.criteria.find(
          (row) => row.id === appeal.criterionId,
        );
        const result = evaluation?.results.find(
          (row) => row.criterionId === appeal.criterionId,
        );
        if (!evaluation || !criterion || !result)
          throw new Error("Исходная оценка не найдена.");
        const answer =
          decision.action === "confirm" ? result.answer : decision.answer;
        if (!validAnswer(criterion, answer))
          throw new Error(
            "Выберите допустимое значение из шкалы исходного критерия.",
          );
        appeal.status = "resolved";
        appeal.decision = {
          ...decision,
          answer,
          reason: decision.reason.trim(),
          createdAt: new Date().toISOString(),
        };
        if (decision.action === "change") {
          result.answer = answer;
          result.override = {
            answer,
            reason: decision.reason.trim(),
            appealId,
          };
          if (answer === null) result.naReason = decision.reason.trim();
          else delete result.naReason;
          updateDemoTotals(evaluation);
        }
        await wait(delay);
        return commit(next);
      }),
  };
}

/**
 * Proposed HTTP integration, pending agreement with aibarC. Every endpoint returns
 * a complete validated Workspace; mutation responses must be confirmed server state.
 * POST evaluations may return a workspace with status=evaluating; GET workspace is polled.
 * No failed HTTP operation falls back to mock data. Mutations are not automatically retried.
 */
export function createApiAdapter(
  baseUrl: string,
  fetcher: typeof fetch = (...args) => fetch(...args),
  timing: { pollIntervalMs?: number; evaluationTimeoutMs?: number } = {},
): WorkspaceAdapter {
  const pollInterval = timing.pollIntervalMs ?? 1000;
  const evaluationTimeout = timing.evaluationTimeoutMs ?? 120_000;
  let latest: Workspace | undefined;
  let requestSequence = 0;
  let latestSequence = 0;
  const base = baseUrl.replace(/\/$/, "");
  if (!/^\/api(?:\/[a-zA-Z0-9_-]+)*$/.test(base))
    throw new Error("API должен использовать путь этого сайта, например /api.");
  const request = async (path: string, data?: unknown): Promise<Workspace> => {
    const sequence = ++requestSequence;
    const response = await fetchWithTimeout(
      fetcher,
      `${base}${path}`,
      data === undefined
        ? { method: "GET" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          },
    );
    const confirmed = parseWorkspace(await readResponse(response));
    if (sequence >= latestSequence) {
      latest = confirmed;
      latestSequence = sequence;
    }
    return clone(confirmed);
  };
  return {
    mode: "api",
    uploadDataset: (dataset) => {
      parseDataset(dataset, "UPLOAD");
      return request("/datasets/upload", dataset);
    },
    load: () => request("/workspace"),
    importDataset: (groupId) => {
      if (!/^[\w-]{1,100}$/.test(groupId.trim()))
        return Promise.reject(new Error("Укажите корректное имя набора."));
      return request("/datasets/import", { groupId: groupId.trim() });
    },
    saveChecklist: (checklist: Checklist) => {
      const checked = validateChecklistDraft(checklist);
      return request("/checklists", {
        ...checked,
        version: checked.version === 0 ? 1 : checked.version,
      });
    },
    evaluate: async (recordId, checklistId) => {
      // Establish a genuine baseline before any mutation; never invent API state.
      if (!latest) await request("/workspace");
      const baselineRuns = new Map(
        latest!.evaluations.map((run) => [run.id, JSON.stringify(run)]),
      );
      const knownPendingRuns = new Set<string>();
      const observePendingRun = (workspace: Workspace) => {
        if (
          workspace.conversations.find((row) => row.id === recordId)?.status !==
          "evaluating"
        )
          return;
        // The contract has a conversation status, not a per-run status. Only
        // its latest matching run observed in progress may reuse an existing ID.
        const run = workspace.evaluations
          .filter(
            (item) =>
              item.recordId === recordId && item.checklist.id === checklistId,
          )
          .at(-1);
        if (run && baselineRuns.has(run.id)) knownPendingRuns.add(run.id);
      };
      observePendingRun(latest!);
      let initialResponseConfirmed = false;
      try {
        let workspace = await request("/evaluations", {
          recordId,
          checklistId,
        });
        initialResponseConfirmed = true;
        const deadline = Date.now() + evaluationTimeout;
        while (
          workspace.conversations.find((row) => row.id === recordId)?.status ===
          "evaluating"
        ) {
          observePendingRun(workspace);
          if (Date.now() >= deadline)
            throw new AdapterStateError(
              "Оценка ещё выполняется. Обновите данные позже — новый запуск не требуется.",
              workspace,
            );
          await wait(
            Math.min(pollInterval, Math.max(0, deadline - Date.now())),
          );
          if (Date.now() >= deadline)
            throw new AdapterStateError(
              "Оценка ещё выполняется. Обновите данные позже — новый запуск не требуется.",
              workspace,
            );
          workspace = await request("/workspace");
        }
        const record = workspace.conversations.find(
          (row) => row.id === recordId,
        );
        if (record?.status !== "evaluated")
          throw new AdapterStateError(
            "Не удалось завершить оценку. Обновите данные и проверьте состояние сервера.",
            workspace,
          );
        const confirmedRun = workspace.evaluations.some(
          (run) =>
            run.recordId === recordId &&
            run.checklist.id === checklistId &&
            (!baselineRuns.has(run.id) ||
              (knownPendingRuns.has(run.id) &&
                baselineRuns.get(run.id) !== JSON.stringify(run))),
        );
        if (!confirmedRun)
          throw new AdapterStateError(
            "Сервер не подтвердил новую оценку выбранного диалога и чек-листа. Обновите данные и проверьте историю перед повторным запуском.",
            workspace,
          );
        return workspace;
      } catch (error) {
        if (error instanceof AdapterStateError) throw error;
        if (error instanceof EvaluationDisabledError)
          throw new AdapterStateError(error.message, latest!);
        if (!initialResponseConfirmed) {
          // A failed response does not prove that the server rejected the launch.
          // Reconcile by reading once. The POST must never be retried automatically.
          try {
            const reconciled = await request("/workspace");
            throw new AdapterStateError(
              "Ответ на запуск оценки не получен. Данные обновлены с сервера — проверьте статус и историю перед новым запуском.",
              reconciled,
            );
          } catch (reconcileError) {
            if (reconcileError instanceof AdapterStateError)
              throw reconcileError;
            if (latest)
              throw new AdapterStateError(
                "Результат запуска неизвестен: не удалось обновить данные с сервера. Сначала восстановите соединение и обновите данные; не запускайте оценку повторно.",
                latest,
                true,
              );
            throw reconcileError;
          }
        }
        if (latest)
          throw new AdapterStateError(
            error instanceof Error
              ? error.message
              : "Не удалось завершить оценку.",
            latest,
          );
        throw error;
      }
    },
    createAppeal: (evaluationId, criterionId, comment) => {
      if (!comment.trim() || comment.trim().length > 4000)
        return Promise.reject(
          new Error("Добавьте причину обращения — от 1 до 4000 символов."),
        );
      return request("/appeals", {
        evaluationId,
        criterionId,
        comment: comment.trim(),
      });
    },
    resolveAppeal: (appealId, decision: DecisionInput) => {
      if (!decision.reason.trim() || decision.reason.trim().length > 4000)
        return Promise.reject(
          new Error("Добавьте причину решения — от 1 до 4000 символов."),
        );
      return request(`/appeals/${encodeURIComponent(appealId)}/decision`, {
        ...decision,
        reason: decision.reason.trim(),
      });
    },
  };
}

const environment = (
  import.meta as ImportMeta & { env?: Record<string, string> }
).env;
export const adapter: WorkspaceAdapter = environment?.VITE_API_BASE_URL
  ? createApiAdapter(environment.VITE_API_BASE_URL)
  : createLocalAdapter();
