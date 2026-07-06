#!/usr/bin/env bash
set -euo pipefail

API_BASE="${JIJIN_API_BASE:-http://localhost:8000}"

printf 'Checking API: %s\n' "$API_BASE"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1"
    exit 1
  fi
}

require_cmd curl
require_cmd python3

check_json() {
  local name="$1"
  local url="$2"
  echo "-> $name"
  curl -fsS "$url" | python3 -m json.tool >/dev/null
}

check_json "health" "$API_BASE/api/health"
check_json "industry heatmap" "$API_BASE/api/sector/heatmap?type=industry&period=today"
check_json "concept heatmap" "$API_BASE/api/sector/heatmap?type=concept&period=today"
check_json "ETF quotes" "$API_BASE/api/etf/quotes?codes=512480,159995,515230"

echo "Smoke test passed."
