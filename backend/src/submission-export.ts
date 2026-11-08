import type { Workspace, Criterion, Answer } from "../../frontend/src/lib/types.ts";
import { initialChecklist, recalculate } from "./scoring.ts";
import { legacyC6 } from "./checklist-migrations.ts";

export class SubmissionExportError extends Error {
  readonly code = "SUBMISSION_INVALID";
}
export interface SubmissionOptions { groupId: string; teamName: string; expectedCount: 65 | 10; fallbackModelName?: string }
const codes = ["contact", "discovery", "identification", "consultation", "empathy", "dialogue", "closure", "critical"];
function fail(message: string): never { throw new SubmissionExportError(message); }
function same(a: Criterion, b: Criterion) {
  return Object.keys(b).every((key) => JSON.stringify(a[key as keyof Criterion]) === JSON.stringify(b[key as keyof Criterion]));
}
export function buildSubmission(workspace: Workspace, options: SubmissionOptions) {
  if (!options || typeof options.groupId !== "string" || !options.groupId.trim() || typeof options.teamName !== "string" || !options.teamName.trim() || ![65, 10].includes(options.expectedCount))
    fail("Укажите группу, название команды и expectedCount 65 или 10.");
  const records = workspace.conversations.filter((r) => r.groupId === options.groupId);
  if (records.length !== options.expectedCount) fail(`В группе ${options.groupId} нужно ${options.expectedCount} диалогов, найдено ${records.length}. Импортируйте полный набор.`);
  if (new Set(records.map((r) => r.externalId)).size !== records.length || records.some((r) => !r.externalId.trim())) fail("Исходные conversation_id группы пусты или повторяются.");
  if (records.some((r) => r.status === "evaluating")) fail("Дождитесь завершения текущих оценок перед экспортом.");
  const models = new Set<string>();
  const results = records.map((record) => {
    const runs = workspace.evaluations.filter((e) => e.recordId === record.id && !e.demo);
    // Saved evaluations are appended in completion order; do not fall back past a custom latest run.
    const evaluation = runs.at(-1);
    if (record.demo || record.status !== "evaluated" || !evaluation)
      return { conversation_id: record.externalId, status: "error" as const, criteria: [], score: null, error: record.status === "error" ? "Последняя оценка диалога завершилась ошибкой." : "Нет завершённой реальной оценки диалога." };
    const checklist = evaluation.checklist;
    if (checklist.criteria.length !== 8 || new Set(checklist.criteria.map((c) => c.id)).size !== 8 || !initialChecklist.criteria.every((standard) => {
      const c = checklist.criteria.find((c) => c.id === standard.id);
      return c && (same(c, standard) || (c.id === "c6" && same(c, legacyC6)));
    })) fail(`${record.externalId}: последняя оценка использует изменённый чек-лист. Для официальной сдачи оцените по исходным восьми правилам и весам; старый результат автоматически не подставляется.`);
    if (!evaluation.provenance?.model?.trim()) fail(`${record.externalId}: у оценки нет подтверждённого названия модели. Нужна оценка с сохранённым provenance.`);
    models.add(evaluation.provenance.model.trim());
    let computed;
    try { computed = recalculate(evaluation); } catch { fail(`${record.externalId}: неполные критерии, недопустимые значения или N/A без причины.`); }
    if (computed.total !== evaluation.total || computed.grossViolation !== evaluation.grossViolation || computed.results.some((r) => r.points !== evaluation.results.find((x) => x.criterionId === r.criterionId)?.points))
      fail(`${record.externalId}: сохранённые баллы или флаг не совпадают с пересчётом. Исправьте оценку перед экспортом.`);
    if (computed.total === null) fail(`${record.externalId}: официальный итог не рассчитан.`);
    const positions = new Map(record.messages.map((m, i) => [m.id, i + 1]));
    if (positions.size !== record.messages.length) fail(`${record.externalId}: повторяются ID реплик.`);
    const criteria = initialChecklist.criteria.map((c, index) => {
      const result = computed.results.find((r) => r.criterionId === c.id)!;
      const rationale = result.override?.reason ?? (result.answer === null ? result.naReason : result.explanation);
      if (!rationale?.trim()) fail(`${record.externalId}/${c.id}: отсутствует обоснование.`);
      const turns = new Set<number>();
      if (!result.evidence.length) fail(`${record.externalId}/${c.id}: отсутствуют доказательства.`);
      for (const evidence of result.evidence) {
        const ids = evidence.messageIds;
        if (!ids.length || new Set(ids).size !== ids.length && !(evidence.kind === "range" && ids.length === 2 && ids[0] === ids[1]) || ids.some((id) => !positions.has(id))) fail(`${record.externalId}/${c.id}: недопустимые ссылки на реплики.`);
        if (evidence.kind === "range") {
          if (positions.get(ids[0])! > positions.get(ids.at(-1)!)! || (ids.length > 2 && ids.some((id, i) => i > 0 && positions.get(id)! !== positions.get(ids[i - 1])! + 1))) fail(`${record.externalId}/${c.id}: неверные границы участка.`);
          for (let i = positions.get(ids[0])!; i <= positions.get(ids.at(-1)!)!; i++) turns.add(i);
        } else if (evidence.kind === "quote") ids.forEach((id) => turns.add(positions.get(id)!));
        else fail(`${record.externalId}/${c.id}: неизвестный вид доказательства.`);
      }
      return { criterion_id: codes[index], value: result.answer as Answer, rationale: rationale.trim(), evidence_turns: [...turns].sort((a, b) => a - b) };
    });
    return { conversation_id: record.externalId, status: "ok" as const, criteria, score: { final_score: computed.total, critical_flag: computed.grossViolation } };
  });
  if (!models.size && options.fallbackModelName?.trim()) models.add(options.fallbackModelName.trim());
  if (!models.size) fail("Нет подтверждённого названия фактически использованной модели. Экспорт не может выдумать model.name.");
  return { schema_version: "1.0" as const, team_name: options.teamName.trim(), model: { mode: "external_api" as const, name: [...models].sort().join(", ") }, results };
}
