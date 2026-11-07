import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Search, CornerDownLeft } from "lucide-react";
import { Modal } from "./Shared";
import "./command.css";

export interface CommandItem {
  id: string;
  title: string;
  detail: string;
  search?: string;
  group: string;
  run: () => void;
}

export default function CommandMenu({
  items,
  onClose,
}: {
  items: CommandItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const normalized = query.trim().toLocaleLowerCase();
  const results = items
    .filter(
      (item) =>
        !normalized ||
        `${item.title} ${item.detail} ${item.search || ""}`
          .toLocaleLowerCase()
          .includes(normalized),
    )
    .slice(0, 8);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    document
      .getElementById(`command-result-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const choose = (item: CommandItem) => {
    onClose();
    item.run();
  };
  return (
    <Modal title="Быстрый переход" onClose={onClose}>
      <div className="command-menu">
        <label className="command-input">
          <Search size={23} aria-hidden="true" />
          <input
            ref={input}
            type="search"
            aria-label="Поиск раздела или диалога"
            placeholder="Раздел, ID или фраза из разговора…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-autocomplete="list"
            aria-activedescendant={
              results[active] ? `command-result-${active}` : undefined
            }
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
                return;
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (results.length)
                  setActive(
                    (index) =>
                      (index +
                        (e.key === "ArrowDown" ? 1 : -1) +
                        results.length) %
                      results.length,
                  );
              }
              if (e.key === "Enter" && results[active]) {
                e.preventDefault();
                choose(results[active]);
              }
            }}
          />
        </label>
        <div
          className="command-results"
          id="command-results"
          role="listbox"
          aria-label="Результаты быстрого поиска"
        >
          {results.map((item, index) => (
            <button
              key={item.id}
              id={`command-result-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`command-result ${index === active ? "is-active" : ""}`}
              onPointerMove={() => setActive(index)}
              onFocus={() => setActive(index)}
              onClick={() => choose(item)}
            >
              <span className="command-result-icon" aria-hidden="true">
                <ArrowUpRight size={20} />
              </span>
              <span>
                <small>{item.group}</small>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </span>
              <CornerDownLeft size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
        {!results.length && (
          <p className="command-empty" role="status">
            Ничего не найдено. Попробуйте другой ID или более короткую фразу.
          </p>
        )}
        <div className="command-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> выбрать
          </span>
          <span>
            <kbd>Enter</kbd> открыть
          </span>
          <span>
            <kbd>Esc</kbd> закрыть
          </span>
        </div>
      </div>
    </Modal>
  );
}
