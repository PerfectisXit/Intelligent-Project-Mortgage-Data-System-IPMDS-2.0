import { Card, List, Space, Tag, Badge, Spin } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import type { StreamEvent } from "../../hooks";

interface StreamLogPanelProps {
  streaming: boolean;
  events: StreamEvent[];
}

const LOG_LEVEL_COLORS = {
  ok: "green",
  error: "red",
  info: "blue"
} as const;

export function StreamLogPanel({ streaming, events }: StreamLogPanelProps) {
  if (!streaming && events.length === 0) return null;

  return (
    <Card
      size="small"
      className="stream-log-card"
      style={{ marginTop: 12, background: "#fafafa", border: "1px solid #f0f0f0" }}
      title={
        <Space>
          {streaming && <Spin indicator={<LoadingOutlined spin />} />}
          <span>实时处理日志</span>
          {events.length > 0 && (
            <Badge
              count={events.length}
              style={{ backgroundColor: streaming ? "#1890ff" : "#52c41a" }}
            />
          )}
        </Space>
      }
    >
      <List
        size="small"
        locale={{ emptyText: "等待日志..." }}
        dataSource={events}
        renderItem={(item) => (
          <List.Item
            style={{
              borderLeft: `3px solid ${
                item.level === "ok"
                  ? "#52c41a"
                  : item.level === "error"
                  ? "#ff4d4f"
                  : "#1890ff"
              }`,
              paddingLeft: 8
            }}
          >
            <Space>
              <Tag
                color={LOG_LEVEL_COLORS[item.level]}
                style={{ minWidth: 80, textAlign: "center" }}
              >
                {item.ts}
              </Tag>
              <span>{item.text}</span>
            </Space>
          </List.Item>
        )}
      />
    </Card>
  );
}
