import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  Info,
  ListChecks,
  X,
} from "lucide-react";
import type { Workspace } from "../lib/types";
import { buildManagerReport } from "../lib/managerReport";
import { answerLabel, EvidenceCard, scoreLabel, Transcript } from "./Shared";
import "./manager-dashboard.css";
import CoachingAdvice from "./CoachingAdvice";
import DailyTrend from "./ManagerTrend";
import ContactReasonsPanel from "./ContactReasonsPanel";

type Report = ReturnType<typeof buildManagerReport>;
type Example = Report["violations"][number]["examples"][number];
type Language = "all" | "RU" | "KZ" | "EN";
const ZONE = "Asia/Almaty";

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;
  return {
    start: `${year}-${month}-01`,
    end: new Date(Date.UTC(Number(year), Number(month), 0))
      .toISOString()
      .slice(0, 10),
  };
}

export default function ManagerDashboard({
  workspace,
  onClassify,
}: {
  workspace: Workspace;
  onClassify?: (evaluationId: string) => Promise<void>;
}) {
  const [period, setPeriod] = useState(currentMonth);
  const [language, setLanguage] = useState<Language>("all");
  const [selection, setSelection] = useState<Example | null>(null);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const detailRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const { report, error } = useMemo(() => {
    if (!period.start || !period.end)
      return { report: null, error: "Укажите начало и конец периода." };
    try {
      return {
        report: buildManagerReport(workspace, { ...period, language }),
        error: "",
      };
    } catch (failure) {
      return {
        report: null,
        error:
          failure instanceof RangeError
            ? failure.message
            : "Не удалось построить отчёт за этот период.",
      };
    }
  }, [workspace, period, language]);
  const selectedRow =
    selection &&
    report?.rows.find(
      (row) =>
        row.evaluation.id === selection.evaluationId &&
        row.conversation.id === selection.recordId,
    );
  const criterion = selectedRow?.evaluation.checklist.criteria.find(
    (item) => item.id === selection?.criterionId,
  );
  const result = selectedRow?.evaluation.results.find(
    (item) => item.criterionId === selection?.criterionId,
  );
  useEffect(() => {
    setSelection(null);
    setHighlighted([]);
  }, [period.start, period.end, language]);
  useEffect(() => {
    if (!selection) return;
    const frame = requestAnimationFrame(() => {
      detailTitle.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({
        block: "start",
        behavior:
          document.documentElement.dataset.motion === "full" &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "smooth"
            : "instant",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [selection]);
  const repeated =
    report?.violations.filter((item) => item.occurrences > 1).length ?? 0;

  return (
    <section className="manager-dashboard" aria-label="Отчёт для руководителя">
      <header className="manager-page-heading">
        <div>
          <span className="manager-eyebrow">
            <BarChart3 size={15} aria-hidden="true" /> Качество общения
          </span>
          <h1>Отчёт для руководителя</h1>
          <p>
            От общего результата — к конкретному разговору и его
            доказательствам.
          </p>
        </div>
        <span className="manager-readonly-label">
          <ClipboardCheck size={14} aria-hidden="true" /> Только просмотр
        </span>
      </header>
      <form
        className="manager-filters panel"
        aria-label="Фильтры отчёта"
        onSubmit={(event) => event.preventDefault()}
      >
        <label htmlFor={`${id}-start`}>
          Начало периода
          <input
            id={`${id}-start`}
            className="input"
            type="date"
            value={period.start}
            onChange={(event) =>
              setPeriod((value) => ({ ...value, start: event.target.value }))
            }
          />
        </label>
        <label htmlFor={`${id}-end`}>
          Конец периода
          <input
            id={`${id}-end`}
            className="input"
            type="date"
            value={period.end}
            onChange={(event) =>
              setPeriod((value) => ({ ...value, end: event.target.value }))
            }
          />
        </label>
        <label htmlFor={`${id}-language`}>
          Язык отчёта
          <select
            id={`${id}-language`}
            className="select"
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
          >
            <option value="all">Все языки</option>
            <option value="RU">Русский · RU</option>
            <option value="KZ">Казахский · KZ</option>
            <option value="EN">Английский · EN</option>
          </select>
        </label>
        <button
          className="button secondary small"
          type="button"
          onClick={() => setPeriod(currentMonth())}
        >
          <CalendarDays size={15} aria-hidden="true" /> Текущий месяц
        </button>
        <p className="manager-period-note">
          Даты оценки · Asia/Almaty · до 366 дней
        </p>
      </form>
      {error && (
        <p className="manager-validation" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <p className="manager-scope-note">
            Последняя сохранённая оценка каждого диалога внутри периода.
            Используются текущие баллы с учётом пересмотра. Учебные оценки и
            Excel-предпросмотр исключены.
          </p>
          {!report.conversationCount ? (
            <div className="manager-empty panel">
              <BarChart3 size={30} aria-hidden="true" />
              <h2>Пока нет оценок за этот период</h2>
              <p>
                Измените даты или язык. Отчёт появится после сохранения
                результатов анализа; импортированные разговоры без оценки сюда
                не входят.
              </p>
            </div>
          ) : (
            <>
              {report.conversationCount < 10 && (
                <div className="manager-sample-note" role="note">
                  <Info size={17} aria-hidden="true" />
                  <p>
                    Небольшая выборка: {report.conversationCount} диалогов. Эти
                    наблюдения предварительные и не дают устойчивого рейтинга
                    качества.
                  </p>
                </div>
              )}
              <div className="manager-metrics">
                <div className="manager-metric manager-primary-metric">
                  <span>Средний балл</span>
                  <strong>
                    {scoreLabel(report.average)}
                    <small> / 100</small>
                  </strong>
                  <p>По {report.scoredCount} оценкам с рассчитанным итогом</p>
                </div>
                <div className="manager-metric">
                  <span>Оценённых диалогов</span>
                  <strong>{report.conversationCount}</strong>
                  <p>Один диалог учитывается один раз</p>
                </div>
                <div className="manager-metric">
                  <span>Повторяющихся проблем</span>
                  <strong>{repeated}</strong>
                  <p>Критериев с нарушением в двух и более диалогах</p>
                </div>
              </div>
              <section
                className="manager-trend panel"
                aria-label="Динамика качества"
              >
                <div className="manager-section-heading">
                  <div>
                    <h2>Динамика качества</h2>
                    <p>Средний текущий итог по дате оценки</p>
                  </div>
                  <span className="manager-chart-legend">
                    <i /> Балл из 100
                  </span>
                </div>
                <DailyTrend report={report} />
              </section>
              <section
                className="manager-violations panel"
                aria-label="Повторяющиеся нарушения"
              >
                <div className="manager-section-heading">
                  <div>
                    <h2>Критерии, требующие внимания</h2>
                    <p>
                      Доля нарушений среди применимых оценок. N/A исключён;
                      версии чек-листов показаны отдельно.
                    </p>
                  </div>
                  <ListChecks size={21} aria-hidden="true" />
                </div>
                {!report.violations.length ? (
                  <div className="manager-no-violations">
                    В сохранённых результатах за этот период нет критериев с
                    потерянными баллами или отмеченным грубым нарушением.
                  </div>
                ) : (
                  <ol className="manager-issue-list">
                    {report.violations.map((violation, index) => (
                      <li className="manager-issue" key={violation.key}>
                        <div className="manager-issue-top">
                          <div>
                            <span className="manager-issue-rank">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <h3>{violation.criterionName}</h3>
                          </div>
                          <strong>
                            {new Intl.NumberFormat("ru-RU", {
                              style: "percent",
                              maximumFractionDigits: 1,
                            }).format(violation.rate)}
                          </strong>
                        </div>
                        <div className="manager-issue-track" aria-hidden="true">
                          <span
                            style={{ transform: `scaleX(${violation.rate})` }}
                          />
                        </div>
                        <div className="manager-issue-meta">
                          <span>
                            {violation.occurrences} из {violation.eligible}{" "}
                            применимых оценок
                          </span>
                          <span>
                            {violation.checklistName} · v
                            {violation.checklistVersion}
                          </span>
                        </div>
                        <details className="manager-examples">
                          <summary>
                            Посмотреть примеры{" "}
                            <ChevronDown size={14} aria-hidden="true" />
                          </summary>
                          <div className="manager-example-buttons">
                            {violation.examples.map((example) => (
                              <button
                                className="manager-example-button"
                                type="button"
                                key={`${example.evaluationId}:${example.criterionId}`}
                                aria-expanded={
                                  selection?.evaluationId ===
                                    example.evaluationId &&
                                  selection.criterionId === example.criterionId
                                }
                                aria-controls={`${id}-detail`}
                                onClick={(event) => {
                                  triggerRef.current = event.currentTarget;
                                  setSelection(example);
                                  setHighlighted([...example.messageIds]);
                                }}
                              >
                                {example.externalId}
                                <ArrowUpRight size={14} aria-hidden="true" />
                              </button>
                            ))}
                          </div>
                        </details>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </>
      )}
      {report && (
        <ContactReasonsPanel rows={report.rows} onClassify={onClassify} />
      )}
      {selectedRow && criterion && result && (
        <section
          className="manager-detail"
          id={`${id}-detail`}
          ref={detailRef}
          aria-label="Разбор примера"
        >
          <header className="manager-detail-heading">
            <div>
              <span className="manager-eyebrow">Основание отчёта</span>
              <h2 ref={detailTitle} tabIndex={-1}>
                Диалог {selectedRow.conversation.externalId}
              </h2>
              <p>
                {selectedRow.conversation.language} ·{" "}
                {new Intl.DateTimeFormat("ru-RU", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: ZONE,
                }).format(new Date(selectedRow.evaluation.createdAt))}{" "}
                · Asia/Almaty
              </p>
            </div>
            <button
              type="button"
              className="button ghost small"
              aria-label="Закрыть разбор примера"
              onClick={() => {
                setSelection(null);
                setHighlighted([]);
                triggerRef.current?.focus({ preventScroll: true });
              }}
            >
              <X size={17} aria-hidden="true" /> Закрыть
            </button>
          </header>
          <div className="manager-detail-layout">
            <Transcript
              key={selectedRow.conversation.id}
              conversation={selectedRow.conversation}
              highlighted={highlighted}
              onClear={() => setHighlighted([])}
            />
            <article className="manager-detail-result panel">
              <span className="manager-detail-checklist">
                {selectedRow.evaluation.checklist.name} · v
                {selectedRow.evaluation.checklist.version}
              </span>
              <div className="manager-detail-score">
                <span>Текущий итог</span>
                <strong>
                  {scoreLabel(selectedRow.evaluation.total)}
                  <small> / 100</small>
                </strong>
              </div>
              <h3>{criterion.name}</h3>
              <div className="manager-detail-answer">
                <span>{answerLabel(result.answer, criterion)}</span>
                <span>
                  {criterion.type === "flag"
                    ? "Отдельный флаг"
                    : `Вес ${criterion.weight} · вклад ${scoreLabel(result.points)} балла`}
                </span>
              </div>
              <p className="manager-detail-explanation">{result.explanation}</p>
              {result.naReason && result.answer === null && (
                <p className="manager-detail-na">N/A: {result.naReason}</p>
              )}
              {result.override && (
                <div className="manager-review-note">
                  <strong>Учтено решение проверяющего</strong>
                  <p>{result.override.reason}</p>
                  <span>
                    Исходный ответ:{" "}
                    {answerLabel(result.originalAnswer, criterion)} · исходный
                    итог: {scoreLabel(selectedRow.evaluation.originalTotal)}
                  </span>
                </div>
              )}
              <CoachingAdvice
                key={`${selectedRow.evaluation.id}:${criterion.id}`}
                criterion={criterion}
                result={result}
                onEvidence={setHighlighted}
              />
              <h4>Доказательства</h4>
              {result.evidence.length ? (
                result.evidence.map((evidence, index) => (
                  <EvidenceCard
                    key={`${result.criterionId}:${index}`}
                    evidence={evidence}
                    onSelect={setHighlighted}
                  />
                ))
              ) : (
                <p className="manager-detail-no-evidence">
                  В этом результате не сохранены ссылки на реплики.
                </p>
              )}
              <p className="manager-detail-readonly">
                Только просмотр сохранённого результата. Действия анализа и
                апелляции здесь недоступны.
              </p>
            </article>
          </div>
        </section>
      )}
    </section>
  );
}
