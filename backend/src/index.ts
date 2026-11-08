import { createDatasetImporter } from "./dataset-import.ts";
import { resolve } from "node:path";
import { getRuntimeConfig, repositoryRoot } from "./config.ts";
import { createGatewayProvider } from "./provider.ts";
import { createApp } from "./server.ts";
import { createStore } from "./store.ts";
import { initialChecklist, recalculate } from "./scoring.ts";
import { createLayaClassifier } from "./laya.ts";

async function start() {
  const config = getRuntimeConfig();
  // Resolve secrets only inside a manual model action, never while opening the app.
  let environmentLoaded = false;
  const loadModelEnvironment = () => {
    if (!environmentLoaded) {
      try { process.loadEnvFile(resolve(repositoryRoot, ".env")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      environmentLoaded = true;
    }
  };
  const store = await createStore(config.workspacePath, {
    conversations: [],
    checklists: [initialChecklist],
    evaluations: [],
    appeals: [],
  });
  const localClassifier = config.localLaya
    ? createLayaClassifier({
        pythonPath: config.layaPythonPath,
        workerPath: config.layaWorkerPath,
      })
    : undefined;
  const provider = createGatewayProvider({
      enabled: config.allowEvaluation,
      get baseUrl() {
        if (config.allowEvaluation) loadModelEnvironment();
        return process.env.LLM_BASE_URL ?? "https://llm.telecom.kz/v1";
      },
      getToken: () => { loadModelEnvironment(); return process.env.LLM_API_TOKEN; },
      model: config.model,
      maxTokens: config.maxTokens,
      quotaPath: config.quotaPath,
      oneShot: config.oneShot,
      localClassifier,
    });
  const app = createApp({
    store,
    initialChecklist,
    datasetPath: config.datasetPath,
    importDatasetUrl: createDatasetImporter(),
    allowEvaluation: config.allowEvaluation,
    recalculate,
    classifyReason: localClassifier
      ? (conversation, evaluation) =>
          localClassifier(
            conversation,
            evaluation.checklist,
            evaluation.results,
            evaluation.contactReason,
          )
      : undefined,
    evaluate: provider.evaluate,
    improve: provider.improve,
    allowImprovement: config.allowEvaluation,
  });
  app.on("error", () => {
    console.error("Локальный сервер не запущен: проверьте свободный порт.");
    process.exitCode = 1;
  });
  app.listen(config.port, config.host, () => {
    console.log(`QULAQ API: http://${config.host}:${config.port}/api`);
    console.log(
      config.allowEvaluation
        ? "Модель вызывается только по нажатию кнопки анализа или улучшения. Автоматических запусков и повторов нет."
        : "Внешние вызовы Kimi отключены. Файл с токеном не загружался.",
    );
  });
  const stop = () => {
    app.close();
    app.closeIdleConnections();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
start().catch(() => {
  console.error(
    "Не удалось запустить сервер. Проверьте установку, локальное хранилище и параметры запуска. Секреты не выводятся.",
  );
  process.exitCode = 1;
});
