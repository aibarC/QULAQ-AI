import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { legacyC6, migrateLegacyChecklist } from "../src/checklist-migrations.ts";
import { initialChecklist } from "../src/scoring.ts";
import { createStore } from "../src/store.ts";
import type { Workspace, Criterion } from "../../frontend/src/lib/types.ts";

function legacyWorkspace(): Workspace {
  const checklist = structuredClone(initialChecklist);
  checklist.version = 7;
  checklist.criteria[checklist.criteria.findIndex((c) => c.id === "c6")] = structuredClone(legacyC6);
  return { conversations: [], evaluations: [], appeals: [], checklists: [checklist] };
}

test("legacy C6 is persisted once on load; new default is already clean", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "qulaq-migrate-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "workspace.json");
  const before = legacyWorkspace();
  // Preserve unrelated user edits even when the official C6 is unchanged.
  before.checklists[0].criteria[0].weight = 23;
  before.checklists[0].name = "My official checklist";
  await writeFile(path, JSON.stringify(before));
  const store = await createStore(path, legacyWorkspace());
  const after = store.snapshot();
  assert.equal(after.checklists[0].version, 8);
  assert.deepEqual(after.checklists[0].criteria.find((c) => c.id === "c6"), initialChecklist.criteria.find((c) => c.id === "c6"));
  assert.equal(after.checklists[0].criteria[0].weight, 23);
  assert.equal(after.checklists[0].name, "My official checklist");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), after);
  const reloaded = await createStore(path, legacyWorkspace());
  assert.deepEqual(reloaded.snapshot(), after);
  assert.equal(migrateLegacyChecklist(after), false);
});

test("edited C6 definitions and other checklist IDs are never migrated", () => {
  const changes: ((c: Criterion) => void)[] = [
    (c) => { c.name += " custom"; },
    (c) => { c.description += " custom"; },
    (c) => { c.weight = 20; },
    (c) => { c.type = "boolean"; },
    (c) => { c.allowNA = true; },
    (c) => { c.naCondition = "custom"; },
    (c) => { c.scale[0].label = "custom"; },
    (c) => { c.scale[0].value = 1; },
    (c) => { c.scale.reverse(); },
  ];
  for (const change of changes) {
    const workspace = legacyWorkspace();
    change(workspace.checklists[0].criteria.find((c) => c.id === "c6")!);
    const before = structuredClone(workspace);
    assert.equal(migrateLegacyChecklist(workspace), false);
    assert.deepEqual(workspace, before);
  }
  const copy = legacyWorkspace();
  copy.checklists[0].id = "user-copy";
  const before = structuredClone(copy);
  assert.equal(migrateLegacyChecklist(copy), false);
  assert.deepEqual(copy, before);
});

test("migration changes only the live checklist, never historical snapshots or appeals", () => {
  const workspace = legacyWorkspace();
  // Structural sentinels deliberately isolate migration from scoring/validation.
  const historical = { checklist: structuredClone(workspace.checklists[0]), results: [{ answer: 7, points: 10.5 }], total: 83.5 };
  workspace.evaluations = [historical] as unknown as Workspace["evaluations"];
  workspace.appeals = [{ id: "preserve-appeal", decision: "keep" }] as unknown as Workspace["appeals"];
  const history = structuredClone({ evaluations: workspace.evaluations, appeals: workspace.appeals });
  assert.equal(migrateLegacyChecklist(workspace), true);
  assert.deepEqual({ evaluations: workspace.evaluations, appeals: workspace.appeals }, history);
});
