import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUpFromLine,
  ChevronDown,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import type { Conversation } from "../lib/types";
import { parseDataset } from "../lib/validation";
import "./upload-transcript.css";

const MAX_BYTES = 5 * 1024 * 1024;
const PAGE_SIZE = 100;
const MIN_READING_MS = 400;
const speakerNames = {
  operator: "Оператор",
  client: "Клиент",
  bot: "Бот",
  system: "Система",
};
type LocalFile =
  | { kind: "txt"; name: string; size: number; text: string; lines: number }
  | { kind: "json"; name: string; size: number; conversations: Conversation[] };

function readJsonDataset(text: string): Conversation[] {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("Не удалось прочитать JSON. Проверьте синтаксис файла.");
  }
  const data =
    input && typeof input === "object" && "data" in input ? input.data : null;
  const groupId =
    data && typeof data === "object" && "dataset_group_id" in data
      ? data.dataset_group_id
      : null;
  if (typeof groupId !== "string" || !groupId.trim()) {
    throw new Error(
      "JSON должен содержать data.dataset_group_id и набор диалогов в формате DEV.",
    );
  }
  const conversations = parseDataset(input, groupId);
  if (
    !conversations.length ||
    !conversations.some((conversation) =>
      conversation.messages.some((message) => message.text.trim()),
    )
  ) {
    throw new Error("В JSON нет непустых транскриптов для просмотра.");
  }
  return conversations;
}

export default function UploadTranscript() {
  const componentId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const dragDepth = useRef(0);
  const [file, setFile] = useState<LocalFile | null>(null);
  const [language, setLanguage] = useState<Conversation["language"]>("RU");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [visibleMessages, setVisibleMessages] = useState(PAGE_SIZE);

  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  async function loadFile(candidate: File) {
    if (busy) return;
    setError("");
    const extension = candidate.name.split(".").at(-1)?.toLowerCase();
    if (extension !== "txt" && extension !== "json") {
      setError("Поддерживаются только файлы .txt и .json.");
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError("Файл слишком большой. Максимальный размер — 5 МБ.");
      return;
    }
    if (!candidate.size) {
      setError("Файл пуст. Выберите файл с текстом разговора.");
      return;
    }
    const request = ++generation.current;
    const started = performance.now();
    // Keep the local reading state perceptible without implying analysis or
    // extending a read that already took longer than this brief interval.
    const finishReading = async () => {
      const remaining = MIN_READING_MS - (performance.now() - started);
      if (remaining > 0)
        await new Promise((resolve) => window.setTimeout(resolve, remaining));
    };
    setBusy(true);
    try {
      const bytes = await candidate.arrayBuffer();
      if (request !== generation.current) return;
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error(
          "Не удалось прочитать текст. Сохраните файл в кодировке UTF-8.",
        );
      }
      if (!text.trim()) {
        throw new Error("Файл пуст. Выберите файл с текстом разговора.");
      }
      if (text.includes("\0")) {
        throw new Error(
          "Файл содержит нетекстовые данные. Выберите TXT или JSON в UTF-8.",
        );
      }
      let next: LocalFile;
      if (extension === "json") {
        const conversations = readJsonDataset(text);
        next = {
          kind: "json",
          name: candidate.name,
          size: candidate.size,
          conversations,
        };
      } else {
        next = {
          kind: "txt",
          name: candidate.name,
          size: candidate.size,
          text,
          lines: text.split(/\r\n|\r|\n/).filter((line) => line.trim()).length,
        };
      }
      await finishReading();
      if (request !== generation.current) return;
      setSelectedId(next.kind === "json" ? next.conversations[0].id : "");
      setFile(next);
      setVisibleMessages(PAGE_SIZE);
      setExpanded(true);
    } catch (failure) {
      await finishReading();
      if (request === generation.current) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Не удалось прочитать файл. Попробуйте ещё раз.",
        );
      }
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }

  function resetFile() {
    generation.current++;
    setFile(null);
    setError("");
    setBusy(false);
    setExpanded(false);
    setSelectedId("");
    setVisibleMessages(PAGE_SIZE);
    if (inputRef.current) inputRef.current.value = "";
  }

  const selected =
    file?.kind === "json"
      ? file.conversations.find(
          (conversation) => conversation.id === selectedId,
        ) || file.conversations[0]
      : null;
  const count =
    file?.kind === "json"
      ? `Диалогов: ${file.conversations.length} · реплик: ${file.conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0)}`
      : file
        ? `Непустых строк: ${file.lines} · ${language}`
        : "";

  return (
    <section
      className="upload-transcript"
      aria-label="Загрузка транскрипта"
      aria-busy={busy}
    >
      <div className="upload-transcript-heading">
        <div className="upload-transcript-symbol" aria-hidden="true">
          <ArrowUpFromLine size={22} />
        </div>
        <div>
          <span className="upload-transcript-kicker">Ваш разговор</span>
          <h2>Загрузить транскрипт</h2>
          <p>Откройте свой файл, чтобы прочитать разговор здесь.</p>
        </div>
        <span className="upload-local-label">
          <LockKeyhole size={12} aria-hidden="true" /> Локальный просмотр
        </span>
      </div>
      <div
        className={`upload-dropzone ${dragging ? "is-dragging" : ""} ${busy ? "is-reading" : ""}`}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files") || busy) return;
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = busy ? "none" : "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (busy) return;
          if (event.dataTransfer.files.length !== 1) {
            setError("Выберите один файл для просмотра.");
            return;
          }
          void loadFile(event.dataTransfer.files[0]);
        }}
      >
        <div className="upload-dropzone-copy">
          <strong>
            {busy
              ? "Читаем файл…"
              : dragging
                ? "Отпустите файл здесь"
                : "Перетащите файл сюда"}
          </strong>
          <span>TXT или JSON · UTF-8 · до 5 МБ</span>
        </div>
        <div className="upload-file-controls">
          {file?.kind !== "json" && (
            <label
              className="upload-language"
              htmlFor={`${componentId}-language`}
            >
              Язык TXT
              <select
                id={`${componentId}-language`}
                className="select"
                value={language}
                disabled={busy}
                onChange={(event) =>
                  setLanguage(event.target.value as Conversation["language"])
                }
              >
                <option value="RU">RU</option>
                <option value="KZ">KZ</option>
                <option value="EN">EN</option>
              </select>
            </label>
          )}
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".txt,.json,text/plain,application/json"
            aria-label="Файл транскрипта"
            tabIndex={-1}
            disabled={busy}
            onChange={(event) => {
              const candidate = event.target.files?.[0];
              event.target.value = "";
              if (candidate) void loadFile(candidate);
            }}
          />
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
            ) : (
              <FileText size={16} aria-hidden="true" />
            )}
            {busy ? "Читаем файл…" : file ? "Заменить файл" : "Выбрать файл"}
          </button>
        </div>
      </div>
      {busy && (
        <div className="upload-reading-state" aria-hidden="true">
          <div className="upload-reading-lines">
            <i />
            <i />
            <i />
          </div>
          <div className="upload-reading-track">
            <span />
          </div>
        </div>
      )}
      {error && (
        <p className="upload-error" role="alert">
          {error}
          {file && <span> Предыдущий файл остаётся доступным.</span>}
        </p>
      )}
      <span className="sr-only" role="status">
        {busy ? "Читаем выбранный файл" : file ? `Файл открыт. ${count}` : ""}
      </span>
      {file && (
        <div
          className="upload-file-result"
          key={`${file.kind}:${file.name}:${file.size}`}
        >
          <div className="upload-file-summary">
            <FileText size={19} aria-hidden="true" />
            <div className="upload-file-identity">
              <strong>{file.name}</strong>
              <span>
                {count} ·{" "}
                {new Intl.NumberFormat("ru-RU", {
                  maximumFractionDigits: 1,
                }).format(file.size / 1024)}{" "}
                КБ
              </span>
            </div>
            <button
              className="button ghost small upload-remove"
              type="button"
              onClick={resetFile}
              aria-label="Удалить файл"
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>Удалить</span>
            </button>
          </div>
          <button
            className="upload-preview-toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls={`${componentId}-preview`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Свернуть предпросмотр" : "Показать предпросмотр"}
            <ChevronDown
              size={15}
              className={expanded ? "rotated" : ""}
              aria-hidden="true"
            />
          </button>
          <div
            id={`${componentId}-preview`}
            className={`upload-preview-reveal ${expanded ? "is-expanded" : ""}`}
            aria-hidden={!expanded}
            inert={!expanded}
          >
            <div className="upload-preview-clip">
              <div
                className="upload-preview"
                role="region"
                aria-label="Предпросмотр загруженного транскрипта"
              >
                {file.kind === "txt" ? (
                  <>
                    <div className="upload-preview-caption">
                      <span>Исходный текст · {language}</span>
                      <span>Без добавленных временных меток</span>
                    </div>
                    <pre className="upload-text-preview">{file.text}</pre>
                  </>
                ) : (
                  selected && (
                    <>
                      <label
                        className="upload-conversation-select"
                        htmlFor={`${componentId}-conversation`}
                      >
                        Диалог для предпросмотра
                        <select
                          id={`${componentId}-conversation`}
                          className="select"
                          value={selected.id}
                          onChange={(event) => {
                            setSelectedId(event.target.value);
                            setVisibleMessages(PAGE_SIZE);
                          }}
                        >
                          {file.conversations.map((conversation) => (
                            <option
                              value={conversation.id}
                              key={conversation.id}
                            >
                              {conversation.externalId} ·{" "}
                              {conversation.language} ·{" "}
                              {conversation.messages.length} реплик
                            </option>
                          ))}
                        </select>
                      </label>
                      <ol className="upload-message-list">
                        {selected.messages
                          .slice(0, visibleMessages)
                          .map((message) => (
                            <li
                              key={message.id}
                              className={`upload-message upload-speaker-${message.speaker}`}
                            >
                              <div>
                                <strong>{speakerNames[message.speaker]}</strong>
                                {message.timestamp && (
                                  <span className="upload-message-time">
                                    {message.timestamp}
                                  </span>
                                )}
                              </div>
                              <p>
                                {message.text ||
                                  "Пустая реплика в исходном файле."}
                              </p>
                            </li>
                          ))}
                        {!selected.messages.length && (
                          <li className="upload-no-messages">
                            В этом диалоге нет реплик.
                          </li>
                        )}
                      </ol>
                      {selected.messages.length > visibleMessages && (
                        <button
                          className="button ghost small upload-more"
                          type="button"
                          onClick={() =>
                            setVisibleMessages((value) => value + PAGE_SIZE)
                          }
                        >
                          Показать ещё{" "}
                          {Math.min(
                            PAGE_SIZE,
                            selected.messages.length - visibleMessages,
                          )}{" "}
                          реплик
                        </button>
                      )}
                    </>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="upload-processing-note">
        <div>
          <p id={`${componentId}-analysis-note`}>
            Анализ появится после подключения backend. Сейчас доступен только
            просмотр файла.
          </p>
          <span>
            Файл не отправляется на сервер и исчезнет после перезагрузки
            страницы.
          </span>
        </div>
        <button
          className="button primary small"
          type="button"
          disabled
          aria-describedby={`${componentId}-analysis-note`}
        >
          Анализировать
        </button>
      </div>
      <details className="upload-format-help">
        <summary>Какой JSON поддерживается?</summary>
        <p>
          Набор в формате DEV: isSuccess: true, data.dataset_group_id,
          data.total_records и data.records. Каждая запись содержит
          conversation_id, channel, language, transcript и audio_url. Реплики —
          timestamp, speaker и text. Язык и временные метки берутся из файла;
          аудио не загружается.
        </p>
      </details>
    </section>
  );
}
