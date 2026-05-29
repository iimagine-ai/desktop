# Engine Migration: Ollama → iimagine-engine (llama.cpp)

## Why

Privacy-focused users see "ollama" as the #1 memory consumer in Activity Monitor and don't know what it is. For a data privacy product, having an unrecognizable process eating 7GB of RAM destroys trust.

## What Changed

Replaced Ollama dependency with a bundled `llama-server` binary from llama.cpp, renamed to `iimagine-engine`. In Activity Monitor, users now see **"iimagine-engine"** — clearly associated with the IIMAGINE Desktop app.

## Architecture

```
Before:
  IIMAGINE Desktop (Electron) → HTTP → Ollama (separate process, "ollama" in Activity Monitor)
                                         ↓
                                    Ollama's internal llama.cpp

After:
  IIMAGINE Desktop (Electron) → spawns → iimagine-engine (child process, "iimagine-engine" in Activity Monitor)
                                           ↓
                                      llama-server (llama.cpp) with OpenAI-compatible API
```

## Key Files

- `engine-manager.js` — Process lifecycle management (start/stop/switch models)
- `model-registry.js` — Model catalog with HuggingFace GGUF download URLs
- `bin/iimagine-engine` — The renamed llama-server binary (not committed to git)
- `bin/*.dylib` — Required shared libraries (not committed to git)
- `scripts/setup-engine.sh` — Downloads and sets up the binary for development

## API Compatibility

llama-server exposes the same OpenAI-compatible API:
- `POST /v1/chat/completions` — Chat (streaming and non-streaming)
- `POST /v1/embeddings` — Text embeddings
- `GET /health` — Health check

## Model Management

- Models are GGUF files stored in `~/Library/Application Support/iimagine-desktop/models/`
- Downloaded directly from HuggingFace (no Ollama registry dependency)
- Model switching = restart engine with different `--model` flag

## Key Differences from Ollama

| Feature | Ollama | iimagine-engine |
|---------|--------|-----------------|
| Process name | "ollama" | "iimagine-engine" |
| Multi-model | Hot-swap in memory | Restart with new model |
| Model source | Ollama registry | HuggingFace GGUF |
| Model format | Ollama Modelfile | Standard GGUF |
| Install size | ~100MB | ~7.5MB |
| Lifecycle | System service (always running) | Child process (starts/stops with app) |
| Telemetry | Ollama analytics | None |

## Development Setup

```bash
# Download the engine binary
./scripts/setup-engine.sh

# Download a test model
curl -L -o ~/Library/Application\ Support/iimagine-desktop/models/llama-3.2-3b-instruct-q4_k_m.gguf \
  https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf
```

## Migration Status

- [x] Engine manager module (`engine-manager.js`)
- [x] Model registry with HuggingFace URLs (`model-registry.js`)
- [x] Setup script for binary download (`scripts/setup-engine.sh`)
- [x] Binary verified working on macOS ARM64
- [ ] Wire IPC handlers in main.js to use engine-manager instead of Ollama
- [ ] Update renderer UI to use new model management flow
- [ ] Update preload.js API surface
- [ ] Handle embedding model (separate engine instance or shared)
- [ ] Production build with extraResources bundling
- [ ] Windows/Linux binary setup
