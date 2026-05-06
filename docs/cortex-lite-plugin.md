# Cortex Lite Plugin — Advanced Memory for Desktop Companion

## Overview

A plugin that gives the desktop companion persistent memory across conversations. It extracts entities, relationships, and facts from every conversation, stores them in a local knowledge graph + vector database, and retrieves relevant context before generating responses. Works with any model the user has configured (Ollama local, Vertex AI, API keys).

## Design Objectives

| Objective | How We Achieve It |
|-----------|-------------------|
| Max accuracy | Structured LLM extraction with typed JSON output; entity deduplication via upsert; confidence scoring |
| Min latency | Retrieval uses SQLite queries only (no LLM call); extraction runs fire-and-forget after response is shown |
| Max relevance | Hybrid retrieval: vector similarity + KG traversal + recency weighting |
| Optimal context window | Configurable token budget (default 1500); priority ranking prevents noise |

## Architecture

### Three Storage Layers

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Knowledge Graph | SQLite tables | Entities + relationships (structured recall) |
| Vector DB | sqlite-vec (768-dim) | Semantic search over facts/chunks (fuzzy matching) |
| Chat Summaries | SQLite table | Compressed conversation history (context efficiency) |

### Data Flow

```
User message arrives
        │
        ▼
┌─────────────────────────────────────────┐
│  chatPreprocess hook (RETRIEVAL)        │
│                                         │
│  1. Extract topic keywords from message │
│  2. Vector search → top-k similar facts │  ~50ms
│  3. KG query → related entities/rels    │  ~10ms
│  4. Recent summaries → last 3           │  ~5ms
│  5. Assemble context within token budget│
│  6. Inject into system prompt           │
└─────────────────────────────────────────┘
        │
        ▼
  LLM generates response (any model)
        │
        ▼
┌─────────────────────────────────────────┐
│  chatPostprocess hook (EXTRACTION)      │
│  (fire-and-forget — does not block UI)  │
│                                         │
│  1. Send user+assistant msg to LLM      │
│     with extraction prompt              │  ~200-500ms
│  2. Parse JSON → entities, rels, facts  │
│  3. Upsert entities to KG (dedup)       │  ~10ms
│  4. Generate embedding for new facts    │  ~100ms
│  5. Store embedding in sqlite-vec       │  ~5ms
│  6. Summarize if conversation is long   │
└─────────────────────────────────────────┘
```

### How It Uses the Active Model

The plugin does NOT manage its own LLM providers. It calls whatever model the user has configured in the desktop app via `context.getOllamaUrl()` or the active provider's chat/embedding endpoints. This means it works with Llama, Gemma, Mistral, Qwen, GPT, Claude — anything the app supports.

For embeddings specifically, it uses Ollama's `/api/embeddings` endpoint with a small embedding model (e.g., `nomic-embed-text`). If no embedding model is available, it falls back to keyword-based retrieval only.

## Database Schema

```sql
-- Entities (people, topics, goals, preferences, facts)
CREATE TABLE IF NOT EXISTS memory_entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,           -- person, topic, goal, preference, habit, etc.
  name TEXT NOT NULL,
  properties TEXT,              -- JSON blob for flexible attributes
  confidence REAL DEFAULT 1.0,
  mention_count INTEGER DEFAULT 1,
  last_mentioned TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(type, name)           -- dedup key
);

CREATE INDEX IF NOT EXISTS idx_memory_entities_type ON memory_entities(type);
CREATE INDEX IF NOT EXISTS idx_memory_entities_name ON memory_entities(name);

-- Relationships between entities
CREATE TABLE IF NOT EXISTS memory_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- knows, wants, blocked_by, works_at, etc.
  properties TEXT,              -- JSON blob
  strength REAL DEFAULT 1.0,   -- reinforced on repeated mention
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES memory_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES memory_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_rels_source ON memory_relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_memory_rels_target ON memory_relationships(target_id);

-- Facts (atomic statements for vector search)
CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,        -- "User prefers concise responses"
  source TEXT,                  -- conversation id or timestamp
  entity_ids TEXT,              -- JSON array of related entity IDs
  created_at TEXT DEFAULT (datetime('now'))
);

-- Vector embeddings for facts (sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings
  USING vec0(fact_id TEXT PRIMARY KEY, embedding float[768]);

-- Conversation summaries (compressed history)
CREATE TABLE IF NOT EXISTS memory_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  summary TEXT NOT NULL,
  message_count INTEGER,
  token_estimate INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
```

## Extraction Prompt (Simplified from Web Cortex)

The extraction prompt asks the LLM to read the user+assistant exchange and output structured JSON:

```json
{
  "entities": [
    { "type": "person", "name": "Sarah", "properties": { "relationship": "wife" } },
    { "type": "goal", "name": "Lose 10kg", "properties": { "deadline": "Dec 2026", "priority": "high" } }
  ],
  "relationships": [
    { "source": "User", "target": "Sarah", "type": "married_to" },
    { "source": "User", "target": "Lose 10kg", "type": "wants" }
  ],
  "facts": [
    "User is married to Sarah",
    "User wants to lose 10kg by December 2026",
    "User prefers short direct answers"
  ],
  "preferences": {
    "response_style": "concise",
    "topics_of_interest": ["fitness", "business"]
  }
}
```

## Retrieval Strategy

When a new message arrives, the plugin retrieves context using three methods in parallel:

1. **Vector search** — embed the user message, find top-5 similar facts from `memory_embeddings`
2. **KG lookup** — extract keywords from message, find matching entities, traverse 1-hop relationships
3. **Recent summaries** — pull last 3 conversation summaries

Results are ranked by:
- Direct entity name match (highest priority)
- Vector similarity score
- Recency (newer = higher weight)
- Mention count (frequently discussed = more relevant)

The assembled context is capped at the token budget (default 1500 tokens) and injected as a system message before the conversation.

## Context Injection Format

```
[Memory Context]
Known about the user:
- Married to Sarah (person)
- Goal: Lose 10kg by Dec 2026 (high priority)
- Prefers concise responses
- Interested in: fitness, business

Related past conversations:
- Discussed gym routine options last week
- Mentioned knee injury limits running

Recent context:
- Last session discussed meal planning for weight loss
[End Memory Context]
```

## What This Skips vs Web Cortex

| Web Cortex Feature | Status | Reason |
|---|---|---|
| SCOPED onboarding flow | Skipped | Too complex for v1, add later |
| Provider manager (multi-LLM routing) | Skipped | App handles this at the platform level |
| Async CPU with setImmediate | Simplified | Single process, use setTimeout(fn, 0) |
| Business context / IMPACT modules | Skipped | Not relevant for desktop |
| Graph intelligence (blocking chains) | Skipped for v1 | Add in v2 |
| Workspace/multi-user | Skipped | Single user, single DB |
| Daily Briefing | Skipped | Desktop users don't need email summaries |
| Actions system (Google Sheets, etc.) | Skipped | Not in scope |

---

## Implementation Tasks

### Task 1: Plugin Scaffold
- [ ] Create `plugins/cortex-lite/plugin.json` manifest
- [ ] Create `plugins/cortex-lite/index.js` entry point with activate/deactivate
- [ ] Register hooks: `chatPreprocess`, `chatPostprocess`, `sidebar`, `settings`
- [ ] Verify plugin loads and activates without errors

### Task 2: Database Setup
- [ ] Create all SQLite tables in `activate()` using `context.db`
- [ ] Handle migrations gracefully (check if tables exist before creating)
- [ ] Create the sqlite-vec virtual table for embeddings
- [ ] Add helper functions: `upsertEntity()`, `upsertRelationship()`, `addFact()`, `addSummary()`
- [ ] Add `getStats()` function for the settings UI

### Task 3: Extraction Pipeline (chatPostprocess)
- [ ] Build the extraction prompt (adapted from web Cortex's SCOPED extractor)
- [ ] Call the active model via Ollama `/api/chat` with the extraction prompt
- [ ] Parse the JSON response with error handling (LLMs sometimes return malformed JSON)
- [ ] Upsert extracted entities (dedup by type+name, increment mention_count)
- [ ] Upsert extracted relationships
- [ ] Store extracted facts as text rows
- [ ] Make extraction non-blocking (don't delay the response shown to user)

### Task 4: Embedding Generation
- [ ] Call Ollama `/api/embeddings` with `nomic-embed-text` (or user-configured embedding model)
- [ ] Store embeddings in `memory_embeddings` sqlite-vec table
- [ ] Handle case where no embedding model is available (graceful fallback)
- [ ] Batch embed new facts after extraction

### Task 5: Retrieval Pipeline (chatPreprocess)
- [ ] Implement vector search: embed user message → query sqlite-vec → top-5 facts
- [ ] Implement KG lookup: extract keywords → find matching entities → 1-hop traversal
- [ ] Implement summary retrieval: pull last 3 summaries
- [ ] Implement token budget assembly: rank results, truncate to budget
- [ ] Format context as system message injection
- [ ] Return modified messages array with context prepended

### Task 6: Conversation Summarization
- [ ] Track message count per conversation session
- [ ] After N messages (default 10), generate a summary via LLM
- [ ] Store summary in `memory_summaries` table
- [ ] Use summaries in retrieval to provide longer-term context

### Task 7: Settings UI
- [ ] Render settings panel showing: entity count, fact count, relationship count, storage size
- [ ] Add token budget slider (500–3000 tokens, default 1500)
- [ ] Add embedding model selector (list available Ollama models)
- [ ] Add "Clear all memory" button with confirmation
- [ ] Add toggle for extraction on/off (in case user wants to pause learning)

### Task 8: Memory Browser (Sidebar Page)
- [ ] Render a sidebar page showing the knowledge graph contents
- [ ] List entities grouped by type with search/filter
- [ ] Show relationships for selected entity
- [ ] Allow manual deletion of specific entities/facts
- [ ] Show recent facts with timestamps

### Task 9: Testing & Validation
- [ ] Test with multi-turn conversation: verify entities are extracted
- [ ] Test retrieval: verify relevant context appears in subsequent conversations
- [ ] Test deduplication: same entity mentioned twice doesn't create duplicates
- [ ] Test token budget: verify context doesn't exceed configured limit
- [ ] Test with different models (Llama, Gemma, Mistral) to confirm model-agnostic
- [ ] Test graceful degradation when embedding model unavailable

### Task 10: Performance Optimization
- [ ] Measure extraction latency — target < 500ms for postprocess
- [ ] Measure retrieval latency — target < 100ms for preprocess
- [ ] Add caching for frequently accessed entities
- [ ] Batch embedding generation (don't embed one fact at a time)
- [ ] Add index on `memory_entities(name)` for fast keyword lookup

---

## File Structure

```
plugins/cortex-lite/
├── plugin.json          ← manifest
├── index.js             ← entry point (hooks, activate/deactivate)
├── db.js                ← schema creation, CRUD helpers
├── extractor.js         ← extraction pipeline (postprocess)
├── retriever.js         ← retrieval pipeline (preprocess)
├── embeddings.js        ← embedding generation via Ollama
├── summarizer.js        ← conversation summarization
└── ui.js                ← settings panel + sidebar page HTML
```

## Configuration (stored in electron-store)

```json
{
  "cortex-lite.tokenBudget": 1500,
  "cortex-lite.embeddingModel": "nomic-embed-text",
  "cortex-lite.extractionEnabled": true,
  "cortex-lite.summarizeAfterMessages": 10,
  "cortex-lite.maxFactsInContext": 5,
  "cortex-lite.maxEntitiesInContext": 8
}
```
