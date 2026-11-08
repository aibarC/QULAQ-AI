import type { Criterion, Workspace } from "../../frontend/src/lib/types.ts";

// Frozen legacy definition: never derive this match from the evolving default.
export const legacyC6: Criterion = {
  id: "c6",
  name: "Управление диалогом, скорость и грамотность",
  type: "scale",
  weight: 15,
  description: "Оцените ясность, порядок ответов и предупреждение об ожидании. Порог первой реакции в 3 минуты, теги и вложения исключены. Не смешивайте качество общения с полнотой решения запроса.",
  allowNA: false,
  naCondition: "",
  scale: [
    { value: 0, label: "Из-за бессвязных или противоречивых реплик ход диалога непонятен." },
    { value: 4, label: "Клиенту приходится переспрашивать из-за формулировок или порядка ответов." },
    { value: 7, label: "Один заметный сбой, но клиент может понять ответ и продолжить." },
    { value: 10, label: "Ответы ясные и связные. Если было явное ожидание, оператор предупредил." },
  ],
};

/** Upgrade only the unedited official C6; saved evaluations and appeals are untouched. */
export function migrateLegacyChecklist(workspace: Workspace): boolean {
  const checklist = workspace.checklists.find((item) => item.id === "official-cqa");
  const criterion = checklist?.criteria.find((item) => item.id === "c6");
  if (!checklist || !criterion) return false;
  const matches = Object.entries(legacyC6).every(([key, value]) =>
    JSON.stringify(criterion[key as keyof Criterion]) === JSON.stringify(value),
  );
  if (!matches) return false;
  criterion.name = "Управление диалогом и грамотность";
  criterion.description = "Оцените ясность, порядок ответов и предупреждение об ожидании. Не смешивайте качество общения с полнотой решения запроса.";
  checklist.version += 1;
  return true;
}
