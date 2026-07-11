# Database Patterns

Plugins have full access to the app's SQLite database via `context.db` (a better-sqlite3 instance). This guide covers table creation, migrations, transactions, and vector search.

## Creating Plugin-Owned Tables

Always prefix table names with your plugin ID to avoid collisions with other plugins or the app's core tables.

```javascript
activate(context) {
  const db = context.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS myplugin_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_myplugin_items_status
      ON myplugin_items(status);
  `);
}
```

### Naming Conventions

- Tables: `pluginid_tablename` (e.g., `cortex_lite_entities`, `word_count_stats`)
- Indexes: `idx_pluginid_tablename_column`
- Use snake_case for everything

## Migrations on Activate

Run migrations in your `activate()` function using `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` patterns.

```javascript
activate(context) {
  const db = context.db;
  const store = context.store;

  // Check current schema version
  const currentVersion = store.get('my-plugin.schemaVersion', 0);

  // Version 1: Initial tables
  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS myplugin_entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    store.set('my-plugin.schemaVersion', 1);
  }

  // Version 2: Add category column
  if (currentVersion < 2) {
    try {
      db.exec(`ALTER TABLE myplugin_entries ADD COLUMN category TEXT DEFAULT 'general'`);
    } catch (err) {
      // Column might already exist if migration ran partially
      if (!err.message.includes('duplicate column')) throw err;
    }
    store.set('my-plugin.schemaVersion', 2);
  }

  // Version 3: Add index
  if (currentVersion < 3) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_myplugin_entries_category ON myplugin_entries(category)`);
    store.set('my-plugin.schemaVersion', 3);
  }
}
```

## CRUD Operations

### Insert

```javascript
const crypto = require('crypto');

function addEntry(db, content, category) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO myplugin_entries (id, content, category) VALUES (?, ?, ?)
  `).run(id, content, category);
  return id;
}
```

### Query

```javascript
// Single row
function getEntry(db, id) {
  return db.prepare('SELECT * FROM myplugin_entries WHERE id = ?').get(id);
}

// Multiple rows with filtering
function getEntries(db, category, limit = 20) {
  if (category) {
    return db.prepare(
      'SELECT * FROM myplugin_entries WHERE category = ? ORDER BY created_at DESC LIMIT ?'
    ).all(category, limit);
  }
  return db.prepare(
    'SELECT * FROM myplugin_entries ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

// Count
function getCount(db) {
  return db.prepare('SELECT COUNT(*) as count FROM myplugin_entries').get().count;
}
```

### Update

```javascript
function updateEntry(db, id, content) {
  db.prepare(`
    UPDATE myplugin_entries SET content = ?, updated_at = datetime('now') WHERE id = ?
  `).run(content, id);
}
```

### Upsert (Insert or Update)

```javascript
function upsertEntry(db, { type, name, properties }) {
  const existing = db.prepare(
    'SELECT id FROM myplugin_entries WHERE type = ? AND name = ? COLLATE NOCASE'
  ).get(type, name);

  if (existing) {
    db.prepare('UPDATE myplugin_entries SET properties = ? WHERE id = ?')
      .run(JSON.stringify(properties), existing.id);
    return existing.id;
  }

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO myplugin_entries (id, type, name, properties) VALUES (?, ?, ?, ?)')
    .run(id, type, name, JSON.stringify(properties));
  return id;
}
```

## Transactions for Batch Operations

Transactions are critical for performance when inserting multiple rows and for data consistency.

```javascript
function importBatch(db, entries) {
  const insertMany = db.transaction((items) => {
    const stmt = db.prepare(
      'INSERT INTO myplugin_entries (id, content, category) VALUES (?, ?, ?)'
    );
    for (const item of items) {
      stmt.run(crypto.randomUUID(), item.content, item.category);
    }
  });

  insertMany(entries);
}
```

### Why Transactions Matter

Without a transaction, 1000 inserts = 1000 disk writes. With a transaction, 1000 inserts = 1 disk write. The performance difference is 10-100x.

```javascript
// Slow: ~5 seconds for 1000 rows
for (const item of items) {
  db.prepare('INSERT INTO myplugin_entries (content) VALUES (?)').run(item);
}

// Fast: ~50ms for 1000 rows
const insert = db.transaction((items) => {
  const stmt = db.prepare('INSERT INTO myplugin_entries (content) VALUES (?)');
  for (const item of items) stmt.run(item);
});
insert(items);
```

## Vector Search with sqlite-vec

The app includes [sqlite-vec](https://github.com/asg017/sqlite-vec) for vector similarity search. Vectors are stored as 768-dimensional float arrays (matching `nomic-embed-text` output).

### Check Availability

```javascript
activate(context) {
  const vecAvailable = context.kbStorage ? context.kbStorage.isVecLoaded() : false;
  
  if (vecAvailable) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS myplugin_embeddings
      USING vec0(item_id TEXT PRIMARY KEY, embedding float[768]);
    `);
  }
}
```

### Store an Embedding

```javascript
function storeEmbedding(db, itemId, embedding) {
  // Convert float array to Buffer
  const buf = Buffer.from(new Float32Array(embedding).buffer);
  db.prepare(
    'INSERT OR REPLACE INTO myplugin_embeddings (item_id, embedding) VALUES (?, ?)'
  ).run(itemId, buf);
}
```

### Search by Similarity

```javascript
function searchSimilar(db, queryEmbedding, topK = 5) {
  const buf = Buffer.from(new Float32Array(queryEmbedding).buffer);
  return db.prepare(`
    SELECT e.item_id, e.distance, i.content
    FROM myplugin_embeddings e
    JOIN myplugin_entries i ON e.item_id = i.id
    WHERE e.embedding MATCH ? AND k = ?
    ORDER BY e.distance
  `).all(buf, topK);
}
```

### Complete Vector Search Flow

```javascript
const embeddings = require('./embeddings'); // your embedding helper

async function semanticSearch(db, query) {
  // 1. Generate embedding for the query
  const queryEmb = await embeddings.generateEmbedding(query);
  if (!queryEmb) return [];

  // 2. Search the vector table
  const results = searchSimilar(db, queryEmb, 5);

  // 3. Return with content
  return results.map(r => ({
    content: r.content,
    distance: r.distance,
  }));
}
```

## Schema Versioning Across Updates

When you release a new version of your plugin that changes the schema:

```javascript
const SCHEMA_VERSION = 3;

activate(context) {
  const db = context.db;
  const currentVersion = context.store.get('my-plugin.schemaVersion', 0);

  if (currentVersion < SCHEMA_VERSION) {
    migrate(db, currentVersion);
    context.store.set('my-plugin.schemaVersion', SCHEMA_VERSION);
  }
}

function migrate(db, fromVersion) {
  const migrations = [
    // v0 → v1
    () => db.exec(`CREATE TABLE IF NOT EXISTS myplugin_data (...)`),
    // v1 → v2
    () => db.exec(`ALTER TABLE myplugin_data ADD COLUMN tags TEXT DEFAULT '[]'`),
    // v2 → v3
    () => db.exec(`CREATE INDEX IF NOT EXISTS idx_myplugin_data_tags ON myplugin_data(tags)`),
  ];

  for (let i = fromVersion; i < migrations.length; i++) {
    console.log(`[MyPlugin] Running migration v${i} → v${i + 1}`);
    migrations[i]();
  }
}
```

## Tips

- **Always use `IF NOT EXISTS`** — your `activate()` runs every time the app starts
- **Prefix everything** — tables, indexes, triggers
- **Store JSON in TEXT columns** — SQLite doesn't have a JSON type, but `JSON.parse/stringify` works fine
- **Use prepared statements** — never interpolate user input into SQL strings
- **Keep embeddings in a separate virtual table** — vec0 tables have different semantics than regular tables
