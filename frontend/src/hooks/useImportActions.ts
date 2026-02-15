import { useState, useCallback } from "react";
import { api } from "../api/client";
import { message } from "antd";
import axios from "axios";
import type { DiffRow, ImportSummary, ImportAuditRow, CommittedPreviewRow } from "../types";

export function useImportActions() {
  const [importLogId, setImportLogId] = useState<string>("");
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [headerMapping, setHeaderMapping] = useState<Record<string, string>>({});
  const [audits, setAudits] = useState<ImportAuditRow[]>([]);
  const [previewRows, setPreviewRows] = useState<CommittedPreviewRow[]>([]);
  
  const [committing, setCommitting] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [loadingAudits, setLoadingAudits] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [fixingRow, setFixingRow] = useState(false);

  const setImportResult = useCallback((
    importLogId: string,
    headerMapping: Record<string, string>,
    rows: DiffRow[],
    summary: ImportSummary
  ) => {
    setImportLogId(importLogId);
    setHeaderMapping(headerMapping);
    setRows(rows);
    setSummary(summary);
    setAudits([]);
  }, []);

  const resetImportResult = useCallback(() => {
    setImportLogId("");
    setRows([]);
    setSummary(null);
    setHeaderMapping({});
    setAudits([]);
    setPreviewRows([]);
  }, []);

  const commitImport = useCallback(async () => {
    if (!importLogId) return null;
    setCommitting(true);
    try {
      const res = await api.post(
        `/imports/${importLogId}/commit`,
        {},
        { headers: { "x-user-role": "finance", "x-user-id": "u_finance_1" } }
      );
      message.success(`提交完成: committedRows=${res.data.committedRows ?? "-"}`);
      return res.data;
    } catch (error) {
      message.error("提交失败");
      return null;
    } finally {
      setCommitting(false);
    }
  }, [importLogId]);

  const rollbackImport = useCallback(async () => {
    if (!importLogId) return null;
    setRollingBack(true);
    try {
      const res = await api.post(
        `/imports/${importLogId}/rollback`,
        {},
        { headers: { "x-user-role": "finance", "x-user-id": "u_finance_1" } }
      );
      message.success(`回滚完成: ${res.data.status}`);
      return res.data;
    } catch (error) {
      message.error("回滚失败");
      return null;
    } finally {
      setRollingBack(false);
    }
  }, [importLogId]);

  const loadAudits = useCallback(async () => {
    if (!importLogId) return;
    setLoadingAudits(true);
    try {
      const res = await api.get<{ rows: ImportAuditRow[] }>(`/imports/${importLogId}/audits`, {
        headers: { "x-user-role": "finance", "x-user-id": "u_finance_1" }
      });
      setAudits(res.data.rows || []);
    } catch (error) {
      message.error("加载审计明细失败");
    } finally {
      setLoadingAudits(false);
    }
  }, [importLogId]);

  const loadCommittedPreview = useCallback(async () => {
    if (!importLogId) return;
    setLoadingPreview(true);
    try {
      const res = await api.get<{ rows: CommittedPreviewRow[] }>(`/imports/${importLogId}/committed-preview`, {
        headers: { "x-user-role": "finance", "x-user-id": "u_finance_1" }
      });
      setPreviewRows(res.data.rows || []);
      message.success(`已加载入库明细：${res.data.rows?.length ?? 0} 行`);
    } catch (error) {
      message.error("加载入库明细失败");
    } finally {
      setLoadingPreview(false);
    }
  }, [importLogId]);

  const manualFixErrorRow = useCallback(
    async (rowNo: number, afterData: Record<string, unknown>, actionType?: "NEW" | "CHANGED") => {
      if (!importLogId) return false;
      setFixingRow(true);
      try {
        const res = await api.post<{ row: DiffRow; summary: ImportSummary }>(
          `/imports/${importLogId}/rows/${rowNo}/manual-fix`,
          { afterData, actionType },
          { headers: { "x-user-role": "finance", "x-user-id": "u_finance_1" } }
        );
        const fixedRow = res.data.row;
        const fixedSummary = res.data.summary;
        setRows((prev) => prev.map((r) => (r.rowNo === fixedRow.rowNo ? fixedRow : r)));
        setSummary(fixedSummary);
        message.success(`第 ${rowNo} 行已修正并确认`);
        return true;
      } catch (error) {
        const backendMsg = axios.isAxiosError(error)
          ? (error.response?.data as { message?: string } | undefined)?.message
          : undefined;
        message.error(backendMsg || "修正失败，请检查 JSON 格式或必填字段");
        return false;
      } finally {
        setFixingRow(false);
      }
    },
    [importLogId]
  );

  return {
    // State
    importLogId,
    rows,
    summary,
    headerMapping,
    audits,
    previewRows,
    committing,
    rollingBack,
    loadingAudits,
    loadingPreview,
    fixingRow,
    // Actions
    setImportResult,
    resetImportResult,
    commitImport,
    rollbackImport,
    loadAudits,
    loadCommittedPreview,
    manualFixErrorRow
  };
}
