import { Card, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo } from "react";
import type { CommittedPreviewRow } from "../types";

function sourceTag(source: CommittedPreviewRow["construction_unit_source"]) {
  if (source === "imported") return <Tag color="green">导入原值</Tag>;
  if (source === "inferred_internal") return <Tag color="blue">系统推断(内部规则)</Tag>;
  if (source === "inferred_relation") return <Tag color="purple">系统推断(关联单位)</Tag>;
  if (source === "inferred_txn") return <Tag color="cyan">系统推断(流水时间)</Tag>;
  return <Tag>缺失</Tag>;
}

function humanTxnType(value: string | null) {
  if (!value) return "-";
  if (value === "adjustment") return "调整入账";
  if (value === "refund") return "退款";
  if (value === "deposit") return "定金";
  if (value === "down_payment") return "首付";
  if (value === "installment") return "分期";
  if (value === "full_payment") return "全款";
  return value;
}

function humanPaymentMethod(value: string | null) {
  if (!value) return "-";
  if (value === "full_payment") return "全款";
  if (value === "installment") return "分期";
  if (value === "mortgage") return "按揭/商贷";
  if (value === "other") return "其他";
  return value;
}

function humanUpdateSource(row: CommittedPreviewRow) {
  const src = row.last_update_source || "";
  if (src === "excel_import") return "Excel 导入";
  if (src === "ai_copilot") return "AI 对话录入";
  return "未知来源";
}

function recoverMojibake(text: string) {
  // Recover common UTF-8-as-latin1 mojibake, e.g. "GDæ´åå°è´¦.xlsx"
  try {
    // escape/unescape is deprecated but still widely supported and effective for this case.
    const recovered = decodeURIComponent(escape(text));
    return recovered || text;
  } catch {
    return text;
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const t = String(value).replace("T", " ").replace("Z", "");
    return t.length >= 19 ? t.slice(0, 19) : t;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

export function CommittedPreviewTable({ rows }: { rows: CommittedPreviewRow[] }) {
  const filters = useMemo(() => {
    const uniq = (arr: Array<string | null | undefined>) =>
      Array.from(new Set(arr.map((x) => (x ?? "").trim()).filter(Boolean))).map((v) => ({ text: v, value: v }));
    return {
      project: uniq(rows.map((r) => r.project_name)),
      status: uniq(rows.map((r) => r.status_display)),
      internalExternal: uniq(rows.map((r) => r.internal_external))
    };
  }, [rows]);

  const columns: ColumnsType<CommittedPreviewRow> = useMemo(
    () => [
      {
        title: "项目名称",
        dataIndex: "project_name",
        fixed: "left",
        width: 140,
        filters: filters.project,
        onFilter: (value, row) => (row.project_name ?? "") === value,
        sorter: (a, b) => String(a.project_name ?? "").localeCompare(String(b.project_name ?? ""))
      },
      {
        title: "房号",
        dataIndex: "unit_code",
        fixed: "left",
        width: 120,
        sorter: (a, b) => String(a.unit_code ?? "").localeCompare(String(b.unit_code ?? ""))
      },
      { title: "业态", dataIndex: "property_type", width: 100, sorter: (a, b) => String(a.property_type ?? "").localeCompare(String(b.property_type ?? "")) },
      { title: "面积", dataIndex: "area_m2", width: 100, sorter: (a, b) => Number(a.area_m2 ?? 0) - Number(b.area_m2 ?? 0) },
      { title: "成交价", dataIndex: "deal_price", width: 120, sorter: (a, b) => Number(a.deal_price ?? 0) - Number(b.deal_price ?? 0) },
      {
        title: "状态",
        dataIndex: "status_display",
        width: 160,
        filters: filters.status,
        onFilter: (value, row) => (row.status_display ?? "") === value,
        sorter: (a, b) => String(a.status_display ?? "").localeCompare(String(b.status_display ?? "")),
        render: (value: string | null) => <Tag color="blue">{value || "-"}</Tag>
      },
      { title: "状态判定依据", dataIndex: "status_basis", width: 320, ellipsis: true },
      { title: "原始状态", dataIndex: "sale_status_raw", width: 120 },
      {
        title: "内外部",
        dataIndex: "internal_external",
        width: 100,
        filters: filters.internalExternal,
        onFilter: (value, row) => (row.internal_external ?? "") === value
      },
      {
        title: "建设单位",
        width: 260,
        render: (_, row) => (
          <div>
            <div>{row.construction_unit || "-"}</div>
            <div style={{ color: "#888", fontSize: 12 }}>{row.construction_unit_inferred || ""}</div>
            {sourceTag(row.construction_unit_source)}
          </div>
        )
      },
      {
        title: "总包单位",
        width: 260,
        render: (_, row) => (
          <div>
            <div>{row.general_contractor_unit || "-"}</div>
            <div style={{ color: "#888", fontSize: 12 }}>{row.general_contractor_unit_inferred || ""}</div>
            {sourceTag(row.general_contractor_unit_source)}
          </div>
        )
      },
      {
        title: "分包单位",
        width: 260,
        render: (_, row) => (
          <div>
            <div>{row.subcontractor_unit || "-"}</div>
            <div style={{ color: "#888", fontSize: 12 }}>{row.subcontractor_unit_inferred || ""}</div>
            {sourceTag(row.subcontractor_unit_source)}
          </div>
        )
      },
      {
        title: "认购时间",
        width: 210,
        render: (_, row) => (
          <div>
            <div>{row.subscribe_date || "-"}</div>
            <div style={{ color: "#888", fontSize: 12 }}>{row.subscribe_date_inferred || ""}</div>
            {sourceTag(row.subscribe_date_source)}
          </div>
        )
      },
      {
        title: "签约时间",
        width: 210,
        render: (_, row) => (
          <div>
            <div>{row.sign_date || "-"}</div>
            <div style={{ color: "#888", fontSize: 12 }}>{row.sign_date_inferred || ""}</div>
            {sourceTag(row.sign_date_source)}
          </div>
        )
      },
      { title: "客户", dataIndex: "customer_name", width: 120 },
      { title: "联系方式", dataIndex: "phone", width: 140 },
      { title: "最新收款", dataIndex: "actual_received_latest", width: 120, sorter: (a, b) => Number(a.actual_received_latest ?? 0) - Number(b.actual_received_latest ?? 0) },
      { title: "累计收款", dataIndex: "total_received", width: 120, sorter: (a, b) => Number(a.total_received ?? 0) - Number(b.total_received ?? 0) },
      { title: "最新收款流水类型", dataIndex: "last_txn_type", width: 160, render: (v: string | null) => humanTxnType(v) },
      { title: "最新收款流水金额", dataIndex: "last_txn_amount", width: 160, sorter: (a, b) => Number(a.last_txn_amount ?? 0) - Number(b.last_txn_amount ?? 0) },
      {
        title: "最新付款方式",
        dataIndex: "last_payment_method",
        width: 160,
        render: (v: string | null) => humanPaymentMethod(v)
      },
      {
        title: "最新收款流水时间",
        dataIndex: "last_txn_occurred_at",
        width: 200,
        sorter: (a, b) =>
          new Date(a.last_txn_occurred_at ?? 0).getTime() - new Date(b.last_txn_occurred_at ?? 0).getTime(),
        render: (v: string | null) => formatDateTime(v)
      },
      {
        title: "最近更新时间",
        dataIndex: "updated_at",
        width: 200,
        sorter: (a, b) => new Date(a.updated_at ?? 0).getTime() - new Date(b.updated_at ?? 0).getTime(),
        render: (v: string | null) => formatDateTime(v)
      },
      {
        title: "更新来源",
        width: 140,
        render: (_, row) => humanUpdateSource(row)
      },
      {
        title: "来源文件/会话",
        width: 260,
        render: (_, row) => {
          const text = row.last_update_file_name || row.last_update_session_id || "-";
          return text === "-" ? text : recoverMojibake(text);
        }
      },
      { title: "最近导入批次", dataIndex: "last_import_log_id", width: 280 }
    ],
    [filters]
  );

  return (
    <Card title="入库明细预览（Excel 视图）">
      <Table
        rowKey={(r) => `${r.unit_code}-${r.last_import_log_id ?? ""}`}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 15, showSizeChanger: true }}
        scroll={{ x: 3700, y: 540 }}
        size="small"
      />
    </Card>
  );
}
