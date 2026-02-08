export type DiffActionType = "NEW" | "CHANGED" | "UNCHANGED" | "ERROR";

export interface DiffRow {
  rowNo: number;
  actionType: DiffActionType;
  businessKey: string;
  entityType: "unit" | "customer" | "transaction";
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  fieldDiffs: Record<string, { before: unknown; after: unknown }>;
  errorMessage?: string;
}

export interface CopilotInterpretRequest {
  sessionId: string;
  input: string;
  projectId: string;
  attachments: Array<{ id: string; type: "pdf" | "image"; url: string }>;
  clientContext?: {
    currentPage?: string;
    timezone?: string;
  };
}

export interface CopilotInterpretResponse {
  status: "need_clarification" | "ready_to_confirm";
  draftAction: {
    intent: string;
    payload: Record<string, unknown>;
  };
  question?: string;
  options?: string[];
  candidateMatches?: Array<{ canonical: string; score: number; reason: string }>;
}
