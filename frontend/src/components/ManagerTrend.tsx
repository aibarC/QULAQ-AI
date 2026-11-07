import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ManagerReport } from "../lib/managerReport";
import { scoreLabel } from "./Shared";

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
export default function DailyTrend({ report }: { report: ManagerReport }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(240, element.clientWidth));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => setActive(null), [report.start, report.end, report.language]);
  const top = 28,
    bottom = 190,
    left = 36,
    right = width - 18;
  const days = report.dailyTrend;
  const x = (i: number) =>
    days.length > 1
      ? left + (i * (right - left)) / (days.length - 1)
      : (left + right) / 2;
  const y = (value: number) => bottom - (value * (bottom - top)) / 100;
  const tickCount = Math.min(
    days.length,
    width < 450 ? 3 : Math.max(3, Math.floor(width / 120)),
  );
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    tickCount === 1 ? 0 : Math.round((i * (days.length - 1)) / (tickCount - 1)),
  );
  const segments: { index: number; value: number }[][] = [];
  days.forEach((day, index) => {
    if (day.average === null) return;
    const previous = segments.at(-1);
    if (!previous || previous.at(-1)!.index !== index - 1)
      segments.push([{ index, value: day.average }]);
    else previous.push({ index, value: day.average });
  });
  const chosen = active === null ? null : days[active];
  return (
    <div className="manager-trend-frame" ref={frame}>
      <div className="trend-legend">
        <span>
          <i />
          Среднее за день
        </span>
        <span className="trend-mean-key">
          <i />
          За период: <strong>{scoreLabel(report.average)}</strong>
        </span>
      </div>
      <div className="trend-interactive">
        <svg
          className="manager-trend-svg"
          viewBox={`0 0 ${width} 230`}
          width="100%"
          height="230"
          role="group"
          tabIndex={0}
          aria-label="График качества: баллы от 0 до 100 по датам. Стрелки влево и вправо выбирают день."
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              setActive((current) =>
                Math.max(
                  0,
                  Math.min(
                    days.length - 1,
                    (current ?? 0) + (event.key === "ArrowRight" ? 1 : -1),
                  ),
                ),
              );
            } else if (event.key === "Escape") setActive(null);
          }}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const px = ((event.clientX - box.left) * width) / box.width;
            setActive(
              Math.max(
                0,
                Math.min(
                  days.length - 1,
                  Math.round(
                    ((px - left) / (right - left)) * (days.length - 1),
                  ),
                ),
              ),
            );
          }}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity=".18" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity=".02" />
            </linearGradient>
          </defs>
          <text x={left} y={12} className="manager-chart-label">
            БАЛЛЫ
          </text>
          {[0, 20, 40, 60, 80, 100].map((value) => (
            <g key={value}>
              <line
                x1={left}
                x2={right}
                y1={y(value)}
                y2={y(value)}
                className="manager-chart-grid"
              />
              <text
                x={left - 9}
                y={y(value) + 4}
                textAnchor="end"
                className="manager-chart-label"
              >
                {value}
              </text>
            </g>
          ))}
          {ticks.map((index) => (
            <g key={index}>
              <line
                x1={x(index)}
                x2={x(index)}
                y1={top}
                y2={bottom}
                className="manager-chart-grid"
              />
              <text
                x={x(index)}
                y={bottom + 22}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === days.length - 1
                      ? "end"
                      : "middle"
                }
                className="manager-chart-label"
              >
                {dayLabel(days[index].date)}
              </text>
            </g>
          ))}
          <path
            d={`M${left},${top}V${bottom}H${right}`}
            className="trend-axis"
          />
          {segments
            .filter((s) => s.length > 1)
            .map((segment, i) => (
              <g key={i}>
                <polygon
                  points={`${x(segment[0].index)},${bottom} ${segment.map((p) => `${x(p.index)},${y(p.value)}`).join(" ")} ${x(segment.at(-1)!.index)},${bottom}`}
                  fill={`url(#${id})`}
                />
                <polyline
                  points={segment
                    .map((p) => `${x(p.index)},${y(p.value)}`)
                    .join(" ")}
                  className="manager-chart-line"
                />
              </g>
            ))}
          {report.average !== null && (
            <line
              x1={left}
              x2={right}
              y1={y(report.average)}
              y2={y(report.average)}
              className="trend-average"
            />
          )}
          {segments.flat().map((point) => (
            <circle
              key={point.index}
              cx={x(point.index)}
              cy={y(point.value)}
              r={4}
              className="manager-chart-point"
            />
          ))}
          {chosen && active !== null && (
            <g className="trend-crosshair">
              <line x1={x(active)} x2={x(active)} y1={top} y2={bottom} />
              {chosen.average !== null && (
                <>
                  <line
                    x1={left}
                    x2={right}
                    y1={y(chosen.average)}
                    y2={y(chosen.average)}
                  />
                  <circle cx={x(active)} cy={y(chosen.average)} r={6} />
                </>
              )}
            </g>
          )}
        </svg>
        {chosen && active !== null && (
          <div
            className="trend-tooltip"
            style={{ left: Math.max(0, Math.min(width - 176, x(active) - 88)) }}
          >
            <strong>{dayLabel(chosen.date)}</strong>
            <span>
              {chosen.average === null
                ? "Нет оценок с итогом"
                : `${scoreLabel(chosen.average)} / 100`}
            </span>
            <small>
              Диалогов: {chosen.count} · с итогом: {chosen.scoredCount}
            </small>
          </div>
        )}
      </div>
      <p className="manager-chart-note">
        Среднее за период — по {report.scoredCount} диалогам с итогом. Пропуски
        не соединяются.{" "}
        <span className="sr-only" aria-live="polite">
          {chosen
            ? `${dayLabel(chosen.date)}: ${scoreLabel(chosen.average)}, диалогов ${chosen.count}`
            : ""}
        </span>
      </p>
      <details className="manager-daily-details">
        <summary>
          Данные по дням <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="manager-daily-scroll">
          <table>
            <caption className="sr-only">
              Все дни выбранного периода, количество оценок и средний балл
            </caption>
            <thead>
              <tr>
                <th scope="col">Дата</th>
                <th scope="col">Диалогов</th>
                <th scope="col">С итогом</th>
                <th scope="col">Средний балл</th>
              </tr>
            </thead>
            <tbody>
              {report.dailyTrend.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{day.date}</th>
                  <td>{day.count}</td>
                  <td>{day.scoredCount}</td>
                  <td>{scoreLabel(day.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
