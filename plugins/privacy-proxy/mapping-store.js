// Mapping Store — Persists PII placeholder mappings in SQLite
// Ensures consistent placeholders across conversation turns.
// All data stays local — mappings are never transmitted.

class MappingStore {
  constructor(db) {
    this._db = db;
  }

  init() {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS pp_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        original TEXT NOT NULL,
        placeholder TEXT NOT NULL,
        context TEXT,
        detected_at TEXT NOT NULL,
        UNIQUE(conversation_id, original)
      );
      CREATE INDEX IF NOT EXISTS idx_pp_mappings_conv
        ON pp_mappings(conversation_id);
    `);
  }

  /**
   * Get all mappings for a conversation.
   * @returns {Array<{type, original, placeholder, context, detectedAt}>}
   */
  getMapping(conversationId) {
    if (!conversationId) return [];
    const rows = this._db.prepare(
      'SELECT entity_type, original, placeholder, context, detected_at FROM pp_mappings WHERE conversation_id = ? ORDER BY id'
    ).all(conversationId);

    return rows.map(r => ({
      type: r.entity_type,
      original: r.original,
      placeholder: r.placeholder,
      context: r.context,
      detectedAt: r.detected_at,
    }));
  }

  /**
   * Add a new entity mapping for a conversation.
   */
  addEntity(conversationId, entity) {
    try {
      this._db.prepare(
        `INSERT OR IGNORE INTO pp_mappings (conversation_id, entity_type, original, placeholder, context, detected_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        conversationId,
        entity.type,
        entity.original,
        entity.placeholder,
        entity.context || null,
        entity.detectedAt || new Date().toISOString()
      );
    } catch (err) {
      // UNIQUE constraint — entity already mapped, ignore
      if (!err.message.includes('UNIQUE')) {
        console.error('[PrivacyProxy] Failed to save mapping:', err.message);
      }
    }
  }

  /**
   * Clear all mappings for a conversation (e.g. when user deletes conversation).
   */
  clearMapping(conversationId) {
    this._db.prepare('DELETE FROM pp_mappings WHERE conversation_id = ?').run(conversationId);
  }

  /**
   * Get aggregate stats for the settings panel.
   */
  getStats() {
    const total = this._db.prepare('SELECT COUNT(*) as count FROM pp_mappings').get();
    const conversations = this._db.prepare(
      'SELECT COUNT(DISTINCT conversation_id) as count FROM pp_mappings'
    ).get();
    const byType = this._db.prepare(
      'SELECT entity_type, COUNT(*) as count FROM pp_mappings GROUP BY entity_type ORDER BY count DESC'
    ).all();

    return {
      totalEntities: total.count,
      conversationsProtected: conversations.count,
      byType: byType.map(r => ({ type: r.entity_type, count: r.count })),
    };
  }

  /**
   * Purge mappings older than N days (for storage management).
   */
  purgeOlderThan(days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const result = this._db.prepare(
      'DELETE FROM pp_mappings WHERE detected_at < ?'
    ).run(cutoff.toISOString());
    return result.changes;
  }
}

module.exports = { MappingStore };
