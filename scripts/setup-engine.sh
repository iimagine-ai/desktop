#!/bin/bash
# Setup script: downloads llama-server from llama.cpp releases and renames to iimagine-engine
# Reads version and URLs from engine/version.json (single source of truth).
# Run this once during development setup or as part of the build pipeline.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."
BIN_DIR="$PROJECT_DIR/bin"
VERSION_FILE="$PROJECT_DIR/engine/version.json"
ENGINE_NAME="iimagine-engine"

# Check version.json exists
if [ ! -f "$VERSION_FILE" ]; then
  echo "❌ engine/version.json not found at: $VERSION_FILE"
  exit 1
fi

# Parse version.json (requires python3 or node for JSON parsing)
if command -v python3 &> /dev/null; then
  PARSE_JSON="python3 -c"
elif command -v node &> /dev/null; then
  PARSE_JSON="node -e"
else
  echo "❌ Need python3 or node to parse version.json"
  exit 1
fi

# Detect platform key
OS=$(uname -s)
ARCH=$(uname -m)

if [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    PLATFORM_KEY="darwin-arm64"
  else
    PLATFORM_KEY="darwin-x64"
  fi
elif [ "$OS" = "Linux" ]; then
  PLATFORM_KEY="linux-x64"
else
  echo "❌ Unsupported platform: $OS $ARCH"
  echo "   For Windows, run setup-engine.ps1 or download manually."
  exit 1
fi

# Extract values from version.json
VERSION=$(python3 -c "import json; d=json.load(open('$VERSION_FILE')); print(d['version'])")
DOWNLOAD_URL=$(python3 -c "import json; d=json.load(open('$VERSION_FILE')); print(d['binaries']['$PLATFORM_KEY'])")
EXPECTED_SHA=$(python3 -c "import json; d=json.load(open('$VERSION_FILE')); print(d['sha256'].get('$PLATFORM_KEY', ''))")

echo "🔧 Setting up IIMAGINE Engine (llama.cpp $VERSION)"
echo "   Platform: $PLATFORM_KEY"
echo "   Source: $DOWNLOAD_URL"

# Check if already installed at correct version
VERSION_MARKER="$BIN_DIR/.engine-version"
if [ -f "$VERSION_MARKER" ] && [ "$(cat "$VERSION_MARKER")" = "$VERSION" ] && [ -f "$BIN_DIR/$ENGINE_NAME" ]; then
  echo "✅ Already installed at version $VERSION — skipping download."
  echo "   To force reinstall, delete $BIN_DIR/$ENGINE_NAME"
  exit 0
fi

# Create bin directory
mkdir -p "$BIN_DIR"

# Download
TEMP_DIR=$(mktemp -d)

# Determine archive extension
if [[ "$DOWNLOAD_URL" == *.tar.gz ]]; then
  ARCHIVE_PATH="$TEMP_DIR/llama-cpp.tar.gz"
  EXTRACT_CMD="tar"
elif [[ "$DOWNLOAD_URL" == *.zip ]]; then
  ARCHIVE_PATH="$TEMP_DIR/llama-cpp.zip"
  EXTRACT_CMD="unzip"
else
  echo "❌ Unknown archive format: $DOWNLOAD_URL"
  rm -rf "$TEMP_DIR"
  exit 1
fi

echo "📥 Downloading llama.cpp $VERSION..."
curl -L --progress-bar -o "$ARCHIVE_PATH" "$DOWNLOAD_URL"

# Verify SHA256 if provided
if [ -n "$EXPECTED_SHA" ]; then
  echo "🔐 Verifying SHA256..."
  if [ "$OS" = "Darwin" ]; then
    ACTUAL_SHA=$(shasum -a 256 "$ARCHIVE_PATH" | cut -d' ' -f1)
  else
    ACTUAL_SHA=$(sha256sum "$ARCHIVE_PATH" | cut -d' ' -f1)
  fi
  if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
    echo "❌ SHA256 mismatch!"
    echo "   Expected: $EXPECTED_SHA"
    echo "   Got:      $ACTUAL_SHA"
    rm -rf "$TEMP_DIR"
    exit 1
  fi
  echo "   ✅ SHA256 verified"
else
  echo "⚠️  No SHA256 in version.json — skipping verification (populate sha256 field for production)"
fi

# Extract
echo "📦 Extracting..."
EXTRACT_DIR="$TEMP_DIR/extracted"
mkdir -p "$EXTRACT_DIR"

if [ "$EXTRACT_CMD" = "tar" ]; then
  tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"
elif [ "$EXTRACT_CMD" = "unzip" ]; then
  unzip -q "$ARCHIVE_PATH" -d "$EXTRACT_DIR"
fi

# Find the llama-server binary
FOUND_BINARY=$(find "$EXTRACT_DIR" -name "llama-server" -type f | head -1)

if [ -z "$FOUND_BINARY" ]; then
  FOUND_BINARY=$(find "$EXTRACT_DIR" -name "server" -type f | head -1)
fi

if [ -z "$FOUND_BINARY" ]; then
  echo "❌ Could not find llama-server binary in archive"
  echo "   Contents:"
  find "$EXTRACT_DIR" -type f | head -20
  rm -rf "$TEMP_DIR"
  exit 1
fi

echo "✅ Found binary: $FOUND_BINARY"

# Copy and rename the main binary
cp "$FOUND_BINARY" "$BIN_DIR/$ENGINE_NAME"
chmod +x "$BIN_DIR/$ENGINE_NAME"

# Copy all required shared libraries
BINARY_DIR=$(dirname "$FOUND_BINARY")
if [ "$OS" = "Darwin" ]; then
  find "$BINARY_DIR" -name "*.dylib" -exec cp {} "$BIN_DIR/" \; 2>/dev/null || true
  # Also check parent/sibling dirs for libs
  find "$EXTRACT_DIR" -name "*.dylib" -exec cp {} "$BIN_DIR/" \; 2>/dev/null || true
  LIB_COUNT=$(find "$BIN_DIR" -name "*.dylib" | wc -l | tr -d ' ')
  echo "   Copied $LIB_COUNT shared libraries (.dylib)"
elif [ "$OS" = "Linux" ]; then
  find "$EXTRACT_DIR" -name "*.so*" -exec cp {} "$BIN_DIR/" \; 2>/dev/null || true
  echo "   Copied shared libraries (.so)"
fi

# Copy Metal shader if present (needed for GPU on macOS)
METAL_FILE=$(find "$EXTRACT_DIR" -name "*.metal" -type f | head -1)
if [ -n "$METAL_FILE" ]; then
  cp "$METAL_FILE" "$BIN_DIR/"
  echo "   Copied Metal shader"
fi

# Write version marker
echo "$VERSION" > "$VERSION_MARKER"

# Clean up
rm -rf "$TEMP_DIR"

echo ""
echo "✅ IIMAGINE Engine installed at: $BIN_DIR/$ENGINE_NAME"
echo "   Version: $VERSION"
echo "   Size: $(du -h "$BIN_DIR/$ENGINE_NAME" | cut -f1)"
echo "   Activity Monitor name: $ENGINE_NAME"
echo ""
echo "   Next steps:"
echo "   1. Download a GGUF model to test:"
echo "      curl -L -o ~/Library/Application\\ Support/iimagine-desktop/models/llama-3.2-3b-q4.gguf \\"
echo "        https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
echo "   2. Run the desktop app: npm start"
