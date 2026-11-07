import {
  Children,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";
import {
  Columns2,
  GripVertical,
  PanelLeft,
  PanelRight,
  RotateCcw,
} from "lucide-react";
import "./split-workspace.css";

const STORAGE_KEY = "qulaq-workspace-ratio-v1";
const DEFAULT_RATIO = 52;
const MIN_RATIO = 35;
const MAX_RATIO = 65;
const SEPARATOR_WIDTH = 18;

type ExpandedPanel = "both" | "transcript" | "evaluation";

function readRatio(): number {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved === null || saved.trim() === "") return DEFAULT_RATIO;
    const value = Number(saved);
    if (Number.isFinite(value) && value >= MIN_RATIO && value <= MAX_RATIO) {
      return Math.round(value * 10) / 10;
    }
  } catch {
    // Storage is optional; restricted browsers retain a usable local layout.
  }
  return DEFAULT_RATIO;
}

function saveRatio(value: number) {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Resizing remains available when session storage is disabled or full.
  }
}

export default function SplitWorkspace({
  children,
  revealEvidence,
}: {
  children: ReactNode;
  revealEvidence?: readonly string[];
}) {
  const panels = Children.toArray(children);
  const [ratio, setRatio] = useState(readRatio);
  const [expanded, setExpanded] = useState<ExpandedPanel>("both");
  const [dragging, setDragging] = useState(false);
  const ratioRef = useRef(ratio);
  const pointerId = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const transcriptId = `${id}-transcript`;
  const evaluationId = `${id}-evaluation`;
  const instructionId = `${id}-resize-help`;

  useLayoutEffect(() => {
    if (revealEvidence?.length) setExpanded("both");
  }, [revealEvidence]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const stopOnMobile = () => {
      if (!query.matches || pointerId.current === null) return;
      const activePointer = pointerId.current;
      pointerId.current = null;
      if (separatorRef.current?.hasPointerCapture(activePointer)) {
        separatorRef.current.releasePointerCapture(activePointer);
      }
      saveRatio(ratioRef.current);
      setDragging(false);
    };
    query.addEventListener("change", stopOnMobile);
    return () => query.removeEventListener("change", stopOnMobile);
  }, []);

  function updateRatio(value: number, persist = true) {
    const next =
      Math.round(Math.min(MAX_RATIO, Math.max(MIN_RATIO, value)) * 10) / 10;
    ratioRef.current = next;
    setRatio(next);
    if (persist) saveRatio(next);
  }

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== event.pointerId || !gridRef.current) return;
    const bounds = gridRef.current.getBoundingClientRect();
    const available = bounds.width - SEPARATOR_WIDTH;
    if (available <= 0) return;
    updateRatio(
      ((event.clientX - bounds.left - SEPARATOR_WIDTH / 2) / available) * 100,
      false,
    );
  }

  function startPointer(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || pointerId.current !== null)
      return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    pointerId.current = event.pointerId;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    movePointer(event);
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    setDragging(false);
    saveRatio(ratioRef.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 5 : 2;
    const values: Record<string, number> = {
      ArrowLeft: ratioRef.current - step,
      ArrowRight: ratioRef.current + step,
      Home: MIN_RATIO,
      End: MAX_RATIO,
    };
    const next = values[event.key];
    if (next === undefined) return;
    event.preventDefault();
    updateRatio(next);
  }

  function togglePanel(panel: Exclude<ExpandedPanel, "both">) {
    setExpanded((current) => (current === panel ? "both" : panel));
  }

  if (panels.length !== 2) {
    throw new Error("SplitWorkspace requires exactly two child panels.");
  }

  return (
    <div
      className={`dialog-workspace split-workspace${dragging ? " is-resizing" : ""}`}
      data-expanded={expanded}
      style={
        {
          "--split-left": `${ratio}fr`,
          "--split-right": `${100 - ratio}fr`,
        } as CSSProperties
      }
    >
      <div
        className="split-toolbar"
        role="group"
        aria-label="Расположение панелей"
      >
        <span className="split-caption" aria-hidden="true">
          <Columns2 size={15} />
          {expanded === "both"
            ? "Две панели"
            : expanded === "transcript"
              ? "Транскрипт на весь экран"
              : "Оценка на весь экран"}
          {expanded === "both" && (
            <span>
              {Math.round(ratio)} / {Math.round(100 - ratio)}
            </span>
          )}
        </span>
        <div className="split-controls">
          <button
            type="button"
            className="split-control"
            aria-label="Развернуть транскрипт"
            aria-controls={transcriptId}
            aria-pressed={expanded === "transcript"}
            onClick={() => togglePanel("transcript")}
          >
            <PanelLeft size={15} /> <span>Транскрипт</span>
          </button>
          <button
            type="button"
            className="split-control"
            aria-label="Развернуть оценку"
            aria-controls={evaluationId}
            aria-pressed={expanded === "evaluation"}
            onClick={() => togglePanel("evaluation")}
          >
            <PanelRight size={15} /> <span>Оценка</span>
          </button>
          {expanded !== "both" && (
            <button
              type="button"
              className="split-control split-restore"
              aria-label="Показать обе панели"
              onClick={() => setExpanded("both")}
            >
              <Columns2 size={15} /> <span>Обе панели</span>
            </button>
          )}
          <button
            type="button"
            className="split-control split-reset"
            aria-label="Сбросить расположение панелей"
            title="Сбросить расположение панелей"
            onClick={() => {
              updateRatio(DEFAULT_RATIO);
              setExpanded("both");
            }}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
      <p id={instructionId} className="sr-only">
        Перетащите разделитель или нажимайте стрелки влево и вправо. Home — 35
        процентов, End — 65 процентов. Shift увеличивает шаг.
      </p>
      <div className="split-grid" ref={gridRef}>
        <div className="split-pane split-transcript" id={transcriptId}>
          {panels[0]}
        </div>
        <div
          className="split-separator"
          ref={separatorRef}
          role="separator"
          aria-label="Ширина транскрипта"
          aria-orientation="vertical"
          aria-valuemin={MIN_RATIO}
          aria-valuemax={MAX_RATIO}
          aria-valuenow={ratio}
          aria-valuetext={`Транскрипт ${ratio}%, оценка ${Math.round((100 - ratio) * 10) / 10}%`}
          aria-controls={transcriptId}
          aria-describedby={instructionId}
          tabIndex={0}
          onKeyDown={resizeWithKeyboard}
          onPointerDown={startPointer}
          onPointerMove={movePointer}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onLostPointerCapture={finishPointer}
        >
          <span className="split-grip">
            <GripVertical size={15} aria-hidden="true" />
          </span>
        </div>
        <div className="split-pane split-evaluation" id={evaluationId}>
          {panels[1]}
        </div>
      </div>
    </div>
  );
}
