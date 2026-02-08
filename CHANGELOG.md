# Changelog

All notable changes to this project will be documented in this file.

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
