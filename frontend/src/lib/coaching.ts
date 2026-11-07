import type { Answer, Criterion } from "./types";

/** Shared issue direction for coaching visibility; N/A and invalid answers are not issues. */
export function isCriterionIssue(criterion: Criterion, answer: Answer): boolean {
  if (answer === null) return false;
  if (criterion.type === "scale") {
    if (typeof answer !== "number" || !Number.isFinite(answer) || !criterion.scale.some((option) => option.value === answer)) return false;
    const maximum = Math.max(...criterion.scale.map((option) => option.value));
    return Number.isFinite(maximum) && answer < maximum;
  }
  return criterion.type === "flag" ? answer === true : answer === false;
}
