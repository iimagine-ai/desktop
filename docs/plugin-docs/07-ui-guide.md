# UI Guide — Building Plugin Interfaces

Plugins render UI by returning HTML strings from `renderPage()` and `renderSettings()`. The app uses Tailwind CSS (loaded via CDN), so all utility classes are available.

## How Rendering Works

```javascript
// Your function returns an HTML string
renderPage(container) {
  return `<div class="p-6"><h2 class="text-xl text-white">My Page</h2></div>`;
}
```

The app injects your HTML into the main content area. The page re-renders each time the user navigates to it (sidebar click), so your function runs fresh each time.

## Available CSS

### Tailwind CSS (CDN)

All Tailwind utility classes are available. The app loads Tailwind via CDN, so you have the full class library.

```html
<div class="p-6 space-y-4">
  <h2 class="text-xl font-semibold text-white">Title</h2>
  <p class="text-sm text-gray-400">Description text</p>
</div>
```

### Dark Mode

The app uses a dark theme. Design for dark backgrounds by default. Use `dark:` prefix classes if you need to support both modes, but in practice the app is always dark.

**Color palette to match the app:**

| Element | Classes |
|---------|---------|
| Background | `bg-gray-900` or `bg-gray-800` |
| Card/panel | `bg-gray-800` with `border border-gray-700` |
| Primary text | `text-white` |
| Secondary text | `text-gray-300` |
| Muted text | `text-gray-400` or `text-gray-500` |
| Borders | `border-gray-700` |
| Accent | `text-blue-400` or `text-indigo-400` |
| Danger | `text-red-400`, `bg-red-900` |

## Common UI Patterns

### Stats Grid

```javascript
renderPage(container) {
  const stats = getStats();
  return `
    <div class="p-6 space-y-6">
      <h2 class="text-xl font-semibold text-white">📊 Dashboard</h2>
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-gray-800 rounded p-3">
          <div class="text-2xl font-bold text-white">${stats.total}</div>
          <div class="text-xs text-gray-400">Total Items</div>
        </div>
        <div class="bg-gray-800 rounded p-3">
          <div class="text-2xl font-bold text-white">${stats.active}</div>
          <div class="text-xs text-gray-400">Active</div>
        </div>
      </div>
    </div>
  `;
}
```

### Data Table

```javascript
renderPage(container) {
  const items = getItems(20);
  const rows = items.map(item => `
    <tr class="border-b border-gray-700 hover:bg-gray-800">
      <td class="py-2 px-3 text-sm text-white">${item.name}</td>
      <td class="py-2 px-3 text-xs text-gray-400">${item.type}</td>
      <td class="py-2 px-3 text-xs text-gray-500">${item.date}</td>
    </tr>
  `).join('');

  return `
    <div class="p-6">
      <div class="overflow-auto max-h-96 rounded border border-gray-700">
        <table class="w-full text-left">
          <thead class="bg-gray-800 text-xs text-gray-400 sticky top-0">
            <tr>
              <th class="py-2 px-3">Name</th>
              <th class="py-2 px-3">Type</th>
              <th class="py-2 px-3">Date</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="3" class="py-4 px-3 text-center text-gray-500">No data yet.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}
```

### Settings Form

```javascript
renderSettings(container) {
  const model = store.get('my-plugin.model', 'llama3');
  const enabled = store.get('my-plugin.autoExtract', true);
  const budget = store.get('my-plugin.tokenBudget', 1500);

  return `
    <div class="space-y-4">
      <p class="text-sm text-gray-400">Configure your plugin settings below.</p>

      <!-- Text Input -->
      <div>
        <label class="text-xs text-gray-400 block mb-1">Model Name</label>
        <input type="text" value="${model}" placeholder="llama3"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
          id="my-plugin-model" />
      </div>

      <!-- Range Slider -->
      <div>
        <label class="text-xs text-gray-400 block mb-1">Token Budget</label>
        <input type="range" min="500" max="3000" step="100" value="${budget}"
          class="w-full" id="my-plugin-budget" />
        <span class="text-xs text-gray-500">${budget} tokens</span>
      </div>

      <!-- Checkbox Toggle -->
      <div class="flex items-center gap-2">
        <input type="checkbox" id="my-plugin-extract" ${enabled ? 'checked' : ''} />
        <label for="my-plugin-extract" class="text-sm text-gray-300">
          Enable auto-extraction
        </label>
      </div>

      <!-- Danger Zone -->
      <div class="pt-3 border-t border-gray-700">
        <button id="my-plugin-clear"
          class="px-4 py-2 bg-red-900 hover:bg-red-800 text-red-200 text-sm rounded">
          Clear All Data
        </button>
      </div>
    </div>
  `;
}
```

### Cards

```javascript
const cards = items.map(item => `
  <div class="bg-gray-800 rounded-lg border border-gray-700 p-4 hover:border-gray-600 transition-colors">
    <h3 class="text-sm font-medium text-white">${item.title}</h3>
    <p class="text-xs text-gray-400 mt-1">${item.description}</p>
    <div class="flex gap-2 mt-3">
      <span class="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">${item.tag}</span>
    </div>
  </div>
`).join('');

return `<div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">${cards}</div>`;
```

### Empty State

```javascript
return `
  <div class="p-6 flex flex-col items-center justify-center text-center py-16">
    <div class="text-4xl mb-4">📭</div>
    <h3 class="text-lg font-medium text-white">No data yet</h3>
    <p class="text-sm text-gray-400 mt-1">Start chatting to build your knowledge base.</p>
  </div>
`;
```

## Event Binding

Since you return HTML strings (not live DOM), use inline event handlers or IPC for interactivity.

### Inline onclick

```javascript
return `
  <button onclick="if(confirm('Are you sure?')) { window.electronAPI?.send('my-plugin:clear') }"
    class="px-4 py-2 bg-red-900 hover:bg-red-800 text-red-200 text-sm rounded">
    Clear Data
  </button>
`;
```

### IPC Communication

The renderer process exposes some APIs via `window.api`:

```javascript
// Read settings
window.api.settings.get('my-plugin.theme');

// Write settings
window.api.settings.set('my-plugin.theme', 'dark');

// Get plugin list
window.api.plugins.list();
```

### Script Tags (Advanced)

For more complex interactivity, embed a script tag:

```javascript
renderPage(container) {
  return `
    <div class="p-6">
      <input type="text" id="search-input" placeholder="Search..."
        class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white mb-4" />
      <div id="results"></div>
    </div>
    <script>
      document.getElementById('search-input').addEventListener('input', (e) => {
        const query = e.target.value;
        // Filter and update results
        document.getElementById('results').innerHTML = 
          query ? '<p class="text-sm text-gray-400">Searching: ' + query + '</p>' : '';
      });
    </script>
  `;
}
```

## Buttons

```html
<!-- Primary action -->
<button class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded">
  Save
</button>

<!-- Secondary action -->
<button class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded">
  Cancel
</button>

<!-- Danger action -->
<button class="px-4 py-2 bg-red-900 hover:bg-red-800 text-red-200 text-sm rounded">
  Delete
</button>

<!-- Small/subtle -->
<button class="px-2 py-1 text-xs text-gray-400 hover:text-white">
  Edit
</button>
```

## Tips

- **Keep it simple** — HTML strings work well for read-heavy dashboards
- **Re-render on navigate** — your page function runs fresh each time, so data is always current
- **Match the app's dark theme** — use `bg-gray-800/900`, `text-white/gray-300/400`
- **Use `max-h-*` with `overflow-auto`** — prevent long lists from breaking the layout
- **Test with real data** — empty states and long content both need to look good
