import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  X,
  LoaderCircle,
  AlertCircle,
  Headphones,
  MessageSquare,
  ArrowUpRight,
  AudioLines,
  Search,
  ExternalLink,
} from "lucide-react";
import type {
  Answer,
  Criterion,
  Conversation,
  Message,
  Status,
} from "../lib/types";

export function Spinner() {
  return <LoaderCircle size={17} className="spin" aria-hidden="true" />;
}
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? "small" : ""}`}>
      <span className="logo-mark">
        <AudioLines size={27} strokeWidth={2.2} />
      </span>
      <span>
        qulaq<span className="logo-dot">.</span>
      </span>
    </div>
  );
}
export function StatusBadge({ status }: { status: Status }) {
  const labels = {
    unrated: "Не оценён",
    evaluating: "Оценивается",
    evaluated: "Оценён",
    error: "Ошибка",
  };
  return (
    <span className={`status ${status}`}>
      <i />
      {labels[status]}
    </span>
  );
}
export function ChannelIcon({
  channel,
  size = 18,
}: {
  channel: string;
  size?: number;
}) {
  return channel === "voice call" ? (
    <Headphones size={size} />
  ) : (
    <MessageSquare size={size} />
  );
}
export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={18} />
      <span>{children}</span>
    </div>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const prev = document.activeElement as HTMLElement;
    d.showModal();
    return () => {
      d.close();
      prev?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) {
          const r = ref.current!.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          aria-label="Закрыть"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function answerLabel(answer: Answer, criterion: Criterion) {
  if (answer === null) return "N/A";
  if (criterion.type === "flag") return answer ? "Обнаружено" : "Не обнаружено";
  if (typeof answer === "boolean") return answer ? "Да" : "Нет";
  return `${answer} / ${Math.max(...criterion.scale.map((s) => s.value), 0)}`;
}
export function scoreLabel(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Almaty",
  }).format(new Date(value));
}
export function AnswerSelect({
  criterion,
  value,
  onChange,
  id,
  disabled,
}: {
  criterion: Criterion;
  value: Answer;
  onChange: (a: Answer) => void;
  id: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      className="select"
      value={value === null ? "na" : String(value)}
      disabled={disabled}
      onChange={(e) =>
        onChange(
          e.target.value === "na"
            ? null
            : criterion.type === "scale"
              ? Number(e.target.value)
              : e.target.value === "true",
        )
      }
    >
      {criterion.type === "scale" ? (
        criterion.scale.map((s) => (
          <option key={s.value} value={s.value}>
            {s.value} — {s.label}
          </option>
        ))
      ) : (
        <>
          <option value="false">
            {criterion.type === "flag" ? "Не обнаружено" : "Нет"}
          </option>
          <option value="true">
            {criterion.type === "flag" ? "Обнаружено" : "Да"}
          </option>
        </>
      )}
      {criterion.allowNA && <option value="na">N/A — неприменимо</option>}
    </select>
  );
}
const speakerLabels = {
  operator: "Оператор",
  client: "Клиент",
  bot: "Бот",
  system: "Система",
};
export function Transcript({
  conversation,
  highlighted = [],
  onClear,
}: {
  conversation: Conversation;
  highlighted?: string[];
  onClear?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [audioError, setAudioError] = useState(false);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = highlighted[0];
    const target = refs.current[first];
    const container = scrollRef.current;
    if (target && container) {
      const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth";
      container.scrollTo({
        top:
          container.scrollTop +
          target.getBoundingClientRect().top -
          container.getBoundingClientRect().top -
          (container.clientHeight - target.clientHeight) / 2,
        behavior,
      });
      if (window.innerWidth < 980)
        container.parentElement?.scrollIntoView({ behavior, block: "start" });
    }
  }, [highlighted]);
  useEffect(() => {
    setAudioError(false);
    setQuery("");
  }, [conversation.id]);
  const matched = query.trim()
    ? conversation.messages.filter((m) =>
        m.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      )
    : [];
  function messageText(m: Message) {
    const q = query.trim();
    if (!q) return m.text;
    const index = m.text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
    return index < 0 ? (
      m.text
    ) : (
      <>
        {m.text.slice(0, index)}
        <mark>{m.text.slice(index, index + q.length)}</mark>
        {m.text.slice(index + q.length)}
      </>
    );
  }
  return (
    <section className="transcript-panel panel" aria-label="Транскрипт диалога">
      <div className="panel-heading">
        <div>
          <h2>Транскрипт</h2>
          <span>{conversation.messages.length} реплик</span>
        </div>
        <span className="badge quiet">{conversation.language}</span>
      </div>
      {conversation.channel === "voice call" && (
        <div className="audio-panel">
          <Headphones size={21} />
          <div>
            <strong>Запись разговора</strong>
            {conversation.audioUrl ? (
              <>
                <audio
                  key={conversation.audioUrl}
                  controls
                  preload="none"
                  src={conversation.audioUrl}
                  onError={() => setAudioError(true)}
                  aria-label="Запись разговора"
                />
                {audioError && (
                  <p className="audio-error">
                    Запись недоступна. Транскрипт остаётся доступным.
                  </p>
                )}
                <a
                  href={conversation.audioUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть запись <ExternalLink size={12} />
                </a>
              </>
            ) : (
              <p>Аудиозапись недоступна</p>
            )}
          </div>
        </div>
      )}
      <div className="transcript-search">
        <Search size={16} />
        <input
          aria-label="Поиск в транскрипте"
          name="transcriptSearch"
          autoComplete="off"
          placeholder="Найти в разговоре…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <>
            <span>{matched.length}</span>
            <button
              className="icon-button"
              aria-label="Очистить поиск в транскрипте"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
      {highlighted.length > 0 && (
        <div className="evidence-notice">
          Выделено доказательство
          <button className="button ghost small" onClick={onClear}>
            Снять выделение
          </button>
        </div>
      )}
      {query && matched.length === 0 && (
        <p className="search-no-match" role="status">
          Совпадений нет. Все реплики остаются доступными.
        </p>
      )}
      <div className="messages" ref={scrollRef}>
        {conversation.messages.map((m) => (
          <div
            key={m.id}
            ref={(el) => {
              refs.current[m.id] = el;
            }}
            className={`message ${m.speaker} ${highlighted.includes(m.id) ? "highlighted" : ""} ${matched.includes(m) ? "matched" : ""}`}
            data-message-id={m.id}
          >
            <div className="message-meta">
              <span className={`speaker-dot ${m.speaker}`} />
              <strong>{speakerLabels[m.speaker]}</strong>
              <time title={m.timestamp}>
                {m.timestamp.includes("T")
                  ? m.timestamp.slice(11, 19)
                  : m.timestamp}
              </time>
              {highlighted.includes(m.id) && (
                <span className="evidence-tag">
                  <ArrowUpRight size={11} />
                  Доказательство
                </span>
              )}
            </div>
            <p>{messageText(m)}</p>
          </div>
        ))}
      </div>
      <div className="transcript-end">
        <span />
        Конец разговора
        <span />
      </div>
    </section>
  );
}
