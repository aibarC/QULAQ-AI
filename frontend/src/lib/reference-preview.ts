import { z } from "zod";
import type { Checklist, Conversation, Evaluation } from "./types";
import { defaultChecklist } from "./fixtures";
const annotation = z.object({
  answers: z.tuple([
    z.boolean(),
    z.boolean().nullable(),
    z.boolean().nullable(),
    z
      .union([
        z.literal(0),
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(20),
      ])
      .nullable(),
    z.boolean(),
    z.union([z.literal(0), z.literal(4), z.literal(7), z.literal(10)]),
    z.boolean().nullable(),
    z.boolean(),
  ]),
  explanations: z.array(z.string()).length(8),
});
export type ReferenceAnnotation = z.infer<typeof annotation>;
export async function loadReferenceAnnotations(): Promise<
  Record<string, ReferenceAnnotation>
> {
  const response = await fetch("/__local/annotations", {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "Файл предпросмотра Excel недоступен. Проверьте локальные материалы.",
    );
  return z.record(z.string(), annotation).parse(await response.json());
}
/** Read-only source snapshot, independent of editable/server checklists. Never persisted as an evaluation. */
export function buildReferenceEvaluation(
  conversation: Conversation,
  _checklist: Checklist,
  source: ReferenceAnnotation,
): Evaluation {
  const checked = annotation.parse(source);
  const checklist = structuredClone(defaultChecklist);
  checklist.id = "excel-reference";
  checklist.name = "Чек-лист из материалов хакатона";
  const descriptions = [
    "Оператор поздоровался на языке клиента и представился в первом ответе.",
    "Оператор учёл известные детали и уточнил недостающее до ответа.",
    "Проверка личности подтверждена до раскрытия данных или защищённого действия.",
    "Корректность и полнота решения запроса или следующего шага.",
    "Вежливость и реакция на конкретную проблему при недовольстве клиента.",
    "Ясность, последовательность, грамотность и предупреждение об ожидании.",
    "Итог или предложение дальнейшей помощи и прощание.",
    "Оскорбление, платная услуга в обход компании или раскрытие конфиденциальных данных.",
  ];
  const na = [
    "",
    "Данных хватало с самого начала.",
    "Запрос не требовал идентификации.",
    "Чат закончился до формулировки запроса.",
    "",
    "",
    "Чат оборвался до возможности завершения.",
    "",
  ];
  checklist.criteria.forEach((c, i) => {
    c.description = descriptions[i];
    c.allowNA = !!na[i];
    c.naCondition = na[i];
  });
  checklist.criteria[3].scale = [
    {
      value: 0,
      label: "Ответа по существу нет или ключевая рекомендация ошибочна",
    },
    { value: 5, label: "Общая подсказка без понятного следующего действия" },
    { value: 10, label: "Существенный вопрос остался открытым" },
    {
      value: 15,
      label: "Основной вопрос решён, пропущена второстепенная деталь",
    },
    {
      value: 20,
      label:
        "Все существенные вопросы закрыты или дан корректный следующий шаг",
    },
  ];
  checklist.criteria[5].scale = [
    { value: 0, label: "Ход диалога непонятен" },
    {
      value: 4,
      label: "Клиент вынужден переспрашивать из-за формулировок или порядка",
    },
    { value: 7, label: "Один заметный сбой, но клиент может продолжить" },
    { value: 10, label: "Ясные связные ответы и предупреждение при ожидании" },
  ];
  const applicable = checklist.criteria.reduce(
    (sum, c, i) => sum + (checked.answers[i] !== null ? c.weight : 0),
    0,
  );
  const results = checklist.criteria.map((criterion, i) => {
    const answer = checked.answers[i];
    const raw =
      answer === null
        ? 0
        : criterion.type === "flag"
          ? 0
          : typeof answer === "boolean"
            ? answer
              ? criterion.weight
              : 0
            : (answer / Math.max(...criterion.scale.map((s) => s.value))) *
              criterion.weight;
    const ids = [
      ...new Set(
        [...checked.explanations[i].matchAll(/\bm(\d+)\b/g)]
          .map((m) => conversation.messages[Number(m[1]) - 1]?.id)
          .filter((id): id is string => !!id),
      ),
    ];
    return {
      criterionId: criterion.id,
      answer,
      originalAnswer: answer,
      points:
        criterion.type === "flag"
          ? null
          : applicable
            ? (raw * 100) / applicable
            : 0,
      explanation: checked.explanations[i],
      evidence: ids.length
        ? [
            {
              messageIds: ids,
              quote: conversation.messages
                .filter((m) => ids.includes(m.id))
                .map((m) => m.text)
                .join("\n"),
              kind: "quote" as const,
            },
          ]
        : [],
      ...(answer === null ? { naReason: checked.explanations[i] } : {}),
    };
  });
  const total = applicable
    ? Math.round(results.reduce((sum, r) => sum + (r.points ?? 0), 0) * 100) /
      100
    : null;
  return {
    id: `reference:${conversation.id}`,
    recordId: conversation.id,
    createdAt: new Date().toISOString(),
    checklist,
    results,
    total,
    originalTotal: total,
    grossViolation: checked.answers[7],
    demo: true,
  };
}
