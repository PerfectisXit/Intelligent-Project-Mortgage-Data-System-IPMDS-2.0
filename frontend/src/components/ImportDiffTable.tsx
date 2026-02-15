import React, { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Descriptions, Input, Modal, Segmented, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DiffRow } from "../types";

// 动作类型颜色映射
const ACTION_COLORS: Record<DiffRow["actionType"], string> = {
  NEW: "green",
  CHANGED: "gold",
  UNCHANGED: "default",
  ERROR: "red"
};

// 动作类型中文映射
const ACTION_LABELS: Record<DiffRow["actionType"], string> = {
  NEW: "新增",
  CHANGED: "变更",
  UNCHANGED: "无变化",
  ERROR: "错误"
};

const FIELD_LABELS: Record<string, string> = {
  project: "项目",
  property_type: "业态",
  unit_code: "房号",
  customer_name: "客户名称",
  rename_status_raw: "是否更名",
  sale_status: "销售状态",
  subscribe_date: "认购日期",
  sign_date: "签约日期",
  area_m2: "实测面积",
  deal_price_per_m2: "成交单价",
  deal_price: "成交总价",
  payment_method: "付款方式",
  payment_method_std: "付款方式(标准化)",
  actual_received: "实际收款",
  receipt_ratio_input: "收款比例",
  undelivered_amount: "未达款",
  undelivered_note: "未达款说明",
  internal_external: "内外部",
  construction_unit: "建设单位",
  general_contractor_unit: "总包单位",
  subcontractor_unit: "分包单位",
  phone: "联系方式",
  id_card: "身份证号",
  address: "地址"
};

function displayFieldName(field: string): string {
  return FIELD_LABELS[field] ? `${FIELD_LABELS[field]} (${field})` : field;
}

function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseFieldValue(raw: string): unknown {
  const text = raw.trim();
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    return Number(text);
  }
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try {
      return JSON.parse(text);
    } catch {
      return raw;
    }
  }
  return raw;
}

interface DiffDetailProps {
  row: DiffRow;
}

// 差异详情组件
function DiffDetail({ row }: DiffDetailProps) {
  const diffEntries = Object.entries(row.fieldDiffs || {});

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="行号">{row.rowNo}</Descriptions.Item>
        <Descriptions.Item label="业务键">{row.businessKey}</Descriptions.Item>
        <Descriptions.Item label="动作">
          <Tag color={ACTION_COLORS[row.actionType]}>{ACTION_LABELS[row.actionType]}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="实体类型">{row.entityType}</Descriptions.Item>
      </Descriptions>

      {diffEntries.length > 0 ? (
        <Card extra={<Button type="link" onClick={() => {}} size="small">关闭</Button>} size="small" title={`差异字段 (${diffEntries.length})`}>
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            {diffEntries.map(([fieldName, diff]) => (
              <div key={fieldName} style={{ marginBottom: 12 }}>
                <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
                  {displayFieldName(fieldName)}
                </Typography.Text>
                <Space direction="vertical" style={{ width: "100%", paddingLeft: 16 }}>
                  <div>
                    <Tag color="red">修改前</Tag>
                    <Typography.Text code style={{ marginLeft: 8 }}>
                      {diff.before === null || diff.before === undefined ? "(空)" : String(diff.before)}
                    </Typography.Text>
                  </div>
                  <div>
                    <Tag color="green">修改后</Tag>
                    <Typography.Text code style={{ marginLeft: 8 }}>
                      {diff.after === null || diff.after === undefined ? "(空)" : String(diff.after)}
                    </Typography.Text>
                  </div>
                </Space>
              </div>
            ))}
          </Space>
        </Card>
      ) : (
        <Typography.Text type="secondary">该行无字段差异，可能是解析/校验错误。</Typography.Text>
      )}

      {row.errorMessage && (
        <Alert type="error" message="错误信息" description={row.errorMessage} />
      )}
    </Space>
  );
}

interface ImportDiffTableProps {
  rows: DiffRow[];
  fixingRow?: boolean;
  onManualFixRow?: (
    rowNo: number,
    afterData: Record<string, unknown>,
    actionType?: "NEW" | "CHANGED"
  ) => Promise<boolean>;
}

// 主表格组件
export const ImportDiffTable = React.memo(function ImportDiffTable({
  rows,
  fixingRow = false,
  onManualFixRow
}: ImportDiffTableProps) {
  const [activeRow, setActiveRow] = useState<DiffRow | null>(null);
  const [actionFilter, setActionFilter] = useState<DiffRow["actionType"] | null>(null);
  const [manualFixOpen, setManualFixOpen] = useState(false);
  const [manualFixAction, setManualFixAction] = useState<"NEW" | "CHANGED">("NEW");
  const [manualFixEditorMode, setManualFixEditorMode] = useState<"form" | "json">("form");
  const [manualFixJson, setManualFixJson] = useState("");
  const [manualFixDraft, setManualFixDraft] = useState<Record<string, string>>({});
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");

  // 统计数据
  const stats = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc[row.actionType]++;
        return acc;
      },
      { NEW: 0, CHANGED: 0, UNCHANGED: 0, ERROR: 0 } as Record<DiffRow["actionType"], number>
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!actionFilter) return rows;
    return rows.filter((row) => row.actionType === actionFilter);
  }, [rows, actionFilter]);

  const columns: ColumnsType<DiffRow> = useMemo(
    () => [
      {
        title: "行号",
        dataIndex: "rowNo",
        width: 80,
        sorter: (a, b) => a.rowNo - b.rowNo
      },
      {
        title: "动作",
        dataIndex: "actionType",
        width: 100,
        render: (value: DiffRow["actionType"]) => (
          <Tag color={ACTION_COLORS[value]}>{ACTION_LABELS[value]}</Tag>
        ),
        filters: [
          { text: `新增 (${stats.NEW})`, value: "NEW" },
          { text: `变更 (${stats.CHANGED})`, value: "CHANGED" },
          { text: `无变化 (${stats.UNCHANGED})`, value: "UNCHANGED" },
          { text: `错误 (${stats.ERROR})`, value: "ERROR" }
        ],
        filteredValue: actionFilter ? [actionFilter] : null,
        onFilter: (value, record) => record.actionType === value
      },
      {
        title: "业务键",
        dataIndex: "businessKey",
        width: 240,
        ellipsis: true
      },
      {
        title: "差异字段数",
        width: 120,
        align: "center",
        render: (_, row) => {
          const count = Object.keys(row.fieldDiffs || {}).length;
          return count > 0 ? <Badge count={count} showZero /> : "-";
        },
        sorter: (a, b) => Object.keys(a.fieldDiffs || {}).length - Object.keys(b.fieldDiffs || {}).length
      },
      {
        title: "差异字段",
        width: 400,
        render: (_, row) => {
          const keys = Object.keys(row.fieldDiffs || {});
          if (keys.length === 0) return <Typography.Text type="secondary">-</Typography.Text>;

          const preview = keys.slice(0, 4);
          return (
            <Space wrap size={[4, 4]}>
              {preview.map((key) => (
                <Tag key={key}>{FIELD_LABELS[key] ?? key}</Tag>
              ))}
              {keys.length > preview.length ? <Tag>+{keys.length - preview.length}</Tag> : null}
            </Space>
          );
        }
      },
      {
        title: "操作",
        align: "right",
        render: (_, row) => (
          <Button size="small" type="primary" onClick={() => setActiveRow(row)}>
            查看详情
          </Button>
        )
      }
    ],
    [stats, actionFilter]
  );

  return (
    <Card
      title={
        <Space>
          <span>Excel 比对结果</span>
          <Tag
            color={actionFilter === "NEW" ? "green" : "default"}
            style={{ cursor: "pointer" }}
            onClick={() => setActionFilter((prev) => (prev === "NEW" ? null : "NEW"))}
          >
            新增 {stats.NEW}
          </Tag>
          <Tag
            color={actionFilter === "CHANGED" ? "gold" : "default"}
            style={{ cursor: "pointer" }}
            onClick={() => setActionFilter((prev) => (prev === "CHANGED" ? null : "CHANGED"))}
          >
            变更 {stats.CHANGED}
          </Tag>
          <Tag
            color={actionFilter === "UNCHANGED" ? "blue" : "default"}
            style={{ cursor: "pointer" }}
            onClick={() => setActionFilter((prev) => (prev === "UNCHANGED" ? null : "UNCHANGED"))}
          >
            无变化 {stats.UNCHANGED}
          </Tag>
          <Tag
            color={actionFilter === "ERROR" ? "red" : "default"}
            style={{ cursor: "pointer" }}
            onClick={() => setActionFilter((prev) => (prev === "ERROR" ? null : "ERROR"))}
          >
            错误 {stats.ERROR}
          </Tag>
          {actionFilter ? (
            <Button size="small" type="link" onClick={() => setActionFilter(null)}>
              清除筛选
            </Button>
          ) : null}
        </Space>
      }
    >
      <Table
        rowKey={(r) => `${r.rowNo}-${r.businessKey}`}
        dataSource={filteredRows}
        columns={columns}
        onChange={(_, filters) => {
          const values = filters.actionType as Array<DiffRow["actionType"]> | null | undefined;
          if (!values || values.length === 0) {
            setActionFilter(null);
            return;
          }
          setActionFilter(values[0]);
        }}
        pagination={{
          pageSize: 12,
          showSizeChanger: true,
          pageSizeOptions: ["12", "24", "48"]
        }}
        scroll={{ x: 1200 }}
        size="small"
        summary={() => (
          <Table.Summary fixed="bottom">
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6}>
                <Typography.Text strong>
                  当前显示 {filteredRows.length} / 总计 {rows.length} 行：新增 {stats.NEW} | 变更 {stats.CHANGED} | 无变化 {stats.UNCHANGED} | 错误 {stats.ERROR}
                </Typography.Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />

      <Modal
        title={activeRow ? `差异详情 - 第 ${activeRow.rowNo} 行` : "差异详情"}
        open={Boolean(activeRow)}
        onCancel={() => setActiveRow(null)}
        footer={null}
        width={800}
        destroyOnClose
      >
        {activeRow && (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <DiffDetail row={activeRow} />
            {activeRow.actionType === "ERROR" && onManualFixRow ? (
              <Button
                type="primary"
                onClick={() => {
                  setManualFixAction(activeRow.beforeData ? "CHANGED" : "NEW");
                  const source = (activeRow.afterData ?? {}) as Record<string, unknown>;
                  const draft = Object.fromEntries(
                    Object.entries(source).map(([k, v]) => [k, stringifyFieldValue(v)])
                  );
                  setManualFixDraft(draft);
                  setManualFixJson(JSON.stringify(source, null, 2));
                  setManualFixEditorMode("form");
                  setNewFieldKey("");
                  setNewFieldValue("");
                  setManualFixOpen(true);
                }}
              >
                手动修正并确认
              </Button>
            ) : null}
          </Space>
        )}
      </Modal>

      <Modal
        title={activeRow ? `手动修正 - 第 ${activeRow.rowNo} 行` : "手动修正"}
        open={manualFixOpen}
        onCancel={() => setManualFixOpen(false)}
        onOk={async () => {
          if (!activeRow || !onManualFixRow) return;
          try {
            const parsed =
              manualFixEditorMode === "json"
                ? JSON.parse(manualFixJson)
                : Object.fromEntries(
                    Object.entries(manualFixDraft).map(([k, v]) => [k, parseFieldValue(v)])
                  );
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              message.error("afterData 必须是 JSON 对象");
              return;
            }
            const ok = await onManualFixRow(activeRow.rowNo, parsed as Record<string, unknown>, manualFixAction);
            if (ok) {
              setManualFixOpen(false);
              setActiveRow(null);
            }
          } catch {
            message.error("JSON 格式错误，请检查后再提交");
          }
        }}
        okText="确认修正"
        cancelText="取消"
        confirmLoading={fixingRow}
        width={860}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Alert
            type="info"
            showIcon
            message="逐条手动修正"
            description="请修改该行 afterData 的 JSON 内容，然后确认。修正后该行将从 ERROR 转为可提交状态。"
          />
          <div>
            <Typography.Text strong>修正后动作类型：</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <Segmented
                value={manualFixAction}
                onChange={(v) => setManualFixAction(v as "NEW" | "CHANGED")}
                options={[
                  { label: "按新增处理 (NEW)", value: "NEW" },
                  { label: "按变更处理 (CHANGED)", value: "CHANGED" }
                ]}
              />
            </div>
          </div>
          <div>
            <Typography.Text strong>afterData(JSON)：</Typography.Text>
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <Segmented
                value={manualFixEditorMode}
                onChange={(v) => {
                  const nextMode = v as "form" | "json";
                  if (nextMode === "json") {
                    const parsed = Object.fromEntries(
                      Object.entries(manualFixDraft).map(([k, val]) => [k, parseFieldValue(val)])
                    );
                    setManualFixJson(JSON.stringify(parsed, null, 2));
                  } else {
                    try {
                      const parsed = JSON.parse(manualFixJson) as Record<string, unknown>;
                      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                        const draft = Object.fromEntries(
                          Object.entries(parsed).map(([k, val]) => [k, stringifyFieldValue(val)])
                        );
                        setManualFixDraft(draft);
                      }
                    } catch {
                      // keep current draft when json is invalid
                    }
                  }
                  setManualFixEditorMode(nextMode);
                }}
                options={[
                  { label: "字段表单", value: "form" },
                  { label: "JSON", value: "json" }
                ]}
              />
            </div>
            {manualFixEditorMode === "form" ? (
              <Space direction="vertical" style={{ width: "100%" }} size="small">
                {Object.entries(manualFixDraft).map(([field, value]) => (
                  <Space key={field} style={{ width: "100%" }} align="start">
                    <Typography.Text code style={{ minWidth: 220 }}>{displayFieldName(field)}</Typography.Text>
                    <Input
                      value={value}
                      onChange={(e) =>
                        setManualFixDraft((prev) => ({ ...prev, [field]: e.target.value }))
                      }
                    />
                    <Button
                      danger
                      onClick={() =>
                        setManualFixDraft((prev) => {
                          const next = { ...prev };
                          delete next[field];
                          return next;
                        })
                      }
                    >
                      删除
                    </Button>
                  </Space>
                ))}
                <Space style={{ width: "100%" }}>
                  <Input
                    placeholder="新增字段名"
                    value={newFieldKey}
                    onChange={(e) => setNewFieldKey(e.target.value.trim())}
                  />
                  <Input
                    placeholder="字段值（支持 null/true/false/数字/JSON）"
                    value={newFieldValue}
                    onChange={(e) => setNewFieldValue(e.target.value)}
                  />
                  <Button
                    onClick={() => {
                      if (!newFieldKey) {
                        message.warning("请先填写字段名");
                        return;
                      }
                      setManualFixDraft((prev) => ({ ...prev, [newFieldKey]: newFieldValue }));
                      setNewFieldKey("");
                      setNewFieldValue("");
                    }}
                  >
                    新增字段
                  </Button>
                </Space>
                <Typography.Text type="secondary">
                  提示：输入 `null` / `true` / `false` / 数字会按对应类型提交；对象或数组可填 JSON 字符串。
                </Typography.Text>
              </Space>
            ) : (
              <Input.TextArea
                value={manualFixJson}
                onChange={(e) => setManualFixJson(e.target.value)}
                autoSize={{ minRows: 12, maxRows: 20 }}
                spellCheck={false}
              />
            )}
          </div>
        </Space>
      </Modal>
    </Card>
  );
});
