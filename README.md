# IPMDS 2.0 - 智能工抵台账管理系统

![Version](https://img.shields.io/badge/version-v0.1.0-blue)
![Release](https://img.shields.io/badge/release-v0.1.0-success)

企业级 Web 台账系统，覆盖：
- 智能 Excel 导入比对（新增/变更/无变化）
- 一户一档与分期资金流水
- AI Copilot 自然语言录入与追问
- OCR 文件识别绑定（接口预留）

当前版本：`v0.1.0`（与 `backend/package.json`、`frontend/package.json` 同步）

## 目录
- `frontend/`: React + Ant Design
- `backend/`: Node.js API Gateway (TypeScript)
- `python-service/`: Python 数据处理微服务 (FastAPI + Pandas)
- `database/migrations/001_init.sql`: PostgreSQL schema
- `docs/PRD-core.md`: PRD 核心与架构图

## 快速启动

### 1) 数据库
```bash
createdb ipmds
psql -d ipmds -f database/migrations/001_init.sql
psql -d ipmds -f database/migrations/002_import_change_audits.sql
```

### 2) Python 数据服务
```bash
cd python-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 3) Node 网关
```bash
cd backend
cp .env.example .env
# 根据本地环境修改 DATABASE_URL
npm install
npm run dev
```

### 4) 前端
```bash
cd frontend
npm install
npm run dev
```

## 核心接口
- `POST /api/v1/copilot/interpret`
- `POST /api/v1/copilot/commit`
- `POST /api/v1/imports/excel`
- `GET /api/v1/imports/{id}/diff`
- `POST /api/v1/imports/{id}/commit`
- `POST /api/v1/imports/{id}/rollback`
- `POST /api/v1/files/ocr-link`
- `POST /api/v1/files/{id}/confirm-link`

## RBAC（请求头）
- 通过请求头传递身份（开发环境）：
  - `x-user-role`: `admin | finance | sales | auditor`
  - `x-user-id`: 任意用户标识（可选，默认 `system`）
- 角色矩阵（当前）：
  - `imports/excel, imports/{id}/commit, imports/{id}/rollback`：`admin, finance`
  - `imports/{id}/diff`：`admin, finance, sales, auditor`（`auditor` 自动脱敏）
  - `copilot/interpret`：`admin, finance, sales, auditor`
  - `copilot/commit`：`admin, finance, sales`
  - `files/ocr-link`：`admin, finance, sales`

## 说明
- 当前默认 `MOCK_MODE=true`，便于无数据库联调 API。
- 生产模式请设置 `MOCK_MODE=false` 并接入真实 PostgreSQL。
- OCR 当前对可提取文本的 PDF 识别效果较好，图片 OCR 预留后续接入。

## 测试
```bash
cd backend
npm test
```

## 一键校验
```bash
./scripts/verify-all.sh
```

## 运行手册
- 见 `docs/RUNBOOK.md`
