import { Badge, Button, Card, Modal, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import type { DiffRow } from "../types";

function actionColor(action: DiffRow["actionType"]) {
  if (action === "NEW") return "green";
  if (action === "CHANGED") return "gold";
  if (action === "ERROR") return "red";
  return "default";
}

export function ImportDiffTable({ rows }: { rows: DiffRow[] }) {
  const [activeRow, setActiveRow] = useState<DiffRow | null>(null);

  const columns: ColumnsType<DiffRow> = useMemo(
    () => [
      { title: "行号", dataIndex: "rowNo", width: 80 },
      {
        title: "动作",
        dataIndex: "actionType",
        width: 110,
        render: (value: DiffRow["actionType"]) => <Tag color={actionColor(value)}>{value}</Tag>
      },
      { title: "业务键", dataIndex: "businessKey", width: 240, ellipsis: true },
      {
        title: "差异字段数",
        width: 120,
        render: (_, row) => <Badge count={Object.keys(row.fieldDiffs || {}).length} />
      },
      {
        title: "差异字段",
        width: 420,
        render: (_, row) => {
          const keys = Object.keys(row.fieldDiffs || {});
          const preview = keys.slice(0, 4);
          return (
            <Space wrap size={[4, 4]}>
              {preview.map((key) => (
                <Tag key={key}>{key}</Tag>
              ))}
              {keys.length > preview.length ? <Tag>+{keys.length - preview.length}</Tag> : null}
            </Space>
          );
        }
      },
      {
        title: "操作",
        width: 110,
        render: (_, row) => (
          <Button size="small" onClick={() => setActiveRow(row)}>
            查看详情
          </Button>
        )
      }
    ],
    []
  );

  return (
    <Card title="Excel 比对结果（支持高亮新增/变更）">
      <Table
        rowKey={(r) => `${r.rowNo}-${r.businessKey}`}
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 12 }}
        scroll={{ x: 1200 }}
        size="small"
      />
      <Modal
        title={activeRow ? `差异详情 - 行 ${activeRow.rowNo}` : "差异详情"}
        open={Boolean(activeRow)}
        onCancel={() => setActiveRow(null)}
        footer={null}
        width={920}
      >
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", maxHeight: 520, overflow: "auto" }}>
          {JSON.stringify(activeRow?.fieldDiffs ?? {}, null, 2)}
        </pre>
      </Modal>
    </Card>
  );
}
