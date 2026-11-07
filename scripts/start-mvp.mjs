import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const uiEnv = {
  ...process.env,
  VITE_API_BASE_URL: "/api",
  QULAQ_API_TARGET: "http://127.0.0.1:8000",
};
delete uiEnv.LLM_API_TOKEN;
delete uiEnv.LLM_BASE_URL;
const localLaya = existsSync(resolve(root, ".local/laya-venv/bin/python")) && existsSync(resolve(root, ".local/laya-model/model.safetensors"));
const children = [
  spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...(localLaya ? ["--local-laya"] : [])], {
    cwd: resolve(root, "backend"),
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort",
    ],
    { cwd: resolve(root, "frontend"), env: uiEnv, stdio: "inherit" },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", () => {
    console.error(
      "Не удалось запустить локальный MVP. Выполните npm run setup.",
    );
    stop(1);
  });
  child.on("exit", (code) => stop(code ?? 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
console.log(
  "QULAQ: http://127.0.0.1:5173 — сервер подключается локально, вызовы LLM отключены.",
);

console.log(localLaya ? "Laya: локальная классификация подключена автоматически после анализа." : "Laya: локальное окружение ещё не установлено.");
