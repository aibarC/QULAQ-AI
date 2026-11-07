import { useState } from "react";
import type { Evaluation } from "../lib/types";

export default function ConversationImprovement({ evaluation, enabled, busy, onGenerate, onRefresh }: {
  evaluation: Evaluation;
  enabled: boolean;
  busy: boolean;
  onGenerate: (id: string) => Promise<unknown>;
  onRefresh: () => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const saved = evaluation.improvement;
  const customRubric = evaluation.provenance?.promptVersion === "dynamic-checklist-v1";
  return <section className="panel conversation-improvement" aria-label="Пример правильного подхода">
    <h3>Пример правильного подхода</h3>
    <p>Отдельная рекомендация ИИ по сохранённому анализу. Оценки и доказательства остаются прежними.</p>
    {saved ? <>
      <p className="coaching-source">Рекомендация ИИ · не реальный разговор</p>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{saved.text === null
        ? "Модель не предложила улучшений по этому анализу."
        : saved.text}</p>
    </> : <>
      <button className="button secondary" disabled={!enabled || customRubric || busy || pending || !!error}
        onClick={async () => {
          setPending(true);
          setError("");
          try { await onGenerate(evaluation.id); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось получить рекомендацию."); }
          finally { setPending(false); }
        }}>
        {pending ? "Готовим пример…" : "Показать пример правильного подхода"}
      </button>
      {!enabled && <p>Генерация рекомендаций сейчас отключена на сервере.</p>}
      {customRubric && <p>Этот пример доступен только для исходного чек-листа. Анализ изменённых правил сохранён; генерация примера для них пока не поддерживается.</p>}
    </>}
    {error && <><p role="alert">{error}</p><button className="button secondary small" onClick={() => { onRefresh(); setError(""); }}>Проверить сохранённый результат</button></>}
  </section>;
}
