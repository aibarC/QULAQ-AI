import type {
  Checklist,
  Conversation,
  Evaluation,
  CriterionResult,
} from "./types";

/** Synthetic example written for UI development. Never mixed with real DEV evaluation data. */
export const demoConversation: Conversation = {
  id: "DEMO:welcome",
  externalId: "DEMO-001",
  groupId: "DEMO",
  channel: "agent chat",
  language: "RU",
  status: "unrated",
  demo: true,
  audioUrl: null,
  messages: [
    {
      id: "DEMO:welcome:m0",
      timestamp: "00:00",
      speaker: "system",
      text: "Учебный диалог. Все участники и обстоятельства вымышлены.",
    },
    {
      id: "DEMO:welcome:m1",
      timestamp: "00:04",
      speaker: "operator",
      text: "Здравствуйте! Служба поддержки QULAQ. Чем могу помочь?",
    },
    {
      id: "DEMO:welcome:m2",
      timestamp: "00:16",
      speaker: "client",
      text: "Интернет перестал работать перед важной встречей. Уже перезагружал роутер, это не помогло.",
    },
    {
      id: "DEMO:welcome:m3",
      timestamp: "00:28",
      speaker: "operator",
      text: "Понимаю, как неприятно остаться без связи перед встречей. Давайте попробуем быстро восстановить подключение. Индикатор интернета горит красным?",
    },
    {
      id: "DEMO:welcome:m4",
      timestamp: "00:39",
      speaker: "client",
      text: "Да, красным. Остальные индикаторы зелёные.",
    },
    {
      id: "DEMO:welcome:m5",
      timestamp: "00:48",
      speaker: "operator",
      text: "Для проверки линии подтвердите, пожалуйста, обращение в приложении. Код и пароль отправлять сюда не нужно.",
    },
    {
      id: "DEMO:welcome:m6",
      timestamp: "01:02",
      speaker: "system",
      text: "Учебное подтверждение личности выполнено.",
    },
    {
      id: "DEMO:welcome:m7",
      timestamp: "01:15",
      speaker: "operator",
      text: "На линии нет аварии. Проверьте, плотно ли подключён кабель в порт WAN, затем отключите питание роутера на 30 секунд и включите снова.",
    },
    {
      id: "DEMO:welcome:m8",
      timestamp: "02:08",
      speaker: "client",
      text: "Кабель действительно отошёл. Подключил, интернет появился. Спасибо!",
    },
    {
      id: "DEMO:welcome:m9",
      timestamp: "02:17",
      speaker: "operator",
      text: "Отлично! Откройте, пожалуйста, страницу в браузере, чтобы проверить, что подключение стабильно.",
    },
    {
      id: "DEMO:welcome:m10",
      timestamp: "02:31",
      speaker: "client",
      text: "Всё открывается.",
    },
    {
      id: "DEMO:welcome:m11",
      timestamp: "02:38",
      speaker: "operator",
      text: "Рада, что удалось восстановить связь. Могу помочь с чем-нибудь ещё? Если нет, желаю удачной встречи!",
    },
    {
      id: "DEMO:welcome:m12",
      timestamp: "02:45",
      speaker: "client",
      text: "Больше ничего, спасибо!",
    },
  ],
};

export const defaultChecklist: Checklist = {
  id: "cqa-default",
  name: "Контроль качества диалогов",
  version: 1,
  criteria: [
    {
      id: "contact",
      name: "Установление контакта",
      description: "Оператор приветствует клиента и предлагает помощь.",
      type: "boolean",
      weight: 10,
      allowNA: false,
      naCondition: "",
      scale: [],
    },
    {
      id: "need",
      name: "Выявление потребности",
      description: "Оператор уточняет запрос и задаёт уместные вопросы.",
      type: "boolean",
      weight: 15,
      allowNA: false,
      naCondition: "",
      scale: [],
    },
    {
      id: "identity",
      name: "Идентификация",
      description:
        "Оператор идентифицирует клиента, когда обращение требует доступа к персональной информации.",
      type: "boolean",
      weight: 20,
      allowNA: true,
      naCondition: "Идентификация не требуется для ответа на общий вопрос.",
      scale: [],
    },
    {
      id: "consultation",
      name: "Консультация",
      description: "Ответ полный, понятный и соответствует запросу клиента.",
      type: "scale",
      weight: 20,
      allowNA: false,
      naCondition: "",
      scale: [
        { value: 0, label: "Ответ отсутствует" },
        { value: 5, label: "Существенные ошибки" },
        { value: 10, label: "Частичный ответ" },
        { value: 15, label: "Небольшие недочёты" },
        { value: 20, label: "Полная консультация" },
      ],
    },
    {
      id: "empathy",
      name: "Эмпатия",
      description:
        "Оператор проявляет понимание ситуации и эмоционального состояния клиента.",
      type: "boolean",
      weight: 15,
      allowNA: true,
      naCondition: "Ситуация не требует выражения сочувствия или поддержки.",
      scale: [],
    },
    {
      id: "dialogue",
      name: "Ведение диалога",
      description:
        "Оператор последовательно ведёт разговор, отвечает понятно и по существу.",
      type: "scale",
      weight: 15,
      allowNA: false,
      naCondition: "",
      scale: [
        { value: 0, label: "Диалог не выстроен" },
        { value: 4, label: "Существенные недочёты" },
        { value: 7, label: "Есть недочёты" },
        { value: 10, label: "Диалог выстроен" },
      ],
    },
    {
      id: "closing",
      name: "Завершение диалога",
      description:
        "Оператор проверяет решение вопроса, предлагает дополнительную помощь и прощается.",
      type: "boolean",
      weight: 5,
      allowNA: false,
      naCondition: "",
      scale: [],
    },
    {
      id: "gross",
      name: "Грубые нарушения",
      description:
        "Есть ли грубость, оскорбления, разглашение данных или другие грубые нарушения?",
      type: "flag",
      weight: 0,
      allowNA: false,
      naCondition: "",
      scale: [],
    },
  ],
};

const specimen: Record<
  string,
  {
    answer: number | boolean;
    points: number | null;
    message: number;
    explanation: string;
  }
> = {
  contact: {
    answer: true,
    points: 10,
    message: 1,
    explanation:
      "В учебном примере оператор приветствует клиента и предлагает помощь.",
  },
  need: {
    answer: true,
    points: 15,
    message: 3,
    explanation: "Есть уточняющий вопрос о состоянии индикатора.",
  },
  identity: {
    answer: true,
    points: 20,
    message: 6,
    explanation:
      "Учебное системное сообщение подтверждает идентификацию через приложение.",
  },
  consultation: {
    answer: 20,
    points: 20,
    message: 7,
    explanation:
      "Предложены конкретные действия; клиент затем подтверждает восстановление связи.",
  },
  empathy: {
    answer: false,
    points: 0,
    message: 3,
    explanation:
      "Учебная спорная оценка: система якобы пропустила фразу поддержки. Оспорьте этот критерий, чтобы проверить полный путь пересмотра.",
  },
  dialogue: {
    answer: 10,
    points: 15,
    message: 9,
    explanation: "Оператор проверяет результат выполненных действий.",
  },
  closing: {
    answer: true,
    points: 5,
    message: 11,
    explanation:
      "Оператор предлагает дополнительную помощь и завершает разговор.",
  },
  gross: {
    answer: false,
    points: null,
    message: 1,
    explanation:
      "В учебном сценарии грубые нарушения отсутствуют. Это отдельный безбалльный флаг.",
  },
};

export function isDefaultRules(checklist: Checklist): boolean {
  return (
    JSON.stringify(checklist.criteria) ===
    JSON.stringify(defaultChecklist.criteria)
  );
}

export function makeDemoEvaluation(checklist: Checklist): Evaluation {
  const canonical = isDefaultRules(checklist);
  const results: CriterionResult[] = checklist.criteria.map((criterion) => {
    const sample = specimen[criterion.id];
    const original = defaultChecklist.criteria.find(
      (item) => item.id === criterion.id,
    );
    const unchanged =
      original && JSON.stringify(original) === JSON.stringify(criterion);
    const answer =
      unchanged && sample
        ? sample.answer
        : criterion.type === "scale"
          ? criterion.scale[0].value
          : false;
    const message = demoConversation.messages[sample?.message ?? 1];
    return {
      criterionId: criterion.id,
      answer,
      originalAnswer: answer,
      points: unchanged && sample ? sample.points : null,
      explanation:
        unchanged && sample
          ? sample.explanation
          : "Учебное значение для проверки интерфейса. Новые правила не были проанализированы ИИ; реальный ответ и расчёт появятся после подключения сервера.",
      evidence:
        unchanged && sample
          ? [
              {
                messageIds: [message.id],
                quote: message.text,
                kind: "quote" as const,
              },
            ]
          : [],
    };
  });
  return {
    id: `demo-eval-${crypto.randomUUID()}`,
    recordId: demoConversation.id,
    createdAt: new Date().toISOString(),
    checklist: structuredClone(checklist),
    results,
    total: canonical ? 85 : null,
    originalTotal: canonical ? 85 : null,
    grossViolation: false,
    demo: true,
  };
}

/** Fixed teaching scenario, not a second implementation of backend scoring. */
export function updateDemoTotals(evaluation: Evaluation): void {
  evaluation.grossViolation = evaluation.results.some(
    (result) =>
      evaluation.checklist.criteria.find((c) => c.id === result.criterionId)
        ?.type === "flag" && result.answer === true,
  );
  const defaultRules = isDefaultRules(evaluation.checklist);
  const onlyEmpathyChanged = evaluation.results.every(
    (result) =>
      result.criterionId === "empathy" ||
      result.answer === result.originalAnswer,
  );
  const empathy = evaluation.results.find(
    (result) => result.criterionId === "empathy",
  );
  if (
    defaultRules &&
    onlyEmpathyChanged &&
    typeof empathy?.answer === "boolean"
  ) {
    evaluation.total = empathy.answer ? 100 : 85;
    empathy.points = empathy.answer ? 15 : 0;
  } else {
    evaluation.total = null;
    for (const result of evaluation.results) {
      if (result.answer !== result.originalAnswer) result.points = null;
    }
  }
}
