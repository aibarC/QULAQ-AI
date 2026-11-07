import type {
  Checklist,
  Conversation,
  Criterion,
  CriterionResult,
  Evaluation,
  Workspace,
} from "./types";

export const MANAGER_REPORT_TIME_ZONE = "Asia/Almaty" as const;
export const MAX_REPORT_DAYS = 366;
export type ManagerReportLanguage = "all" | Conversation["language"];

export interface ManagerReportOptions {
  /** Inclusive calendar dates in Asia/Almaty, never UTC day boundaries. */
  start: string;
  end: string;
  language?: ManagerReportLanguage;
}

export interface ManagerReportRow {
  conversation: Conversation;
  /** Latest real run within the selected period; includes its current adjustments. */
  evaluation: Evaluation;
  day: string;
}

export interface ManagerDailyTrend {
  date: string;
  /** Selected conversations on this day, including those without a numeric total. */
  count: number;
  scoredCount: number;
  /** Unrounded mean of current finite totals, or null when scoredCount is zero. */
  average: number | null;
}

export interface ManagerViolationExample {
  recordId: string;
  externalId: string;
  evaluationId: string;
  criterionId: string;
  messageIds: string[];
}

export interface ManagerViolation {
  /** Includes checklist identity/version and criterion identity/name. */
  key: string;
  checklistId: string;
  checklistName: string;
  checklistVersion: number;
  criterionId: string;
  criterionName: string;
  occurrences: number;
  /** Valid applicable answers in this exact rule group; N/A is excluded. */
  eligible: number;
  /** Fraction 0..1, not a percentage. */
  rate: number;
  examples: ManagerViolationExample[];
}

export interface ManagerReport {
  start: string;
  end: string;
  timeZone: typeof MANAGER_REPORT_TIME_ZONE;
  language: ManagerReportLanguage;
  rows: ManagerReportRow[];
  conversationCount: number;
  scoredCount: number;
  /** Unrounded mean of current adjusted totals, not originalTotal. */
  average: number | null;
  dailyTrend: ManagerDailyTrend[];
  /** Only groups with violations, ordered by occurrences then rate descending. */
  violations: ManagerViolation[];
}

const DAY_MS = 86_400_000;
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MANAGER_REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function calendarDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) {
    throw new RangeError("Укажите даты в формате ГГГГ-ММ-ДД.");
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError("Укажите существующую календарную дату.");
  }
  return timestamp;
}

function localDay(timestamp: number): string {
  const parts = dayFormatter.formatToParts(timestamp);
  const part = (name: string) =>
    parts.find((item) => item.type === name)!.value;
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

function numericTotal(total: number | null): total is number {
  return (
    typeof total === "number" &&
    Number.isFinite(total) &&
    total >= 0 &&
    total <= 100
  );
}

/** null means not eligible (N/A, missing/invalid answer or unusable scale). */
function violationAnswer(
  criterion: Criterion,
  result: CriterionResult,
): boolean | null {
  if (result.answer === null) return null;
  if (criterion.type === "scale") {
    const maximum = Math.max(...criterion.scale.map((option) => option.value));
    if (
      typeof result.answer !== "number" ||
      !Number.isFinite(result.answer) ||
      !Number.isFinite(maximum) ||
      maximum <= 0 ||
      !criterion.scale.some((option) => option.value === result.answer)
    )
      return null;
    return result.answer < maximum;
  }
  if (typeof result.answer !== "boolean") return null;
  return criterion.type === "flag" ? result.answer : !result.answer;
}

function newGroup(
  checklist: Checklist,
  criterion: Criterion,
): ManagerViolation {
  return {
    key: JSON.stringify([
      checklist.id,
      checklist.version,
      criterion.id,
      criterion.name,
    ]),
    checklistId: checklist.id,
    checklistName: checklist.name,
    checklistVersion: checklist.version,
    criterionId: criterion.id,
    criterionName: criterion.name,
    occurrences: 0,
    eligible: 0,
    rate: 0,
    examples: [],
  };
}

/**
 * Pure report over confirmed workspace data. No requests, persistence or score calculation.
 * Pick the newest non-demo run per real conversation *inside* the period. Equal
 * timestamps use the lexicographically greater run ID, independent of array order.
 * Rows retain references to the immutable source snapshots; this function never edits them.
 * Throws RangeError for malformed/reversed dates, unknown language or >366 days.
 */
export function buildManagerReport(
  workspace: Workspace,
  options: ManagerReportOptions,
): ManagerReport {
  const startMs = calendarDate(options.start),
    endMs = calendarDate(options.end);
  const days = (endMs - startMs) / DAY_MS + 1;
  if (days <= 0)
    throw new RangeError("Начало периода должно быть не позже его окончания.");
  if (days > MAX_REPORT_DAYS)
    throw new RangeError(`Выберите период не больше ${MAX_REPORT_DAYS} дней.`);
  const language = options.language ?? "all";
  if (!["all", "RU", "KZ", "EN"].includes(language))
    throw new RangeError("Выберите доступный язык отчёта.");

  const conversations = new Map(
    workspace.conversations
      .filter(
        (record) =>
          !record.demo && (language === "all" || record.language === language),
      )
      .map((record) => [record.id, record]),
  );
  const selected = new Map<string, ManagerReportRow & { timestamp: number }>();
  for (const evaluation of workspace.evaluations) {
    const conversation = conversations.get(evaluation.recordId);
    if (evaluation.demo || !conversation) continue;
    const timestamp = Date.parse(evaluation.createdAt);
    if (!Number.isFinite(timestamp)) continue;
    const day = localDay(timestamp);
    if (day < options.start || day > options.end) continue;
    const previous = selected.get(conversation.id);
    if (
      !previous ||
      timestamp > previous.timestamp ||
      (timestamp === previous.timestamp &&
        compareText(evaluation.id, previous.evaluation.id) > 0)
    ) {
      selected.set(conversation.id, {
        conversation,
        evaluation,
        day,
        timestamp,
      });
    }
  }
  const rows: ManagerReportRow[] = [...selected.values()]
    .sort(
      (a, b) =>
        b.timestamp - a.timestamp ||
        compareText(a.conversation.id, b.conversation.id),
    )
    .map(({ conversation, evaluation, day }) => ({
      conversation,
      evaluation,
      day,
    }));

  const daily = new Map<string, ManagerDailyTrend & { total: number }>();
  for (let offset = 0; offset < days; offset++) {
    const date = new Date(startMs + offset * DAY_MS).toISOString().slice(0, 10);
    daily.set(date, {
      date,
      count: 0,
      scoredCount: 0,
      average: null,
      total: 0,
    });
  }
  const violations = new Map<string, ManagerViolation>();
  let total = 0,
    scoredCount = 0;
  for (const row of rows) {
    const day = daily.get(row.day)!;
    day.count++;
    if (numericTotal(row.evaluation.total)) {
      total += row.evaluation.total;
      scoredCount++;
      day.total += row.evaluation.total;
      day.scoredCount++;
    }
    const messages = new Set(
      row.conversation.messages.map((message) => message.id),
    );
    for (const criterion of row.evaluation.checklist.criteria) {
      const result = row.evaluation.results.find(
        (item) => item.criterionId === criterion.id,
      );
      if (!result) continue;
      const isViolation = violationAnswer(criterion, result);
      if (isViolation === null) continue;
      const group = newGroup(row.evaluation.checklist, criterion);
      const accumulated = violations.get(group.key) ?? group;
      accumulated.eligible++;
      if (isViolation) {
        accumulated.occurrences++;
        accumulated.examples.push({
          recordId: row.conversation.id,
          externalId: row.conversation.externalId,
          evaluationId: row.evaluation.id,
          criterionId: criterion.id,
          messageIds: [
            ...new Set(result.evidence.flatMap((item) => item.messageIds)),
          ].filter((id) => messages.has(id)),
        });
      }
      violations.set(group.key, accumulated);
    }
  }
  return {
    start: options.start,
    end: options.end,
    timeZone: MANAGER_REPORT_TIME_ZONE,
    language,
    rows,
    conversationCount: rows.length,
    scoredCount,
    average: scoredCount ? total / scoredCount : null,
    dailyTrend: [...daily.values()].map(({ total: dayTotal, ...day }) => ({
      ...day,
      average: day.scoredCount ? dayTotal / day.scoredCount : null,
    })),
    violations: [...violations.values()]
      .filter((group) => group.occurrences > 0)
      .map((group) => ({ ...group, rate: group.occurrences / group.eligible }))
      .sort(
        (a, b) =>
          b.occurrences - a.occurrences ||
          b.rate - a.rate ||
          compareText(a.criterionName, b.criterionName) ||
          compareText(a.key, b.key),
      ),
  };
}
