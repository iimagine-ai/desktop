# Client Workspace Plugin — Spec

## What It Is

A generic client/project management plugin for professionals who serve clients. Works for recruiters, lawyers, accountants, therapists, architects, consultants — anyone who manages client relationships and produces work product with AI assistance.

Vertical plugins (Legal Pro, Finance Pro, Health Pro) will extend this with industry-specific templates and terminology. But Client Workspace alone is useful for any profession.

---

## Reference Use Case: Recruiter

To validate the design, here's the complete workflow for a recruiter:

1. Recruiter wins a job from a client (managed in their existing CRM)
2. Opens Desktop Companion → creates a new project named after the client
3. Uploads client notes and emails into the project's Knowledge (Folder Connect or manual upload)
4. Goes to Chat → selects the client's KB collection → asks AI to draft a job ad based on requirements
5. Goes back and forth refining the job ad with AI
6. Clicks the **save icon** (📄) on the final AI response → gives it title "Client Job Ad" + optional description → saved to project
7. Opens the saved document in the project → makes manual edits → copies to send to client
8. Client approves (or requests changes) → recruiter edits the saved document directly
9. Copies final job ad to LinkedIn
10. Applications arrive → uploaded to project Knowledge
11. Uses a template prompt to score applicants against criteria (KB has all applications)
12. Uses another template to draft rejection emails and interview invitation emails
13. Saves each as a document in the project (with edits before sending)
14. Generates a client update report (AI has access to all project knowledge)
15. Saves report → edits → emails to client
16. Maintains internal notes throughout (discussed with AI, saved as documents)
17. Process repeats until project ends

**What's the same across all professions:** Steps 1-7 and the save/edit/copy cycle. The actual *work* (job ads vs legal memos vs tax returns) differs, but the workflow is identical.

---

## Architecture Principles

1. **Never block RAG/KB.** Preprocess hook wrapped in try/catch. Returns original messages on any error.
2. **No setup wizard.** Works immediately. Create a project, start working.
3. **Save icon on every AI response.** This is a core chat UI modification — a 📄 icon appears on each assistant message bubble. When clicked (and a project is active), prompts for title + optional description, then saves.
4. **Documents are editable.** Full CRUD. User can open, edit content inline, save changes, copy to clipboard, delete.
5. **Knowledge is per-project.** User connects a folder or uploads files to KB, then selects that collection in chat. The plugin just adds project context alongside it.
6. **Minimal context injection.** Only project name + notes. Don't overload — let KB/RAG handle document content.
7. **Timeline is automatic.** Logs every chat exchange and document save without user effort.

---

## Core Features

### 1. Projects (sidebar page — "📁 Projects")
- Create project (name required, optional: client email, notes, tags)
- Select active project → shown in chat header area
- Project list with search, status filter (active/archived)
- Project detail: Documents tab, Timeline tab, Notes tab

### 2. Save Icon on AI Responses (core chat UI modification)
- Every assistant message gets a small 📄 icon in its action bar
- Only functional when a project is active (greyed out / hidden otherwise)
- Click → modal/inline form: Title (required), Description (optional)
- Saves the full AI response content as a document in the active project
- Confirmation: "Saved to [Project Name]"

### 3. Documents (per project, full CRUD)
- List view in project detail (title, date, status badge)
- Click to open → full content displayed in an editor view
- **Edit:** inline editing (textarea/markdown), save button
- **Copy:** one-click copy full content to clipboard
- **Delete:** with confirmation
- **Status:** draft / final (user toggles)
- Each document stores: title, content, description, status, created_at, updated_at

### 4. Timeline (per project, automatic)
- Logs: "You: [summary]" / "AI: [summary]" for each chat exchange
- Logs: "Document saved: [title]"
- Logs: "Document edited: [title]"
- Logs: "Project created"
- Viewable in project detail, reverse chronological

### 5. Active Project Indicator
- When a project is active, show a small badge/label near the chat input or in the header:
  `📁 Acme Corp Recruitment` (clickable to switch/deactivate)
- This tells the user that context is being injected and saves will go to this project

### 6. Context Injection (minimal, safe)
```
[Active Project: {name}]
{notes if any}
You are assisting a professional working on this project.
The user is the professional. Respond as a knowledgeable assistant.
```

### 7. Slash Commands
| Command | Action |
|---------|--------|
| `/project [name]` | Switch active project |
| `/projects` | List all projects |
| `/new-project [name]` | Create new project |
| `/docs` | List documents for active project |
| `/time [description]` | Log a time/billing entry |

---

## Technical Implementation

### What's in the plugin (backend, hooks, sidebar):
- `plugin.json`, `index.js`, `db.js`
- `chatPreprocess` hook (inject project context, wrapped in try/catch)
- `chatPostprocess` hook (log to timeline, wrapped in try/catch)
- Sidebar page (project list + detail)
- Slash commands
- `onEvent` handler for save/edit/delete operations
- Settings panel

### What requires core chat UI modification:
- Save icon (📄) on each assistant message bubble
- This needs to be added to `renderer/pages/chat.js` where message bubbles are rendered
- The icon calls `window.api.plugins.sendEvent('cw:save-response', { content: messageContent })`
- The plugin handles the event, shows a title prompt, saves to DB

### Database Schema
```sql
CREATE TABLE IF NOT EXISTS cw_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_email TEXT,
  notes TEXT,
  tags TEXT DEFAULT '[]',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cw_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES cw_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cw_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES cw_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cw_time_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES cw_projects(id) ON DELETE CASCADE
);
```

### File Structure
```
plugins/client-workspace/
├── plugin.json
├── index.js          ← hooks, commands, events, UI
├── db.js             ← schema + CRUD
└── context.js        ← minimal context builder
```

---

## Plugin Hierarchy (Future)

```
Client Workspace (generic — works for everyone)
  ├── Legal Pro (adds: legal templates, conflict check, court dates, citation format)
  ├── Finance Pro (adds: tax templates, compliance checklists, FY tracking)
  ├── Health Pro (adds: clinical templates, consent tracking, referral letters)
  └── Recruiting Pro (adds: job ad templates, applicant scoring, interview scheduling)
```

Each vertical plugin extends Client Workspace's DB and adds its own templates/fields. The core workflow (create project → chat with KB → save documents → edit → send) stays the same.

---

## Implementation Order

1. Build the plugin (db, context, hooks, sidebar, commands, events)
2. Modify core chat UI to add save icon on assistant messages
3. Wire save icon to plugin event
4. Test e2e with recruiter workflow
5. Fix any RAG/KB conflicts (the #1 priority bug from v1)

