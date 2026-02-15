# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1] - 2026-02-15
### Added
- 导入错误“逐条手动修正并确认”能力：
  - 新增接口 `POST /api/v1/imports/{id}/rows/{rowNo}/manual-fix`
  - 支持将 `ERROR` 行修正为 `NEW/CHANGED` 并实时重算导入摘要计数
  - 前端新增错误详情中的手动修正弹窗（字段表单 + JSON 双模式）
- 导入错误修正界面新增中文字段名展示（中文 + 英文键），降低手动修正门槛。
- 新增 `zai_coding` 独立服务商配置（与 `zai` 常规 API 完全独立开关/密钥/模型/探测）。
- 新增 `v0.2.1` 中文发布说明：`docs/releases/v0.2.1.md`。

### Changed
- AI 提供商设置页重构：
  - 服务商改为下拉选择，页面不再长列表展开
  - 模型支持下拉选择与自定义输入
  - Base URL 支持预设一键套用
  - `z.ai` 常规与 `z.ai Coding Plan` 在厂商选择层面直接区分
- 一键探测逻辑优化：
  - 仅探测“已启用且已配置完整（API Key + Base URL）”的服务商
  - 跳过未配置服务商并提示名单
  - 探测结果提示按成功/失败分流，不再“失败也显示成功样式”
- 导入比对表格增强：
  - 顶部新增/变更/无变化/错误标签可点击筛选
  - 筛选状态与表格过滤联动
  - 汇总栏显示“当前筛选行数/总行数”
- Python 校验规则增强：
  - 识别“联系方式疑似填写身份证号”
  - 识别“身份证号疑似填写手机号”
  - 增加身份证号格式校验
- Mock 模式配置持久化与兼容增强：
  - 新增本地磁盘持久化（`.run/ai-provider-settings.mock.json`）
  - 读取旧配置时自动补齐新增 provider（避免升级后选项消失）

### Fixed
- 修复 `z.ai` 端点适配问题：
  - 常规 API 走 `/api/paas/v4/chat/completions`
  - Coding Plan 走 `/api/coding/paas/v4/chat/completions`
- 修复探测判定逻辑：即使 HTTP 2xx，只要响应体存在 `error` 也判定为失败。
- 修复错误详情页在“无 fieldDiffs”场景下看不到 `errorMessage` 的问题。
- 修复手动修正失败时“无明显反馈”问题，前端改为直出后端错误信息。

## [0.2.0] - 2026-02-12
### Added
- AI provider management backend:
  - `GET/PUT /api/v1/settings/ai-providers`
  - `POST /api/v1/settings/ai-providers/probe` (availability + latency)
  - `GET /api/v1/settings/ai-prompts` (read-only prompt templates)
- API settings UI enhancements:
  - Provider enable/disable, default/fallback routing, persistence to DB
  - One-click provider probe with status code and latency feedback
  - Prompt viewer for Copilot + header-review templates
- Excel import workflow upgrades:
  - Two-stage processing UX (Python rule stage + LLM review stage)
  - Streaming stage logs via `analyze-headers-stream` (SSE)
  - Header mapping confirmation before diff/commit
  - Committed preview table with Excel-like wide view
- Domain field coverage for real GD ledger:
  - Added mappings for `支付工程款的单位/总包/分包（拿走房子的单位）`
  - Added mappings for `是否更名/收款比例/未达款情况说明/联系方式/身份证/地址/现房成交单价`
- Import quality rules:
  - Phone validation (mobile/landline)
  - Receipt ratio deviation check (`实际收款 / 成交总价`)
  - Date completeness check (e.g. year-only sign date)
  - External ledger rows require construction/general contractor units
- Data lineage in preview:
  - Last update source (Excel/AI), update file/session, update timestamp
  - Status display + status basis column
  - Added project name column
  - Sorting/filtering for key columns
- Runtime/ops scripts:
  - Dev/prod up/down scripts
  - DB backup scripts (manual + launchd helper)

### Changed
- Copilot and header-review model timeouts increased for better tolerance.
- Added front-end timeout confirmation: when AI parsing is slow, user can continue waiting or cancel.
- Payment method and transaction type display normalized to Chinese labels.
- Import commit now tolerates non-UUID dev user IDs (prevents transaction rollback).
- Source filename encoding recovery added for Chinese filenames.

### Fixed
- Resolved “import commit succeeds in UI but preview fields appear empty” caused by UUID write failure in `created_by`.
- Resolved garbled source file names in preview for Chinese filenames.
- Improved fallback behavior when model review fails (rules-only mode remains usable).

## [0.1.0] - 2026-02-09
### Added
- Initial full-stack baseline for IPMDS 2.0:
  - `frontend` (React + Ant Design)
  - `backend` (Node.js + TypeScript API gateway)
  - `python-service` (FastAPI + Pandas OCR/diff services)
- PostgreSQL schema and migrations:
  - Core business tables for units/transactions/files/import logs
  - Field-level import audit table (`import_change_audits`)
- Import pipeline:
  - Excel diff (`NEW/CHANGED/UNCHANGED/ERROR`)
  - Transactional commit/rollback APIs
  - Audit detail query APIs
- AI Copilot pipeline:
  - Structured intent parsing
  - Missing-field clarification flow
  - Multi-provider model routing with fallback
- OCR pipeline:
  - OCR extract API
  - Auto-link when single candidate
  - Manual confirm-link API when multiple candidates
- RBAC middleware and role guards (`admin/finance/sales/auditor`)
- Auditor masking on sensitive fields in read APIs
- Automated tests (backend): RBAC + import service + OCR service
- CI workflow (`.github/workflows/ci.yml`)
- Local one-command verification script (`scripts/verify-all.sh`)
- Production runbook (`docs/RUNBOOK.md`)

### Changed
- Frontend workbench now includes:
  - Import commit/rollback actions
  - Audit detail table
  - OCR candidate confirm workflow
  - API Settings page (SiliconFlow / z.ai / OpenAI)
- Frontend bundling strategy adjusted with manual chunks.

### Fixed
- LLM amount extraction no longer confuses room numbers with payment amounts.
- OCR PDF detection improved for extensionless uploaded temp files.
- Import commit timestamp handling hardened for invalid date strings.
- SQL JSONB parameter typing issues in commit/rollback summaries.

### Security
- Added role-based access enforcement to write endpoints.
- Added masking behavior for auditor-visible sensitive fields.
