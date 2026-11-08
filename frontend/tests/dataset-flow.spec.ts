import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { defaultChecklist } from "../src/lib/fixtures";

const reference = {
  "ru-2": {
    answers: [true, null, null, 20, true, 7, false, false],
    explanations: Array.from(
      { length: 8 },
      (_, i) => `Синтетическая строка Excel c${i + 1}, m1.`,
    ),
  },
};
test.beforeEach(async ({ page }) => {
  await page.route("**/__local/annotations", (route) =>
    route.fulfill({ json: {} }),
  );
});

const dataset = {
  isSuccess: true,
  data: {
    dataset_group_id: "DEV",
    total_records: 7,
    records: [
      ["en-20", "EN"],
      ["ru-10", "RU"],
      ["kz-11", "KZ"],
      ["ru-2", "RU"],
      ["en-3", "EN"],
      ["kz-2", "KZ"],
      ["ru-1", "RU"],
    ].map(([conversation_id, language]) => ({
      conversation_id,
      language,
      channel: "agent chat",
      audio_url: null,
      transcript: [
        {
          speaker: "client",
          timestamp: "00:00",
          text: "Синтетический разговор для проверки сортировки.",
        },
      ],
    })),
  },
};

test("autoload groups RU KZ EN and sorts numeric IDs without a manual import", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/__local/dataset", async (route) => {
    reads++;
    await route.fulfill({ json: dataset });
  });
  await page.goto("/");
  await expect(page.locator(".conversation-row")).toHaveCount(7);
  await expect(page.locator("tbody")).toHaveCount(3);
  expect(
    await page
      .locator("tbody")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-label")),
      ),
  ).toEqual(["Русский · RU", "Қазақша · KZ", "English · EN"]);
  expect(await page.locator(".row-link").allTextContents()).toEqual([
    "ru-1",
    "ru-2",
    "ru-10",
    "kz-2",
    "kz-11",
    "en-3",
    "en-20",
  ]);
  await expect(page.locator(".pagination")).toHaveCount(0);
  await expect(page.locator(".table-footer")).toContainText("1–7 из 7");
  expect(reads).toBe(1);
  await page.getByLabel("Фильтр по языку").selectOption("KZ");
  expect(await page.locator(".row-link").allTextContents()).toEqual([
    "kz-2",
    "kz-11",
  ]);
  await expect(page.locator(".language-group-row")).toHaveCount(1);
});

test("local row opens the supplied Excel preview read-only and exports its source without calling an API", async ({
  page,
}) => {
  await page.route("**/__local/dataset", (route) =>
    route.fulfill({ json: dataset }),
  );
  await page.route("**/__local/annotations", (route) =>
    route.fulfill({ json: reference }),
  );
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiCalls.push(request.url());
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Посмотреть результат ru-2", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "ru-2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Предпросмотр из Excel — backend не запускался", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".message")).toHaveCount(1);
  await expect(page.locator(".score-number")).toHaveText("85,38/ 100");
  await expect(page.locator(".criterion-result")).toHaveCount(8);
  await page
    .getByLabel("Фильтр критериев", { exact: true })
    .selectOption("issues");
  await expect(page.locator(".criterion-result")).toHaveCount(2);
  await expect(
    page
      .locator(".criterion-result")
      .filter({ hasText: "Синтетическая строка Excel c6" }),
  ).toHaveCount(1);
  await page
    .getByLabel("Фильтр критериев", { exact: true })
    .selectOption("all");
  await expect(
    page.getByRole("button", { name: /^(Оценить|Оценить заново|Оспорить)$/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Запуск оценки", { exact: true })).toHaveCount(
    0,
  );
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать JSON этого диалога", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported.source_kind).toBe("preview");
  expect(exported.source_description).toContain("Excel");
  expect(exported.total).toBe(85.38);
  expect(exported.results).toHaveLength(8);
  expect(exported.results.some((r: { value: unknown }) => r.value === null)).toBe(true);
  expect(apiCalls).toEqual([]);
  await page.getByRole("button", { name: "К диалогам", exact: true }).click();
  await expect(page.locator(".conversation-row")).toHaveCount(7);
  await expect(page.locator(".table-score")).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "Итог", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#dataset-group")).toHaveCount(0);
  await expect(
    page
      .locator(".conversation-row")
      .filter({ has: page.getByRole("button", { name: "ru-2", exact: true }) }),
  ).toContainText("Excel · предпросмотр");
});

test("unavailable Excel reference keeps transcript usable and retries without inventing a result", async ({
  page,
}) => {
  let unavailable = true;
  await page.route("**/__local/dataset", (route) =>
    route.fulfill({ json: dataset }),
  );
  await page.route("**/__local/annotations", (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: reference }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Посмотреть результат ru-2", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Предпросмотр недоступен", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Файл предпросмотра Excel недоступен",
  );
  await expect(page.locator(".message")).toHaveCount(1);
  await expect(page.locator(".score-card")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Оценить", exact: true }),
  ).toHaveCount(0);
  unavailable = false;
  await page
    .getByRole("button", {
      name: "Повторить загрузку результатов",
      exact: true,
    })
    .click();
  await expect(page.locator(".score-number")).toHaveText("85,38/ 100");
});

test("all checklist criteria, scales and N/A conditions are visible before evaluation", async ({
  page,
}) => {
  await page.route("**/__local/dataset", (route) =>
    route.fulfill({ json: dataset }),
  );
  await page.goto("/");
  await expect(page.locator(".conversation-row")).toHaveCount(7);
  await page
    .getByRole("button", { name: "Учебный пример", exact: true })
    .click();
  const preview = page.getByRole("region", {
    name: "Полный чек-лист перед оценкой",
    exact: true,
  });
  await expect(preview.locator(".checklist-preview-criterion")).toHaveCount(8);
  await expect(page.locator(".score-card")).toHaveCount(0);
  for (const criterion of defaultChecklist.criteria) {
    const item = preview.locator(".checklist-preview-criterion").filter({
      has: page.getByRole("heading", { name: criterion.name, exact: true }),
    });
    await expect(
      item.getByText(criterion.description, { exact: true }),
    ).toBeVisible();
    await expect(
      item.getByText(`Вес: ${criterion.weight}`, { exact: true }),
    ).toBeVisible();
    if (criterion.allowNA)
      await expect(
        item.getByText(criterion.naCondition, { exact: true }),
      ).toBeVisible();
    else
      await expect(
        item.getByText("N/A не предусмотрено", { exact: true }),
      ).toBeVisible();
    if (criterion.type === "scale") {
      await expect(item.locator(".criterion-scale dt")).toHaveCount(
        criterion.scale.length,
      );
      for (const option of criterion.scale)
        await expect(
          item.getByText(option.label, { exact: true }),
        ).toBeVisible();
    }
  }
  await page.getByRole("button", { name: "Оценить", exact: true }).click();
  await expect(page.locator(".score-number")).toHaveText("85,00/ 100");
  await expect(preview).toHaveCount(0);
  const empathy = page
    .locator(".criterion-result")
    .filter({ has: page.getByText("Эмпатия", { exact: true }) });
  await empathy.getByText("Правила критерия", { exact: true }).click();
  await expect(
    empathy.getByText(
      defaultChecklist.criteria.find((criterion) => criterion.id === "empathy")!
        .description,
      { exact: true },
    ),
  ).toBeVisible();
});
