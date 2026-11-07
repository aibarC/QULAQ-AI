import {
  ArrowUpRight,
  CheckCheck,
  CircleDashed,
  CircleAlert,
} from "lucide-react";
import type { Conversation } from "../lib/types";
import "./signal.css";

export default function SignalOverview({
  conversations,
  selected,
  onFilter,
}: {
  conversations: Conversation[];
  selected: string;
  onFilter: (status: string) => void;
}) {
  const evaluated = conversations.filter(
    (c) => c.status === "evaluated",
  ).length;
  const unrated = conversations.filter((c) => c.status === "unrated").length;
  const errors = conversations.filter((c) => c.status === "error").length;
  const running = conversations.filter((c) => c.status === "evaluating").length;
  return (
    <section className="signal-overview" aria-label="Обзор набора">
      <div className="signal-intro">
        <span className="signal-brand">Текущий набор</span>
        <h2 className="signal-total">
          <strong>{conversations.length}</strong>
          <span>
            Диалоги
            <br />в наборе
          </span>
        </h2>
        <div
          className="signal-progress"
          aria-label={`Оценено ${evaluated} из ${conversations.length}`}
        >
          <div className="signal-track">
            <span
              style={{
                transform: `scaleX(${conversations.length ? evaluated / conversations.length : 0})`,
              }}
            />
          </div>
          <span>
            {evaluated} из {conversations.length} оценено
            {running ? ` · в работе ${running}` : ""}
          </span>
        </div>
      </div>
      <div className="signal-actions">
        {[
          {
            id: "unrated",
            label: "Без оценки",
            count: unrated,
            icon: CircleDashed,
          },
          {
            id: "evaluated",
            label: "Оценены",
            count: evaluated,
            icon: CheckCheck,
          },
          {
            id: "error",
            label: "Ошибки оценки",
            count: errors,
            icon: CircleAlert,
          },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`signal-filter ${selected === item.id ? "is-selected" : ""}`}
            aria-pressed={selected === item.id}
            onClick={() => onFilter(selected === item.id ? "all" : item.id)}
          >
            <item.icon size={17} aria-hidden="true" />
            <span>{item.label}</span>
            <strong>{item.count}</strong>
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        ))}
        <button className="signal-reset" onClick={() => onFilter("all")}>
          Показать все {conversations.length}
        </button>
      </div>
    </section>
  );
}
