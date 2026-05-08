# Distribution — Packaging and Sharing Plugins

How to package your plugin for distribution and how users install it.

## Folder Structure for Distribution

A distributable plugin is a folder (or zip of a folder) with this structure:

```
my-plugin/
├── plugin.json       ← required: manifest
├── index.js          ← required: entry point
├── README.md         ← recommended: usage instructions
├── helper.js         ← optional: supporting modules
└── lib/
    └── utils.js      ← optional: organized sub-modules
```

### What to Include

- All `.js` files your plugin needs
- `plugin.json` manifest
- A `README.md` with setup instructions
- Any data files (templates, schemas, etc.)

### What NOT to Include

- `node_modules/` — plugins use the app's Node.js runtime and built-in modules
- `.git/` — version control metadata
- Test files — keep the distribution lean
- `.env` or secrets — never distribute credentials

## Packaging as a Zip

```bash
# From your plugin's parent directory
zip -r my-plugin.zip my-plugin/ -x "my-plugin/node_modules/*" "my-plugin/.git/*"
```

Or create a tarball:

```bash
tar -czf my-plugin.tar.gz my-plugin/ --exclude=node_modules --exclude=.git
```

## How Users Install

### Method 1: Settings UI (Recommended)

1. Open the app
2. Go to Settings → Plugins
3. Click "Install"
4. Select the plugin folder (unzipped)
5. The plugin is copied to `~/.iimagine/plugins/` and activated

### Method 2: Manual Copy

```bash
# Unzip if needed
unzip my-plugin.zip

# Copy to plugins directory
cp -r my-plugin ~/.iimagine/plugins/

# Restart the app
```

### Method 3: Symlink (Development)

```bash
ln -sf /path/to/my-plugin ~/.iimagine/plugins/my-plugin
```

## What Happens on Install

The plugin manager's `install()` method:

1. Reads `plugin.json` from the source folder
2. Copies the entire folder to `~/.iimagine/plugins/{id}/`
3. If a plugin with the same ID exists, it's replaced (overwritten)
4. The plugin is activated immediately
5. Enabled state is set to `true` in electron-store

## Uninstalling

Users can uninstall from Settings → Plugins, or manually:

```bash
rm -rf ~/.iimagine/plugins/my-plugin
```

The plugin manager's `uninstall()` method:
1. Calls `deactivate()` on the plugin
2. Removes it from the internal registry
3. Deletes the folder from `~/.iimagine/plugins/`
4. Removes the enabled state from electron-store

## Versioning Conventions

Use semantic versioning in your `plugin.json`:

```json
{
  "version": "1.2.3"
}
```

| Version Bump | When |
|-------------|------|
| Patch (1.0.x) | Bug fixes, no behavior changes |
| Minor (1.x.0) | New features, backward compatible |
| Major (x.0.0) | Breaking changes, schema migrations needed |

### Upgrade Path

When a user installs a newer version over an existing one:
1. The old folder is deleted
2. The new folder is copied in
3. `activate()` runs — your migration logic handles schema changes

Design your `activate()` to be idempotent and handle upgrades gracefully:

```javascript
activate(context) {
  const currentVersion = context.store.get('my-plugin.version', '0.0.0');
  
  if (currentVersion !== '1.2.0') {
    // Run migrations
    migrate(context.db, currentVersion);
    context.store.set('my-plugin.version', '1.2.0');
  }
}
```

## Dependencies

Plugins run in the app's Node.js process and have access to:

- All Node.js built-in modules (`fs`, `path`, `crypto`, `http`, etc.)
- `fetch` (global, available in modern Node.js)
- The app's installed packages (better-sqlite3, electron-store, etc.)

If your plugin needs an npm package that isn't available in the app:

1. **Prefer built-in alternatives** — use `fetch` instead of `axios`, use `crypto` instead of `uuid`
2. **Bundle the dependency** — include the package source in your plugin folder
3. **Document the requirement** — note in your README if the user needs to install something

### Bundling a Dependency

```
my-plugin/
├── plugin.json
├── index.js
└── vendor/
    └── some-lib.js   ← bundled dependency
```

```javascript
// In your index.js
const someLib = require('./vendor/some-lib');
```

## Distribution Checklist

Before sharing your plugin:

- [ ] `plugin.json` has a unique `id`, correct `version`, and accurate `description`
- [ ] `index.js` exports `activate()` and `deactivate()` at minimum
- [ ] All hooks declared in manifest are implemented in the entry point
- [ ] Tables are prefixed with plugin ID
- [ ] Store keys are prefixed with plugin ID
- [ ] No hardcoded paths (use `context.getOllamaUrl()`, not `http://localhost:11434`)
- [ ] Error handling — hooks don't throw unhandled errors
- [ ] README explains what the plugin does and any setup needed
- [ ] No secrets or credentials in the distributed files
- [ ] Tested on a fresh install (delete `~/.iimagine/plugins/your-plugin/` and reinstall)

## Future: Marketplace

A plugin marketplace is planned for a future release. When available:

- Plugins will be discoverable from within the app
- One-click install from a curated directory
- Automatic updates when new versions are published
- Review and rating system

For now, distribute plugins via GitHub repos, zip files, or direct folder sharing.
