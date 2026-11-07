import type { Message } from "./types";

function seconds(timestamp: string): number | null {
  if (timestamp.includes("T")) {
    const value = Date.parse(timestamp);
    return Number.isFinite(value) ? value / 1000 : null;
  }
  if (!/^\d+:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(timestamp)) return null;
  const parts = timestamp.split(":").map(Number);
  if (parts.slice(1).some((value) => value >= 60)) return null;
  return parts.reduce((total, value) => total * 60 + value, 0);
}

/** First transcript message is the origin, not a verified recording start. */
export function messageOffset(
  messages: Message[],
  message: Message,
): number | null {
  const start = seconds(messages[0]?.timestamp ?? "");
  const current = seconds(message.timestamp);
  if (start === null || current === null || current < start) return null;
  return current - start;
}

export function elapsedLabel(value: number | null): string {
  if (value === null) return "—";
  const total = Math.floor(value);
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
