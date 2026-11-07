import { useEffect, useState } from "react";
import {
  Sparkles,
  Check,
  AlertTriangle,
  ArrowUpRight,
  MessageCircle,
  ChevronDown,
  CheckCheck,
  RotateCcw,
  ShieldCheck,
  ListChecks,
  CircleDashed,
} from "lucide-react";
import type {
  Appeal,
  Checklist,
  Conversation,
  Criterion,
  CriterionResult,
  Evaluation,
} from "../lib/types";
import {
  answerLabel,
  dateLabel,
  Empty,
  ErrorBox,
  scoreLabel,
  Spinner,
} from "./Shared";
import "./evaluation-motion.css";

function ScoreRing({ total }: { total: number | null }) {
  const amount = total === null ? null : Math.min(100, Math.max(0, total));
  return (
    <div
      className={`quality-ring ${amount === null ? "is-unavailable" : ""}`}
      role="img"
      aria-label={
        amount === null
          ? "Итог ещё не рассчитан"
          : `Оценка ${scoreLabel(total)} из 100`
      }
    >
      <svg
        className="quality-ring-svg"
        viewBox="0 0 112 112"
        aria-hidden="true"
      >
        <circle className="quality-ring-track" cx="56" cy="56" r="47" />
        {amount !== null && (
          <circle
            className="quality-ring-value"
            cx="56"
            cy="56"
            r="47"
            pathLength="100"
            strokeDasharray={`${amount} 100`}
            opacity={amount === 0 ? 0 : 1}
            transform="rotate(-90 56 56)"
          />
        )}
        <circle className="quality-ring-inner" cx="56" cy="56" r="36" />
      </svg>
      <span className="quality-ring-center" aria-hidden="true">
        {amount === null ? (
          <CircleDashed size={27} />
        ) : (
          <ShieldCheck size={28} />
        )}
        <span>{amount === null ? "Нет итога" : "из 100"}</span>
      </span>
    </div>
  );
}

interface Props {
  conversation: Conversation;
  checklists: Checklist[];
  evaluations: Evaluation[];
  selectedId: string;
  onSelect: (id: string) => void;
  appeals: Appeal[];
  onEvaluate: (id: string) => void;
  onRefresh: () => void;
  evaluating: boolean;
  needsRefresh: boolean;
  error: string;
  onEvidence: (ids: string[]) => void;
  onAppeal: (e: Evaluation, c: Criterion) => void;
  onOpenAppeal: (id: string) => void;
}
export default function EvaluationPanel(p: Props) {
  const [checklistId, setChecklistId] = useState(p.checklists[0]?.id || "");
  const [filter, setFilter] = useState("all");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const evaluation =
    p.evaluations.find((e) => e.id === p.selectedId) || p.evaluations.at(-1);
  const chosen =
    p.checklists.find((c) => c.id === checklistId) || p.checklists[0];
  const isIssue = (r: CriterionResult) => {
    const criterion = evaluation?.checklist.criteria.find(
      (c) => c.id === r.criterionId,
    );
    return (
      r.answer !== null &&
      (criterion?.type === "flag"
        ? r.answer === true
        : r.answer === false ||
          (typeof r.answer === "number" &&
            r.points !== null &&
            r.points < (criterion?.weight || 0)))
    );
  };
  useEffect(() => {
    if (evaluation)
      setCollapsed(
        evaluation.results
          .filter((r) => !isIssue(r) && !r.override && r.answer !== null)
          .map((r) => r.criterionId),
      );
  }, [evaluation?.id]);
  const results =
    evaluation?.results.filter(
      (r) =>
        filter === "all" ||
        (filter === "na"
          ? r.answer === null
          : filter === "changed"
            ? !!r.override
            : r.answer !== null &&
              (() => {
                const c = evaluation.checklist.criteria.find(
                  (c) => c.id === r.criterionId,
                );
                return c?.type === "flag"
                  ? r.answer === true
                  : r.answer === false ||
                      (typeof r.answer === "number" &&
                        r.points !== null &&
                        r.points < (c?.weight || 0));
              })()),
    ) || [];
  results.sort(
    (a, b) =>
      (isIssue(a) ? 0 : a.override ? 1 : a.answer === null ? 2 : 3) -
      (isIssue(b) ? 0 : b.override ? 1 : b.answer === null ? 2 : 3),
  );
  // Counts describe the returned criterion results, never recalculate a score.
  const distribution = { passed: 0, issues: 0, na: 0, unscored: 0 };
  evaluation?.results.forEach((result) => {
    const criterion = evaluation.checklist.criteria.find(
      (c) => c.id === result.criterionId,
    );
    if (!criterion) return;
    if (result.answer === null) distribution.na++;
    else if (isIssue(result)) distribution.issues++;
    else if (criterion.type === "scale" && result.points === null)
      distribution.unscored++;
    else distribution.passed++;
  });
  const distributionItems = [
    { key: "passed", label: "Без замечаний", count: distribution.passed },
    { key: "issues", label: "Требуют внимания", count: distribution.issues },
    { key: "na", label: "N/A", count: distribution.na },
    { key: "unscored", label: "Без расчёта", count: distribution.unscored },
  ].filter((item) => item.count > 0);
  return (
    <section className="evaluation-panel" aria-label="Оценка диалога">
      <div className="panel evaluate-control">
        <div className="panel-heading">
          <div>
            <h2>Оценка качества</h2>
            <span>По выбранному чек-листу</span>
          </div>
          <Sparkles size={21} />
        </div>
        <div className="evaluation-actions">
          <label className="sr-only" htmlFor="evaluation-checklist">
            Чек-лист для оценки
          </label>
          <select
            id="evaluation-checklist"
            className="select"
            value={chosen?.id || ""}
            onChange={(e) => setChecklistId(e.target.value)}
            disabled={p.evaluating}
          >
            {p.checklists.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · v{c.version}
              </option>
            ))}
          </select>
          <button
            className="button primary"
            disabled={p.evaluating || p.needsRefresh || !chosen}
            onClick={() => p.onEvaluate(chosen.id)}
          >
            {p.evaluating ? (
              <Spinner />
            ) : evaluation ? (
              <RotateCcw size={16} />
            ) : (
              <Sparkles size={16} />
            )}{" "}
            {p.evaluating
              ? "Оцениваем…"
              : evaluation
                ? "Оценить заново"
                : "Оценить"}
          </button>
        </div>
        {p.error && <ErrorBox>{p.error}</ErrorBox>}
        {p.needsRefresh && (
          <div className="reconcile-state" role="status">
            <p>
              Результат запроса неизвестен. Проверьте состояние перед новым
              запуском.
            </p>
            <button className="button secondary small" onClick={p.onRefresh}>
              Проверить состояние
            </button>
          </div>
        )}
      </div>
      {p.evaluating && (
        <div className="evaluation-loading panel quality-loading" role="status">
          <div className="quality-activity" aria-hidden="true">
            <div className="quality-activity-orbit">
              <span />
              <span />
            </div>
            <div className="quality-activity-document">
              <ListChecks size={25} />
              <div className="quality-activity-lines">
                <i />
                <i />
                <i />
              </div>
            </div>
            <span className="quality-activity-spark">
              <Sparkles size={16} />
            </span>
          </div>
          <h3>
            {p.conversation.demo
              ? "Готовим учебный результат"
              : "Оценка выполняется"}
          </h3>
          <p>
            {p.conversation.demo
              ? "Это демонстрация интерфейса. ИИ не запускается."
              : "Транскрипт доступен, пока сервер обрабатывает запрос."}
          </p>
          <div className="quality-waiting-label">
            <span className="quality-activity-wave" aria-hidden="true">
              {Array.from({ length: 7 }, (_, index) => (
                <i key={index} style={{ animationDelay: `${index * 90}ms` }} />
              ))}
            </span>
            <span>
              {p.conversation.demo
                ? "Подготавливаем пример"
                : "Ожидаем ответ сервера"}
            </span>
          </div>
          {!p.conversation.demo && (
            <button className="button secondary small" onClick={p.onRefresh}>
              Обновить статус
            </button>
          )}
        </div>
      )}
      {!evaluation && !p.evaluating && (
        <div className="panel">
          <Empty
            icon={<ListChecks size={28} />}
            title="Всё начинается с оценки"
            action={
              <div className="criteria-preview">
                {chosen?.criteria.slice(0, 4).map((c) => (
                  <span key={c.id}>
                    <CircleDashed size={14} />
                    {c.name}
                  </span>
                ))}
                <span className="muted">
                  {chosen?.criteria.length || 0} критериев в чек-листе
                </span>
              </div>
            }
          >
            Выберите чек-лист и нажмите «Оценить». Здесь появятся результат и
            доказательства по каждому критерию.
          </Empty>
        </div>
      )}
      {evaluation && (
        <>
          {evaluation.demo && (
            <div className="demo-note">
              <Sparkles size={16} />
              <span>Демонстрационная оценка — ИИ не запускался</span>
            </div>
          )}
          {p.evaluations.length > 1 && (
            <label className="run-select">
              Запуск оценки
              <select
                className="select"
                value={evaluation.id}
                onChange={(e) => p.onSelect(e.target.value)}
              >
                {[...p.evaluations].reverse().map((e, i) => (
                  <option key={e.id} value={e.id}>
                    {dateLabel(e.createdAt)} · v{e.checklist.version}
                    {i === 0 ? " · последний" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div
            className="score-card quality-score-card"
            key={p.conversation.id}
          >
            <div>
              <span className="score-caption">Общий результат</span>
              <div className="score-number">
                {scoreLabel(evaluation.total)}
                <small>/ 100</small>
              </div>
              {evaluation.originalTotal !== evaluation.total && (
                <span className="score-original">
                  Исходная оценка ИИ: {scoreLabel(evaluation.originalTotal)}
                </span>
              )}
              <p>
                {evaluation.total === null
                  ? "Для этих правил итог рассчитает сервер."
                  : evaluation.total >= 90
                    ? "Высокое качество диалога"
                    : evaluation.total >= 70
                      ? "Есть возможности для улучшения"
                      : "Нужно внимание к качеству"}
              </p>
            </div>
            <ScoreRing total={evaluation.total} />
            <div className="score-footer">
              <span>
                <ListChecks size={14} />
                {evaluation.checklist.criteria.length} критериев
              </span>
              <span>Версия {evaluation.checklist.version}</span>
            </div>
          </div>
          <div
            className="criteria-distribution"
            aria-label="Распределение результатов критериев"
          >
            <div className="criteria-distribution-bar" aria-hidden="true">
              {distributionItems.map((item) => (
                <span
                  key={item.key}
                  className={`distribution-${item.key}`}
                  style={{ flexGrow: item.count }}
                />
              ))}
            </div>
            <dl>
              {distributionItems.map((item) => (
                <div
                  key={item.key}
                  className={`distribution-item distribution-${item.key}`}
                >
                  <dt>
                    <i aria-hidden="true" />
                    {item.label}
                  </dt>
                  <dd>{item.count}</dd>
                </div>
              ))}
            </dl>
          </div>
          {evaluation.grossViolation && (
            <div className="violation">
              <AlertTriangle size={20} />
              <div>
                <strong>Грубое нарушение</strong>
                <span>Проверьте отмеченный критерий и доказательства.</span>
              </div>
            </div>
          )}
          <div className="result-heading">
            <h3>Разбор по критериям</h3>
            <select
              className="filter-select"
              aria-label="Фильтр критериев"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">Все критерии</option>
              <option value="issues">Потерянные баллы</option>
              <option value="na">N/A</option>
              <option value="changed">Пересмотренные</option>
            </select>
          </div>
          {results.length === 0 && (
            <div className="panel small-empty">
              Критериев с таким фильтром нет.
            </div>
          )}
          <div className="result-list">
            {results.map((r) => {
              const c = evaluation.checklist.criteria.find(
                (c) => c.id === r.criterionId,
              );
              if (!c) return null;
              const appeal =
                p.appeals.find(
                  (a) =>
                    a.evaluationId === evaluation.id &&
                    a.criterionId === c.id &&
                    a.status === "pending",
                ) ||
                p.appeals.find(
                  (a) =>
                    a.evaluationId === evaluation.id && a.criterionId === c.id,
                );
              const isClosed = collapsed.includes(c.id);
              const issue =
                c.type === "flag"
                  ? r.answer === true
                  : r.answer !== null &&
                    (r.answer === false ||
                      (typeof r.answer === "number" &&
                        r.points !== null &&
                        r.points < c.weight));
              return (
                <article
                  className={`criterion-result ${issue ? "has-issue" : ""} ${isClosed ? "is-collapsed" : "is-expanded"}`}
                  key={c.id}
                >
                  <button
                    className="criterion-result-toggle"
                    aria-expanded={!isClosed}
                    aria-controls={`criterion-detail-${evaluation.id}-${c.id}`}
                    onClick={() =>
                      setCollapsed((x) =>
                        isClosed ? x.filter((id) => id !== c.id) : [...x, c.id],
                      )
                    }
                  >
                    <span
                      className={`criterion-indicator ${r.answer === null ? "na" : issue ? "warning" : "success"}`}
                    >
                      {r.answer === null ? (
                        "—"
                      ) : issue ? (
                        <AlertTriangle size={16} />
                      ) : (
                        <Check size={17} />
                      )}
                    </span>
                    <span className="criterion-result-title">
                      <strong>{c.name}</strong>
                      <span>
                        {c.type === "flag"
                          ? "Отдельный флаг"
                          : `Вес ${c.weight}`}
                      </span>
                    </span>
                    <span className="criterion-answer">
                      {answerLabel(r.answer, c)}
                    </span>
                    <ChevronDown
                      size={16}
                      className={isClosed ? "" : "rotated"}
                    />
                  </button>
                  {!isClosed && (
                    <div
                      className="criterion-result-body"
                      id={`criterion-detail-${evaluation.id}-${c.id}`}
                    >
                      <p>{r.explanation}</p>
                      {r.answer === null && r.naReason && (
                        <div className="na-reason">{r.naReason}</div>
                      )}
                      {c.type !== "flag" && r.points !== null && (
                        <span className="points">
                          Вклад в оценку: {scoreLabel(r.points)} балла
                        </span>
                      )}
                      {r.evidence.map((ev, i) => (
                        <button
                          key={i}
                          className="evidence"
                          onClick={() => p.onEvidence(ev.messageIds)}
                        >
                          <span>
                            <MessageCircle size={14} />
                            {ev.kind === "range"
                              ? "Проверенный участок"
                              : "Доказательство"}
                            <ArrowUpRight size={14} />
                          </span>
                          {ev.kind === "range" ? (
                            <p className="evidence-range">
                              Проверен участок:{" "}
                              {ev.quote || "Открыть участок транскрипта"}
                            </p>
                          ) : (
                            <q>{ev.quote}</q>
                          )}
                        </button>
                      ))}
                      {r.override && (
                        <div className="override">
                          <CheckCheck size={17} />
                          <div>
                            <strong>
                              ИИ: {answerLabel(r.originalAnswer, c)} →
                              Проверяющий: {answerLabel(r.answer, c)}
                            </strong>
                            <p>{r.override.reason}</p>
                            <button
                              className="text-button"
                              onClick={() =>
                                p.onOpenAppeal(r.override!.appealId)
                              }
                            >
                              Открыть решение
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="criterion-result-footer">
                        {appeal ? (
                          <button
                            className={`text-button ${appeal.status === "pending" ? "amber" : ""}`}
                            onClick={() => p.onOpenAppeal(appeal.id)}
                          >
                            <MessageCircle size={14} />
                            {appeal.status === "pending"
                              ? "Ожидает рассмотрения"
                              : "Решение проверяющего"}
                            <ArrowUpRight size={13} />
                          </button>
                        ) : (
                          <button
                            className="text-button muted"
                            onClick={() => p.onAppeal(evaluation, c)}
                          >
                            <MessageCircle size={14} />
                            Оспорить
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
