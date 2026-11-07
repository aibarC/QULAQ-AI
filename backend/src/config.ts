import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export function getRuntimeConfig(args: string[] = process.argv.slice(2)) {
  const value = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const port = Number(value("port") ?? 8000);
  const maxTokens = Number(value("max-tokens") ?? 16384);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32768)
    throw new Error("Invalid model output limit");
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid local port");
  return {
    host: "127.0.0.1",
    port,
    allowEvaluation: args.includes("--allow-one-llm-request"),
    model: value("model") ?? "",
    maxTokens,
    localLaya: args.includes("--local-laya"),
    layaPythonPath: resolve(repositoryRoot, ".local/laya-venv/bin/python"),
    layaWorkerPath: resolve(repositoryRoot, "backend/laya/classify.py"),
    workspacePath: resolve(repositoryRoot, ".local/server/workspace.json"),
    datasetPath: resolve(repositoryRoot, "dev.json"),
    quotaPath: resolve(repositoryRoot, ".local/server/llm-once-used.json"),
  };
}
