import { useState } from "react";
import { Download, FileJson } from "lucide-react";
import type { Conversation, Evaluation } from "../lib/types";
import { downloadEvaluation } from "../lib/export-evaluation";
import { downloadEvaluationJson } from "../lib/export-evaluation-json";
export default function ExportEvaluation({
  conversation,
  evaluation,
  source,
}: {
  conversation: Conversation;
  evaluation: Evaluation;
  source?: string;
}) {
  const [busy, setBusy] = useState<"xlsx" | "json" | null>(null);
  const [error, setError] = useState("");
  return (
    <div className="result-export-options">
      <div className="result-export-buttons">
      <button
        className="button secondary small"
        disabled={!!busy}
        onClick={async () => {
          setBusy("xlsx");
          setError("");
          try {
            await downloadEvaluation(conversation, evaluation, source);
          } catch {
            setError("Не удалось создать XLSX. Повторите скачивание.");
          } finally {
            setBusy(null);
          }
        }}
      >
        <Download size={16} aria-hidden="true" />
        {busy === "xlsx" ? "Создаём XLSX…" : "Скачать результат XLSX"}
      </button>
      <button type="button" className="button secondary small" disabled={!!busy}
        onClick={() => {
          setBusy("json"); setError("");
          try { downloadEvaluationJson(conversation, evaluation, source); }
          catch { setError("Не удалось создать JSON. Проверьте целостность результата и обновите данные."); }
          finally { setBusy(null); }
        }}>
        <FileJson size={16} aria-hidden="true" />
        {busy === "json" ? "Создаём JSON…" : "Скачать результат JSON"}
      </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
