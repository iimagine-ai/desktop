# Cortex Memory Plugin — Testing Guide

## Prerequisites

- Python 3.12+ (verified: `python3 --version`)
- The desktop companion app (`desktop-companion/`)

## Setup (one-time)

```bash
cd desktop-companion/plugins/cortex
./scripts/setup.sh
```

Or manually:
```bash
cd desktop-companion/plugins/cortex
python3 -m venv .venv
source .venv/bin/activate
pip install -r sidecar/requirements.txt
```

## Test 1: Sidecar Standalone (no LLM needed)

Start the sidecar directly:
```bash
cd desktop-companion/plugins/cortex
source .venv/bin/activate
python -m sidecar.run --port 9199
```

In another terminal, verify:
```bash
# Health check
curl http://127.0.0.1:9199/health

# Expected: {"status":"ok","version":"2.0.0","entities":0,"edges":0}

# Stats
curl http://127.0.0.1:9199/stats

# Retrieve (empty graph — returns empty context)
curl -X POST http://127.0.0.1:9199/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query":"what is my business?","token_budget":1500}'

# Clear
curl -X DELETE http://127.0.0.1:9199/clear
```

## Test 2: Extraction with a Real LLM

Requires the iimagine-engine running with a chat model, OR a cloud API key.

**With cloud (OpenAI):**
```bash
curl -X POST http://127.0.0.1:9199/extract \
  -H "Content-Type: application/json" \
  -d '{
    "user_message": "My name is Adam and I run a software consulting business called IIMAGINE. We have 4 employees and focus on AI products.",
    "assistant_response": "Nice to meet you Adam! IIMAGINE sounds like an exciting AI consultancy.",
    "llm_config": {
      "provider": "openai",
      "model": "gpt-4.1-mini",
      "api_key": "sk-YOUR-KEY-HERE",
      "engine_port": 8847
    }
  }'
```

**With local model** (requires iimagine-engine running on port 8847):
```bash
curl -X POST http://127.0.0.1:9199/extract \
  -H "Content-Type: application/json" \
  -d '{
    "user_message": "My name is Adam and I run a software consulting business called IIMAGINE. We have 4 employees and focus on AI products.",
    "assistant_response": "Nice to meet you Adam! IIMAGINE sounds like an exciting AI consultancy.",
    "llm_config": {
      "provider": "local",
      "model": "gemma-4-e4b",
      "engine_port": 8847
    }
  }'
```

Expected: entities_created > 0, facts_stored > 0

## Test 3: Retrieve After Extraction

After a successful extraction:
```bash
curl -X POST http://127.0.0.1:9199/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query":"Who is Adam and what does he do?","token_budget":1500}'
```

Expected: non-empty `context` field with extracted entities/facts.

## Test 4: Full Desktop Integration

1. Start the desktop app: `npm run dev` (from desktop-companion/)
2. Go to Settings → Plugins → Enable "Cortex Memory"
3. Start chatting — the plugin will:
   - Inject memory context before each response (chatPreprocess)
   - Extract entities/facts after each response (chatPostprocess)
4. Check the "Memory" sidebar page for extracted entities

## Test 5: Embedding Prefix Verification

Requires nomic-embed-text model loaded in iimagine-engine:
```bash
# With sidecar running:
curl -X POST http://127.0.0.1:9199/verify-prefixes
```

Or manually test:
```bash
# With engine running on port 8847:
curl -X POST http://127.0.0.1:8847/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": "search_query: what is my business strategy", "model": "nomic-embed-text"}'

curl -X POST http://127.0.0.1:8847/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": "what is my business strategy", "model": "nomic-embed-text"}'
```

Compare the two embedding vectors — they MUST be different. If identical, prefixes are being stripped.

## Automated Smoke Test

```bash
./scripts/test-sidecar.sh
```

## File Locations

- Graph data: `~/.iimagine/memory/graph.rdb`
- Profile: `~/.iimagine/memory/profile.json`
- Pending updates: `~/.iimagine/memory/pending_updates.json`
- Python venv: `plugins/cortex/.venv/`
