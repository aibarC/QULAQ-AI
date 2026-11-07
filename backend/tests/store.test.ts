import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/store.ts";
import type { Workspace } from "../../frontend/src/lib/types.ts";

function empty(): Workspace {
  return {
    conversations: [],
    evaluations: [],
    appeals: [],
    checklists: [
      {
        id: "rules",
        name: "Synthetic rules",
        version: 1,
        criteria: [
          {
            id: "clear",
            name: "Clear response",
            description: "Synthetic rule",
            type: "boolean",
            weight: 100,
            allowNA: false,
            naCondition: "",
            scale: [],
          },
        ],
      },
    ],
  };
}

test("store serializes concurrent changes, isolates snapshots and persists private JSON", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "qulaq-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "workspace.json");
  const store = await createStore(path, empty());
  await Promise.all(
    Array.from({ length: 10 }, () =>
      store.mutate(async (draft) => {
        const previous = draft.checklists[0].version;
        await new Promise((resolve) => setTimeout(resolve, 1));
        draft.checklists[0].version = previous + 1;
      }),
    ),
  );
  assert.equal(store.snapshot().checklists[0].version, 11);
  const detached = store.snapshot();
  detached.checklists[0].name = "must not leak";
  assert.equal(store.snapshot().checklists[0].name, "Synthetic rules");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), store.snapshot());
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("rejected mutations leave disk and memory intact and do not poison the queue", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "qulaq-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "workspace.json");
  const store = await createStore(path, empty());
  const before = await readFile(path, "utf8");
  await assert.rejects(
    store.mutate((draft) => {
      draft.checklists = [];
    }),
  );
  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual(store.snapshot(), empty());
  await assert.rejects(
    store.mutate((draft) => {
      draft.checklists[0].name = "discard";
      throw new Error("expected");
    }),
  );
  await store.mutate((draft) => {
    draft.checklists[0].version++;
  });
  assert.equal(store.snapshot().checklists[0].version, 2);
});

test("restart marks interrupted evaluations as errors and refuses corrupt state instead of resetting it", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "qulaq-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "workspace.json");
  const initial = empty();
  initial.conversations.push({
    id: "DEV:synthetic",
    externalId: "synthetic",
    groupId: "DEV",
    channel: "agent chat",
    language: "RU",
    messages: [],
    audioUrl: null,
    status: "evaluating",
    demo: false,
  });
  await createStore(path, initial);
  const recovered = await createStore(path, empty());
  assert.equal(recovered.snapshot().conversations[0].status, "error");
  assert.equal(
    JSON.parse(await readFile(path, "utf8")).conversations[0].status,
    "error",
  );
  await writeFile(path, "invalid JSON", "utf8");
  await assert.rejects(
    createStore(path, empty()),
    /Cannot read valid workspace/,
  );
  assert.equal(await readFile(path, "utf8"), "invalid JSON");
});
