import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ClipboardCheck,
  Copy,
  FilePlus2,
  LoaderCircle,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { Checklist, Criterion } from "../lib/types";

type Props = {
  checklists: Checklist[];
  onSave: (checklist: Checklist) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};
type Errors = Record<string, string>;
const clone = <T,>(value: T): T => structuredClone(value);
const serialize = (value: Checklist | null) => JSON.stringify(value);
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const freshCriterion = (): Criterion => ({
  id: uid("criterion"),
  name: "",
  description: "",
  type: "boolean",
  weight: 10,
  allowNA: false,
  naCondition: "",
  scale: [],
});
const freshChecklist = (): Checklist => ({
  id: uid("checklist"),
  name: "",
  version: 0,
  criteria: [freshCriterion()],
});
const answerNames = {
  boolean: "Да / Нет",
  scale: "Числовая шкала",
  flag: "Грубое нарушение",
};

function validate(draft: Checklist): Errors {
  const errors: Errors = {};
  if (!draft.name.trim()) errors.name = "Введите название чек-листа.";
  if (draft.name.trim().length > 120) errors.name = "Не больше 120 символов.";
  if (!draft.criteria.length)
    errors.criteria = "Добавьте хотя бы один критерий.";
  draft.criteria.forEach((criterion) => {
    const key = criterion.id;
    if (!criterion.name.trim())
      errors[`${key}.name`] = "Введите название критерия.";
    if (!criterion.description.trim())
      errors[`${key}.description`] = "Опишите, что нужно проверить в диалоге.";
    if (
      criterion.type !== "flag" &&
      (!Number.isFinite(criterion.weight) ||
        criterion.weight <= 0 ||
        criterion.weight > 100)
    )
      errors[`${key}.weight`] = "Укажите вес больше 0 и не больше 100.";
    if (criterion.allowNA && !criterion.naCondition.trim())
      errors[`${key}.naCondition`] = "Укажите, когда критерий неприменим.";
    if (criterion.type === "scale") {
      if (criterion.scale.length < 2)
        errors[`${key}.scale`] = "Нужны хотя бы две ступени шкалы.";
      else if (
        criterion.scale.some(
          (step) => !Number.isFinite(step.value) || step.value < 0,
        )
      )
        errors[`${key}.scale`] =
          "Значения шкалы должны быть неотрицательными числами.";
      else if (
        new Set(criterion.scale.map((step) => step.value)).size !==
        criterion.scale.length
      )
        errors[`${key}.scale`] = "У каждой ступени должно быть своё значение.";
      else if (Math.max(...criterion.scale.map((step) => step.value)) <= 0)
        errors[`${key}.scale`] = "Максимум шкалы должен быть больше 0.";
      else if (criterion.scale.some((step) => !step.label.trim()))
        errors[`${key}.scale`] = "Добавьте описание каждой ступени.";
    }
  });
  return errors;
}

export default function ChecklistEditor({
  checklists,
  onSave,
  onDirtyChange,
}: Props) {
  const [draft, setDraft] = useState<Checklist | null>(() =>
    checklists[0] ? clone(checklists[0]) : null,
  );
  const [baseline, setBaseline] = useState(() =>
    serialize(checklists[0] ?? null),
  );
  const [expanded, setExpanded] = useState<string | null>(
    checklists[0]?.criteria[0]?.id ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState("");
  const [pendingSelection, setPendingSelection] = useState<Checklist | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const dirty = serialize(draft) !== baseline;
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;

  useEffect(() => {
    dirtyCallback.current?.(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      dirtyCallback.current?.(false);
    },
    [],
  );
  useEffect(() => {
    if (dirty || saving) return;
    const current = draft
      ? checklists.find((item) => item.id === draft.id)
      : checklists[0];
    if (current && serialize(current) !== baseline) {
      setDraft(clone(current));
      setBaseline(serialize(current));
      if (!draft) setExpanded(current.criteria[0]?.id ?? null);
    }
  }, [checklists, dirty, saving, draft, baseline]);

  function applySelection(next: Checklist) {
    setDraft(clone(next));
    setBaseline(next.version === 0 ? "null" : serialize(next));
    setExpanded(next.criteria[0]?.id ?? null);
    setPendingSelection(null);
    setPendingDelete(null);
    setErrors({});
    setServerError("");
    setSaved(false);
  }
  function select(next: Checklist) {
    if (saving) return;
    if (dirty) setPendingSelection(next);
    else applySelection(next);
  }
  function patch(patch: Partial<Checklist>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setSaved(false);
    setServerError("");
  }
  function updateCriterion(id: string, patchValue: Partial<Criterion>) {
    if (!draft) return;
    patch({
      criteria: draft.criteria.map((criterion) =>
        criterion.id === id ? { ...criterion, ...patchValue } : criterion,
      ),
    });
    setErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`${id}.`)),
      ),
    );
  }
  function addCriterion() {
    if (!draft) return;
    const criterion = freshCriterion();
    patch({ criteria: [...draft.criteria, criterion] });
    setExpanded(criterion.id);
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const nextErrors = validate(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const invalidCriterion = draft.criteria.find((criterion) =>
        Object.keys(nextErrors).some((key) =>
          key.startsWith(`${criterion.id}.`),
        ),
      );
      if (invalidCriterion) setExpanded(invalidCriterion.id);
      requestAnimationFrame(() =>
        editorRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    const normalized: Checklist = {
      ...draft,
      name: draft.name.trim(),
      criteria: draft.criteria.map((criterion) => ({
        ...criterion,
        name: criterion.name.trim(),
        description: criterion.description.trim(),
        weight: criterion.type === "flag" ? 0 : criterion.weight,
        naCondition: criterion.allowNA ? criterion.naCondition.trim() : "",
        scale:
          criterion.type === "scale"
            ? criterion.scale
                .map((step) => ({ ...step, label: step.label.trim() }))
                .sort((a, b) => a.value - b.value)
            : [],
      })),
    };
    setSaving(true);
    setServerError("");
    try {
      await onSave(normalized);
      setDraft(normalized);
      setBaseline(serialize(normalized));
      setSaved(true);
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить чек-лист. Изменения остались в форме.",
      );
    } finally {
      setSaving(false);
    }
  }
  function errorText(key: string) {
    return errors[key] ? (
      <span className="field-error" id={`error-${key}`}>
        {errors[key]}
      </span>
    ) : null;
  }

  return (
    <div className="checklist-layout">
      <aside
        className="checklist-library panel"
        aria-label="Сохранённые чек-листы"
      >
        <div className="checklist-library-header">
          <ClipboardCheck size={19} />
          <h2>Библиотека правил</h2>
          <span className="badge">{checklists.length}</span>
        </div>
        <p className="muted">Единые критерии для каждого диалога.</p>
        <div className="checklist-library-list">
          {checklists.map((checklist) => (
            <button
              type="button"
              className={`checklist-library-item ${draft?.id === checklist.id ? "active" : ""}`}
              key={checklist.id}
              disabled={saving}
              aria-pressed={draft?.id === checklist.id}
              onClick={() => {
                if (draft?.id !== checklist.id) select(checklist);
              }}
            >
              <ClipboardCheck size={19} />
              <span>
                <strong>{checklist.name}</strong>
                <small>
                  {checklist.criteria.length} критериев · Версия{" "}
                  {checklist.version}
                </small>
              </span>
              <ChevronDown size={15} className="library-arrow" />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="button secondary checklist-new"
          disabled={saving}
          onClick={() => select(freshChecklist())}
        >
          <FilePlus2 size={17} />
          Новый чек-лист
        </button>
        <div className="checklist-library-note">
          <ShieldAlert size={18} />
          <p>
            Изменения применятся к новым оценкам. Предыдущие результаты сохранят
            свою версию правил.
          </p>
        </div>
      </aside>

      <div className="checklist-editor panel" ref={editorRef}>
        {pendingSelection && (
          <div className="inline-confirm" role="alert">
            <div>
              <strong>Есть несохранённые изменения</strong>
              <p>
                Перейти к другому чек-листу и отменить изменения в этой форме?
              </p>
            </div>
            <div className="inline-actions">
              <button
                type="button"
                className="button secondary small"
                onClick={() => setPendingSelection(null)}
              >
                Продолжить редактирование
              </button>
              <button
                type="button"
                className="button danger small"
                onClick={() => applySelection(pendingSelection)}
              >
                Отменить изменения
              </button>
            </div>
          </div>
        )}
        {!draft ? (
          <div className="empty-state">
            <ClipboardCheck size={38} />
            <h2>Создайте первый чек-лист</h2>
            <p>Опишите критерии, по которым нужно оценивать разговоры.</p>
            <button
              type="button"
              className="button primary"
              onClick={() => applySelection(freshChecklist())}
            >
              <Plus size={17} />
              Создать чек-лист
            </button>
          </div>
        ) : (
          <form onSubmit={save} noValidate>
            <fieldset disabled={saving} className="checklist-fieldset">
              <div className="checklist-editor-heading">
                <div>
                  <span className="badge">
                    {draft.version > 0
                      ? `Версия ${draft.version}`
                      : "Новый чек-лист"}
                  </span>
                  <h2>Настройка оценки</h2>
                  <p className="muted">
                    Определите, что означает качественный диалог.
                  </p>
                </div>
                <button
                  type="button"
                  className="button ghost small"
                  title="Создать копию чек-листа"
                  onClick={() =>
                    select({
                      ...clone(draft),
                      id: uid("checklist"),
                      name: `${draft.name || "Чек-лист"} — копия`,
                      version: 0,
                      criteria: draft.criteria.map((criterion) => ({
                        ...clone(criterion),
                        id: uid("criterion"),
                      })),
                    })
                  }
                >
                  <Copy size={16} />
                  Создать копию
                </button>
              </div>
              <label className="field checklist-name">
                Название чек-листа
                <input
                  className="input"
                  value={draft.name}
                  maxLength={120}
                  placeholder="Например, стандарт качества поддержки"
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "error-name" : undefined}
                  onChange={(event) => {
                    patch({ name: event.target.value });
                    setErrors((current) => ({ ...current, name: "" }));
                  }}
                />
                {errorText("name")}
              </label>
              <div className="checklist-summary">
                <div>
                  <h3>Критерии оценки</h3>
                  <span className="muted">
                    {draft.criteria.length} критериев
                  </span>
                </div>
                <span className="badge">
                  Вес критериев:{" "}
                  {draft.criteria
                    .filter((criterion) => criterion.type !== "flag")
                    .reduce(
                      (sum, criterion) =>
                        sum +
                        (Number.isFinite(criterion.weight)
                          ? criterion.weight
                          : 0),
                      0,
                    )}
                </span>
              </div>
              <p className="checklist-change-note">
                Сохраните изменения перед новым анализом. Добавленные и удалённые критерии,
                правила и веса применятся к следующему запуску выбранного чек-листа.
                Прошлые результаты не изменятся. Сумма весов может отличаться от 100:
                итог нормируется по применимым критериям.
              </p>
              {errors.criteria && (
                <div className="error-box" role="alert">
                  <AlertCircle size={17} />
                  {errors.criteria}
                </div>
              )}
              <div className="criteria-list">
                {draft.criteria.map((criterion, index) => {
                  const isExpanded = expanded === criterion.id;
                  const invalid = Object.keys(errors).some(
                    (key) => key.startsWith(`${criterion.id}.`) && errors[key],
                  );
                  return (
                    <section
                      className={`criterion-card ${isExpanded ? "expanded" : ""} ${invalid ? "invalid" : ""}`}
                      key={criterion.id}
                    >
                      <button
                        type="button"
                        className="criterion-toggle"
                        aria-expanded={isExpanded}
                        aria-controls={`fields-${criterion.id}`}
                        onClick={() =>
                          setExpanded(isExpanded ? null : criterion.id)
                        }
                      >
                        <span
                          className={`criterion-number ${criterion.type === "flag" ? "flag" : ""}`}
                        >
                          {criterion.type === "flag" ? (
                            <ShieldAlert size={18} />
                          ) : (
                            String(index + 1).padStart(2, "0")
                          )}
                        </span>
                        <span className="criterion-heading">
                          <strong>{criterion.name || "Новый критерий"}</strong>
                          <span className="criterion-meta">
                            {answerNames[criterion.type]}
                            {criterion.allowNA ? " · Допускается N/A" : ""}
                          </span>
                        </span>
                        <span className="criterion-weight">
                          {criterion.type === "flag"
                            ? "Без баллов"
                            : `${Number.isFinite(criterion.weight) ? criterion.weight : "—"} баллов`}
                        </span>
                        {invalid && (
                          <AlertCircle size={16} className="field-error-icon" />
                        )}
                        <ChevronDown size={18} className="criterion-chevron" />
                      </button>
                      {isExpanded && (
                        <div
                          className="criterion-fields"
                          id={`fields-${criterion.id}`}
                        >
                          <label className="field">
                            Название критерия
                            <input
                              className="input"
                              value={criterion.name}
                              maxLength={160}
                              placeholder="Например, выявление потребности"
                              aria-invalid={Boolean(
                                errors[`${criterion.id}.name`],
                              )}
                              aria-describedby={
                                errors[`${criterion.id}.name`]
                                  ? `error-${criterion.id}.name`
                                  : undefined
                              }
                              onChange={(event) =>
                                updateCriterion(criterion.id, {
                                  name: event.target.value,
                                })
                              }
                            />
                            {errorText(`${criterion.id}.name`)}
                          </label>
                          <label className="field">
                            Что нужно проверить
                            <textarea
                              className="textarea"
                              rows={3}
                              value={criterion.description}
                              maxLength={4000}
                              placeholder="Опишите правило и условия успешного выполнения"
                              aria-invalid={Boolean(
                                errors[`${criterion.id}.description`],
                              )}
                              aria-describedby={
                                errors[`${criterion.id}.description`]
                                  ? `error-${criterion.id}.description`
                                  : undefined
                              }
                              onChange={(event) =>
                                updateCriterion(criterion.id, {
                                  description: event.target.value,
                                })
                              }
                            />
                            {errorText(`${criterion.id}.description`)}
                          </label>
                          <div className="form-grid">
                            <label className="field">
                              Тип ответа
                              <select
                                className="select"
                                value={criterion.type}
                                onChange={(event) => {
                                  const type = event.target
                                    .value as Criterion["type"];
                                  updateCriterion(criterion.id, {
                                    type,
                                    weight:
                                      type === "flag"
                                        ? 0
                                        : criterion.weight || 10,
                                    scale:
                                      type === "scale"
                                        ? criterion.scale.length
                                          ? criterion.scale
                                          : [
                                              {
                                                value: 0,
                                                label: "Не выполнено",
                                              },
                                              {
                                                value: 10,
                                                label: "Выполнено полностью",
                                              },
                                            ]
                                        : [],
                                    allowNA:
                                      type === "flag"
                                        ? false
                                        : criterion.allowNA,
                                    naCondition:
                                      type === "flag"
                                        ? ""
                                        : criterion.naCondition,
                                  });
                                }}
                              >
                                <option value="boolean">Да / Нет</option>
                                <option value="scale">Числовая шкала</option>
                                <option value="flag">
                                  Грубое нарушение · без баллов
                                </option>
                              </select>
                            </label>
                            {criterion.type !== "flag" ? (
                              <label className="field">
                                Вес критерия
                                <input
                                  className="input"
                                  type="number"
                                  min="0.01"
                                  max="100"
                                  step="any"
                                  value={
                                    Number.isFinite(criterion.weight)
                                      ? criterion.weight
                                      : ""
                                  }
                                  aria-invalid={Boolean(
                                    errors[`${criterion.id}.weight`],
                                  )}
                                  aria-describedby={
                                    errors[`${criterion.id}.weight`]
                                      ? `error-${criterion.id}.weight`
                                      : undefined
                                  }
                                  onChange={(event) =>
                                    updateCriterion(criterion.id, {
                                      weight:
                                        event.target.value === ""
                                          ? NaN
                                          : Number(event.target.value),
                                    })
                                  }
                                />
                                {errorText(`${criterion.id}.weight`)}
                              </label>
                            ) : (
                              <div className="flag-explanation">
                                <ShieldAlert size={18} />
                                <span>
                                  Отдельный флаг. Не участвует в сумме баллов.
                                </span>
                              </div>
                            )}
                          </div>
                          {criterion.type === "scale" && (
                            <div className="scale-editor">
                              <div className="scale-heading">
                                <h4>Допустимые ступени</h4>
                                <button
                                  type="button"
                                  className="button ghost small"
                                  onClick={() =>
                                    updateCriterion(criterion.id, {
                                      scale: [
                                        ...criterion.scale,
                                        {
                                          value:
                                            Math.max(
                                              0,
                                              ...criterion.scale.map((step) =>
                                                Number.isFinite(step.value)
                                                  ? step.value
                                                  : 0,
                                              ),
                                            ) + 5,
                                          label: "",
                                        },
                                      ],
                                    })
                                  }
                                >
                                  <Plus size={15} />
                                  Добавить ступень
                                </button>
                              </div>
                              {criterion.scale.map((step, stepIndex) => (
                                <div className="scale-row" key={stepIndex}>
                                  <label className="field">
                                    <span className="sr-only">
                                      Значение ступени {stepIndex + 1}
                                    </span>
                                    <input
                                      className="input"
                                      type="number"
                                      min="0"
                                      step="any"
                                      value={
                                        Number.isFinite(step.value)
                                          ? step.value
                                          : ""
                                      }
                                      onChange={(event) =>
                                        updateCriterion(criterion.id, {
                                          scale: criterion.scale.map(
                                            (item, i) =>
                                              i === stepIndex
                                                ? {
                                                    ...item,
                                                    value:
                                                      event.target.value === ""
                                                        ? NaN
                                                        : Number(
                                                            event.target.value,
                                                          ),
                                                  }
                                                : item,
                                          ),
                                        })
                                      }
                                    />
                                  </label>
                                  <label className="field">
                                    <span className="sr-only">
                                      Описание ступени {stepIndex + 1}
                                    </span>
                                    <input
                                      className="input"
                                      placeholder="Описание значения"
                                      value={step.label}
                                      maxLength={500}
                                      onChange={(event) =>
                                        updateCriterion(criterion.id, {
                                          scale: criterion.scale.map(
                                            (item, i) =>
                                              i === stepIndex
                                                ? {
                                                    ...item,
                                                    label: event.target.value,
                                                  }
                                                : item,
                                          ),
                                        })
                                      }
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="button ghost small icon-button"
                                    aria-label={`Удалить ступень ${stepIndex + 1}`}
                                    onClick={() =>
                                      updateCriterion(criterion.id, {
                                        scale: criterion.scale.filter(
                                          (_, i) => i !== stepIndex,
                                        ),
                                      })
                                    }
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              ))}
                              {errorText(`${criterion.id}.scale`)}
                            </div>
                          )}
                          <label className="checkbox-field">
                            <input
                              type="checkbox"
                              checked={criterion.allowNA}
                              onChange={(event) =>
                                updateCriterion(criterion.id, {
                                  allowNA: event.target.checked,
                                })
                              }
                            />
                            <span>
                              <strong>Разрешить N/A</strong>
                              <small>
                                Критерий может не применяться к конкретному
                                разговору.
                              </small>
                            </span>
                          </label>
                          {criterion.allowNA && (
                            <label className="field">
                              Когда критерий неприменим
                              <textarea
                                className="textarea"
                                rows={2}
                                value={criterion.naCondition}
                                maxLength={2000}
                                placeholder="Например, идентификация не требуется для общего вопроса"
                                aria-invalid={Boolean(
                                  errors[`${criterion.id}.naCondition`],
                                )}
                                aria-describedby={
                                  errors[`${criterion.id}.naCondition`]
                                    ? `error-${criterion.id}.naCondition`
                                    : undefined
                                }
                                onChange={(event) =>
                                  updateCriterion(criterion.id, {
                                    naCondition: event.target.value,
                                  })
                                }
                              />
                              {errorText(`${criterion.id}.naCondition`)}
                            </label>
                          )}
                          <div className="criterion-footer">
                            {pendingDelete === criterion.id ? (
                              <div className="inline-confirm">
                                <span>Удалить критерий из этой версии?</span>
                                <div className="inline-actions">
                                  <button
                                    type="button"
                                    className="button secondary small"
                                    onClick={() => setPendingDelete(null)}
                                  >
                                    Отмена
                                  </button>
                                  <button
                                    type="button"
                                    className="button danger small"
                                    onClick={() => {
                                      patch({
                                        criteria: draft.criteria.filter(
                                          (item) => item.id !== criterion.id,
                                        ),
                                      });
                                      setPendingDelete(null);
                                      setExpanded(null);
                                    }}
                                  >
                                    Удалить критерий
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="button ghost small danger-text"
                                onClick={() => setPendingDelete(criterion.id)}
                              >
                                <Trash2 size={16} />
                                Удалить критерий
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
              <button
                type="button"
                className="button secondary add-criterion"
                onClick={addCriterion}
              >
                <Plus size={17} />
                Добавить критерий
              </button>
              {serverError && (
                <div className="error-box" role="alert">
                  <AlertCircle size={18} />
                  <span>{serverError}</span>
                </div>
              )}
              <div className="checklist-savebar">
                <div
                  className={`save-status ${dirty ? "dirty" : ""}`}
                  aria-live="polite"
                >
                  {saving ? (
                    <>
                      <LoaderCircle size={16} className="spin" />
                      Сохраняем чек-лист…
                    </>
                  ) : dirty ? (
                    <>
                      <span className="status-dot" />
                      Есть несохранённые изменения
                    </>
                  ) : saved ? (
                    <>
                      <Check size={17} />
                      Чек-лист сохранён · готов к следующей оценке
                    </>
                  ) : (
                    <>
                      <Check size={17} />
                      Все изменения сохранены
                    </>
                  )}
                </div>
                <button
                  className="button primary"
                  type="submit"
                  disabled={saving || !dirty}
                >
                  {saving ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <Save size={17} />
                  )}
                  {saving ? "Сохранение…" : "Сохранить чек-лист"}
                </button>
              </div>
            </fieldset>
          </form>
        )}
      </div>
    </div>
  );
}
