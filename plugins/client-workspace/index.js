// Client Workspace — Project Management Plugin
// Create projects, save AI responses as documents, track timelines.
// Works for any professional: recruiters, lawyers, accountants, consultants.

const cwDb = require('./db');
const ui = require('./ui');
const { buildProjectContext, summarizeForTimeline } = require('./context');

const LOG = '[ClientWorkspace]';

let context = null;
let store = null;
let activeProjectId = null;
let lastUserMessage = '';

// ── Plugin Lifecycle ────────────────────────────────────────────

module.exports = {
  activate(ctx) {
    context = ctx;
    store = ctx.store;
    console.log(`${LOG} Activating...`);

    cwDb.init(ctx.db);

    // Restore last active project
    activeProjectId = store.get('client-workspace.activeProjectId', null);
    if (activeProjectId) {
      const project = cwDb.getProject(activeProjectId);
      if (!project || project.status === 'archived') {
        activeProjectId = null;
        store.delete('client-workspace.activeProjectId');
      }
    }

    console.log(`${LOG} Activated (active project: ${activeProjectId || 'none'})`);
  },

  deactivate() {
    console.log(`${LOG} Deactivated`);
    context = null;
  },

  // ── Chat Preprocess (CONTEXT INJECTION) ─────────────────────

  async onChatPreprocess({ messages, assistant }) {
    try {
      if (!activeProjectId) return { messages, assistant };

      const project = cwDb.getProject(activeProjectId);
      if (!project) return { messages, assistant };

      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) lastUserMessage = lastUserMsg.content || '';

      const contextStr = buildProjectContext(project);

      // Search project comms and documents for relevant content
      const projectData = this._searchProjectResources(lastUserMessage, activeProjectId);

      const parts = [];
      if (contextStr) parts.push(contextStr);
      if (projectData) parts.push(projectData);

      if (parts.length === 0) return { messages, assistant };

      const systemMsg = { role: 'system', content: parts.join('\n\n') };
      const systemEnd = messages.findIndex(m => m.role !== 'system');
      const insertAt = systemEnd === -1 ? 0 : systemEnd;
      messages.splice(insertAt, 0, systemMsg);

      return { messages, assistant };
    } catch (err) {
      console.error(`${LOG} Preprocess error:`, err.message);
      return { messages, assistant };
    }
  },

  _searchProjectResources(query, projectId) {
    if (!query || query.trim().length < 3) return null;

    const results = [];
    const keywords = query.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3);
    if (keywords.length === 0) return null;

    // Search comms
    const comms = cwDb.getComms(projectId, 100);
    for (const comm of comms) {
      const contentLower = comm.content.toLowerCase();
      const matches = keywords.filter(k => contentLower.includes(k));
      if (matches.length > 0) {
        // Extract relevant snippet (first 500 chars around the match)
        const idx = contentLower.indexOf(matches[0]);
        const start = Math.max(0, idx - 100);
        const end = Math.min(comm.content.length, idx + 400);
        const snippet = comm.content.slice(start, end);
        results.push(`[Comms ${comm.source} ${comm.comm_date}]: ${snippet}`);
        if (results.length >= 3) break;
      }
    }

    // Search documents
    const docs = cwDb.getDocumentsForProject(projectId);
    for (const doc of docs) {
      const contentLower = (doc.content || '').toLowerCase();
      const matches = keywords.filter(k => contentLower.includes(k));
      if (matches.length > 0) {
        const idx = contentLower.indexOf(matches[0]);
        const start = Math.max(0, idx - 100);
        const end = Math.min(doc.content.length, idx + 400);
        const snippet = doc.content.slice(start, end);
        results.push(`[Doc "${doc.title}"]: ${snippet}`);
        if (results.length >= 5) break;
      }
    }

    if (results.length === 0) return null;
    return `[Project Resources]\n${results.join('\n\n')}`;
  },

  // ── Chat Postprocess (TIMELINE LOGGING) ─────────────────────

  async onChatPostprocess({ response, assistant }) {
    try {
      if (!activeProjectId) return { response, assistant };

      const userMsg = lastUserMessage;
      lastUserMessage = '';

      // Fire-and-forget timeline logging
      setTimeout(() => {
        try {
          if (userMsg) {
            cwDb.addTimelineEntry(activeProjectId, 'chat_user', `You: ${summarizeForTimeline(userMsg)}`);
          }
          if (response) {
            cwDb.addTimelineEntry(activeProjectId, 'chat_ai', `AI: ${summarizeForTimeline(response)}`);
          }
        } catch (err) {
          console.error(`${LOG} Timeline logging error:`, err.message);
        }
      }, 0);

      return { response, assistant };
    } catch (err) {
      console.error(`${LOG} Postprocess error:`, err.message);
      return { response, assistant };
    }
  },

  // ── Event Handler (from renderer via IPC) ────────────────────

  onEvent(eventName, data) {
    if (eventName === 'cw:save-response') {
      return this._handleSaveResponse(data);
    }
    if (eventName === 'cw:get-active-project') {
      if (!activeProjectId) return null;
      return cwDb.getProject(activeProjectId);
    }
    if (eventName === 'cw:list-projects') {
      return cwDb.getAllProjects('active');
    }
    if (eventName === 'cw:create-project') {
      const id = cwDb.createProject({
        name: data.name,
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        notes: data.notes,
      });
      activeProjectId = id;
      store.set('client-workspace.activeProjectId', id);
      return { success: true, id };
    }
    if (eventName === 'cw:select-project') {
      activeProjectId = data.id;
      store.set('client-workspace.activeProjectId', data.id);
      return { success: true };
    }
    if (eventName === 'cw:deselect-project') {
      activeProjectId = null;
      store.delete('client-workspace.activeProjectId');
      return { success: true };
    }
    if (eventName === 'cw:archive-project') {
      cwDb.archiveProject(data.id);
      if (activeProjectId === data.id) {
        activeProjectId = null;
        store.delete('client-workspace.activeProjectId');
      }
      return { success: true };
    }
    if (eventName === 'cw:open-document') {
      return cwDb.getDocument(data.id);
    }
    if (eventName === 'cw:update-document') {
      return cwDb.updateDocument(data.id, {
        title: data.title,
        description: data.description,
        content: data.content,
        status: data.status,
      });
    }
    if (eventName === 'cw:delete-document') {
      return cwDb.deleteDocument(data.id);
    }
    if (eventName === 'cw:update-project') {
      return cwDb.updateProject(data.id, {
        name: data.name,
        clientEmail: data.clientEmail,
        notes: data.notes,
      });
    }
    if (eventName === 'cw:delete-project') {
      cwDb.deleteProject(data.id);
      if (activeProjectId === data.id) {
        activeProjectId = null;
        store.delete('client-workspace.activeProjectId');
      }
      return { success: true };
    }
    if (eventName === 'cw:get-documents') {
      return cwDb.getDocumentsForProject(data.projectId);
    }
    if (eventName === 'cw:get-timeline') {
      return cwDb.getTimeline(data.projectId, data.limit || 50);
    }
    if (eventName === 'cw:get-time-entries') {
      return cwDb.getTimeEntries(data.projectId);
    }
    if (eventName === 'cw:add-comm') {
      const id = cwDb.addComm({
        projectId: data.projectId,
        source: data.source,
        content: data.content,
        commDate: data.commDate,
        summary: data.summary,
      });
      return { success: true, id };
    }
    if (eventName === 'cw:get-comms') {
      return cwDb.getComms(data.projectId, data.limit);
    }
    if (eventName === 'cw:delete-comm') {
      return cwDb.deleteComm(data.id);
    }
    if (eventName === 'cw:open-comm') {
      return cwDb.getComm(data.id);
    }
    return null;
  },

  _handleSaveResponse({ content, title, description }) {
    if (!activeProjectId) return { error: 'No active project' };
    if (!title) return { error: 'Title is required' };
    if (!content) return { error: 'No content to save' };

    const docId = cwDb.createDocument({
      projectId: activeProjectId,
      title,
      description: description || null,
      content,
    });

    const project = cwDb.getProject(activeProjectId);
    return { success: true, docId, projectName: project?.name };
  },

  // ── Sidebar Page ────────────────────────────────────────────

  renderPage(container) {
    const activeProject = activeProjectId ? cwDb.getProject(activeProjectId) : null;
    if (activeProject) {
      return ui.renderProjectDetail(activeProject);
    }
    return ui.renderProjectList(activeProjectId);
  },

  // ── Settings Panel ──────────────────────────────────────────

  renderSettings(container) {
    return ui.renderSettings(activeProjectId);
  },

  // ── Slash Commands ──────────────────────────────────────────

  getCommands() {
    return [
      {
        name: '/project',
        description: 'Switch active project by name',
        execute: (args) => {
          const name = args.trim();
          if (!name) {
            if (!activeProjectId) return '📁 No active project. Use /project [name] to select one.';
            const p = cwDb.getProject(activeProjectId);
            return `📁 Active project: ${p?.name || 'Unknown'}`;
          }
          const results = cwDb.searchProjects(name);
          if (results.length === 0) return `📁 No project found matching "${name}"`;
          activeProjectId = results[0].id;
          store.set('client-workspace.activeProjectId', activeProjectId);
          return `📁 Switched to: ${results[0].name}`;
        },
      },
      {
        name: '/projects',
        description: 'List all projects',
        execute: () => {
          const projects = cwDb.getAllProjects();
          if (projects.length === 0) return '📁 No projects. Use /new-project [name] to create one.';
          const list = projects.map(p => {
            const marker = p.id === activeProjectId ? '→ ' : '  ';
            return `${marker}${p.name} (${p.status})`;
          }).join('\n');
          return `📁 Projects:\n${list}`;
        },
      },
      {
        name: '/new-project',
        description: 'Create a new project',
        execute: (args) => {
          const name = args.trim();
          if (!name) return '📁 Usage: /new-project [project name]';
          const id = cwDb.createProject({ name });
          activeProjectId = id;
          store.set('client-workspace.activeProjectId', id);
          return `📁 Created and activated: ${name}`;
        },
      },
      {
        name: '/docs',
        description: 'List documents for active project',
        execute: () => {
          if (!activeProjectId) return '📁 No active project. Use /project [name] first.';
          const docs = cwDb.getDocumentsForProject(activeProjectId);
          if (docs.length === 0) return '📁 No documents in this project yet.';
          const list = docs.map(d =>
            `  ${d.title} [${d.status}] — ${d.updated_at?.split('T')[0] || ''}`
          ).join('\n');
          const project = cwDb.getProject(activeProjectId);
          return `📁 Documents in ${project?.name}:\n${list}`;
        },
      },
      {
        name: '/time',
        description: 'Log a time/billing entry for active project',
        execute: (args) => {
          const description = args.trim();
          if (!activeProjectId) return '📁 No active project. Use /project [name] first.';
          if (!description) return '📁 Usage: /time [description of work done]';
          cwDb.addTimeEntry({ projectId: activeProjectId, description });
          return `📁 Time logged: ${description}`;
        },
      },
      {
        name: '/archive',
        description: 'Archive the active project',
        execute: () => {
          if (!activeProjectId) return '📁 No active project.';
          const project = cwDb.getProject(activeProjectId);
          cwDb.archiveProject(activeProjectId);
          activeProjectId = null;
          store.delete('client-workspace.activeProjectId');
          return `📁 Archived: ${project?.name}`;
        },
      },
    ];
  },

  // ── Public API (for core chat UI integration) ───────────────

  getActiveProject() {
    if (!activeProjectId) return null;
    return cwDb.getProject(activeProjectId);
  },

  setActiveProject(projectId) {
    activeProjectId = projectId;
    if (projectId) {
      store.set('client-workspace.activeProjectId', projectId);
    } else {
      store.delete('client-workspace.activeProjectId');
    }
  },

  saveResponseAsDocument({ title, description, content }) {
    return this._handleSaveResponse({ content, title, description });
  },
};
