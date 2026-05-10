# Project Workspace System — Spec

## Overview

A generic, industry-agnostic project container system that scopes all AI work (chat, documents, generated outputs, KG entities, activity) into discrete projects. Vertical plugins (Legal, Finance, Healthcare) register their own project types with custom fields, document categories, and workflow templates against this shared infrastructure.

This system is part of the plugin infrastructure layer — it ships alongside Cortex Lite and is available to all vertical plugins.

---

## Design Objectives

| Objective | How We Achieve It |
|-----------|-------------------|
| Industry-agnostic core | Generic schema with JSON metadata for type-specific fields |
| Vertical customization | Plugin registration API (`registerProjectType()`) |
| Context scoping | All chat, RAG, and KG retrieval filtered by active project |
| Output retention | Every AI-generated artifact saved, browsable, exportable |
| Handoff-ready | Timeline + outputs + docs = complete project package for humans or agents |
| Zero config for users | Vertical plugin handles all setup; user just creates a project |

---

## Architecture

### Where It Lives

The Project Workspace is a **core infrastructure module** (not a standalone plugin). It provides:
- SQLite tables for projects, documents, outputs, activity, entity links, chat sessions
- A registration API that vertical plugins call during `activate()`
- UI components (project list, project detail view with tabs) rendered via the `sidebar` hook
- Context injection hooks that filter retrieval by active project

Vertical plugins (Legal, Finance, Healthcare) are the actual paid plugins. They call `registerProjectType()` to configure the workspace for their industry.

### Dependency Chain

```
Core App (Phase 1)
  └── Cortex Lite Plugin (Phase 2) — memory system
        └── Project Workspace Module (this spec) — project scoping
              └── Legal Plugin (Phase 5) — registers legal_matter type
              └── Finance Plugin (Phase 5) — registers financial_engagement type
              └── Healthcare Plugin (Phase 5) — registers patient_case type
```

---

## Database Schema (SQLite)

```sql
-- Core project table (industry-agnostic)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_type TEXT NOT NULL,        -- 'legal_matter', 'financial_engagement', 'patient_case'
  status TEXT DEFAULT 'active',      -- plugin-defined statuses
  priority TEXT DEFAULT 'medium',    -- high, medium, low
  description TEXT,
  metadata TEXT,                     -- JSON blob for type-specific structured data
  folder_path TEXT,                  -- optional: linked folder for Folder Connect
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(project_type);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- Project documents (files uploaded, generated, or indexed)
CREATE TABLE IF NOT EXISTS project_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  doc_type TEXT NOT NULL,            -- 'uploaded', 'generated', 'indexed'
  category TEXT,                     -- plugin-defined: 'contract', 'correspondence', 'filing'
  file_path TEXT,                    -- local path to the file
  file_size INTEGER,
  mime_type TEXT,
  content_hash TEXT,                 -- for dedup / change detection
  metadata TEXT,                     -- JSON: extracted parties, dates, key terms, etc.
  indexed_at TEXT,                   -- when it was last indexed for RAG
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_docs_project ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_project_docs_category ON project_documents(category);

-- Project outputs (AI-generated work product)
CREATE TABLE IF NOT EXISTS project_outputs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  output_type TEXT NOT NULL,         -- 'draft', 'analysis', 'summary', 'time_entry', 'checklist'
  title TEXT NOT NULL,
  content TEXT NOT NULL,             -- the actual generated text (markdown)
  prompt_used TEXT,                  -- what prompt/template produced this
  template_id TEXT,                  -- reference to prompt template if used
  model_used TEXT,                   -- which LLM generated it
  status TEXT DEFAULT 'draft',       -- draft, approved, exported, discarded
  version INTEGER DEFAULT 1,        -- for regeneration tracking
  metadata TEXT,                     -- JSON for type-specific fields
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_outputs_project ON project_outputs(project_id);
CREATE INDEX IF NOT EXISTS idx_project_outputs_type ON project_outputs(output_type);

-- Project timeline / activity log
CREATE TABLE IF NOT EXISTS project_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  action TEXT NOT NULL,              -- 'chat', 'document_added', 'output_generated', 'status_changed', 'note_added'
  summary TEXT,                      -- human-readable: "Generated contract review analysis"
  details TEXT,                      -- JSON with full context
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_activity_project ON project_activity(project_id);
CREATE INDEX IF NOT EXISTS idx_project_activity_created ON project_activity(created_at);

-- Link KG entities to projects (many-to-many)
CREATE TABLE IF NOT EXISTS project_entities (
  project_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  role TEXT,                         -- 'client', 'opposing_party', 'vendor', 'patient', etc.
  added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, entity_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES memory_entities(id) ON DELETE CASCADE
);

-- Project chat sessions (scoped conversations)
CREATE TABLE IF NOT EXISTS project_chats (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT,
  message_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_chats_project ON project_chats(project_id);

-- Project notes (manual user notes, not AI-generated)
CREATE TABLE IF NOT EXISTS project_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

---

## Plugin Registration API

Vertical plugins register their project type during `activate()`:

```js
// Called by vertical plugins in their activate() function
context.registerProjectType({
  // Identity
  id: 'legal_matter',               // unique identifier, stored in projects.project_type
  label: 'Matter',                   // display name (what the industry calls a "project")
  labelPlural: 'Matters',           // for list headings
  icon: 'scale',                     // lucide icon name

  // Custom metadata fields (rendered in project create/edit forms)
  fields: [
    { key: 'matter_number', label: 'Matter Number', type: 'text', required: false },
    { key: 'practice_area', label: 'Practice Area', type: 'select', options: [...] },
    { key: 'jurisdiction', label: 'Jurisdiction', type: 'text' },
    { key: 'client_name', label: 'Client', type: 'text', required: true },
    { key: 'opposing_party', label: 'Opposing Party', type: 'text' },
    { key: 'billing_type', label: 'Billing', type: 'select', options: [...] },
    { key: 'next_deadline', label: 'Next Deadline', type: 'date' },
  ],

  // Document categories for this project type
  documentCategories: ['Contract', 'Correspondence', 'Filing', 'Memo', 'Evidence', 'Research'],

  // Output types this plugin can generate
  outputTypes: [
    { id: 'legal_memo', label: 'Legal Memo', icon: 'file-text' },
    { id: 'client_letter', label: 'Client Letter', icon: 'mail' },
    { id: 'time_entry', label: 'Time Entry', icon: 'clock' },
    { id: 'chronology', label: 'Chronology', icon: 'calendar' },
    { id: 'argument_outline', label: 'Argument Outline', icon: 'list' },
    { id: 'case_summary', label: 'Case Summary', icon: 'book-open' },
  ],

  // Prompt templates scoped to this project type
  promptTemplates: [
    { id: 'contract_review', label: 'Contract Review', category: 'Document Work', prompt: '...' },
    { id: 'demand_letter', label: 'Demand Letter', category: 'Correspondence', prompt: '...' },
    // ... more templates
  ],

  // Entity roles relevant to this project type (for project_entities.role)
  entityRoles: ['client', 'opposing_party', 'opposing_counsel', 'judge', 'witness', 'expert'],

  // Status options (override the default active/archived)
  statuses: [
    { id: 'active', label: 'Active', color: 'green' },
    { id: 'discovery', label: 'Discovery', color: 'blue' },
    { id: 'negotiation', label: 'Negotiation', color: 'yellow' },
    { id: 'trial_prep', label: 'Trial Prep', color: 'orange' },
    { id: 'settled', label: 'Settled', color: 'purple' },
    { id: 'closed', label: 'Closed', color: 'gray' },
  ],

  // Context injection priority rules
  contextRules: {
    priorityEntities: ['client', 'opposing_party'],  // these get highest weight in retrieval
    priorityFields: ['practice_area', 'jurisdiction'], // always include in system prompt
    maxDocumentsInContext: 5,                          // cap RAG results from project docs
  },

  // Extraction rules (extend Cortex Lite's extraction for this project type)
  extractionRules: {
    entityTypes: ['deadline', 'court_date', 'legal_issue', 'statute', 'precedent'],
    autoLinkToProject: true,  // extracted entities auto-linked to active project
  },
});
```

---

## Vertical Plugin Configurations

### Legal Plugin (`legal_matter`)

| Field | Type | Options |
|-------|------|---------|
| matter_number | text | — |
| practice_area | select | Corporate, Litigation, Family, IP, Real Estate, Criminal, Employment, Tax, Immigration |
| jurisdiction | text | — |
| client_name | text | — |
| opposing_party | text | — |
| court | text | — |
| billing_type | select | Hourly, Fixed Fee, Contingency, Pro Bono |
| next_deadline | date | — |

**Document categories:** Contract, Correspondence, Filing, Memo, Evidence, Research, Invoice

**Statuses:** Active, Discovery, Negotiation, Trial Prep, Settled, Closed, Archived

### Finance Plugin (`financial_engagement`)

| Field | Type | Options |
|-------|------|---------|
| engagement_type | select | Audit, Tax Return, Advisory, Bookkeeping, Compliance, Forensic |
| client_name | text | — |
| entity_type | select | Individual, Sole Trader, Partnership, Company, Trust, SMSF |
| financial_year | text | — |
| lodgement_deadline | date | — |
| fee_estimate | number | — |
| assigned_to | text | — |

**Document categories:** Financial Statements, Tax Return, Bank Statements, Receipts, Correspondence, Working Papers, Compliance, BAS

**Statuses:** Active, In Progress, Review, Lodged, Completed, Archived

### Healthcare Plugin (`patient_case`)

| Field | Type | Options |
|-------|------|---------|
| patient_id | text | — |
| condition | text | — |
| treating_team | text | — |
| insurance_provider | text | — |
| consent_status | select | Full Consent, Limited, Pending, Withdrawn |
| urgency | select | Routine, Urgent, Emergency |
| next_appointment | date | — |

**Document categories:** Clinical Notes, Imaging, Lab Results, Referrals, Consent Forms, Correspondence, Insurance

**Statuses:** Active, Monitoring, Treatment, Follow-up, Discharged, Archived

---

## UI Structure

### Project List (Sidebar Page)

```
┌─────────────────────────────────────┐
│  Matters                    [+ New] │
│  ─────────────────────────────────  │
│  🟢 Smith v Jones Corp             │
│     Employment • Discovery          │
│     Deadline: 15 Jun 2026           │
│                                     │
│  🟢 Acme Corp Acquisition          │
│     Corporate • Active              │
│     Deadline: 30 Jul 2026           │
│                                     │
│  🟡 Johnson Estate                 │
│     Family • Negotiation            │
│                                     │
│  ─────────────────────────────────  │
│  Archived (3)                    ▶  │
└─────────────────────────────────────┘
```

Features:
- Search/filter by name, status, practice area
- Sort by: last updated, deadline, priority, name
- Status color indicators
- Quick-create button
- Archived section collapsed by default

### Project Detail View (Main Content Area)

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back    Smith v Jones Corp                    [⚙ Edit]   │
│  Employment Law • Discovery • Due: 15 Jun 2026             │
├─────────────────────────────────────────────────────────────┤
│  [Chat]  [Documents]  [Outputs]  [Timeline]  [Notes]       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  (Tab content renders here)                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Tab: Chat

- Multiple chat threads per project (like channels)
- Default thread created with project
- AI automatically gets project context injected
- Chat history scoped to this project only
- Prompt template picker shows project-type-specific templates first

### Tab: Documents

- Grid/list view of all project documents
- Upload button (drag-and-drop supported)
- Category filter (from plugin's `documentCategories`)
- Each document shows: name, category, date added, indexed status
- Click to preview (text/PDF) or open in system viewer
- "Link Folder" button to connect a local folder via Folder Connect

### Tab: Outputs

- Chronological list of all AI-generated work product
- Each output shows: title, type, date, status badge (draft/approved/exported)
- Click to view full content
- Actions: Copy, Edit, Regenerate, Export (as .md, .docx, .txt), Mark as Approved, Discard
- Filter by output type
- "Generate New" button with output type selector

### Tab: Timeline

- Reverse-chronological activity feed
- Auto-generated entries:
  - "Chat: Discussed settlement strategy" (summarized from chat)
  - "Document added: Employment_Contract_2019.pdf"
  - "Output generated: Demand Letter Draft v2"
  - "Status changed: Active → Discovery"
  - "Entity linked: Sarah Smith (client)"
- Manual entries via "Add Note" button
- No user effort required — timeline builds itself

### Tab: Notes

- Simple markdown notes (manual, not AI-generated)
- For quick thoughts, reminders, observations
- Timestamped, editable, deletable

---

## Context Injection (Project-Scoped Retrieval)

When a user chats within a project, the retrieval pipeline adds project-specific context:

### Modified Retrieval Flow

```
User message arrives (within project context)
        │
        ▼
┌─────────────────────────────────────────────────────┐
│  Standard Cortex Lite Retrieval                     │
│  (vector search, KG lookup, summaries)              │
│  PLUS:                                              │
│                                                     │
│  1. Inject project metadata fields as context       │
│  2. Priority-weight entities linked to this project │
│  3. RAG search scoped to project documents only     │
│  4. Include recent project outputs as context       │
│  5. Project-specific chat history prioritized       │
└─────────────────────────────────────────────────────┘
        │
        ▼
  Assembled context (within token budget)
        │
        ▼
  Injected into system prompt
```

### Context Injection Format

```
[Project Context: Smith v Jones Corp]
Type: Legal Matter (Employment Law)
Status: Discovery
Jurisdiction: NSW, Australia
Client: Sarah Smith
Opposing: Jones Manufacturing Pty Ltd
Billing: Hourly
Next Deadline: Subpoena response due 15 June 2026

Key documents (5 indexed):
- Employment Contract (2019) — 12 pages
- Termination Letter (March 2026) — 2 pages
- Performance Reviews 2020-2025 — 28 pages
- Email correspondence re: termination — 8 pages
- Company policy handbook — 45 pages

Recent outputs:
- Chronology of Events (generated 2 May 2026)
- Letter to Opposing Counsel re: Discovery (generated 5 May 2026)

Linked entities:
- Sarah Smith (client) — employee, wrongful termination claim
- Jones Manufacturing Pty Ltd (opposing_party)
- Mark Thompson (opposing_counsel) — partner at Baker & Co
[End Project Context]
```

---

## Project-Scoped Extraction

When Cortex Lite's `chatPostprocess` hook fires within a project context, the extraction pipeline:

1. Runs standard entity/relationship/fact extraction
2. Auto-links extracted entities to the active project (via `project_entities`)
3. Applies plugin-specific extraction rules (e.g., detect deadlines, court dates, legal issues)
4. Logs extraction activity to the project timeline

---

## Folder Connect Integration

Each project can optionally link to a local folder:

- User clicks "Link Folder" in the Documents tab
- Selects a folder on their machine (e.g., `~/Cases/Smith_v_Jones/`)
- Folder Connect (from Phase 1 core) watches this folder
- New/changed files are automatically indexed and added to `project_documents`
- Documents inherit the project's RAG scope — only searched when chatting within this project

This means a lawyer can point the plugin at their existing matter folder structure and immediately get AI context from all their case files.

---

## Export & Handoff

### Project Export

Users can export a complete project package:

```
Smith_v_Jones_Export/
├── project-summary.md          ← metadata, status, key dates
├── timeline.md                 ← full activity log
├── outputs/
│   ├── demand-letter-v2.md
│   ├── chronology.md
│   └── case-summary.md
├── notes/
│   └── strategy-notes.md
└── chat-summaries/
    ├── thread-1-summary.md
    └── thread-2-summary.md
```

Documents are NOT included in export (they're already on the user's machine). Only AI-generated content and metadata.

### Agent Handoff (Future)

When agent delegation is implemented, a project provides bounded context:
- Agent receives: project metadata + document index + output history + timeline
- Agent can be instructed: "Review all documents and generate a case summary"
- Agent's work is saved as project outputs with `model_used: 'agent'`

### Human Handoff

The export package gives a human (paralegal, associate, new accountant) everything they need:
- What the project is about (metadata)
- What happened (timeline)
- What was produced (outputs)
- What was discussed (chat summaries)

---

## Implementation Tasks

### Task 1: Database & CRUD Module
- [ ] Create all SQLite tables in a `project-workspace-db.js` module
- [ ] Implement CRUD helpers: `createProject()`, `getProject()`, `updateProject()`, `archiveProject()`, `deleteProject()`
- [ ] Implement document helpers: `addDocument()`, `getProjectDocuments()`, `removeDocument()`
- [ ] Implement output helpers: `saveOutput()`, `getProjectOutputs()`, `updateOutputStatus()`
- [ ] Implement activity helpers: `logActivity()`, `getProjectTimeline()`
- [ ] Implement entity link helpers: `linkEntity()`, `getProjectEntities()`, `unlinkEntity()`
- [ ] Implement chat session helpers: `createChat()`, `getProjectChats()`
- [ ] Implement notes helpers: `addNote()`, `getProjectNotes()`, `updateNote()`, `deleteNote()`

### Task 2: Registration API
- [ ] Implement `context.registerProjectType(config)` in the plugin manager
- [ ] Store registered project types in memory (not persisted — plugins re-register on activate)
- [ ] Validate registration config (required fields, valid types)
- [ ] Expose `context.getProjectTypes()` for UI rendering
- [ ] Expose `context.getProjectType(typeId)` for type-specific config lookup

### Task 3: Project List UI (Sidebar Page)
- [ ] Render project list grouped by status
- [ ] Search/filter functionality
- [ ] Sort options (last updated, deadline, priority, name)
- [ ] Create project dialog (renders fields from registered type)
- [ ] Edit project dialog
- [ ] Archive/delete with confirmation
- [ ] Status color indicators

### Task 4: Project Detail UI (Tabs)
- [ ] Tab navigation (Chat, Documents, Outputs, Timeline, Notes)
- [ ] Chat tab: scoped chat interface with project context injection
- [ ] Documents tab: upload, categorize, list, preview, link folder
- [ ] Outputs tab: list, view, copy, export, regenerate, status management
- [ ] Timeline tab: activity feed (auto + manual entries)
- [ ] Notes tab: simple markdown editor with CRUD

### Task 5: Context Injection Integration
- [ ] Modify Cortex Lite's `chatPreprocess` hook to detect active project
- [ ] Build project context assembler (metadata + entities + doc summaries + recent outputs)
- [ ] Add project-scoped RAG filtering (only search project documents)
- [ ] Add project entity priority weighting in retrieval
- [ ] Respect token budget (project context + standard context combined)

### Task 6: Project-Scoped Extraction
- [ ] Modify Cortex Lite's `chatPostprocess` hook to detect active project
- [ ] Auto-link extracted entities to active project
- [ ] Apply plugin-specific extraction rules
- [ ] Log extraction events to project timeline

### Task 7: Folder Connect Integration
- [ ] Add "Link Folder" action to project documents tab
- [ ] Connect to existing Folder Connect module (from Phase 1)
- [ ] Auto-add indexed files to `project_documents`
- [ ] Scope folder's RAG index to the project

### Task 8: Export System
- [ ] Build project export function (generates markdown package)
- [ ] Export includes: summary, timeline, outputs, notes, chat summaries
- [ ] Save as zip or folder on user's machine
- [ ] Add "Export Project" button to project settings

### Task 9: Testing
- [ ] Test project CRUD (create, read, update, archive, delete)
- [ ] Test multi-type registration (register legal + finance simultaneously)
- [ ] Test context injection (verify project context appears in chat)
- [ ] Test document scoping (RAG only searches project docs when in project)
- [ ] Test output retention (generated content saved and browsable)
- [ ] Test timeline auto-generation (actions logged without user effort)
- [ ] Test folder connect integration (linked folder indexes to project)
- [ ] Test export (complete package generated correctly)

---

## File Structure

```
src/
├── project-workspace/
│   ├── db.js                    ← schema creation, CRUD helpers
│   ├── registry.js              ← project type registration API
│   ├── context-injector.js      ← project-scoped context assembly
│   ├── activity-logger.js       ← timeline auto-generation
│   ├── exporter.js              ← project export to markdown/zip
│   └── ui/
│       ├── project-list.js      ← sidebar project list
│       ├── project-detail.js    ← tabbed detail view
│       ├── documents-tab.js     ← document management UI
│       ├── outputs-tab.js       ← output browser UI
│       ├── timeline-tab.js      ← activity feed UI
│       └── notes-tab.js         ← notes editor UI
```

---

## Configuration (stored in electron-store)

```json
{
  "project-workspace.defaultSort": "updated",
  "project-workspace.showArchived": false,
  "project-workspace.contextTokenBudget": 2000,
  "project-workspace.maxDocsInContext": 5,
  "project-workspace.autoLogActivity": true,
  "project-workspace.exportFormat": "markdown"
}
```

---

## Cross-Vertical Compatibility Matrix

| Feature | Legal | Finance | Healthcare | Business Advisory |
|---------|-------|---------|------------|-------------------|
| Custom fields | Practice area, jurisdiction, parties, deadlines | Entity type, FY, lodgement deadline, fee | Condition, treating team, consent, urgency | Industry, stage, revenue, goals |
| Document categories | Contracts, filings, evidence, memos | Financials, tax returns, bank statements | Clinical notes, imaging, lab results | Business plans, financials, research |
| Output types | Memos, letters, time entries, chronologies | Tax memos, client letters, checklists | Treatment summaries, referrals, care plans | Strategy reviews, decision analyses |
| Entity roles | Client, opposing party, judge, witness | Client, director, trustee, ATO contact | Patient, doctor, specialist, insurer | Founder, advisor, competitor, investor |
| Statuses | Active → Discovery → Trial → Settled | Active → In Progress → Lodged → Complete | Active → Treatment → Follow-up → Discharged | Active → Review → Implemented → Complete |
| Deadlines | Filing dates, limitation periods | Lodgement dates, BAS due dates | Appointment dates, referral expiry | Goal deadlines, review dates |
| Folder Connect | Matter folders | Client engagement folders | Patient record folders | Project folders |

---

## Relationship to Existing Systems

### vs Business Advisor Plugin (Phase 3)

The Business Advisor plugin from the product plan uses a guided setup wizard + KG. The Project Workspace system is complementary:
- Business Advisor = one persistent business profile (the user's own business)
- Project Workspace = multiple discrete projects (client work, cases, engagements)

A user could have the Business Advisor active for their own firm management AND use the Legal Plugin's project workspace for client matters. They don't conflict.

### vs Cortex Lite (Phase 2)

Cortex Lite provides the memory infrastructure (extraction, retrieval, KG). Project Workspace adds scoping on top:
- Without Project Workspace: all memory is global (one big KG)
- With Project Workspace: memory can be scoped per project (entities linked to projects, RAG filtered by project docs)

Cortex Lite remains functional without Project Workspace. Project Workspace requires Cortex Lite.

---

## Privacy Note

All project data stays local. The project workspace system:
- Stores everything in the local SQLite database (encrypted via SQLCipher)
- Never transmits project names, client names, or document contents
- Folder Connect indexes files locally — no cloud upload
- Export generates local files only

This is critical for legal and healthcare users where client/patient confidentiality is non-negotiable.
