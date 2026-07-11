# Model Registry System

## Overview

The desktop companion uses a remote JSON manifest to recommend AI models to users. Models are GGUF files downloaded directly from HuggingFace. The manifest system provides a dynamic, updatable model catalog.

## Architecture

```
[generate-model-registry.js] → model-registry.json → GitHub Raw / CDN
                                                          ↓
                                              Desktop app fetches on startup
                                                          ↓
                                              Caches locally for offline use
```

## Files

| File | Purpose |
|------|---------|
| `scripts/generate-model-registry.js` | Generates the manifest (run weekly) |
| `desktop-companion/model-registry-bundled.json` | Bundled fallback (ships with app) |
| `desktop-companion/manifest-manager.js` | Fetch/cache/version logic (main process) |
| `desktop-companion/hardware-scanner.js` | Cross-platform hardware detection |
| `desktop-companion/renderer/model-advisor.js` | Scoring/recommendation engine |
| `desktop-companion/renderer/components/model-browser.js` | UI component |

## Manifest Schema

See `.kiro/specs/model-management/design.md` for the full schema.

## Hosting Setup

1. Create a public GitHub repo: `iimagine-ai/model-registry`
2. Push `model-registry.json` to the `main` branch
3. The desktop app fetches from: `https://raw.githubusercontent.com/iimagine-ai/model-registry/main/model-registry.json`
4. Alternative: host on your CDN at `https://cdn.iimagine.ai/model-registry.json`

## Updating the Registry

### Manual (current)
```bash
node scripts/generate-model-registry.js
# Review the output in desktop-companion/model-registry-bundled.json
# Push to the model-registry repo
```

### Automated (future)
Set up a GitHub Action that runs weekly:
```yaml
name: Update Model Registry
on:
  schedule:
    - cron: '0 9 * * 1'  # Every Monday at 9am UTC
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node scripts/generate-model-registry.js
      - run: |
          git config user.name "github-actions"
          git config user.email "actions@github.com"
          git add desktop-companion/model-registry-bundled.json
          git diff --cached --quiet || git commit -m "Update model registry $(date +%Y-%m-%d)"
          git push
```

## Adding New Models

1. Add the model to the `CANDIDATES` array in `scripts/generate-model-registry.js`
2. Include: huggingface_url, family, categories, size, RAM requirement, quality tier, GGUF quantization variant
3. Run the script to verify the HuggingFace URL is accessible
4. Commit and push

## How the Desktop App Uses It

1. On startup, `manifest-manager.js` fetches the remote manifest
2. If newer than cached version, updates local cache and sets `updateAvailable` flag
3. The Models tab shows a notification banner if updates are available
4. The guided wizard and browser both read from the manifest via `window.api.manifest.get()`
5. Hardware scanner auto-detects RAM/GPU/disk to filter compatible models
6. User clicks Download → triggers GGUF download from HuggingFace via `download-manager.js`

## Model Format

All models are standard GGUF files. The registry tracks:
- Direct HuggingFace download URLs for each quantization variant
- File size and SHA256 checksum
- Minimum RAM requirement
- Supported features (chat, embeddings, vision, tool calling)
- Recommended quantization per hardware tier
