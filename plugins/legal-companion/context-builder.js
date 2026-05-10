// Legal Companion — Context Builder
// Assembles legal-specific context for injection into chat preprocess

const legalDb = require('./db');
const LOG = '[Legal:Context]';

const TOKEN_BUDGET = 2000; // max tokens for legal context

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

// Build context for the active matter
function buildMatterContext(matterId) {
  if (!matterId) return null;

  const matter = legalDb.getMatter(matterId);
  if (!matter) return null;

  const profile = legalDb.getProfile();
  const outputs = legalDb.getOutputsForMatter(matterId).slice(0, 5);
  const docs = legalDb.getDocumentsForMatter(matterId);

  const parts = [];
  let tokenCount = 0;

  // Practice context (always include if setup complete)
  if (profile && profile.setup_complete) {
    const practiceCtx = buildPracticeContext(profile);
    const practiceTokens = estimateTokens(practiceCtx);
    if (tokenCount + practiceTokens <= TOKEN_BUDGET) {
      parts.push(practiceCtx);
      tokenCount += practiceTokens;
    }
  }

  // Matter metadata (always include)
  const matterCtx = buildMatterMetadata(matter);
  const matterTokens = estimateTokens(matterCtx);
  if (tokenCount + matterTokens <= TOKEN_BUDGET) {
    parts.push(matterCtx);
    tokenCount += matterTokens;
  }

  // Documents summary
  if (docs.length > 0) {
    const docCtx = buildDocsSummary(docs);
    const docTokens = estimateTokens(docCtx);
    if (tokenCount + docTokens <= TOKEN_BUDGET) {
      parts.push(docCtx);
      tokenCount += docTokens;
    }
  }

  // Recent outputs
  if (outputs.length > 0) {
    const outCtx = buildOutputsSummary(outputs);
    const outTokens = estimateTokens(outCtx);
    if (tokenCount + outTokens <= TOKEN_BUDGET) {
      parts.push(outCtx);
      tokenCount += outTokens;
    }
  }

  // Legal disclaimer (always include)
  parts.push('IMPORTANT: You are providing legal workflow assistance, not legal advice. All outputs are drafts for the lawyer\'s review. Flag assumptions and areas requiring professional judgment.');

  if (parts.length <= 1) return null; // only disclaimer, no real context

  const context = `[Legal Context]\n${parts.join('\n\n')}\n[End Legal Context]`;
  console.log(`${LOG} Built context: ~${tokenCount} tokens for matter "${matter.name}"`);
  return context;
}

function buildPracticeContext(profile) {
  let areas = [];
  try { areas = JSON.parse(profile.practice_areas || '[]'); } catch {}
  let jurisdictions = [];
  try { jurisdictions = JSON.parse(profile.jurisdictions || '[]'); } catch {}

  return `You are a legal AI assistant helping a ${profile.role || 'lawyer'} at ${profile.firm_name || 'a law firm'}.
The user speaking to you IS the lawyer (not the client). Address them as a colleague assisting with their legal work.
Firm: ${profile.firm_name || 'Not specified'} (${profile.firm_size || 'small'} firm)
Lawyer's role: ${profile.role || 'Lawyer'}
Practice areas: ${areas.join(', ') || 'General'}
Jurisdictions: ${jurisdictions.join(', ') || 'Not specified'}
Citation format: ${profile.citation_format || 'AGLC4'}
Document tone: ${profile.document_tone || 'Professional'}
Never assume the user is the client. The user is always the lawyer working on the matter.`;
}

function buildMatterMetadata(matter) {
  const lines = [`[Active Matter: ${matter.name}]`];
  if (matter.practice_area) lines.push(`Practice Area: ${matter.practice_area}`);
  if (matter.jurisdiction) lines.push(`Jurisdiction: ${matter.jurisdiction}`);
  if (matter.client_name) lines.push(`Client: ${matter.client_name}${matter.client_type ? ` (${matter.client_type})` : ''}`);
  if (matter.opposing_party) lines.push(`Opposing: ${matter.opposing_party}`);
  if (matter.opposing_counsel) lines.push(`Opposing Counsel: ${matter.opposing_counsel}`);
  if (matter.court_tribunal) lines.push(`Court: ${matter.court_tribunal}${matter.file_number ? ` (File: ${matter.file_number})` : ''}`);
  if (matter.status) lines.push(`Status: ${matter.status}`);
  if (matter.next_deadline) lines.push(`Next Deadline: ${matter.next_deadline}${matter.deadline_description ? ` — ${matter.deadline_description}` : ''}`);
  if (matter.matter_value) lines.push(`Value: ${matter.matter_value}`);
  if (matter.billing_type) lines.push(`Billing: ${matter.billing_type}`);
  return lines.join('\n');
}

function buildDocsSummary(docs) {
  const lines = [`Documents (${docs.length} indexed):`];
  for (const doc of docs.slice(0, 8)) {
    lines.push(`- ${doc.name}${doc.category ? ` [${doc.category}]` : ''}`);
  }
  if (docs.length > 8) lines.push(`  ... and ${docs.length - 8} more`);
  return lines.join('\n');
}

function buildOutputsSummary(outputs) {
  const lines = ['Recent work product:'];
  for (const out of outputs.slice(0, 5)) {
    const date = out.created_at ? out.created_at.split('T')[0] : '';
    lines.push(`- ${out.title} [${out.output_type}] (${date})`);
  }
  return lines.join('\n');
}

module.exports = { buildMatterContext };
