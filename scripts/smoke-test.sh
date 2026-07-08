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

fetch_json() {
  local name="$1"
  local url="$2"
  echo "-> $name" >&2
  curl -fsS "$url"
}

assert_json() {
  local name="$1"
  local url="$2"
  fetch_json "$name" "$url" | python3 -m json.tool >/dev/null
}

assert_json "health" "$API_BASE/api/health"
assert_json "cache status" "$API_BASE/api/cache"

industry_payload="$(fetch_json "industry heatmap" "$API_BASE/api/sector/heatmap?type=industry&period=today&limit=20")"
concept_payload="$(fetch_json "concept heatmap" "$API_BASE/api/sector/heatmap?type=concept&period=today&limit=20")"

printf '%s' "$industry_payload" | python3 -c 'import json, sys
payload = json.load(sys.stdin)
nodes = payload.get("nodes") or []
assert payload.get("source"), "missing source"
assert nodes, "industry heatmap nodes should not be empty"
first = nodes[0]
for key in ("id", "name", "changePct", "mainNetIn", "mainNetInRatio"):
    assert key in first, f"missing node key: {key}"
print("industry first node:", first["id"], first["name"])'

first_sector="$(printf '%s' "$industry_payload" | python3 -c 'import json, sys
payload = json.load(sys.stdin)
print(payload["nodes"][0]["id"])')"

assert_json "industry stocks" "$API_BASE/api/sector/$first_sector/stocks?type=industry&limit=10"
assert_json "ETF quotes" "$API_BASE/api/etf/quotes?codes=512480,159995,515230"
assert_json "debug columns" "$API_BASE/api/debug/columns?type=industry&period=today"

printf '%s' "$concept_payload" | python3 -c 'import json, sys
payload = json.load(sys.stdin)
assert payload.get("nodes"), "concept heatmap nodes should not be empty"
print("concept nodes:", len(payload["nodes"]))'

echo "Smoke test passed."
