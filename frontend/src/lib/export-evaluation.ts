import type { Conversation, Evaluation } from "./types";

export async function evaluationWorkbook(
  conversation: Conversation,
  evaluation: Evaluation,
  source?: string,
): Promise<Uint8Array> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QULAQ";
  const summary = workbook.addWorksheet("Результат");
  summary.addRows([
    ["Диалог", conversation.externalId],
    ["Язык", conversation.language],
    [
      "Источник",
      source ??
        (evaluation.demo
          ? "Учебный пример — ИИ не запускался"
          : "Результат сервера"),
    ],
    ["Оценка ID", evaluation.id],
    [source ? "Время предпросмотра" : "Время оценки", evaluation.createdAt],
    ["Чек-лист", evaluation.checklist.name],
    ["Версия", evaluation.checklist.version],
    ["Исходный итог", evaluation.originalTotal],
    ["Финальный итог", evaluation.total],
    ["Грубые ошибки", evaluation.grossViolation ? "Да" : "Нет"],
  ]);
  summary.columns = [{ width: 25 }, { width: 70 }];
  const criteria = workbook.addWorksheet("Баллы по критериям");
  criteria.addRow([
    "Критерий",
    "Вес",
    "Ответ",
    "Баллы",
    "Обоснование",
    "Доказательства",
    "Причина N/A",
    "Решение проверяющего",
  ]);
  const answer = (value: boolean | number | null) =>
    value === null
      ? "N/A"
      : typeof value === "boolean"
        ? value
          ? "Да"
          : "Нет"
        : value;
  for (const criterion of evaluation.checklist.criteria) {
    const result = evaluation.results.find(
      (item) => item.criterionId === criterion.id,
    );
    criteria.addRow([
      criterion.name,
      criterion.weight,
      result ? answer(result.answer) : "Нет результата",
      result?.points ?? null,
      result?.explanation ?? "",
      result?.evidence
        .map((ev) => `${ev.messageIds.join(", ")}: ${ev.quote}`)
        .join("\n") ?? "",
      result?.naReason ?? "",
      result?.override?.reason ?? "",
    ]);
  }
  criteria.columns = [24, 10, 12, 12, 65, 65, 40, 40].map((width) => ({
    width,
  }));
  criteria.views = [{ state: "frozen", ySplit: 1 }];
  criteria.autoFilter = "A1:H1";
  const transcript = workbook.addWorksheet("Транскрипт");
  transcript.addRow(["ID реплики", "Время", "Участник", "Текст"]);
  for (const message of conversation.messages)
    transcript.addRow([
      message.id,
      message.timestamp,
      message.speaker,
      message.text,
    ]);
  transcript.columns = [25, 28, 16, 100].map((width) => ({ width }));
  transcript.views = [{ state: "frozen", ySplit: 1 }];
  transcript.autoFilter = "A1:D1";
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.alignment = { vertical: "top", wrapText: true };
        cell.font = { name: "Calibri", size: 11 };
      });
    });
    if (sheet !== summary) {
      sheet.getRow(1).font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
        name: "Calibri",
        size: 11,
      };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF6955D8" },
      };
      sheet.getRow(1).height = 30;
    }
  }
  summary.getCell("B8").numFmt = "0.00";
  summary.getCell("B9").numFmt = "0.00";
  criteria.getColumn(4).numFmt = "0.00";
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function downloadEvaluation(
  conversation: Conversation,
  evaluation: Evaluation,
  source?: string,
) {
  const bytes = await evaluationWorkbook(conversation, evaluation, source);
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `QULAQ_${conversation.externalId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${evaluation.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
