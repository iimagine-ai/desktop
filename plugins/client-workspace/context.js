// Client Workspace — Context Builder
// Builds minimal context injection for the active project.
// Keeps it lightweight — lets KB/RAG handle document content.

const LOG = '[ClientWorkspace:Context]';

/**
 * Build context string for the active project.
 * Injected as a system message during chatPreprocess.
 * Intentionally minimal to avoid overloading the context window.
 */
function buildProjectContext(project) {
  if (!project) return null;

  const lines = [`[Active Project: ${project.name}]`];

  if (project.client_name) {
    lines.push(`Client: ${project.client_name}`);
  }

  if (project.notes) {
    const truncated = project.notes.length > 500
      ? project.notes.slice(0, 500) + '...'
      : project.notes;
    lines.push(truncated);
  }

  lines.push('You are assisting a professional working on this project.');
  lines.push('The user is the professional. Respond as a knowledgeable assistant.');
  lines.push('IMPORTANT: If project resources (communications, documents) are provided below, use them to answer questions. They contain real data from this project.');

  return lines.join('\n');
}

/**
 * Summarize a message for timeline logging.
 * Truncates to first 80 chars to keep timeline readable.
 */
function summarizeForTimeline(content, maxLen = 80) {
  if (!content) return '(empty)';
  const firstLine = content.split('\n')[0].trim();
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen) + '...';
}

module.exports = {
  buildProjectContext,
  summarizeForTimeline,
};
