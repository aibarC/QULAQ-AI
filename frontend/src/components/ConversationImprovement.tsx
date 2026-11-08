import { useId, useState } from "react";
import { ArrowUpRight, BookOpen, Check, ChevronDown, LoaderCircle } from "lucide-react";
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
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const saved = evaluation.improvement;
  const long = (saved?.text?.length ?? 0) > 480;
  return <section className="conversation-improvement" aria-label="Пример правильного подхода">
    <header className="improvement-heading">
      <span className="improvement-icon" aria-hidden="true"><BookOpen size={20} /></span>
      <div><h3>Пример правильного подхода</h3>
        <p>Как выстроить ответ клиенту на основе этого разбора.</p></div>
      {saved && <span className="improvement-saved" aria-label="Пример сохранён"><Check size={15} aria-hidden="true" /></span>}
    </header>
    {saved ? <>
      <div className="improvement-answer">
        <p className="improvement-label">Рекомендация ИИ · не реальный разговор</p>
        <p id={contentId} className="improvement-text">{saved.text === null
          ? "Модель не предложила улучшений по этому анализу."
          : long && !expanded ? `${saved.text.slice(0, 480).trimEnd()}…` : saved.text}</p>
        {long && <button type="button" className="improvement-expand" aria-expanded={expanded}
          aria-controls={contentId} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Свернуть пример" : "Читать полный пример"}<ChevronDown size={15} aria-hidden="true" />
        </button>}
      </div>
    </> : <>
      <button type="button" className="improvement-generate" aria-label="Показать пример правильного подхода" aria-busy={pending} disabled={!enabled || busy || pending || !!error}
        onClick={async () => {
          setPending(true);
          setError("");
          try { await onGenerate(evaluation.id); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось получить рекомендацию."); }
          finally { setPending(false); }
        }}>
        {pending ? <LoaderCircle size={17} className="improvement-spinner" aria-hidden="true" /> : <BookOpen size={17} aria-hidden="true" />}
        <span>{pending ? "Готовим пример…" : "Показать пример"}</span>
        {!pending && <ArrowUpRight size={16} aria-hidden="true" />}
      </button>
      {pending && <p className="improvement-note" role="status">Составляем рекомендацию по сохранённому анализу…</p>}
      {!enabled && <p className="improvement-note">Генерация рекомендаций сейчас отключена на сервере.</p>}
    </>}
    {error && <div className="improvement-error"><p role="alert">{error}</p><button type="button" className="improvement-expand" onClick={() => { onRefresh(); setError(""); }}>Проверить сохранённый результат</button></div>}
    <p className="improvement-footnote">Оценки и доказательства остаются прежними.</p>
  </section>;
}
