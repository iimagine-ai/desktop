#!/bin/bash
# Build IIMAGINE Desktop for all platforms
# Run from the desktop-companion directory
#
# Prerequisites:
#   - Node.js 18+
#   - npm install (dependencies installed)
#
# For macOS builds (run on a Mac):
#   ./scripts/build-all.sh mac
#
# For Windows builds (run on Windows or via CI):
#   ./scripts/build-all.sh win
#
# For all platforms (CI only — needs both OS runners):
#   ./scripts/build-all.sh all

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "Building IIMAGINE Desktop v$(node -p "require('./package.json').version")"
echo "Platform: ${1:-mac}"
echo ""

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Rebuild native modules for Electron
echo "Rebuilding native modules for Electron..."
npx electron-rebuild

case "${1:-mac}" in
  mac)
    echo "Building for macOS (arm64 + x64)..."
    npx electron-builder --mac --arm64 --x64
    echo ""
    echo "Build complete. Output in dist/"
    ls -la dist/*.dmg dist/*.zip 2>/dev/null || echo "Check dist/ for output files"
    ;;
  win)
    echo "Building for Windows..."
    npx electron-builder --win
    echo ""
    echo "Build complete. Output in dist/"
    ls -la dist/*.exe 2>/dev/null || echo "Check dist/ for output files"
    ;;
  all)
    echo "Building for all platforms..."
    npx electron-builder --mac --arm64 --x64
    npx electron-builder --win
    echo ""
    echo "Build complete. Output in dist/"
    ls -la dist/ 2>/dev/null
    ;;
  *)
    echo "Usage: ./scripts/build-all.sh [mac|win|all]"
    exit 1
    ;;
esac
