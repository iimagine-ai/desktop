# IIMAGINE Desktop

A privacy-first, open-source AI desktop app. Run AI locally with full privacy, or connect your own API keys. No account required.

## Features (Free)

- **Local AI** — Chat with Ollama models, fully private, no data leaves your machine
- **API Key Support** — Connect OpenAI, Anthropic, Google, or OpenRouter keys
- **Knowledge Base** — Chat with your documents (PDF, Word, CSV, Markdown)
- **Folder Connect** — Auto-index any folder on your machine
- **Custom Personas** — Create and switch between system prompts
- **Prompt Manager** — Save and reuse prompt templates
- **Web Search** — Opt-in web search for current information
- **Tool Calling** — AI automatically searches web or documents when needed
- **Hardware Auto-Detection** — Recommends the best model for your hardware
- **Encrypted Storage** — AES-256 encryption via SQLCipher
- **Plugin System** — Install community plugins to extend functionality

## Quick Start

```bash
# Install Ollama first: https://ollama.com/download

# Clone and run
git clone https://github.com/delreyrunner/iimagine-ai-desktop.git
cd iimagine-ai-desktop
npm install
npm start
```

## Prerequisites

- **Node.js 18+**
- **Ollama** — Install from [ollama.com/download](https://ollama.com/download)

## Recommended Models

The app includes a Model Advisor that recommends models based on your hardware. Here are some starting points:

| Available RAM | Recommended Model | Why |
|--------------|-------------------|-----|
| 4GB | Gemma 4 E2B | Lightweight, fast responses |
| 8GB | Gemma 4 E4B (MoE) | Good quality at low resource cost |
| 16GB | Gemma 4 26B MoE | Best quality-to-resource ratio |
| 32GB+ | Gemma 4 31B Dense | Maximum quality |

Pull any model: `ollama pull <model-name>`

## Architecture

```
├── main.js                 # Electron main process
├── preload.js              # Secure IPC bridge
├── renderer/
│   ├── index.html          # App shell
│   ├── app.js              # Core UI logic
│   ├── pages/              # Page components (chat, knowledge, settings, etc.)
│   ├── components/         # Reusable UI components
│   └── providers.js        # AI provider management
├── plugins/
│   ├── word-count/         # Example: free plugin
│   └── privacy-proxy/      # Example: PII redaction for cloud models
├── storage.js              # SQLite conversation storage
├── kb-storage.js           # Knowledge base with vector search
├── plugin-manager.js       # WordPress-style plugin system
├── license-checker.js      # License validation (open source, auditable)
├── tool-calling.js         # Built-in tool calling (web search, RAG)
└── docs/                   # Documentation
```

## Plugin System

Plugins extend the app with new capabilities. The plugin system uses hooks:

- `chatPreprocess` — Modify messages before sending to the LLM
- `chatPostprocess` — Process responses after the LLM
- `sidebar` — Add pages to the sidebar
- `settings` — Add settings panels
- `mention` — Respond to @mentions in chat
- `commands` — Register slash commands

### Writing a Plugin

See `docs/plugin-docs/` for the full plugin development guide.

### Paid Plugins

Premium plugins (memory, client management, industry tools) are available from the [IIMAGINE Plugin Marketplace](https://app.iimagine.ai/desktop/plugins). They are distributed separately and require a subscription.

## Privacy

- **No account required** — The app works fully offline with local models
- **No telemetry** — Zero usage data collected
- **Encrypted storage** — All local data encrypted with AES-256
- **Open source license validation** — The networking code is in this repo for anyone to audit
- **Privacy indicator** — Every message shows whether it stayed local or went to cloud

## Development

```bash
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
