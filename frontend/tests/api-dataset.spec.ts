import { expect, test, type Page } from "@playwright/test";
import { defaultChecklist, demoConversation } from "../src/lib/fixtures";
import type { Conversation, Evaluation, Workspace } from "../src/lib/types";

// HTTP fixtures exercise the API-mode UI. They are not backend/LLM integration evidence.
test.beforeEach(async ({}, testInfo) => {
  test.skip(!testInfo.config.metadata.apiFixture, "Run with playwright.api.config.ts to use API mode.");
});

const rules = { ...structuredClone(defaultChecklist), id: "api-rules-v2", name: "Правила тестового сервера", version: 2 };
const record: Conversation = {
  ...structuredClone(demoConversation),
  id: "DEV:api-synthetic-1", externalId: "api-synthetic-1", groupId: "DEV", demo: false, status: "unrated",
};
const empty = (): Workspace => ({ conversations: [], checklists: [structuredClone(defaultChecklist), structuredClone(rules)], evaluations: [], appeals: [] });
const imported = (): Workspace => ({ ...empty(), conversations: [structuredClone(record)] });
function evaluated(): Workspace {
  const state = imported();
  const result: Evaluation = {
    id: "api-confirmed-evaluation-1", recordId: record.id, createdAt: "2026-11-07T10:00:00Z", checklist: structuredClone(rules), demo: false,
    total: 100, originalTotal: 100, grossViolation: false,
    results: rules.criteria.map(criterion => ({
      criterionId: criterion.id,
      answer: criterion.type === "flag" ? false : criterion.type === "scale" ? Math.max(...criterion.scale.map(option => option.value)) : true,
      originalAnswer: criterion.type === "flag" ? false : criterion.type === "scale" ? Math.max(...criterion.scale.map(option => option.value)) : true,
      points: criterion.weight,
      explanation: `Ответ тестового HTTP-сервера: ${criterion.name}.`,
      evidence: [{ messageIds: [record.messages[1].id], quote: record.messages[1].text, kind: "quote" }],
    })),
  };
  state.conversations[0].status = "evaluated";
  state.evaluations = [result];
  return state;
}
async function expectImported(page: Page) {
  await expect(page.locator(".count-badge").first()).toHaveText("1");
  await expect(page.getByRole("button", { name: `Анализировать ${record.externalId}`, exact: true })).toBeEnabled();
  await expect(page.locator(".table-score")).toHaveCount(0);
}

test("API autoload and row analysis send the selected checklist once and render only confirmed server results", async ({ page }) => {
  let state = empty();
  const imports: unknown[] = [];
  const launches: unknown[] = [];
  let release!: () => void;
  const responseGate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/workspace", route => route.fulfill({ json: state }));
  await page.route("**/api/datasets/import", async route => {
    imports.push(route.request().postDataJSON());
    state = imported();
    await route.fulfill({ json: state });
  });
  await page.route("**/api/evaluations", async route => {
    launches.push(route.request().postDataJSON());
    await responseGate;
    state = evaluated();
    await route.fulfill({ json: state });
  });
  await page.goto("/");
  await expectImported(page);
  expect(imports).toEqual([{ groupId: "DEV" }]);
  await expect(page.getByLabel("Оценено 0 из 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Оценены 0", exact: true }).click();
  await expect(page.locator(".row-link")).toHaveCount(0);
  await page.getByRole("button", { name: "Показать все 1", exact: true }).click();
  await expect(page.getByLabel("Фильтр по статусу")).toHaveValue("all");
  await expect(page.locator(".row-link")).toHaveCount(1);
  await page.getByLabel("Чек-лист для анализа диалогов", { exact: true }).selectOption(rules.id);
  await page.getByRole("button", { name: `Анализировать ${record.externalId}`, exact: true }).click();
  await expect.poll(() => launches.length).toBe(1);
  expect(launches).toEqual([{ recordId: record.id, checklistId: rules.id }]);
  await expect(page.getByRole("button", { name: "Оцениваем…", exact: true })).toBeDisabled();
  await expect(page.locator(".score-card")).toHaveCount(0);
  release();
  await expect(page.locator(".score-number")).toHaveText("100,00/ 100");
  await expect(page.getByText("Демонстрационная оценка — ИИ не запускался", { exact: true })).toHaveCount(0);
  await page.locator(".criterion-result-toggle").first().click();
  await expect(page.getByText("Ответ тестового HTTP-сервера:", { exact: false }).first()).toBeVisible();
  expect(launches).toHaveLength(1);
});

test("failed API analysis preserves the imported transcript without fabricated score or repeated POST", async ({ page }) => {
  const state = imported();
  let posts = 0;
  await page.route("**/api/workspace", route => route.fulfill({ json: state }));
  await page.route("**/api/evaluations", async route => { posts++; await route.fulfill({ status: 503, json: { error: "fixture outage" } }); });
  await page.goto("/");
  await expectImported(page);
  await page.getByRole("button", { name: `Анализировать ${record.externalId}`, exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Ответ на запуск оценки не получен");
  await expect(page.getByRole("region", { name: "Транскрипт диалога", exact: true })).toBeVisible();
  await expect(page.locator(".message")).toHaveCount(record.messages.length);
  await expect(page.locator(".score-card")).toHaveCount(0);
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "К диалогам", exact: true }).click();
  await expect(page.locator(".row-link")).toHaveCount(1);
  await expect(page.locator(".table-score")).toHaveCount(0);
});

test("failed API autoload stays retryable and does not fabricate records", async ({ page }) => {
  let state = empty();
  let attempts = 0;
  await page.route("**/api/workspace", route => route.fulfill({ json: state }));
  await page.route("**/api/datasets/import", async route => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, json: {} });
    else { state = imported(); await route.fulfill({ json: state }); }
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Сервер недоступен");
  await expect(page.locator(".row-link")).toHaveCount(0);
  await page.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await expectImported(page);
  expect(attempts).toBe(2);
});
