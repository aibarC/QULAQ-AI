import type { Conversation } from "./types";

export const CONVERSATION_PAGE_SIZE = 65;
export const CONVERSATION_LANGUAGES = ["RU", "KZ", "EN"] as const;
export const CONVERSATION_LANGUAGE_LABELS = {
  RU: "Русский",
  KZ: "Қазақша",
  EN: "English",
} as const;

const idOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function sortConversations(
  records: readonly Conversation[],
): Conversation[] {
  return [...records].sort(
    (a, b) =>
      CONVERSATION_LANGUAGES.indexOf(a.language) -
        CONVERSATION_LANGUAGES.indexOf(b.language) ||
      idOrder.compare(a.externalId, b.externalId) ||
      a.id.localeCompare(b.id),
  );
}

export function groupConversations(records: readonly Conversation[]) {
  return CONVERSATION_LANGUAGES.map((language) => ({
    language,
    label: CONVERSATION_LANGUAGE_LABELS[language],
    conversations: records.filter(
      (conversation) => conversation.language === language,
    ),
  })).filter((group) => group.conversations.length > 0);
}
