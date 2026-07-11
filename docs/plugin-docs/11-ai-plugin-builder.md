# AI Plugin Builder — Feature Plan

## Objective

Allow non-technical users to create custom plugins for IIMAGINE Desktop using natural language. Users describe what they want in the chat, and the AI generates a working plugin that appears in their sidebar immediately. No IDE, no coding, no terminal commands.

This is the Lovable/Bolt experience for desktop apps — but scoped to plugins (protecting the core) and running 100% locally (privacy-first).

## Why This Matters

- Removes the biggest barrier to open-source adoption: "I'd use it but I can't code"
- Every user becomes a power user through conversation
- The plugin system already exists and works — we're just adding an AI generation layer on top
- Differentiator: Lovable/Bolt are cloud-only. This is local, private, and extensible

## How It Works (User Perspective)

```
User: "Build me a plugin that tracks my daily expenses with categories"

AI: "Building your Expense Tracker plugin..."
    [generates plugin.json + index.js]
    [writes to ~/.iimagine/plugins/expense-tracker/]
    [reloads plugin system]

AI: "Done! 'Expenses' is now in your sidebar. Click it to start tracking."

User: "Add a monthly summary chart"

AI: "Updated. Refresh the page to see the chart."
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Chat Input (existing)                                       │
├─────────────────────────────────────────────────────────────┤
│  Intent Classifier (existing chatPreprocess pipeline)        │
│  → Detects "build/create/make plugin" intent                 │
├─────────────────────────────────────────────────────────────┤
│  Plugin Generator Module (NEW)                               │
│  ├── System prompt with SDK rules                            │
│  ├── LLM call (active model) → generates code               │
│  ├── Validator (checks manifest schema, basic lint)          │
│  └── Writer (saves files to plugins dir)                     │
├─────────────────────────────────────────────────────────────┤
│  Plugin Manager (existing)                                   │
│  → Hot-loads the new plugin, adds sidebar entry              │
├─────────────────────────────────────────────────────────────┤
│  Plugin Page (existing renderer)                             │
│  → User clicks sidebar entry, sees their new plugin working │
└─────────────────────────────────────────────────────────────┘
```

## What's Already Built

- Plugin system with discovery, loading, activation, sidebar injection
- Plugin manifest format (plugin.json)
- Event-based communication (renderer ↔ main process)
- Hot-reload capability (uninstall + install path exists)
- Chat pipeline with preprocess/postprocess hooks
- AI SDK rules document (`docs/AI_PLUGIN_GENERATION_SDK.md`)

## What Needs to Be Built

See task list below.

---

## Task List

### Phase 1: Core Generation Pipeline

- [x] **Task 1: Plugin Generator module** (`desktop-companion/plugin-generator.js`)
  - Function: `generatePlugin(userRequest, existingPluginId?)` → writes files to disk
  - Builds the system prompt from SDK doc
  - Calls the active LLM with the user's request
  - Parses the response (extracts plugin.json + index.js from code blocks)
  - Validates manifest schema (id, name, version, main, hooks present)
  - Writes files to `~/.iimagine/plugins/<id>/`
  - Returns `{ success, pluginId, error? }`

- [x] **Task 2: Plugin Validator** (inside plugin-generator.js)
  - Checks manifest has required fields
  - Checks index.js exports `activate` and `deactivate`
  - Checks no forbidden patterns (eval, child_process, etc.)
  - Returns `{ valid, errors[] }`

- [x] **Task 3: Hot-reload after generation**
  - After writing files, call `pluginManager.install()` or reload the specific plugin
  - Emit event to renderer to refresh sidebar items
  - Add IPC handler: `plugins:reload` that re-scans and re-renders sidebar

### Phase 2: Chat Integration

- [x] **Task 4: Intent detection for plugin generation**
  - In the chat pipeline, detect when user wants to create/modify a plugin
  - Trigger phrases: "build me a plugin", "create a plugin", "make me a tool", "add a page that..."
  - Can be done via simple keyword matching (no LLM needed for detection)
  - Route to plugin generator instead of normal chat response

- [x] **Task 5: Plugin modification support**
  - When user says "change X in my expense tracker" or "update the habit plugin"
  - Read existing plugin files from disk
  - Pass existing code + user's change request to LLM
  - Write updated files (preserving data tables — never DROP)
  - Hot-reload

- [x] **Task 6: Generation status UI**
  - Show progress in chat: "Generating plugin..." → "Writing files..." → "Done!"
  - On error: show what went wrong and offer to retry
  - On success: show the plugin name and prompt user to click sidebar

### Phase 3: Plugin Manager UI

- [x] **Task 7: "My Plugins" page in settings**
  - List all installed plugins with: name, author, status (enabled/disabled), source (ai-generated vs official)
  - Toggle enable/disable
  - Delete button (with confirmation)
  - "View code" button that opens the plugin directory in Finder/Explorer

- [x] **Task 8: Plugin history/versioning**
  - Before each AI modification, backup the previous version
  - Store in `~/.iimagine/plugins/<id>/.history/<timestamp>/`
  - "Undo last change" command that restores from backup
  - Keep max 5 versions per plugin

### Phase 4: Polish & Safety

- [x] **Task 9: Error recovery**
  - If generated plugin crashes on load, auto-disable it
  - Show error to user: "The generated plugin had an error. Want me to fix it?"
  - Feed the error back to the LLM for self-correction (max 2 retries)

- [ ] **Task 10: Plugin templates**
  - Pre-built starting points for common requests (tracker, dashboard, timer, journal)
  - AI uses these as reference patterns instead of generating from scratch
  - Faster generation, more consistent output

- [x] **Task 11: Sandbox enforcement**
  - Wrap plugin loading in try/catch with timeout
  - If a plugin takes >5s to activate, kill it and mark as broken
  - Log all plugin errors to `~/.iimagine/logs/plugin-errors.log`

### Phase 5: Builder Mode UX

- [x] **Task 12: Split-view "Builder Mode" layout**
  - When user is building/modifying a plugin, split the main content area into two columns
  - Left column: compact chat (messages + input)
  - Right column: live plugin preview (renders the plugin page in real-time)
  - Activates automatically when plugin generation intent is detected
  - "Exit Builder" button to return to full-screen chat
  - Plugin preview auto-refreshes after each modification
  - Resizable divider between chat and preview panels

---

## LLM Requirements

The plugin generator needs an LLM that can:
- Output valid JavaScript (Node.js)
- Follow a structured system prompt with schema rules
- Generate HTML with Tailwind classes
- Produce self-contained code (no external npm dependencies)

**Minimum capable models:**
- Cloud: GPT-5-mini, Claude Sonnet, Gemini Flash
- Local: Qwen 2.5 Coder 7B, DeepSeek Coder 6.7B, CodeLlama 13B

The generator uses whichever model is currently active in the app. If the user has a local model only, it uses that. If they have a cloud key configured, it uses that. Quality will vary by model capability.

---

## Success Criteria

1. User says "build me a habit tracker" → working plugin appears in sidebar in <15 seconds
2. User says "add a weekly view" → existing plugin updated without data loss
3. User says "delete my expense tracker plugin" → cleanly removed
4. Broken plugin doesn't crash the app — it's auto-disabled with a helpful error
5. Works fully offline with local models
6. Generated plugins follow the style guide (glass design, dark mode support)

---

## Files Created/Modified

| File | Status | Purpose |
|------|--------|---------|
| `docs/AI_PLUGIN_GENERATION_SDK.md` | ✅ Done | Rules document for the LLM |
| `docs/AI_PLUGIN_BUILDER.md` | ✅ Done | This file — plan and tasks |
| `plugin-generator.js` | To build | Core generation module |
| `plugin-manager.js` | Modify | Add hot-reload + reload IPC |
| `renderer/app.js` | Modify | Listen for sidebar refresh events |
| `renderer/pages/chat.js` | Modify | Add generation intent detection |
| `main.js` | Modify | Wire up generator IPC handlers |
