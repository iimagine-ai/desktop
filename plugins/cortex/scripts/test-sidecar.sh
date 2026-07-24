#!/bin/bash
# Quick smoke test for the Cortex sidecar.
# Starts the sidecar, hits all endpoints, and verifies responses.
# Prerequisites: run setup.sh first.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PLUGIN_DIR/.venv"
PORT=9199

if [ ! -d "$VENV_DIR" ]; then
  echo "❌ Run scripts/setup.sh first"
  exit 1
fi

echo "🧠 Cortex Sidecar Smoke Test"
echo "============================"
echo ""

# Start sidecar in background
source "$VENV_DIR/bin/activate"
cd "$PLUGIN_DIR"
python -m sidecar.run --port $PORT &
SIDECAR_PID=$!

# Wait for health
echo "Starting sidecar on port $PORT (PID: $SIDECAR_PID)..."
for i in $(seq 1 30); do
  if curl -s "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
    echo "✓ Sidecar ready (${i}s)"
    break
  fi
  sleep 1
  if [ $i -eq 30 ]; then
    echo "❌ Sidecar failed to start within 30s"
    kill $SIDECAR_PID 2>/dev/null
    exit 1
  fi
done

echo ""
PASS=0
FAIL=0

# Helper function
test_endpoint() {
  local method=$1
  local path=$2
  local body=$3
  local expected_status=${4:-200}
  local desc=$5

  if [ -n "$body" ]; then
    response=$(curl -s -w "\n%{http_code}" -X "$method" "http://127.0.0.1:$PORT$path" \
      -H "Content-Type: application/json" -d "$body")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "http://127.0.0.1:$PORT$path")
  fi

  status=$(echo "$response" | tail -1)
  body_response=$(echo "$response" | sed '$d')

  if [ "$status" = "$expected_status" ]; then
    echo "  ✓ $method $path — $desc"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $method $path — Expected $expected_status, got $status"
    echo "    Response: $body_response"
    FAIL=$((FAIL + 1))
  fi
}

echo "Testing endpoints:"
echo ""

# Health
test_endpoint "GET" "/health" "" "200" "Health check"

# Stats
test_endpoint "GET" "/stats" "" "200" "Graph statistics"

# Profile
test_endpoint "GET" "/profile" "" "200" "Get profile"

# Pending updates
test_endpoint "GET" "/pending-updates" "" "200" "Get pending updates"

# Retrieve (empty graph — should return empty context)
test_endpoint "POST" "/retrieve" '{"query":"test query","token_budget":1500}' "200" "Retrieve (empty graph)"

# Extract (will fail gracefully without LLM — that's expected)
test_endpoint "POST" "/extract" '{"user_message":"I run a marketing agency","assistant_response":"Tell me more","llm_config":{"provider":"local","model":"test","engine_port":9999}}' "200" "Extract (LLM unavailable — graceful)"

# Reflect
test_endpoint "POST" "/reflect" '{"llm_config":{"provider":"local","model":"test","engine_port":9999}}' "200" "Reflect (empty graph)"

# Search
test_endpoint "POST" "/search" '{"query":"test","limit":5}' "200" "Search (empty graph)"

# Clear
test_endpoint "DELETE" "/clear" "" "200" "Clear all data"

echo ""
echo "============================"
echo "Results: $PASS passed, $FAIL failed"
echo ""

# Cleanup
kill $SIDECAR_PID 2>/dev/null
wait $SIDECAR_PID 2>/dev/null

if [ $FAIL -gt 0 ]; then
  echo "❌ Some tests failed"
  exit 1
else
  echo "✓ All smoke tests passed!"
  exit 0
fi
