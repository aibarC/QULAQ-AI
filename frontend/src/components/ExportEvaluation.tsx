import { useState } from "react";
import { Download } from "lucide-react";
import type { Conversation, Evaluation } from "../lib/types";
import { downloadEvaluation } from "../lib/export-evaluation";
export default function ExportEvaluation({
  conversation,
  evaluation,
  source,
}: {
  conversation: Conversation;
  evaluation: Evaluation;
  source?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <button
        className="button secondary small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await downloadEvaluation(conversation, evaluation, source);
          } catch {
            setError("Не удалось создать XLSX. Повторите скачивание.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={16} aria-hidden="true" />
        {busy ? "Создаём XLSX…" : "Скачать результат XLSX"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
