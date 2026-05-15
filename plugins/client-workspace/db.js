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
      client_name TEXT,
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

    CREATE TABLE IF NOT EXISTS cw_comms (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'other',
      content TEXT NOT NULL,
      comm_date TEXT NOT NULL DEFAULT (date('now')),
      summary TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES cw_projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cw_comms_project
      ON cw_comms(project_id);
    CREATE INDEX IF NOT EXISTS idx_cw_comms_date
      ON cw_comms(project_id, comm_date DESC);

    CREATE TABLE IF NOT EXISTS cw_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      due_date TEXT,
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES cw_projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cw_tasks_project
      ON cw_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_cw_tasks_status
      ON cw_tasks(project_id, status);

    CREATE TABLE IF NOT EXISTS cw_project_folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      auto_index INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES cw_projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cw_project_folders_project
      ON cw_project_folders(project_id);

    CREATE TABLE IF NOT EXISTS cw_billing_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      billed INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES cw_projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cw_billing_items_project
      ON cw_billing_items(project_id);
  `);

  console.log(`${LOG} Tables initialized`);

  // Migration: add client_name, client_email columns if missing (for existing databases)
  const projCols = db.prepare("PRAGMA table_info(cw_projects)").all().map(c => c.name);
  if (!projCols.includes('client_name')) {
    db.exec(`ALTER TABLE cw_projects ADD COLUMN client_name TEXT`);
    db.exec(`ALTER TABLE cw_projects ADD COLUMN client_email TEXT`);
    console.log(`${LOG} Migrated cw_projects: added client_name, client_email`);
  }

  // Migration: add on_kanban column to cw_tasks if missing
  const taskCols = db.prepare("PRAGMA table_info(cw_tasks)").all().map(c => c.name);
  if (!taskCols.includes('on_kanban')) {
    db.exec(`ALTER TABLE cw_tasks ADD COLUMN on_kanban INTEGER DEFAULT 0`);
    console.log(`${LOG} Migrated cw_tasks: added on_kanban`);
  }
}

// ── Projects ────────────────────────────────────────────────────

function createProject({ name, clientName, clientEmail, notes, tags }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO cw_projects (id, name, client_name, client_email, notes, tags)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, clientName || null, clientEmail || null, notes || null, JSON.stringify(tags || []));

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

// ── Communications ──────────────────────────────────────────────

function addComm({ projectId, source, content, commDate, summary }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO cw_comms (id, project_id, source, content, comm_date, summary)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, projectId, source || 'other', content, commDate || new Date().toISOString().split('T')[0], summary || null);

  db.prepare("UPDATE cw_projects SET updated_at = datetime('now') WHERE id = ?").run(projectId);
  addTimelineEntry(projectId, 'comm_logged', `Communication logged (${source || 'other'})`);
  return id;
}

function getComms(projectId, limit = 50) {
  return db.prepare(
    'SELECT * FROM cw_comms WHERE project_id = ? ORDER BY comm_date DESC, created_at DESC LIMIT ?'
  ).all(projectId, limit);
}

function getComm(id) {
  return db.prepare('SELECT * FROM cw_comms WHERE id = ?').get(id);
}

function deleteComm(id) {
  const comm = getComm(id);
  if (!comm) return false;
  db.prepare('DELETE FROM cw_comms WHERE id = ?').run(id);
  addTimelineEntry(comm.project_id, 'comm_deleted', 'Communication deleted');
  return true;
}

// ── Tasks ────────────────────────────────────────────────────────

function createTask({ projectId, title, description, status, dueDate }) {
  const id = crypto.randomUUID();
  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 as next FROM cw_tasks WHERE project_id = ? AND status = ?'
  ).get(projectId, status || 'todo');
  db.prepare(`
    INSERT INTO cw_tasks (id, project_id, title, description, status, due_date, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, title, description || null, status || 'todo', dueDate || null, maxPos.next);
  db.prepare("UPDATE cw_projects SET updated_at = datetime('now') WHERE id = ?").run(projectId);
  addTimelineEntry(projectId, 'task_created', `Task created: "${title}"`);
  return id;
}

function getTasks(projectId) {
  return db.prepare(
    'SELECT * FROM cw_tasks WHERE project_id = ? ORDER BY status, position ASC'
  ).all(projectId);
}

function getTask(id) {
  return db.prepare('SELECT * FROM cw_tasks WHERE id = ?').get(id);
}

function updateTask(id, { title, description, status, dueDate, position }) {
  const task = getTask(id);
  if (!task) return false;
  db.prepare(`
    UPDATE cw_tasks
    SET title = COALESCE(?, title),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        due_date = COALESCE(?, due_date),
        position = COALESCE(?, position),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title || null,
    description !== undefined ? description : null,
    status || null,
    dueDate !== undefined ? dueDate : null,
    position !== undefined ? position : null,
    id
  );
  if (status && status !== task.status) {
    addTimelineEntry(task.project_id, 'task_moved', `Task "${task.title}" moved to ${status}`);
  }
  return true;
}

function deleteTask(id) {
  const task = getTask(id);
  if (!task) return false;
  db.prepare('DELETE FROM cw_tasks WHERE id = ?').run(id);
  addTimelineEntry(task.project_id, 'task_deleted', `Task deleted: "${task.title}"`);
  return true;
}

function getKanbanTasks() {
  return db.prepare(
    `SELECT t.*, p.name as project_name FROM cw_tasks t
     JOIN cw_projects p ON t.project_id = p.id
     WHERE t.on_kanban = 1 AND p.status = 'active'
     ORDER BY t.status, t.position ASC`
  ).all();
}

function toggleTaskKanban(id, onKanban) {
  const task = getTask(id);
  if (!task) return false;
  db.prepare('UPDATE cw_tasks SET on_kanban = ? WHERE id = ?').run(onKanban ? 1 : 0, id);
  return true;
}

// ── Project Folders ─────────────────────────────────────────────

function addProjectFolder({ projectId, folderPath, folderName, autoIndex }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO cw_project_folders (id, project_id, folder_path, folder_name, auto_index)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, projectId, folderPath, folderName, autoIndex ? 1 : 0);
  db.prepare("UPDATE cw_projects SET updated_at = datetime('now') WHERE id = ?").run(projectId);
  addTimelineEntry(projectId, 'folder_connected', `Folder connected: "${folderName}"`);
  return id;
}

function getProjectFolders(projectId) {
  return db.prepare(
    'SELECT * FROM cw_project_folders WHERE project_id = ? ORDER BY created_at DESC'
  ).all(projectId);
}

function removeProjectFolder(id) {
  const folder = db.prepare('SELECT * FROM cw_project_folders WHERE id = ?').get(id);
  if (!folder) return false;
  db.prepare('DELETE FROM cw_project_folders WHERE id = ?').run(id);
  addTimelineEntry(folder.project_id, 'folder_removed', `Folder removed: "${folder.folder_name}"`);
  return true;
}

function updateProjectFolder(id, { autoIndex }) {
  db.prepare('UPDATE cw_project_folders SET auto_index = ? WHERE id = ?').run(autoIndex ? 1 : 0, id);
  return true;
}

// ── Billing Items ───────────────────────────────────────────────

function createBillingItem({ projectId, name, amount }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO cw_billing_items (id, project_id, name, amount)
    VALUES (?, ?, ?, ?)
  `).run(id, projectId, name, amount || 0);
  db.prepare("UPDATE cw_projects SET updated_at = datetime('now') WHERE id = ?").run(projectId);
  addTimelineEntry(projectId, 'billing_item_created', `Billing item created: "${name}"`);
  return id;
}

function getBillingItems(projectId) {
  return db.prepare(
    'SELECT * FROM cw_billing_items WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId);
}

function getBillingItem(id) {
  return db.prepare('SELECT * FROM cw_billing_items WHERE id = ?').get(id);
}

function updateBillingItem(id, { name, amount, completed, billed, paid }) {
  const item = getBillingItem(id);
  if (!item) return false;
  db.prepare(`
    UPDATE cw_billing_items
    SET name = COALESCE(?, name),
        amount = COALESCE(?, amount),
        completed = COALESCE(?, completed),
        billed = COALESCE(?, billed),
        paid = COALESCE(?, paid),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name || null,
    amount !== undefined ? amount : null,
    completed !== undefined ? (completed ? 1 : 0) : null,
    billed !== undefined ? (billed ? 1 : 0) : null,
    paid !== undefined ? (paid ? 1 : 0) : null,
    id
  );
  return true;
}

function deleteBillingItem(id) {
  const item = getBillingItem(id);
  if (!item) return false;
  db.prepare('DELETE FROM cw_billing_items WHERE id = ?').run(id);
  addTimelineEntry(item.project_id, 'billing_item_deleted', `Billing item deleted: "${item.name}"`);
  return true;
}

// ── Stats ───────────────────────────────────────────────────────

function getStats() {
  const projects = db.prepare('SELECT COUNT(*) as count FROM cw_projects').get().count;
  const activeProjects = db.prepare("SELECT COUNT(*) as count FROM cw_projects WHERE status = 'active'").get().count;
  const documents = db.prepare('SELECT COUNT(*) as count FROM cw_documents').get().count;
  const timelineEntries = db.prepare('SELECT COUNT(*) as count FROM cw_timeline').get().count;
  const timeEntries = db.prepare('SELECT COUNT(*) as count FROM cw_time_entries').get().count;
  const comms = db.prepare('SELECT COUNT(*) as count FROM cw_comms').get().count;
  return { projects, activeProjects, documents, timelineEntries, timeEntries, comms };
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
  // Communications
  addComm,
  getComms,
  getComm,
  deleteComm,
  // Tasks
  createTask,
  getTasks,
  getTask,
  updateTask,
  deleteTask,
  getKanbanTasks,
  toggleTaskKanban,
  // Project Folders
  addProjectFolder,
  getProjectFolders,
  removeProjectFolder,
  updateProjectFolder,
  // Billing Items
  createBillingItem,
  getBillingItems,
  getBillingItem,
  updateBillingItem,
  deleteBillingItem,
  // Stats
  getStats,
};
