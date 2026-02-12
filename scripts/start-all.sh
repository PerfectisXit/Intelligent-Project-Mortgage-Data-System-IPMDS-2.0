#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
mkdir -p "$RUN_DIR"

# Start PostgreSQL container if available
if command -v docker >/dev/null 2>&1; then
  if docker ps -a --format '{{.Names}}' | grep -q '^ipmds-postgres$'; then
    docker start ipmds-postgres >/dev/null 2>&1 || true
  fi
fi

# Python service (port 8001)
cd "$ROOT_DIR/python-service"
if [ ! -d .venv313 ]; then
  python3.13 -m venv .venv313
fi
source .venv313/bin/activate
pip install --disable-pip-version-check -r requirements.txt >/dev/null
nohup uvicorn app.main:app --host 127.0.0.1 --port 8001 > "$RUN_DIR/python.log" 2>&1 &
echo $! > "$RUN_DIR/python.pid"

# Backend (port 4000)
cd "$ROOT_DIR/backend"
if [ ! -d node_modules ]; then
  npm install >/dev/null
fi
DATABASE_URL="postgres://ipmds_user:ipmds_pass@127.0.0.1:5432/ipmds2" \
PYTHON_SERVICE_URL="http://127.0.0.1:8001" \
PORT=4000 MOCK_MODE=false \
nohup npm run dev > "$RUN_DIR/backend.log" 2>&1 &
echo $! > "$RUN_DIR/backend.pid"

# Frontend (port 5174)
cd "$ROOT_DIR/frontend"
if [ ! -d node_modules ]; then
  npm install >/dev/null
fi
nohup npm run dev -- --host 127.0.0.1 --port 5174 > "$RUN_DIR/frontend.log" 2>&1 &
echo $! > "$RUN_DIR/frontend.pid"

sleep 2

echo "Started IPMDS services:"
echo "- Frontend: http://127.0.0.1:5174"
echo "- Backend : http://127.0.0.1:4000/health"
echo "- Python  : http://127.0.0.1:8001/health"
