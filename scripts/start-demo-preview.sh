#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Each preview starts from synthetic seed data; never open the user's ledger.
preview_directory=$(mktemp -d /tmp/stockpilot-preview-XXXXXXXX)
export STOCKPILOT_DB="$preview_directory/demo.db"
export STOCKPILOT_MARKET_MODE=demo
export STOCKPILOT_HOST=127.0.0.1
export STOCKPILOT_PORT="${STOCKPILOT_PREVIEW_PORT:-8030}"
unset TWELVE_DATA_API_KEY
printf '%s\n' '正在启动独立演示预览：全部价格和持仓均为虚构样例，不连接行情或证券账户。'
bash scripts/start.sh
