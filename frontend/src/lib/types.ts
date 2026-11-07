import type { ContactReason } from "./contactReasons";
export type {
  ContactReason,
  ContactReasonCategory,
  ResolutionStatus,
} from "./contactReasons";

export type Role = "user" | "reviewer" | "manager";
export type Status = "unrated" | "evaluating" | "evaluated" | "error";
export interface Message {
  id: string;
  timestamp: string;
  speaker: "operator" | "client" | "bot" | "system";
  text: string;
}
export interface Conversation {
  id: string;
  externalId: string;
  groupId: string;
  channel: "agent chat" | "voice call";
  language: "RU" | "KZ" | "EN";
  messages: Message[];
  audioUrl: string | null;
  status: Status;
  demo?: boolean;
}
export interface ScaleOption {
  value: number;
  label: string;
}
export interface Criterion {
  id: string;
  name: string;
  description: string;
  type: "boolean" | "scale" | "flag";
  weight: number;
  allowNA: boolean;
  naCondition: string;
  scale: ScaleOption[];
}
export interface Checklist {
  id: string;
  name: string;
  version: number;
  criteria: Criterion[];
}
export type Answer = number | boolean | null;
export interface Evidence {
  messageIds: string[];
  quote: string;
  kind: "quote" | "range";
}
export interface CriterionCoaching {
  /** Suggested utterance, never an action already performed or a customer-facing send. */
  response: string | null;
  explanation: string;
  /** True when missing business context prevents drafting safely; response must be null. */
  needsContext: boolean;
  messageIds: string[];
}
export interface CriterionResult {
  criterionId: string;
  answer: Answer;
  originalAnswer: Answer;
  points: number | null;
  explanation: string;
  evidence: Evidence[];
  naReason?: string;
  /** Original model guidance; retained through appeals, shown only while current answer is an issue. */
  coaching?: CriterionCoaching;
  override?: { answer: Answer; reason: string; appealId: string };
}
export interface ClassificationError {
  provider: "laya";
  code:
    | "missing_fragment"
    | "invalid_fragment"
    | "unavailable"
    | "timeout"
    | "invalid_output"
    | "failed";
  message: string;
}
export interface Evaluation {
  id: string;
  recordId: string;
  createdAt: string;
  checklist: Checklist;
  results: CriterionResult[];
  total: number | null;
  originalTotal: number | null;
  grossViolation: boolean;
  demo: boolean;
  /** Absent on historic runs; never inferred or backfilled by the UI. */
  contactReason?: ContactReason;
  classificationError?: ClassificationError;
}
export interface Appeal {
  id: string;
  recordId: string;
  evaluationId: string;
  criterionId: string;
  comment: string;
  createdAt: string;
  status: "pending" | "resolved";
  decision?: {
    action: "confirm" | "change";
    answer: Answer;
    reason: string;
    createdAt: string;
  };
}
export interface Workspace {
  conversations: Conversation[];
  checklists: Checklist[];
  evaluations: Evaluation[];
  appeals: Appeal[];
}
export interface DecisionInput {
  action: "confirm" | "change";
  answer: Answer;
  reason: string;
}
export interface WorkspaceAdapter {
  readonly mode: "local" | "api";
  load(): Promise<Workspace>;
  classifyReason(evaluationId: string): Promise<Workspace>;
  importDataset(groupId: string): Promise<Workspace>;
  uploadDataset(dataset: unknown): Promise<Workspace>;
  saveChecklist(checklist: Checklist): Promise<Workspace>;
  evaluate(recordId: string, checklistId: string): Promise<Workspace>;
  createAppeal(
    evaluationId: string,
    criterionId: string,
    comment: string,
  ): Promise<Workspace>;
  resolveAppeal(appealId: string, decision: DecisionInput): Promise<Workspace>;
}
