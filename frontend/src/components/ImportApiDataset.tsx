import { useId, useRef, useState } from "react";
import { ArrowDownToLine, CheckCircle2, ChevronDown, Link2, LoaderCircle } from "lucide-react";
import "./import-api-dataset.css";

type ImportSummary = { count: number; audioCount: number };
type Props = {
  onImport: (url: string, groupId?: string) => Promise<ImportSummary>;
  disabled?: boolean;
};

export default function ImportApiDataset({ onImport, disabled = false }: Props) {
  const id = useId();
  const inFlight = useRef(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || inFlight.current) return;
    setError("");
    setSummary(null);
    const source = url.trim();
    let parsed: URL;
    try { parsed = new URL(source); }
    catch {
      setError("Вставьте полную HTTPS-ссылку API организаторов.");
      urlInput.current?.focus();
      return;
    }
    if (source.length > 8192 || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
      setError("Нужна HTTPS-ссылка API без логина, пароля и фрагмента после #.");
      urlInput.current?.focus();
      return;
    }
    const selectedGroup = groupId.trim();
    if (selectedGroup && !/^[\w-]{1,100}$/.test(selectedGroup)) {
      setError("Название набора: латинские буквы, цифры, дефис или подчёркивание, до 100 символов.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await onImport(source, selectedGroup || undefined);
      setSummary(result);
      setUrl("");
      setGroupId("");
    } catch (cause) {
      // The server returns safe messages. Never display a signed URL if an unexpected client error includes one.
      const message = cause instanceof Error ? cause.message : "";
      setError(message && message.length <= 400 && !/https?:\/\//i.test(message)
        ? message
        : "Не удалось загрузить набор по ссылке. Проверьте адрес API и доступ к данным.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="api-dataset-import" aria-labelledby={`${id}-title`}>
      <header className="api-import-heading">
        <span className="api-import-symbol" aria-hidden="true"><Link2 size={21} /></span>
        <div>
          <h2 id={`${id}-title`}>Загрузить по ссылке API</h2>
          <p>Диалоги, готовые транскрипты и ссылки на записи из набора организаторов.</p>
        </div>
      </header>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={disabled || busy} className="api-import-fields">
          <label htmlFor={`${id}-url`} className="api-import-label">Ссылка API организаторов</label>
          <div className="api-import-url-row">
            <input
              ref={urlInput}
              id={`${id}-url`}
              className="input api-import-url"
              type="url"
              value={url}
              onChange={(event) => { setUrl(event.target.value); setError(""); setSummary(null); }}
              placeholder="https://…"
              maxLength={8192}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
              aria-invalid={!!error}
              required
            />
            <button className="button primary api-import-submit" type="submit" disabled={!url.trim() || disabled || busy} aria-busy={busy}>
              {busy ? <LoaderCircle size={17} className="api-import-spinner" aria-hidden="true" /> : <ArrowDownToLine size={17} aria-hidden="true" />}
              <span>{busy ? "Загружаем…" : "Загрузить диалоги"}</span>
            </button>
          </div>
          <details className="api-import-options">
            <summary>Другой набор <ChevronDown size={14} aria-hidden="true" /></summary>
            <div className="api-import-group">
              <label htmlFor={`${id}-group`} className="api-import-label">Название набора · group_id</label>
              <input id={`${id}-group`} className="input" value={groupId}
                onChange={(event) => { setGroupId(event.target.value); setError(""); setSummary(null); }}
                placeholder="Например, CONTROL" maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false}
                aria-describedby={`${id}-group-help`} />
              <p id={`${id}-group-help`}>Оставьте пустым, чтобы загрузить набор из ссылки. Заполните, если организаторы выдали другое название.</p>
            </div>
          </details>
        </fieldset>
      </form>
      <p id={`${id}-help`} className="api-import-help">Загрузка не запускает ИИ. Выберите диалог и начните анализ отдельно. Ссылка очищается из формы после загрузки.</p>
      {disabled && !busy && <p className="api-import-help">Загрузка по ссылке сейчас недоступна. Дождитесь завершения текущей операции или проверьте подключение к серверу.</p>}
      {busy && <p className="api-import-progress" role="status">Получаем данные и проверяем транскрипты. Анализ не запускается.</p>}
      {error && <p id={`${id}-error`} className="api-import-error" role="alert">{error}</p>}
      {summary && <div className="api-import-success" role="status">
        <CheckCircle2 size={19} aria-hidden="true" />
        <div><strong>Набор загружен</strong>
          <p>В списке: {summary.count} диалогов, из них {summary.audioCount} со ссылкой на аудио</p>
          <span>Откройте разговор в списке ниже. Для прослушивания источник записи должен быть доступен.</span>
        </div>
      </div>}
    </section>
  );
}
