import { useState } from "react";
import { FileJson } from "lucide-react";
import type { Conversation, Evaluation } from "../lib/types";
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
  const [busy, setBusy] = useState<"json" | null>(null);
  const [error, setError] = useState("");
  return (
    <div className="result-export-options">
      <div className="result-export-buttons">
      <button type="button" className="button secondary small" disabled={!!busy}
        onClick={() => {
          setBusy("json"); setError("");
          try { downloadEvaluationJson(conversation, evaluation, source); }
          catch { setError("Не удалось создать JSON. Проверьте целостность результата и обновите данные."); }
          finally { setBusy(null); }
        }}>
        <FileJson size={16} aria-hidden="true" />
        {busy === "json" ? "Создаём JSON…" : "Скачать JSON этого диалога"}
      </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
