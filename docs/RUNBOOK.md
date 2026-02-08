# IPMDS Production Runbook

## 1. Environment Checklist
- Node.js 22+
- Python 3.13+
- PostgreSQL 16 + `pgvector`
- Required services: `backend`, `python-service`, `frontend`, `postgres`

## 2. Required Environment Variables
### Backend
- `PORT`
- `DATABASE_URL`
- `PYTHON_SERVICE_URL`
- `MOCK_MODE=false`
- `DEFAULT_MODEL`
- `FALLBACK_MODELS`
- `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `CLAUDE_API_KEY`

### Python Service
- virtualenv with `requirements.txt`

## 3. Deployment Steps
1. Apply DB migrations in order:
   - `database/migrations/001_init.sql`
   - `database/migrations/002_import_change_audits.sql`
2. Build backend and frontend:
   - `cd backend && npm ci && npm run typecheck && npm run build`
   - `cd frontend && npm ci && npm run build`
3. Start services:
   - backend
   - python-service
   - frontend (or static hosting)
4. Health checks:
   - `GET /health` for backend
   - `GET /health` for python-service

## 4. Backup / Restore
### Full backup
- Database dump:
  - `pg_dump "$DATABASE_URL" > backup_YYYYMMDD.sql`
- Uploaded files backup:
  - archive `uploads/` and object-storage metadata

### Restore
1. Create empty DB
2. Apply schema migrations
3. Restore SQL dump:
   - `psql "$DATABASE_URL" < backup_YYYYMMDD.sql`
4. Restore files to storage and verify `files.storage_key`

## 5. Smoke Test After Deploy
1. `POST /api/v1/copilot/interpret` with sample sentence
2. `POST /api/v1/imports/excel` upload sample xlsx
3. `POST /api/v1/imports/{id}/commit`
4. `POST /api/v1/files/ocr-link` upload sample pdf
5. (If pending) `POST /api/v1/files/{id}/confirm-link`

## 6. Incident Playbook
### Import commit failed
- Check backend logs for `import_log_id`
- Verify `import_logs.status`
- If partially applied, run `rollback` endpoint for same batch

### OCR mismatch
- Check `files.ocr_result` and `unitCandidates`
- Use `confirm-link` for manual association

### Model provider outage
- Check response fallback reasons in Copilot output
- Verify API keys and model base URLs
- Keep service running with local fallback until provider recovers

## 7. Security / Operations Notes
- Never run with `MOCK_MODE=true` in production
- Use reverse proxy and HTTPS termination
- Restrict DB network access
- Rotate model API keys regularly
- Enforce RBAC headers via real auth gateway (replace dev headers)
