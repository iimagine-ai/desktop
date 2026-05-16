# IIMAGINE Desktop — Product Description

A privacy-first AI desktop application that gives users full control over where their data goes and which AI models they use. Run powerful language models locally on your own hardware, connect to frontier cloud models when you need more capability, or use both. No data leaves your machine unless you choose it.

---

## What It Is

IIMAGINE Desktop is an AI companion that combines the power of modern language models with long-term memory, document intelligence, and project management — all running from your desktop. It works without an account, without an internet connection, and without sending a single byte of your data to anyone.

Users choose their own privacy level per conversation: fully local (nothing leaves the machine), regional cloud (data stays in your jurisdiction), or frontier API (GPT, Claude, Gemini for maximum capability). A visual indicator shows exactly where data is going at all times.

---

## Core Features

**AI Chat with Model Choice**
Run open-source models locally via Ollama (Gemma, Llama, Qwen, Phi, Mistral) or connect to cloud APIs (OpenAI, Anthropic, Google) when you need frontier-level reasoning. Switch between models mid-conversation. Hardware auto-detection recommends the best local model for your machine.

**Knowledge Base & RAG**
Chat with your own documents. Point the app at any folder on your hard drive and it indexes everything — PDFs, Word docs, spreadsheets, text files, markdown. Ask questions and get answers grounded in your actual data. Supports both folder-based live sync and manually organized collections. Uses vector embeddings (sqlite-vec) for semantic search.

**Long-Term Memory**
The AI remembers across conversations. A hybrid memory system combining a relational database, vector database, and knowledge graph extracts entities, relationships, preferences, and facts from every interaction. This builds a persistent understanding of you that works beyond context window limits — the AI gets more useful the more you use it.

**Custom Assistants**
Create specialized AI personas with their own system prompts and knowledge bases. A business strategy advisor that knows your company. A writing coach tuned to your style. A research assistant connected to your reference library. Similar to custom GPTs, but private and running on your terms.

**Personas**
Give the AI different personalities for different contexts. A direct business partner. A supportive coach. A creative collaborator. A companion. Each persona shapes how the AI communicates — its tone, depth, formality, and approach — while drawing on the same underlying memory and knowledge.

**Prompt Manager**
Save, organize, and reuse prompts you rely on regularly. Full CRUD with categories and tags. A quick-access picker sits below the chat input with search and auto-suggest, so frequently used prompts are always one click away.

**Project & Client Management**
Organize work into projects with dedicated knowledge bases, conversation threads, and context. Manage client engagements, track deliverables, and keep project-specific information separated and accessible. The AI understands which project you're working in and pulls relevant context automatically.

**Web Search**
When the AI needs current information, it can search the web via tool calling. Opt-in, clearly indicated, and the model decides when it's needed. Works transparently — you get better answers without configuring anything.

**Plugin System**
A WordPress-style plugin architecture allows extending the app with specialized capabilities. Install, enable, disable, and uninstall plugins. Hooks into chat preprocessing, postprocessing, sidebar, settings, and commands. Open for third-party development.

---

## Privacy & Data Security

**The core principle:** Your data stays on your machine by default. Every feature works offline. Cloud connectivity is opt-in and clearly labelled.

**Encryption at rest:** All local data (conversations, knowledge graph, prompts, memories) is encrypted using AES-256 via SQLCipher. The encryption key lives in your OS keychain — even if someone copies the database file, they can't read it without your system login.

**Visual privacy indicator:** Every message shows which privacy tier is active. Green = fully local. Yellow = regional cloud. Blue = frontier API. No ambiguity about where data is going.

**Open source core:** The networking code is in the public repository. Anyone can inspect exactly what data leaves the machine and when. The community acts as a permanent audit.

---

## Who It's For

**Professionals in regulated industries**
Lawyers discussing client cases. Accountants reviewing financial data. Healthcare workers summarizing patient notes. These professionals need AI assistance but are bound by confidentiality obligations (attorney-client privilege, HIPAA, financial regulations). Local AI means they can use powerful language models without violating professional duties or risking data breaches.

**Individuals with personal privacy needs**
People seeking advice on sensitive personal matters — health concerns, financial decisions, legal questions, relationship issues — who don't want that data stored on corporate servers, used for training, or potentially exposed in a breach. Also includes personal companionship use cases (AI coaching, emotional support, roleplay) where the intimate nature of conversations makes privacy essential.

**Business owners and consultants**
People managing client relationships, strategic planning, and proprietary business information who want AI assistance without exposing competitive intelligence or client data to third-party platforms.

**Privacy-conscious users generally**
Anyone who believes their conversations, documents, and personal information shouldn't be stored on someone else's servers as a condition of using AI tools.

---

## Technical Foundation

- Electron desktop app (Mac, Windows, Linux)
- Local inference via Ollama (llama.cpp under the hood, Metal/CUDA GPU acceleration)
- SQLite + SQLCipher for encrypted local storage
- sqlite-vec for vector embeddings and semantic search
- Knowledge graph for entity and relationship tracking
- Plugin system with lifecycle hooks
- Three-tier provider architecture (Local / Regional Cloud / API Key)
- Hardware auto-detection and model recommendation engine

---

## What Makes It Different

Most AI chat apps are cloud-first with privacy as an afterthought. IIMAGINE Desktop is local-first with cloud as an option. The combination of local inference, long-term memory, document RAG, and a plugin ecosystem in a single privacy-focused package doesn't exist elsewhere. Competitors offer pieces — Ollama gives you local models but no memory, ChatGPT gives you memory but no privacy, AnythingLLM gives you RAG but targets developers. IIMAGINE Desktop brings all of these together for non-technical users who care about where their data lives.
