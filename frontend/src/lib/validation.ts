import { z } from "zod";
import type {
  Answer,
  Checklist,
  Conversation,
  Criterion,
  Workspace,
} from "./types";

const id = z.string().min(1).max(300);
const text = z.string().max(200_000);
const answer = z.union([z.number().finite(), z.boolean(), z.null()]);
const audio = z
  .string()
  .max(8000)
  .refine((value) => {
    try {
      return ["https:", "http:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Недопустимая ссылка на аудио")
  .nullable();
const scale = z.object({
  value: z.number().finite().nonnegative(),
  label: z.string().trim().min(1).max(500),
});
export const criterionSchema = z
  .object({
    id,
    name: z.string().trim().min(1, "Укажите название критерия").max(150),
    description: z
      .string()
      .trim()
      .min(1, "Укажите формулировку критерия")
      .max(4000),
    type: z.enum(["boolean", "scale", "flag"]),
    weight: z.number().finite().min(0).max(1000),
    allowNA: z.boolean(),
    naCondition: z.string().max(2000),
    scale: z.array(scale).max(30),
  })
  .superRefine((criterion, context) => {
    if (criterion.type === "flag" && criterion.weight !== 0)
      context.addIssue({
        code: "custom",
        path: ["weight"],
        message: "Безбалльный критерий должен иметь вес 0",
      });
    if (criterion.type !== "flag" && criterion.weight <= 0)
      context.addIssue({
        code: "custom",
        path: ["weight"],
        message: "Вес должен быть больше нуля",
      });
    if (criterion.allowNA && !criterion.naCondition.trim())
      context.addIssue({
        code: "custom",
        path: ["naCondition"],
        message: "Укажите условие N/A",
      });
    if (criterion.type === "scale") {
      if (
        criterion.scale.length < 2 ||
        !criterion.scale.some((option) => option.value > 0)
      )
        context.addIssue({
          code: "custom",
          path: ["scale"],
          message:
            "Добавьте минимум две ступени, включая положительное значение",
        });
      if (
        new Set(criterion.scale.map((option) => option.value)).size !==
        criterion.scale.length
      )
        context.addIssue({
          code: "custom",
          path: ["scale"],
          message: "Значения шкалы не должны повторяться",
        });
    }
  });
export const checklistSchema = z
  .object({
    id,
    name: z.string().trim().min(1, "Укажите название чек-листа").max(150),
    version: z.number().int().positive(),
    criteria: z.array(criterionSchema).min(1).max(100),
  })
  .superRefine((checklist, context) => {
    if (
      new Set(checklist.criteria.map((c) => c.id)).size !==
      checklist.criteria.length
    )
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "Критерии должны иметь разные идентификаторы",
      });
  });
const messageSchema = z.object({
  id,
  timestamp: z.string().max(100),
  speaker: z.enum(["operator", "client", "bot", "system"]),
  text,
});
const conversationSchema = z.object({
  id,
  externalId: id,
  groupId: id,
  channel: z.enum(["agent chat", "voice call"]),
  language: z.enum(["RU", "KZ", "EN"]),
  messages: z.array(messageSchema).max(20_000),
  audioUrl: audio,
  status: z.enum(["unrated", "evaluating", "evaluated", "error"]),
  demo: z.boolean().optional(),
});
const evidenceSchema = z.object({
  messageIds: z.array(id).min(1).max(20_000),
  quote: text,
  kind: z.enum(["quote", "range"]),
});
const resultSchema = z.object({
  criterionId: id,
  answer,
  originalAnswer: answer,
  points: z.number().finite().nullable(),
  explanation: text,
  evidence: z.array(evidenceSchema).max(1000),
  naReason: text.optional(),
  override: z
    .object({
      answer,
      reason: z.string().trim().min(1).max(4000),
      appealId: id,
    })
    .optional(),
});
const date = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "Некорректная дата");
const evaluationSchema = z.object({
  id,
  recordId: id,
  createdAt: date,
  checklist: checklistSchema,
  results: z.array(resultSchema).max(100),
  total: z.number().min(0).max(100).nullable(),
  originalTotal: z.number().min(0).max(100).nullable(),
  grossViolation: z.boolean(),
  demo: z.boolean(),
});
const appealSchema = z.object({
  id,
  recordId: id,
  evaluationId: id,
  criterionId: id,
  comment: z.string().trim().min(1).max(4000),
  createdAt: date,
  status: z.enum(["pending", "resolved"]),
  decision: z
    .object({
      action: z.enum(["confirm", "change"]),
      answer,
      reason: z.string().trim().min(1).max(4000),
      createdAt: date,
    })
    .optional(),
});
const workspaceSchema = z.object({
  conversations: z.array(conversationSchema).max(10_000),
  checklists: z.array(checklistSchema).min(1).max(1000),
  evaluations: z.array(evaluationSchema).max(20_000),
  appeals: z.array(appealSchema).max(20_000),
});

export function validAnswer(criterion: Criterion, value: Answer): boolean {
  if (value === null) return criterion.allowNA;
  if (criterion.type === "scale")
    return (
      typeof value === "number" &&
      criterion.scale.some((option) => option.value === value)
    );
  return typeof value === "boolean";
}

export function validateChecklist(input: unknown): Checklist {
  const parsed = checklistSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message || "Проверьте поля чек-листа",
    );
  return parsed.data;
}

/** A new editor draft has version 0; persisted/server state must always start at 1. */
export function validateChecklistDraft(input: unknown): Checklist {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    "version" in input &&
    input.version === 0
  ) {
    return { ...validateChecklist({ ...input, version: 1 }), version: 0 };
  }
  return validateChecklist(input);
}

export function parseWorkspace(input: unknown): Workspace {
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      "Сервер вернул данные неизвестного формата. Проверьте подключение API.",
    );
  const state = parsed.data;
  for (const collection of [
    state.conversations,
    state.checklists,
    state.evaluations,
    state.appeals,
  ]) {
    if (new Set(collection.map((row) => row.id)).size !== collection.length)
      throw new Error("В ответе повторяются идентификаторы записей.");
  }
  for (const conversation of state.conversations) {
    if (
      new Set(conversation.messages.map((message) => message.id)).size !==
      conversation.messages.length
    )
      throw new Error("В диалоге повторяются идентификаторы сообщений.");
  }
  for (const evaluation of state.evaluations) {
    const conversation = state.conversations.find(
      (row) => row.id === evaluation.recordId,
    );
    if (!conversation || (evaluation.demo && !conversation.demo))
      throw new Error("Результат связан с неизвестным диалогом.");
    const messageIds = new Set(
      conversation.messages.map((message) => message.id),
    );
    if (
      evaluation.results.length !== evaluation.checklist.criteria.length ||
      new Set(evaluation.results.map((r) => r.criterionId)).size !==
        evaluation.results.length
    )
      throw new Error("В оценке отсутствуют критерии или присутствуют дубли.");
    for (const result of evaluation.results) {
      const criterion = evaluation.checklist.criteria.find(
        (item) => item.id === result.criterionId,
      );
      if (
        !criterion ||
        !validAnswer(criterion, result.answer) ||
        !validAnswer(criterion, result.originalAnswer)
      )
        throw new Error("В оценке есть недопустимое значение критерия.");
      if (
        result.evidence.some((item) =>
          item.messageIds.some((messageId) => !messageIds.has(messageId)),
        )
      )
        throw new Error("Доказательство ссылается на отсутствующее сообщение.");
      if (result.answer === null && !result.naReason?.trim())
        throw new Error("Для N/A необходима причина неприменимости.");
    }
  }
  for (const appeal of state.appeals) {
    const evaluation = state.evaluations.find(
      (item) => item.id === appeal.evaluationId,
    );
    const criterion = evaluation?.checklist.criteria.find(
      (item) => item.id === appeal.criterionId,
    );
    if (!evaluation || !criterion || evaluation.recordId !== appeal.recordId)
      throw new Error("Апелляция связана с неизвестной оценкой.");
    if (
      (appeal.status === "resolved") !== Boolean(appeal.decision) ||
      (appeal.decision && !validAnswer(criterion, appeal.decision.answer))
    )
      throw new Error("Некорректное решение по апелляции.");
  }
  return state;
}

const rawRecord = z.object({
  conversation_id: id,
  channel: z.enum(["agent chat", "voice call"]),
  language: z.enum(["RU", "KZ", "EN"]),
  transcript: z
    .array(
      z.object({
        timestamp: z.string().max(100),
        speaker: z.enum(["operator", "client", "bot", "system"]),
        text,
      }),
    )
    .max(20_000),
  audio_url: audio,
});
const datasetSchema = z.object({
  isSuccess: z.literal(true),
  data: z.object({
    dataset_group_id: id,
    total_records: z.number().int().nonnegative(),
    records: z.array(rawRecord).max(10_000),
  }),
});

export function parseDataset(input: unknown, groupId: string): Conversation[] {
  const parsed = datasetSchema.safeParse(input);
  if (!parsed.success)
    throw new Error("Не удалось прочитать набор: проверьте формат данных DEV.");
  const data = parsed.data.data;
  if (
    data.dataset_group_id !== groupId ||
    data.total_records !== data.records.length
  )
    throw new Error(
      "Набор не совпадает с выбранной группой или содержит неполные данные.",
    );
  if (
    new Set(data.records.map((row) => row.conversation_id)).size !==
    data.records.length
  )
    throw new Error("В наборе повторяются ID разговоров.");
  return data.records.map((row) => {
    const recordId = `${encodeURIComponent(groupId)}:${encodeURIComponent(row.conversation_id)}`;
    return {
      id: recordId,
      externalId: row.conversation_id,
      groupId,
      channel: row.channel,
      language: row.language,
      status: "unrated",
      demo: false,
      audioUrl: row.audio_url,
      messages: row.transcript.map((message, index) => ({
        ...message,
        id: `${recordId}:m${index}`,
      })),
    };
  });
}
