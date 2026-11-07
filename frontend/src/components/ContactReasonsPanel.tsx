import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Tags } from "lucide-react";
import type { ManagerReportRow } from "../lib/managerReport";
import type { Evidence } from "../lib/types";
import {
  CONTACT_REASON_GROUPS,
  RESOLUTION_LABELS,
} from "../lib/contactReasons";
import { EvidenceCard, Spinner, Transcript } from "./Shared";
import "./contact-reasons.css";

type CategoryFilter =
  "all" | "unclassified" | (typeof CONTACT_REASON_GROUPS)[number]["id"];
type ResolutionFilter =
  "all" | "resolved" | "unresolved" | "unknown" | "unclassified";

function sourceEvidence(row: ManagerReportRow, ids: string[]): Evidence[] {
  const selected = new Set(ids);
  return row.conversation.messages
    .filter((message) => selected.has(message.id))
    .map((message) => ({
      messageIds: [message.id],
      quote: message.text,
      kind: "quote" as const,
    }));
}

function ReasonDetail({ row }: { row: ManagerReportRow }) {
  const reason = row.evaluation.contactReason;
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const categoryEvidence = sourceEvidence(
    row,
    reason?.classifier?.messageIds ?? reason?.evidenceIds ?? [],
  );
  const resolutionEvidence = sourceEvidence(
    row,
    reason?.resolution.evidenceIds ?? [],
  );
  return (
    <div className="contact-detail">
      <Transcript
        conversation={row.conversation}
        highlighted={highlighted}
        onClear={() => setHighlighted([])}
      />
      <div className="contact-detail-notes">
        <h4>Почему выбрана причина</h4>
        {reason?.classifier?.provider === "laya" && (
          <p className="contact-classifier-source">
            Laya · локально. Автоматический выбор может быть ошибочным;
            проверьте исходный фрагмент.
          </p>
        )}
        <p>
          {reason?.reason ??
            "В этой сохранённой оценке нет классификации причины обращения."}
        </p>
        {categoryEvidence.length ? (
          categoryEvidence.map((evidence) => (
            <EvidenceCard
              key={evidence.messageIds[0]}
              evidence={evidence}
              onSelect={setHighlighted}
            />
          ))
        ) : (
          <p className="contact-muted">Подтверждающие реплики не указаны.</p>
        )}
        <h4>Результат обращения</h4>
        <p>
          {reason?.resolution.reason ??
            "Результат обращения не классифицирован."}
        </p>
        {resolutionEvidence.length ? (
          resolutionEvidence.map((evidence) => (
            <EvidenceCard
              key={evidence.messageIds[0]}
              evidence={evidence}
              onSelect={setHighlighted}
            />
          ))
        ) : (
          <p className="contact-muted">Реплики о результате не указаны.</p>
        )}
        <p className="contact-readonly">
          Только просмотр сохранённой оценки. Баллы и решения здесь не
          изменяются.
        </p>
      </div>
    </div>
  );
}

export default function ContactReasonsPanel({
  rows,
  onClassify,
}: {
  rows: ManagerReportRow[];
  onClassify?: (evaluationId: string) => Promise<void>;
}) {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [resolution, setResolution] = useState<ResolutionFilter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [classifyingId, setClassifyingId] = useState<string | null>(null);
  const [classificationErrors, setClassificationErrors] = useState<
    Record<string, string>
  >({});
  const classificationPending = useRef(false);
  const id = useId();
  const classified = rows.filter((row) => row.evaluation.contactReason).length;
  const missing = rows.length - classified;
  const unresolved = rows.filter(
    (row) => row.evaluation.contactReason?.resolution.status === "unresolved",
  ).length;
  const groups = CONTACT_REASON_GROUPS.map((group) => ({
    ...group,
    count: rows.filter(
      (row) => row.evaluation.contactReason?.primary === group.id,
    ).length,
  }));
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      const reason = row.evaluation.contactReason;
      if (
        category === "unclassified"
          ? !!reason
          : category !== "all" && reason?.primary !== category
      )
        return false;
      if (
        resolution === "unclassified"
          ? !!reason
          : resolution !== "all" && reason?.resolution.status !== resolution
      )
        return false;
      return (
        !needle ||
        [
          row.conversation.externalId,
          row.conversation.id,
          reason?.summary ?? "",
          ...row.conversation.messages.map((message) => message.text),
        ].some((text) => text.toLocaleLowerCase().includes(needle))
      );
    });
  }, [rows, category, resolution, query]);
  const categoryLabel = (value: string) =>
    CONTACT_REASON_GROUPS.find((group) => group.id === value)?.label ?? value;

  async function classify(evaluationId: string) {
    if (!onClassify || classificationPending.current) return;
    classificationPending.current = true;
    setClassifyingId(evaluationId);
    setClassificationErrors((previous) => ({
      ...previous,
      [evaluationId]: "",
    }));
    try {
      await onClassify(evaluationId);
    } catch (error) {
      setClassificationErrors((previous) => ({
        ...previous,
        [evaluationId]:
          error instanceof Error
            ? error.message
            : "Не удалось определить причину. Повторите действие позже.",
      }));
    } finally {
      classificationPending.current = false;
      setClassifyingId(null);
    }
  }

  return (
    <section
      className="contact-reasons panel"
      aria-labelledby={`${id}-heading`}
    >
      <div className="contact-heading">
        <div>
          <h2 id={`${id}-heading`}>Причины обращений</h2>
          <p>
            Одна основная причина на диалог. Дополнительные темы показаны только
            как метки.
          </p>
        </div>
        <Tags size={22} aria-hidden="true" />
      </div>
      <dl className="contact-counts">
        <div>
          <dt>Диалогов в периоде</dt>
          <dd>{rows.length}</dd>
        </div>
        <div>
          <dt>С классификацией</dt>
          <dd>{classified}</dd>
        </div>
        <div>
          <dt>Явно не решены</dt>
          <dd>{unresolved}</dd>
        </div>
      </dl>
      <p className="contact-scope">
        «{categoryLabel("unknown")}» и статус «{RESOLUTION_LABELS.unknown}»
        означают, что классификация есть, но данных недостаточно. «Без
        классификации» — в сохранённой оценке этот раздел отсутствует. Фильтры
        ниже не меняют общие счётчики.
      </p>
      {onClassify && (
        <p className="contact-laya-note">
          После нового анализа Kimi подключённая Laya автоматически определяет
          группу. Кнопка в карточке нужна для старых анализов: она не
          пересчитывает баллы и не расходует квоту Kimi.
        </p>
      )}
      <div className="contact-browser">
        <div
          className="contact-categories"
          role="group"
          aria-label="Категории причин обращений"
        >
          <button
            type="button"
            className="contact-category contact-category-all"
            aria-pressed={category === "all"}
            onClick={() => {
              setCategory("all");
              setExpanded(null);
            }}
          >
            <span>Все причины</span>
            <strong>{rows.length}</strong>
          </button>
          {groups.map((group) => (
            <button
              type="button"
              key={group.id}
              className="contact-category"
              aria-pressed={category === group.id}
              onClick={() => {
                setCategory(group.id);
                setExpanded(null);
              }}
            >
              <span className="contact-category-name">{group.label}</span>
              <strong>{group.count}</strong>
              <span className="contact-category-track" aria-hidden="true">
                <i
                  style={{
                    transform: `scaleX(${rows.length ? group.count / rows.length : 0})`,
                  }}
                />
              </span>
            </button>
          ))}
          <button
            type="button"
            className="contact-category contact-category-missing"
            aria-pressed={category === "unclassified"}
            onClick={() => {
              setCategory("unclassified");
              setExpanded(null);
            }}
          >
            <span>Без классификации</span>
            <strong>{missing}</strong>
          </button>
          <p className="contact-muted">
            Доли рассчитаны от всех {rows.length} диалогов выбранного периода.
          </p>
        </div>
        <div className="contact-results">
          <div className="contact-filters">
            <label className="contact-search">
              <span>Поиск по обращениям</span>
              <div>
                <Search size={15} aria-hidden="true" />
                <input
                  aria-label="Поиск по обращениям"
                  className="input"
                  type="search"
                  value={query}
                  placeholder="Текст, номер или краткое описание"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setExpanded(null);
                  }}
                />
              </div>
            </label>
            <label>
              <span>Статус решения</span>
              <select
                aria-label="Статус решения"
                className="select"
                value={resolution}
                onChange={(event) => {
                  setResolution(event.target.value as ResolutionFilter);
                  setExpanded(null);
                }}
              >
                <option value="all">Все результаты</option>
                <option value="resolved">{RESOLUTION_LABELS.resolved}</option>
                <option value="unresolved">
                  {RESOLUTION_LABELS.unresolved}
                </option>
                <option value="unknown">{RESOLUTION_LABELS.unknown}</option>
                <option value="unclassified">Без классификации</option>
              </select>
            </label>
          </div>
          <p className="contact-match-count" role="status">
            Найдено обращений: {filtered.length}
          </p>
          {!classified && (
            <p className="contact-notice">
              {onClassify
                ? "Для старых результатов выберите «Определить причину · Laya». В новых анализах подключённая Laya запускается автоматически после Kimi."
                : "Классификация появится в новых оценках после разрешённого запуска анализа. Существующие записи автоматически не пересчитываются."}
            </p>
          )}
          {!filtered.length ? (
            <div className="contact-empty">
              <h3>
                {rows.length
                  ? "Нет обращений по этим фильтрам"
                  : "Пока нет оценок за выбранный период"}
              </h3>
              <p>
                {rows.length
                  ? "Выберите другую категорию, результат или измените поиск."
                  : "Выберите период с сохранёнными оценками. Причины будут показаны, когда классификация сохранится вместе с оценкой."}
              </p>
            </div>
          ) : (
            <div className="contact-records">
              {filtered.map((row) => {
                const reason = row.evaluation.contactReason;
                const open = expanded === row.evaluation.id;
                const detailId = `${id}-detail-${row.evaluation.id}`;
                const classifying = classifyingId === row.evaluation.id;
                const classificationError =
                  classificationErrors[row.evaluation.id] ||
                  row.evaluation.classificationError?.message;
                return (
                  <article className="contact-record" key={row.evaluation.id}>
                    <div className="contact-record-heading">
                      <h3>{row.conversation.externalId}</h3>
                      <span>
                        {row.conversation.language} · {row.day}
                      </span>
                    </div>
                    <div className="contact-record-tags">
                      {reason?.classifier?.provider === "laya" && (
                        <span className="contact-laya-badge">
                          Laya · локально
                        </span>
                      )}
                      <span>
                        {reason
                          ? categoryLabel(reason.primary)
                          : "Без классификации"}
                      </span>
                      <span
                        className={`contact-resolution ${reason?.resolution.status ?? "unclassified"}`}
                      >
                        {reason
                          ? RESOLUTION_LABELS[reason.resolution.status]
                          : "Результат не классифицирован"}
                      </span>
                    </div>
                    <p className="contact-record-summary">
                      {reason?.summary ??
                        "Причина обращения не сохранена в этой оценке."}
                    </p>
                    {!!reason?.secondary.length && (
                      <p className="contact-secondary">
                        Дополнительные темы:{" "}
                        {reason.secondary.map(categoryLabel).join(" · ")}
                      </p>
                    )}
                    {reason && (
                      <p className="contact-resolution-reason">
                        <strong>Результат:</strong> {reason.resolution.reason}
                      </p>
                    )}
                    {onClassify &&
                      (!reason?.classifier || classificationError) && (
                        <div
                          className="contact-classify-action"
                          aria-busy={classifying}
                        >
                          <button
                            type="button"
                            className="button secondary small"
                            disabled={classifyingId !== null}
                            onClick={() => void classify(row.evaluation.id)}
                          >
                            {classifying && <Spinner />}
                            {classifying
                              ? "Определяем причину…"
                              : "Определить причину · Laya"}
                          </button>
                          {classifying && (
                            <span role="status">
                              Локальная Laya обрабатывает фрагмент диалога.
                            </span>
                          )}
                        </div>
                      )}
                    {!classifying && classificationError && (
                      <p className="contact-classification-error" role="alert">
                        {classificationError} Ошибка не является категорией «
                        {categoryLabel("unknown")}».
                      </p>
                    )}
                    <button
                      type="button"
                      className="contact-open"
                      aria-expanded={open}
                      aria-controls={detailId}
                      onClick={() =>
                        setExpanded(open ? null : row.evaluation.id)
                      }
                    >
                      {open
                        ? "Скрыть диалог и доказательства"
                        : "Диалог и доказательства"}
                      <ChevronDown size={15} aria-hidden="true" />
                    </button>
                    {open && (
                      <div
                        id={detailId}
                        role="region"
                        aria-label={`Диалог и доказательства ${row.conversation.externalId}`}
                      >
                        <ReasonDetail row={row} />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
