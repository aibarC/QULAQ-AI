import type { Conversation, Evaluation } from "./types";
import { parseWorkspace } from "./validation";

/** QULAQ's detailed single-record format; official dataset submission is a separate server export. */
export function evaluationJson(conversation: Conversation, evaluation: Evaluation, source?: string): string {
  // A read-only reference preview intentionally belongs to a real source record.
  // Mark only the validation copy as synthetic; never mutate persisted data.
  const validationRecord = source && evaluation.demo ? { ...conversation, demo: true } : conversation;
  const state = parseWorkspace({
    conversations: [validationRecord], checklists: [evaluation.checklist], evaluations: [evaluation], appeals: [],
  });
  const record = state.conversations[0];
  const run = state.evaluations[0];
  const document = {
    format: "qulaq.evaluation",
    schema_version: 1,
    conversation_id: record.externalId,
    dataset_group_id: record.groupId,
    language: record.language,
    channel: record.channel,
    evaluation_id: run.id,
    created_at: run.createdAt,
    source_kind: source ? "preview" : run.demo || record.demo ? "demo" : "server",
    ...(source ? { source_description: source } : {}),
    checklist: run.checklist,
    original_total: run.originalTotal,
    total: run.total,
    gross_violation: run.grossViolation,
    results: run.checklist.criteria.map((criterion) => {
      const result = run.results.find((item) => item.criterionId === criterion.id)!;
      return {
        criterion_id: criterion.id,
        criterion_name: criterion.name,
        criterion_type: criterion.type,
        rule_description: criterion.description,
        status: result.answer === null ? "not_applicable" : "scored",
        value: result.answer,
        original_value: result.originalAnswer,
        weight: criterion.weight,
        points: result.points,
        reason: result.override?.reason ?? result.explanation,
        original_reason: result.explanation,
        ...(result.naReason ? { na_reason: result.naReason } : {}),
        evidence: result.evidence.map((evidence) => ({
          kind: evidence.kind, message_ids: evidence.messageIds, quote: evidence.quote,
        })),
        ...(result.override ? { review: {
          value: result.override.answer, reason: result.override.reason, appeal_id: result.override.appealId,
        } } : {}),
        ...(result.coaching ? { coaching: result.coaching } : {}),
      };
    }),
    transcript: record.messages.map((message) => ({
      message_id: message.id, timestamp: message.timestamp, speaker: message.speaker, text: message.text,
    })),
    ...(run.provenance ? { provenance: run.provenance } : {}),
    ...(run.contactReason ? { contact_reason: run.contactReason } : {}),
    ...(run.classificationError ? { classification_error: run.classificationError } : {}),
    ...(run.improvement ? { conversation_improvement: run.improvement } : {}),
  };
  // Export only the selected record/result; never serialize API links, audio URLs or workspace state.
  return JSON.stringify(document, null, 2);
}

export function downloadEvaluationJson(conversation: Conversation, evaluation: Evaluation, source?: string) {
  const text = evaluationJson(conversation, evaluation, source);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `QULAQ_${conversation.externalId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${evaluation.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
