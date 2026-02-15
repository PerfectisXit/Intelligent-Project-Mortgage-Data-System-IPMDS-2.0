import { useState, useCallback } from "react";
import { api } from "../api/client";
import { message } from "antd";
import type { OcrLinkResponse } from "../types";

export function useOcrProcess() {
  const [ocrLoading, setOcrLoading] = useState(false);
  const [confirmingOcr, setConfirmingOcr] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrLinkResponse | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");

  const resetOcr = useCallback(() => {
    setOcrResult(null);
    setSelectedUnitId("");
    setOcrLoading(false);
    setConfirmingOcr(false);
  }, []);

  const processOcr = useCallback(async (file: File) => {
    setOcrLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("projectId", "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa");
      form.append("fileType", "confirmation");
      
      const res = await api.post<OcrLinkResponse>("/files/ocr-link", form, {
        headers: {
          "Content-Type": "multipart/form-data",
          "x-user-role": "sales",
          "x-user-id": "u_sales_1"
        }
      });
      
      setOcrResult(res.data);
      setSelectedUnitId(res.data.linkedUnitId ?? "");
      
      if (res.data.linked) {
        message.success("已自动关联房源");
      } else {
        message.success("识别完成，请确认候选房号");
      }
      
      return res.data;
    } catch (error) {
      message.error("OCR 处理失败");
      return null;
    } finally {
      setOcrLoading(false);
    }
  }, []);

  const confirmOcrLink = useCallback(async () => {
    if (!ocrResult?.fileId || !selectedUnitId) return false;
    
    setConfirmingOcr(true);
    try {
      const resp = await api.post(
        `/files/${ocrResult.fileId}/confirm-link`,
        { unitId: selectedUnitId },
        { headers: { "x-user-role": "sales", "x-user-id": "u_sales_1" } }
      );
      
      message.success(`确认成功：${resp.data.issueStatus}`);
      setOcrResult({
        ...ocrResult,
        linked: true,
        linkedUnitId: selectedUnitId,
        issueStatus: "issued"
      });
      return true;
    } catch (error) {
      message.error("确认关联失败");
      return false;
    } finally {
      setConfirmingOcr(false);
    }
  }, [ocrResult, selectedUnitId]);

  return {
    // State
    ocrLoading,
    confirmingOcr,
    ocrResult,
    selectedUnitId,
    // Actions
    setSelectedUnitId,
    resetOcr,
    processOcr,
    confirmOcrLink
  };
}
