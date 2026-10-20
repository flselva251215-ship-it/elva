#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/ruff check backend
(cd backend && ../.venv/bin/pytest -q)
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
