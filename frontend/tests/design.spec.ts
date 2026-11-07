import { expect, test, type Page } from "@playwright/test";

const fixture = {
  isSuccess: true,
  data: {
    dataset_group_id: "DEV", total_records: 15,
    records: Array.from({ length: 15 }, (_, index) => ({
      conversation_id: `synthetic-${String(index + 1).padStart(2, "0")}`,
      language: index < 12 ? "RU" : "EN",
      channel: index % 3 ? "agent chat" : "voice call",
      audio_url: null,
      transcript: [{ speaker: "client", timestamp: "00:00", text: `Учебная фраза ${index + 1} для проверки поиска.` }],
    })),
  },
};

async function open(page: Page) {
  await page.route("**/__local/dataset", route => route.fulfill({ json: fixture }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Загрузить набор", exact: true })).toBeEnabled();
}
async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Загрузить набор", exact: true }).click();
  await expect(page.locator(".table-footer")).toContainText("1–12 из 15");
}
async function search(page: Page, query: string) {
  await page.getByRole("button", { name: "Быстрый поиск", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Поиск раздела или диалога" });
  await expect(input).toBeFocused();
  await input.fill(query);
  return input;
}
async function expectNoOverflow(page: Page, stage: string) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")].flatMap(element => {
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return r.width && r.right > innerWidth + 1 && style.visibility !== "hidden"
        ? [{ tag: element.tagName, class: element.className, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }]
        : [];
    }).slice(0, 35),
  }));
  expect.soft(dimensions.width, `${stage}: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewport);
}

test("command shortcut focuses search, supports keyboard selection and restores focus on Escape", async ({ page }, testInfo) => {
  await open(page);
  await page.screenshot({ path: testInfo.outputPath("design-empty-desktop.png"), fullPage: true });
  const trigger = page.getByRole("button", { name: "Быстрый поиск", exact: true });
  await trigger.focus();
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Поиск раздела или диалога" });
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Meta+k");
  await expect(input).toBeFocused();
  await input.fill("DEMO-001");
  await input.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await trigger.click();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Чек-листы", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Как это работает", exact: true }).click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(input).toHaveCount(0);
});

test("command conversation search respects reviewer routes", async ({ page }) => {
  await open(page);
  await importFixture(page);
  const input = await search(page, "Учебная фраза 15");
  await expect(page.getByRole("dialog").getByRole("option")).toHaveCount(1);
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "synthetic-15", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Проверяющий", exact: true }).click();
  const reviewerSearch = await search(page, "");
  await expect(page.getByRole("dialog").getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("dialog").getByRole("option")).toContainText("Апелляции");
  await reviewerSearch.fill("synthetic");
  await expect(page.getByRole("dialog").getByRole("option")).toHaveCount(0);
  await expect(page.getByText("Ничего не найдено.", { exact: false })).toBeVisible();
});

test("canceling command navigation preserves an unsaved checklist", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Чек-листы", exact: true }).click();
  await page.getByLabel(/^Название чек-листа/).fill("Несохранённые правила");
  const input = await search(page, "Диалоги");
  let confirmation = "";
  page.once("dialog", async dialog => { confirmation = dialog.message(); await dialog.dismiss(); });
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Чек-листы", exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Название чек-листа/)).toHaveValue("Несохранённые правила");
  expect(confirmation).toContain("несохранённые изменения");
  await expect(page.getByRole("button", { name: "Сохранить чек-лист", exact: true })).toBeEnabled();
});

test("signal actions reset other filters and density changes actual row height", async ({ page }, testInfo) => {
  await open(page);
  await importFixture(page);
  await expect(page.getByLabel("Оценено 0 из 15", { exact: true })).toBeVisible();
  await page.getByLabel("Фильтр по языку").selectOption("EN");
  await page.getByLabel("Фильтр по каналу").selectOption("voice call");
  await page.getByRole("button", { name: "Без оценки 15", exact: true }).click();
  await expect(page.getByLabel("Фильтр по языку")).toHaveValue("all");
  await expect(page.getByLabel("Фильтр по каналу")).toHaveValue("all");
  await expect(page.locator(".table-footer")).toContainText("1–12 из 15");
  const large = await page.locator("tbody tr").first().boundingBox();
  await page.getByRole("button", { name: "Компактный список", exact: true }).click();
  await expect(page.getByRole("button", { name: "Компактный список", exact: true })).toHaveAttribute("aria-pressed", "true");
  const compact = await page.locator("tbody tr").first().boundingBox();
  expect(compact!.height).toBeLessThan(large!.height);
  await page.getByRole("button", { name: "Оценены 0", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.getByRole("button", { name: "Показать все 15", exact: true }).click();
  await expect(page.locator(".table-footer")).toContainText("1–12 из 15");
  await expect(page.getByLabel("Фильтр по статусу")).toHaveValue("all");
  await page.screenshot({ path: testInfo.outputPath("design-synthetic-overview-desktop.png"), fullPage: true });
});

test("390px search, overview and compact table fit viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expectNoOverflow(page, "empty");
  await page.screenshot({ path: testInfo.outputPath("design-empty-mobile.png"), fullPage: true });
  await search(page, "DEMO-001");
  const modal = await page.getByRole("dialog").boundingBox();
  expect(modal!.width).toBeLessThanOrEqual(390);
  await expectNoOverflow(page, "command");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await importFixture(page);
  await expectNoOverflow(page, "overview");
  await page.getByRole("button", { name: "Компактный список", exact: true }).click();
  await expectNoOverflow(page, "compact");
  await page.screenshot({ path: testInfo.outputPath("design-synthetic-overview-mobile.png"), fullPage: true });
});

test("390px teaching result has no document overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: "Учебный пример", exact: true }).click();
  await page.getByRole("button", { name: "Оценить", exact: true }).click();
  await expect(page.locator(".score-number")).toHaveText("85,00/ 100");
  await page.screenshot({ path: testInfo.outputPath("design-teaching-mobile.png"), fullPage: true });
  await expectNoOverflow(page, "evaluated teaching example");
});

test("primary button hover and press move visibly and respect reduced motion", async ({ page }) => {
  await open(page);
  const button = page.getByRole("button", { name: "Загрузить набор", exact: true });
  await button.hover();
  const offset = () => button.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42);
  await expect.poll(offset).toBeLessThan(-1);
  await page.mouse.down();
  await expect.poll(offset).toBeGreaterThan(0);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await button.hover();
  await expect.poll(() => button.evaluate(element => getComputedStyle(element).transform)).toBe("none");
});

test("listening stage switches its explanation and sculpture, pauses and resumes, then opens the teaching dialogue", async ({ page }, testInfo) => {
  await open(page);
  const stage = page.getByRole("region", { name: "Знакомство с QULAQ" });
  const conversation = stage.getByRole("button", { name: /Разговор$/ });
  const criteria = stage.getByRole("button", { name: /Критерии$/ });
  const evidence = stage.getByRole("button", { name: /Доказательства$/ });
  await expect(conversation).toHaveAttribute("aria-pressed", "true");
  await expect(stage.getByRole("heading", { name: "Сначала — услышать." })).toBeVisible();
  await criteria.click();
  await expect(criteria).toHaveAttribute("aria-pressed", "true");
  await expect(conversation).toHaveAttribute("aria-pressed", "false");
  await expect(stage.getByRole("heading", { name: "Затем — разобраться." })).toBeVisible();
  await expect(stage.getByText("Каждый критерий рассматривается отдельно.", { exact: false })).toBeVisible();
  const firstFin = stage.locator(".listening-sculpture i").first();
  await expect.poll(() => firstFin.evaluate(element => getComputedStyle(element).height)).toBe("90px");
  await evidence.click();
  await expect(evidence).toHaveAttribute("aria-pressed", "true");
  await expect(criteria).toHaveAttribute("aria-pressed", "false");
  await expect(stage.getByRole("heading", { name: "Вывод — с основанием." })).toBeVisible();
  await expect(stage.getByText("От оценки можно перейти к точной реплике.", { exact: false })).toBeVisible();
  await expect.poll(() => firstFin.evaluate(element => getComputedStyle(element).height)).toBe("100px");
  await stage.getByRole("button", { name: "Приостановить движение иллюстрации", exact: true }).click();
  const play = stage.getByRole("button", { name: "Включить движение иллюстрации", exact: true });
  await expect(play).toHaveAttribute("aria-pressed", "true");
  const playStates = () => stage.locator(".listening-sculpture i").evaluateAll(elements => [...new Set(elements.map(element => getComputedStyle(element).animationPlayState))]);
  await expect.poll(playStates).toEqual(["paused"]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("listening-stage-desktop.png"), fullPage: true });
  await play.click();
  await expect.poll(playStates).toEqual(["running"]);
  await stage.getByRole("button", { name: "Исследовать пример", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Учебный диалог", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Транскрипт диалога" })).toBeVisible();
});

test("390px listening scenes remain usable with reduced motion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const stage = page.getByRole("region", { name: "Знакомство с QULAQ" });
  await expect(stage).toBeVisible();
  await expect(stage.getByRole("button", { name: "Приостановить движение иллюстрации", exact: true })).toBeHidden();
  for (const [name, heading] of [
    [/Разговор$/, "Сначала — услышать."],
    [/Критерии$/, "Затем — разобраться."],
    [/Доказательства$/, "Вывод — с основанием."],
  ] as const) {
    await stage.getByRole("button", { name }).click();
    await expect(stage.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expectNoOverflow(page, `listening scene: ${heading}`);
    await expect.poll(() => stage.locator(".listening-sculpture i, .listening-quote, .listening-explanation").evaluateAll(elements => [...new Set(elements.map(element => getComputedStyle(element).animationName))])).toEqual(["none"]);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("listening-stage-mobile.png"), fullPage: true });
  await stage.getByRole("button", { name: "Исследовать пример", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Учебный диалог", exact: true })).toBeVisible();
  await expectNoOverflow(page, "teaching dialogue opened from listening stage");
});

test("navigation defaults to a top dock, persists side preference and keeps the mobile drawer usable", async ({ page }, testInfo) => {
  await open(page);
  const shell = page.locator(".app-shell");
  const navigation = page.locator(".sidebar");
  const body = page.locator(".app-body");
  await expect(shell).toHaveAttribute("data-navigation", "top");
  const top = await navigation.boundingBox();
  expect(top!.width).toBeGreaterThan(top!.height);
  await expect.poll(() => body.evaluate(element => parseFloat(getComputedStyle(element).marginLeft))).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("navigation-top-desktop.png"), fullPage: true, animations: "disabled" });
  await page.screenshot({ path: "test-results/final-advanced.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 768, height: 1024 });
  await expectNoOverflow(page, "768px top dock");
  await expect(navigation.getByRole("button", { name: "Чек-листы", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Быстрый поиск", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("navigation-top-tablet.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Навигация сбоку", exact: true }).click();
  await expect(shell).toHaveAttribute("data-navigation", "side");
  await expect.poll(async () => { const box = await navigation.boundingBox(); return box!.height > box!.width; }).toBe(true);
  await expect.poll(() => body.evaluate(element => parseFloat(getComputedStyle(element).marginLeft))).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Загрузить набор", exact: true })).toBeEnabled();
  await expect(shell).toHaveAttribute("data-navigation", "side");
  await expect(page.getByRole("button", { name: "Навигация сверху", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("navigation-side-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Навигация сверху", exact: true })).toBeHidden();
  await expect(navigation).toHaveAttribute("inert");
  await expectNoOverflow(page, "mobile after persisted side preference");
  const menu = page.getByRole("button", { name: "Открыть меню", exact: true });
  await menu.click();
  await expect(navigation).not.toHaveAttribute("inert");
  await expect(navigation.getByRole("button", { name: "Чек-листы", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navigation).toHaveAttribute("inert");
  await expect(menu).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Навигация сверху", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Загрузить набор", exact: true })).toBeEnabled();
  await expect(shell).toHaveAttribute("data-navigation", "top");
  const restored = await navigation.boundingBox();
  expect(restored!.width).toBeGreaterThan(restored!.height);
  await expect.poll(() => body.evaluate(element => parseFloat(getComputedStyle(element).marginLeft))).toBe(0);
});
