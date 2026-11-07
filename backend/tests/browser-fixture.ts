/** Synthetic HTTP fixture only. Never import index, provider, config or dotenv. */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.ts";
import { createStore } from "../src/store.ts";
import {
  initialChecklist,
  recalculate,
  scoreModelOutput,
} from "../src/scoring.ts";
import type { Workspace } from "../../frontend/src/lib/types.ts";

globalThis.fetch = async () => {
  throw new Error("Network calls are forbidden in the synthetic HTTP fixture");
};
const directory = await mkdtemp(join(tmpdir(), "qulaq-browser-http-"));
const datasetPath = join(directory, "synthetic-dev.json");
await writeFile(
  datasetPath,
  JSON.stringify({
    isSuccess: true,
    data: {
      dataset_group_id: "DEV",
      total_records: 1,
      records: [
        {
          conversation_id: "http-synthetic-1",
          language: "RU",
          channel: "agent chat",
          audio_url: null,
          transcript: [
            {
              speaker: "client",
              timestamp: "00:00",
              text: "Синтетический вопрос для проверки HTTP.",
            },
            {
              speaker: "operator",
              timestamp: "00:01",
              text: "Синтетический ответ оператора.",
            },
          ],
        },
      ],
    },
  }),
  { mode: 0o600 },
);

const servers: ReturnType<typeof createApp>[] = [];
for (const [port, allowEvaluation] of [
  [8001, true],
  [8002, false],
] as const) {
  const initial: Workspace = {
    conversations: [],
    checklists: [structuredClone(initialChecklist)],
    evaluations: [],
    appeals: [],
  };
  const store = await createStore(
    join(directory, `workspace-${port}.json`),
    initial,
  );
  const server = createApp({
    store,
    datasetPath,
    initialChecklist,
    recalculate,
    allowEvaluation,
    evaluate: async ({ conversation, checklist, signal }) => {
      if (!allowEvaluation)
        throw new Error("Disabled fixture must never evaluate");
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (signal.aborted) throw new Error("Cancelled fixture");
      return scoreModelOutput(conversation, checklist, {
        results: checklist.criteria.map((criterion) => ({
          criterion_id: criterion.id,
          status: "scored",
          value:
            criterion.id === "c5"
              ? false
              : criterion.type === "flag"
                ? false
                : criterion.type === "boolean"
                  ? true
                  : Math.max(...criterion.scale.map((option) => option.value)),
          reason:
            "Синтетический результат локального HTTP-теста; LLM не вызывался.",
          evidence_ids: [conversation.messages.at(-1)!.id],
          evidence_kind: "messages",
        })),
      });
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  servers.push(server);
}
console.log("Synthetic HTTP fixtures ready; no LLM provider loaded.");
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
  await rm(directory, { recursive: true, force: true });
}
process.once("SIGTERM", () => {
  void close();
});
process.once("SIGINT", () => {
  void close();
});
