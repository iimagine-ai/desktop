#!/usr/bin/env bash
# Cortex chaos tests — process-level failures the HTTP harness can't simulate.
# Run from the cortex plugin dir with .venv active and OPENAI_API_KEY exported.
#
#   ./chaos.sh all          # persistence + concurrency (+ prompts for engine test)
#   ./chaos.sh persistence  # kill -9 mid-life, verify graph survives restart
#   ./chaos.sh concurrency  # 5 parallel /extract calls (FalkorDB Lite is single-process)
#   ./chaos.sh engine       # embedding-engine outage -> keyword fallback -> recovery

set -uo pipefail
PORT="${PORT:-9199}"
BASE="http://127.0.0.1:$PORT"
MODEL="${MODEL:-gpt-5.4-mini}"
LLM_CONFIG="{\"provider\":\"openai\",\"model\":\"$MODEL\",\"api_key\":\"$OPENAI_API_KEY\"}"

start_sidecar() {
  CORTEX_DEBUG=1 python -m sidecar.run --port "$PORT" >/tmp/cortex_chaos.log 2>&1 &
  SIDECAR_PID=$!
  for _ in $(seq 1 30); do
    curl -sf "$BASE/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "FAIL: sidecar did not become healthy"; exit 1
}

extract() {
  curl -sf -X POST "$BASE/extract" -H "Content-Type: application/json" \
    -d "{\"user_message\":\"$1\",\"assistant_response\":\"Noted.\",\"llm_config\":$LLM_CONFIG}"
}

search_hit() {  # $1=query $2=needle -> exit 0 if found
  curl -sf -X POST "$BASE/search" -H "Content-Type: application/json" \
    -d "{\"query\":\"$1\",\"limit\":5}" | grep -qi "$2"
}

test_persistence() {
  echo "=== CHAOS: persistence (kill -9) ==="
  start_sidecar
  curl -s -X DELETE "$BASE/clear" >/dev/null
  extract "The Zurich pilot project is worth 45000 francs and starts in October." >/dev/null
  sleep 2
  echo "  ingested unique fact; killing sidecar with SIGKILL (no graceful shutdown)"
  kill -9 "$SIDECAR_PID"; sleep 2
  start_sidecar
  if search_hit "Zurich pilot value" "45"; then
    echo "  PASS: fact survived kill -9 + restart (embedded persistence works)"
  else
    echo "  FAIL: fact LOST after kill -9 — RDB persistence is not flushing."
    echo "        This is the single most important chaos result. Investigate before shipping."
  fi
  kill "$SIDECAR_PID" 2>/dev/null
}

test_concurrency() {
  echo "=== CHAOS: 5 concurrent /extract calls ==="
  start_sidecar
  curl -s -X DELETE "$BASE/clear" >/dev/null
  for i in 1 2 3 4 5; do
    extract "Concurrent fact number $i: vendor $i charges ${i}00 dollars monthly." >/dev/null &
  done
  wait
  STATS=$(curl -s "$BASE/stats")
  echo "  post-concurrency stats: $STATS"
  HEALTH=$(curl -s "$BASE/health" | grep -o '"status":"[^"]*"')
  ROUNDTRIP_OK=true
  search_hit "vendor 3 monthly charge" "300" || ROUNDTRIP_OK=false
  if [[ "$HEALTH" == '"status":"ok"' && "$ROUNDTRIP_OK" == true ]]; then
    echo "  PASS: sidecar healthy and facts readable after parallel writes"
  else
    echo "  FAIL: health=$HEALTH readable=$ROUNDTRIP_OK — check /tmp/cortex_chaos.log"
  fi
  kill "$SIDECAR_PID" 2>/dev/null
}

test_engine() {
  echo "=== CHAOS: embedding-engine outage ==="
  echo "  This test needs YOU to control the llama.cpp engine (port 8847)."
  start_sidecar
  extract "The Lisbon office lease costs 3200 euros per month." >/dev/null
  echo "  1) STOP the embedding engine now, then press enter."; read -r
  if search_hit "Lisbon office lease" "3200"; then
    echo "  PASS: keyword/BM25 channel carried retrieval with embeddings down"
  else
    echo "  FAIL: retrieval returned nothing without embeddings — no graceful degradation"
  fi
  echo "  2) START the engine again, wait for it to load, then press enter."; read -r
  if search_hit "monthly rent Portugal workspace" "3200"; then
    echo "  PASS: vector channel recovered (paraphrase hit after engine restart)"
  else
    echo "  WARN: paraphrase miss after restart — check embedder availability reset"
  fi
  kill "$SIDECAR_PID" 2>/dev/null
}

case "${1:-all}" in
  persistence) test_persistence ;;
  concurrency) test_concurrency ;;
  engine)      test_engine ;;
  all)         test_persistence; test_concurrency;
               echo; echo "Run './chaos.sh engine' separately (needs manual engine control)." ;;
  *) echo "usage: ./chaos.sh [all|persistence|concurrency|engine]"; exit 1 ;;
esac
