#!/bin/bash
# Cortex Plugin — Python sidecar setup
# Creates a virtual environment and installs dependencies.
# Run once after cloning, or when requirements.txt changes.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PLUGIN_DIR/.venv"

echo "🧠 Cortex Memory Plugin — Setup"
echo "================================"
echo "Plugin dir: $PLUGIN_DIR"
echo ""

# Check Python 3.12+
PYTHON=""
for cmd in python3.12 python3.13 python3; do
  if command -v "$cmd" &>/dev/null; then
    version=$("$cmd" --version 2>&1 | grep -oP '\d+\.\d+')
    major=$(echo "$version" | cut -d. -f1)
    minor=$(echo "$version" | cut -d. -f2)
    if [ "$major" -ge 3 ] && [ "$minor" -ge 12 ]; then
      PYTHON="$cmd"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "❌ Python 3.12+ required but not found."
  echo "   Install via: brew install python@3.12"
  exit 1
fi

echo "✓ Using: $($PYTHON --version)"

# Create venv
if [ ! -d "$VENV_DIR" ]; then
  echo ""
  echo "Creating virtual environment..."
  "$PYTHON" -m venv "$VENV_DIR"
  echo "✓ Virtual environment created at $VENV_DIR"
else
  echo "✓ Virtual environment exists at $VENV_DIR"
fi

# Activate and install
echo ""
echo "Installing dependencies..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip -q
pip install -r "$PLUGIN_DIR/sidecar/requirements.txt" -q

echo ""
echo "✓ Dependencies installed"
echo ""
echo "================================"
echo "Setup complete! To test the sidecar manually:"
echo ""
echo "  cd $PLUGIN_DIR"
echo "  source .venv/bin/activate"
echo "  python -m sidecar.run --port 9100"
echo ""
echo "Then in another terminal:"
echo "  curl http://127.0.0.1:9100/health"
echo ""
