// Privacy Proxy Plugin — Local PII Redaction for Frontier Models
// Uses a local LLM to strip personally identifiable information before
// sending to cloud providers. Re-hydrates placeholders in responses.

const { Redactor } = require('./redactor');
const { MappingStore } = require('./mapping-store');

const LOG = '[PrivacyProxy]';

let context = null;
let store = null;
let getEnginePort = null;
let redactor = null;
let mappingStore = null;

module.exports = {
  activate(ctx) {
    context = ctx;
    store = ctx.store;
    getEnginePort = ctx.getEnginePort;

    mappingStore = new MappingStore(ctx.db);
    mappingStore.init();

    redactor = new Redactor({ getEnginePort, store });

    console.log(`${LOG} Activated`);
  },

  deactivate() {
    console.log(`${LOG} Deactivated`);
    context = null;
    redactor = null;
    mappingStore = null;
  },

  // ── Chat Preprocess: Redact PII before cloud transmission ────

  async onChatPreprocess({ messages, assistant, provider }) {
    try {
      // Only redact when sending to cloud providers
      if (!this._shouldRedact(provider)) {
        return { messages, assistant };
      }

      const conversationId = this._getConversationId(messages);

      // Get or create mapping for this conversation
      const mapping = mappingStore.getMapping(conversationId);

      // Redact the last user message
      const lastUserIdx = this._findLastUserMessage(messages);
      if (lastUserIdx === -1) return { messages, assistant };

      const original = messages[lastUserIdx].content;
      const { redacted, newEntities } = await redactor.redact(original, mapping);

      if (newEntities.length > 0) {
        // Save new placeholder mappings
        for (const entity of newEntities) {
          mappingStore.addEntity(conversationId, entity);
        }
        console.log(`${LOG} Redacted ${newEntities.length} new entities`);
      }

      if (redacted !== original) {
        messages[lastUserIdx].content = redacted;
        console.log(`${LOG} Message redacted (${original.length} → ${redacted.length} chars)`);
      }

      return { messages, assistant };
    } catch (err) {
      console.error(`${LOG} Preprocess error:`, err.message);
      // On error, pass through unmodified — don't block the user
      return { messages, assistant };
    }
  },

  // ── Chat Postprocess: Re-hydrate placeholders in response ────

  async onChatPostprocess({ response, assistant, provider }) {
    try {
      if (!this._shouldRedact(provider)) {
        return { response, assistant };
      }

      if (!response) return { response, assistant };

      const conversationId = this._getCurrentConversationId();
      const mapping = mappingStore.getMapping(conversationId);

      if (!mapping || mapping.length === 0) {
        return { response, assistant };
      }

      // Replace placeholders with real values
      let rehydrated = response;
      for (const entity of mapping) {
        const regex = new RegExp(this._escapeRegex(entity.placeholder), 'gi');
        rehydrated = rehydrated.replace(regex, entity.original);
      }

      if (rehydrated !== response) {
        console.log(`${LOG} Response re-hydrated (${mapping.length} entities mapped back)`);
      }

      return { response: rehydrated, assistant };
    } catch (err) {
      console.error(`${LOG} Postprocess error:`, err.message);
      return { response, assistant };
    }
  },

  // ── Settings UI ──────────────────────────────────────────────

  getSettingsPanel() {
    const enabled = store.get('privacy-proxy.enabled', true);
    const mode = store.get('privacy-proxy.mode', 'auto');
    const showPreview = store.get('privacy-proxy.showPreview', false);

    return {
      title: 'Privacy Proxy',
      fields: [
        {
          key: 'privacy-proxy.enabled',
          label: 'Enable PII Redaction',
          type: 'toggle',
          value: enabled,
          description: 'Automatically strip sensitive data before sending to cloud models',
        },
        {
          key: 'privacy-proxy.mode',
          label: 'Redaction Mode',
          type: 'select',
          value: mode,
          options: [
            { value: 'auto', label: 'Automatic — AI detects and redacts PII' },
            { value: 'confirm', label: 'Confirm — Show redacted version before sending' },
            { value: 'manual', label: 'Manual — Only redact when I click the shield icon' },
          ],
          description: 'How redaction is triggered',
        },
        {
          key: 'privacy-proxy.showPreview',
          label: 'Show Redaction Preview',
          type: 'toggle',
          value: showPreview,
          description: 'Display what was redacted after each message (for verification)',
        },
      ],
    };
  },

  // ── Event Handler ────────────────────────────────────────────

  onEvent(eventName, data) {
    if (eventName === 'pp:get-mapping') {
      return mappingStore.getMapping(data.conversationId);
    }
    if (eventName === 'pp:clear-mapping') {
      mappingStore.clearMapping(data.conversationId);
      return { success: true };
    }
    if (eventName === 'pp:get-stats') {
      return mappingStore.getStats();
    }
    if (eventName === 'pp:test-redact') {
      return this._testRedact(data.text);
    }
    return null;
  },

  // ── Internal Helpers ─────────────────────────────────────────

  _shouldRedact(provider) {
    const enabled = store.get('privacy-proxy.enabled', true);
    if (!enabled) return false;

    // Only redact for cloud providers, not local
    if (!provider) return false;
    const privacyLevel = provider.privacyLevel || provider.privacy;
    return privacyLevel === 'cloud' || privacyLevel === 'regional';
  },

  _findLastUserMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return i;
    }
    return -1;
  },

  _getConversationId(messages) {
    // Use a hash of the first few messages as conversation identifier
    // In practice this would come from the chat system's conversation ID
    if (context && context.activeConversationId) {
      return context.activeConversationId;
    }
    const key = messages.slice(0, 3).map(m => m.content?.slice(0, 50)).join('|');
    const crypto = require('crypto');
    return crypto.createHash('md5').update(key).digest('hex').slice(0, 16);
  },

  _getCurrentConversationId() {
    if (context && context.activeConversationId) {
      return context.activeConversationId;
    }
    return store.get('privacy-proxy._lastConversationId', 'default');
  },

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  async _testRedact(text) {
    if (!redactor) return { error: 'Plugin not initialized' };
    const { redacted, newEntities } = await redactor.redact(text, []);
    return { original: text, redacted, entities: newEntities };
  },
};
