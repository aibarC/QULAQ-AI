import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

// Real localhost HTTP/store/scorer integration, with a synthetic injected
// evaluator. These tests provide no evidence about a live LLM or gateway.
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    !testInfo.config.metadata.backendFixture,
    "Use playwright.backend.config.ts for isolated synthetic HTTP servers.",
  );
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
});

test("real local HTTP persists an uploaded TXT, evaluates through the injected scorer, exports evidence and saves reviewer correction", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "enabled-fixture",
    "Enabled synthetic evaluator only.",
  );
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST")
      requests.push(new URL(request.url()).pathname);
  });
  await page.goto("/");
  await expect(page.locator(".conversation-row")).toHaveCount(1);
  const upload = page.getByRole("region", {
    name: "Загрузка транскрипта",
    exact: true,
  });
  const transcript =
    "Клиент: Синтетический вопрос HTTP.\nОператор: Синтетический ответ HTTP.";
  await upload
    .getByLabel("Файл транскрипта", { exact: true })
    .setInputFiles({
      name: "http-upload.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(transcript),
    });
  await expect(upload.locator(".upload-text-preview")).toHaveText(transcript);
  await upload
    .getByRole("button", { name: "Открыть для анализа", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Транскрипт диалога", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".message")).toHaveCount(2);
  await expect(page.locator(".message").first()).toContainText(
    "Синтетический вопрос HTTP.",
  );
  await expect(page.locator(".message").last()).toContainText(
    "Синтетический ответ HTTP.",
  );
  await expect(page.locator(".score-card")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".message")).toHaveCount(2);
  await expect(
    page
      .getByRole("region", {
        name: "Полный чек-лист перед оценкой",
        exact: true,
      })
      .locator(".checklist-preview-criterion"),
  ).toHaveCount(8);
  await page.getByRole("button", { name: "Оценить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Оцениваем…", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".score-number")).toHaveText("85,00/ 100");
  await expect(page.locator(".criterion-result")).toHaveCount(8);
  await expect(
    page
      .getByText(
        "Синтетический результат локального HTTP-теста; LLM не вызывался.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await expect(page.locator(".excel-preview-note, .demo-note")).toHaveCount(0);
  expect(
    requests.filter((path) => path === "/api/datasets/upload"),
  ).toHaveLength(1);
  expect(requests.filter((path) => path === "/api/evaluations")).toHaveLength(
    1,
  );
  const empathy = page
    .locator(".criterion-result")
    .filter({
      has: page.getByText("Эмпатия и клиентоориентированность", {
        exact: true,
      }),
    });
  await empathy.locator(".evidence").click();
  await expect(page.locator(".message.highlighted")).toHaveCount(1);
  await expect(page.locator(".message.highlighted")).toContainText(
    "Синтетический ответ HTTP.",
  );
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать результат XLSX", exact: true })
    .click();
  const download = await downloadEvent;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  expect(workbook.getWorksheet("Результат")!.getCell("B9").value).toBe(85);
  expect(workbook.getWorksheet("Результат")!.getCell("B3").value).toBe(
    "Результат сервера",
  );
  expect(workbook.getWorksheet("Транскрипт")!.rowCount).toBe(3);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/qulaq-http-result.png",
    animations: "disabled",
  });
  await empathy.getByRole("button", { name: "Оспорить", exact: true }).click();
  await page
    .getByLabel("Почему вы не согласны?")
    .fill("Синтетический запрос на проверку сохранения решения.");
  await page
    .getByRole("button", { name: "Отправить апелляцию", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Передано проверяющему", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Проверяющий", exact: true }).click();
  await page.locator(".appeal-row").first().click();
  await page
    .getByRole("radio", {
      name: "Изменить оценку Выбрать другой допустимый ответ",
    })
    .check();
  await page.getByLabel("Новый ответ").selectOption("true");
  await page
    .getByLabel("Причина решения")
    .fill("Синтетическое решение: критерий выполнен.");
  await page
    .getByRole("button", { name: "Сохранить решение", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Решение сохранено", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".decision-total")).toContainText("100,00");
  await page.reload();
  await expect(page.locator(".decision-total")).toContainText("100,00");
  expect(requests.filter((path) => path === "/api/evaluations")).toHaveLength(
    1,
  );
});

test("disabled local server rejects evaluation clearly without fabricating a result or retrying POST", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "disabled-fixture",
    "Disabled synthetic server only.",
  );
  let calls = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/evaluations"
    )
      calls++;
  });
  await page.goto("/");
  await expect(page.locator(".conversation-row")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "Анализировать http-synthetic-1",
      exact: true,
    })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Вызовы модели отключены",
  );
  await expect(page.locator(".message")).toHaveCount(2);
  await expect(page.locator(".score-card")).toHaveCount(0);
  expect(calls).toBe(1);
  await page.reload();
  await expect(page.locator(".message")).toHaveCount(2);
  await expect(page.locator(".score-card")).toHaveCount(0);
  expect(calls).toBe(1);
});
