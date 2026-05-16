// PII Redaction Engine
// Uses a local LLM to identify and replace sensitive information with placeholders.
// Falls back to regex-based detection if no local model is available.

const REDACTION_PROMPT = `You are a PII redaction engine. Your job is to identify personally identifiable information and sensitive data in the text below, then output a JSON array of entities found.

For each entity, provide:
- "type": one of "person_name", "email", "phone", "address", "date_of_birth", "account_number", "financial_amount", "company_name", "case_number", "medical_id", "ssn", "passport", "license_plate", "ip_address", "credit_card"
- "value": the exact text as it appears
- "context": brief description of what this entity represents in the text

Only include actual PII — do not flag generic terms, common words, or public information.
If no PII is found, return an empty array: []

Respond ONLY with valid JSON. No explanation, no markdown.

TEXT TO ANALYZE:
`;

const ENTITY_TYPE_PREFIXES = {
  person_name: 'Person',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  date_of_birth: 'DOB',
  account_number: 'Account',
  financial_amount: 'Amount',
  company_name: 'Company',
  case_number: 'Case',
  medical_id: 'MedID',
  ssn: 'SSN',
  passport: 'Passport',
  license_plate: 'Plate',
  ip_address: 'IP',
  credit_card: 'Card',
};

class Redactor {
  constructor({ getOllamaUrl, store }) {
    this._getOllamaUrl = getOllamaUrl;
    this._store = store;
    this._counters = {}; // type → next number
  }

  /**
   * Redact PII from text using local LLM + regex fallback.
   * @param {string} text - The original text to redact
   * @param {Array} existingMapping - Previously mapped entities for this conversation
   * @returns {{ redacted: string, newEntities: Array }}
   */
  async redact(text, existingMapping = []) {
    if (!text || text.trim().length < 10) {
      return { redacted: text, newEntities: [] };
    }

    // Reset counters based on existing mapping
    this._counters = {};
    for (const entity of existingMapping) {
      const match = entity.placeholder.match(/\[(\w+) (\d+)\]/);
      if (match) {
        const type = match[1];
        const num = parseInt(match[2]);
        this._counters[type] = Math.max(this._counters[type] || 0, num);
      }
    }

    // Try LLM-based detection first, fall back to regex
    let entities = [];
    try {
      entities = await this._detectWithLLM(text);
    } catch (err) {
      console.warn('[PrivacyProxy] LLM detection failed, using regex fallback:', err.message);
      entities = this._detectWithRegex(text);
    }

    if (entities.length === 0) {
      return { redacted: text, newEntities: [] };
    }

    // Check if any detected entities are already mapped
    const newEntities = [];
    let redacted = text;

    // Sort entities by length (longest first) to avoid partial replacements
    entities.sort((a, b) => b.value.length - a.value.length);

    for (const entity of entities) {
      // Check if this exact value is already mapped
      const existing = existingMapping.find(
        m => m.original.toLowerCase() === entity.value.toLowerCase()
      );

      if (existing) {
        // Use existing placeholder for consistency
        redacted = this._replaceAll(redacted, entity.value, existing.placeholder);
      } else {
        // Create new placeholder
        const placeholder = this._generatePlaceholder(entity.type);
        redacted = this._replaceAll(redacted, entity.value, placeholder);
        newEntities.push({
          type: entity.type,
          original: entity.value,
          placeholder,
          context: entity.context || '',
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return { redacted, newEntities };
  }

  /**
   * Use local Ollama model to detect PII entities.
   */
  async _detectWithLLM(text) {
    const ollamaUrl = this._getOllamaUrl();
    if (!ollamaUrl) throw new Error('No Ollama URL available');

    // Use a fast small model for detection
    const model = this._store.get('privacy-proxy.detectionModel', 'gemma3:4b');

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: REDACTION_PROMPT + text,
        stream: false,
        options: { temperature: 0, num_predict: 2048 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const data = await response.json();
    const raw = (data.response || '').trim();

    // Parse JSON response
    let entities = [];
    try {
      // Handle cases where model wraps in markdown code block
      const jsonStr = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
      entities = JSON.parse(jsonStr);
    } catch (parseErr) {
      // Try to extract JSON array from response
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        try { entities = JSON.parse(match[0]); } catch { entities = []; }
      }
    }

    if (!Array.isArray(entities)) entities = [];

    // Validate entities — each must have type and value that exists in text
    return entities.filter(e =>
      e && e.type && e.value &&
      typeof e.value === 'string' &&
      e.value.length >= 2 &&
      text.includes(e.value)
    );
  }

  /**
   * Regex-based PII detection fallback.
   * Less accurate than LLM but works without a model loaded.
   */
  _detectWithRegex(text) {
    const entities = [];

    // Email addresses
    const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emails) {
      for (const email of emails) {
        entities.push({ type: 'email', value: email, context: 'email address' });
      }
    }

    // Phone numbers (various formats)
    const phones = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g);
    if (phones) {
      for (const phone of phones) {
        if (phone.replace(/\D/g, '').length >= 8) {
          entities.push({ type: 'phone', value: phone, context: 'phone number' });
        }
      }
    }

    // Credit card numbers
    const cards = text.match(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g);
    if (cards) {
      for (const card of cards) {
        entities.push({ type: 'credit_card', value: card, context: 'credit card number' });
      }
    }

    // SSN (US format)
    const ssns = text.match(/\b\d{3}-\d{2}-\d{4}\b/g);
    if (ssns) {
      for (const ssn of ssns) {
        entities.push({ type: 'ssn', value: ssn, context: 'social security number' });
      }
    }

    // Australian TFN
    const tfns = text.match(/\b\d{3}\s?\d{3}\s?\d{3}\b/g);
    if (tfns) {
      for (const tfn of tfns) {
        if (tfn.replace(/\s/g, '').length === 9) {
          entities.push({ type: 'account_number', value: tfn, context: 'tax file number' });
        }
      }
    }

    // Dollar amounts over $1000
    const amounts = text.match(/\$[\d,]+(?:\.\d{2})?/g);
    if (amounts) {
      for (const amount of amounts) {
        const num = parseFloat(amount.replace(/[$,]/g, ''));
        if (num >= 1000) {
          entities.push({ type: 'financial_amount', value: amount, context: 'financial amount' });
        }
      }
    }

    // IP addresses
    const ips = text.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g);
    if (ips) {
      for (const ip of ips) {
        entities.push({ type: 'ip_address', value: ip, context: 'IP address' });
      }
    }

    return entities;
  }

  /**
   * Generate a consistent placeholder like [Person 1], [Company 2], etc.
   */
  _generatePlaceholder(type) {
    const prefix = ENTITY_TYPE_PREFIXES[type] || 'Entity';
    const num = (this._counters[prefix] || 0) + 1;
    this._counters[prefix] = num;
    return `[${prefix} ${num}]`;
  }

  /**
   * Replace all occurrences (case-insensitive) of a value in text.
   */
  _replaceAll(text, search, replacement) {
    // Escape special regex chars in the search string
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(escaped, 'gi'), replacement);
  }
}

module.exports = { Redactor };
