import { useMemo } from "react";
import {
  Card,
  Button,
  Space,
  Alert,
  Table,
  Select,
  Tag,
  Steps,
  Typography,
  List
} from "antd";
import type { HeaderSuggestion, LlmOutputItem, LlmTrace, StageStatus } from "../../hooks";

interface HeaderMappingCardProps {
  uploadToken: string;
  headerSuggestions: HeaderSuggestion[];
  standardFields: string[];
  headerMappingOverride: Record<string, string>;
  headerReviewMode: "rules_only" | "rules_plus_llm";
  headerReviewNotes: string[];
  llmOutput: LlmOutputItem[];
  llmOverallOpinion: string;
  llmTrace: LlmTrace | null;
  stageStatus: StageStatus | null;
  confirmingMapping: boolean;
  onMappingChange: (rawHeader: string, value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const toStepStatus = (status: "done" | "process" | "wait" | "error" | "warning" | "skipped") => {
  if (status === "done") return "finish";
  if (status === "warning") return "error";
  if (status === "skipped") return "wait";
  return status;
};

export function HeaderMappingCard({
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
  onMappingChange,
  onCancel,
  onConfirm
}: HeaderMappingCardProps) {
  const stageCurrent = useMemo(() => {
    if (!stageStatus) return 0;
    if (
      stageStatus.llmReviewStage.status === "done" ||
      stageStatus.llmReviewStage.status === "warning" ||
      stageStatus.llmReviewStage.status === "skipped"
    ) {
      return 1;
    }
    return 0;
  }, [stageStatus]);

  const llmStageAntStatus = useMemo(() => {
    if (!stageStatus) return "finish";
    return toStepStatus(stageStatus.llmReviewStage.status);
  }, [stageStatus]);

  if (!uploadToken || headerSuggestions.length === 0) return null;

  return (
    <Card
      title="表头映射确认"
      extra={
        <Space>
          <Button onClick={onCancel}>取消本次导入</Button>
          <Button type="primary" loading={confirmingMapping} onClick={onConfirm}>
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

      {stageStatus && (
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
      )}

      {headerReviewNotes.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {headerReviewNotes.map((note) => (
            <Tag key={note} color="blue">{note}</Tag>
          ))}
        </div>
      )}

      {/* LLM 审核结果 */}
      {llmOutput.length > 0 && (
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
                        {item.error && <Typography.Text type="danger">{item.error}</Typography.Text>}
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
                        {row.fullOpinion && <div style={{ marginTop: 4 }}>{row.fullOpinion}</div>}
                        {row.reasoningProcess?.length > 0 && (
                          <div style={{ marginTop: 4, color: "#666", fontSize: 12 }}>
                            {row.reasoningProcess.map((step, idx) => (
                              <div key={idx}>{`${idx + 1}. ${step}`}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  }
                ]}
              />

              {llmOverallOpinion && (
                <Card style={{ marginTop: 8 }} size="small" title="大模型总体意见">
                  <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                    {llmOverallOpinion}
                  </Typography.Paragraph>
                </Card>
              )}
            </div>
          </Space>
        </Card>
      )}

      {/* 表头映射表 */}
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
                  {row.llmReason && <div style={{ color: "#888", fontSize: 12 }}>{row.llmReason}</div>}
                  {row.llmFullOpinion && (
                    <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>{row.llmFullOpinion}</div>
                  )}
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
                onChange={(value) => onMappingChange(row.rawHeader, value ?? "")}
              />
            )
          }
        ]}
      />
    </Card>
  );
}
