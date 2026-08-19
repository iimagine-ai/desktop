#!/bin/bash
# Install the shopping-list plugin to the user plugins directory
DEST="$HOME/.iimagine/plugins/shopping-list"
SRC="$(dirname "$0")/../plugins/shopping-list"

mkdir -p "$DEST"
cp "$SRC/plugin.json" "$DEST/plugin.json"
cp "$SRC/index.js" "$DEST/index.js"

echo "✅ Shopping List plugin installed to $DEST"
echo "   Restart the app to load it."
