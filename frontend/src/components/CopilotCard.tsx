import { Alert, Button, Card, Input, List, Space, Tag, message } from "antd";
import { useRef, useState } from "react";
import { api } from "../api/client";
import type { CopilotInterpretResponse } from "../types";

const WAIT_CONFIRM_MS = 20000;

export function CopilotCard() {
  const [text, setText] = useState("张三买了A1-1002，先付20万");
  const [result, setResult] = useState<CopilotInterpretResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const waitTimerRef = useRef<number | null>(null);

  const clearWaitTimer = () => {
    if (waitTimerRef.current != null) {
      window.clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
  };

  const scheduleWaitConfirm = () => {
    clearWaitTimer();
    waitTimerRef.current = window.setTimeout(() => {
      if (!loadingRef.current) return;
      const keepWaiting = window.confirm("AI 解析耗时较长，是否继续等待？点击“取消”将终止本次解析。");
      if (keepWaiting) {
        scheduleWaitConfirm();
      } else {
        abortRef.current?.abort();
        loadingRef.current = false;
        setLoading(false);
        message.info("已取消本次 AI 解析。");
      }
    }, WAIT_CONFIRM_MS);
  };

  const runInterpret = async () => {
    setLoading(true);
    loadingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    scheduleWaitConfirm();
    try {
      const res = await fetch(`${api.defaults.baseURL}/copilot/interpret`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": "sales",
          "x-user-id": "u_sales_1"
        },
        body: JSON.stringify({
          sessionId: "demo-session",
          input: text,
          projectId: "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa",
          attachments: [],
          clientContext: { currentPage: "ledger_entry", timezone: "Asia/Shanghai" }
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as CopilotInterpretResponse;
      setResult(data);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      message.error(error instanceof Error ? error.message : "AI 解析失败");
    } finally {
      clearWaitTimer();
      abortRef.current = null;
      loadingRef.current = false;
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
              description={result.answer || result.question}
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
