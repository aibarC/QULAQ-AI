import { expect, test, type Page } from "@playwright/test";

const dataset = {
  isSuccess: true,
  data: {
    dataset_group_id: "DEV", total_records: 4,
    records: [["ru-2", "RU"], ["kz-1", "KZ"], ["en-1", "EN"], ["ru-1", "RU"]].map(([conversation_id, language]) => ({
      conversation_id, language, channel: "agent chat", audio_url: null,
      transcript: [{ speaker: "client", timestamp: "00:00", text: "Синтетический диалог для проверки интерфейса." }],
    })),
  },
};

async function open(page: Page) {
  await page.route("**/__local/annotations", route => route.fulfill({ json: {} }));
  await page.route("**/__local/dataset", route => route.fulfill({ json: dataset }));
  await page.goto("/");
  await expect(page.locator(".conversation-row")).toHaveCount(4);
}

for (const width of [1440, 390]) {
  test(`${width}px language groups collapse independently and restore rows using the keyboard`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page);
    const ru = page.getByRole("rowgroup", { name: "Русский · RU", exact: true });
    const kz = page.getByRole("rowgroup", { name: "Қазақша · KZ", exact: true });
    const collapse = page.getByRole("button", { name: "Свернуть RU", exact: true });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    const heightBefore = (await page.locator(".dialog-table").boundingBox())!.height;
    await collapse.click();
    await expect(ru.locator(".conversation-row").first()).toBeHidden();
    await expect(ru.locator(".conversation-row").first()).toHaveAttribute("inert");
    await expect.poll(async () => (await page.locator(".dialog-table").boundingBox())!.height).toBeLessThan(heightBefore - 100);
    await expect(kz.locator(".conversation-row")).toHaveCount(1);
    await expect(page.locator(".conversation-row:visible")).toHaveCount(2);
    const expand = page.getByRole("button", { name: "Развернуть RU", exact: true });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expand.focus();
    await expand.press("Enter");
    await expect(ru.locator(".conversation-row").first()).toBeVisible();
    await expect(ru.locator(".conversation-row").first()).not.toHaveAttribute("inert");
    await expect(ru.locator(".row-link")).toHaveText(["ru-1", "ru-2"]);
    await expect(page.locator(".conversation-row")).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  test(`${width}px upload previews TXT and dropped JSON, rejects bad files, and clears without analysis`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page);
    const upload = page.getByRole("region", { name: "Загрузка транскрипта", exact: true });
    const preview = page.getByRole("region", { name: "Предпросмотр загруженного транскрипта", exact: true });
    const outgoing: string[] = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/api/") || request.method() !== "GET") outgoing.push(request.url());
    });
    await expect(upload.getByRole("button", { name: "Анализировать", exact: true })).toBeDisabled();
    await upload.getByRole("combobox", { name: "Язык TXT", exact: true }).selectOption("KZ");
    const chooserEvent = page.waitForEvent("filechooser");
    await upload.getByRole("button", { name: "Выбрать файл", exact: true }).click();
    const chooser = await chooserEvent;
    const text = "Клиент: Сәлем!\nОператор: Сәлеметсіз бе!\n<script>window.uploaded = true</script>";
    await chooser.setFiles({ name: "synthetic-chat.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
    await expect(upload).toHaveAttribute("aria-busy", "true");
    await expect(upload.getByRole("button", { name: "Читаем файл…", exact: true })).toBeVisible();
    await expect(preview.locator(".upload-text-preview")).toHaveText(text);
    await expect(preview).toContainText("Исходный текст · KZ");
    await expect(preview.locator(".upload-message-time")).toHaveCount(0);
    expect(await page.evaluate(() => "uploaded" in window)).toBe(false);
    await upload.getByRole("button", { name: "Свернуть предпросмотр", exact: true }).click();
    await expect(preview).toHaveCount(0);
    await upload.getByRole("button", { name: "Показать предпросмотр", exact: true }).click();
    await expect(preview.locator(".upload-text-preview")).toHaveText(text);

    const input = upload.getByLabel("Файл транскрипта", { exact: true });
    for (const invalid of [
      { name: "unsupported.pdf", buffer: Buffer.from("example"), error: "Поддерживаются только файлы .txt и .json" },
      { name: "broken.json", buffer: Buffer.from("{"), error: "Не удалось прочитать JSON" },
      { name: "empty.txt", buffer: Buffer.from("   "), error: "Файл пуст" },
      { name: "large.txt", buffer: Buffer.alloc(5 * 1024 * 1024 + 1, "a"), error: "Файл слишком большой" },
    ]) {
      await input.setInputFiles({ name: invalid.name, mimeType: "application/octet-stream", buffer: invalid.buffer });
      await expect(upload.getByRole("alert")).toContainText(invalid.error);
      await expect(preview.locator(".upload-text-preview")).toHaveText(text);
    }

    const json = JSON.stringify({ isSuccess: true, data: { dataset_group_id: "upload-test", total_records: 1, records: [{
      conversation_id: "uploaded-1", language: "EN", channel: "agent chat", audio_url: null,
      transcript: [{ speaker: "operator", timestamp: "02:13", text: "Synthetic uploaded JSON message." }],
    }] } });
    const transfer = await page.evaluateHandle(value => {
      const data = new DataTransfer();
      data.items.add(new File([value], "synthetic-chat.json", { type: "application/json" }));
      return data;
    }, json);
    await upload.locator(".upload-dropzone").dispatchEvent("drop", { dataTransfer: transfer });
    await transfer.dispose();
    await expect(upload.getByRole("alert")).toHaveCount(0);
    await expect(preview.getByText("Synthetic uploaded JSON message.", { exact: true })).toBeVisible();
    await expect(preview.locator(".upload-message-time")).toHaveText("02:13");
    await expect(upload.getByRole("combobox", { name: "Язык TXT", exact: true })).toHaveCount(0);
    await expect(upload.getByRole("button", { name: "Анализировать", exact: true })).toBeDisabled();
    await expect(page.locator(".score-card")).toHaveCount(0);
    await expect(page.locator(".conversation-row")).toHaveCount(4);
    expect(outgoing).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`upload-${width}.png`), animations: "disabled" });
    if (width === 1440) await page.screenshot({ path: "/tmp/qulaq-upload.png", animations: "disabled" });
    await upload.getByRole("button", { name: "Удалить файл", exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect(upload.getByText("synthetic-chat.json", { exact: true })).toHaveCount(0);
    await expect(upload.getByRole("button", { name: "Выбрать файл", exact: true })).toBeEnabled();
  });
}
