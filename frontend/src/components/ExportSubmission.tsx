import { useRef, useState } from "react";
import type { Conversation } from "../lib/types";

/** Read-only dataset export: never evaluates conversations or changes saved scores. */
export default function ExportSubmission({ conversations, disabled = false }: {
  conversations: Conversation[]; disabled?: boolean;
}) {
  const groups = [...new Set(conversations.filter(c => !c.demo && c.groupId !== "UPLOAD").map(c => c.groupId))];
  const [selected, setSelected] = useState("");
  const [team, setTeam] = useState("Amazing Guys");
  const [count, setCount] = useState<65 | 10>(65);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const group = groups.includes(selected) ? selected : groups.includes("DEV") ? "DEV" : groups[0] ?? "";
  const loaded = conversations.filter(c => !c.demo && c.groupId === group).length;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || lock.current || !group || !team.trim()) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const base = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
      if (!/^\/api(?:\/[a-zA-Z0-9_-]+)*$/.test(base)) throw new Error("Недопустимый адрес API.");
      const response = await fetch(`${base}/exports/submission`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group, teamName: team.trim(), expectedCount: count }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || data.message || (typeof data.error === "string" ? data.error : "Не удалось выгрузить набор."));
      if (data.schema_version !== "1.0" || !Array.isArray(data.results) || data.results.length !== count)
        throw new Error("Сервер вернул неожиданный формат набора. Файл не скачан.");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = "results.json";
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось выгрузить набор."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="panel" aria-label="Официальный JSON всего набора">
    <h2>Результаты для организаторов · JSON 1.0</h2>
    <p>Весь выбранный набор, независимо от фильтров списка. Только сохранённые результаты; модель не запускается.</p>
    <form onSubmit={submit}>
      <fieldset disabled={disabled || busy}>
        <label className="field" htmlFor="submission-group">Набор для сдачи<select id="submission-group" className="select" value={group} onChange={e => { setSelected(e.target.value); setError(""); }}>
          {!groups.length && <option value="">Нет загруженных наборов</option>}
          {groups.map(id => <option key={id} value={id}>{id}</option>)}
        </select></label>
        <label className="field" htmlFor="submission-count">Формат сдачи<select id="submission-count" className="select" value={count} onChange={e => { setCount(Number(e.target.value) as 65 | 10); setError(""); }}>
          <option value={65}>DEV — 65 диалогов</option><option value={10}>Контрольный набор — 10 диалогов</option>
        </select></label>
        <label className="field">Название команды<input className="input" value={team} maxLength={120} required onChange={e => setTeam(e.target.value)} /></label>
        <p>Загружено: {loaded}. Требуется: {count}. Сохраните файл в {count === 65 ? "results/dev/results.json" : "results/prod/results.json"}.</p>
        <p>Нужен исходный чек-лист из восьми критериев. Несовместимые правила или неполный набор будут отклонены; ошибки обработки сохраняются отдельными записями.</p>
        <button className="button secondary" disabled={!group || !team.trim()} type="submit">{busy ? "Готовим JSON…" : "Скачать официальный JSON набора"}</button>
      </fieldset>
    </form>
    {error && <p role="alert">{error}</p>}
  </section>;
}
