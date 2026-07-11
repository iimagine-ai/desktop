# Contributing to IIMAGINE Desktop

Thanks for your interest in contributing. This guide covers the essentials.

## Dev Environment Setup

1. **Node 18+** required
2. Clone and install:
   ```bash
   git clone <your-fork>
   cd desktop-companion
   npm install
   ./scripts/setup-engine.sh
   npm start
   ```

## Project Structure

| Location | Purpose |
|----------|---------|
| Root `.js` files | Main process modules (Electron) |
| `renderer/` | UI — vanilla HTML/CSS/JS |
| `plugins/` | Plugin packages (each has a `plugin.json` manifest) |
| `scripts/` | Build and setup scripts |
| `docs/` | Documentation |

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes with clear, focused commits
3. Open a Pull Request describing what and why

## Code Style

- Vanilla JavaScript — no frameworks in the renderer
- Follow `STYLE_GUIDE.md` for formatting and naming conventions
- Keep modules small and single-purpose
- Use `const`/`let`, never `var`

## Plugin Contributions

Add your plugin to `plugins/` with a `plugin.json` manifest. See `docs/plugin-docs/` for the full SDK reference.

## Commit Messages

Use [conventional commits](https://www.conventionalcommits.org/):

```
feat: add keyboard shortcut for quick model switch
fix: prevent crash when engine binary is missing
docs: update plugin hooks reference
chore: bump electron to 33.1
```

## Guidelines

- Don't introduce new frameworks or bundlers without opening a discussion first
- Keep PRs focused — one feature or fix per PR
- Test on macOS at minimum (the primary platform)
- Run `node -c main.js` and `node -c preload.js` before pushing

## Questions?

Open an issue or start a discussion on GitHub.
