import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, lstat, unlink } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import { parseWorkspace } from "../../frontend/src/lib/validation.ts";
import type { Workspace } from "../../frontend/src/lib/types.ts";

export interface WorkspaceStore {
  snapshot(): Workspace;
  mutate(
    change: (draft: Workspace) => void | Promise<void>,
  ): Promise<Workspace>;
}

const MAX_BYTES = 15 * 1024 * 1024;

/** One process owns this file. Mutations become visible only after atomic persistence. */
export async function createStore(
  path: string,
  initialWorkspace: Workspace,
): Promise<WorkspaceStore> {
  const file = resolve(path);
  if (!file.endsWith(".json"))
    throw new Error("Workspace storage must be a JSON file.");
  let state: Workspace;
  let needsWrite = false;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) {
      throw new Error("Invalid workspace storage file.");
    }
    state = parseWorkspace(JSON.parse(await readFile(file, "utf8")));
    // A previous process cannot finish these tasks. Never retry a model call on restart.
    for (const record of state.conversations) {
      if (record.status === "evaluating") {
        record.status = "error";
        needsWrite = true;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Cannot read valid workspace storage.");
    state = parseWorkspace(structuredClone(initialWorkspace));
    needsWrite = true;
  }

  async function persist(next: Workspace) {
    const data = JSON.stringify(next);
    if (Buffer.byteLength(data) > MAX_BYTES)
      throw new Error("Workspace storage limit exceeded.");
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = resolve(
      dirname(file),
      `.${basename(file)}.${randomUUID()}.tmp`,
    );
    let created = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      created = true;
      try {
        await handle.writeFile(data, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
      created = false;
    } finally {
      // Only remove the exact temporary file created by this operation.
      if (created) await unlink(temporary).catch(() => undefined);
    }
  }

  if (needsWrite) await persist(state);
  let queue = Promise.resolve();
  return {
    snapshot: () => structuredClone(state),
    mutate(change) {
      const task = queue.then(async () => {
        const draft = structuredClone(state);
        await change(draft);
        const next = parseWorkspace(draft);
        await persist(next);
        state = next;
        return structuredClone(state);
      });
      queue = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
  };
}
