import React, { useCallback, useRef, useState } from "react";
import { Alert, Button, Card, Descriptions, Empty, Input, List, Space, Spin, Tag, Typography, message } from "antd";
import { LoadingOutlined, RobotOutlined, SendOutlined } from "@ant-design/icons";
import { api } from "../api/client";
import type { CopilotInterpretResponse } from "../types";
import { TIMEOUT } from "../constants";

// 草稿操作展示组件
const DraftActionCard = React.memo(function DraftActionCard({ 
  action 
}: { 
  action: CopilotInterpretResponse["draftAction"] 
}) {
  return (
    <Card size="small" title="解析结果" style={{ background: "#f6ffed" }}>
      <Descriptions column={1} size="small">
        <Descriptions.Item label="意图">{action.intent}</Descriptions.Item>
        <Descriptions.Item label="数据">
          <pre style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(action.payload, null, 2)}</pre>
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
});

// 候选项列表组件
const CandidateList = React.memo(function CandidateList({ 
  candidates 
}: { 
  candidates: NonNullable<CopilotInterpretResponse["candidateMatches"]> 
}) {
  return (
    <List
      size="small"
      bordered
      header="候选匹配"
      dataSource={candidates}
      renderItem={(item) => (
        <List.Item>
          <Space>
            <Typography.Text strong>{item.canonical}</Typography.Text>
            <Tag color="blue">{item.score}分</Tag>            <Typography.Text type="secondary">{item.reason}</Typography.Text>
          </Space>
        </List.Item>
      )}
    />
  );
});

// 主组件
export const CopilotCard = React.memo(function CopilotCard() {
  const [text, setText] = useState("张三买了A1-1002，先付20万");
  const [result, setResult] = useState<CopilotInterpretResponse | null>(null);
  const [loading, setLoading] = useState(false);
  
  const loadingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const waitTimerRef = useRef<number | null>(null);

  const clearWaitTimer = useCallback(() => {
    if (waitTimerRef.current != null) {
      window.clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
  }, []);

  const scheduleWaitConfirm = useCallback(() => {
    clearWaitTimer();
    waitTimerRef.current = window.setTimeout(() => {
      if (!loadingRef.current) return;
      const keepWaiting = window.confirm(
        "AI 解析耗时较长，是否继续等待？点击「取消」将终止本次解析。"
      );
      if (keepWaiting) {
        scheduleWaitConfirm();
      } else {
        abortRef.current?.abort();
        loadingRef.current = false;
        setLoading(false);
        message.info("已取消本次 AI 解析。");
      }
    }, TIMEOUT.COPILOT_WAIT_MS);
  }, [clearWaitTimer]);

  const runInterpret = useCallback(async () => {
    if (!text.trim()) {
      message.warning("请输入描述内容");
      return;
    }

    setLoading(true);
    loadingRef.current = true;
    setResult(null);
    
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
          input: text.trim(),
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
  }, [text, scheduleWaitConfirm, clearWaitTimer]);

  return (
    <Card 
      title={
        <Space>
          <RobotOutlined />
          <span>AI Copilot 录入</span>
        </Space>
      } 
      extra={<Tag color="processing">多模型主备</Tag>}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="large">
        <Input.TextArea 
          value={text} 
          rows={3} 
          onChange={(e) => setText(e.target.value)}
          placeholder="请输入自然语言描述，例如：张三买了A1-1002，先付20万"
          showCount
          maxLength={500}
        />
        
        <Button 
          loading={loading} 
          type="primary" 
          icon={<SendOutlined />}
          onClick={runInterpret}
          size="large"
          block
        >
          解析
        </Button>

        {loading && !result && (
          <div style={{ textAlign: "center", padding: 24 }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
            <Typography.Text style={{ display: "block", marginTop: 12 }} type="secondary">
              AI 正在解析，请稍候...
            </Typography.Text>
          </div>
        )}
        
        {result && (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Alert
              type={result.status === "ready_to_confirm" ? "success" : "warning"}
              message={result.status === "ready_to_confirm" ? "✅ 可确认写入" : "⚠️ 需要补充信息"}
              description={result.answer || result.question}
              showIcon
            />
            
            <DraftActionCard action={result.draftAction} />
            
            {result.options && result.options.length > 0 && (
              <Card size="small" title="可选补充项">
                <Space wrap>
                  {result.options.map((opt) => (
                    <Tag key={opt} color="orange">{opt}</Tag>
                  ))}
                </Space>
              </Card>
            )}
            
            {result.candidateMatches && result.candidateMatches.length > 0 && (
              <CandidateList candidates={result.candidateMatches} />
            )}
          </Space>
        )}

        {!result && !loading && (
          <Empty 
            image={Empty.PRESENTED_IMAGE_SIMPLE} 
            description="输入自然语言描述后点击解析"
          />
        )}
      </Space>
    </Card>
  );
});
