#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python scripts/export_demo.py
npm --prefix frontend run build
.venv/bin/python scripts/build_demo.py
