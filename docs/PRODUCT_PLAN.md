# IIMAGINE Desktop Companion — Product Plan

## Vision

A privacy-first, open-source AI desktop app with a WordPress-style plugin ecosystem. Free core for everyone. Paid plugins for professionals and business owners. Users own their data and choose their privacy level.

---

## Product Layers

### Layer 1: Free Open-Source Core

The base app that anyone can download and use without an account.

**What's included:**
- Chat UI with conversation history (SQLite)
- Three-tier privacy selector (Local / Regional Cloud / API Key)
- Ollama integration for local model management
- Model recommendation wizard (hardware auto-detection + use case → suggested model)
- Knowledge Base with two modes:
  - **Folder Connect** — point to any folder on your machine, it indexes all documents and stays synced. No need to organise files twice.
  - **Collections** — manually upload and organise documents into named collections (existing behaviour)
- Web Search (opt-in, requires internet) — model can search the web for current information via tool calling
- Custom Personas / System Prompts — create and save reusable system prompts (e.g. "You are a concise assistant", "You are a creative writer", "Always respond in bullet points"). Users can switch between personas per conversation. Mirrors the personalization feature at `/my-life/personalization` on the web app.
- Prompt Manager — full CRUD for saving reusable prompt templates (title, content, optional category/tags). A prompt template picker sits below the chat input box with search and auto-suggest so users can quickly find and insert saved prompts into the conversation. Stored locally in SQLite.
- Plugin system (install, enable, disable, uninstall)
- Settings, media storage, system tray

**What's NOT included (requires plugins):**
- Memory / personalization
- Industry-specific workflows
- Business management tools
- Cloud sync

**Data Security:**
- SQLCipher encryption for the local SQLite database — all user data (conversations, knowledge graph, prompts, memories) is encrypted at rest using AES-256. The encryption key is derived from the user's OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service). This means even if someone copies the database file, they cannot read it without the user's OS login. Transparent to the user — no password prompts, no setup required.

**Auth:** Not required. The app works fully offline with local models. Auth is only needed when a user installs a paid plugin or uses cloud provider tiers.

### Layer 2: Cortex Lite Plugin (Paid — Memory & Personalization)

A simplified version of the web Cortex memory system, adapted for local-first SQLite storage.

**What it does:**
- Extracts entities, preferences, and facts from every conversation
- Builds a local knowledge graph (people, places, topics, relationships)
- Retrieves relevant context before generating responses
- Learns communication preferences over time
- All data stays on the user's machine

**How it differs from web Cortex:**
- No SCOPED onboarding flow (too complex for desktop)
- No My Life modules (replaced by simpler "topics" in the KG)
- No Daily Briefing (desktop users aren't checking email summaries)
- No actions system (no Google Sheets, Calendar, etc.)
- Simpler entity extraction (LLM-based, not the full CPU pipeline)
- No vector DB for embeddings — uses sqlite-vec which is already installed

**Technical approach:**
- chatPostprocess hook: after every message, fire-and-forget extraction
- LLM prompt extracts: entities (name, type), relationships, user preferences, facts
- Stores in SQLite tables: entities, relationships, preferences, facts
- chatPreprocess hook: before every message, query KG for relevant context
- Inject context into system prompt (capped at token budget)
- Preference table tracks: response style, topics of interest, communication tone

### Layer 3: Business Advisor Plugin (Paid — The Differentiator)

An AI business management advisor powered by guided setup + advanced memory. This is the plugin that no competitor has and that leverages your direct experience.

---

## Business Advisor Plugin — Detailed Plan

### Concept

A guided onboarding wizard collects structured information about the user's business, populates the knowledge graph, then provides ongoing personalized advice about growth, operations, finance, team management, and problem-solving. The AI gets smarter about the specific business over time as the user continues to interact.

### Guided Setup Flow

The setup is a multi-step wizard (not a chat conversation). Each step is a focused form with clear fields. The user can skip steps and come back later. Progress is saved.

**Step 1: Business Basics**
- Business name
- Industry / sector
- Business model (product, service, SaaS, marketplace, agency, etc.)
- Stage (idea, pre-revenue, early revenue, growth, mature)
- Year founded
- Location / markets served

**Step 2: Financial Snapshot**
- Annual revenue (range selector, not exact — reduces friction)
- Monthly burn rate / operating costs (range)
- Funding status (bootstrapped, angel, seed, series A+, profitable)
- Runway remaining (if applicable)
- Revenue trend (growing, flat, declining)

**Step 3: Team & Operations**
- Team size (range)
- Key roles filled / missing
- Biggest operational bottleneck (free text)
- Tools currently used (CRM, accounting, project management — checklist)

**Step 4: Goals & Challenges**
- Top 3 business objectives (free text, one per field)
- Biggest challenge right now (free text)
- Timeline for key goals (dropdown: 3 months, 6 months, 1 year, 2+ years)
- What's been tried that didn't work (optional, free text)

**Step 5: Competitive Landscape**
- Main competitors (names, optional)
- What differentiates the business (free text)
- Biggest competitive threat (free text)

**Step 6: Owner / Manager Profile**
- Role in the business (founder, CEO, manager, etc.)
- Strengths (checklist: sales, product, tech, finance, marketing, operations, leadership)
- Areas wanting to improve (same checklist)
- Decision-making style (data-driven, intuitive, collaborative — radio)

All of this data is stored as structured entities and relationships in the local KG. Nothing leaves the machine.

### How the Advisor Works After Setup

**Context injection:** Every chat message gets enriched with relevant business context from the KG before being sent to the LLM. If the user asks "how should I handle a team member who's underperforming?", the system pulls: team size, business stage, owner's leadership style, current challenges, and any prior conversations about team issues.

**Ongoing learning:** Every conversation updates the KG. If the user mentions they just hired a marketing person, that gets extracted and stored. Next time they ask about marketing, the AI knows they have someone on it.

**Proactive patterns:** The plugin can detect patterns across conversations:
- User keeps mentioning cash flow → surface financial planning suggestions
- User hasn't mentioned progress on stated goals → gentle check-in
- User describes a problem that contradicts their stated strategy → flag the inconsistency

**Advisor modes (sidebar tabs in the plugin UI):**

1. **Chat** — General business conversation with full context. This is the default.

2. **Dashboard** — Visual summary of the business profile. Shows: goals and progress, team overview, financial health indicators, recent topics discussed. All generated from KG data, not hardcoded.

3. **Strategy Review** — On-demand analysis. User clicks "Review my strategy" and the AI generates a structured assessment based on everything it knows: what's working, what's at risk, what to focus on next. Uses the SCOPED-like framework internally (status vs objective, challenges vs enablers) but presents it in plain business language.

4. **Decision Helper** — User describes a decision they're facing. The AI pulls all relevant context and presents: pros/cons based on the specific business situation, what similar decisions have led to in past conversations, questions the user should consider, a recommended path with reasoning.

### KG Schema for Business Data

```
entities:
  - type: business        (name, industry, stage, model, founded, location)
  - type: person          (name, role, relationship to business)
  - type: goal            (description, timeline, priority, status)
  - type: challenge       (description, severity, related_goal)
  - type: competitor      (name, threat_level, differentiator)
  - type: tool            (name, category, satisfaction)
  - type: financial_metric (type, value, trend, as_of_date)
  - type: decision        (description, date, outcome, context)

relationships:
  - business → has_goal → goal
  - business → faces_challenge → challenge
  - business → competes_with → competitor
  - person → works_at → business
  - goal → blocked_by → challenge
  - decision → relates_to → goal
  - challenge → mitigated_by → tool
```

### Pricing

- Subscription: tied to IIMAGINE account
- Free trial: 14 days full access
- Pricing TBD but positioned as "fraction of the cost of a business coach"

---

## Payment & Licensing System

### Business Model

Free open-source core + paid plugin subscriptions (WordPress model). The core app is distributed as source and free downloads. Revenue comes entirely from plugin subscriptions.

### Payment Flow (via IIMAGINE Web App)

Payments are handled through the IIMAGINE web app using Stripe. The desktop app never handles payment forms directly.

**Purchase flow:**
1. User clicks "Get Plugin" in the desktop app (Settings → Plugins or in-app prompt)
2. Desktop app opens a browser window to `iimagine.ai/plugins/{plugin-slug}/purchase`
3. Web app shows plugin details, pricing (monthly/annual), and Stripe Checkout
4. User completes payment via Stripe Checkout (hosted, PCI-compliant)
5. Stripe webhook confirms payment → IIMAGINE API creates subscription record + issues signed license
6. Desktop app detects the new license on next sync (or user clicks "Refresh license")

**Why web-based payments:**
- Stripe Checkout is already PCI-compliant — no security surface area in Electron
- Reuses existing Stripe integration from the IIMAGINE web app
- Avoids iframe/embedded payment issues in Electron
- Standard pattern used by JetBrains, Obsidian, Sublime Text

### Subscription Plans

| Plan | Billing | License Duration | Validation Frequency |
|------|---------|-----------------|---------------------|
| Monthly | Charged on calendar anniversary | Valid until next billing date | Once per month (at renewal) |
| Annual | Charged once per year | Valid for 12 months | Once per year (at renewal) |

- Monthly subscribers get a license valid until their next billing date (same day next month)
- Annual subscribers get a license valid for 12 months from purchase — only need to validate once per year
- Both plans include a 14-day free trial

### Offline License System

Privacy-focused users can operate fully offline between validation checks. The license system is designed to minimize online requirements while preventing abuse.

**How it works:**

1. **On purchase/renewal:** The IIMAGINE API generates a signed license:
   ```json
   {
     "plugin": "cortex-lite",
     "user_id": "usr_abc123",
     "plan": "monthly",
     "valid_from": "2026-05-09T00:00:00Z",
     "valid_until": "2026-06-09T00:00:00Z",
     "signature": "RSA_SIGNATURE_HERE"
   }
   ```

2. **Stored locally:** License is saved encrypted on the user's machine (OS keychain or electron-store with machine-specific key). No sensitive data leaves the device.

3. **Offline operation:** Plugin checks the local license on startup. If `valid_until` hasn't passed → plugin works. No network call needed. User can be fully offline for the entire billing period.

4. **Silent renewal:** When the app has internet access and the billing date approaches, it silently calls the API to get a fresh license. The user never notices. If Stripe successfully charged the subscription, the new license extends to the next billing date.

5. **Pre-expiry reminder:** 3 days before `valid_until`, the app shows a gentle, non-blocking notification: "Your [Plugin Name] license renews on [date]. Please connect to the internet briefly to continue uninterrupted access." This is informational only — the plugin continues working until the actual expiry date.

6. **On expiry (no renewal):** If the billing date passes without a successful renewal (payment failed, subscription cancelled, or no internet for the entire period):
   - Plugin functionality pauses
   - User data is NOT deleted — their knowledge graph, memories, business data all remain intact
   - Message shown: "Your license needs to be refreshed. Connect to the internet to continue."
   - Once online, if subscription is still active (Stripe retried successfully), license refreshes automatically
   - If subscription was cancelled, user is directed to resubscribe via the web app

**Cryptographic verification:**
- Licenses are signed with an RSA private key on the IIMAGINE server
- The RSA public key is bundled in the desktop app binary
- The app verifies the signature offline — prevents tampering with `valid_until`
- No phone-home required for day-to-day operation

**Privacy commitment:**
- The only data that leaves the machine is a license validation request (user_id + plugin_id)
- No telemetry, no usage data, no conversation content is ever transmitted
- This is explicitly communicated in the plugin purchase page and app UI

### Trust & Transparency (Proving Privacy to Sceptical Users)

The subscription validation code lives in the open-source core — not in a proprietary plugin. It's the same code that every user downloads and that the community can inspect on GitHub.

**The message to sceptical users:**

"The code that handles your subscription check is open source. It's part of the core app that anyone can read. Ask any developer to review it. Paste it into ChatGPT and ask what it does. It sends your user ID and plugin name, gets back a signed license, and that's it. No conversations, no knowledge graph data, no personal information — ever."

**Why this works:**
- The license validation module is in the public repo — not hidden in a proprietary binary
- It's a small, self-contained file that takes 2 minutes to read
- Non-technical users can paste it into any AI and get a plain-English explanation of what it does
- Technical users can grep the entire codebase for outbound HTTP calls and confirm there's only one path
- The open-source community acts as a permanent, free audit — if the code ever changed to exfiltrate data, someone would flag it immediately

**Implementation rule:** All networking code must remain in the open-source core, never in a proprietary plugin. Paid plugins call the core's license API — they never make their own network requests.

### Web App API Endpoints (for desktop license management)

```
POST /api/desktop/plugins/purchase    → Initiates Stripe Checkout session
POST /api/desktop/license/validate    → Returns signed license (called on renewal)
GET  /api/desktop/license/status      → Check subscription status without full renewal
POST /api/desktop/plugins/cancel      → Cancel subscription (via web app UI)
```

### Stripe Configuration

- Each plugin is a Stripe Product with monthly and annual Price objects
- Subscriptions use `billing_cycle_anchor` to maintain consistent renewal dates
- Failed payments: Stripe's built-in retry logic (3 attempts over ~2 weeks)
- Cancellation: takes effect at end of current billing period (user keeps access until then)
- Webhook events handled: `invoice.paid`, `customer.subscription.deleted`, `customer.subscription.updated`

### Grace Period & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Payment fails, Stripe retrying | Plugin continues working until `valid_until` date |
| User cancels mid-cycle | Plugin works until end of paid period |
| User offline for entire month (monthly plan) | Plugin pauses after `valid_until`, resumes on reconnect if payment succeeded |
| User offline for entire year (annual plan) | Same — pauses after 12 months, resumes on reconnect |
| User changes machine | Sign in on new machine → license syncs automatically |
| Clock tampering detected | License signature includes server-issued timestamps; local clock manipulation doesn't extend validity |

---

## Local Model Compatibility & Hardware Auto-Detection

### The Problem

Not all local models work the same. Model compatibility depends on more than just parameter count:
- **Chat template** — Each model family uses a different prompt format. If Ollama doesn't have the right template, the model produces garbage or crashes.
- **Context window** — RAG injects extra tokens. A model with a 2K context window will choke on RAG because retrieved documents exceed its limit.
- **Quantization level** — Heavily quantized models (Q2, Q3) can become unstable. Q4 or Q5 of the same model might work perfectly.
- **Memory fit** — If a model doesn't fully fit in available RAM/VRAM, Ollama swaps layers to CPU causing extreme slowness that looks like a crash.
- **Architecture** — MoE (Mixture of Experts) models like Gemma 4 26B only activate a subset of parameters per token (~3.8B of 26B), making them dramatically more efficient than their total size suggests.

### Technical Foundation

Ollama is built on llama.cpp. We inherit llama.cpp's capabilities through Ollama including MoE support, GPU offloading (Metal on Mac, CUDA on Nvidia), quantization handling, and context window management. We don't need to interact with llama.cpp directly — Ollama's API is our interface.

### Hardware Auto-Detection (Settings → Model Advisor)

The app automatically scans user hardware on first launch using the `systeminformation` Node.js package (works in Electron's main process):

**What we detect:**
- Total RAM and available RAM
- GPU model and VRAM (discrete GPU) or unified memory (Apple Silicon)
- CPU model, cores, speed
- OS and architecture

**On Apple Silicon:** VRAM is shared (unified memory), so total RAM is the budget.
**On discrete GPU machines (Nvidia/AMD):** We get actual VRAM numbers separately.

**How it works:**
1. App scans hardware via `systeminformation` on first launch or when user opens Model Advisor
2. Calculate available budget: total RAM (or VRAM) minus ~4GB for OS overhead
3. Match against our tested model compatibility table
4. Show recommendation: "Based on your hardware (16GB RAM, Apple M2), we recommend Gemma 4 26B MoE. It will use ~10GB of your memory and leave room for RAG context."
5. One-click install: User clicks "Install recommended" → Ollama pulls the model

### Model Compatibility Matrix (maintained by us, updated over time)

| Available Memory | Recommended Model | Architecture | Active Params | Chat | RAG | Context Window |
|-----------------|-------------------|--------------|---------------|------|-----|----------------|
| 4GB | Gemma 4 E2B (Q4) | Dense | ~2B | ✅ | ⚠️ limited | 128K |
| 8GB | Gemma 4 E4B (Q4) | MoE | ~4B effective | ✅ | ✅ | 128K |
| 16GB | Gemma 4 26B MoE (Q4) | MoE (128 experts, ~3.8B active) | ~3.8B active | ✅ | ✅ | 256K |
| 16GB | Gemma 3 12B (Q4) | Dense | 12B | ✅ | ✅ | 128K |
| 32GB+ | Gemma 4 31B Dense (Q4) | Dense | 31B | ✅ | ✅ | 256K |

This table is a starting point. We test models ourselves and update it. Paid plugin users get access to a more detailed matrix with verified RAG compatibility, embedding model pairings, and performance benchmarks.

### Why Gemma 4 26B MoE is the Sweet Spot

Gemma 4's 26B MoE model (released April 2026, Apache 2.0 license) uses 128 tiny experts but only activates ~3.8B parameters per token. This means it delivers 27B-class intelligence at roughly 4B compute cost. For a user with 16GB RAM, this is the best quality-to-resource ratio available — significantly better than running a dense 7B model.

### User-Facing Approach

**For free users:**
- Hardware auto-detection + model recommendation wizard (one-click setup)
- Expanded use case categories: chat, coding, writing, analysis, **vision, tool calling, reasoning**
- Models tagged with supported capabilities so users can filter by what they need
- Warning message when selecting untested models: "This model hasn't been verified for use with our app. It may not support all features (like RAG). We recommend starting with our tested models."
- **Allow downloading any model from Ollama's library** regardless of recommendation — just show a warning if it exceeds hardware or hasn't been tested
- If a model fails to respond or crashes, show a helpful error: "This model isn't responding correctly. Try one of our recommended models instead."

**Tool calling approach (Phase 1):**
- Not building a visual agent builder or MCP server — that's developer tooling our target users don't need
- Instead: register built-in tools (web_search, rag_search) and pass them in the Ollama chat request when the model supports tool calling
- The model automatically decides when to search the web or query documents — no user configuration needed
- This is our "agent" — it just works transparently. Users don't need to know about tool calling, they just get better answers.
- MCP support deferred to Phase 4+ (developer-facing feature, not needed for core audience)

**Competitive note:** AnythingLLM offers a visual agent builder and MCP support, but these are aimed at developers building custom workflows. Our differentiator is memory + personalization for non-technical users. We don't need to match their agent complexity — we need to match their result quality, which tool calling achieves without the UI overhead.

**For paid plugin users:**
- Verified compatibility matrix: "These models are tested and confirmed to work with Cortex Lite's memory system"
- Automatic context window configuration based on the selected model
- If the user's hardware can't run any model that supports the plugin's features, show a clear message explaining the minimum requirements

### Advanced Settings (optional, for power users)

Ollama exposes parameters we can surface in an "Advanced" panel:

| Setting | What it controls | Ollama parameter | Default |
|---------|-----------------|-----------------|---------|
| GPU layers | How much of the model loads to GPU vs CPU | `num_gpu` | auto |
| Context window | Max tokens the model can process at once | `num_ctx` | Model default |
| Thread count | CPU threads used for inference | `num_thread` | auto |
| Keep alive | How long model stays loaded in memory | `keep_alive` | 5m |

Most users should never need to touch these. The auto-detection + recommended model handles it. But for users who want to experiment or have unusual hardware configurations, the option is there.

### Runtime Monitoring

Using Ollama's `GET /api/ps` endpoint, we can show users what's happening:
- Which model is currently loaded
- How much VRAM/RAM it's using (`size_vram` field)
- Current context length in use
- Whether the model is fully GPU-loaded or partially on CPU

This helps users understand why performance might be slow (model partially on CPU) and whether they should try a smaller model.

### Keeping the Model Database Current

The model recommendation engine uses a curated, manually-tested database. Models can't be auto-added because a new model appearing on Ollama doesn't guarantee it works with chat, RAG, or structured output. However, we need to know when new models are available.

**Approach: Daily cron on the web app that monitors Ollama's registry**

1. Daily cron job fetches `https://ollama.com/api/tags` (Ollama's public model library)
2. Compares against a stored list of known models
3. If new models from major families (gemma, qwen, llama, phi, mistral, gpt-oss, deepseek) appear, sends a notification to super admin
4. Super admin tests the model manually (chat, RAG, memory usage) — ~15 minutes per model
5. If it passes, adds it to `MODEL_DATABASE` in `model-advisor.js` and ships an app update

**Why not auto-add:** As experienced firsthand, some models crash the system (Qwen small), some don't support RAG (limited context window), and download sizes don't reflect runtime memory needs. The recommendation engine must only contain verified models.

**Note:** Ollama hosts models on its own CDN (`ollama.com/library`), not Hugging Face. Models originate from Hugging Face but Ollama converts them to GGUF format and hosts independently. The `ollama pull` command downloads from Ollama's servers.

---

## Web Search Integration

### Overview

Web search allows the AI to fetch current information from the internet when the user's question requires it. This is opt-in (disabled by default) and clearly labelled as requiring internet access.

### Two-Tier Approach

| Tier | Provider | Quality | Cost | How it works |
|------|----------|---------|------|-------------|
| Free users | SearXNG (self-hosted) | Good | ~$5/month fixed hosting | Desktop app calls our hosted SearXNG instance |
| Paid plugin users | Brave Search API or Tavily | Excellent | ~$3/1000 queries | Desktop app calls our web app API which proxies to paid provider |

### How it works technically

1. User enables "Web Search" toggle in chat (or model decides it needs web info via tool calling)
2. Model formulates a search query using Ollama's tool calling capability
3. Desktop app sends the query to our backend: `POST /api/desktop/web-search`
4. Backend routes to SearXNG (free users) or Brave/Tavily (paid users)
5. Results (title, URL, content snippet) returned to the desktop app
6. Results injected into the conversation as a tool response
7. Model synthesizes an answer using the search results

### SearXNG for free users

- Open-source meta-search engine (aggregates Google, Bing, DuckDuckGo results)
- Self-hosted on a small VPS or Docker container on existing infrastructure
- No per-query cost, no API keys needed, no third-party accounts
- Lightweight: a $5/month VPS handles thousands of searches/day
- Quality is decent — not as polished as dedicated APIs but good enough for general queries
- Privacy-friendly: SearXNG doesn't track users or store queries

### Paid API for plugin subscribers

- Proxied through our web app (`POST /api/desktop/web-search`) using the same auth as license validation
- Brave Search API ($3/1000 queries) or Tavily ($0.01/search) — both high quality
- Cost is negligible per user (even heavy users cost < $5/month)
- Better result quality, faster response times, more reliable

### Privacy note

Web search inherently requires internet access. The UI must clearly indicate when search is active:
- Toggle in chat: "🌐 Web Search: ON/OFF"
- When enabled, a small indicator shows the model is using web data
- Search queries go through our server (not directly from user's machine to Google)
- We don't log search queries — they're proxied and discarded

### UX

- Default: OFF (privacy-first)
- User can enable per-conversation or globally in Settings
- Models that support tool calling (most modern models) will automatically decide when to search
- Models without tool calling support: user can manually trigger search with a button

---

## Implementation Phases

### Phase 1: Core Cleanup (prerequisite for everything)

**Goal:** Ship a clean, auth-optional open-source core.

| # | Task | Status |
|---|------|--------|
| 1 | Make auth optional — app works without IIMAGINE account | ✅ Done (`AUTH_REQUIRED = false`, guest user mode) |
| 2 | Hardware auto-detection + model recommendation wizard | ✅ Done (`model-advisor.js` — RAM/GPU options, use case selection, 16+ models, scoring algorithm) |
| 3 | Chat UI with conversation history (SQLite) | ✅ Done (`storage.js` + `chat.js` — full CRUD, streaming, rename/delete/download) |
| 4 | Three-tier privacy selector (Local / Regional Cloud / API Key) | ✅ Done (`providers.js` — LocalProvider, VertexProvider, GatewayProvider with privacy indicators) |
| 5 | Ollama integration for local model management | ✅ Done (`main.js` — install engine, pull/delete/unload models, custom host, streaming progress) |
| 6 | Knowledge Base — Collections (manual upload/organize) | ✅ Done (`kb-storage.js` + `knowledge.js` — collections CRUD, PDF/DOCX/TXT/CSV/MD, chunking, sqlite-vec embeddings, vector search) |
| 7 | Knowledge Base — Folder Connect (folder indexing + file watcher) | ✅ Done (`folder-connect.js` — chokidar watcher, file parsing, auto-index on change, UI in knowledge page) |
| 8 | Custom Personas / System Prompts | ✅ Done (`assistant-storage.js` + `assistants.js` — full CRUD with system prompts and KB selection) |
| 9 | Prompt Manager (CRUD + picker below chat input with auto-suggest) | ✅ Done (`prompt-storage.js` + `prompts.js` page + `prompt-picker.js` dropdown with search) |
| 10 | Plugin system (install, enable, disable, uninstall) | ✅ Done (`plugin-manager.js` — WordPress-style, hooks: chatPreprocess/chatPostprocess/sidebar/settings/mention/commands) |
| 11 | Plugin developer documentation | ✅ Done (`PLUGIN_DEVELOPMENT.md` + `docs/plugin-docs/` — 10 detailed guides) |
| 12 | Settings page | ✅ Done (Profile, Models, Plugins, Memory tabs) |
| 13 | System tray | ✅ Done (icon, context menu, close-to-hide) |
| 14 | Media storage | ✅ Done (media table, image generation with auto-save) |
| 15 | Web Search integration | ✅ Done (`websearch:search` IPC — tries backend API, falls back to DuckDuckGo scrape + `web-search.js` renderer with augmentMessages) |
| 16 | Tool calling (web_search, rag_search as built-in tools) | ✅ Done (`tool-calling.js` — registers tools in Ollama chat, executes web_search/rag_search, feeds results back to model for synthesis) |
| 17 | Advanced settings (GPU layers, context window, thread count, keep alive) | ✅ Done (`advanced-ollama-settings.js` — collapsible panel with num_gpu, num_thread, keep_alive, num_ctx dropdowns, auto-save, reset to defaults) |
| 18 | Runtime monitoring (model loaded, VRAM usage, context length) | ✅ Done (`runtime-monitor.js` — polls Ollama /api/ps every 5s, shows loaded models with memory/VRAM/GPU status, unload button, countdown) |

**Summary: 18 done. Phase 1 core is complete.**

**Deliverable:** Downloadable app (Mac + Windows) that works out of the box with Ollama.

### Phase 2: Cortex Lite Plugin

**Goal:** Ship the memory system as the first paid plugin.

1. Build entity extraction pipeline
   - chatPostprocess hook fires after every assistant response
   - LLM prompt extracts: entities, relationships, preferences, facts
   - Stores in SQLite via plugin's own tables (not core tables)
2. Build context retrieval pipeline
   - chatPreprocess hook fires before every user message
   - Queries KG for entities related to the current topic
   - Queries recent conversation summaries
   - Injects relevant context into system prompt
   - Respects token budget (configurable, default 2000 tokens of context)
3. Build preference learning
   - Track: preferred response length, formality, topics of interest
   - Apply preferences to system prompt automatically
4. Build memory management UI
   - Settings panel showing: entity count, relationship count, storage size
   - Ability to view, edit, delete specific memories
   - "Forget everything" button
5. Test with real conversations across multiple sessions

**Deliverable:** Installable plugin that makes the AI remember and personalize.

### Phase 3: Business Advisor Plugin

**Goal:** Ship the guided business setup + ongoing advisory.

1. Build the guided setup wizard (6 steps as described above)
   - Each step saves to KG immediately (no "submit all at once")
   - Progress indicator, skip/back navigation
   - Can be re-entered to update information
2. Build the business context injection layer
   - Extends Cortex Lite's context retrieval
   - Adds business-specific entity weighting (goals and challenges rank higher)
   - Adds temporal awareness (recent financial data > old data)
3. Build the Dashboard tab
   - Renders business profile summary from KG
   - Shows goals with inferred progress status
   - Shows team overview
   - Shows recent conversation topics
4. Build the Strategy Review feature
   - Single-click generates a structured assessment
   - Uses all KG data + conversation history
   - Outputs: strengths, risks, focus areas, action items
5. Build the Decision Helper feature
   - User describes a decision
   - AI pulls relevant context and generates structured analysis
   - Saves decision and outcome to KG for future reference
6. Build ongoing extraction rules specific to business conversations
   - Detect financial updates, team changes, goal progress, new challenges
   - Update KG entities automatically

**Deliverable:** A plugin that turns the desktop app into a personalized business advisor.

### Phase 4: Plugin Marketplace

**Goal:** Enable discovery and installation of plugins from the web app.

1. Build marketplace UI on the IIMAGINE web app
   - Plugin listings with: name, description, author, rating, price, screenshots
   - Categories: Memory, Business, Legal, Accounting, Healthcare, Productivity
   - Install button that generates a download link / license key
2. Build marketplace client in the desktop app
   - Browse / search plugins from within Settings
   - One-click install (download zip, extract to plugins dir, activate)
   - License validation for paid plugins (check against IIMAGINE account)
   - Auto-update notifications
3. Build plugin submission flow for third-party developers
   - Upload plugin zip + manifest
   - Review process (manual initially)
   - Revenue share model (70/30 developer/platform, standard for marketplaces)

**Deliverable:** Working marketplace with at least 3-4 plugins listed.

### Phase 5: Vertical Industry Plugins

**Goal:** Build paid plugins for privacy-sensitive industries.

**Priority order (based on privacy sensitivity + willingness to pay):**

1. **Legal** — Document review, case summarization, client intake forms, precedent search, time tracking prompts. Lead with: "Your client data never leaves your machine."

2. **Accounting** — Financial statement analysis, tax planning conversations, client file review, compliance checklists. Lead with: "Discuss client financials with AI without violating confidentiality."

3. **Healthcare** — Patient note summarization, treatment plan discussion, medical literature Q&A. Lead with: "HIPAA-friendly AI — no patient data in the cloud."

4. **Real Estate** — Property analysis, market comparison, client communication drafts, deal tracking.

5. **Consulting** — Client engagement tracking, deliverable planning, proposal drafting, knowledge management across engagements.

Each vertical plugin follows the same pattern:
- Guided setup (collect industry-specific context)
- Custom UI tabs (not just chat)
- Pre-loaded prompt templates for common tasks
- Industry-specific entity extraction rules
- Optional RAG with curated knowledge bases

---

## Dependencies Between Phases

```
Phase 1 (Core Cleanup)
  └── Phase 2 (Cortex Lite) — needs plugin system + auth-optional
        └── Phase 3 (Business Advisor) — needs memory system
        └── Phase 5 (Verticals) — needs memory system
  └── Phase 4 (Marketplace) — needs plugin system + web app integration
```

Phase 3 and Phase 4 can run in parallel.
Phase 5 plugins can start development once Phase 2 is stable.

---

## What Makes This Defensible

1. **Memory system** — No desktop AI competitor has this. It's the core technical moat.
2. **Guided business setup** — Structured data collection is dramatically more useful than hoping users mention things in chat. This is domain expertise encoded into software.
3. **Plugin ecosystem** — Network effects. Once third-party developers build plugins, the platform becomes harder to replicate.
4. **Privacy positioning** — Not just "we don't collect data" but "here's a visual indicator showing exactly where your data goes for every message." Trust through transparency.
5. **Vertical depth** — Generic AI chat is a commodity. Industry-specific workflows with memory are not.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Local LLM quality too low for business advice | Default to "medium privacy" (Vertex) for complex analysis. Be transparent about model limitations in the UI. |
| Plugin conflicts break chat experience | Strict plugin API boundaries. Plugins can only modify messages through defined hooks. Core chat is always functional even if all plugins are disabled. |
| Users don't complete guided setup | Make every step independently valuable. Even partial data improves responses. Show immediate value after step 1. |
| Open source core gets forked without contributing back | Use a permissive license (MIT or Apache 2.0) for the core. Paid plugins are proprietary. The marketplace and memory system are the moat, not the chat shell. |
| Marketplace doesn't attract third-party developers | Ship 4-5 first-party plugins first to prove the model. Publish comprehensive plugin development docs. Offer early developer incentives. |

---

## Success Metrics

**Phase 1:** 1,000 downloads in first month. App runs without crashes on Mac + Windows.
**Phase 2:** 20% of free users try the Cortex Lite trial. 5% convert to paid.
**Phase 3:** Business Advisor plugin generates measurable recurring revenue. Users complete setup wizard at >60% rate.
**Phase 4:** 3+ third-party plugins submitted within 3 months of marketplace launch.
**Phase 5:** First vertical plugin (Legal) reaches 100 paying subscribers within 6 months.
