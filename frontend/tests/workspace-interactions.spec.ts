import { expect, test, type Page } from "@playwright/test";

async function openApp(page: Page) {
  await page.route("**/__local/annotations", route => route.fulfill({ json: {} }));
  await page.route("**/__local/dataset", route => route.fulfill({ json: { isSuccess: true, data: { dataset_group_id: "DEV", total_records: 0, records: [] } } }));
  const loaded = page.waitForResponse(response => response.url().endsWith("/__local/dataset"));
  await page.goto("/");
  await loaded;
  await expect(page.getByRole("button", { name: "Загрузить набор", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Учебный пример", exact: true })).toBeEnabled();
}
async function openDemo(page: Page, evaluate = false) {
  await openApp(page);
  await page.getByRole("button", { name: "Учебный пример", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Учебный диалог", exact: true })).toBeVisible();
  if (evaluate) {
    await page.getByRole("button", { name: "Оценить", exact: true }).click();
    await expect(page.locator(".score-number")).toHaveText("85,00/ 100");
  }
}
const transcript = (page: Page) => page.getByRole("region", { name: "Транскрипт диалога", exact: true });
const evaluation = (page: Page) => page.getByRole("region", { name: "Оценка диалога", exact: true });
const divider = (page: Page) => page.getByRole("separator", { name: "Ширина транскрипта", exact: true });

test("workspace divider clamps keyboard and pointer resizing and restores the saved ratio", async ({ page }) => {
  await openDemo(page);
  const handle = divider(page);
  await expect(handle).toHaveAttribute("aria-valuemin", "35");
  await expect(handle).toHaveAttribute("aria-valuemax", "65");
  await expect(handle).toHaveAttribute("aria-valuenow", "52");
  await handle.focus();
  await handle.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", "65");
  const wide = await handle.boundingBox();
  await handle.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "65");
  await handle.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "63");
  await handle.press("Home");
  await handle.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "35");
  const narrow = await handle.boundingBox();
  expect(wide!.x - narrow!.x).toBeGreaterThan(100);
  await handle.press("Shift+ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "40");
  const grip = handle.locator(".split-grip");
  await grip.scrollIntoViewIfNeeded();
  const dragStart = await grip.boundingBox();
  const dragY = dragStart!.y + dragStart!.height / 2;
  await page.mouse.move(dragStart!.x + dragStart!.width / 2, dragY);
  await page.mouse.down();
  await expect(page.locator(".split-workspace")).toHaveClass(/is-resizing/);
  await page.mouse.move(1439, dragY, { steps: 8 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "65");
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", "65");
  await page.getByRole("button", { name: "Сбросить расположение панелей", exact: true }).click();
  await expect(handle).toHaveAttribute("aria-valuenow", "52");
  await expect(transcript(page)).toBeVisible();
  await expect(evaluation(page)).toBeVisible();
});

test("expanding either workspace panel preserves transcript search and evidence reveals both panels", async ({ page }, testInfo) => {
  await openDemo(page, true);
  const search = page.getByRole("textbox", { name: "Поиск в транскрипте", exact: true });
  await search.fill("вымышлены");
  await page.getByRole("button", { name: "Развернуть транскрипт", exact: true }).click();
  await expect(evaluation(page)).toBeHidden();
  await expect(page.locator(".evaluation-panel")).toHaveCount(1);
  await page.getByRole("button", { name: "Показать обе панели", exact: true }).click();
  await expect(evaluation(page)).toBeVisible();
  await expect(search).toHaveValue("вымышлены");
  await page.getByRole("button", { name: "Развернуть оценку", exact: true }).click();
  await expect(transcript(page)).toBeHidden();
  await expect(page.locator(".transcript-panel")).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("workspace-expanded-desktop.png"), fullPage: true, animations: "disabled" });
  const empathy = page.locator(".criterion-result").filter({ has: page.getByText("Эмпатия", { exact: true }) });
  await empathy.locator(".evidence").click();
  await expect(transcript(page)).toBeVisible();
  await expect(evaluation(page)).toBeVisible();
  await expect(search).toHaveValue("вымышлены");
  await expect(page.locator(".message.highlighted")).toHaveCount(1);
  await page.getByRole("button", { name: "Развернуть оценку", exact: true }).click();
  await empathy.locator(".evidence").click();
  await expect(transcript(page)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("workspace-evidence-desktop.png"), fullPage: true, animations: "disabled" });
  await page.screenshot({ path: "test-results/final-workspace.png", animations: "disabled" });
});

test("evidence focus keeps every message and search hit readable, then clears without losing context", async ({ page }) => {
  await openDemo(page, true);
  const messages = page.locator(".message");
  const count = await messages.count();
  const search = page.getByRole("textbox", { name: "Поиск в транскрипте", exact: true });
  await search.fill("вымышлены");
  const baselineOpacity = await messages.evaluateAll(elements => elements.map(element => getComputedStyle(element).opacity));
  await page.locator(".criterion-result").filter({ has: page.getByText("Эмпатия", { exact: true }) }).locator(".evidence").click();
  await expect(page.locator(".messages")).toHaveClass(/has-evidence-focus/);
  await expect(messages).toHaveCount(count);
  await expect.poll(() => page.locator(".message.highlighted").evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  await expect.poll(() => page.locator(".message.matched").first().evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  await expect.poll(() => page.locator(".message:not(.highlighted):not(.matched)").first().evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThan(1);
  await page.getByRole("button", { name: "Снять выделение", exact: true }).click();
  await expect(page.locator(".messages")).not.toHaveClass(/has-evidence-focus/);
  await expect(page.locator(".message.highlighted")).toHaveCount(0);
  await expect.poll(() => messages.evaluateAll(elements => elements.map(element => getComputedStyle(element).opacity))).toEqual(baselineOpacity);
  await expect(search).toHaveValue("вымышлены");
  await expect(messages).toHaveCount(count);
});

test("mobile workspace stacks both panels even after desktop expansion", async ({ page }, testInfo) => {
  await openDemo(page, true);
  await page.getByRole("button", { name: "Развернуть оценку", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(divider(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Развернуть оценку", exact: true })).toBeHidden();
  await expect(transcript(page)).toBeVisible();
  await expect(evaluation(page)).toBeVisible();
  const left = await transcript(page).boundingBox();
  const right = await evaluation(page).boundingBox();
  expect(right!.y).toBeGreaterThanOrEqual(left!.y + left!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator(".criterion-result").filter({ has: page.getByText("Эмпатия", { exact: true }) }).locator(".evidence").click();
  await expect(page.locator(".message.highlighted")).toHaveCount(1);
  await page.getByRole("button", { name: "Снять выделение", exact: true }).click();
  await expect(page.locator(".message.highlighted")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("workspace-mobile.png"), fullPage: true, animations: "disabled" });
});

test("motion preference persists and system reduced motion overrides full animation", async ({ page }) => {
  await openApp(page);
  const motion = page.getByRole("combobox", { name: "Интенсивность анимации", exact: true });
  const fins = page.locator(".listening-sculpture i");
  const animations = () => fins.evaluateAll(elements => [...new Set(elements.map(element => getComputedStyle(element).animationName))]);
  await expect(motion).toHaveValue("full");
  await expect.poll(animations).not.toEqual(["none"]);
  await motion.selectOption("moderate");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "moderate");
  await expect.poll(animations).toEqual(["none"]);
  await motion.selectOption("off");
  await page.reload();
  await expect(motion).toHaveValue("off");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await expect.poll(animations).toEqual(["none"]);
  await motion.selectOption("full");
  await expect.poll(animations).not.toEqual(["none"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(animations).toEqual(["none"]);
});

test("1024px side navigation stacks evaluated panels while preserving both desktop ratio limits", async ({ page }, testInfo) => {
  await openDemo(page, true);
  await page.getByRole("button", { name: "Навигация сбоку", exact: true }).click();
  for (const key of ["Home", "End"]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await divider(page).press(key);
    const expectedRatio = key === "Home" ? "35" : "65";
    await expect(divider(page)).toHaveAttribute("aria-valuenow", expectedRatio);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(divider(page)).toBeHidden();
    await expect(page.getByRole("group", { name: "Расположение панелей", exact: true })).toBeHidden();
    await expect(transcript(page)).toBeVisible();
    await expect(evaluation(page)).toBeVisible();
    const upper = await transcript(page).boundingBox();
    const lower = await evaluation(page).boundingBox();
    expect(lower!.y).toBeGreaterThanOrEqual(upper!.y + upper!.height);
    await expect(page.locator(".split-separator")).toHaveAttribute("aria-valuenow", expectedRatio);
    const metrics = await page.evaluate(() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll("body *")].flatMap(element => {
        const r = element.getBoundingClientRect();
        return r.width && r.right > innerWidth + 1
          ? [{ class: element.className, width: Math.round(r.width), right: Math.round(r.right) }]
          : [];
      }).slice(0, 15),
    }));
    expect.soft(metrics.width, `${key}: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewport);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("workspace-side-1024.png"), fullPage: true, animations: "disabled" });
});
