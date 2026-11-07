import { useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Pause, Play, Quote } from "lucide-react";
import "./listening-stage.css";

const scenes = [
  {
    name: "Разговор",
    heading: "Сначала — услышать.",
    text: "Весь разговор перед глазами. Реплики, участники и контекст остаются вместе.",
    quote: "«Понимаю, как неприятно остаться без связи перед встречей».",
    note: "Реплика оператора · учебный пример",
  },
  {
    name: "Критерии",
    heading: "Затем — разобраться.",
    text: "Каждый критерий рассматривается отдельно. Видно, что выполнено и что требует внимания.",
    quote: "Эмпатия",
    note: "Проверяем поддержку клиента, а не отдельное слово",
  },
  {
    name: "Доказательства",
    heading: "Вывод — с основанием.",
    text: "От оценки можно перейти к точной реплике. Если вывод спорный — отправить его на пересмотр.",
    quote: "От критерия к реплике.",
    note: "Откройте учебный пример, чтобы пройти весь путь",
  },
];

export default function ListeningStage({
  onDemo,
  disabled,
}: {
  onDemo: () => void;
  disabled: boolean;
}) {
  const [scene, setScene] = useState(0);
  const [paused, setPaused] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const current = scenes[scene];
  return (
    <section className="listening-stage" aria-label="Знакомство с QULAQ">
      <div className="listening-copy">
        <span className="listening-caption">Внимание к каждому разговору</span>
        <h2>
          За словами.
          <br />
          Больше смысла.
        </h2>
        <p>
          От разговора к понятной оценке —<br className="desktop-break" /> с
          контекстом и доказательствами.
        </p>
        <button
          className="button primary listening-cta"
          disabled={disabled}
          onClick={onDemo}
        >
          Исследовать пример <ArrowUpRight size={18} />
        </button>
        <span className="listening-demo-note">
          Учебный диалог. Без запуска ИИ.
        </span>
      </div>
      <div
        className={`listening-object ${paused ? "is-paused" : ""}`}
        data-scene={scene}
        ref={stage}
        onPointerMove={(e) => {
          if (
            paused ||
            e.pointerType !== "mouse" ||
            matchMedia("(prefers-reduced-motion: reduce)").matches
          )
            return;
          const box = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty(
            "--tilt-x",
            `${((e.clientY - box.top) / box.height - 0.5) * -12}deg`,
          );
          e.currentTarget.style.setProperty(
            "--tilt-y",
            `${((e.clientX - box.left) / box.width - 0.5) * 16}deg`,
          );
        }}
        onPointerLeave={() => {
          stage.current?.style.setProperty("--tilt-x", "0deg");
          stage.current?.style.setProperty("--tilt-y", "0deg");
        }}
      >
        <div className="listening-art" aria-hidden="true">
          <div className="listening-shadow" />
          <div className="listening-sculpture">
            {Array.from({ length: 29 }, (_, i) => (
              <i
                key={i}
                style={
                  {
                    "--i": i,
                    "--height": `${68 + Math.sin((i / 28) * Math.PI) * 172}px`,
                    "--delay": `${i * -0.13}s`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <span className="listening-signature">qulaq</span>
        </div>
        <button
          className="listening-motion"
          aria-label={
            paused
              ? "Включить движение иллюстрации"
              : "Приостановить движение иллюстрации"
          }
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
          <span>{paused ? "Продолжить" : "Пауза"}</span>
        </button>
        <div className="listening-quote" key={scene}>
          <Quote size={18} aria-hidden="true" />
          <span>
            {current.quote}
            <small>{current.note}</small>
          </span>
        </div>
      </div>
      <div className="listening-process">
        <div className="listening-tabs" role="group" aria-label="Этапы разбора">
          {scenes.map((item, i) => (
            <button
              key={item.name}
              aria-pressed={scene === i}
              onClick={() => setScene(i)}
            >
              <span>0{i + 1}</span>
              {item.name}
              <i aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="listening-explanation" aria-live="polite" key={scene}>
          <h3>{current.heading}</h3>
          <p>{current.text}</p>
        </div>
      </div>
    </section>
  );
}
