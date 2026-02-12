#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Stop common dev ports to avoid conflict
for p in 4000 5174 8001; do
  if lsof -nP -iTCP:$p -sTCP:LISTEN -t >/dev/null 2>&1; then
    lsof -nP -iTCP:$p -sTCP:LISTEN -t | xargs kill || true
  fi
done

cd "$ROOT_DIR"
docker compose -f docker-compose.prod.yml up -d --build

echo "Production stack started:"
echo "- Frontend: http://127.0.0.1:8080"
echo "- Backend : http://127.0.0.1:4000/health"
echo "- Frontend health: http://127.0.0.1:8080/healthz"
