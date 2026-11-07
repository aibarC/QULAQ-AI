import { resolve } from "node:path";
import { getRuntimeConfig, repositoryRoot } from "./config.ts";
import { createGatewayEvaluator } from "./provider.ts";
import { createApp } from "./server.ts";
import { createStore } from "./store.ts";
import { initialChecklist, recalculate } from "./scoring.ts";
import { createLayaClassifier } from "./laya.ts";

async function start() {
  const config = getRuntimeConfig();
  // Normal startup does not even load the secret file. Only the explicit, future
  // one-test command can load it inside the server process, without printing it.
  if (config.allowEvaluation) {
    if (!config.model)
      throw new Error(
        "Specify an explicitly selected model before enabling a test.",
      );
    process.loadEnvFile(resolve(repositoryRoot, ".env"));
  }
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
  const app = createApp({
    store,
    initialChecklist,
    datasetPath: config.datasetPath,
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
    evaluate: createGatewayEvaluator({
      enabled: config.allowEvaluation,
      baseUrl: config.allowEvaluation
        ? (process.env.LLM_BASE_URL ?? "")
        : "https://llm.telecom.kz/v1",
      getToken: () => process.env.LLM_API_TOKEN,
      model: config.model,
      maxTokens: config.maxTokens,
      quotaPath: config.quotaPath,
      localClassifier,
    }),
  });
  app.on("error", () => {
    console.error("Локальный сервер не запущен: проверьте свободный порт.");
    process.exitCode = 1;
  });
  app.listen(config.port, config.host, () => {
    console.log(`QULAQ API: http://${config.host}:${config.port}/api`);
    console.log(
      config.allowEvaluation
        ? "Разрешён максимум один запрос модели; повтор и перезапуск не восстанавливают разрешение."
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
