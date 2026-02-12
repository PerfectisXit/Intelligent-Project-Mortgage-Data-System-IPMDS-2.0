import axios from "axios";
import { env } from "../config/env.js";

export interface PythonDiffResponse {
  headerMapping: Record<string, string>;
  rows: Array<{
    rowNo: number;
    actionType: "NEW" | "CHANGED" | "UNCHANGED" | "ERROR";
    businessKey: string;
    entityType: "unit" | "customer" | "transaction";
    beforeData: Record<string, unknown> | null;
    afterData: Record<string, unknown> | null;
    fieldDiffs: Record<string, { before: unknown; after: unknown }>;
    errorMessage?: string;
  }>;
  summary: {
    totalRows: number;
    newRows: number;
    changedRows: number;
    unchangedRows: number;
    errorRows: number;
  };
}

export interface PythonHeaderAnalyzeResponse {
  rawHeaders: string[];
  standardFields: string[];
  suggestions: Array<{
    rawHeader: string;
    suggestedField: string | null;
    confidence: number;
    candidates: Array<{ field: string; score: number }>;
    needsConfirm: boolean;
  }>;
}

export interface PythonOcrResponse {
  text: string;
  confidence: number;
  unitCodes: string[];
  amountCandidates: number[];
  dateCandidates: string[];
  warnings: string[];
}

export async function requestExcelDiff(params: {
  filePath: string;
  existingRows: Array<Record<string, unknown>>;
  headerMappingOverride?: Record<string, string>;
}) {
  const res = await axios.post<PythonDiffResponse>(`${env.pythonServiceUrl}/excel/diff`, params, {
    timeout: 120000
  });
  return res.data;
}

export async function requestExcelHeaderAnalyze(params: { filePath: string }) {
  const res = await axios.post<PythonHeaderAnalyzeResponse>(
    `${env.pythonServiceUrl}/excel/analyze-headers`,
    params,
    { timeout: 120000 }
  );
  return res.data;
}

export async function requestOcrExtract(params: { filePath: string }) {
  const res = await axios.post<PythonOcrResponse>(`${env.pythonServiceUrl}/ocr/extract`, params, {
    timeout: 120000
  });
  return res.data;
}
