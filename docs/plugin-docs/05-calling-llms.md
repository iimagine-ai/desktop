# Calling LLMs from Plugins

Plugins can call AI models through the local Ollama instance. Use `context.getOllamaUrl()` to get the endpoint, then make standard HTTP requests.

## Getting the Ollama URL

```javascript
let ollamaUrl;

module.exports = {
  activate(context) {
    ollamaUrl = context.getOllamaUrl();
    // → "http://localhost:11434"
  },
};
```

## Chat Completions (Non-Streaming)

The most common pattern — send messages, get a complete response back.

```javascript
async function chatCompletion(model, messages, options = {}) {
  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,  // Important: get complete response
      options: {
        temperature: options.temperature || 0.7,
        num_predict: options.maxTokens || 2000,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status}`);
  }

  const data = await res.json();
  return data.message?.content || '';
}
```

### Usage

```javascript
const response = await chatCompletion('llama3', [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Explain quantum computing in one paragraph.' },
]);
```

> **Always set `stream: false`** — plugins run in the main process and don't have access to streaming response handlers.

## Generating Embeddings

Use the `/api/embeddings` endpoint with an embedding model like `nomic-embed-text`.

```javascript
async function generateEmbedding(text) {
  const res = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'nomic-embed-text',
      prompt: text.slice(0, 2000),  // Truncate to avoid issues
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  return data.embedding;  // Float array, typically 768 dimensions
}
```

### Usage

```javascript
const embedding = await generateEmbedding('machine learning fundamentals');
// → [0.0123, -0.0456, 0.0789, ...] (768 floats)
```

## Auto-Detecting Available Models

Query Ollama to see what's installed and filter by type.

```javascript
async function getAvailableModels() {
  const res = await fetch(`${ollamaUrl}/api/tags`);
  if (!res.ok) return { chat: [], embedding: [] };

  const data = await res.json();
  const models = data.models || [];

  // Embedding models contain these patterns
  const embeddingPatterns = ['embed', 'nomic-embed', 'mxbai-embed', 'bge-'];

  const chat = [];
  const embedding = [];

  for (const model of models) {
    const name = model.name.toLowerCase();
    if (embeddingPatterns.some(p => name.includes(p))) {
      embedding.push(model.name);
    } else {
      chat.push(model.name);
    }
  }

  return { chat, embedding };
}
```

### Usage

```javascript
const models = await getAvailableModels();
console.log('Chat models:', models.chat);       // ['llama3:latest', 'mistral:latest']
console.log('Embedding:', models.embedding);    // ['nomic-embed-text:latest']
```

## Structured JSON Extraction

A common pattern: ask the LLM to return structured JSON for programmatic use.

```javascript
async function extractStructured(text, schema) {
  const prompt = `Extract information from the following text and return ONLY valid JSON (no markdown, no code fences).

Schema:
${JSON.stringify(schema, null, 2)}

Text:
${text}`;

  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: 0.1, num_predict: 1500 },
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const raw = (data.message?.content || '').trim();

  // Parse JSON, handling code fences
  let json = raw;
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }

  try {
    return JSON.parse(json);
  } catch {
    // Try to find JSON object in response
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return null;
  }
}
```

### Usage

```javascript
const result = await extractStructured(
  'John works at Acme Corp as a senior engineer. He lives in Melbourne.',
  {
    type: 'object',
    properties: {
      name: { type: 'string' },
      company: { type: 'string' },
      role: { type: 'string' },
      location: { type: 'string' },
    },
  }
);
// → { name: "John", company: "Acme Corp", role: "senior engineer", location: "Melbourne" }
```

## Checking Model Availability

Before making calls, verify the model exists:

```javascript
async function isModelAvailable(modelName) {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    if (!res.ok) return false;
    const data = await res.json();
    const models = (data.models || []).map(m => m.name.split(':')[0]);
    return models.includes(modelName);
  } catch {
    return false;
  }
}
```

## Error Handling Best Practices

```javascript
async function safeChatCall(model, messages) {
  try {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[MyPlugin] LLM error ${res.status}: ${errBody.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    return data.message?.content || null;
  } catch (err) {
    console.warn(`[MyPlugin] Ollama unreachable: ${err.message}`);
    return null;
  }
}
```

## Common Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| 400 Bad Request | Using an embedding model for chat | Filter models — don't use `nomic-embed-text` with `/api/chat` |
| Empty response | Model not pulled | Check with `isModelAvailable()` first |
| Timeout | Large context or slow model | Set `num_predict` to limit output length |
| JSON parse failure | LLM wraps JSON in code fences | Strip ``` markers before parsing |
| `stream: true` issues | Plugin can't handle streaming | Always use `stream: false` |
