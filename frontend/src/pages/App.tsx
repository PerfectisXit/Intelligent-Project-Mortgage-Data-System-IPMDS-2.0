import {
  Alert,
  Badge,
  Button,
  Card,
  Descriptions,
  Layout,
  List,
  Select,
  Segmented,
  Radio,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  Upload,
  message
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useRef, useState } from "react";
import { api } from "../api/client";
import { ApiSettingsPage } from "../components/ApiSettingsPage";
import { CommittedPreviewTable } from "../components/CommittedPreviewTable";
import { CopilotCard } from "../components/CopilotCard";
import { ImportDiffTable } from "../components/ImportDiffTable";
import type { CommittedPreviewRow, DiffRow, ImportAuditRow, ImportSummary, OcrLinkResponse } from "../types";

const { Header, Content } = Layout;
const WAIT_CONFIRM_MS = 30000;

type HeaderSuggestion = {
  rawHeader: string;
  suggestedField: string | null;
  confidence: number;
  needsConfirm: boolean;
  llmSuggestedField?: string | null;
  llmConfidence?: number;
  llmReason?: string;
  llmReasoningProcess?: string[];
  llmFullOpinion?: string;
};

type LlmOutputItem = {
  rawHeader: string;
  suggestedField: string | null;
  confidence: number;
  reason: string;
  reasoningProcess: string[];
  fullOpinion: string;
  needsConfirm: boolean;
};

type StageStatus = {
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
};

type LlmTrace = {
  selectedModel: string | null;
  status: "success" | "fallback_rules_only" | "skipped_no_model";
  attempts: Array<{
    providerKey: string;
    model: string;
    status: "success" | "failed";
    latencyMs: number;
    error?: string;
  }>;
};

type HeaderAnalyzeFinalPayload = {
  uploadToken: string;
  standardFields: string[];
  suggestions: HeaderSuggestion[];
  reviewMode: "rules_only" | "rules_plus_llm";
  reviewNotes: string[];
  llmOutput: LlmOutputItem[];
  llmOverallOpinion: string;
  llmTrace: LlmTrace;
  stageStatus: StageStatus;
};

export default function App() {
  const [view, setView] = useState<"workbench" | "api-settings">("workbench");
  const [workbenchView, setWorkbenchView] = useState<"import" | "ocr" | "copilot">("import");
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [importLogId, setImportLogId] = useState<string>("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [headerMapping, setHeaderMapping] = useState<Record<string, string>>({});
  const [uploadToken, setUploadToken] = useState<string>("");
  const [standardFields, setStandardFields] = useState<string[]>([]);
  const [headerSuggestions, setHeaderSuggestions] = useState<
    HeaderSuggestion[]
  >([]);
  const [headerReviewMode, setHeaderReviewMode] = useState<"rules_only" | "rules_plus_llm">("rules_only");
  const [headerReviewNotes, setHeaderReviewNotes] = useState<string[]>([]);
  const [llmOutput, setLlmOutput] = useState<LlmOutputItem[]>([]);
  const [llmOverallOpinion, setLlmOverallOpinion] = useState("");
  const [llmTrace, setLlmTrace] = useState<LlmTrace | null>(null);
  const [stageStatus, setStageStatus] = useState<StageStatus | null>(null);
  const [streamingAnalyze, setStreamingAnalyze] = useState(false);
  const [streamEvents, setStreamEvents] = useState<Array<{ ts: string; text: string; level: "info" | "ok" | "error" }>>(
    []
  );
  const [headerMappingOverride, setHeaderMappingOverride] = useState<Record<string, string>>({});
  const [confirmingMapping, setConfirmingMapping] = useState(false);
  const [audits, setAudits] = useState<ImportAuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [loadingAudits, setLoadingAudits] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [confirmingOcr, setConfirmingOcr] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrLinkResponse | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [previewRows, setPreviewRows] = useState<CommittedPreviewRow[]>([]);
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const analyzeWaitTimerRef = useRef<number | null>(null);
  const analyzeRunningRef = useRef(false);

  const clearAnalyzeWaitTimer = () => {
    if (analyzeWaitTimerRef.current != null) {
      window.clearTimeout(analyzeWaitTimerRef.current);
      analyzeWaitTimerRef.current = null;
    }
  };

  const scheduleAnalyzeWaitConfirm = () => {
    clearAnalyzeWaitTimer();
    analyzeWaitTimerRef.current = window.setTimeout(() => {
      if (!analyzeRunningRef.current) return;
      const keepWaiting = window.confirm("AI 解析耗时较长，是否继续等待？点击“取消”将终止本次上传解析。");
      if (keepWaiting) {
        scheduleAnalyzeWaitConfirm();
      } else {
        analyzeAbortRef.current?.abort();
        message.info("已取消本次上传解析。");
      }
    }, WAIT_CONFIRM_MS);
  };

  const criticalHeaders = [
    "unit_code",
    "internal_external",
    "construction_unit",
    "general_contractor_unit",
    "subcontractor_unit",
    "subscribe_date",
    "sign_date"
  ];
  const mappedStdHeaders = new Set(Object.values(headerMapping || {}));
  const missingCriticalHeaders = criticalHeaders.filter((h) => !mappedStdHeaders.has(h));

  const hasPendingMappingConfirm = Boolean(uploadToken && headerSuggestions.length > 0);
  const showStreamPanel = streamingAnalyze || streamEvents.length > 0;
  const toStepStatus = (status: "done" | "process" | "wait" | "error" | "warning" | "skipped") => {
    if (status === "done") return "finish";
    if (status === "warning") return "error";
    if (status === "skipped") return "wait";
    return status;
  };
  const stageCurrent = !stageStatus
    ? 0
    : stageStatus.llmReviewStage.status === "done" ||
        stageStatus.llmReviewStage.status === "warning" ||
        stageStatus.llmReviewStage.status === "skipped"
      ? 1
      : 0;
  const llmStageAntStatus = !stageStatus ? "finish" : toStepStatus(stageStatus.llmReviewStage.status);

  const commitMappingAndDiff = async () => {
    if (!uploadToken) return;
    setConfirmingMapping(true);
    try {
      const cleanedOverride: Record<string, string> = {};
      for (const [raw, std] of Object.entries(headerMappingOverride)) {
        if (std && std.trim()) cleanedOverride[raw] = std.trim();
      }
      const res = await api.post<{
        importLogId: string;
        headerMapping: Record<string, string>;
        rows: DiffRow[];
        summary: ImportSummary;
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
      setImportLogId(res.data.importLogId);
      setHeaderMapping(res.data.headerMapping || {});
      setRows(res.data.rows || []);
      setSummary(res.data.summary || null);
      setAudits([]);
      setUploadToken("");
      setHeaderSuggestions([]);
      setHeaderMappingOverride({});
      setStandardFields([]);
      setLlmOutput([]);
      setLlmOverallOpinion("");
      setLlmTrace(null);
      setStageStatus(null);
      message.success("表头确认完成，已生成比对结果");
    } finally {
      setConfirmingMapping(false);
    }
  };

  const loadAudits = async () => {
    if (!importLogId) return;
    setLoadingAudits(true);
    try {
      const res = await api.get<{ rows: ImportAuditRow[] }>(`/imports/${importLogId}/audits`, {
        headers: { "x-user-role": "finance", "x-user-id": "u_finance_1" }
      });
      setAudits(res.data.rows || []);
    } finally {
      setLoadingAudits(false);
    }
  };

  const loadCommittedPreview = async () => {
    if (!importLogId) return;
    setLoadingPreview(true);
    try {
      const res = await api.get<{ rows: CommittedPreviewRow[] }>(`/imports/${importLogId}/committed-preview`, {
        headers: { "x-user-role": "finance", "x-user-id": "u_finance_1" }
      });
      setPreviewRows(res.data.rows || []);
      message.success(`已加载入库明细：${res.data.rows?.length ?? 0} 行`);
    } finally {
      setLoadingPreview(false);
    }
  };

  return (
    <Layout style={{ minHeight: "100vh", background: "#f4f6f8" }}>
      <Header style={{ background: "#0f172a", display: "flex", alignItems: "center" }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Title style={{ color: "#fff", margin: 0 }} level={4}>
            智能工抵台账管理系统
          </Typography.Title>
          <Segmented
            value={view}
            onChange={(value) => setView(value as "workbench" | "api-settings")}
            options={[
              { label: "工作台", value: "workbench" },
              { label: "API 设置", value: "api-settings" }
            ]}
          />
        </Space>
      </Header>
      <Content style={{ padding: 24 }}>
        {view === "api-settings" ? (
          <ApiSettingsPage />
        ) : (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Segmented
            value={workbenchView}
            onChange={(value) => setWorkbenchView(value as "import" | "ocr" | "copilot")}
            options={[
              { label: "导入与入库", value: "import" },
              { label: "OCR 识别", value: "ocr" },
              { label: "AI Copilot", value: "copilot" }
            ]}
          />
          {workbenchView === "import" ? (
            <>
          <Card title="智能导入与比对">
            <Upload
              accept=".xlsx,.xls"
              showUploadList={false}
              customRequest={async ({ file, onSuccess, onError }) => {
                setLoading(true);
                setStreamingAnalyze(true);
                analyzeRunningRef.current = true;
                setStreamEvents([]);
                try {
                  const controller = new AbortController();
                  analyzeAbortRef.current = controller;
                  scheduleAnalyzeWaitConfirm();
                  const form = new FormData();
                  form.append("file", file as File);
                  form.append("organizationId", "9f4af2dc-7f29-4e91-aa74-68db4f9e6f9b");
                  form.append("projectId", "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa");
                  const response = await fetch(`${api.defaults.baseURL}/imports/excel/analyze-headers-stream`, {
                    method: "POST",
                    headers: {
                      "x-user-role": "finance",
                      "x-user-id": "u_finance_1"
                    },
                    body: form,
                    signal: controller.signal
                  });
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
                        setStageStatus((prev) => {
                          const base =
                            prev ||
                            ({
                              pythonDataStage: { status: "wait", durationMs: 0, message: "" },
                              llmReviewStage: { status: "wait", durationMs: 0, message: "" }
                            } as StageStatus);
                          if (stage === "python_data") {
                            return {
                              ...base,
                              pythonDataStage: {
                                status: status as StageStatus["pythonDataStage"]["status"],
                                durationMs,
                                message: msg
                              }
                            };
                          }
                          if (stage === "llm_review") {
                            return {
                              ...base,
                              llmReviewStage: {
                                status: status as StageStatus["llmReviewStage"]["status"],
                                durationMs,
                                message: msg
                              }
                            };
                          }
                          return base;
                        });
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
                        setStreamEvents((prev) => [
                          ...prev,
                          {
                            ts: new Date().toLocaleTimeString(),
                            text: `模型尝试${String(obj.status) === "success" ? "成功" : "失败"}: ${String(obj.providerKey)}:${String(obj.model)} (${String(obj.latencyMs)}ms)${obj.error ? ` / ${String(obj.error)}` : ""}`,
                            level: String(obj.status) === "success" ? "ok" : "error"
                          }
                        ]);
                      } else if (eventName === "llm_review_output" && payload && typeof payload === "object") {
                        const obj = payload as Record<string, unknown>;
                        const reviews = Array.isArray(obj.reviews) ? obj.reviews : [];
                        const overallOpinion =
                          typeof obj.overallOpinion === "string" ? obj.overallOpinion : "";
                        const first = reviews[0] as Record<string, unknown> | undefined;
                        const reasoning = Array.isArray(first?.reasoningProcess)
                          ? (first?.reasoningProcess as unknown[]).filter(
                              (x): x is string => typeof x === "string"
                            )
                          : [];
                        const fullOpinion = typeof first?.fullOpinion === "string" ? first.fullOpinion : "";
                        setStreamEvents((prev) => [
                          ...prev,
                          {
                            ts: new Date().toLocaleTimeString(),
                            text: `收到模型审核输出: ${reviews.length} 条建议`,
                            level: "ok"
                          },
                          ...(fullOpinion
                            ? [
                                {
                                  ts: new Date().toLocaleTimeString(),
                                  text: `完整意见: ${fullOpinion}`,
                                  level: "info" as const
                                }
                              ]
                            : []),
                          ...(overallOpinion
                            ? [
                                {
                                  ts: new Date().toLocaleTimeString(),
                                  text: `总体意见: ${overallOpinion}`,
                                  level: "info" as const
                                }
                              ]
                            : []),
                          ...reasoning.slice(0, 3).map((step) => ({
                            ts: new Date().toLocaleTimeString(),
                            text: `推理片段: ${step}`,
                            level: "info" as const
                          }))
                        ]);
                      } else if (eventName === "final_result" && payload && typeof payload === "object") {
                        finalPayload = payload as HeaderAnalyzeFinalPayload;
                      } else if (eventName === "error") {
                        const errText =
                          payload && typeof payload === "object"
                            ? String((payload as Record<string, unknown>).message || "流式处理失败")
                            : "流式处理失败";
                        throw new Error(errText);
                      }
                    }
                  }

                  if (!finalPayload) {
                    throw new Error("未收到最终结果");
                  }

                  setUploadToken(finalPayload.uploadToken);
                  setHeaderSuggestions(finalPayload.suggestions || []);
                  setStandardFields(finalPayload.standardFields || []);
                  setHeaderReviewMode(finalPayload.reviewMode || "rules_only");
                  setHeaderReviewNotes(finalPayload.reviewNotes || []);
                  setLlmOutput(finalPayload.llmOutput || []);
                  setLlmOverallOpinion(finalPayload.llmOverallOpinion || "");
                  setLlmTrace(finalPayload.llmTrace || null);
                  setStageStatus(finalPayload.stageStatus || null);
                  const initial: Record<string, string> = {};
                  for (const item of finalPayload.suggestions || []) {
                    if (item.suggestedField) {
                      initial[item.rawHeader] = item.suggestedField;
                    }
                  }
                  setHeaderMappingOverride(initial);
                  setRows([]);
                  setSummary(null);
                  setHeaderMapping({});
                  setImportLogId("");
                  setAudits([]);
                  onSuccess?.({}, new XMLHttpRequest());
                  setStreamEvents((prev) => [
                    ...prev,
                    { ts: new Date().toLocaleTimeString(), text: "流式处理完成，可确认映射并比对", level: "ok" }
                  ]);
                  message.success("流式处理完成，请确认映射后执行比对");
                } catch (error) {
                  onError?.(error as Error);
                  if (error instanceof DOMException && error.name === "AbortError") {
                    message.warning("上传解析已取消");
                  } else {
                    message.error("上传失败");
                  }
                } finally {
                  clearAnalyzeWaitTimer();
                  analyzeAbortRef.current = null;
                  analyzeRunningRef.current = false;
                  setLoading(false);
                  setStreamingAnalyze(false);
                }
              }}
            >
              <Button icon={<UploadOutlined />} loading={loading} type="primary">
                上传 Excel 并解析表头
              </Button>
            </Upload>
            {showStreamPanel ? (
              <Card style={{ marginTop: 12 }} size="small" title="实时处理日志（流式）">
                <List
                  size="small"
                  locale={{ emptyText: "等待日志..." }}
                  dataSource={streamEvents}
                  renderItem={(item) => (
                    <List.Item>
                      <Space>
                        <Tag color={item.level === "ok" ? "green" : item.level === "error" ? "red" : "blue"}>
                          {item.ts}
                        </Tag>
                        <Typography.Text>{item.text}</Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            ) : null}

            {importLogId ? (
              <Space style={{ marginLeft: 12 }}>
                <Tag color="processing">批次: {importLogId}</Tag>
                <Button
                  type="primary"
                  loading={committing}
                  onClick={async () => {
                    setCommitting(true);
                    try {
                      const res = await api.post(
                        `/imports/${importLogId}/commit`,
                        {},
                        { headers: { "x-user-role": "finance", "x-user-id": "u_finance_1" } }
                      );
                      message.success(`提交完成: committedRows=${res.data.committedRows ?? "-"}`);
                      await loadAudits();
                      await loadCommittedPreview();
                    } finally {
                      setCommitting(false);
                    }
                  }}
                >
                  提交入库
                </Button>
                <Button
                  danger
                  loading={rollingBack}
                  onClick={async () => {
                    setRollingBack(true);
                    try {
                      const res = await api.post(
                        `/imports/${importLogId}/rollback`,
                        {},
                        { headers: { "x-user-role": "finance", "x-user-id": "u_finance_1" } }
                      );
                      message.success(`回滚完成: ${res.data.status}`);
                    } finally {
                      setRollingBack(false);
                    }
                  }}
                >
                  回滚批次
                </Button>
                <Button loading={loadingAudits} onClick={loadAudits}>
                  查看审计明细
                </Button>
                <Button loading={loadingPreview} onClick={loadCommittedPreview}>
                  查看入库明细
                </Button>
              </Space>
            ) : null}
          </Card>

          {hasPendingMappingConfirm ? (
            <Card
              title="表头映射确认"
              extra={
                <Space>
                  <Button
                    onClick={() => {
                      setUploadToken("");
                      setHeaderSuggestions([]);
                      setHeaderMappingOverride({});
                      setStandardFields([]);
                      setHeaderReviewNotes([]);
                      setHeaderReviewMode("rules_only");
                    }}
                  >
                    取消本次导入
                  </Button>
                  <Button type="primary" loading={confirmingMapping} onClick={commitMappingAndDiff}>
                    确认映射并开始比对
                  </Button>
                </Space>
              }
            >
              <Alert
                type="info"
                showIcon
                message={
                  headerReviewMode === "rules_plus_llm"
                    ? "规则先行 + 大模型复核已完成，请确认最终映射。"
                    : "仅规则建议可用（大模型未参与或不可用），请确认映射。"
                }
              />
              {stageStatus ? (
                <Card style={{ marginTop: 12 }} size="small" title="上传处理阶段状态">
                  <Steps
                    current={stageCurrent}
                    items={[
                      {
                        title: "Python 数据处理阶段",
                        status: toStepStatus(stageStatus.pythonDataStage.status),
                        description: `${stageStatus.pythonDataStage.message}（${stageStatus.pythonDataStage.durationMs}ms）`
                      },
                      {
                        title: "大模型介入审核阶段",
                        status: llmStageAntStatus,
                        description: `${stageStatus.llmReviewStage.message}（${stageStatus.llmReviewStage.durationMs}ms）`
                      }
                    ]}
                  />
                </Card>
              ) : null}
              {headerReviewNotes.length ? (
                <div style={{ marginTop: 8 }}>
                  {headerReviewNotes.map((note) => (
                    <Tag key={note} color="blue">
                      {note}
                    </Tag>
                  ))}
                </div>
              ) : null}
              <Card style={{ marginTop: 12 }} size="small" title="大模型审核过程与结果">
                <Space direction="vertical" style={{ width: "100%" }}>
                  <div>
                    <Typography.Text strong>审核过程：</Typography.Text>
                    {llmTrace ? (
                      <List
                        size="small"
                        dataSource={llmTrace.attempts}
                        locale={{ emptyText: "未执行模型调用" }}
                        renderItem={(item) => (
                          <List.Item>
                            <Space>
                              <Tag color={item.status === "success" ? "green" : "red"}>
                                {item.status === "success" ? "成功" : "失败"}
                              </Tag>
                              <Typography.Text>{`${item.providerKey}:${item.model}`}</Typography.Text>
                              <Typography.Text type="secondary">{`${item.latencyMs}ms`}</Typography.Text>
                              {item.error ? <Typography.Text type="danger">{item.error}</Typography.Text> : null}
                            </Space>
                          </List.Item>
                        )}
                      />
                    ) : (
                      <Typography.Text type="secondary">无过程日志</Typography.Text>
                    )}
                  </div>
                  <div>
                    <Typography.Text strong>审核结果输出：</Typography.Text>
                    <div style={{ marginTop: 8 }}>
                      <Tag color="blue">有效建议: {llmOutput.length}</Tag>
                      <Tag color="geekblue">采用模型: {llmTrace?.selectedModel || "无"}</Tag>
                    </div>
                    <Table
                      style={{ marginTop: 8 }}
                      size="small"
                      pagination={{ pageSize: 5 }}
                      rowKey={(r) => `${r.rawHeader}-${r.suggestedField || "null"}`}
                      dataSource={llmOutput}
                      columns={[
                        { title: "原始表头", dataIndex: "rawHeader", width: 220 },
                        {
                          title: "建议字段",
                          dataIndex: "suggestedField",
                          width: 180,
                          render: (value: string | null) => value || "(不建议映射)"
                        },
                        { title: "置信度", dataIndex: "confidence", width: 100 },
                        {
                          title: "需确认",
                          dataIndex: "needsConfirm",
                          width: 90,
                          render: (value: boolean) =>
                            value ? <Tag color="gold">是</Tag> : <Tag color="green">否</Tag>
                        },
                        {
                          title: "原因",
                          render: (_, row) => (
                            <div>
                              <div>{row.reason || "-"}</div>
                              {row.fullOpinion ? <div style={{ marginTop: 4 }}>{row.fullOpinion}</div> : null}
                              {row.reasoningProcess?.length ? (
                                <div style={{ marginTop: 4, color: "#666", fontSize: 12 }}>
                                  {row.reasoningProcess.map((step, idx) => (
                                    <div key={`${row.rawHeader}-reasoning-${idx}`}>{`${idx + 1}. ${step}`}</div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          )
                        }
                      ]}
                    />
                    {llmOverallOpinion ? (
                      <Card style={{ marginTop: 8 }} size="small" title="大模型总体意见（完整段落）">
                        <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                          {llmOverallOpinion}
                        </Typography.Paragraph>
                      </Card>
                    ) : null}
                  </div>
                </Space>
              </Card>
              <Table
                style={{ marginTop: 12 }}
                rowKey={(r) => r.rawHeader}
                pagination={{ pageSize: 8 }}
                dataSource={headerSuggestions}
                columns={[
                  { title: "上传表头", dataIndex: "rawHeader", width: 240 },
                  {
                    title: "AI建议",
                    width: 220,
                    render: (_, row) => (
                      <Tag color={row.needsConfirm ? "gold" : "green"}>
                        {row.suggestedField || "(未建议)"} / {row.confidence}
                      </Tag>
                    )
                  },
                  {
                    title: "大模型复核",
                    width: 300,
                    render: (_, row) =>
                      row.llmSuggestedField ? (
                        <div>
                          <Tag color="cyan">
                            {row.llmSuggestedField} / {row.llmConfidence ?? "-"}
                          </Tag>
                          <div style={{ color: "#888", fontSize: 12 }}>{row.llmReason || ""}</div>
                          {row.llmFullOpinion ? (
                            <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>{row.llmFullOpinion}</div>
                          ) : null}
                          {row.llmReasoningProcess?.length ? (
                            <div style={{ color: "#888", fontSize: 12 }}>
                              {row.llmReasoningProcess.slice(0, 2).map((step, idx) => (
                                <div key={`${row.rawHeader}-step-${idx}`}>{`${idx + 1}. ${step}`}</div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <Tag>无</Tag>
                      )
                  },
                  {
                    title: "确认映射到系统字段",
                    render: (_, row) => (
                      <Select
                        allowClear
                        showSearch
                        style={{ width: 280 }}
                        placeholder="选择字段或留空忽略"
                        value={headerMappingOverride[row.rawHeader] || undefined}
                        options={standardFields.map((f) => ({ label: f, value: f }))}
                        onChange={(value) =>
                          setHeaderMappingOverride((prev) => ({
                            ...prev,
                            [row.rawHeader]: value ?? ""
                          }))
                        }
                      />
                    )
                  }
                ]}
              />
            </Card>
          ) : null}

          {summary ? (
            <Card title="导入摘要">
              <Descriptions column={5}>
                <Descriptions.Item label="总行数">{summary.totalRows}</Descriptions.Item>
                <Descriptions.Item label="新增">
                  <Badge count={summary.newRows} />
                </Descriptions.Item>
                <Descriptions.Item label="变更">
                  <Badge count={summary.changedRows} />
                </Descriptions.Item>
                <Descriptions.Item label="无变化">
                  <Badge count={summary.unchangedRows} />
                </Descriptions.Item>
                <Descriptions.Item label="错误">
                  <Badge count={summary.errorRows} />
                </Descriptions.Item>
              </Descriptions>
            </Card>
          ) : null}

          {Object.keys(headerMapping).length ? (
            <Card title="表头诊断（导入识别）">
              <Space direction="vertical" style={{ width: "100%" }}>
                <div>
                  <Typography.Text strong>关键字段识别状态：</Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    {criticalHeaders.map((key) =>
                      mappedStdHeaders.has(key) ? (
                        <Tag key={key} color="green">
                          {key}
                        </Tag>
                      ) : (
                        <Tag key={key} color="red">
                          {key} (未识别)
                        </Tag>
                      )
                    )}
                  </div>
                </div>
                {missingCriticalHeaders.length ? (
                  <Typography.Text type="danger">
                    未识别关键字段：{missingCriticalHeaders.join(", ")}。这会导致入库明细对应列为空。
                  </Typography.Text>
                ) : (
                  <Typography.Text type="success">关键字段已全部识别。</Typography.Text>
                )}
                <div>
                  <Typography.Text strong>
                    原始列 {"->"} 标准列 映射：
                  </Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    {Object.entries(headerMapping).map(([raw, std]) => (
                      <Tag key={`${raw}-${std}`}>{`${raw} -> ${std}`}</Tag>
                    ))}
                  </div>
                </div>
              </Space>
            </Card>
          ) : null}

          {rows.length > 0 ? <ImportDiffTable rows={rows} /> : null}
          {audits.length > 0 ? (
            <Card title="字段级审计明细">
              <Table
                rowKey={(r) => `${r.row_no}-${r.field_name}-${r.business_key}`}
                pagination={{ pageSize: 8 }}
                dataSource={audits}
                columns={[
                  { title: "行号", dataIndex: "row_no", width: 80 },
                  { title: "业务键", dataIndex: "business_key", width: 220, ellipsis: true },
                  { title: "字段", dataIndex: "field_name", width: 140 },
                  {
                    title: "变更",
                    render: (_, row) => (
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {JSON.stringify({ before: row.before_value, after: row.after_value }, null, 2)}
                      </pre>
                    )
                  },
                  {
                    title: "应用结果",
                    render: (_, row) =>
                      row.applied ? <Tag color="green">applied</Tag> : <Tag color="red">skipped</Tag>
                  }
                ]}
                scroll={{ x: 1200 }}
              />
            </Card>
          ) : null}
          {previewRows.length > 0 ? <CommittedPreviewTable rows={previewRows} /> : null}
            </>
          ) : null}
          {workbenchView === "ocr" ? (
          <Card title="确认单 OCR 识别与房源关联">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Upload
                accept=".pdf,.png,.jpg,.jpeg"
                showUploadList={false}
                customRequest={async ({ file, onSuccess, onError }) => {
                  setOcrLoading(true);
                  try {
                    const form = new FormData();
                    form.append("file", file as File);
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
                    message.success(res.data.linked ? "已自动关联房源" : "识别完成，请确认候选房号");
                    onSuccess?.({}, new XMLHttpRequest());
                  } catch (error) {
                    onError?.(error as Error);
                    message.error("OCR 处理失败");
                  } finally {
                    setOcrLoading(false);
                  }
                }}
              >
                <Button icon={<UploadOutlined />} loading={ocrLoading}>
                  上传确认单（PDF/图片）
                </Button>
              </Upload>

              {ocrResult ? (
                <Card size="small" title={`OCR 结果（置信度: ${ocrResult.ocr.confidence}）`}>
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{ocrResult.ocr.text || "(空文本)"}</pre>
                    <Tag color={ocrResult.linked ? "green" : "orange"}>
                      {ocrResult.linked ? "已自动关联" : "待人工确认"}
                    </Tag>
                    {ocrResult.unitCandidates.length > 1 ? (
                      <>
                        <Radio.Group
                          value={selectedUnitId}
                          onChange={(e) => setSelectedUnitId(e.target.value)}
                          options={ocrResult.unitCandidates.map((c) => ({
                            label: c.unitCode,
                            value: c.unitId
                          }))}
                        />
                        <Button
                          type="primary"
                          loading={confirmingOcr}
                          disabled={!selectedUnitId || !ocrResult.fileId}
                          onClick={async () => {
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
                            } finally {
                              setConfirmingOcr(false);
                            }
                          }}
                        >
                          确认关联
                        </Button>
                      </>
                    ) : null}
                  </Space>
                </Card>
              ) : null}
            </Space>
          </Card>
          ) : null}
          {workbenchView === "copilot" ? <CopilotCard /> : null}
          </Space>
        )}
      </Content>
    </Layout>
  );
}
