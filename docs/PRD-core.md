# 智能工抵台账管理系统 PRD 核心

## 整体架构
```mermaid
flowchart LR
  U[业务用户] --> FE[React + Ant Design 前端]
  FE -->|JWT + REST/WebSocket| API[Node.js API Gateway]
  API -->|SQL| PG[(PostgreSQL<br/>3NF + JSONB + pgvector)]
  API -->|HTTP/gRPC| PY[Python Data Service<br/>Pandas/OCR/Chart]
  PY -->|回传 diff/清洗结果/图表| API
  API -->|Model Router| AI[LLM Providers<br/>OpenAI/DeepSeek/Claude]
  API --> OSS[对象存储<br/>PDF/图片/导出包]
  PY --> OSS
  API --> MQ[(可选任务队列<br/>导入/OCR异步任务)]
```

## AI 状态机
```mermaid
stateDiagram-v2
  [*] --> ReceiveInput
  ReceiveInput --> ParseIntent: 调用LLM结构化解析
  ParseIntent --> ValidateEntities
  ValidateEntities --> NeedClarify: 关键字段缺失/歧义
  ValidateEntities --> ReadyToConfirm: 信息完整且置信度达标
  NeedClarify --> AskUser: 生成追问问题
  AskUser --> ReceiveInput: 用户补充信息
  ReadyToConfirm --> UserConfirm: 前端确认卡片
  UserConfirm --> PersistDB: 写入Units/Transactions/Files
  PersistDB --> Success
  UserConfirm --> Cancelled: 用户取消
  Success --> [*]
  Cancelled --> [*]
```

## 导入差异策略
- 表头映射：同义词字典 + 模糊匹配
- 主匹配键：`project + unit_code`
- 辅助键：`customer_name + amount + sign_date`
- 差异输出：`NEW/CHANGED/UNCHANGED/ERROR + field_diffs`

## 消歧策略
- 召回：别名字典 + 模糊检索 + 历史命中
- 判定：Top1 分数阈值与 Top1-Top2 差值阈值
- 交互：候选列表确认后再提交入库
