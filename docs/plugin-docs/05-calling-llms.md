# Calling LLMs from Plugins

Plugins can call AI models through the local inference engine. Use `context.getEnginePort()` to get the port, then make standard HTTP requests to the OpenAI-compatible API.

## Getting the Engine Port

```javascript
let enginePort;

module.exports = {
  activate(context) {
    enginePort = context.getEnginePort();
    // → e.g. 8847 (dynamic port)
  },
};
```

## Chat Completions (Non-Streaming)

The most common pattern — send messages, get a complete response back.

```javascript
async function chatCompletion(messages, options = {}) {
  const res = await fetch(`http://localhost:${enginePort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'current',
      messages,
      stream: false,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 2000,
    }),
  });

  if (!res.ok) {
    throw new Error(`Engine error: ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}
```

### Usage

```javascript
const response = await chatCompletion([
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Explain quantum computing in one paragraph.' },
]);
```

> **Always set `stream: false`** — plugins run in the main process and don't have access to streaming response handlers.

## Generating Embeddings

Use the `/v1/embeddings` endpoint. The currently loaded model is used for embeddings.

```javascript
async function generateEmbedding(text) {
  const res = await fetch(`http://localhost:${enginePort}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'current',
      input: text.slice(0, 2000),  // Truncate to avoid issues
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  return data.data?.[0]?.embedding;  // Float array
}
```

### Usage

```javascript
const embedding = await generateEmbedding('machine learning fundamentals');
// → [0.0123, -0.0456, 0.0789, ...] (float array)
```

## Checking Engine Health

Verify the engine is running before making calls:

```javascript
async function isEngineReady() {
  try {
    const res = await fetch(`http://localhost:${enginePort}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
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

  const res = await fetch(`http://localhost:${enginePort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'current',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      temperature: 0.1,
      max_tokens: 1500,
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content || '').trim();

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

## Error Handling Best Practices

```javascript
async function safeChatCall(messages) {
  try {
    const res = await fetch(`http://localhost:${enginePort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'current', messages, stream: false }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[MyPlugin] LLM error ${res.status}: ${errBody.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.warn(`[MyPlugin] Engine unreachable: ${err.message}`);
    return null;
  }
}
```

## Common Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| Connection refused | Engine not running | Check with `isEngineReady()` first |
| Empty response | No model loaded | Ensure user has downloaded a model |
| Timeout | Large context or slow model | Set `max_tokens` to limit output length |
| JSON parse failure | LLM wraps JSON in code fences | Strip ``` markers before parsing |
| `stream: true` issues | Plugin can't handle streaming | Always use `stream: false` |
