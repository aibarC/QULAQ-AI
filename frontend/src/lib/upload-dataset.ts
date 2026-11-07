import type { Conversation, Message } from "./types";
import { parseDataset } from "./validation";

const roles: Record<string, Message["speaker"]> = {
  клиент: "client",
  client: "client",
  customer: "client",
  клиенті: "client",
  оператор: "operator",
  operator: "operator",
  agent: "operator",
  бот: "bot",
  bot: "bot",
  система: "system",
  system: "system",
};
export function parseTextTranscript(text: string) {
  const messages: Omit<Message, "id">[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line.trim()) continue;
    const match = line.match(
      /^\s*(?:\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+)?(клиенті|клиент|client|customer|оператор|operator|agent|бот|bot|система|system)\s*:\s*(.*)$/i,
    );
    if (match)
      messages.push({
        timestamp: match[1] ?? "",
        speaker: roles[match[2].toLowerCase()],
        text: match[3],
      });
    else if (messages.length) messages[messages.length - 1].text += `\n${line}`;
    else
      throw new Error(
        "Для анализа TXT укажите участников: «Клиент: текст» и «Оператор: текст». Время перед репликой необязательно.",
      );
  }
  if (!messages.length || messages.some((message) => !message.text.trim()))
    throw new Error("В транскрипте есть пустая реплика или отсутствует текст.");
  return messages;
}

export async function makeUploadDataset(
  source:
    | { kind: "txt"; name: string; text: string }
    | { kind: "json"; name: string; conversations: Conversation[] },
  language: Conversation["language"],
) {
  const entries =
    source.kind === "txt"
      ? [
          {
            externalId: source.name.replace(/\.txt$/i, "").slice(0, 100),
            language,
            channel: "agent chat" as const,
            messages: parseTextTranscript(source.text),
          },
        ]
      : source.conversations;
  const records = entries.map((entry) => ({
    conversation_id: entry.externalId,
    language: entry.language,
    channel: entry.channel,
    transcript: entry.messages.map(({ timestamp, speaker, text }) => ({
      timestamp,
      speaker,
      text,
    })),
    audio_url: null,
  }));
  const bytes = new TextEncoder().encode(JSON.stringify(records));
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  const dataset = {
    isSuccess: true as const,
    data: {
      dataset_group_id: "UPLOAD",
      total_records: records.length,
      records: records.map((record) => ({
        ...record,
        conversation_id: `${digest}-${record.conversation_id.slice(0, 250)}`,
      })),
    },
  };
  const parsed = parseDataset(dataset, "UPLOAD");
  if (!parsed.length) throw new Error("В файле нет диалогов.");
  return { dataset, firstId: parsed[0].id };
}
