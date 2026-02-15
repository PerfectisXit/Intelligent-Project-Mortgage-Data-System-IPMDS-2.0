import { useState, useCallback } from "react";
import { api } from "../api/client";
import { message } from "antd";

export interface HeaderSuggestion {
  rawHeader: string;
  suggestedField: string | null;
  confidence: number;
  needsConfirm: boolean;
  llmSuggestedField?: string | null;
  llmConfidence?: number;
  llmReason?: string;
  llmReasoningProcess?: string[];
  llmFullOpinion?: string;
}

export interface LlmOutputItem {
  rawHeader: string;
  suggestedField: string | null;
  confidence: number;
  reason: string;
  reasoningProcess: string[];
  fullOpinion: string;
  needsConfirm: boolean;
}

export interface LlmTrace {
  selectedModel: string | null;
  status: "success" | "fallback_rules_only" | "skipped_no_model";
  attempts: Array<{
    providerKey: string;
    model: string;
    status: "success" | "failed";
    latencyMs: number;
    error?: string;
  }>;
}

export interface StageStatus {
  pythonDataStage: {
    status: "done" | "process" | "wait" | "error";
    durationMs: number;
    message: string;
  };
  llmReviewStage: {
    status: "done" | "process" | "wait" | "error" | "warning" | "skipped";
    durationMs: number;
    message: string;
  };
}

export interface HeaderAnalyzeFinalPayload {
  uploadToken: string;
  standardFields: string[];
  suggestions: HeaderSuggestion[];
  reviewMode: "rules_only" | "rules_plus_llm";
  reviewNotes: string[];
  llmOutput: LlmOutputItem[];
  llmOverallOpinion: string;
  llmTrace: LlmTrace;
  stageStatus: StageStatus;
}

export function useHeaderMapping() {
  const [uploadToken, setUploadToken] = useState<string>("");
  const [headerSuggestions, setHeaderSuggestions] = useState<HeaderSuggestion[]>([]);
  const [standardFields, setStandardFields] = useState<string[]>([]);
  const [headerMappingOverride, setHeaderMappingOverride] = useState<Record<string, string>>({});
  const [headerReviewMode, setHeaderReviewMode] = useState<"rules_only" | "rules_plus_llm">("rules_only");
  const [headerReviewNotes, setHeaderReviewNotes] = useState<string[]>([]);
  const [llmOutput, setLlmOutput] = useState<LlmOutputItem[]>([]);
  const [llmOverallOpinion, setLlmOverallOpinion] = useState("");
  const [llmTrace, setLlmTrace] = useState<LlmTrace | null>(null);
  const [stageStatus, setStageStatus] = useState<StageStatus | null>(null);
  const [confirmingMapping, setConfirmingMapping] = useState(false);

  const resetMapping = useCallback(() => {
    setUploadToken("");
    setHeaderSuggestions([]);
    setHeaderMappingOverride({});
    setStandardFields([]);
    setHeaderReviewNotes([]);
    setHeaderReviewMode("rules_only");
    setLlmOutput([]);
    setLlmOverallOpinion("");
    setLlmTrace(null);
    setStageStatus(null);
  }, []);

  const updateMappingOverride = useCallback((rawHeader: string, value: string) => {
    setHeaderMappingOverride((prev) => ({
      ...prev,
      [rawHeader]: value ?? ""
    }));
  }, []);

  const setAnalyzeResult = useCallback((payload: HeaderAnalyzeFinalPayload) => {
    setUploadToken(payload.uploadToken);
    setHeaderSuggestions(payload.suggestions || []);
    setStandardFields(payload.standardFields || []);
    setHeaderReviewMode(payload.reviewMode || "rules_only");
    setHeaderReviewNotes(payload.reviewNotes || []);
    setLlmOutput(payload.llmOutput || []);
    setLlmOverallOpinion(payload.llmOverallOpinion || "");
    setLlmTrace(payload.llmTrace || null);
    setStageStatus(payload.stageStatus || null);
    
    const initial: Record<string, string> = {};
    for (const item of payload.suggestions || []) {
      if (item.suggestedField) {
        initial[item.rawHeader] = item.suggestedField;
      }
    }
    setHeaderMappingOverride(initial);
  }, []);

  const commitMappingAndDiff = useCallback(async () => {
    if (!uploadToken) return null;
    setConfirmingMapping(true);
    try {
      const cleanedOverride: Record<string, string> = {};
      for (const [raw, std] of Object.entries(headerMappingOverride)) {
        if (std && std.trim()) cleanedOverride[raw] = std.trim();
      }
      const res = await api.post<{
        importLogId: string;
        headerMapping: Record<string, string>;
        rows: import("../types").DiffRow[];
        summary: import("../types").ImportSummary;
      }>(
        "/imports/excel/confirm-mapping",
        {
          uploadToken,
          organizationId: "9f4af2dc-7f29-4e91-aa74-68db4f9e6f9b",
          projectId: "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa",
          headerMappingOverride: cleanedOverride
        },
        {
          headers: { "x-user-role": "finance", "x-user-id": "u_finance_1" }
        }
      );
      message.success("表头确认完成，已生成比对结果");
      return res.data;
    } catch (error) {
      message.error("确认映射失败");
      return null;
    } finally {
      setConfirmingMapping(false);
    }
  }, [uploadToken, headerMappingOverride]);

  const hasPendingMappingConfirm = Boolean(uploadToken && headerSuggestions.length > 0);

  const criticalHeaders = [
    "unit_code",
    "internal_external",
    "construction_unit",
    "general_contractor_unit",
    "subcontractor_unit",
    "subscribe_date",
    "sign_date"
  ];

  const mappedStdHeaders = new Set(Object.values(headerMappingOverride || {}));
  const missingCriticalHeaders = criticalHeaders.filter((h) => !mappedStdHeaders.has(h));

  return {
    // State
    uploadToken,
    headerSuggestions,
    standardFields,
    headerMappingOverride,
    headerReviewMode,
    headerReviewNotes,
    llmOutput,
    llmOverallOpinion,
    llmTrace,
    stageStatus,
    confirmingMapping,
    hasPendingMappingConfirm,
    missingCriticalHeaders,
    criticalHeaders,
    mappedStdHeaders,
    // Actions
    resetMapping,
    updateMappingOverride,
    setAnalyzeResult,
    commitMappingAndDiff
  };
}
