import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

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
  await expect(page.getByRole("button", { name: /XLSX/ })).toHaveCount(0);
  const jsonDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать JSON этого диалога", exact: true }).click();
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

test("checklist editor applies saved additions, deletions and weights while preserving result snapshots", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "enabled-fixture", "Synthetic evaluator only");
  await page.goto("/");
  const workspace = async () => (await (await page.request.get("/api/workspace")).json());
  const initial = await workspace();
  const checklist = initial.checklists[0];
  const recordId = initial.conversations[0].id;
  const dialogUrl = `/#/dialog/${encodeURIComponent(recordId)}`;
  const expectedTotal = (rules: typeof checklist.criteria) => {
    const weighted = rules.filter((rule: { type: string }) => rule.type !== "flag");
    const weight = weighted.reduce((sum: number, rule: { weight: number }) => sum + rule.weight, 0);
    const lost = weighted.filter((rule: { id: string }) => rule.id === "c5")
      .reduce((sum: number, rule: { weight: number }) => sum + rule.weight, 0);
    return Math.round(10000 * (weight - lost) / weight) / 100;
  };
  const run = async (rules: typeof checklist) => {
    await page.goto(dialogUrl);
    await page.locator("#evaluation-checklist").selectOption(checklist.id);
    const before = await workspace();
    const previousIds = new Set(before.evaluations.map((item: { id: string }) => item.id));
    await page.getByRole("button", { name: /^(Оценить|Оценить заново)$/ }).click();
    await expect(page.getByRole("button", { name: "Оцениваем…", exact: true })).toHaveCount(0);
    await expect.poll(async () => (await workspace()).evaluations.filter(
      (item: { id: string; recordId: string }) => item.recordId === recordId && !previousIds.has(item.id),
    ).length).toBe(1);
    const result = (await workspace()).evaluations.find(
      (item: { id: string; recordId: string }) => item.recordId === recordId && !previousIds.has(item.id),
    );
    expect(result.checklist).toEqual(rules);
    expect(result.results.map((item: { criterionId: string }) => item.criterionId).sort())
      .toEqual(rules.criteria.map((item: { id: string }) => item.id).sort());
    expect(result.total).toBe(expectedTotal(rules.criteria));
    await expect(page.locator(".criterion-result")).toHaveCount(rules.criteria.length);
    await expect(page.locator(".score-number")).toContainText(result.total.toFixed(2).replace(".", ","));
    return result;
  };
  const original = await run(checklist);
  await page.getByRole("button", { name: "Чек-листы", exact: true }).click();
  await page.getByRole("button", { name: "Добавить критерий", exact: true }).click();
  await page.getByLabel("Название критерия", { exact: true }).fill("Проверка понимания — тест");
  await page.getByLabel("Что нужно проверить", { exact: true }).fill("Оператор уточняет, понятен ли клиенту следующий шаг.");
  await page.getByLabel("Вес критерия", { exact: true }).fill("25");
  const save = page.getByRole("button", { name: "Сохранить чек-лист", exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  const added = (await workspace()).checklists.find((item: { id: string }) => item.id === checklist.id);
  expect(added.version).toBe(checklist.version + 1);
  const criterion = added.criteria.find((r: { name: string }) => r.name === "Проверка понимания — тест");
  expect(criterion.weight).toBe(25);
  await page.goto(dialogUrl);
  await expect(page.locator(".checklist-next-run")).toContainText(`v${added.version}`);
  await expect(page.locator(".checklist-next-run li").filter({ hasText: criterion.name })).toContainText("Вес 25");
  const withAdded = await run(added);
  await expect(page.locator(".criterion-result").filter({ hasText: criterion.name })).toContainText("Вес 25");

  await page.getByRole("button", { name: "Чек-листы", exact: true }).click();
  await page.getByRole("button", { name: /Проверка понимания — тест/ }).click();
  await page.getByRole("button", { name: "Удалить критерий", exact: true }).click();
  await page.getByRole("button", { name: "Удалить критерий", exact: true }).click();
  await save.click();
  await expect(save).toBeDisabled();
  const removed = (await workspace()).checklists.find((item: { id: string }) => item.id === checklist.id);
  expect(removed.version).toBe(added.version + 1);
  expect(removed.criteria).toEqual(checklist.criteria);
  await page.goto(dialogUrl);
  await expect(page.locator(".checklist-next-run li").filter({ hasText: criterion.name })).toHaveCount(0);
  await run(removed);
  await expect(page.locator(".criterion-result").filter({ hasText: criterion.name })).toHaveCount(0);

  // History must render its saved rubric, not the current editor configuration.
  await page.goto(`${dialogUrl}?evaluation=${encodeURIComponent(withAdded.id)}`);
  await expect(page.locator(".criterion-result")).toHaveCount(added.criteria.length);
  await expect(page.locator(".criterion-result").filter({ hasText: criterion.name })).toContainText("Вес 25");
  await page.reload();
  await expect(page.locator(".criterion-result").filter({ hasText: criterion.name })).toContainText("Вес 25");
  const final = await workspace();
  expect(final.evaluations.find((item: { id: string }) => item.id === original.id)).toEqual(original);
  expect(final.evaluations.find((item: { id: string }) => item.id === withAdded.id)).toEqual(withAdded);
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
  await page.getByRole("button", { name: "Скачать JSON этого диалога", exact: true }).click();
  const exported = JSON.parse(await readFile((await (await event).path())!, "utf8"));
  expect(exported.conversation_id).toBe(originalId);
  expect(exported.dataset_group_id).toBe("CONTROL-JSON");
  expect(exported.results).toHaveLength(8);
  expect(exported.source_kind).toBe("server");
});

test("official dataset JSON export is explicit, preserves server errors and never starts evaluation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "enabled-fixture", "Synthetic export only");
  const evaluationRequests: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/evaluations") evaluationRequests.push(request.url());
  });
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Официальный JSON всего набора", exact: true });
  await expect(panel.getByLabel("Название команды", { exact: true })).toHaveValue("Amazing Guys");
  await panel.getByRole("button", { name: "Скачать официальный JSON набора", exact: true }).click();
  await expect(panel.getByRole("alert")).toBeVisible(); // Real fixture has fewer than65; no fabricated successful export.
  await page.route("**/api/exports/submission", route => route.fulfill({ status: 422, json: { code: "SUBMISSION_INVALID", message: "Последняя оценка использует изменённый чек-лист." } }));
  await panel.getByRole("button", { name: "Скачать официальный JSON набора", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("Последняя оценка использует изменённый чек-лист.");
  await page.unroute("**/api/exports/submission");
  let payload: unknown;
  const document = { schema_version: "1.0", team_name: "Synthetic Team", model: { mode: "local", name: "synthetic" }, results: Array.from({ length: 10 }, (_, i) => ({ conversation_id: `synthetic-${i}`, status: "error", criteria: [], score: null, error: "Synthetic missing assessment" })) };
  await page.route("**/api/exports/submission", route => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: document });
  });
  await panel.locator("#submission-count").selectOption("10");
  await panel.getByLabel("Название команды", { exact: true }).fill("Synthetic Team");
  const groupId = await panel.locator("#submission-group").inputValue();
  const event = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Скачать официальный JSON набора", exact: true }).click();
  const download = await event;
  expect(download.suggestedFilename()).toBe("results.json");
  expect(JSON.parse(await readFile((await download.path())!, "utf8"))).toEqual(document);
  expect(payload).toEqual({ groupId, teamName: "Synthetic Team", expectedCount: 10 });
  expect(evaluationRequests).toEqual([]);
});
