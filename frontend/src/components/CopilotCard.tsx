import { Alert, Button, Card, Input, List, Space, Tag } from "antd";
import { useState } from "react";
import { api } from "../api/client";
import type { CopilotInterpretResponse } from "../types";

export function CopilotCard() {
  const [text, setText] = useState("张三买了A1-1002，先付20万");
  const [result, setResult] = useState<CopilotInterpretResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const runInterpret = async () => {
    setLoading(true);
    try {
      const res = await api.post<CopilotInterpretResponse>("/copilot/interpret", {
        sessionId: "demo-session",
        input: text,
        projectId: "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa",
        attachments: [],
        clientContext: { currentPage: "ledger_entry", timezone: "Asia/Shanghai" }
      });
      setResult(res.data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="AI Copilot 录入" extra={<Tag color="processing">多模型主备</Tag>}>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Input.TextArea value={text} rows={3} onChange={(e) => setText(e.target.value)} />
        <Button loading={loading} type="primary" onClick={runInterpret}>
          解析
        </Button>
        {result && (
          <>
            <Alert
              type={result.status === "ready_to_confirm" ? "success" : "warning"}
              message={result.status === "ready_to_confirm" ? "可确认写入" : "需要补充信息"}
              description={result.question}
            />
            <pre>{JSON.stringify(result.draftAction, null, 2)}</pre>
            {result.candidateMatches?.length ? (
              <List
                size="small"
                bordered
                dataSource={result.candidateMatches}
                renderItem={(item) => (
                  <List.Item>
                    {item.canonical} ({item.score}) - {item.reason}
                  </List.Item>
                )}
              />
            ) : null}
          </>
        )}
      </Space>
    </Card>
  );
}
