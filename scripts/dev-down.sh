#!/usr/bin/env bash
set -euo pipefail

echo "Stop dev services by pressing Ctrl+C in each dev terminal."
echo "If ports are still occupied, you can run:"
echo "lsof -nP -iTCP:5174 -sTCP:LISTEN -t | xargs kill"
echo "lsof -nP -iTCP:4000 -sTCP:LISTEN -t | xargs kill"
echo "lsof -nP -iTCP:8001 -sTCP:LISTEN -t | xargs kill"
