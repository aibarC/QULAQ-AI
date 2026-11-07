import { useEffect, useState } from "react";
import "./workspace-motion.css";
type Motion = "full" | "moderate" | "off";
export default function MotionSettings() {
  const [motion, setMotion] = useState<Motion>(() => {
    try {
      const saved = sessionStorage.getItem("qulaq-motion");
      return saved === "off" || saved === "moderate" ? saved : "full";
    } catch {
      return "full";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.motion = motion;
    try {
      sessionStorage.setItem("qulaq-motion", motion);
    } catch {}
  }, [motion]);
  return (
    <label className="motion-settings">
      Движение{" "}
      <select
        aria-label="Интенсивность анимации"
        value={motion}
        onChange={(e) => setMotion(e.target.value as Motion)}
      >
        <option value="full">Полное</option>
        <option value="moderate">Умеренное</option>
        <option value="off">Выключено</option>
      </select>
    </label>
  );
}
