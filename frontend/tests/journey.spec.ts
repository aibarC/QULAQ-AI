import { expect, test, type Page } from "@playwright/test";
const demoStorageKey = "qulaq:teaching-workspace:v1";
async function openApp(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Диалоги", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Загрузить набор", exact: true }),
  ).toBeEnabled();
}
async function openDemo(page: Page) {
  await page
    .getByRole("button", { name: "Учебный пример", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Учебный диалог", exact: true }),
  ).toBeVisible();
}
async function evaluateDemo(page: Page) {
  await page.getByRole("button", { name: "Оценить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Оцениваем…", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".score-number")).toHaveText("85,00/ 100");
  await expect(
    page.getByText("Демонстрационная оценка — ИИ не запускался", {
      exact: true,
    }),
  ).toBeVisible();
}
test("real DEV import: 65 records, filters, no fabricated scores, errors preserve data", async ({
  page,
}) => {
  await openApp(page);
  await expect(
    page.getByText("Набор ещё не загружен", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Загрузить набор", exact: true })
    .click();
  await expect(page.locator(".count-badge").first()).toHaveText("65");
  await expect(page.locator(".table-footer")).toContainText("1–12 из 65");
  await expect(page.locator("tbody tr")).toHaveCount(12);
  await expect(page.locator(".table-score").first()).toHaveText("—");
  await expect(page.locator("tbody .status.evaluated")).toHaveCount(0);
  for (const [language, count] of [
    ["RU", 35],
    ["KZ", 15],
    ["EN", 15],
  ] as const) {
    await page.getByLabel("Фильтр по языку").selectOption(language);
    await expect(page.locator(".table-footer")).toContainText(`из ${count}`);
    await expect(page.locator("tbody .language-chip").first()).toHaveText(
      language,
    );
  }
  await page.getByLabel("Фильтр по языку").selectOption("all");
  await page.getByLabel("Фильтр по каналу").selectOption("voice call");
  await expect(page.locator(".table-footer")).toContainText("1–5 из 5");
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await page.locator(".row-link").first().click();
  await expect(
    page.getByRole("region", { name: "Транскрипт диалога" }),
  ).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(1);
  await page.getByRole("button", { name: "Оценить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Для оценки реальных диалогов подключите сервер",
  );
  await expect(page.locator(".score-card")).toHaveCount(0);
  await expect(page.locator(".message").first()).toBeVisible();
  await page.getByRole("button", { name: "К диалогам", exact: true }).click();
  await page.route("**/__local/dataset", (route) =>
    route.fulfill({ status: 503, body: "{}" }),
  );
  await page
    .getByRole("button", { name: "Обновить набор", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Сервер недоступен");
  await expect(page.locator(".count-badge").first()).toHaveText("65");
  await expect(page.locator("tbody tr")).toHaveCount(5);
  expect(
    await page.evaluate((key) => {
      const raw = sessionStorage.getItem(key);
      const state = raw ? JSON.parse(raw) : null;
      return state?.conversations.every(
        (item: { demo?: boolean }) => item.demo === true,
      );
    }, demoStorageKey),
  ).toBe(true);
});
test("teaching journey: evidence, appeal, correction, original score and history survive reload", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openDemo(page);
  await evaluateDemo(page);
  const empathy = page
    .locator(".criterion-result")
    .filter({ has: page.getByText("Эмпатия", { exact: true }) });
  await empathy.locator(".evidence").click();
  await expect(page.locator(".message.highlighted")).toHaveCount(1);
  await expect(
    page.getByText("Выделено доказательство", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("synthetic-demo-desktop.png"),
    fullPage: true,
  });
  await empathy.getByRole("button", { name: "Оспорить", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByLabel("Почему вы не согласны?")
    .fill(
      "В учебном разговоре оператор выражает сочувствие. Прошу пересмотреть ответ по критерию эмпатии.",
    );
  await page
    .getByRole("button", { name: "Отправить апелляцию", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Передано проверяющему" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Проверяющий", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Апелляции", exact: true }),
  ).toBeVisible();
  await page.locator(".appeal-row").first().click();
  await page
    .getByRole("radio", {
      name: "Изменить оценку Выбрать другой допустимый ответ",
    })
    .check();
  await page.getByLabel("Новый ответ").selectOption("true");
  await page
    .getByLabel("Причина решения")
    .fill(
      "В реплике есть поддержка клиента. Критерий выполнен, оценка изменена на «Да».",
    );
  await page
    .getByRole("button", { name: "Сохранить решение", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Решение сохранено", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".decision-total")).toContainText("100,00");
  await page.getByRole("button", { name: "Пользователь", exact: true }).click();
  await openDemo(page);
  await expect(page.locator(".score-number")).toHaveText("100,00/ 100");
  await expect(page.locator(".score-original")).toContainText("85,00");
  await expect(page.locator(".override")).toContainText(
    "ИИ: Нет → Проверяющий: Да",
  );
  await page.reload();
  await expect(page.locator(".score-number")).toHaveText("100,00/ 100");
  await expect(page.locator(".override")).toContainText(
    "ИИ: Нет → Проверяющий: Да",
  );
  await page
    .getByRole("button", { name: "Оценить заново", exact: true })
    .click();
  await expect(page.locator(".score-number")).toHaveText("85,00/ 100");
  const runs = page.getByLabel("Запуск оценки");
  await expect(runs.locator("option")).toHaveCount(2);
  await runs.selectOption({ index: 1 });
  await expect(page.locator(".score-number")).toHaveText("100,00/ 100");
  await page
    .getByRole("button", { name: "Открыть решение", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Решение сохранено", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("checklist editing creates versioned rules and guards unsaved navigation", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("button", { name: "Чек-листы", exact: true }).click();
  await page.getByLabel(/^Название чек-листа/).fill("Проверка сервиса v2");
  const dialogPromise = page.waitForEvent("dialog");
  const backNavigation = page.evaluate(() => history.back());
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain("несохранённые изменения");
  await dialog.dismiss();
  await backNavigation;
  await expect(
    page.getByRole("heading", { name: "Чек-листы", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(/^Название чек-листа/)).toHaveValue(
    "Проверка сервиса v2",
  );
  await page
    .getByRole("button", { name: "Сохранить чек-лист", exact: true })
    .click();
  await expect(page.locator(".checklist-editor-heading .badge")).toHaveText(
    "Версия 2",
  );
  await expect(
    page.getByRole("button", { name: "Сохранить чек-лист", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Новый чек-лист", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сохранить чек-лист", exact: true })
    .click();
  await expect(
    page.getByText("Введите название чек-листа.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Название чек-листа/).fill("Учебный стандарт");
  await page.getByLabel(/^Название критерия/).fill("Уточнение вопроса");
  await page
    .getByLabel(/^Что нужно проверить/)
    .fill("Оператор уточняет цель обращения перед консультацией.");
  await page
    .getByRole("button", { name: "Сохранить чек-лист", exact: true })
    .click();
  await expect(page.locator(".checklist-editor-heading .badge")).toHaveText(
    "Версия 1",
  );
  await expect(page.locator(".checklist-library-item")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".checklist-library-item")).toHaveCount(2);
  await page.getByRole("button", { name: /Учебный стандарт/ }).click();
  await expect(page.getByLabel(/^Название чек-листа/)).toHaveValue(
    "Учебный стандарт",
  );
});
test("mobile navigation and synthetic evaluation fit a 390px viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("synthetic-empty-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await expect(page.locator(".sidebar")).not.toHaveAttribute("inert");
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest(".sidebar")),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar")).toHaveAttribute("inert");
  await expect(
    page.getByRole("button", { name: "Открыть меню", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await page.getByRole("button", { name: "Чек-листы", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Чек-листы", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await page.getByRole("button", { name: "Диалоги", exact: true }).click();
  await openDemo(page);
  await evaluateDemo(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("synthetic-demo-mobile.png"),
    fullPage: true,
  });
  const empathy = page
    .locator(".criterion-result")
    .filter({ has: page.getByText("Эмпатия", { exact: true }) });
  await empathy.getByRole("button", { name: "Оспорить", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const box = await page.getByRole("dialog").boundingBox();
  expect(box && box.width <= 390).toBe(true);
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
