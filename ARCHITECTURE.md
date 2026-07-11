# IIMAGINE Desktop — Architecture

## Product Vision

Desktop companion app that gives users control over their AI privacy level:
- **Local AI** (green) — Nothing leaves the machine. For personal/private use.
- **Regional Cloud** (blue) — Data stays in user's region via Vertex AI. For regulated industries (legal, accounting, healthcare).
- **API Key** (purple) — User's own API key to OpenAI, Claude, etc. For users who don't care about data location.

## Core Abstraction: Provider Interface

All three options implement the same interface. The chat UI doesn't know or care which provider is active.

```
Provider {
  type: 'local' | 'vertex' | 'api-key'
  name: string              // "Gemma 3B (Local)", "Gemini Flash (Cloud)"
  privacyLevel: string      // 'local' | 'regional' | 'third-party'
  status: 'ready' | 'not-configured' | 'downloading' | 'error'
  chat(messages) → stream
}
```

## Key Principle: Nothing Downloads Automatically

Model downloads are large (1–8GB) and resource-intensive. The installation process installs the app shell only. All model downloads are user-initiated from the Settings page or Model Browser.

## Post-Launch Flow

1. User opens app (no sign-in required)
2. No model downloaded → Chat shows setup prompt directing to Settings
3. User goes to Settings → Model Advisor scans hardware → recommends models
4. User downloads a model with one click
5. Back to Chat → works with selected model

## Dashboard Layout

```
┌──────────────┬─────────────────────────────┐
│  SIDEBAR     │  MAIN CONTENT               │
│              │                              │
│  Model ▼     │  (Chat / Knowledge / Prompts │
│  ─────────   │   Settings page)             │
│  💬 Chat     │                              │
│  📚 Knowledge│                              │
│  🎭 Personas │                              │
│  📝 Prompts  │                              │
│  ⚙ Settings  │                              │
│              │                              │
│  ─────────   │                              │
│  [Plugins]   │                              │
└──────────────┴─────────────────────────────┘
```

## Model Dropdown (Sidebar)

Shows all downloaded/ready models with privacy indicators:
```
🟢 Gemma 4 26B MoE (Local)
🟢 Llama 3.2 3B (Local)
🟣 GPT-4o (API Key)
🟣 Claude Sonnet (API Key)
───────────────────
+ Add model...              ← goes to Model Browser
```

## File Structure

```
desktop-companion/
├── main.js                    # Electron main process + IPC handlers
├── preload.js                 # Secure IPC bridge (renderer ↔ main)
├── engine-manager.js          # iimagine-engine process lifecycle
├── model-registry.js          # Model catalog (HuggingFace GGUF URLs)
├── model-registry-bundled.json # Bundled model manifest (offline fallback)
├── model-orchestrator.js      # Model selection, switching, routing
├── download-manager.js        # Model download with progress + resume
├── local-ai-adapter.js        # Adapts engine API for internal use
├── hardware-scanner.js        # RAM/GPU/CPU detection (systeminformation)
├── manifest-manager.js        # Remote manifest fetch + cache + versioning
├── tool-calling.js            # Built-in tools (web_search, rag_search)
├── mcp-client.js              # MCP protocol client for external tools
├── skills-manager.js          # Skills registration and execution
├── tts-service.js             # Text-to-speech (local + cloud)
├── storage.js                 # SQLite + SQLCipher (conversations, media)
├── kb-storage.js              # Knowledge base (sqlite-vec, embeddings)
├── folder-connect.js          # Folder indexing + chokidar file watcher
├── assistant-storage.js       # Persona/assistant CRUD
├── persona-storage.js         # System prompt management
├── prompt-storage.js          # Prompt template CRUD
├── rag-prompt-storage.js      # RAG-specific prompt templates
├── plugin-manager.js          # WordPress-style plugin system
├── plugin-generator.js        # AI-assisted plugin scaffolding
├── license-checker.js         # RSA-signed license validation
├── google-oauth.js            # Google OAuth for Vertex AI
├── stream-abort.js            # Streaming abort controller
├── sd-engine-manager.js       # Stable Diffusion engine (images)
├── renderer/
│   ├── index.html             # Dashboard shell
│   ├── app.js                 # Router, state, init
│   ├── providers.js           # Provider abstraction (Local, Vertex, API Key)
│   ├── pages/
│   │   ├── chat.js            # Chat UI (messages, streaming, tools)
│   │   ├── knowledge.js       # KB: collections + folder connect
│   │   ├── assistants.js      # Personas/assistants management
│   │   ├── prompts.js         # Prompt manager
│   │   └── settings.js        # Settings (models, plugins, advanced)
│   └── components/
│       ├── model-browser.js   # Model discovery + download UI
│       ├── model-advisor.js   # Hardware-aware recommendations
│       └── ...
├── engine/
│   └── version.json           # Pinned llama.cpp release + SHA256 checksums
├── bin/
│   └── iimagine-engine        # Renamed llama-server binary (not in git)
├── plugins/
│   └── word-count/            # Example plugin
├── mcp-servers/               # MCP server configurations
├── scripts/
│   ├── setup-engine.sh        # Download engine binary for dev
│   └── generate-model-registry.js
└── docs/
    ├── plugin-docs/           # 10-part plugin development guide
    ├── user-guide/            # End-user documentation
    └── ...
```

## Technical Notes

### Local AI Engine

The app bundles `iimagine-engine` — a renamed `llama-server` binary from llama.cpp. It runs as a child process managed by `engine-manager.js`.

**Lifecycle:**
- Engine starts when a model is selected or a chat message is sent
- Engine stops when the app closes or after an inactivity timeout
- Model switching = restart engine with a different `--model` flag

**API:** The engine exposes an OpenAI-compatible HTTP API on a dynamic localhost port:
- `POST /v1/chat/completions` — Chat (streaming and non-streaming)
- `POST /v1/embeddings` — Text embeddings for RAG
- `GET /health` — Health check

**Model Storage:**
- macOS: `~/Library/Application Support/iimagine-desktop/models/`
- Windows: `%APPDATA%/iimagine-desktop/models/`
- Linux: `~/.local/share/iimagine-desktop/models/`

**Binary Management:**
- `engine/version.json` is the single source of truth for which llama.cpp release ships
- SHA256 checksums ensure deterministic builds
- No llama.cpp source code in the repo — binary is a pre-built dependency
- Engine updates ship with app updates only (no runtime auto-update)

### Model Registry

Models are GGUF files downloaded directly from HuggingFace. The model registry (`model-registry.js` + `model-registry-bundled.json`) contains:
- Download URLs for each model variant
- Hardware requirements (min RAM, recommended RAM)
- Supported features (chat, vision, tool calling, embeddings)
- Quantization options

A remote manifest is fetched on startup and cached locally. The bundled JSON serves as an offline fallback.

### Plugin System

WordPress-style hooks. Plugins are Node.js modules in `~/.iimagine/plugins/`. Available hooks:
- `chatPreprocess` / `chatPostprocess`
- `sidebar` / `settings`
- `mention` / `commands`

### Encryption

All local data encrypted with AES-256 via SQLCipher. Key derived from OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service). Transparent to user.

### Auth

Not required. `AUTH_REQUIRED = false` by default. Auth only needed for paid plugin licenses or cloud provider tiers.
