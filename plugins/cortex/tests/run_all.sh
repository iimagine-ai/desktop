#!/bin/bash
# Run all eval scenarios with sidecar restart between each.
# This handles the embedding timeout → CORTEX_DEBUG crash → stale connection chain.

set -e
cd "$(dirname "$0")/.."

export OPENAI_API_KEY="$(grep '^OPENAI_API_KEY' /Users/adamradly/Documents/iia-28/.env.local | cut -d= -f2-)"
export CORTEX_DEBUG=1

SCENARIOS="20_temporal_chains 30_non_facts 40_entity_resolution 50_salience_calibration 70_robustness 80_advisory_judge"
RESULTS_DIR="docs"
PORT=9199
RUNS="${1:-1}"

cleanup() {
    # Kill any running sidecar
    pkill -f "sidecar.run --port $PORT" 2>/dev/null || true
    sleep 1
}

start_sidecar() {
    # Fresh DB for each scenario
    rm -rf ~/.iimagine/memory/graph.db ~/.iimagine/memory/salience.json \
           ~/.iimagine/memory/profile.json ~/.iimagine/memory/pending_updates.json
    
    # Start sidecar in background
    .venv/bin/python -m sidecar.run --port $PORT &
    SIDECAR_PID=$!
    
    # Wait for health
    for i in $(seq 1 15); do
        if curl -s http://127.0.0.1:$PORT/health | grep -q '"ok"'; then
            echo "  Sidecar ready (PID $SIDECAR_PID)"
            return 0
        fi
        sleep 1
    done
    echo "  ERROR: Sidecar failed to start"
    return 1
}

stop_sidecar() {
    if [ ! -z "$SIDECAR_PID" ]; then
        kill $SIDECAR_PID 2>/dev/null || true
        wait $SIDECAR_PID 2>/dev/null || true
    fi
}

trap cleanup EXIT

echo "═══════════════════════════════════════════════════════════"
echo "CORTEX EVAL — Full Suite (sidecar restart per scenario, $RUNS runs)"
echo "═══════════════════════════════════════════════════════════"

for scenario in $SCENARIOS; do
    echo ""
    echo "═══ $scenario ═══"
    cleanup
    start_sidecar
    
    .venv/bin/python -m tests.runner \
        --model gpt-5.4-mini \
        --judge-model gpt-5.4 \
        --port $PORT \
        --runs $RUNS \
        --mode fresh \
        --only "$scenario" \
        --report "$RESULTS_DIR/eval-${scenario}-final.json" \
        2>&1 || echo "  (scenario exited with error)"
    
    stop_sidecar
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "All scenarios complete. Results in $RESULTS_DIR/eval-*-final.json"
echo "═══════════════════════════════════════════════════════════"
