import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export function getRuntimeConfig(args: string[] = process.argv.slice(2)) {
  const value = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const port = Number(value("port") ?? 8000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid local port");
  return {
    host: "127.0.0.1",
    port,
    allowEvaluation: args.includes("--allow-one-llm-request"),
    model: value("model") ?? "",
    workspacePath: resolve(repositoryRoot, ".local/server/workspace.json"),
    datasetPath: resolve(repositoryRoot, "dev.json"),
    quotaPath: resolve(repositoryRoot, ".local/server/llm-once-used.json"),
  };
}
