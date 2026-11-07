#!/usr/bin/env python3
"""Prepare local, read-only Excel preview data; never create backend evaluations.

Requires Python 3.10+ and openpyxl. Defaults are resolved from the frontend
project, independently of the current working directory. Workbook cells and
conversation text are never printed.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile


PROJECT = Path(__file__).resolve().parents[1]
EXPECTED_RECORDS = 65
NA_CRITERIA = {2, 3, 4, 7}
SCALES = {4: {0, 5, 10, 15, 20}, 6: {0, 4, 7, 10}}
NEUTRAL_EXPLANATION = "Сохранённое значение из Excel."


class ValidationError(Exception):
    """Safe diagnostic containing locations/counts, never source cell values."""


def dataset_ids(path: Path) -> set[str]:
    with path.open(encoding="utf-8") as source:
        payload = json.load(source)
    data = payload.get("data") if isinstance(payload, dict) else None
    records = data.get("records") if isinstance(data, dict) else None
    if not isinstance(records, list) or len(records) != EXPECTED_RECORDS:
        raise ValidationError("Набор должен содержать ровно 65 записей data.records.")
    if data.get("total_records") != EXPECTED_RECORDS:
        raise ValidationError("Счётчик data.total_records должен равняться 65.")
    ids: set[str] = set()
    for index, record in enumerate(records, start=1):
        identifier = record.get("conversation_id") if isinstance(record, dict) else None
        if not isinstance(identifier, str) or not identifier.strip():
            raise ValidationError(f"Запись набора {index}: отсутствует conversation_id.")
        if identifier != identifier.strip() or identifier in ids:
            raise ValidationError(f"Запись набора {index}: некорректный или повторный ID.")
        ids.add(identifier)
    return ids


def parse_answer(value: object, criterion: int, location: str) -> bool | int | None:
    if isinstance(value, str):
        normalized = value.strip().casefold()
        if normalized == "n/a":
            if criterion not in NA_CRITERIA:
                raise ValidationError(f"{location}: N/A недопустимо для c{criterion}.")
            return None
        if normalized in {"true", "false"}:
            value = normalized == "true"
        elif re.fullmatch(r"[0-9]+(?:\.0+)?", normalized):
            value = float(normalized)

    if criterion in SCALES:
        if (
            type(value) not in (int, float)
            or not math.isfinite(value)
            or value not in SCALES[criterion]
        ):
            raise ValidationError(f"{location}: недопустимое значение шкалы c{criterion}.")
        return int(value)
    if type(value) is not bool:
        raise ValidationError(f"{location}: c{criterion} требует true или false.")
    return value


def clean_explanation(value: object, location: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{location}: отсутствует текст объяснения.")
    text = value.strip()
    if re.match(r"^СПОРНО\b", text, flags=re.IGNORECASE):
        proposed = re.search(r"\bПредлагается\b", text, flags=re.IGNORECASE)
        if not proposed:
            return NEUTRAL_EXPLANATION
        text = text[proposed.end():].lstrip(" \t\r\n:;,.—–-")
        # The answer is already read from its dedicated cell. Only keep the
        # explanation after the proposed answer, not the internal review prefix.
        text = re.sub(
            r"^(?:true|false|N/A|[0-9]+(?:[.,][0-9]+)?)(?=\s|[:;,.—–-]|$)",
            "",
            text,
            count=1,
            flags=re.IGNORECASE,
        ).lstrip(" \t\r\n:;,.—–-")
        if not text or re.search(r"\bСПОРНО\b", text, flags=re.IGNORECASE):
            return NEUTRAL_EXPLANATION
    return text


def read_annotations(workbook: Path, expected_ids: set[str]) -> dict:
    try:
        import openpyxl
    except ImportError as error:
        raise ValidationError(
            "Нужен openpyxl: установите его в используемое Python-окружение."
        ) from error

    result = {}
    book = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    try:
        # Never read the internal «Спорные» sheet or transcript sheets.
        sheets = [sheet for sheet in book if sheet.title.startswith("Разметка")]
        if not sheets:
            raise ValidationError("Не найдено ни одного листа Разметка*.")
        for sheet_index, sheet in enumerate(sheets, start=1):
            header = next(sheet.iter_rows(min_row=6, max_row=6, max_col=20, values_only=True))
            if str(header[0]).strip().casefold() != "id":
                raise ValidationError(f"Лист разметки {sheet_index}: ожидается ID в A6.")
            for criterion in range(1, 9):
                answer_col = 4 + (criterion - 1) * 2
                for offset in (0, 1):
                    label = header[answer_col + offset]
                    if not isinstance(label, str) or not re.match(
                        rf"^c{criterion}\s+", label.strip(), flags=re.IGNORECASE
                    ):
                        raise ValidationError(
                            f"Лист разметки {sheet_index}: неверный заголовок c{criterion} в строке 6."
                        )
                if "почему" not in header[answer_col + 1].casefold():
                    raise ValidationError(
                        f"Лист разметки {sheet_index}: нарушен порядок ответа/объяснения c{criterion}."
                    )
            for row_number, row in enumerate(
                sheet.iter_rows(min_row=7, max_col=20, values_only=True), start=7
            ):
                if all(value is None or value == "" for value in row):
                    continue
                location = f"Лист разметки {sheet_index}, строка {row_number}"
                identifier = row[0].strip() if isinstance(row[0], str) else None
                if identifier not in expected_ids:
                    raise ValidationError(f"{location}: ID отсутствует в наборе.")
                if identifier in result:
                    raise ValidationError(f"{location}: повторный ID.")
                answers, explanations = [], []
                for criterion in range(1, 9):
                    column = 4 + (criterion - 1) * 2
                    answers.append(parse_answer(row[column], criterion, location))
                    explanations.append(clean_explanation(row[column + 1], location))
                result[identifier] = {"answers": answers, "explanations": explanations}
    finally:
        book.close()
    missing = expected_ids - result.keys()
    if missing:
        raise ValidationError(f"В разметке отсутствует записей: {len(missing)}.")
    return result


def write_atomic(output: Path, annotations: dict) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=output.parent,
            prefix=f".{output.name}.", suffix=".tmp", delete=False,
        ) as stream:
            temporary = Path(stream.name)
            json.dump(annotations, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path, help="Исходная книга XLSX (только чтение).")
    parser.add_argument("--dataset", type=Path, default=PROJECT / "../dev.json")
    parser.add_argument("--output", type=Path, default=PROJECT / "../.local/reference/annotations.json")
    args = parser.parse_args()
    try:
        workbook, dataset, output = (path.resolve() for path in (args.workbook, args.dataset, args.output))
        if output in {workbook, dataset}:
            raise ValidationError("Выходной файл не может совпадать с исходным файлом.")
        annotations = read_annotations(workbook, dataset_ids(dataset))
        write_atomic(output, annotations)
    except ValidationError as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError):
        print("Ошибка: не удалось прочитать входные файлы или сохранить JSON.", file=sys.stderr)
        return 1
    except Exception:
        # Third-party parser exceptions can embed private cell/XML contents.
        print("Ошибка: неподдерживаемая или повреждённая структура XLSX.", file=sys.stderr)
        return 1
    print(f"Готово: проверены и сохранены {len(annotations)} записей, по 8 критериев.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
