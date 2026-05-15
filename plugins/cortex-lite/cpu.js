// Cortex Lite — CPU (Central Processing Unit)
// Source-agnostic data pipeline. Processes ALL data inputs and updates the local KG.
// Any plugin or data source calls cpu.process() to extract entities/relationships/facts.
//
// Data sources: chat, comms, KB documents, file imports, future integrations.
// Output: local SQLite KG (memory_entities, memory_relationships, memory_facts + embeddings)
//
// Project comms (source='comm' with metadata.projectId) use the PROJECT_EXTRACTION_PROMPT
// which extracts professional services entities: request, commitment, decision, issue,
// deadline, approval, question, quote, milestone.

const extractor = require('./extractor');
const memoryDb = require('./db');
const embeddings = require('./embeddings');

const LOG = '[CPU]';

/**
 * Process any text content through the extraction pipeline.
 * Source-agnostic — same pipeline regardless of where data came from.
 *
 * When source='comm' and metadata.projectId is set, uses the project extraction
 * prompt to extract professional services entities (requests, commitments, etc.)
 * and tags them with the project ID.
 *
 * @param {object} input
 * @param {string} input.content — the raw text to process
 * @param {string} input.source — origin identifier: 'chat', 'comm', 'kb', 'file', 'import'
 * @param {object} [input.metadata] — optional context (projectId, clientName, commDate, etc.)
 * @returns {Promise<{entities: number, relationships: number, facts: number} | null>}
 */
async function process(input) {
  if (!input || !input.content || input.content.trim().length < 10) {
    return null;
  }

  const { content, source = 'unknown', metadata = {} } = input;
  const isProjectComm = source === 'comm' && metadata.projectId;

  try {
    let extracted;

    if (isProjectComm) {
      // Use project-specific extraction for client communications
      console.log(`${LOG} Project comm extraction for project ${metadata.projectId}`);
      extracted = await extractor.extractProject(content);
    } else {
      // Use general extraction for chat and other sources
      extracted = await extractor.extract(content, `[Source: ${source}]`);
    }

    if (!extracted) {
      console.log(`${LOG} No extraction from ${source} (${content.length} chars)`);
      return null;
    }

    // For non-project comms: enrich entities with source metadata
    if (!isProjectComm && (metadata.projectId || metadata.clientName || metadata.commDate)) {
      for (const entity of extracted.entities) {
        if (!entity.properties) entity.properties = {};
        if (metadata.projectId) entity.properties.project_id = metadata.projectId;
        if (metadata.clientName) entity.properties.client_name = metadata.clientName;
        if (metadata.commDate) entity.properties.comm_date = metadata.commDate;
        entity.properties.source = source;
      }
    }

    // Process extraction — pass projectId for project comms so entities get tagged
    const result = await extractor.processExtraction(
      extracted,
      isProjectComm ? metadata.projectId : null
    );

    console.log(`${LOG} Processed [${source}${isProjectComm ? '/project' : ''}]: ${result.entities} entities, ${result.relationships} rels, ${result.facts} facts`);
    return result;
  } catch (err) {
    console.error(`${LOG} Error processing ${source}:`, err.message);
    return null;
  }
}

/**
 * Process in background (fire-and-forget). Does not block the caller.
 */
function processAsync(input) {
  setTimeout(() => process(input).catch(() => {}), 0);
}

module.exports = { process, processAsync };
