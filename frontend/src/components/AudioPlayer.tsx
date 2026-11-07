import { useEffect, useState, type RefObject } from "react";
import { Play, Pause, RotateCcw, RotateCw, LoaderCircle } from "lucide-react";
import { elapsedLabel } from "../lib/timeline";

export default function AudioPlayer({
  audioRef,
  src,
  onReady,
  onError,
  onSeek,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  src: string;
  onReady: () => void;
  onError: () => void;
  onSeek: (seconds: number) => void;
}) {
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    setPosition(0);
    setDuration(0);
    setPlaying(false);
    setWaiting(false);
    setError("");
    setSpeed(1);
  }, [src]);
  const sync = () => {
    const audio = audioRef.current;
    if (audio) setPosition(audio.currentTime);
  };
  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    setWaiting(true);
    try {
      await audio.play();
      setError("");
    } catch {
      setWaiting(false);
      setError(
        "Не удалось включить запись. Попробуйте открыть её по ссылке ниже.",
      );
    }
  }
  return (
    <div className="voice-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => {
          const value = audioRef.current?.duration ?? 0;
          setDuration(Number.isFinite(value) ? value : 0);
          onReady();
          sync();
        }}
        onTimeUpdate={sync}
        onSeeking={sync}
        onSeeked={() => {
          sync();
          setWaiting(false);
        }}
        onPlay={() => setPlaying(true)}
        onPlaying={() => setWaiting(false)}
        onPause={() => {
          setPlaying(false);
          setWaiting(false);
        }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onEnded={() => {
          setPlaying(false);
          sync();
        }}
        onError={() => {
          setWaiting(false);
          setPlaying(false);
          onError();
          setError("Запись недоступна.");
        }}
      />
      <div className="voice-player-controls">
        <button
          type="button"
          className="voice-play"
          onClick={toggle}
          aria-label={playing ? "Пауза" : "Воспроизвести запись"}
        >
          {waiting ? (
            <LoaderCircle size={22} className="spin" />
          ) : playing ? (
            <Pause size={22} />
          ) : (
            <Play size={22} />
          )}
        </button>
        <div className="voice-clock">
          <span className="voice-clock-label">
            {waiting
              ? "Загрузка"
              : playing
                ? "Воспроизведение"
                : "Запись разговора"}
          </span>
          <div>
            <strong>{elapsedLabel(position)}</strong>
            <span> / {duration ? elapsedLabel(duration) : "—"}</span>
          </div>
        </div>
        <div className="voice-options">
          <button
            type="button"
            aria-label="Назад на 10 секунд"
            disabled={!duration}
            onClick={() => onSeek(Math.max(0, position - 10))}
          >
            <RotateCcw size={16} />
            <span>10</span>
          </button>
          <button
            type="button"
            aria-label="Вперёд на 10 секунд"
            disabled={!duration}
            onClick={() => onSeek(Math.min(duration, position + 10))}
          >
            <RotateCw size={16} />
            <span>10</span>
          </button>
          <select
            aria-label="Скорость воспроизведения"
            value={speed}
            onChange={(event) => {
              const value = Number(event.target.value);
              setSpeed(value);
              if (audioRef.current) audioRef.current.playbackRate = value;
            }}
          >
            {[0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="voice-timeline">
        <div className="voice-track" aria-hidden="true">
          <span
            style={{ width: `${duration ? (position / duration) * 100 : 0}%` }}
          />
        </div>
        <input
          type="range"
          min="0"
          max={duration || 1}
          step="0.01"
          value={Math.min(position, duration || 1)}
          disabled={!duration}
          aria-label="Позиция аудио"
          aria-valuetext={`${elapsedLabel(position)} из ${elapsedLabel(duration)}`}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </div>
      {error && (
        <p className="audio-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
