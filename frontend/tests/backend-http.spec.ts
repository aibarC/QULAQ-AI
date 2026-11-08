import { readFile } from "node:fs/promises";
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

test("real local HTTP persists upload, analysis, separate improvement, export and reviewer correction", async ({
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
  await upload.getByLabel("Файл транскрипта", { exact: true }).setInputFiles({
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
  const savedBeforeImprovement = await (await page.request.get("/api/workspace")).json();
  const analysisBeforeImprovement = savedBeforeImprovement.evaluations.find(
    (evaluation: { recordId: string }) => evaluation.recordId.startsWith("UPLOAD:"),
  ) ?? savedBeforeImprovement.evaluations.at(-1);
  const improvement = page.getByRole("region", {
    name: "Пример правильного подхода", exact: true,
  });
  await improvement.getByRole("button", {
    name: "Показать пример правильного подхода", exact: true,
  }).click();
  await expect(improvement).toContainText("Синтетический пример: сначала уточните затруднение клиента");
  await expect(improvement).toContainText("не реальный разговор");
  await expect(page.locator(".score-number")).toHaveText("85,00/ 100");
  await page.reload();
  await expect(improvement).toContainText("Синтетический пример: сначала уточните затруднение клиента");
  const savedAfterImprovement = await (await page.request.get("/api/workspace")).json();
  const { improvement: savedAdvice, ...unchangedAnalysis } = savedAfterImprovement.evaluations.find(
    (evaluation: { id: string }) => evaluation.id === analysisBeforeImprovement.id,
  );
  expect(savedAdvice.text).toContain("Синтетический пример:");
  expect(unchangedAnalysis).toEqual(analysisBeforeImprovement);
  expect(requests.filter((path) => path.endsWith("/improvement"))).toHaveLength(1);
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
  const empathy = page.locator(".criterion-result").filter({
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
  const jsonDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать результат JSON", exact: true }).click();
  const jsonDownload = await jsonDownloadEvent;
  expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);
  const jsonResult = JSON.parse(await readFile((await jsonDownload.path())!, "utf8"));
  const exportedRecord = savedAfterImprovement.conversations.find((r: { id: string }) => r.id === analysisBeforeImprovement.recordId);
  expect(jsonResult.conversation_id).toBe(exportedRecord.externalId);
  expect(jsonResult.total).toBe(85);
  expect(jsonResult.results).toHaveLength(8);
  expect(jsonResult.transcript).toHaveLength(2);
  expect(jsonResult.conversation_improvement.text).toContain("Синтетический пример");

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/qulaq-http-result.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Подать апелляцию", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Критерий для пересмотра", exact: true })
    .selectOption("c5");
  await page
    .getByLabel("Почему вы не согласны?")
    .fill("Синтетический запрос на проверку сохранения решения.");
  await page
    .getByRole("button", { name: "Отправить апелляцию", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Передано проверяющему", exact: true }),
  ).toBeVisible();
  const appealHash = new URL(page.url()).hash;
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /^Мои апелляции/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Мои апелляции", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Фильтр апелляций", exact: true })
    .getByRole("button", { name: /^Ожидают/ })
    .click();
  await expect(page.locator(".appeal-row")).toHaveCount(1);
  await expect(page.locator(".appeal-row")).toContainText(
    "Эмпатия и клиентоориентированность",
  );
  await expect(page.locator(".appeal-row")).toContainText(
    "Ожидает рассмотрения",
  );
  await expect(page.locator(".appeal-row")).toContainText(
    "Синтетический запрос на проверку сохранения решения.",
  );
  await page.getByRole("button", { name: "Проверяющий", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Апелляции", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".appeal-row")).toHaveCount(1);
  await expect(page.locator(".appeal-row")).toContainText(
    "Ожидает рассмотрения",
  );
  await page.locator(".appeal-row").first().click();
  await expect.poll(() => new URL(page.url()).hash).toBe(appealHash);
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
  const savedAfterReview = await (await page.request.get("/api/workspace")).json();
  const reviewedAnalysis = savedAfterReview.evaluations.find(
    (evaluation: { id: string }) => evaluation.id === analysisBeforeImprovement.id,
  );
  expect(reviewedAnalysis.improvement).toBeUndefined();
  expect(reviewedAnalysis.originalTotal).toBe(85);
  expect(reviewedAnalysis.total).toBe(100);
  await page.reload();
  await expect(page.locator(".decision-total")).toContainText("100,00");
  await page.getByRole("button", { name: "Пользователь", exact: true }).click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /^Мои апелляции/ })
    .click();
  await page
    .getByRole("group", { name: "Фильтр апелляций", exact: true })
    .getByRole("button", { name: /^Рассмотрены/ })
    .click();
  await expect(page.locator(".appeal-row")).toHaveCount(1);
  await expect(page.locator(".appeal-row .badge.resolved")).toHaveText(
    "Рассмотрено",
  );
  await page.locator(".appeal-row").click();
  await expect.poll(() => new URL(page.url()).hash).toBe(appealHash);
  await expect(page.locator(".decision-total")).toContainText("100,00");
  await expect(
    page.getByRole("button", { name: "Сохранить решение", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".decision-total")).toContainText("100,00");
  expect(requests.filter((path) => path === "/api/evaluations")).toHaveLength(
    1,
  );
});

test("390px evaluated result exposes an appeal action and criterion selection without opening result details", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "enabled-fixture",
    "Enabled synthetic evaluator only.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST")
      posts.push(new URL(request.url()).pathname);
  });
  await page.goto("/");
  await expect(page.locator(".conversation-row").first()).toBeVisible();
  const upload = page.getByRole("region", {
    name: "Загрузка транскрипта",
    exact: true,
  });
  await upload.getByLabel("Файл транскрипта", { exact: true }).setInputFiles({
    name: "http-mobile-appeal.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Клиент: Мобильный синтетический вопрос.\nОператор: Мобильный синтетический ответ.",
    ),
  });
  await upload
    .getByRole("button", { name: "Открыть для анализа", exact: true })
    .click();
  await page.getByRole("button", { name: "Оценить", exact: true }).click();
  await expect(page.locator(".score-number")).toHaveText("85,00/ 100");
  const action = page.getByRole("button", {
    name: "Подать апелляцию",
    exact: true,
  });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport();
  await action.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("combobox", { name: "Критерий для пересмотра", exact: true })
    .selectOption("c5");
  await expect(dialog.getByLabel("Почему вы не согласны?")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "/tmp/qulaq-appeal-mobile.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(posts.filter((path) => path === "/api/evaluations")).toHaveLength(1);
  expect(posts.filter((path) => path === "/api/appeals")).toHaveLength(0);
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

test("manager groups model reasons, filters unresolved cases and opens evidence without mutations", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "enabled-fixture",
    "One isolated frontend is sufficient.",
  );
  const rule = {
    id: "r",
    name: "Синтетический критерий",
    description: "Только тест",
    type: "boolean",
    weight: 100,
    allowNA: false,
    naCondition: "",
    scale: [],
  };
  const checklist = {
    id: "test-reasons",
    name: "Тестовые правила",
    version: 1,
    criteria: [rule],
  };
  const conversations = ["test-withdrawal", "test-deposit", "test-legacy"].map(
    (id) => ({
      id,
      externalId: id,
      groupId: "SYNTHETIC",
      channel: "agent chat",
      language: "RU",
      status: "evaluated",
      demo: false,
      audioUrl: null,
      messages: [
        {
          id: `${id}:m1`,
          timestamp: "00:00",
          speaker: "client",
          text:
            id === "test-withdrawal"
              ? "Синтетический пример: вывод средств не завершён."
              : "Синтетический пример: пополнение выполнено.",
        },
      ],
    }),
  );
  const evaluations = conversations.map((c, i) => ({
    id: `eval-${c.id}`,
    recordId: c.id,
    createdAt: new Date().toISOString(),
    checklist,
    results: [
      {
        criterionId: "r",
        answer: true,
        originalAnswer: true,
        points: 100,
        explanation: "Синтетическая оценка.",
        evidence: [
          {
            kind: "quote",
            messageIds: [c.messages[0].id],
            quote: c.messages[0].text,
          },
        ],
      },
    ],
    total: 100,
    originalTotal: 100,
    grossViolation: false,
    demo: false,
    ...(i === 2
      ? {}
      : {
          contactReason: {
            taxonomyVersion: 1,
            primary: i === 0 ? "withdrawal_transfer" : "deposit",
            secondary: [],
            summary: i === 0 ? "Вывод средств" : "Пополнение",
            reason: "Причина прямо указана в тестовой реплике.",
            evidenceIds: [c.messages[0].id],
            resolution: {
              status: i === 0 ? "unresolved" : "resolved",
              reason: "Исход прямо указан в тестовой реплике.",
              evidenceIds: [c.messages[0].id],
            },
          },
        }),
  }));
  let mutations = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") mutations++;
  });
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      json: {
        conversations,
        evaluations,
        checklists: [checklist],
        appeals: [],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Руководитель", exact: true }).click();
  const reasons = page.getByRole("region", {
    name: "Причины обращений",
    exact: true,
  });
  await expect(reasons).toBeVisible();
  await reasons
    .getByLabel("Поиск по обращениям", { exact: true })
    .fill("test-withdrawal");
  await expect(reasons).toContainText("test-withdrawal");
  await reasons
    .getByLabel("Статус решения", { exact: true })
    .selectOption("unresolved");
  await expect(reasons).toContainText("test-withdrawal");
  await reasons
    .getByRole("button", { name: "Диалог и доказательства", exact: true })
    .click();
  const detail = reasons.getByRole("region", {
    name: "Диалог и доказательства test-withdrawal",
    exact: true,
  });
  await expect(detail).toBeVisible();
  await detail.locator(".evidence").first().click();
  await expect(detail.locator(".message.highlighted")).toHaveCount(1);
  await reasons
    .getByLabel("Поиск по обращениям", { exact: true })
    .fill("нет-совпадений");
  await expect(reasons).not.toContainText("test-withdrawal");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(mutations).toBe(0);
});

test("coaching shows a suggested reply separately from source evidence", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "enabled-fixture",
    "One isolated frontend is sufficient.",
  );
  const criterion = {
    id: "clarity",
    name: "Ясность ответа",
    description: "Ответ должен объяснять следующий шаг.",
    type: "boolean",
    weight: 100,
    allowNA: false,
    naCondition: "",
    scale: [],
  };
  const checklist = {
    id: "coaching-fixture",
    name: "Синтетический чек-лист",
    version: 1,
    criteria: [criterion],
  };
  const conversation = {
    id: "test-coaching",
    externalId: "test-coaching",
    groupId: "SYNTHETIC",
    language: "RU",
    channel: "agent chat",
    audioUrl: null,
    status: "evaluated",
    demo: false,
    messages: [
      {
        id: "test-coaching:m1",
        timestamp: "00:00",
        speaker: "operator",
        text: "Синтетический неясный ответ.",
      },
    ],
  };
  const evaluation = {
    id: "test-coaching-eval",
    recordId: conversation.id,
    createdAt: new Date().toISOString(),
    checklist,
    total: 0,
    originalTotal: 0,
    grossViolation: false,
    demo: false,
    results: [
      {
        criterionId: criterion.id,
        answer: false,
        originalAnswer: false,
        points: 0,
        explanation: "В синтетическом ответе не указан следующий шаг.",
        evidence: [
          {
            kind: "quote",
            quote: conversation.messages[0].text,
            messageIds: [conversation.messages[0].id],
          },
        ],
        coaching: {
          response: "Подскажите, на каком шаге возникает затруднение?",
          explanation:
            "Уточнение помогает дать понятный следующий шаг по правилу ясности.",
          needsContext: false,
          messageIds: [conversation.messages[0].id],
        },
      },
    ],
  };
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST") posts++;
  });
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      json: {
        conversations: [conversation],
        evaluations: [evaluation],
        checklists: [checklist],
        appeals: [],
      },
    }),
  );
  await page.goto("/#/dialog/test-coaching?evaluation=test-coaching-eval");
  const advice = page.getByRole("region", {
    name: "Как можно было ответить",
    exact: true,
  });
  await expect(advice).toContainText(
    "Подскажите, на каком шаге возникает затруднение?",
  );
  await expect(advice).toContainText("не реплика из разговора");
  await advice
    .getByRole("button", { name: "Показать исходный фрагмент" })
    .click();
  await expect(page.locator(".message.highlighted")).toHaveCount(1);
  await expect(page.locator(".messages")).not.toContainText(
    "Подскажите, на каком шаге",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(posts).toBe(0);
});

test("checklist editor saves additions and deletions for the next analysis", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "enabled-fixture", "Synthetic evaluator only");
  await page.goto("/");
  await page.getByRole("button", { name: "Чек-листы", exact: true }).click();
  await page.getByRole("button", { name: "Добавить критерий", exact: true }).click();
  await page.getByLabel("Название критерия", { exact: true }).fill("Проверка понимания — тест");
  await page.getByLabel("Что нужно проверить", { exact: true }).fill("Оператор уточняет, понятен ли клиенту следующий шаг.");
  await page.getByLabel("Вес критерия", { exact: true }).fill("25");
  const save = page.getByRole("button", { name: "Сохранить чек-лист", exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  const state = await (await page.request.get("/api/workspace")).json();
  const added = state.checklists[0];
  const criterion = added.criteria.find((r: {name: string}) => r.name === "Проверка понимания — тест");
  expect(criterion.weight).toBe(25);
  await page.reload();
  await page.getByRole("button", { name: /Проверка понимания — тест/ }).click();
  await page.getByRole("button", { name: "Удалить критерий", exact: true }).click();
  await page.getByRole("button", { name: "Удалить критерий", exact: true }).click();
  await save.click();
  await expect(save).toBeDisabled();
  const final = await (await page.request.get("/api/workspace")).json();
  expect(final.checklists[0].version).toBe(added.version + 1);
  expect(final.checklists[0].criteria.some((r: {id: string}) => r.id === criterion.id)).toBe(false);
  await page.reload();
  await expect(page.getByRole("button", { name: /Проверка понимания — тест/ })).toHaveCount(0);
});

test("API link import preserves history, shows transcript and audio, and never starts analysis", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "enabled-fixture", "Synthetic importer only");
  const requests: string[] = [];
  page.on("request", r => { if (r.method() === "POST") requests.push(new URL(r.url()).pathname); });
  await page.goto("/");
  const before = await (await page.request.get("/api/workspace")).json();
  const form = page.getByRole("region", { name: "Загрузить по ссылке API", exact: true });
  await form.getByLabel("Ссылка API организаторов", { exact: true }).fill("https://datasets.example.test/api?group_id=CONTROL&sig=synthetic");
  await form.getByRole("button", { name: "Загрузить диалоги", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Набор загружен");
  await expect(form.getByLabel("Ссылка API организаторов", { exact: true })).toHaveValue("");
  const after = await (await page.request.get("/api/workspace")).json();
  expect(after.evaluations).toEqual(before.evaluations);
  expect(after.appeals).toEqual(before.appeals);
  const added = after.conversations.find((r: {id: string}) => r.id === "CONTROL:api-synthetic-voice");
  expect(added.status).toBe("unrated");
  expect(added.audioUrl).toBe("https://audio.example.test/sample.mp3");
  expect(requests).toEqual(["/api/datasets/import-url"]);
  await page.locator('.conversation-row').filter({ hasText: "api-synthetic-voice" }).click();
  await expect(page.locator(".message").first()).toContainText("Синтетический вопрос из API");
  await expect(page.getByRole("link", { name: "Открыть запись" })).toHaveAttribute("href", added.audioUrl);
});

test("empty API workspace waits for an explicit import and does not restore DEV", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "enabled-fixture", "One project suffices");
  const state = await (await page.request.get("/api/workspace")).json();
  await page.route("**/api/workspace", route => route.fulfill({ json: {...state, conversations: [], evaluations: [], appeals: []} }));
  const posts: string[] = [];
  page.on("request", r => { if (r.method() === "POST") posts.push(r.url()); });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Загрузить по ссылке API", exact: true })).toBeVisible();
  await expect(page.locator(".conversation-row")).toHaveCount(0);
  expect(posts).toEqual([]);
});

test("official JSON file keeps organizer IDs through analysis and JSON download", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "enabled-fixture", "Synthetic evaluator only");
  const originalId = "control-001/қазақ";
  await page.goto("/");
  await page.getByLabel("Файл транскрипта", { exact: true }).setInputFiles({
    name: "control.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      isSuccess: true, data: { dataset_group_id: "CONTROL-JSON", total_records: 1, records: [{
        conversation_id: originalId, channel: "agent chat", language: "KZ", audio_url: null,
        transcript: [{ timestamp: "00:00", speaker: "client", text: "Синтетический вопрос." },
          { timestamp: "00:01", speaker: "operator", text: "Синтетический ответ." }],
      }] },
    })),
  });
  await page.getByRole("button", { name: "Открыть для анализа", exact: true }).click();
  await expect(page.getByRole("heading", { name: originalId, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Оценить", exact: true }).click();
  await expect(page.locator(".score-number")).toBeVisible();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать результат JSON", exact: true }).click();
  const exported = JSON.parse(await readFile((await (await event).path())!, "utf8"));
  expect(exported.conversation_id).toBe(originalId);
  expect(exported.dataset_group_id).toBe("CONTROL-JSON");
  expect(exported.results).toHaveLength(8);
  expect(exported.source_kind).toBe("server");
});
