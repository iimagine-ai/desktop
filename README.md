# IIMAGINE Desktop

A privacy-first, open-source AI desktop app. Run AI locally with zero external dependencies, or connect your own API keys. No account required.

## Features

- **Local AI** — Bundled inference engine (iimagine-engine). No external software to install.
- **API Key Support** — Connect OpenAI, Anthropic, Google, or OpenRouter keys
- **Knowledge Base** — Chat with your documents (PDF, Word, CSV, Markdown)
- **Folder Connect** — Auto-index any folder on your machine
- **Custom Personas** — Create and switch between system prompts
- **Prompt Manager** — Save and reuse prompt templates
- **Web Search** — Opt-in web search for current information
- **Tool Calling** — AI automatically searches web or documents when needed
- **Hardware Auto-Detection** — Recommends the best model for your hardware
- **Encrypted Storage** — AES-256 encryption via SQLCipher
- **Plugin System** — WordPress-style hooks to extend functionality
- **MCP Integrations** — Connect to Model Context Protocol servers
- **Text-to-Speech** — Local and cloud TTS for AI responses

## Quick Start

```bash
git clone https://github.com/iimagine-ai/desktop.git
cd desktop
npm install
npm start
```

The engine binary is automatically downloaded on first run via the setup script. Models are downloaded through the in-app Model Browser.

## Prerequisites

- **Node.js 18+** (for development only)

That's it. The AI engine is bundled with the app — no external software required.

## Recommended Models

The app includes a **Model Advisor** that scans your hardware and recommends models based on available RAM, GPU, and your use case. Open it from Settings → Models → Find the Right Model.

| Available RAM | Recommended Model | Why |
|--------------|-------------------|-----|
| 4GB | Gemma 4 E2B | Lightweight, fast responses |
| 8GB | Gemma 4 E4B (MoE) | Good quality at low resource cost |
| 16GB | Gemma 4 26B MoE | Best quality-to-resource ratio |
| 32GB+ | Gemma 4 31B Dense | Maximum quality |

Models are GGUF files downloaded from HuggingFace directly through the app.

## Architecture

```
├── main.js                    # Electron main process
├── preload.js                 # Secure IPC bridge
├── engine-manager.js          # iimagine-engine lifecycle (start/stop/switch)
├── model-registry.js          # Model catalog + HuggingFace download URLs
├── model-orchestrator.js      # Model selection and routing
├── download-manager.js        # Model download with progress tracking
├── local-ai-adapter.js        # OpenAI-compatible API adapter
├── tool-calling.js            # Built-in tools (web search, RAG)
├── mcp-client.js              # Model Context Protocol client
├── skills-manager.js          # Skills/capabilities management
├── tts-service.js             # Text-to-speech service
├── hardware-scanner.js        # Cross-platform hardware detection
├── storage.js                 # SQLite conversation storage (SQLCipher)
├── kb-storage.js              # Knowledge base with vector search
├── folder-connect.js          # Folder indexing + file watcher
├── plugin-manager.js          # WordPress-style plugin system
├── persona-storage.js         # Custom personas/system prompts
├── prompt-storage.js          # Prompt template management
├── license-checker.js         # License validation (open source, auditable)
├── renderer/
│   ├── index.html             # App shell
│   ├── app.js                 # Core UI logic
│   ├── pages/                 # Page components (chat, knowledge, settings, etc.)
│   ├── components/            # Reusable UI components
│   └── providers.js           # AI provider management
├── engine/
│   └── version.json           # Pinned engine version + checksums
├── plugins/
│   └── word-count/            # Example plugin
├── mcp-servers/               # Bundled MCP server configs
├── scripts/
│   └── setup-engine.sh        # Downloads engine binary for development
└── docs/                      # Documentation
```

## Plugin System

Plugins extend the app with new capabilities. The plugin system uses WordPress-style hooks:

- `chatPreprocess` — Modify messages before sending to the LLM
- `chatPostprocess` — Process responses after the LLM
- `sidebar` — Add pages to the sidebar
- `settings` — Add settings panels
- `mention` — Respond to @mentions in chat
- `commands` — Register slash commands

### Writing a Plugin

See `docs/plugin-docs/` for the full plugin development guide.

### Premium Plugins

Premium plugins (memory, client management, industry tools) are available from the [IIMAGINE Plugin Marketplace](https://app.iimagine.ai/desktop/plugins). They are distributed separately and require a subscription.

## Privacy

- **No account required** — The app works fully offline with local models
- **No telemetry** — Zero usage data collected
- **Encrypted storage** — All local data encrypted with AES-256
- **Open source license validation** — The networking code is in this repo for anyone to audit
- **Privacy indicator** — Every message shows whether it stayed local or went to cloud
- **Bundled engine** — The AI engine runs as a child process of the app. No background services, no phone-home.

## Development

```bash
# Download the engine binary (first time only)
./scripts/setup-engine.sh

# Dev mode (hot reload)
npm run dev

# Build for macOS
npm run build:mac

# Build for Windows
npm run build:win

# Build for Linux
npm run build:linux
```

## License

MIT — see [LICENSE](LICENSE)

## Links

- [Plugin Marketplace](https://app.iimagine.ai/desktop/plugins)
- [Documentation](https://app.iimagine.ai/desktop/docs)
- [Developer Guide](https://app.iimagine.ai/desktop/developers)
