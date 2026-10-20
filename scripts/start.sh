#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f frontend/dist/index.html || ! -x .venv/bin/uvicorn ]]; then
  printf '%s\n' '请先执行 bash scripts/setup.sh' >&2
  exit 1
fi
exec .venv/bin/uvicorn app.main:app --app-dir backend --host "${STOCKPILOT_HOST:-127.0.0.1}" --port "${STOCKPILOT_PORT:-8000}"
