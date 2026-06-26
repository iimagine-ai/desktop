#!/bin/bash
# Build stable-diffusion.cpp for macOS arm64 with Metal acceleration
# Produces: bin/iimagine-sd-engine
#
# Prerequisites:
#   - Xcode Command Line Tools (xcode-select --install)
#   - CMake (brew install cmake)
#   - Git
#
# Usage:
#   ./scripts/build-sd-engine.sh
#   ./scripts/build-sd-engine.sh --clean   # clean build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.sd-build"
BIN_DIR="$PROJECT_DIR/bin"
REPO_URL="https://github.com/leejet/stable-diffusion.cpp.git"
BRANCH="master"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Building stable-diffusion.cpp for macOS arm64 + Metal ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"

# Clean build if requested
if [[ "${1:-}" == "--clean" ]]; then
  echo -e "${YELLOW}Cleaning previous build...${NC}"
  rm -rf "$BUILD_DIR"
fi

# Clone or update repo
if [ ! -d "$BUILD_DIR/stable-diffusion.cpp" ]; then
  echo -e "${YELLOW}Cloning stable-diffusion.cpp...${NC}"
  mkdir -p "$BUILD_DIR"
  git clone --recursive "$REPO_URL" "$BUILD_DIR/stable-diffusion.cpp"
else
  echo -e "${YELLOW}Updating stable-diffusion.cpp...${NC}"
  cd "$BUILD_DIR/stable-diffusion.cpp"
  git pull
  git submodule update --init --recursive
fi

cd "$BUILD_DIR/stable-diffusion.cpp"

# Build with CMake
echo -e "${YELLOW}Configuring CMake (Metal enabled)...${NC}"
mkdir -p build && cd build

cmake .. \
  -DCMAKE_BUILD_TYPE=Release \
  -DSD_METAL=ON \
  -DGGML_METAL=ON \
  -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_OSX_ARCHITECTURES=arm64

echo -e "${YELLOW}Building (this may take a few minutes)...${NC}"
cmake --build . --config Release -j$(sysctl -n hw.ncpu)

# Copy binary to bin/
echo -e "${YELLOW}Installing binary...${NC}"
mkdir -p "$BIN_DIR"

# The binary is usually named 'sd-cli' in the build output
if [ -f "./bin/sd-cli" ]; then
  cp "./bin/sd-cli" "$BIN_DIR/iimagine-sd-engine"
elif [ -f "./bin/sd" ]; then
  cp "./bin/sd" "$BIN_DIR/iimagine-sd-engine"
elif [ -f "./sd" ]; then
  cp "./sd" "$BIN_DIR/iimagine-sd-engine"
else
  echo -e "${RED}ERROR: Could not find built binary. Checking build output...${NC}"
  find . -name "sd-cli" -o -name "sd" -type f 2>/dev/null || true
  exit 1
fi

chmod +x "$BIN_DIR/iimagine-sd-engine"

# Copy Metal shader if present
if [ -f "./ggml-metal.metal" ]; then
  cp "./ggml-metal.metal" "$BIN_DIR/"
elif [ -f "../ggml/src/ggml-metal/ggml-metal.metal" ]; then
  cp "../ggml/src/ggml-metal/ggml-metal.metal" "$BIN_DIR/"
fi

# Verify
echo ""
echo -e "${GREEN}✓ Build complete!${NC}"
echo -e "  Binary: $BIN_DIR/iimagine-sd-engine"
echo -e "  Size: $(du -h "$BIN_DIR/iimagine-sd-engine" | cut -f1)"
echo ""
echo -e "${YELLOW}Test with:${NC}"
echo "  ./bin/iimagine-sd-engine -m ~/.iimagine/sd-models/sdxl-turbo-q4_0.gguf --mode txt2img -p \"a cat\" -o test.png --steps 4"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
