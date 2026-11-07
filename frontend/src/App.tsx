import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Download,
  FileCheck2,
  Headphones,
  Inbox,
  LayoutList,
  Menu,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  AlertCircle,
  BookOpen,
  SlidersHorizontal,
  Clock3,
} from "lucide-react";
import { adapter, AdapterStateError } from "./lib/adapter";
import type {
  Answer,
  Appeal,
  Checklist,
  Conversation,
  Criterion,
  DecisionInput,
  Evaluation,
  Role,
  Workspace,
} from "./lib/types";
import ChecklistEditor from "./components/ChecklistEditor";
import EvaluationPanel from "./components/EvaluationPanel";
import {
  AnswerSelect,
  answerLabel,
  ChannelIcon,
  dateLabel,
  Empty,
  ErrorBox,
  Logo,
  Modal,
  scoreLabel,
  Spinner,
  StatusBadge,
  Transcript,
} from "./components/Shared";

type Route = {
  page: "dialogs" | "dialog" | "checklists" | "appeals" | "appeal";
  id?: string;
  evaluationId?: string;
};
const initialWorkspace: Workspace = {
  conversations: [],
  checklists: [],
  evaluations: [],
  appeals: [],
};
function readRoute(): Route {
  const [path, query] = location.hash.slice(1).split("?");
  const parts = (path || "/dialogs").split("/").filter(Boolean);
  const page = parts[0];
  return {
    page: ["dialogs", "dialog", "checklists", "appeals", "appeal"].includes(
      page,
    )
      ? (page as Route["page"])
      : "dialogs",
    id: parts[1] ? decodeURIComponent(parts[1]) : undefined,
    evaluationId: new URLSearchParams(query).get("evaluation") || undefined,
  };
}
function errorMessage(e: unknown) {
  return e instanceof Error
    ? e.message
    : "Не удалось выполнить действие. Попробуйте ещё раз.";
}
function storedRole(): Role {
  try {
    return sessionStorage.getItem("qulaq-role") === "reviewer"
      ? "reviewer"
      : "user";
  } catch {
    return "user";
  }
}
const navItems = [
  { page: "dialogs" as const, label: "Диалоги", icon: MessageSquare },
  { page: "checklists" as const, label: "Чек-листы", icon: ClipboardCheck },
  { page: "appeals" as const, label: "Мои апелляции", icon: Inbox },
];

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [route, setRoute] = useState<Route>(readRoute);
  const [role, setRole] = useState<Role>(storedRole);
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [toast, setToast] = useState("");
  const [help, setHelp] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [groupId, setGroupId] = useState("DEV");
  const [importError, setImportError] = useState("");
  const [evalError, setEvalError] = useState("");
  const [unknownEvaluation, setUnknownEvaluation] = useState<string | null>(
    null,
  );
  const mutationEpoch = useRef(0);
  const [isMobile, setIsMobile] = useState(
    () => matchMedia("(max-width: 720px)").matches,
  );
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [appealFilter, setAppealFilter] = useState("all");
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [appealDraft, setAppealDraft] = useState<{
    evaluation: Evaluation;
    criterion: Criterion;
  } | null>(null);
  const [comment, setComment] = useState("");
  const [formError, setFormError] = useState("");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const lastHash = useRef(location.hash);
  useEffect(() => {
    const media = matchMedia("(max-width: 720px)");
    const update = () => setIsMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!isMobile || !mobileMenu) return;
    const previous = document.activeElement as HTMLElement | null;
    const drawer = document.getElementById("sidebar");
    const controls = () =>
      Array.from(
        drawer?.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled]),a[href]",
        ) || [],
      );
    controls()[0]?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMobileMenu(false);
      }
      if (e.key === "Tab") {
        const items = controls();
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [isMobile, mobileMenu]);
  async function refresh() {
    setLoading(true);
    setLoadError("");
    try {
      setWorkspace(await adapter.load());
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    const handler = () => {
      if (
        dirtyRef.current &&
        !confirm(
          "Есть несохранённые изменения чек-листа. Выйти без сохранения?",
        )
      ) {
        history.replaceState(null, "", lastHash.current || "#/checklists");
        return;
      }
      dirtyRef.current = false;
      setDirty(false);
      lastHash.current = location.hash;
      setRoute(readRoute());
      setHighlighted([]);
      setEvalError("");
      setMobileMenu(false);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    setPage(1);
  }, [query, language, channel, status]);
  function go(next: Route, force = false) {
    if (
      dirty &&
      !force &&
      !confirm("Есть несохранённые изменения чек-листа. Выйти без сохранения?")
    )
      return;
    dirtyRef.current = false;
    setDirty(false);
    setHighlighted([]);
    setEvalError("");
    setMobileMenu(false);
    location.hash = `/${next.page}${next.id ? "/" + encodeURIComponent(next.id) : ""}${next.evaluationId ? "?evaluation=" + encodeURIComponent(next.evaluationId) : ""}`;
  }
  function switchRole(next: Role) {
    if (next === role) return;
    if (
      dirty &&
      !confirm(
        "Есть несохранённые изменения чек-листа. Сменить роль без сохранения?",
      )
    )
      return;
    setDirty(false);
    setRole(next);
    try {
      sessionStorage.setItem("qulaq-role", next);
    } catch {
      /* Still usable without storage. */
    }
    go({ page: next === "reviewer" ? "appeals" : "dialogs" }, true);
  }
  async function mutate(
    key: string,
    task: () => Promise<Workspace>,
    success?: string,
  ) {
    if (busyRef.current)
      throw new Error("Дождитесь завершения текущего действия.");
    busyRef.current = true;
    mutationEpoch.current += 1;
    setBusy(key);
    try {
      const next = await task();
      setWorkspace(next);
      if (success) setToast(success);
      return next;
    } catch (e) {
      if (e instanceof AdapterStateError) setWorkspace(e.workspace);
      throw e;
    } finally {
      mutationEpoch.current += 1;
      busyRef.current = false;
      setBusy("");
    }
  }
  async function importData() {
    setImportError("");
    try {
      const next = await mutate(
        "import",
        () => adapter.importDataset(groupId),
        "Набор загружен",
      );
      setToast(
        `Загружено ${next.conversations.filter((c) => !c.demo).length} диалогов. Оценки ещё не запускались.`,
      );
    } catch (e) {
      setImportError(errorMessage(e));
    }
  }
  const hasRunning = workspace.conversations.some(
    (c) => c.status === "evaluating",
  );
  useEffect(() => {
    if (adapter.mode !== "api" || !hasRunning) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled || ++attempts > 40) return;
      try {
        const epoch = mutationEpoch.current;
        const next = await adapter.load();
        if (!cancelled && !busyRef.current && epoch === mutationEpoch.current)
          setWorkspace(next);
      } catch (e) {
        if (!cancelled) setEvalError(errorMessage(e));
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasRunning]);
  const demo = workspace.conversations.find((c) => c.demo);
  const real = workspace.conversations.filter((c) => !c.demo);
  const pending = workspace.appeals.filter(
    (a) => a.status === "pending",
  ).length;
  const conversation = workspace.conversations.find((c) => c.id === route.id);
  const activeAppeal = workspace.appeals.find((a) => a.id === route.id);
  const latestEval = (id: string) =>
    workspace.evaluations.filter((e) => e.recordId === id).at(-1);
  const filtered = real.filter(
    (c) =>
      (!query ||
        c.externalId.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
      (language === "all" || c.language === language) &&
      (channel === "all" || c.channel === channel) &&
      (status === "all" || c.status === status),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const currentPage = Math.min(page, pages);
  const rows = filtered.slice((currentPage - 1) * 12, currentPage * 12);
  const appealRows = workspace.appeals
    .filter((a) => appealFilter === "all" || a.status === appealFilter)
    .sort((a, b) =>
      a.status === b.status
        ? b.createdAt.localeCompare(a.createdAt)
        : a.status === "pending"
          ? -1
          : 1,
    );
  const title =
    route.page === "dialogs"
      ? "Диалоги"
      : route.page === "dialog"
        ? "Карточка диалога"
        : route.page === "checklists"
          ? "Чек-листы"
          : route.page === "appeal"
            ? "Рассмотрение обращения"
            : role === "reviewer"
              ? "Апелляции"
              : "Мои апелляции";
  const openAppeal = (id: string) => go({ page: "appeal", id });
  async function sendAppeal() {
    if (!appealDraft || !comment.trim()) return;
    setFormError("");
    try {
      const next = await mutate(
        "appeal",
        () =>
          adapter.createAppeal(
            appealDraft.evaluation.id,
            appealDraft.criterion.id,
            comment.trim(),
          ),
        "Апелляция отправлена проверяющему",
      );
      const a = next.appeals.find(
        (a) =>
          a.evaluationId === appealDraft.evaluation.id &&
          a.criterionId === appealDraft.criterion.id &&
          a.status === "pending",
      );
      setAppealDraft(null);
      setComment("");
      if (a) openAppeal(a.id);
    } catch (e) {
      setFormError(errorMessage(e));
    }
  }
  const allowed =
    role === "user" || route.page === "appeals" || route.page === "appeal";
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        К содержимому
      </a>
      {mobileMenu && (
        <button
          className="sidebar-scrim"
          aria-label="Закрыть меню"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside
        id="sidebar"
        inert={isMobile && !mobileMenu ? true : undefined}
        className={`sidebar ${mobileMenu ? "is-open" : ""}`}
      >
        <button
          className="brand-button"
          aria-label="Qulaq — главная"
          onClick={() =>
            go({ page: role === "reviewer" ? "appeals" : "dialogs" })
          }
        >
          <Logo />
        </button>
        <div className="workspace-name">
          <span className="workspace-symbol">
            <AudioMark />
          </span>
          <div>
            <strong>Контроль качества</strong>
            <span>Рабочее пространство</span>
          </div>
        </div>
        <nav aria-label="Главная навигация">
          {(role === "user"
            ? navItems
            : [{ page: "appeals" as const, label: "Апелляции", icon: Inbox }]
          ).map((item) => (
            <button
              key={item.page}
              className={`nav-item ${route.page === item.page || (route.page === "dialog" && item.page === "dialogs") || (route.page === "appeal" && item.page === "appeals") ? "active" : ""}`}
              onClick={() => go({ page: item.page })}
              aria-current={route.page === item.page ? "page" : undefined}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.page === "appeals" && pending > 0 && <b>{pending}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className="connection-dot" />
            <div>
              <strong>
                {adapter.mode === "local"
                  ? "Локальное пространство"
                  : "Сервер подключён"}
              </strong>
              <span>
                {adapter.mode === "local"
                  ? "Данные на этом устройстве"
                  : "Результаты через API"}
              </span>
            </div>
          </div>
          <button
            className="nav-item help-button"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
            Как это работает
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-profile">
            <div className="avatar">{role === "user" ? "КК" : "ПР"}</div>
            <div>
              <strong>
                {role === "user" ? "Специалист по качеству" : "Проверяющий"}
              </strong>
              <span>Демонстрация ролей</span>
            </div>
            <span className="profile-status" />
          </div>
        </div>
      </aside>
      <div
        className="app-body"
        inert={isMobile && mobileMenu ? true : undefined}
      >
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-button"
              aria-label="Открыть меню"
              aria-expanded={mobileMenu}
              aria-controls="sidebar"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span>Рабочее пространство</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div
            className="role-control"
            role="group"
            aria-label="Роль в приложении"
          >
            <button
              className={role === "user" ? "selected" : ""}
              onClick={() => switchRole("user")}
              aria-pressed={role === "user"}
            >
              <MessageSquare size={15} />
              <span>Пользователь</span>
            </button>
            <button
              className={role === "reviewer" ? "selected" : ""}
              onClick={() => switchRole("reviewer")}
              aria-pressed={role === "reviewer"}
            >
              <ShieldCheck size={15} />
              <span>Проверяющий</span>
            </button>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="main-content"
          key={route.page === "dialog" ? route.id : route.page}
        >
          {loading ? (
            <div className="workspace-loading" role="status">
              <Logo small />
              <Spinner />
              <p>Открываем рабочее пространство…</p>
              <div className="skeleton-block" />
              <div className="skeleton-block short" />
            </div>
          ) : loadError ? (
            <div className="panel">
              <Empty
                icon={<AlertCircle size={30} />}
                title="Не удалось загрузить данные"
                action={
                  <button
                    className="button primary"
                    onClick={() => void refresh()}
                  >
                    Повторить
                  </button>
                }
              >
                {loadError}
              </Empty>
            </div>
          ) : !allowed ? (
            <div className="panel">
              <Empty
                icon={<ShieldCheck size={30} />}
                title="Рабочее место проверяющего"
                action={
                  <button
                    className="button primary"
                    onClick={() => go({ page: "appeals" })}
                  >
                    Открыть очередь
                  </button>
                }
              >
                В этом режиме разговоры открываются внутри апелляций.
              </Empty>
            </div>
          ) : (
            <>
              {route.page === "dialogs" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="heading-line">
                        <h1>Диалоги</h1>
                        <span className="count-badge">{real.length}</span>
                      </div>
                      <p>Каждый разговор — возможность стать лучше.</p>
                    </div>
                    <button
                      className="button secondary"
                      disabled={!demo}
                      onClick={() =>
                        demo && go({ page: "dialog", id: demo.id })
                      }
                    >
                      <Sparkles size={17} />
                      Учебный пример
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="dataset-bar panel">
                    <div className="dataset-label">
                      <span className="dataset-icon">
                        <Download size={21} />
                      </span>
                      <div>
                        <strong>Набор разговоров</strong>
                        <span>
                          {adapter.mode === "local"
                            ? "Локальный набор для разработки"
                            : "Готовые транскрипты и ссылки на записи"}
                        </span>
                      </div>
                    </div>
                    <div className="dataset-controls">
                      <label htmlFor="dataset-group">Набор</label>
                      <input
                        id="dataset-group"
                        name="groupId"
                        autoComplete="off"
                        spellCheck={false}
                        value={groupId}
                        maxLength={80}
                        onChange={(e) => setGroupId(e.target.value)}
                        className="input"
                      />
                      <button
                        className="button primary"
                        disabled={!!busy || !groupId.trim()}
                        onClick={() => void importData()}
                      >
                        {busy === "import" ? <Spinner /> : <Plus size={17} />}{" "}
                        {busy === "import"
                          ? "Загружаем…"
                          : real.length
                            ? "Обновить набор"
                            : "Загрузить набор"}
                      </button>
                    </div>
                  </div>
                  {importError && <ErrorBox>{importError}</ErrorBox>}
                  {real.length > 0 ? (
                    <>
                      <div className="dataset-summary">
                        <span>
                          <LayoutList size={16} />
                          <strong>{real.length}</strong> диалогов
                        </span>
                        <span>
                          <MessageSquare size={16} />
                          {
                            real.filter((c) => c.channel === "agent chat")
                              .length
                          }{" "}
                          чатов
                        </span>
                        <span>
                          <Headphones size={16} />
                          {
                            real.filter((c) => c.channel === "voice call")
                              .length
                          }{" "}
                          звонков
                        </span>
                        <span className="summary-languages">
                          {[...new Set(real.map((c) => c.language))].map(
                            (l) => (
                              <b key={l}>{l}</b>
                            ),
                          )}
                        </span>
                      </div>
                      <section
                        className="dialog-table panel"
                        aria-label="Список диалогов"
                      >
                        <div className="table-toolbar">
                          <div className="search-field">
                            <Search size={18} />
                            <input
                              aria-label="Поиск по ID"
                              name="conversationSearch"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="Найти диалог по ID…"
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                            />
                            {query && (
                              <button
                                className="icon-button"
                                aria-label="Очистить поиск"
                                onClick={() => setQuery("")}
                              >
                                <X size={15} />
                              </button>
                            )}
                          </div>
                          <div className="table-filters">
                            <SlidersHorizontal size={17} />
                            <select
                              aria-label="Фильтр по каналу"
                              value={channel}
                              onChange={(e) => setChannel(e.target.value)}
                            >
                              <option value="all">Все каналы</option>
                              <option value="agent chat">Чаты</option>
                              <option value="voice call">Звонки</option>
                            </select>
                            <select
                              aria-label="Фильтр по языку"
                              value={language}
                              onChange={(e) => setLanguage(e.target.value)}
                            >
                              <option value="all">Все языки</option>
                              <option>RU</option>
                              <option>KZ</option>
                              <option>EN</option>
                            </select>
                            <select
                              aria-label="Фильтр по статусу"
                              value={status}
                              onChange={(e) => setStatus(e.target.value)}
                            >
                              <option value="all">Все статусы</option>
                              <option value="unrated">Не оценён</option>
                              <option value="evaluating">Оценивается</option>
                              <option value="evaluated">Оценён</option>
                              <option value="error">Ошибка</option>
                            </select>
                          </div>
                        </div>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Диалог</th>
                                <th>Канал</th>
                                <th>Язык</th>
                                <th>Статус оценки</th>
                                <th>Итог</th>
                                <th>
                                  <span className="sr-only">
                                    Открыть диалог
                                  </span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((c) => (
                                <tr
                                  key={c.id}
                                  onClick={() =>
                                    go({ page: "dialog", id: c.id })
                                  }
                                >
                                  <td>
                                    <div className="conversation-cell">
                                      <div
                                        className={`channel-symbol ${c.channel === "voice call" ? "voice" : ""}`}
                                      >
                                        <ChannelIcon channel={c.channel} />
                                      </div>
                                      <div>
                                        <button
                                          className="row-link"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            go({ page: "dialog", id: c.id });
                                          }}
                                        >
                                          {c.externalId}
                                        </button>
                                        <p>
                                          {c.messages.find(
                                            (m) => m.speaker === "client",
                                          )?.text ||
                                            c.messages[0]?.text ||
                                            "Транскрипт"}
                                        </p>
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    {c.channel === "voice call"
                                      ? "Звонок"
                                      : "Чат"}
                                  </td>
                                  <td>
                                    <span
                                      className={`language-chip ${c.language.toLowerCase()}`}
                                    >
                                      {c.language}
                                    </span>
                                  </td>
                                  <td>
                                    <StatusBadge status={c.status} />
                                    {workspace.appeals.some(
                                      (a) =>
                                        a.recordId === c.id &&
                                        a.status === "pending",
                                    ) && (
                                      <span className="row-appeal">
                                        Открытых апелляций:{" "}
                                        {
                                          workspace.appeals.filter(
                                            (a) =>
                                              a.recordId === c.id &&
                                              a.status === "pending",
                                          ).length
                                        }
                                      </span>
                                    )}
                                  </td>
                                  <td className="table-score">
                                    {scoreLabel(
                                      latestEval(c.id)?.total ?? null,
                                    )}
                                  </td>
                                  <td>
                                    <ArrowUpRight size={16} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {filtered.length === 0 && (
                          <Empty
                            icon={<Search size={24} />}
                            title="Диалоги не найдены"
                            action={
                              <button
                                className="button secondary"
                                onClick={() => {
                                  setQuery("");
                                  setLanguage("all");
                                  setChannel("all");
                                  setStatus("all");
                                }}
                              >
                                Сбросить фильтры
                              </button>
                            }
                          >
                            Попробуйте другой ID или измените фильтры.
                          </Empty>
                        )}
                        <footer className="table-footer">
                          <span>
                            {filtered.length
                              ? `${(currentPage - 1) * 12 + 1}–${Math.min(currentPage * 12, filtered.length)} из ${filtered.length}`
                              : "0 диалогов"}
                          </span>
                          <div className="pagination">
                            <button
                              className="icon-button"
                              disabled={currentPage === 1}
                              aria-label="Предыдущая страница"
                              onClick={() => setPage(currentPage - 1)}
                            >
                              <ChevronLeft size={16} />
                            </button>
                            {Array.from({ length: pages }, (_, i) => i + 1).map(
                              (n) => (
                                <button
                                  key={n}
                                  aria-label={`Страница ${n}`}
                                  aria-current={
                                    n === currentPage ? "page" : undefined
                                  }
                                  className={n === currentPage ? "current" : ""}
                                  onClick={() => setPage(n)}
                                >
                                  {n}
                                </button>
                              ),
                            )}
                            <button
                              className="icon-button"
                              disabled={currentPage === pages}
                              aria-label="Следующая страница"
                              onClick={() => setPage(currentPage + 1)}
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </footer>
                      </section>
                    </>
                  ) : (
                    <div className="welcome-panel panel">
                      <div className="welcome-copy">
                        <span className="welcome-symbol">
                          <MessageSquare size={30} />
                          <span>
                            <Check size={15} />
                          </span>
                        </span>
                        <h2>
                          Услышать больше.
                          <br />
                          Понять каждый диалог.
                        </h2>
                        <p>
                          Загрузите набор, чтобы изучить разговоры, оценить
                          качество и разобраться в спорных моментах.
                        </p>
                        <div className="welcome-steps">
                          <span>
                            <b>1</b>Загрузите разговоры
                          </span>
                          <span>
                            <b>2</b>Выберите чек-лист
                          </span>
                          <span>
                            <b>3</b>Изучите результат
                          </span>
                        </div>
                      </div>
                      <div
                        className="conversation-illustration"
                        aria-hidden="true"
                      >
                        <div className="illustration-heading">
                          <span />
                          <i />
                          <i />
                        </div>
                        <div className="illustration-line">
                          <b />
                          <span />
                        </div>
                        <div className="illustration-bubble">
                          <i />
                          <i />
                          <i />
                        </div>
                        <div className="illustration-line second">
                          <b />
                          <span />
                        </div>
                        <div className="illustration-bubble reply">
                          <i />
                          <i />
                        </div>
                        <div className="illustration-check">
                          <CheckCheck size={22} />
                          <span>
                            У каждого вывода
                            <br />
                            <strong>есть доказательство</strong>
                          </span>
                        </div>
                      </div>
                      <span className="empty-label">Набор ещё не загружен</span>
                    </div>
                  )}
                  <button
                    className="demo-entry"
                    disabled={!demo}
                    onClick={() => demo && go({ page: "dialog", id: demo.id })}
                  >
                    <span className="demo-entry-icon">
                      <Sparkles size={22} />
                    </span>
                    <span>
                      <strong>Пройдите весь путь на учебном примере</strong>
                      <span>
                        Оценка, доказательства и апелляция — в одном разговоре.
                        ИИ не запускается.
                      </span>
                    </span>
                    <span className="demo-entry-cta">
                      Открыть пример
                      <ArrowRight size={17} />
                    </span>
                  </button>
                </>
              )}
              {route.page === "dialog" &&
                (conversation ? (
                  <>
                    <button
                      className="back-link"
                      onClick={() => go({ page: "dialogs" })}
                    >
                      <ArrowLeft size={16} />К диалогам
                    </button>
                    <div className="page-heading detail-heading">
                      <div>
                        <div className="heading-line">
                          <h1>
                            {conversation.demo
                              ? "Учебный диалог"
                              : conversation.externalId}
                          </h1>
                          {conversation.demo && (
                            <span className="badge demo">Учебный пример</span>
                          )}
                        </div>
                        <p>
                          <ChannelIcon
                            channel={conversation.channel}
                            size={15}
                          />
                          {conversation.channel === "voice call"
                            ? "Голосовой звонок"
                            : "Чат с клиентом"}
                          <span className="dot-separator" />
                          {conversation.language}
                          <span className="dot-separator" />
                          {conversation.messages.length} реплик
                        </p>
                      </div>
                      <StatusBadge
                        status={
                          busy === "evaluate"
                            ? "evaluating"
                            : conversation.status
                        }
                      />
                    </div>
                    {conversation.demo && (
                      <div className="context-note">
                        <Sparkles size={17} />
                        <span>
                          Искусственный разговор для знакомства с приложением.
                          Учебные результаты и обращения сохраняются в этой
                          вкладке.
                        </span>
                      </div>
                    )}
                    <div className="dialog-workspace">
                      <Transcript
                        conversation={conversation}
                        highlighted={highlighted}
                        onClear={() => setHighlighted([])}
                      />
                      <EvaluationPanel
                        conversation={conversation}
                        checklists={workspace.checklists}
                        evaluations={workspace.evaluations.filter(
                          (e) => e.recordId === conversation.id,
                        )}
                        selectedId={route.evaluationId || ""}
                        onSelect={(id) => go({ ...route, evaluationId: id })}
                        appeals={workspace.appeals}
                        evaluating={
                          busy === "evaluate" ||
                          conversation.status === "evaluating"
                        }
                        needsRefresh={unknownEvaluation === conversation.id}
                        onRefresh={async () => {
                          setEvalError("");
                          try {
                            setWorkspace(await adapter.load());
                            setUnknownEvaluation(null);
                          } catch (e) {
                            setEvalError(errorMessage(e));
                          }
                        }}
                        error={evalError}
                        onEvaluate={async (id) => {
                          setEvalError("");
                          try {
                            const next = await mutate(
                              "evaluate",
                              () => adapter.evaluate(conversation.id, id),
                              "Оценка готова",
                            );
                            const last = next.evaluations
                              .filter((e) => e.recordId === conversation.id)
                              .at(-1);
                            if (
                              last &&
                              readRoute().page === "dialog" &&
                              readRoute().id === conversation.id
                            )
                              go({ ...route, evaluationId: last.id });
                          } catch (e) {
                            if (
                              e instanceof AdapterStateError &&
                              e.outcomeUnknown
                            )
                              setUnknownEvaluation(conversation.id);
                            setEvalError(errorMessage(e));
                          }
                        }}
                        onEvidence={setHighlighted}
                        onAppeal={(evaluation, criterion) => {
                          setAppealDraft({ evaluation, criterion });
                          setComment("");
                          setFormError("");
                        }}
                        onOpenAppeal={openAppeal}
                      />
                    </div>
                  </>
                ) : (
                  <NotFound go={() => go({ page: "dialogs" })} />
                ))}
              {route.page === "checklists" && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>Чек-листы</h1>
                      <p>
                        Ваши стандарты качества, применимые к каждому разговору.
                      </p>
                    </div>
                    <span className="badge quiet">
                      <BookOpen size={15} />
                      {workspace.checklists.length} конфигураций
                    </span>
                  </div>
                  {adapter.mode === "local" && (
                    <div className="context-note">
                      <Sparkles size={17} />
                      <span>
                        Локальные настройки для разработки. Новые правила будут
                        реально применяться после подключения сервера оценки.
                      </span>
                    </div>
                  )}
                  <ChecklistEditor
                    checklists={workspace.checklists}
                    onDirtyChange={setDirty}
                    onSave={async (c) => {
                      await mutate(
                        "checklist",
                        () => adapter.saveChecklist(c),
                        "Чек-лист сохранён",
                      );
                    }}
                  />
                </>
              )}
              {route.page === "appeals" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="heading-line">
                        <h1>
                          {role === "reviewer" ? "Апелляции" : "Мои апелляции"}
                        </h1>
                        <span className="count-badge">
                          {workspace.appeals.length}
                        </span>
                      </div>
                      <p>
                        {role === "reviewer"
                          ? "Посмотрите на разговор ещё раз. Каждое решение имеет значение."
                          : "Все спорные оценки и решения по ним — в одном месте."}
                      </p>
                    </div>
                    {pending > 0 && (
                      <span className="badge pending">
                        <Clock3 size={15} />
                        {pending} ожидают решения
                      </span>
                    )}
                  </div>
                  <section className="panel appeals-panel">
                    <div
                      className="appeal-tabs"
                      role="group"
                      aria-label="Фильтр апелляций"
                    >
                      {[
                        { id: "all", name: "Все обращения" },
                        { id: "pending", name: "Ожидают" },
                        { id: "resolved", name: "Рассмотрены" },
                      ].map((f) => (
                        <button
                          className={appealFilter === f.id ? "active" : ""}
                          onClick={() => setAppealFilter(f.id)}
                          key={f.id}
                          aria-pressed={appealFilter === f.id}
                        >
                          {f.name}
                          <span>
                            {
                              workspace.appeals.filter(
                                (a) => f.id === "all" || a.status === f.id,
                              ).length
                            }
                          </span>
                        </button>
                      ))}
                    </div>
                    {appealRows.length > 0 ? (
                      <div className="appeal-list">
                        {appealRows.map((a) => {
                          const ev = workspace.evaluations.find(
                            (e) => e.id === a.evaluationId,
                          );
                          const criterion = ev?.checklist.criteria.find(
                            (c) => c.id === a.criterionId,
                          );
                          const conv = workspace.conversations.find(
                            (c) => c.id === a.recordId,
                          );
                          return (
                            <button
                              key={a.id}
                              className="appeal-row"
                              onClick={() => openAppeal(a.id)}
                            >
                              <span className={`appeal-row-icon ${a.status}`}>
                                <MessageSquare size={21} />
                              </span>
                              <span className="appeal-row-main">
                                <strong>
                                  {criterion?.name || "Критерий"}
                                  <span
                                    className={`badge ${a.status === "pending" ? "pending" : "resolved"}`}
                                  >
                                    {a.status === "pending"
                                      ? "Ожидает рассмотрения"
                                      : "Рассмотрено"}
                                  </span>
                                  {ev?.demo && (
                                    <span className="badge demo">Учебная</span>
                                  )}
                                </strong>
                                <span title={a.id}>
                                  {a.id.length > 18
                                    ? a.id.slice(0, 18) + "…"
                                    : a.id}
                                  <span className="dot-separator" />
                                  {conv?.externalId}{" "}
                                  <span className="dot-separator" />
                                  {dateLabel(a.createdAt)}
                                </span>
                                <p>
                                  {a.status === "resolved" && a.decision
                                    ? (a.decision.action === "confirm"
                                        ? "Оценка подтверждена. "
                                        : "Оценка изменена. ") +
                                      a.decision.reason
                                    : a.comment}
                                </p>
                              </span>
                              <span className="appeal-row-action">
                                {role === "reviewer" && a.status === "pending"
                                  ? "Рассмотреть"
                                  : "Открыть"}
                                <ArrowUpRight size={17} />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <Empty
                        icon={<Inbox size={30} />}
                        title={
                          appealFilter === "resolved"
                            ? "Рассмотренных обращений пока нет"
                            : "Здесь появятся обращения"
                        }
                        action={
                          role === "user" && (
                            <button
                              className="button secondary"
                              onClick={() => go({ page: "dialogs" })}
                            >
                              К диалогам
                              <ArrowRight size={16} />
                            </button>
                          )
                        }
                      >
                        {role === "reviewer"
                          ? "Когда пользователь оспорит критерий, обращение появится в этой очереди."
                          : "Откройте оценку диалога и нажмите «Оспорить» возле нужного критерия."}
                      </Empty>
                    )}
                  </section>
                </>
              )}
              {route.page === "appeal" &&
                (activeAppeal ? (
                  <AppealDetail
                    key={activeAppeal.id}
                    appeal={activeAppeal}
                    workspace={workspace}
                    role={role}
                    busy={busy === "decision"}
                    highlighted={highlighted}
                    setHighlighted={setHighlighted}
                    go={go}
                    onResolve={async (decision) => {
                      await mutate(
                        "decision",
                        () => adapter.resolveAppeal(activeAppeal.id, decision),
                        "Решение сохранено",
                      );
                    }}
                  />
                ) : (
                  <NotFound go={() => go({ page: "appeals" })} />
                ))}
            </>
          )}
          <footer className="workspace-footer">
            <span>
              QULAQ
              <span className="footer-dot" />
              Внимание к каждому разговору
            </span>
            <span>
              {adapter.mode === "local"
                ? "Локальная версия"
                : "Подключено к API"}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={17} />
          </span>
          <p>{toast}</p>
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {appealDraft && (
        <Modal
          title="Оспорить оценку"
          onClose={() => setAppealDraft(null)}
          busy={busy === "appeal"}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendAppeal();
            }}
          >
            <div className="modal-body">
              <div className="appeal-context">
                <span className="badge quiet">
                  {
                    workspace.conversations.find(
                      (c) => c.id === appealDraft.evaluation.recordId,
                    )?.externalId
                  }
                </span>
                <h3>{appealDraft.criterion.name}</h3>
                <p>{appealDraft.criterion.description}</p>
                <span>
                  Исходная оценка:{" "}
                  <strong>
                    {answerLabel(
                      appealDraft.evaluation.results.find(
                        (r) => r.criterionId === appealDraft.criterion.id,
                      )!.originalAnswer,
                      appealDraft.criterion,
                    )}
                  </strong>
                </span>
              </div>
              <label className="field" htmlFor="appeal-comment">
                Почему вы не согласны?
                <textarea
                  id="appeal-comment"
                  name="appealComment"
                  className="textarea"
                  rows={5}
                  required
                  maxLength={4000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Укажите, что стоит пересмотреть. Можно сослаться на конкретную реплику."
                />
              </label>
              <span className="field-hint">
                Комментарий увидит проверяющий. Баллы изменятся только после его
                решения.
              </span>
              {formError && <ErrorBox>{formError}</ErrorBox>}
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                type="button"
                disabled={busy === "appeal"}
                onClick={() => setAppealDraft(null)}
              >
                Отмена
              </button>
              <button
                className="button primary"
                disabled={!!busy || !comment.trim()}
              >
                {busy === "appeal" ? <Spinner /> : <ArrowUpRight size={17} />}
                Отправить апелляцию
              </button>
            </div>
          </form>
        </Modal>
      )}
      {help && (
        <Modal title="Как работает QULAQ" onClose={() => setHelp(false)}>
          <div className="modal-body help-content">
            <p>
              Рабочее пространство для контроля качества готовых диалогов на
              русском, казахском и английском языках.
            </p>
            <ol>
              <li>
                <strong>Загрузите набор.</strong> Разговоры появятся без оценок.
              </li>
              <li>
                <strong>Выберите правила.</strong> Чек-лист задаёт критерии и
                допустимые ответы.
              </li>
              <li>
                <strong>Изучите оценку.</strong> Доказательства ведут к
                репликам.
              </li>
              <li>
                <strong>Пересмотрите спорное.</strong> Пользователь подаёт
                апелляцию, проверяющий сохраняет решение с причиной.
              </li>
            </ol>
            <div className="context-note">
              <Sparkles size={18} />
              <span>
                В локальной версии полный цикл доступен на учебном примере. ИИ
                не запускается. Учебные данные сохраняются только в текущей
                вкладке; реальные разговоры не сохраняются в браузере.
              </span>
            </div>
            <p className="muted">
              Переключатель ролей показывает два сценария работы и не является
              системой авторизации.
            </p>
          </div>
          <div className="modal-footer">
            <button className="button primary" onClick={() => setHelp(false)}>
              Понятно
              <Check size={16} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function AudioMark() {
  return (
    <span className="mini-wave">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
function NotFound({ go }: { go: () => void }) {
  return (
    <div className="panel">
      <Empty
        icon={<Search size={26} />}
        title="Запись недоступна"
        action={
          <button className="button primary" onClick={go}>
            Вернуться к списку
          </button>
        }
      >
        Обновите набор или выберите запись из списка.
      </Empty>
    </div>
  );
}
function AppealDetail({
  appeal,
  workspace,
  role,
  busy,
  highlighted,
  setHighlighted,
  go,
  onResolve,
}: {
  appeal: Appeal;
  workspace: Workspace;
  role: Role;
  busy: boolean;
  highlighted: string[];
  setHighlighted: (ids: string[]) => void;
  go: (r: Route) => void;
  onResolve: (d: DecisionInput) => Promise<void>;
}) {
  const evaluation = workspace.evaluations.find(
    (e) => e.id === appeal.evaluationId,
  );
  const conversation = workspace.conversations.find(
    (c) => c.id === appeal.recordId,
  );
  const criterion = evaluation?.checklist.criteria.find(
    (c) => c.id === appeal.criterionId,
  );
  const result = evaluation?.results.find(
    (r) => r.criterionId === appeal.criterionId,
  );
  const [action, setAction] = useState<"confirm" | "change">("confirm");
  const [answer, setAnswer] = useState<Answer>(
    result ? result.originalAnswer : false,
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (!evaluation || !conversation || !criterion || !result)
    return <NotFound go={() => go({ page: "appeals" })} />;
  return (
    <>
      <button className="back-link" onClick={() => go({ page: "appeals" })}>
        <ArrowLeft size={16} />К апелляциям
      </button>
      <div className="page-heading detail-heading">
        <div>
          <div className="heading-line">
            <h1>{criterion.name}</h1>
            <span
              className={`badge ${appeal.status === "pending" ? "pending" : "resolved"}`}
            >
              {appeal.status === "pending"
                ? "Ожидает рассмотрения"
                : "Рассмотрено"}
            </span>
          </div>
          <p>
            {conversation.externalId}
            <span className="dot-separator" />
            {dateLabel(appeal.createdAt)}
            <span className="dot-separator" />v{evaluation.checklist.version}
          </p>
        </div>
        {role === "user" && (
          <button
            className="button secondary"
            onClick={() =>
              go({
                page: "dialog",
                id: conversation.id,
                evaluationId: evaluation.id,
              })
            }
          >
            Открыть разговор
            <ArrowUpRight size={16} />
          </button>
        )}
      </div>
      {evaluation.demo && (
        <div className="demo-note">
          <Sparkles size={16} />
          Учебная апелляция — демонстрация процесса без запуска ИИ
        </div>
      )}
      <div className="dialog-workspace">
        <Transcript
          conversation={conversation}
          highlighted={highlighted}
          onClear={() => setHighlighted([])}
        />
        <section className="appeal-detail-panel">
          <div className="panel appeal-evidence">
            <div className="panel-heading">
              <div>
                <h2>Контекст обращения</h2>
                <span>Правила исходного запуска</span>
              </div>
              <FileCheck2 size={20} />
            </div>
            <div className="appeal-section">
              <h3>{criterion.name}</h3>
              <p>{criterion.description}</p>
              <div className="rule-meta">
                <span>Вес: {criterion.weight}</span>
                <span>
                  {criterion.type === "scale"
                    ? `Шкала: ${criterion.scale.map((s) => s.value).join(", ")}`
                    : criterion.type === "flag"
                      ? "Отдельный флаг"
                      : "Ответ: Да / Нет"}
                  {criterion.allowNA ? " / N/A" : ""}
                </span>
              </div>
              <div className="original-answer">
                <span>Исходная оценка ИИ</span>
                <strong>{answerLabel(result.originalAnswer, criterion)}</strong>
              </div>
              <p>{result.explanation}</p>
              {result.evidence.map((ev, i) => (
                <button
                  className="evidence"
                  key={i}
                  onClick={() => setHighlighted(ev.messageIds)}
                >
                  <span>
                    <MessageSquare size={14} />
                    {ev.kind === "range"
                      ? "Проверенный участок"
                      : "Доказательство"}
                    <ArrowUpRight size={14} />
                  </span>
                  {ev.kind === "range" ? (
                    <p className="evidence-range">
                      Проверен участок: {ev.quote}
                    </p>
                  ) : (
                    <q>{ev.quote}</q>
                  )}
                </button>
              ))}
            </div>
            <div className="appeal-section user-comment">
              <div className="comment-label">
                <span className="avatar small">КК</span>
                <div>
                  <strong>Комментарий пользователя</strong>
                  <span>{dateLabel(appeal.createdAt)}</span>
                </div>
              </div>
              <p>{appeal.comment}</p>
            </div>
          </div>
          {appeal.status === "resolved" && appeal.decision ? (
            <div className="panel saved-decision">
              <div className="decision-success-icon">
                <CheckCheck size={25} />
              </div>
              <h2>Решение сохранено</h2>
              <p>
                {appeal.decision.action === "confirm"
                  ? "Исходная оценка подтверждена"
                  : "Оценка изменена проверяющим"}
              </p>
              <div className="decision-values">
                <span>
                  ИИ
                  <strong>
                    {answerLabel(result.originalAnswer, criterion)}
                  </strong>
                </span>
                <ArrowRight size={20} />
                <span>
                  Проверяющий
                  <strong>
                    {answerLabel(appeal.decision.answer, criterion)}
                  </strong>
                </span>
              </div>
              <blockquote>{appeal.decision.reason}</blockquote>
              <div className="decision-total">
                <span>Текущий итог</span>
                <strong>
                  {scoreLabel(evaluation.total)} <small>/ 100</small>
                </strong>
              </div>
              {evaluation.total === null && (
                <p className="field-hint">
                  Для этого учебного изменения итог рассчитает сервер.
                </p>
              )}
              <button
                className="button secondary"
                onClick={() => go({ page: "appeals" })}
              >
                Вернуться к очереди
                <ArrowRight size={16} />
              </button>
            </div>
          ) : role === "reviewer" ? (
            <form
              className="panel decision-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                try {
                  await onResolve({
                    action,
                    answer:
                      action === "confirm" ? result.originalAnswer : answer,
                    reason: reason.trim(),
                  });
                } catch (err) {
                  setError(errorMessage(err));
                }
              }}
            >
              <div className="panel-heading">
                <div>
                  <h2>Ваше решение</h2>
                  <span>Проверьте контекст и доказательства</span>
                </div>
                <ShieldCheck size={21} />
              </div>
              <fieldset disabled={busy}>
                <legend className="sr-only">Решение по оценке</legend>
                <label
                  className={`decision-option ${action === "confirm" ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="decision"
                    value="confirm"
                    checked={action === "confirm"}
                    onChange={() => setAction("confirm")}
                  />
                  <span>
                    <strong>Подтвердить исходную оценку</strong>
                    <span>Оставить ответ и баллы без изменений</span>
                  </span>
                </label>
                <label
                  className={`decision-option ${action === "change" ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="decision"
                    value="change"
                    checked={action === "change"}
                    onChange={() => setAction("change")}
                  />
                  <span>
                    <strong>Изменить оценку</strong>
                    <span>Выбрать другой допустимый ответ</span>
                  </span>
                </label>
                {action === "change" && (
                  <label className="field" htmlFor="decision-answer">
                    Новый ответ
                    <AnswerSelect
                      id="decision-answer"
                      criterion={criterion}
                      value={answer}
                      onChange={setAnswer}
                    />
                    {answer === null && (
                      <span className="field-hint">
                        Условие N/A: {criterion.naCondition}
                      </span>
                    )}
                  </label>
                )}
                <label className="field" htmlFor="decision-reason">
                  Причина решения
                  <textarea
                    id="decision-reason"
                    name="decisionReason"
                    className="textarea"
                    required
                    maxLength={4000}
                    rows={4}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Объясните решение, опираясь на правила и реплики…"
                  />
                </label>
                {error && <ErrorBox>{error}</ErrorBox>}
                <p className="field-hint">
                  Исходная оценка останется в истории. Итог обновится после
                  сохранения.
                </p>
                <button
                  className="button primary full"
                  disabled={busy || !reason.trim()}
                >
                  {busy ? <Spinner /> : <CheckCheck size={17} />}{" "}
                  {busy ? "Сохраняем…" : "Сохранить решение"}
                </button>
              </fieldset>
            </form>
          ) : (
            <div className="panel waiting-decision">
              <span>
                <Clock3 size={27} />
              </span>
              <h3>Передано проверяющему</h3>
              <p>
                Здесь появятся решение, его причина и актуальная оценка. Сейчас
                исходный результат остаётся без изменений.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
