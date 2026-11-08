import type {
  Answer,
  Checklist,
  ContactReason,
  Conversation,
  Criterion,
  CriterionResult,
  Evaluation,
  Evidence,
} from "../../frontend/src/lib/types.ts";
import { parseContactReason, parseCriterionCoaching } from "../../frontend/src/lib/validation.ts";

/** Official CQA checklist, not the synthetic frontend teaching fixture. */
export const initialChecklist: Checklist = {
  id: "official-cqa",
  name: "Чек-лист качества чатов",
  version: 1,
  criteria: [
    {
      id: "c1",
      name: "Установление контакта",
      type: "boolean",
      weight: 10,
      description:
        "Оператор поздоровался на языке клиента и представился в первом ответе. Приветствие бота не считается действием оператора.",
      allowNA: false,
      naCondition: "",
      scale: [],
    },
    {
      id: "c2",
      name: "Выявление потребности",
      type: "boolean",
      weight: 15,
      description:
        "Оператор учёл известные детали и уточнил недостающее до ответа. Учитывайте сведения, уже переданные клиентом боту: не требуйте повторных вопросов ради самого вопроса.",
      allowNA: true,
      naCondition:
        "Данных для ответа хватало с самого начала работы оператора.",
      scale: [],
    },
    {
      id: "c3",
      name: "Идентификация",
      type: "boolean",
      weight: 20,
      description:
        "Проверка личности подтверждена до раскрытия данных или защищённого действия. Явное подтверждение в системном сообщении или контексте бота допустимо. Просьба прислать данные ещё не означает подтверждённую проверку.",
      allowNA: true,
      naCondition: "Запрос не требовал идентификации.",
      scale: [],
    },
    {
      id: "c4",
      name: "Корректная и полная консультация",
      type: "scale",
      weight: 20,
      description:
        "Оцените правильность и полноту ответа либо следующего шага по указанной шкале. Не придумывайте неизвестные бизнес-правила.",
      allowNA: true,
      naCondition: "Чат закончился до того, как клиент сформулировал запрос.",
      scale: [
        {
          value: 0,
          label: "Ответа по существу нет или ключевая рекомендация ошибочна.",
        },
        {
          value: 5,
          label:
            "Есть общая подсказка, но клиенту всё ещё непонятно, как действовать.",
        },
        {
          value: 10,
          label: "Часть запроса закрыта, существенный вопрос остался открытым.",
        },
        {
          value: 15,
          label: "Основной вопрос решён, пропущена второстепенная деталь.",
        },
        {
          value: 20,
          label:
            "Все существенные вопросы закрыты или дан корректный следующий шаг.",
        },
      ],
    },
    {
      id: "c5",
      name: "Эмпатия и клиентоориентированность",
      type: "boolean",
      weight: 15,
      description:
        "Оператор вежлив и, если клиент выразил недовольство или описал неудобство, отреагировал на конкретную проблему. Учитывайте и поздние возражения клиента, а не только первоначальную вежливость.",
      allowNA: false,
      naCondition: "",
      scale: [],
    },
    {
      id: "c6",
      name: "Управление диалогом и грамотность",
      type: "scale",
      weight: 15,
      description:
        "Оцените ясность, порядок ответов и предупреждение об ожидании. Не смешивайте качество общения с полнотой решения запроса.",
      allowNA: false,
      naCondition: "",
      scale: [
        {
          value: 0,
          label:
            "Из-за бессвязных или противоречивых реплик ход диалога непонятен.",
        },
        {
          value: 4,
          label:
            "Клиенту приходится переспрашивать из-за формулировок или порядка ответов.",
        },
        {
          value: 7,
          label:
            "Один заметный сбой, но клиент может понять ответ и продолжить.",
        },
        {
          value: 10,
          label:
            "Ответы ясные и связные. Если было явное ожидание, оператор предупредил.",
        },
      ],
    },
    {
      id: "c7",
      name: "Завершение",
      type: "boolean",
      weight: 5,
      description:
        "Оператор (подвёл итог ИЛИ предложил дальнейшую помощь) И попрощался. Одного прощания недостаточно. Отличайте обрыв разговора от закрытия оператором без завершения.",
      allowNA: true,
      naCondition: "Чат оборвался до возможности его завершить.",
      scale: [],
    },
    {
      id: "c8",
      name: "Грубые ошибки",
      type: "flag",
      weight: 0,
      description:
        "Да означает нарушение: оскорбление клиента оператором, предложение платной услуги в обход компании или раскрытие конфиденциальной информации. Самого предложения перевести деньги оператору лично для инвестирования либо предоставить личный номер для частной платной консультации достаточно; согласие клиента не требуется. Нет — ни одно из трёх не выявлено. Флаг учитывается отдельно от баллов.",
      allowNA: false,
      naCondition: "",
      scale: [],
    },
  ],
};

export class ModelOutputError extends Error {
  constructor(detail: string) {
    super(`Ответ модели отклонён: ${detail}`);
    this.name = "ModelOutputError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function text(value: unknown, maximum = 4000): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= maximum;
}

function checkChecklist(checklist: Checklist): void {
  if (
    !checklist ||
    !Array.isArray(checklist.criteria) ||
    !checklist.criteria.length ||
    checklist.criteria.length > 100
  ) {
    throw new Error("Чек-лист должен содержать от 1 до 100 критериев.");
  }
  const ids = new Set<string>();
  for (const criterion of checklist.criteria) {
    if (
      !text(criterion.id, 300) ||
      ids.has(criterion.id) ||
      !text(criterion.name, 150) ||
      !text(criterion.description) ||
      !["boolean", "scale", "flag"].includes(criterion.type) ||
      typeof criterion.weight !== "number" ||
      !Number.isFinite(criterion.weight) ||
      criterion.weight > 1000 ||
      (criterion.type === "flag"
        ? criterion.weight !== 0
        : criterion.weight <= 0) ||
      typeof criterion.allowNA !== "boolean" ||
      typeof criterion.naCondition !== "string" ||
      (criterion.allowNA && !text(criterion.naCondition, 2000)) ||
      !Array.isArray(criterion.scale)
    ) {
      throw new Error("Некорректная конфигурация критерия.");
    }
    ids.add(criterion.id);
    if (
      criterion.type === "scale" &&
      (criterion.scale.length < 2 ||
        criterion.scale.length > 30 ||
        criterion.scale.some(
          (option) =>
            typeof option.value !== "number" ||
            !Number.isFinite(option.value) ||
            option.value < 0 ||
            !text(option.label, 500),
        ) ||
        new Set(criterion.scale.map((option) => option.value)).size !==
          criterion.scale.length ||
        !criterion.scale.some((option) => option.value > 0))
    )
      throw new Error("Некорректная шкала критерия.");
  }
}

function validAnswer(criterion: Criterion, answer: unknown): answer is Answer {
  if (answer === null) return criterion.allowNA;
  return criterion.type === "scale"
    ? typeof answer === "number" &&
        Number.isFinite(answer) &&
        criterion.scale.some((option) => option.value === answer)
    : typeof answer === "boolean";
}

// Rational arithmetic keeps decimal checklist weights exact until the final
// rounding. HALF_UP is an implementation choice; the PDF asks for 2 decimals.
type Fraction = { n: bigint; d: bigint };
function fraction(n: bigint, d = 1n): Fraction {
  let a = n,
    b = d;
  while (b) [a, b] = [b, a % b];
  const divisor = a || 1n;
  return { n: n / divisor, d: d / divisor };
}
function decimal(value: number): Fraction {
  const [mantissa, exponentText = "0"] = String(value).toLowerCase().split("e");
  const [whole, decimals = ""] = mantissa.split(".");
  const exponent = Number(exponentText) - decimals.length;
  const digits = BigInt(whole + decimals);
  return exponent >= 0
    ? fraction(digits * 10n ** BigInt(exponent))
    : fraction(digits, 10n ** BigInt(-exponent));
}
const add = (a: Fraction, b: Fraction) =>
  fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const multiply = (a: Fraction, b: Fraction) => fraction(a.n * b.n, a.d * b.d);
function divide(a: Fraction, b: Fraction): Fraction {
  if (b.n === 0n) throw new Error("Нулевой знаменатель при расчёте.");
  return fraction(a.n * b.d, a.d * b.n);
}
function rounded(value: Fraction, places: number): number {
  const factor = 10n ** BigInt(places);
  return (
    Number((value.n * factor * 2n + value.d) / (value.d * 2n)) / 10 ** places
  );
}

function calculate(checklist: Checklist, answers: Answer[]) {
  let available = fraction(0n);
  const raw = checklist.criteria.map((criterion, index) => {
    const answer = answers[index];
    if (answer === null || criterion.type === "flag") return fraction(0n);
    const weight = decimal(criterion.weight);
    available = add(available, weight);
    const ratio =
      typeof answer === "boolean"
        ? fraction(answer ? 1n : 0n)
        : divide(
            decimal(answer),
            decimal(Math.max(...criterion.scale.map((option) => option.value))),
          );
    return multiply(weight, ratio);
  });
  const normalized = raw.map((value) =>
    available.n
      ? multiply(divide(value, available), fraction(100n))
      : fraction(0n),
  );
  return {
    points: normalized.map((value, index) =>
      checklist.criteria[index].type === "flag" ? null : rounded(value, 15),
    ),
    total: available.n
      ? rounded(normalized.reduce(add, fraction(0n)), 2)
      : null,
    grossViolation: checklist.criteria.some(
      (criterion, index) =>
        criterion.type === "flag" && answers[index] === true,
    ),
  };
}

function evidenceFromModel(
  conversation: Conversation,
  row: Record<string, unknown>,
): Evidence[] {
  const ids = row.evidence_ids;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => !text(id, 4096))
  ) {
    throw new ModelOutputError("нужны существующие ID доказательств.");
  }
  const indices = ids.map((id) =>
    conversation.messages.findIndex((message) => message.id === id),
  );
  if (indices.some((index) => index < 0))
    throw new ModelOutputError(
      "доказательство ссылается на отсутствующую реплику.",
    );
  if (row.evidence_kind === "checked_range") {
    if (ids.length !== 2 || indices[0] > indices[1])
      throw new ModelOutputError(
        "нужны две упорядоченные границы проверенного участка.",
      );
    const messages = conversation.messages.slice(indices[0], indices[1] + 1);
    return [
      {
        kind: "range",
        messageIds: messages.map((message) => message.id),
        quote: messages.map((message) => message.text).join("\n"),
      },
    ];
  }
  if (row.evidence_kind !== "messages" || new Set(ids).size !== ids.length) {
    throw new ModelOutputError(
      "некорректный тип или повторные ID доказательства.",
    );
  }
  const messages = conversation.messages.filter((message) =>
    ids.includes(message.id),
  );
  return [
    {
      kind: "quote",
      messageIds: messages.map((message) => message.id),
      quote: messages.map((message) => message.text).join("\n"),
    },
  ];
}

export function scoreModelOutput(
  conversation: Conversation,
  checklist: Checklist,
  raw: unknown,
): {
  results: CriterionResult[];
  total: number | null;
  grossViolation: boolean;
  contactReason?: ContactReason;
} {
  checkChecklist(checklist);
  if (
    !conversation.messages.length ||
    !conversation.messages.some((message) => message.text.trim()) ||
    new Set(conversation.messages.map((message) => message.id)).size !==
      conversation.messages.length ||
    conversation.messages.some((message) => !text(message.id, 4096))
  ) {
    throw new Error(
      "Для оценки нужен непустой транскрипт с уникальными ID реплик.",
    );
  }
  let parsed = raw;
  if (typeof raw === "string") {
    if (raw.length > 1_000_000)
      throw new ModelOutputError("превышен размер структурированного ответа.");
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ModelOutputError("ожидался JSON без дополнительного текста.");
    }
  }
  if (
    !object(parsed) ||
    !(exactKeys(parsed, ["results"]) || exactKeys(parsed, ["results", "contact_reason"])) ||
    !Array.isArray(parsed.results) ||
    parsed.results.length !== checklist.criteria.length
  ) {
    throw new ModelOutputError(
      "требуется полный массив результатов по чек-листу.",
    );
  }
  const byId = new Map<string, Record<string, unknown>>();
  let contactReason: ContactReason | undefined;
  if (Object.hasOwn(parsed, "contact_reason")) {
    if (object(parsed.contact_reason) && Object.hasOwn(parsed.contact_reason, "classifier")) throw new ModelOutputError("происхождение классификации задаётся только сервером.");
    try {
      contactReason = parseContactReason(parsed.contact_reason, new Set(conversation.messages.map((message) => message.id)));
    } catch {
      throw new ModelOutputError("некорректная причина обращения, исход или ссылки на реплики.");
    }
  }
  for (const row of parsed.results) {
    if (
      !object(row) ||
      !exactKeys(row, [
        "criterion_id",
        "status",
        "value",
        "reason",
        "evidence_ids",
        "evidence_kind",
        ...(Object.hasOwn(row, "coaching") ? ["coaching"] : []),
      ]) ||
      !text(row.criterion_id, 300) ||
      byId.has(row.criterion_id) ||
      !checklist.criteria.some(
        (criterion) => criterion.id === row.criterion_id,
      ) ||
      !text(row.reason)
    ) {
      throw new ModelOutputError(
        "некорректные поля, ID или обоснование критерия.",
      );
    }
    byId.set(row.criterion_id, row);
  }
  const results: CriterionResult[] = checklist.criteria.map((criterion) => {
    const row = byId.get(criterion.id)!;
    if (
      (row.status !== "scored" && row.status !== "not_applicable") ||
      (row.status === "not_applicable") !== (row.value === null) ||
      !validAnswer(criterion, row.value)
    ) {
      throw new ModelOutputError(
        "ответ, применимость или ступень шкалы не соответствует критерию.",
      );
    }
    let coaching: CriterionResult["coaching"];
    if (row.coaching !== undefined && row.coaching !== null) {
      try {
        coaching = parseCriterionCoaching(row.coaching, criterion, row.value, new Set(conversation.messages.map((message) => message.id)));
      } catch {
        throw new ModelOutputError("некорректная рекомендация, применимость или ссылки на реплики.");
      }
    }
    return {
      criterionId: criterion.id,
      answer: row.value,
      originalAnswer: row.value,
      points: null,
      explanation: (row.reason as string).trim(),
      evidence: evidenceFromModel(conversation, row),
      ...(coaching ? { coaching } : {}),
      ...(row.value === null
        ? { naReason: (row.reason as string).trim() }
        : {}),
    };
  });
  const scored = calculate(
    checklist,
    results.map((result) => result.answer),
  );
  return {
    results: results.map((result, index) => ({
      ...result,
      points: scored.points[index],
    })),
    total: scored.total,
    grossViolation: scored.grossViolation,
    ...(contactReason ? { contactReason } : {}),
  };
}

/** Recompute reviewer-edited current answers without changing model originals. */
export function recalculate(evaluation: Evaluation): Evaluation {
  checkChecklist(evaluation.checklist);
  if (
    !Array.isArray(evaluation.results) ||
    evaluation.results.length !== evaluation.checklist.criteria.length ||
    new Set(evaluation.results.map((result) => result.criterionId)).size !==
      evaluation.results.length
  ) {
    throw new Error("Оценка должна содержать все критерии без повторов.");
  }
  const copy = structuredClone(evaluation);
  copy.results = copy.checklist.criteria.map((criterion) => {
    const result = copy.results.find((row) => row.criterionId === criterion.id);
    if (
      !result ||
      !validAnswer(criterion, result.answer) ||
      !validAnswer(criterion, result.originalAnswer)
    ) {
      throw new Error("Недопустимый ответ при пересчёте оценки.");
    }
    if (
      result.override &&
      (result.override.answer !== result.answer ||
        !text(result.override.reason) ||
        !text(result.override.appealId, 300))
    ) {
      throw new Error("Некорректное решение проверяющего.");
    }
    if (result.answer === null) {
      const reason = result.override?.reason ?? result.naReason;
      if (!text(reason))
        throw new Error("Для N/A необходима причина неприменимости.");
      result.naReason = reason.trim();
    } else {
      delete result.naReason;
    }
    return result;
  });
  const scored = calculate(
    copy.checklist,
    copy.results.map((result) => result.answer),
  );
  copy.results.forEach((result, index) => {
    result.points = scored.points[index];
  });
  copy.total = scored.total;
  copy.grossViolation = scored.grossViolation;
  return copy;
}
