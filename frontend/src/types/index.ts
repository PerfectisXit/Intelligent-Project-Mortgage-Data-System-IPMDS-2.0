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
  answer?: string;
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

export interface CommittedPreviewRow {
  project_name?: string | null;
  unit_code: string;
  property_type: string | null;
  area_m2: number | null;
  deal_price: number | null;
  status: string | null;
  status_display?: string | null;
  status_basis?: string | null;
  sale_status_raw: string | null;
  internal_external: string | null;
  construction_unit: string | null;
  construction_unit_inferred: string | null;
  construction_unit_source: "imported" | "inferred_internal" | "inferred_relation" | "inferred_txn" | "missing";
  general_contractor_unit: string | null;
  general_contractor_unit_inferred: string | null;
  general_contractor_unit_source: "imported" | "inferred_internal" | "inferred_relation" | "inferred_txn" | "missing";
  subcontractor_unit: string | null;
  subcontractor_unit_inferred: string | null;
  subcontractor_unit_source: "imported" | "inferred_internal" | "inferred_relation" | "inferred_txn" | "missing";
  subscribe_date: string | null;
  subscribe_date_inferred: string | null;
  subscribe_date_source: "imported" | "inferred_internal" | "inferred_relation" | "inferred_txn" | "missing";
  sign_date: string | null;
  sign_date_inferred: string | null;
  sign_date_source: "imported" | "inferred_internal" | "inferred_relation" | "inferred_txn" | "missing";
  customer_name: string | null;
  phone: string | null;
  actual_received_latest: number | null;
  total_received: number | null;
  last_txn_type: string | null;
  last_txn_occurred_at: string | null;
  last_txn_amount: number | null;
  last_payment_method: string | null;
  last_import_log_id: string | null;
  updated_at?: string | null;
  last_update_source?: string | null;
  last_update_file_name?: string | null;
  last_update_session_id?: string | null;
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

export type ProviderKey = "siliconflow" | "zai" | "openai" | "deepseek" | "claude";

export interface ProviderConfig {
  providerKey: ProviderKey;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
}

export interface AiProviderSettings {
  providers: ProviderConfig[];
  defaultProvider: ProviderKey;
  fallbackProviders: ProviderKey[];
}

export interface ProviderProbeResult {
  providerKey: ProviderKey;
  available: boolean;
  latencyMs: number;
  statusCode?: number;
  message: string;
}

export interface AiPromptTemplates {
  copilotInterpret: {
    systemPrompt: string;
  };
  headerReview: {
    systemPrompt: string;
    userPayloadTemplate: Record<string, unknown>;
  };
}
