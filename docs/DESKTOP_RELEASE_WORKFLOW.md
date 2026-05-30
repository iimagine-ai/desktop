# Desktop App Release Workflow

## Overview

This document describes the complete workflow for publishing a new version of the IIMAGINE Desktop app.

**Repos:**
- Private (source of truth): `delreyrunner/iia-28` → `desktop-companion/` folder
- Public (builds + releases): `iimagine-ai/desktop` (formerly `delreyrunner/iimagine-ai-desktop`)

**Build trigger:** Pushing a version tag (e.g. `v0.7.1`) to the public repo triggers GitHub Actions which builds Mac (.dmg), Windows (.exe), and Linux (.AppImage) installers.

**Release mode:** Builds are **auto-published** (not draft). The workflow explicitly sets `draft: false` so releases go live immediately once the build completes.

---

## Step-by-Step Release Process

### 1. Bump version in package.json

In `desktop-companion/package.json`, update the `version` field:
```json
"version": "0.7.1"
```

### 2. Ensure all new .js files are in the build files array

**CRITICAL — This is the most common source of "Cannot find module" errors.**

In `desktop-companion/package.json` → `build.files`, verify that EVERY `.js` file required by `main.js` or `plugin-manager.js` is listed. If you added a new file, add it here.

Current required files (check this is up to date):
```
main.js, preload.js, storage.js, kb-storage.js, assistant-storage.js,
persona-storage.js, folder-connect.js, prompt-storage.js, rag-prompt-storage.js,
tool-calling.js, plugin-manager.js, stream-abort.js, engine-manager.js,
model-registry.js, local-ai-adapter.js, license-checker.js, hardware-scanner.js,
manifest-manager.js, model-orchestrator.js, model-registry-bundled.json
```

### 3. Sync code to the public repo

```bash
# Clone if not already cloned
git clone https://github.com/iimagine-ai/desktop.git /tmp/iimagine-ai-desktop

# Sync (excludes .git and node_modules)
rsync -av --delete --exclude='.git' --exclude='node_modules' --exclude='.github' desktop-companion/ /tmp/iimagine-ai-desktop/

# Copy workflow files
cp -r desktop-companion/.github /tmp/iimagine-ai-desktop/.github
```

### 4. Commit, tag, and push

```bash
cd /tmp/iimagine-ai-desktop
git add -A
git commit -m "v0.X.Y: description of changes"
git tag v0.X.Y
git push origin main --tags
```

### 5. Wait for build to complete

Check: https://github.com/iimagine-ai/desktop/actions

The build takes ~5-10 minutes. It produces Mac arm64 .dmg, Windows .exe, and Linux .AppImage.

### 6. Delete old releases from GitHub

Go to: https://github.com/iimagine-ai/desktop/releases

- The new version will be **auto-published** (not draft) once the build completes
- **DELETE the previous version's release** — do NOT accumulate multiple versions
- Only the latest version should be visible to users

### 7. Update download links on the web app

Update the version in TWO files in `iia-28`:

**File 1:** `src/app/downloads/page.tsx`
```
const VERSION = '0.X.Y';
const RELEASE_TAG = 'v0.X.Y';
```

**File 2:** `src/app/desktop/downloads/page.tsx`
- Update all three download href URLs to point to the new version

### 8. Push to trigger Vercel deployment

```bash
git add src/app/downloads/page.tsx src/app/desktop/downloads/page.tsx
git commit -m "fix: update download links to v0.X.Y"
git push origin main
```

### 9. Test the downloaded app on Mac

After downloading the .dmg from the release:

```bash
# Remove quarantine attribute (required because app is not code-signed)
xattr -cr /Applications/IIMAGINE\ Desktop.app
```

Then open the app and verify it launches without errors.

---

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "is damaged and can't be opened" | macOS Gatekeeper quarantine | Run `xattr -cr /Applications/IIMAGINE\ Desktop.app` |
| "Cannot find module './xyz'" | File missing from `build.files` in package.json | Add the file to the `files` array and rebuild |
| Old version showing on downloads page | Forgot to update VERSION/links | Update both download page files and push |
| Multiple versions on releases page | Didn't delete old release | Delete old releases, keep only the latest |

---

## Important Reminders

- **Replace old versions with new versions** on the releases page. Do not accumulate multiple versions — only the latest should be visible to users.
- **Always update the downloads page** after publishing a new release. Both `src/app/downloads/page.tsx` and `src/app/desktop/downloads/page.tsx` must be updated.
- **Always run `xattr -cr`** after downloading on Mac to clear the quarantine flag. This is required until we set up Apple code signing.
- **Test locally before pushing** — run `npm start` in `desktop-companion/` to verify the app launches without module errors before syncing to the public repo.
