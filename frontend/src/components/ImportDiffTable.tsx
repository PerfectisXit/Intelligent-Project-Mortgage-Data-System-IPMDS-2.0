import { Badge, Card, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DiffRow } from "../types";

function actionColor(action: DiffRow["actionType"]) {
  if (action === "NEW") return "green";
  if (action === "CHANGED") return "gold";
  if (action === "ERROR") return "red";
  return "default";
}

const columns: ColumnsType<DiffRow> = [
  { title: "行号", dataIndex: "rowNo", width: 80 },
  {
    title: "动作",
    dataIndex: "actionType",
    render: (value: DiffRow["actionType"]) => <Tag color={actionColor(value)}>{value}</Tag>
  },
  { title: "业务键", dataIndex: "businessKey", ellipsis: true },
  {
    title: "差异字段数",
    render: (_, row) => <Badge count={Object.keys(row.fieldDiffs || {}).length} />
  },
  {
    title: "差异明细",
    render: (_, row) => (
      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(row.fieldDiffs, null, 2)}</pre>
    )
  }
];

export function ImportDiffTable({ rows }: { rows: DiffRow[] }) {
  return (
    <Card title="Excel 比对结果（支持高亮新增/变更）">
      <Table
        rowKey={(r) => `${r.rowNo}-${r.businessKey}`}
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 8 }}
        scroll={{ x: 1200 }}
      />
    </Card>
  );
}
