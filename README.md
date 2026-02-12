# IPMDS 2.0 - 智能工抵台账管理系统

![Version](https://img.shields.io/badge/version-v0.2.0-blue)
![Release](https://img.shields.io/badge/release-v0.2.0-success)

企业级 Web 台账系统，覆盖：
- 智能 Excel 导入比对（新增/变更/无变化）
- 一户一档与分期资金流水
- AI Copilot 自然语言录入与追问
- OCR 文件识别绑定（接口预留）

当前版本：`v0.2.0`（与 `backend/package.json`、`frontend/package.json` 同步）
版本说明：`docs/releases/v0.2.0.md`

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
psql -d ipmds -f database/migrations/003_ai_provider_settings.sql
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
- `GET /api/v1/settings/ai-providers`
- `PUT /api/v1/settings/ai-providers`
- `POST /api/v1/settings/ai-providers/probe`
- `GET /api/v1/settings/ai-prompts`
- `POST /api/v1/imports/excel/analyze-headers`
- `POST /api/v1/imports/excel/analyze-headers-stream`
- `POST /api/v1/imports/excel/confirm-mapping`
- `GET /api/v1/imports/{id}/committed-preview`

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

## 数据备份与恢复
```bash
# 1) 执行一次本地备份（默认输出到 ~/ipmds-backups）
./scripts/backup-db.sh

# 2) 指定云端上传（需先配置 rclone remote）
RCLONE_REMOTE='oss:ipmds-backups' ./scripts/backup-db.sh

# 3) 恢复示例（将备份回灌到 ipmds2）
gunzip -c ~/ipmds-backups/ipmds2_YYYY-MM-DD_HHMMSS.sql.gz | \
docker exec -i -e PGPASSWORD=ipmds_pass ipmds-postgres \
psql -h 127.0.0.1 -U ipmds_user -d ipmds2
```

定时备份（每天 02:30）：
```bash
crontab -e
```
添加：
```bash
30 2 * * * /bin/bash /Users/xpan/Desktop/Intelligent\ Project\ Mortgage\ Data\ System（IPMDS）2.0/scripts/backup-db.sh >> /tmp/ipmds-backup.log 2>&1
```

macOS 推荐使用 launchd（更稳定）：
```bash
# 安装每天 02:30 任务
./scripts/backup-launchd.sh install

# 自定义时间 + 云端上传
BACKUP_HOUR=3 BACKUP_MINUTE=15 RCLONE_REMOTE='oss:ipmds-backups' ./scripts/backup-launchd.sh install

# 查看状态
./scripts/backup-launchd.sh status

# 立即执行一次
./scripts/backup-launchd.sh run-now

# 卸载任务
./scripts/backup-launchd.sh uninstall
```

## 模式切换脚本
```bash
# 开发模式（热更新）说明
./scripts/dev-up.sh

# 停止生产栈并启动生产模式
./scripts/prod-up.sh

# 停止生产栈
./scripts/prod-down.sh
```

## 运行手册
- 见 `docs/RUNBOOK.md`

## 生产模式（Docker Compose）
```bash
# 1) 先在当前 shell 导出 API Key（示例）
export OPENAI_API_KEY=your_key
# 可选：export DEEPSEEK_API_KEY=...
# 可选：export CLAUDE_API_KEY=...

# 2) 启动生产栈（前端:8080，后端:4000）
docker compose -f docker-compose.prod.yml up -d --build

# 3) 健康检查
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:8080/healthz
```

说明：
- 生产前端镜像文件：`frontend/Dockerfile.prod`
- 生产编排文件：`docker-compose.prod.yml`
- 前端 API 基地址通过 `VITE_API_BASE_URL` 构建参数注入（默认 `/api/v1`）
