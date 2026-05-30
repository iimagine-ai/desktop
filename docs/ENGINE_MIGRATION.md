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

## Binary Version Management

llama.cpp is treated as a **pinned pre-built binary dependency**. No source code enters this repo.

### How It Works

1. **`engine/version.json`** (committed to git) — Single source of truth for which llama.cpp release we ship. Contains the release tag, download URLs per platform, and SHA256 checksums.
2. **`scripts/setup-engine.sh`** — Reads `engine/version.json`, downloads the correct binary for the current platform, verifies SHA256, renames to `iimagine-engine`, places in `bin/`.
3. **CI/build** — Setup script runs before electron-builder packages the app. Binary goes into `extraResources`.

### Update Workflow

When updating llama.cpp to a new release:

1. Check [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases) for a new tag
2. Update `engine/version.json` with new tag, URLs, and SHA256 hashes
3. Run `./scripts/setup-engine.sh` locally to download
4. Smoke test: start engine → hit `/health` → send a chat completion → verify streaming works
5. Commit the updated `engine/version.json` — that's the only file that changes

### Design Principles

- **Zero llama.cpp source in the repo** — no submodules, no C++ build toolchain
- **One file to update** — `engine/version.json` is the single source of truth
- **Deterministic builds** — SHA256 verification ensures exact binary reproducibility
- **No API coupling** — we talk HTTP (OpenAI-compat). Binary is a swappable black box.
- **Rollback is trivial** — revert `engine/version.json` to previous commit
- **No auto-update at runtime** — security risk for a privacy product. Engine updates ship with app updates only.

### What NOT To Do

- Don't add llama.cpp as a git submodule
- Don't build from source in CI
- Don't auto-update the binary at runtime without user consent

## Migration Status

- [x] Engine manager module (`engine-manager.js`)
- [x] Model registry with HuggingFace URLs (`model-registry.js`)
- [x] Setup script for binary download (`scripts/setup-engine.sh`)
- [x] Binary verified working on macOS ARM64
- [x] Version manifest (`engine/version.json`) — pinned to b9415
- [x] Updated setup script reads from version manifest
- [x] Wire IPC handlers in main.js to use engine-manager instead of Ollama
- [x] Update renderer UI to use new model management flow
- [x] Update preload.js API surface
- [x] Handle embedding model (shared — see Embedding Strategy below)
- [x] Production build with extraResources bundling
- [x] Windows/Linux binary setup

## Embedding Strategy

**Decision:** Use the loaded chat model for embeddings (shared instance).

llama-server is started with `--embedding` flag, which enables `/v1/embeddings` on whatever model is loaded. This means:

- No separate embedding model needed
- No second engine instance
- Embeddings come from the same model doing chat (e.g. Llama 3.2 3B)
- Quality is acceptable for local KB search (cosine similarity still works well with general models)

**Tradeoff:** Dedicated embedding models (nomic-embed-text, 768-dim) produce slightly better retrieval quality than general chat models. But running two engine instances doubles RAM usage and adds complexity. For v1, shared is the right call.

**Future option:** If embedding quality becomes an issue, we can add a lightweight second instance on a different port specifically for embeddings, or switch to a local embedding library (like `onnxruntime` with a small model) that doesn't need llama-server at all.
