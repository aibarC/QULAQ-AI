import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Checklist, Conversation, Evaluation, Criterion } from "../../frontend/src/lib/types.ts";
import { initialChecklist } from "./scoring.ts";

export const TWO_STAGE_VERSION = "two-stage-v1";
const directory = new URL("../../llm/prompts/two_stage_v1/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", directory), "utf8"));
function bundled(name: string): string {
  const content = readFileSync(new URL(name, directory), "utf8");
  if (createHash("sha256").update(content).digest("hex") !== manifest.sha256[name])
    throw new Error("PROMPT_BUNDLE_HASH_MISMATCH");
  return content;
}
const analysisSystem = bundled("analysis.system.txt");
const analysisPrefix = bundled("analysis.input_context.txt");
const improvementSystem = bundled("conversation_improvement.system.txt");
type Messages = { role: "system" | "user"; content: string }[];

function semantics(criterion: Criterion) {
  return JSON.stringify({
    id: criterion.id, name: criterion.name, description: criterion.description,
    type: criterion.type, allowNA: criterion.allowNA, naCondition: criterion.naCondition,
    scale: criterion.scale,
  });
}
// Freeze the baseline so callers cannot mutate the exported checklist and make
// a different rubric appear compatible with the fixed eight-criterion prompt.
const canonical = new Map(initialChecklist.criteria.map((criterion) => [criterion.id, semantics(criterion)]));
export function usesCanonicalAnalysis(checklist: Checklist): boolean {
  return checklist.criteria.length === canonical.size &&
    new Set(checklist.criteria.map((criterion) => criterion.id)).size === canonical.size &&
    checklist.criteria.every((criterion) => canonical.get(criterion.id) === semantics(criterion));
}
function record(conversation: Conversation) {
  return {
    conversation_id: conversation.externalId,
    language: conversation.language,
    channel: conversation.channel,
    transcript: conversation.messages.map(({ id, speaker, text, timestamp }) => ({ id, speaker, text, timestamp })),
  };
}
export function buildCanonicalAnalysisMessages(conversation: Conversation): Messages {
  return [
    { role: "system", content: analysisSystem },
    { role: "user", content: `${analysisPrefix}\n\n${JSON.stringify({ record: record(conversation), factual_ledger: null })}` },
  ];
}
export function buildImprovementMessages(conversation: Conversation, evaluation: Evaluation): Messages {
  if (evaluation.recordId !== conversation.id) throw new Error("IMPROVEMENT_RECORD_MISMATCH");
  return [
    { role: "system", content: improvementSystem },
    { role: "user", content: JSON.stringify({
      record: record(conversation),
      assessment: { results: evaluation.results.map((result) => ({
        criterion_id: result.criterionId,
        status: result.answer === null ? "not_applicable" : "scored",
        value: result.answer,
        reason: result.override?.reason ?? result.explanation,
        evidence_ids: result.evidence.length === 1 && result.evidence[0].kind === "range"
          ? [result.evidence[0].messageIds[0], result.evidence[0].messageIds.at(-1)]
          : [...new Set(result.evidence.flatMap((evidence) => evidence.messageIds))],
        evidence_kind: result.evidence.length === 1 && result.evidence[0].kind === "range" ? "checked_range" : "messages",
      })) },
    }) },
  ];
}
export function parseImprovementOutput(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).length !== 1 || !("conversation_improvement" in raw))
    throw new Error("INVALID_IMPROVEMENT_OUTPUT");
  const value = (raw as { conversation_improvement: unknown }).conversation_improvement;
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 12_000)
    throw new Error("INVALID_IMPROVEMENT_OUTPUT");
  return value.trim();
}
