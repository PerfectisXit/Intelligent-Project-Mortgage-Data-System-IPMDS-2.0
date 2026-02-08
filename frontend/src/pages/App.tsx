import {
  Badge,
  Button,
  Card,
  Descriptions,
  Layout,
  Segmented,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useState } from "react";
import { api } from "../api/client";
import { ApiSettingsPage } from "../components/ApiSettingsPage";
import { CopilotCard } from "../components/CopilotCard";
import { ImportDiffTable } from "../components/ImportDiffTable";
import type { DiffRow, ImportAuditRow, ImportSummary, OcrLinkResponse } from "../types";

const { Header, Content } = Layout;

export default function App() {
  const [view, setView] = useState<"workbench" | "api-settings">("workbench");
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [importLogId, setImportLogId] = useState<string>("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [audits, setAudits] = useState<ImportAuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [loadingAudits, setLoadingAudits] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [confirmingOcr, setConfirmingOcr] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrLinkResponse | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");

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
          <Card title="智能导入与比对">
            <Upload
              accept=".xlsx,.xls"
              showUploadList={false}
              customRequest={async ({ file, onSuccess, onError }) => {
                setLoading(true);
                try {
                  const form = new FormData();
                  form.append("file", file as File);
                  form.append("organizationId", "9f4af2dc-7f29-4e91-aa74-68db4f9e6f9b");
                  form.append("projectId", "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa");
                  const res = await api.post<{
                    importLogId: string;
                    rows: DiffRow[];
                    summary: ImportSummary;
                  }>("/imports/excel", form, {
                    headers: {
                      "Content-Type": "multipart/form-data",
                      "x-user-role": "finance",
                      "x-user-id": "u_finance_1"
                    }
                  });
                  setImportLogId(res.data.importLogId);
                  setRows(res.data.rows || []);
                  setSummary(res.data.summary || null);
                  setAudits([]);
                  onSuccess?.({}, new XMLHttpRequest());
                  message.success("上传并比对完成");
                } catch (error) {
                  onError?.(error as Error);
                  message.error("上传失败");
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Button icon={<UploadOutlined />} loading={loading} type="primary">
                上传 Excel 并自动比对
              </Button>
            </Upload>

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
              </Space>
            ) : null}
          </Card>

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
          <CopilotCard />
          </Space>
        )}
      </Content>
    </Layout>
  );
}
