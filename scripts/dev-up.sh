#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Stop prod stack to avoid port conflicts (4000)
(cd "$ROOT_DIR" && docker compose -f docker-compose.prod.yml down >/dev/null 2>&1 || true)

# Ensure postgres is available
if command -v docker >/dev/null 2>&1; then
  docker start ipmds-postgres >/dev/null 2>&1 || true
fi

echo "Starting development services (hot reload)..."
echo "Run each command in a separate terminal:"
echo

echo "[1] Python service"
echo "cd '$ROOT_DIR/python-service' && source .venv313/bin/activate && uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload"
echo
echo "[2] Backend"
echo "cd '$ROOT_DIR/backend' && DATABASE_URL='postgres://ipmds_user:ipmds_pass@127.0.0.1:5432/ipmds2' PYTHON_SERVICE_URL='http://127.0.0.1:8001' PORT=4000 MOCK_MODE=false npm run dev"
echo
echo "[3] Frontend"
echo "cd '$ROOT_DIR/frontend' && npm run dev -- --host 127.0.0.1 --port 5174"
echo
echo "URLs:"
echo "- Frontend: http://127.0.0.1:5174"
echo "- Backend : http://127.0.0.1:4000/health"
echo "- Python  : http://127.0.0.1:8001/health"
