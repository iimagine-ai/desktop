// Client Workspace — Database layer
// Creates tables, provides CRUD helpers for projects, documents, timeline, time entries

const crypto = require('crypto');

const LOG = '[ClientWorkspace:DB]';

let db = null;

function init(database) {
  db = database;
  createTables();
}

function createTables() {
  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_cw_projects_status
      ON cw_projects(status);
    CREATE INDEX IF NOT EXISTS idx_cw_projects_name
      ON cw_projects(name COLLATE NOCASE);

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

    CREATE INDEX IF NOT EXISTS idx_cw_documents_project
      ON cw_documents(project_id);

    CREATE TABLE IF NOT EXISTS cw_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES cw_projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cw_timeline_project
      ON cw_timeline(project_id);

    CREATE TABLE IF NOT EXISTS cw_time_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      description TEXT NOT NULL,
      duration_minutes INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES cw_projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cw_time_entries_project
      ON cw_time_entries(project_id);
  `);

  console.log(`${LOG} Tables initialized`);
}

// ── Projects ────────────────────────────────────────────────────

function createProject({ name, clientEmail, notes, tags }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO cw_projects (id, name, client_email, notes, tags)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, clientEmail || null, notes || null, JSON.stringify(tags || []));

  addTimelineEntry(id, 'project_created', `Project "${name}" created`);
  return id;
}

function getProject(id) {
  return db.prepare('SELECT * FROM cw_projects WHERE id = ?').get(id);
}

function getAllProjects(status = null) {
  if (status) {
    return db.prepare(
      'SELECT * FROM cw_projects WHERE status = ? ORDER BY updated_at DESC'
    ).all(status);
  }
  return db.prepare('SELECT * FROM cw_projects ORDER BY updated_at DESC').all();
}

function searchProjects(query) {
  const pattern = `%${query}%`;
  return db.prepare(
    'SELECT * FROM cw_projects WHERE name LIKE ? COLLATE NOCASE ORDER BY updated_at DESC LIMIT 20'
  ).all(pattern);
}

function updateProject(id, { name, clientEmail, notes, tags, status }) {
  const project = getProject(id);
  if (!project) return false;

  db.prepare(`
    UPDATE cw_projects
    SET name = COALESCE(?, name),
        client_email = COALESCE(?, client_email),
        notes = COALESCE(?, notes),
        tags = COALESCE(?, tags),
        status = COALESCE(?, status),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name || null,
    clientEmail !== undefined ? clientEmail : null,
    notes !== undefined ? notes : null,
    tags ? JSON.stringify(tags) : null,
    status || null,
    id
  );
  return true;
}

function archiveProject(id) {
  db.prepare("UPDATE cw_projects SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(id);
  addTimelineEntry(id, 'project_archived', 'Project archived');
}

function deleteProject(id) {
  db.prepare('DELETE FROM cw_time_entries WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM cw_timeline WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM cw_documents WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM cw_projects WHERE id = ?').run(id);
}

// ── Documents ───────────────────────────────────────────────────

function createDocument({ projectId, title, description, content, status }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO cw_documents (id, project_id, title, description, content, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, projectId, title, description || null, content, status || 'draft');

  // Update project timestamp
  db.prepare("UPDATE cw_projects SET updated_at = datetime('now') WHERE id = ?").run(projectId);
  addTimelineEntry(projectId, 'document_saved', `Document saved: "${title}"`);
  return id;
}

function getDocument(id) {
  return db.prepare('SELECT * FROM cw_documents WHERE id = ?').get(id);
}

function getDocumentsForProject(projectId) {
  return db.prepare(
    'SELECT * FROM cw_documents WHERE project_id = ? ORDER BY updated_at DESC'
  ).all(projectId);
}

function updateDocument(id, { title, description, content, status }) {
  const doc = getDocument(id);
  if (!doc) return false;

  db.prepare(`
    UPDATE cw_documents
    SET title = COALESCE(?, title),
        description = COALESCE(?, description),
        content = COALESCE(?, content),
        status = COALESCE(?, status),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title || null,
    description !== undefined ? description : null,
    content !== undefined ? content : null,
    status || null,
    id
  );

  // Update project timestamp
  db.prepare("UPDATE cw_projects SET updated_at = datetime('now') WHERE id = ?").run(doc.project_id);
  addTimelineEntry(doc.project_id, 'document_edited', `Document edited: "${doc.title}"`);
  return true;
}

function deleteDocument(id) {
  const doc = getDocument(id);
  if (!doc) return false;
  db.prepare('DELETE FROM cw_documents WHERE id = ?').run(id);
  addTimelineEntry(doc.project_id, 'document_deleted', `Document deleted: "${doc.title}"`);
  return true;
}

// ── Timeline ────────────────────────────────────────────────────

function addTimelineEntry(projectId, type, summary) {
  db.prepare(`
    INSERT INTO cw_timeline (project_id, type, summary)
    VALUES (?, ?, ?)
  `).run(projectId, type, summary);
}

function getTimeline(projectId, limit = 50) {
  return db.prepare(
    'SELECT * FROM cw_timeline WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(projectId, limit);
}

// ── Time Entries ────────────────────────────────────────────────

function addTimeEntry({ projectId, description, durationMinutes }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO cw_time_entries (id, project_id, description, duration_minutes)
    VALUES (?, ?, ?, ?)
  `).run(id, projectId, description, durationMinutes || null);

  addTimelineEntry(projectId, 'time_logged', `Time logged: ${description}`);
  return id;
}

function getTimeEntries(projectId) {
  return db.prepare(
    'SELECT * FROM cw_time_entries WHERE project_id = ? ORDER BY created_at DESC'
  ).all(projectId);
}

// ── Stats ───────────────────────────────────────────────────────

function getStats() {
  const projects = db.prepare('SELECT COUNT(*) as count FROM cw_projects').get().count;
  const activeProjects = db.prepare("SELECT COUNT(*) as count FROM cw_projects WHERE status = 'active'").get().count;
  const documents = db.prepare('SELECT COUNT(*) as count FROM cw_documents').get().count;
  const timelineEntries = db.prepare('SELECT COUNT(*) as count FROM cw_timeline').get().count;
  const timeEntries = db.prepare('SELECT COUNT(*) as count FROM cw_time_entries').get().count;
  return { projects, activeProjects, documents, timelineEntries, timeEntries };
}

module.exports = {
  init,
  // Projects
  createProject,
  getProject,
  getAllProjects,
  searchProjects,
  updateProject,
  archiveProject,
  deleteProject,
  // Documents
  createDocument,
  getDocument,
  getDocumentsForProject,
  updateDocument,
  deleteDocument,
  // Timeline
  addTimelineEntry,
  getTimeline,
  // Time entries
  addTimeEntry,
  getTimeEntries,
  // Stats
  getStats,
};
