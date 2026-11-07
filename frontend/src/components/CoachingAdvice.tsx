import { useState } from "react";
import { Lightbulb, ArrowUpRight, ChevronDown } from "lucide-react";
import type { Criterion, CriterionResult } from "../lib/types";
import { isCriterionIssue } from "../lib/coaching";
import "./coaching-advice.css";

export default function CoachingAdvice({
  criterion,
  result,
  onEvidence,
}: {
  criterion: Criterion;
  result: CriterionResult;
  onEvidence: (ids: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!isCriterionIssue(criterion, result.answer)) return null;
  const advice = result.coaching;
  if (!advice) return null;
  const long = (advice.response?.length ?? 0) > 320;
  return (
    <section className="coaching-advice" aria-label="Как можно было ответить">
      <div className="coaching-heading">
        <Lightbulb size={18} aria-hidden="true" />
        <h4>
          {advice.needsContext
            ? "Для совета нужны правила компании"
            : "Как можно было ответить"}
        </h4>
      </div>
      <p className="coaching-source">
        Предложение ИИ · не реплика из разговора
      </p>
      {advice.response && (
        <>
          <blockquote>
            {expanded || !long
              ? advice.response
              : `${advice.response.slice(0, 320).trimEnd()}…`}
          </blockquote>
          {long && (
            <button
              type="button"
              className="coaching-expand"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Свернуть" : "Полный пример"}
              <ChevronDown size={14} />
            </button>
          )}
        </>
      )}
      <p className="coaching-explanation">
        <strong>По правилу «{criterion.name}»:</strong> {advice.explanation}
      </p>
      {advice.needsContext && (
        <p className="coaching-context">
          Готовую реплику не предлагаем, чтобы не выдумывать условия
          обслуживания.
        </p>
      )}
      <button
        type="button"
        className="coaching-evidence"
        onClick={() => onEvidence([...advice.messageIds])}
      >
        Показать исходный фрагмент
        <ArrowUpRight size={14} />
      </button>
    </section>
  );
}
