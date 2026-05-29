#!/bin/bash
# Setup script: downloads llama-server from llama.cpp releases and renames to iimagine-engine
# Run this once during development setup or as part of the build pipeline.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../bin"
ENGINE_NAME="iimagine-engine"

# Detect platform
OS=$(uname -s)
ARCH=$(uname -m)

echo "🔧 Setting up IIMAGINE Engine (llama-server from llama.cpp)"
echo "   Platform: $OS $ARCH"

# Determine download URL from llama.cpp releases
# Using latest stable release with Metal support for macOS
LLAMA_CPP_VERSION="b5270"

if [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    DOWNLOAD_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/llama-${LLAMA_CPP_VERSION}-bin-macos-arm64.zip"
    BINARY_IN_ARCHIVE="build/bin/llama-server"
  else
    DOWNLOAD_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/llama-${LLAMA_CPP_VERSION}-bin-macos-x64.zip"
    BINARY_IN_ARCHIVE="build/bin/llama-server"
  fi
elif [ "$OS" = "Linux" ]; then
  DOWNLOAD_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/llama-${LLAMA_CPP_VERSION}-bin-ubuntu-x64.zip"
  BINARY_IN_ARCHIVE="build/bin/llama-server"
else
  echo "❌ Unsupported platform: $OS"
  echo "   For Windows, download manually from: https://github.com/ggml-org/llama.cpp/releases"
  exit 1
fi

# Create bin directory
mkdir -p "$BIN_DIR"

# Download
TEMP_DIR=$(mktemp -d)
ARCHIVE_PATH="$TEMP_DIR/llama-cpp.zip"

echo "📥 Downloading llama.cpp ${LLAMA_CPP_VERSION}..."
curl -L -o "$ARCHIVE_PATH" "$DOWNLOAD_URL"

echo "📦 Extracting..."
unzip -q "$ARCHIVE_PATH" -d "$TEMP_DIR/extracted"

# Find the llama-server binary
FOUND_BINARY=$(find "$TEMP_DIR/extracted" -name "llama-server" -type f | head -1)

if [ -z "$FOUND_BINARY" ]; then
  # Try alternative name
  FOUND_BINARY=$(find "$TEMP_DIR/extracted" -name "server" -type f | head -1)
fi

if [ -z "$FOUND_BINARY" ]; then
  echo "❌ Could not find llama-server binary in archive"
  echo "   Contents:"
  find "$TEMP_DIR/extracted" -type f | head -20
  rm -rf "$TEMP_DIR"
  exit 1
fi

echo "✅ Found binary: $FOUND_BINARY"

# Copy and rename the main binary
cp "$FOUND_BINARY" "$BIN_DIR/$ENGINE_NAME"
chmod +x "$BIN_DIR/$ENGINE_NAME"

# Copy all required shared libraries (.dylib on macOS, .so on Linux)
BINARY_DIR=$(dirname "$FOUND_BINARY")
if [ "$OS" = "Darwin" ]; then
  find "$BINARY_DIR" -name "*.dylib" -exec cp {} "$BIN_DIR/" \;
  echo "   Copied shared libraries (.dylib)"
elif [ "$OS" = "Linux" ]; then
  find "$BINARY_DIR" -name "*.so*" -exec cp {} "$BIN_DIR/" \;
  echo "   Copied shared libraries (.so)"
fi

# Also copy the Metal shader file if present (needed for GPU on macOS)
if [ -f "$BINARY_DIR/ggml-metal.metal" ]; then
  cp "$BINARY_DIR/ggml-metal.metal" "$BIN_DIR/"
  echo "   Copied Metal shader"
fi

# Clean up
rm -rf "$TEMP_DIR"

echo ""
echo "✅ IIMAGINE Engine installed at: $BIN_DIR/$ENGINE_NAME"
echo "   Size: $(du -h "$BIN_DIR/$ENGINE_NAME" | cut -f1)"
echo ""
echo "   In Activity Monitor, this will show as: $ENGINE_NAME"
echo ""
echo "   Next steps:"
echo "   1. Download a GGUF model to test:"
echo "      curl -L -o ~/Library/Application\\ Support/iimagine-desktop/models/llama-3.2-3b-q4.gguf \\"
echo "        https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
echo "   2. Run the desktop app: npm start"
