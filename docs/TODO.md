# IPMDS Implementation TODO

## Milestones
- [x] M1: Baseline architecture + schema + core APIs
- [x] M2: Import commit/rollback real transaction path
- [x] M3: Import precise apply + field-level audit
- [x] M4: LLM multi-provider integration (with fallback)
- [x] M5: OCR extraction + auto-link first version
- [x] M6: RBAC end-to-end + auditor masking
- [x] M7: Automated API tests (import/copilot/files/auth)
- [x] M8: Frontend workflow closure (commit/rollback/audit/ocr-confirm)
- [x] M9: Production hardening docs and runbook

## Current Sprint (Do Continuously)
- [x] Add request auth context middleware (`x-user-role`, `x-user-id`)
- [x] Enforce role matrix at route level
- [x] Mask sensitive fields for auditor read responses
- [x] Run typecheck + HTTP smoke tests
- [x] Update README with RBAC usage and examples
- [x] Expand automated tests from RBAC-only to import/ocr/rollback flows
- [x] Add OCR candidate-confirm interaction page on frontend

## Role Matrix (Target)
- `admin`: full access
- `finance`: imports/files/copy commit operations
- `sales`: copilot interpret + copilot commit + file upload
- `auditor`: read-only diff and analysis endpoints, masked sensitive fields
