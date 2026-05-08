# Context API Reference

When your plugin's `activate(context)` function is called, it receives a context object with access to the app's core services. Store this reference for use throughout your plugin's lifecycle.

```javascript
let ctx;

module.exports = {
  activate(context) {
    ctx = context;
    // Now use ctx.db, ctx.store, ctx.kbStorage, etc.
  },
};
```

## context.db — SQLite Database

A [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) instance. This is the app's main database — plugins can create their own tables and run queries.

### Creating Tables

```javascript
activate(context) {
  const db = context.db;
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS myplugin_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}
```

### Queries

```javascript
// Single row
const note = db.prepare('SELECT * FROM myplugin_notes WHERE id = ?').get(noteId);

// Multiple rows
const notes = db.prepare('SELECT * FROM myplugin_notes ORDER BY created_at DESC LIMIT ?').all(20);

// Insert
const result = db.prepare('INSERT INTO myplugin_notes (title, content) VALUES (?, ?)').run('Title', 'Body');
console.log(result.lastInsertRowid); // new row ID

// Update
db.prepare('UPDATE myplugin_notes SET title = ? WHERE id = ?').run('New Title', noteId);

// Delete
db.prepare('DELETE FROM myplugin_notes WHERE id = ?').run(noteId);
```

### Transactions

```javascript
const insertMany = db.transaction((notes) => {
  const stmt = db.prepare('INSERT INTO myplugin_notes (title, content) VALUES (?, ?)');
  for (const note of notes) {
    stmt.run(note.title, note.content);
  }
});

insertMany([
  { title: 'Note 1', content: 'Content 1' },
  { title: 'Note 2', content: 'Content 2' },
]);
```

> **Important:** Prefix your table names with your plugin ID to avoid collisions (e.g., `myplugin_notes`, not `notes`).

See [06 — Database Patterns](./06-database-patterns.md) for advanced usage including vector search.

---

## context.store — Electron Store

An [electron-store](https://github.com/sindresorhus/electron-store) instance for persisting settings and small data. Data is stored as JSON on disk and survives app restarts.

### Get / Set

```javascript
// Read a value (with default)
const budget = context.store.get('cortex-lite.tokenBudget', 1500);

// Write a value
context.store.set('cortex-lite.tokenBudget', 2000);

// Delete a value
context.store.delete('cortex-lite.clearRequested');
```

### Namespacing

Always prefix your keys with your plugin ID to avoid collisions:

```javascript
// Good
context.store.get('my-plugin.theme', 'dark');
context.store.set('my-plugin.lastSync', Date.now());

// Bad — could collide with other plugins or the app
context.store.get('theme', 'dark');
```

### Common Patterns

```javascript
// Check if first run
if (!context.store.get('my-plugin.initialized')) {
  // Run first-time setup
  context.store.set('my-plugin.initialized', true);
}

// Store complex objects
context.store.set('my-plugin.config', {
  model: 'llama3',
  temperature: 0.7,
  maxTokens: 2000,
});

const config = context.store.get('my-plugin.config', {});
```

---

## context.kbStorage — Knowledge Base API

Access to the app's knowledge base system. Provides vector storage, document management, and semantic search.

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `createCollection` | `(name, metadata?)` | Create a named collection for organizing documents |
| `addDocument` | `(collectionId, content, metadata?)` | Add a document to a collection |
| `searchSimilar` | `(query, options?)` | Semantic search across stored documents |
| `getUnembeddedChunks` | `()` | Get chunks that haven't been embedded yet |
| `storeEmbeddings` | `(chunks)` | Store embedding vectors for chunks |
| `getKBStats` | `()` | Get statistics about the knowledge base |
| `isVecLoaded` | `()` | Check if sqlite-vec extension is available |

### Example: Checking Vector Support

```javascript
activate(context) {
  const vecAvailable = context.kbStorage.isVecLoaded();
  console.log(`Vector search: ${vecAvailable ? 'enabled' : 'disabled'}`);
}
```

### Example: Semantic Search

```javascript
const results = await context.kbStorage.searchSimilar('machine learning basics', {
  limit: 5,
  collectionId: 'my-collection',
});
```

---

## context.assistantStorage — Assistants API

Access to the app's assistant management system. Create assistants, store messages, and retrieve conversation history.

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `createAssistant` | `(config)` | Create a new assistant with name, model, system prompt |
| `addMessage` | `(assistantId, message)` | Add a message to an assistant's history |
| `getMessages` | `(assistantId, options?)` | Retrieve messages for an assistant |

### Example: Storing Conversation Data

```javascript
// Add a message to history
context.assistantStorage.addMessage(assistantId, {
  role: 'user',
  content: 'Hello!',
});
```

---

## context.getOllamaUrl() — Ollama API URL

Returns the configured Ollama API URL as a string. Defaults to `http://localhost:11434` if not configured.

```javascript
const ollamaUrl = context.getOllamaUrl();
// → "http://localhost:11434"

// Use it to make API calls
const res = await fetch(`${ollamaUrl}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama3',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: false,
  }),
});
```

See [05 — Calling LLMs](./05-calling-llms.md) for complete examples.

---

## Summary Table

| Property | Type | Use Case |
|----------|------|----------|
| `context.db` | better-sqlite3 Database | Custom tables, queries, transactions |
| `context.store` | electron-store | Plugin settings, small persistent data |
| `context.kbStorage` | Object | Vector search, document storage |
| `context.assistantStorage` | Object | Assistant management, message history |
| `context.getOllamaUrl()` | Function → string | Get Ollama endpoint for AI calls |
