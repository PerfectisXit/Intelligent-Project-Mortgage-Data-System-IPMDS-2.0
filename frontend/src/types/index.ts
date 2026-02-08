export interface DiffRow {
  rowNo: number;
  actionType: "NEW" | "CHANGED" | "UNCHANGED" | "ERROR";
  businessKey: string;
  entityType: "unit" | "customer" | "transaction";
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  fieldDiffs: Record<string, { before: unknown; after: unknown }>;
  errorMessage?: string;
}

export interface CopilotInterpretResponse {
  status: "need_clarification" | "ready_to_confirm";
  draftAction: { intent: string; payload: Record<string, unknown> };
  question?: string;
  options?: string[];
  candidateMatches?: Array<{ canonical: string; score: number; reason: string }>;
}

export interface ImportSummary {
  totalRows: number;
  newRows: number;
  changedRows: number;
  unchangedRows: number;
  errorRows: number;
}

export interface ImportAuditRow {
  row_no: number;
  entity_type: "unit" | "customer" | "transaction";
  business_key: string | null;
  field_name: string;
  before_value: unknown;
  after_value: unknown;
  applied: boolean;
  error_message?: string | null;
}

export interface OcrLinkResponse {
  fileId: string;
  linked: boolean;
  linkedUnitId?: string | null;
  issueStatus: "pending" | "issued" | "rejected";
  unitCandidates: Array<{ unitId: string; unitCode: string }>;
  ocr: {
    text: string;
    confidence: number;
    unitCodes: string[];
    amountCandidates: number[];
    dateCandidates: string[];
    warnings: string[];
  };
}
