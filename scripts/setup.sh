#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install --disable-pip-version-check --cache-dir "$PWD/.cache/pip" -r backend/requirements.lock
npm --prefix frontend ci --cache "$PWD/.cache/npm" --no-audit --no-fund
npm --prefix frontend run build
