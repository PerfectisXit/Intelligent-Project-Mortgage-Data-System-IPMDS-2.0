# IPMDS Next TODO (Post-MVP)

## Goals
- [x] P1: Frontend bundle optimization (reduce initial chunk size warning)
- [x] P2: CI pipeline for backend/frontend/python checks
- [x] P3: One-command verification script for local pre-merge checks

## Execution Log
- [x] Add Vite manual chunk splitting for `react`, `antd`, and utility vendors
- [x] Add `.github/workflows/ci.yml` with backend typecheck+tests, frontend build, python compile
- [x] Add `scripts/verify-all.sh` and update `README.md`
- [x] Run full verification and mark this list complete
