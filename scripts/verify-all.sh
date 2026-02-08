#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[1/4] backend typecheck + tests"
cd "$ROOT_DIR/backend"
npm run typecheck
npm test

echo "[2/4] frontend build"
cd "$ROOT_DIR/frontend"
npm run build

echo "[3/4] python compile checks"
cd "$ROOT_DIR/python-service"
python3 -m py_compile app/main.py app/services/diff_engine.py app/services/ocr_engine.py

echo "[4/4] done"
