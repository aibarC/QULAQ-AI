/** Version 1 describes the client's purpose, independently of operator quality. */
export const CONTACT_REASON_GROUPS = [
  { id: "account_access", label: "Аккаунт и доступ" },
  { id: "deposit", label: "Пополнение счёта" },
  { id: "withdrawal_transfer", label: "Вывод и перевод денег" },
  { id: "trading", label: "Покупка и продажа активов" },
  { id: "terms_fees", label: "Условия, тарифы и комиссии" },
  { id: "documents", label: "Документы и отчётность" },
  { id: "technical", label: "Технические проблемы" },
  { id: "other", label: "Другое" },
  { id: "unknown", label: "Не определено" },
] as const;

export type ContactReasonCategory =
  (typeof CONTACT_REASON_GROUPS)[number]["id"];
export const RESOLUTION_LABELS = {
  resolved: "Решено",
  unresolved: "Не решено",
  unknown: "Неясно",
} as const;
export type ResolutionStatus = keyof typeof RESOLUTION_LABELS;

export interface ContactReason {
  taxonomyVersion: 1;
  classifier?: {
    provider: "laya";
    model: string;
    revision: string;
    criterionId: string;
    messageIds: string[];
  };
  primary: ContactReasonCategory;
  secondary: ContactReasonCategory[];
  summary: string;
  reason: string;
  evidenceIds: string[];
  resolution: {
    status: ResolutionStatus;
    reason: string;
    evidenceIds: string[];
  };
}
