import { useState, useRef, useCallback } from "react";
import { message } from "antd";
import { api } from "../api/client";
import { TIMEOUT } from "../constants";
import type { HeaderAnalyzeFinalPayload } from "./useHeaderMapping";

export interface StreamEvent {
  ts: string;
  text: string;
  level: "info" | "ok" | "error";
}

const WAIT_CONFIRM_MS = 30000;

export function useStreamingAnalyze(
  onAnalyzeComplete: (payload: HeaderAnalyzeFinalPayload) => void
) {
  const [streamingAnalyze, setStreamingAnalyze] = useState(false);
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(false);
  
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const analyzeWaitTimerRef = useRef<number | null>(null);
  const analyzeRunningRef = useRef(false);

  const clearAnalyzeWaitTimer = useCallback(() => {
    if (analyzeWaitTimerRef.current != null) {
      window.clearTimeout(analyzeWaitTimerRef.current);
      analyzeWaitTimerRef.current = null;
    }
  }, []);

  const scheduleAnalyzeWaitConfirm = useCallback(() => {
    clearAnalyzeWaitTimer();
    analyzeWaitTimerRef.current = window.setTimeout(() => {
      if (!analyzeRunningRef.current) return;
      const keepWaiting = window.confirm(
        "AI 解析耗时较长，是否继续等待？点击「取消」将终止本次上传解析。"
      );
      if (keepWaiting) {
        scheduleAnalyzeWaitConfirm();
      } else {
        analyzeAbortRef.current?.abort();
        message.info("已取消本次上传解析。");
      }
    }, WAIT_CONFIRM_MS);
  }, [clearAnalyzeWaitTimer]);

  const startAnalyze = useCallback(async (file: File) => {
    setLoading(true);
    setStreamingAnalyze(true);
    analyzeRunningRef.current = true;
    setStreamEvents([]);
    
    try {
      const controller = new AbortController();
      analyzeAbortRef.current = controller;
      scheduleAnalyzeWaitConfirm();
      
      const form = new FormData();
      form.append("file", file);
      form.append("organizationId", "9f4af2dc-7f29-4e91-aa74-68db4f9e6f9b");
      form.append("projectId", "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa");
      
      const response = await fetch(
        `${api.defaults.baseURL}/imports/excel/analyze-headers-stream`,
        {
          method: "POST",
          headers: {
            "x-user-role": "finance",
            "x-user-id": "u_finance_1"
          },
          body: form,
          signal: controller.signal
        }
      );
      
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalPayload: HeaderAnalyzeFinalPayload | null = null;
      
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        while (buffer.includes("\n\n")) {
          const idx = buffer.indexOf("\n\n");
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          
          const lines = frame.split("\n");
          let eventName = "message";
          const dataLines: string[] = [];
          
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          }
          
          if (!dataLines.length) continue;
          const dataText = dataLines.join("\n");
          let payload: unknown = null;
          try {
            payload = JSON.parse(dataText);
          } catch {
            payload = dataText;
          }

          // 处理不同类型的事件
          if (eventName === "stage" && payload && typeof payload === "object") {
            const obj = payload as Record<string, unknown>;
            const stage = String(obj.stage || "");
            const status = String(obj.status || "process");
            const durationMs = Number(obj.durationMs || 0);
            const msg = String(obj.message || "");
            
            setStreamEvents((prev) => [
              ...prev,
              {
                ts: new Date().toLocaleTimeString(),
                text: `[${stage}] ${msg}${durationMs ? ` (${durationMs}ms)` : ""}`,
                level: status === "done" ? "ok" : status === "warning" ? "error" : "info"
              }
            ]);
          } else if (eventName === "llm_attempt_start" && payload && typeof payload === "object") {
            const obj = payload as Record<string, unknown>;
            setStreamEvents((prev) => [
              ...prev,
              {
                ts: new Date().toLocaleTimeString(),
                text: `模型尝试开始: ${String(obj.providerKey)}:${String(obj.model)}`,
                level: "info"
              }
            ]);
          } else if (eventName === "llm_attempt_result" && payload && typeof payload === "object") {
            const obj = payload as Record<string, unknown>;
            const isSuccess = String(obj.status) === "success";
            setStreamEvents((prev) => [
              ...prev,
              {
                ts: new Date().toLocaleTimeString(),
                text: `模型尝试${isSuccess ? "成功" : "失败"}: ${String(obj.providerKey)}:${String(obj.model)} (${String(obj.latencyMs)}ms)${obj.error ? ` / ${String(obj.error)}` : ""}`,
                level: isSuccess ? "ok" : "error"
              }
            ]);
          } else if (eventName === "llm_review_output" && payload && typeof payload === "object") {
            const obj = payload as Record<string, unknown>;
            const reviews = Array.isArray(obj.reviews) ? obj.reviews : [];
            const overallOpinion = typeof obj.overallOpinion === "string" ? obj.overallOpinion : "";
            const first = reviews[0] as Record<string, unknown> | undefined;
            const reasoning = Array.isArray(first?.reasoningProcess)
              ? (first?.reasoningProcess as unknown[]).filter((x): x is string => typeof x === "string")
              : [];
            const fullOpinion = typeof first?.fullOpinion === "string" ? first.fullOpinion : "";
            
            setStreamEvents((prev) => [
              ...prev,
              {
                ts: new Date().toLocaleTimeString(),
                text: `收到模型审核输出: ${reviews.length} 条建议`,
                level: "ok"
              },
              ...(fullOpinion ? [{ ts: new Date().toLocaleTimeString(), text: `完整意见: ${fullOpinion}`, level: "info" as const }] : []),
              ...(overallOpinion ? [{ ts: new Date().toLocaleTimeString(), text: `总体意见: ${overallOpinion}`, level: "info" as const }] : []),
              ...reasoning.slice(0, 3).map((step) => ({
                ts: new Date().toLocaleTimeString(),
                text: `推理片段: ${step}`,
                level: "info" as const
              }))
            ]);
          } else if (eventName === "final_result" && payload && typeof payload === "object") {
            finalPayload = payload as HeaderAnalyzeFinalPayload;
          } else if (eventName === "error") {
            const errText = payload && typeof payload === "object"
              ? String((payload as Record<string, unknown>).message || "流式处理失败")
              : "流式处理失败";
            throw new Error(errText);
          }
        }
      }

      if (!finalPayload) {
        throw new Error("未收到最终结果");
      }

      onAnalyzeComplete(finalPayload);
      setStreamEvents((prev) => [
        ...prev,
        { ts: new Date().toLocaleTimeString(), text: "流式处理完成，可确认映射并比对", level: "ok" }
      ]);
      message.success("流式处理完成，请确认映射后执行比对");
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        message.warning("上传解析已取消");
      } else {
        message.error(error instanceof Error ? error.message : "上传失败");
      }
      return false;
    } finally {
      clearAnalyzeWaitTimer();
      analyzeAbortRef.current = null;
      analyzeRunningRef.current = false;
      setLoading(false);
      setStreamingAnalyze(false);
    }
  }, [onAnalyzeComplete, scheduleAnalyzeWaitConfirm, clearAnalyzeWaitTimer]);

  const cancelAnalyze = useCallback(() => {
    analyzeAbortRef.current?.abort();
    clearAnalyzeWaitTimer();
  }, [clearAnalyzeWaitTimer]);

  return {
    streamingAnalyze,
    streamEvents,
    loading,
    startAnalyze,
    cancelAnalyze
  };
}
