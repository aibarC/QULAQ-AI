import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { evaluationWorkbook } from "../src/lib/export-evaluation.ts";
import {
  demoConversation,
  defaultChecklist,
  makeDemoEvaluation,
} from "../src/lib/fixtures.ts";
test("XLSX preserves server totals, criterion points and timestamps without internal review sheets or formulas", async () => {
  const conversation = structuredClone(demoConversation);
  conversation.messages[0].text =
    '=HYPERLINK("https://invalid.example","test")';
  const evaluation = makeDemoEvaluation(defaultChecklist);
  evaluation.total = 71.23;
  evaluation.originalTotal = 68.45;
  evaluation.demo = false;
  const bytes = await evaluationWorkbook(conversation, evaluation);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  assert.deepEqual(
    workbook.worksheets.map((s) => s.name),
    ["Результат", "Баллы по критериям", "Транскрипт"],
  );
  assert.equal(workbook.getWorksheet("Результат")!.getCell("B9").value, 71.23);
  assert.equal(workbook.getWorksheet("Результат")!.getCell("B8").value, 68.45);
  assert.equal(workbook.getWorksheet("Баллы по критериям")!.rowCount, 9);
  assert.equal(
    workbook.getWorksheet("Транскрипт")!.getCell("B2").value,
    conversation.messages[0].timestamp,
  );
  assert.equal(
    workbook.getWorksheet("Транскрипт")!.getCell("D2").value,
    conversation.messages[0].text,
  );
  assert.equal(
    workbook.getWorksheet("Транскрипт")!.getCell("D2").type,
    ExcelJS.ValueType.String,
  );
});

test("XLSX exports the saved custom criteria and excludes deleted rules", async () => {
  const evaluation = makeDemoEvaluation(defaultChecklist);
  const custom = { ...structuredClone(evaluation.checklist.criteria[0]), id: "custom-rule", name: "Новое правило", weight: 25 };
  const removedName = evaluation.checklist.criteria[1].name;
  evaluation.checklist.criteria = [custom];
  evaluation.checklist.version = 3;
  evaluation.results = [{ ...structuredClone(evaluation.results[0]), criterionId: custom.id, answer: false, originalAnswer: false, points: 0 }];
  evaluation.total = 0;
  evaluation.originalTotal = 0;
  const bytes = await evaluationWorkbook(demoConversation, evaluation);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never);
  const sheet = book.getWorksheet("Баллы по критериям")!;
  assert.equal(sheet.rowCount, 2);
  const cells = JSON.stringify(sheet.getRow(2).values);
  assert.ok(cells.includes(custom.name));
  assert.ok(!cells.includes(removedName));
  assert.equal(book.getWorksheet("Результат")!.getCell("B9").value, 0);
});
