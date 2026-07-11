// Skills Manager — discovers, parses, and serves skills from ~/.iimagine/skills/
//
// Skills are structured markdown files (SKILL.md) that get injected into the LLM
// system prompt to give it specialized knowledge/capabilities.
//
// Skill structure:
//   ~/.iimagine/skills/my-skill/
//     SKILL.md       — required (YAML frontmatter + instructions)
//     resources/     — optional (reference docs, examples)
//
// SKILL.md format:
// ---
// name: my-skill
// description: What this skill does
// version: 1.0.0
// author: Creator Name
// ---
//
// # My Skill
// [Instructions the LLM follows when this skill is active]
//
// Activation: user types #skill-name in chat → content injected as system context

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Store = require('electron-store');

const store = new Store();

class SkillsManager {
  constructor() {
    this.skills = new Map(); // slug → { meta, content, resourceContents }
    this.skillsDir = path.join(app.getPath('home'), '.iimagine', 'skills');
    this._lastDirMtime = null;
  }

  /**
   * Get (or create) the skills directory
   */
  getSkillsDir() {
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }
    return this.skillsDir;
  }

  /**
   * Lightweight refresh — re-scans the directory if it's been modified since last scan.
   * Keeps autocomplete and parseTags always up-to-date without full reload every call.
   */
  _refreshIfNeeded() {
    try {
      const dir = this.getSkillsDir();
      const stat = fs.statSync(dir);
      const mtime = stat.mtimeMs;

      if (mtime !== this._lastDirMtime) {
        this._lastDirMtime = mtime;
        this.loadAll();
      }
    } catch {
      // If stat fails, just reload
      this.loadAll();
    }
  }

  /**
   * Discover and load all skills from ~/.iimagine/skills/
   * Also loads bundled skills from the app's plugins/skills/ directory.
   */
  loadAll() {
    this.skills.clear();
    const dir = this.getSkillsDir();

    try {
      const folders = fs.readdirSync(dir, { withFileTypes: true });
      for (const folder of folders) {
        if (!folder.isDirectory()) continue;
        if (folder.name.startsWith('.') || folder.name.startsWith('_')) continue;

        const skillPath = path.join(dir, folder.name, 'SKILL.md');
        if (!fs.existsSync(skillPath)) continue;

        try {
          const skill = this._parseSkill(skillPath, folder.name);
          if (skill) {
            this.skills.set(skill.meta.slug, skill);
          }
        } catch (err) {
          console.warn(`[Skills] Failed to parse ${folder.name}:`, err.message);
        }
      }
    } catch (err) {
      console.warn('[Skills] Failed to read skills dir:', err.message);
    }

    console.log(`[Skills] Loaded ${this.skills.size} skills`);
    return this.skills.size;
  }

  /**
   * Parse a SKILL.md file into { meta, content, resourceContents }
   */
  _parseSkill(skillPath, folderName) {
    const raw = fs.readFileSync(skillPath, 'utf-8');

    // Parse YAML frontmatter
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!fmMatch) {
      // No frontmatter — treat entire file as content
      return {
        meta: {
          slug: folderName,
          name: folderName,
          description: '',
          version: '1.0.0',
          author: 'Unknown',
        },
        content: raw.trim(),
        resourceContents: this._loadResources(path.dirname(skillPath)),
      };
    }

    const frontmatter = fmMatch[1];
    const content = fmMatch[2].trim();

    // Simple YAML parsing (avoids a yaml dependency)
    const meta = {
      slug: folderName,
      name: folderName,
      description: '',
      version: '1.0.0',
      author: 'Unknown',
    };

    for (const line of frontmatter.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim().replace(/^["']|["']$/g, '');

      switch (key) {
        case 'name': meta.slug = value.toLowerCase().replace(/\s+/g, '-'); meta.name = value; break;
        case 'description': meta.description = value; break;
        case 'version': meta.version = value; break;
        case 'author': meta.author = value; break;
      }
    }

    return {
      meta,
      content,
      resourceContents: this._loadResources(path.dirname(skillPath)),
    };
  }

  /**
   * Load resource files from a skill's resources/ directory
   * Returns: { filename: content } map
   */
  _loadResources(skillDir) {
    const resourcesDir = path.join(skillDir, 'resources');
    const resources = {};

    if (!fs.existsSync(resourcesDir)) return resources;

    try {
      const files = fs.readdirSync(resourcesDir);
      for (const file of files) {
        const filePath = path.join(resourcesDir, file);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        // Only load text files (md, txt, json) — skip binaries
        if (/\.(md|txt|json|yaml|yml|csv)$/i.test(file)) {
          try {
            resources[file] = fs.readFileSync(filePath, 'utf-8');
          } catch {}
        }
      }
    } catch {}

    return resources;
  }

  /**
   * Get all loaded skills as a list (for UI display)
   */
  getAll() {
    const disabledSet = new Set(store.get('skills.disabled', []));

    return [...this.skills.values()].map(s => ({
      slug: s.meta.slug,
      name: s.meta.name,
      description: s.meta.description,
      version: s.meta.version,
      author: s.meta.author,
      enabled: !disabledSet.has(s.meta.slug),
      hasResources: Object.keys(s.resourceContents).length > 0,
    }));
  }

  /**
   * Get skills available for # autocomplete (enabled only)
   * Re-scans directory each time to pick up newly installed skills.
   */
  getAutocompleteList() {
    this._refreshIfNeeded();
    const disabledSet = new Set(store.get('skills.disabled', []));

    return [...this.skills.values()]
      .filter(s => !disabledSet.has(s.meta.slug))
      .map(s => ({
        slug: s.meta.slug,
        name: s.meta.name,
        description: s.meta.description,
      }));
  }

  /**
   * Get the full content for a skill (for injection into system prompt)
   * Includes SKILL.md content + any resource files
   */
  getSkillContent(slug) {
    const skill = this.skills.get(slug);
    if (!skill) return null;

    const disabledSet = new Set(store.get('skills.disabled', []));
    if (disabledSet.has(slug)) return null;

    let fullContent = skill.content;

    // Append resource files if present
    const resources = skill.resourceContents;
    if (Object.keys(resources).length > 0) {
      for (const [filename, content] of Object.entries(resources)) {
        fullContent += `\n\n---\n[Resource: ${filename}]\n${content}`;
      }
    }

    return fullContent;
  }

  /**
   * Build the system prompt injection for active skills.
   * Called from the chat flow when # skills are detected.
   *
   * @param {string[]} slugs — skill slugs activated via #hashtag
   * @returns {string} — combined skill content to prepend to system prompt
   */
  buildSkillContext(slugs) {
    if (!slugs || slugs.length === 0) return '';

    const sections = [];

    for (const slug of slugs) {
      const content = this.getSkillContent(slug);
      if (content) {
        sections.push(`[SKILL: ${slug}]\n${content}\n[/SKILL]`);
      }
    }

    if (sections.length === 0) return '';

    return '\n\n' + sections.join('\n\n');
  }

  /**
   * Parse #skill-name references from a message string.
   * Returns: { slugs: string[], cleanMessage: string }
   */
  parseSkillTags(message) {
    this._refreshIfNeeded();
    const skillRegex = /#([\w][\w-]*)/g;
    const matches = [...message.matchAll(skillRegex)];

    if (matches.length === 0) {
      return { slugs: [], cleanMessage: message };
    }

    const slugs = [];
    for (const match of matches) {
      const slug = match[1].toLowerCase();
      // Only include if it's an actual installed skill
      if (this.skills.has(slug)) {
        slugs.push(slug);
      }
    }

    // Strip the #tags from the message that matched actual skills
    let cleanMessage = message;
    for (const slug of slugs) {
      cleanMessage = cleanMessage.replace(new RegExp(`#${slug}\\b`, 'gi'), '').trim();
    }

    return { slugs, cleanMessage };
  }

  /**
   * Enable a skill
   */
  enable(slug) {
    const disabled = store.get('skills.disabled', []);
    const updated = disabled.filter(s => s !== slug);
    store.set('skills.disabled', updated);
  }

  /**
   * Disable a skill (it remains installed but won't activate)
   */
  disable(slug) {
    const disabled = store.get('skills.disabled', []);
    if (!disabled.includes(slug)) {
      disabled.push(slug);
      store.set('skills.disabled', disabled);
    }
  }

  /**
   * Install a skill from a directory path (copy to skills dir)
   */
  install(sourcePath) {
    const skillFile = path.join(sourcePath, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      return { success: false, error: 'No SKILL.md found in directory' };
    }

    // Parse to get the slug
    const folderName = path.basename(sourcePath);
    const skill = this._parseSkill(skillFile, folderName);
    if (!skill) {
      return { success: false, error: 'Failed to parse SKILL.md' };
    }

    const destDir = path.join(this.getSkillsDir(), skill.meta.slug);

    // Remove existing if present
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }

    // Copy skill directory
    fs.cpSync(sourcePath, destDir, { recursive: true });

    // Add to loaded skills
    this.skills.set(skill.meta.slug, skill);

    console.log(`[Skills] Installed: ${skill.meta.name} (${skill.meta.slug})`);
    return { success: true, slug: skill.meta.slug };
  }

  /**
   * Install a skill from content (used by marketplace sync)
   */
  installFromContent(slug, content, resources = {}) {
    const destDir = path.join(this.getSkillsDir(), slug);

    // Create directory
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Write SKILL.md
    fs.writeFileSync(path.join(destDir, 'SKILL.md'), content, 'utf-8');

    // Write resource files
    if (Object.keys(resources).length > 0) {
      const resourcesDir = path.join(destDir, 'resources');
      if (!fs.existsSync(resourcesDir)) {
        fs.mkdirSync(resourcesDir, { recursive: true });
      }
      for (const [filename, fileContent] of Object.entries(resources)) {
        fs.writeFileSync(path.join(resourcesDir, filename), fileContent, 'utf-8');
      }
    }

    // Parse and load
    const skillPath = path.join(destDir, 'SKILL.md');
    const skill = this._parseSkill(skillPath, slug);
    if (skill) {
      this.skills.set(skill.meta.slug, skill);
    }

    console.log(`[Skills] Installed from content: ${slug}`);
    return { success: true, slug };
  }

  /**
   * Uninstall a skill
   */
  uninstall(slug) {
    this.skills.delete(slug);

    const dir = path.join(this.getSkillsDir(), slug);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }

    // Remove from disabled list if present
    const disabled = store.get('skills.disabled', []);
    store.set('skills.disabled', disabled.filter(s => s !== slug));

    console.log(`[Skills] Uninstalled: ${slug}`);
    return true;
  }

  /**
   * Get pinned skills for a conversation (always-active)
   */
  getPinnedSlugs(conversationId) {
    const pinned = store.get('skills.pinned', {});
    return pinned[conversationId] || [];
  }

  /**
   * Pin a skill to a conversation
   */
  pin(conversationId, slug) {
    const pinned = store.get('skills.pinned', {});
    if (!pinned[conversationId]) pinned[conversationId] = [];
    if (!pinned[conversationId].includes(slug)) {
      pinned[conversationId].push(slug);
    }
    store.set('skills.pinned', pinned);
  }

  /**
   * Unpin a skill from a conversation
   */
  unpin(conversationId, slug) {
    const pinned = store.get('skills.pinned', {});
    if (pinned[conversationId]) {
      pinned[conversationId] = pinned[conversationId].filter(s => s !== slug);
      if (pinned[conversationId].length === 0) delete pinned[conversationId];
    }
    store.set('skills.pinned', pinned);
  }

  /**
   * Open the skills directory in file explorer
   */
  openDirectory() {
    const { shell } = require('electron');
    shell.openPath(this.getSkillsDir());
  }
}

module.exports = new SkillsManager();
