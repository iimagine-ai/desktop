// IIMAGINE Desktop — App shell
// Router, state management, initialization

const $ = (sel) => document.querySelector(sel);

// ── Global State ────────────────────────────────────────────────
window.AppState = {
  currentUser: null,
  currentPage: 'chat',
};

// ── Router ──────────────────────────────────────────────────────
const AppRouter = {
  pages: {
    chat: window.ChatPage,
    recent: window.RecentPage,
    images: window.ImagesPage,
    videos: window.VideosPage,
    knowledge: window.KnowledgePage,
    assistants: window.AssistantsPage,
    prompts: window.PromptsPage,

    settings: window.SettingsPage,
  },

  navigate(page) {
    const target = this.pages[page];
    if (!target) return;

    // Destroy previous page if it has cleanup
    const prev = this.pages[window.AppState.currentPage];
    if (prev?.destroy) prev.destroy();

    window.AppState.currentPage = page;
    const container = $('#mainContent');
    target.render(container);

    // Update nav highlight
    document.querySelectorAll('.nav-btn').forEach(btn => {
      const btnPage = btn.dataset.page;
      const isActive = btnPage === page || (btnPage === 'chat' && page === 'recent');
      if (isActive) {
        btn.classList.remove('text-neutral-500', 'dark:text-neutral-400', 'hover:text-neutral-900', 'dark:hover:text-neutral-100', 'hover:bg-white/40', 'dark:hover:bg-neutral-800/40');
        btn.classList.add('bg-white/60', 'dark:bg-neutral-800/60', 'text-neutral-900', 'dark:text-neutral-100', 'shadow-sm', 'border', 'border-white/50', 'dark:border-neutral-700/50');
      } else {
        btn.classList.remove('bg-white/60', 'dark:bg-neutral-800/60', 'text-neutral-900', 'dark:text-neutral-100', 'shadow-sm', 'border', 'border-white/50', 'dark:border-neutral-700/50');
        btn.classList.add('text-neutral-500', 'dark:text-neutral-400', 'hover:text-neutral-900', 'dark:hover:text-neutral-100', 'hover:bg-white/40', 'dark:hover:bg-neutral-800/40');
      }
    });
  },

  updateModelDropdown() {
    const btn = $('#modelDropdownBtn');
    const list = $('#modelDropdownList');
    const providers = window.ProviderManager.getReady();

    if (!providers.length) {
      btn.innerHTML = '<span class="text-neutral-400">No models</span>';
      list.innerHTML = '';
      return;
    }

    // Update button to show active model
    const active = window.ProviderManager.activeProvider;
    if (active) {
      btn.innerHTML = `<span style="background:${active.privacyColor};" class="w-2.5 h-2.5 rounded-sm flex-shrink-0 inline-block"></span><span class="truncate">${active.name}</span>`;
    } else {
      btn.innerHTML = '<span class="text-neutral-400">Select model</span>';
    }

    // Build dropdown items
    list.innerHTML = providers.map(p => {
      const isActive = active?.name === p.name;
      return `<button data-provider="${p.name}" class="model-opt w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-neutral-100/80 dark:hover:bg-neutral-700/60 transition-colors ${isActive ? 'font-medium text-neutral-900 dark:text-neutral-100' : 'text-neutral-600 dark:text-neutral-400'}">
        <span style="background:${p.privacyColor};" class="w-2.5 h-2.5 rounded-sm flex-shrink-0"></span>
        <span class="truncate">${p.name}</span>
        ${isActive ? '<span class="ml-auto text-[10px] text-neutral-400">✓</span>' : ''}
      </button>`;
    }).join('');

    // Bind click handlers on items
    list.querySelectorAll('.model-opt').forEach(item => {
      item.addEventListener('click', () => {
        window.ProviderManager.setActive(item.dataset.provider);
        this.updateModelDropdown();
        list.classList.add('hidden');
      });
    });
  }
};

window.AppRouter = AppRouter;

// ── Auth ────────────────────────────────────────────────────────
function showAuth() {
  $('#authScreen').classList.remove('hidden');
  $('#dashboard').classList.add('hidden');
}

async function showDashboard() {
  $('#authScreen').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');

  const user = window.AppState.currentUser;
  const isGuest = user?.isGuest;

  // Update sidebar user area
  const savedDisplayName = await window.api.settings.get('profile.displayName');
  $('#sidebarUser').textContent = savedDisplayName || (isGuest ? 'Local User' : (user?.email || ''));

  // Hide sign-out button for guest users, show sign-in option instead
  const logoutBtn = $('#logoutBtn');
  if (isGuest) {
    logoutBtn.textContent = 'Sign in';
    logoutBtn.onclick = async () => {
      // Switch to auth-required mode and show login
      await window.api.settings.set('auth.required', true);
      showAuth();
    };
  } else {
    logoutBtn.textContent = 'Sign out';
    logoutBtn.onclick = async () => {
      await window.api.auth.logout();
      window.AppState.currentUser = null;
      window.ChatPage.chatHistory = [];
      // Check if auth is required — if not, reload as guest
      const authRequired = await window.api.auth.isRequired();
      if (!authRequired) {
        const guestUser = await window.api.auth.getUser();
        if (guestUser) {
          window.AppState.currentUser = guestUser;
          showDashboard();
          return;
        }
      }
      showAuth();
    };
  }

  AppRouter.navigate('chat');
}

// Auth event listeners (still needed for when users sign in from guest mode)
window.api.auth.onSuccess((user) => {
  window.AppState.currentUser = user;
  showDashboard();
  window.ProviderManager.refreshLocal().then(() => AppRouter.updateModelDropdown());
});

window.api.auth.onError((error) => {
  const el = $('#authError');
  el.textContent = error;
  el.classList.remove('hidden');
});

$('#loginLocalBtn').addEventListener('click', () => {
  $('#authError').classList.add('hidden');
  window.api.auth.login('http://localhost:3000');
});

$('#loginProdBtn').addEventListener('click', () => {
  $('#authError').classList.add('hidden');
  window.api.auth.login('https://app.iimagine.ai');
});

$('#manualCodeBtn').addEventListener('click', async () => {
  const code = $('#manualCodeInput').value.trim();
  if (!code) return;

  $('#authError').classList.add('hidden');
  const btn = $('#manualCodeBtn');
  btn.textContent = '...';
  btn.disabled = true;

  try {
    const result = await window.api.auth.exchangeCode(code);
    if (result?.error) {
      const el = $('#authError');
      el.textContent = result.error;
      el.classList.remove('hidden');
    }
  } catch {
    const el = $('#authError');
    el.textContent = 'Failed to connect';
    el.classList.remove('hidden');
  } finally {
    btn.textContent = 'Connect';
    btn.disabled = false;
  }
});

$('#manualCodeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#manualCodeBtn').click();
});

// Legacy logout button handler (overridden in showDashboard, but keep as fallback)
$('#logoutBtn').addEventListener('click', async () => {
  await window.api.auth.logout();
  window.AppState.currentUser = null;
  window.ChatPage.chatHistory = [];
  showAuth();
});

// ── Theme Toggle ─────────────────────────────────────────────────
function updateThemeButton() {
  const icon = $('#themeIcon');
  if (window.ThemeManager.current === 'dark') {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  } else {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }
}

$('#themeToggleBtn').addEventListener('click', () => {
  window.ThemeManager.toggle();
  updateThemeButton();
});

// Set initial button state
updateThemeButton();

// ── Sidebar Nav ─────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    AppRouter.navigate(btn.dataset.page);
  });
});

// ── Sidebar Collapse ─────────────────────────────────────────────
(async function initSidebarCollapse() {
  const sidebar = $('#sidebar');
  const collapseBtn = $('#sidebarCollapseBtn');
  if (!sidebar || !collapseBtn) return;

  // Restore saved state
  const isCollapsed = await window.api.settings.get('sidebar.collapsed');
  if (isCollapsed) sidebar.classList.add('collapsed');

  collapseBtn.addEventListener('click', async () => {
    sidebar.classList.toggle('collapsed');
    const nowCollapsed = sidebar.classList.contains('collapsed');
    await window.api.settings.set('sidebar.collapsed', nowCollapsed);
  });
})();

// ── Model Dropdown Toggle ────────────────────────────────────────
$('#modelDropdownBtn').addEventListener('click', () => {
  const list = $('#modelDropdownList');
  list.classList.toggle('hidden');
});
// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = $('#modelDropdown');
  if (dropdown && !dropdown.contains(e.target)) {
    $('#modelDropdownList').classList.add('hidden');
  }
});

// ── Plugin Sidebar Pages ─────────────────────────────────────────
async function loadPluginSidebarItems() {
  try {
    const items = await window.api.plugins.getSidebarItems();
    if (!items || !items.length) return;

    const nav = document.querySelector('#sidebar nav');
    if (!nav) return;

    // Find the settings button to insert before it
    const settingsBtn = nav.querySelector('[data-page="settings"]');

    for (const item of items) {
      // Skip if already added
      if (nav.querySelector(`[data-page="plugin:${item.id}"]`)) continue;

      const btn = document.createElement('button');
      btn.setAttribute('data-page', `plugin:${item.id}`);
      btn.className = 'nav-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-white/40 dark:hover:bg-neutral-800/40 transition-all group';
      btn.innerHTML = `
        <span class="text-base group-hover:scale-110 transition-transform flex-shrink-0">${item.icon}</span>
        <span class="text-sm font-medium sidebar-label">${item.label}</span>
      `;
      btn.addEventListener('click', () => {
        AppRouter.navigatePlugin(item.id);
      });

      if (settingsBtn) {
        nav.insertBefore(btn, settingsBtn);
      } else {
        nav.appendChild(btn);
      }
    }
  } catch (err) {
    console.warn('[App] Failed to load plugin sidebar items:', err.message);
  }
}

// Add plugin page navigation to router
AppRouter.navigatePlugin = async function(pluginId, activeTab) {
  // Destroy previous page
  const prev = this.pages[window.AppState.currentPage];
  if (prev?.destroy) prev.destroy();

  window.AppState.currentPage = `plugin:${pluginId}`;
  const container = document.querySelector('#mainContent');

  try {
    const html = await window.api.plugins.renderPage(pluginId, activeTab);
    if (html) {
      container.innerHTML = html;
      // Execute any script tags in the injected HTML
      container.querySelectorAll('script').forEach(oldScript => {
        const newScript = document.createElement('script');
        newScript.textContent = oldScript.textContent;
        oldScript.parentNode.replaceChild(newScript, oldScript);
      });
      // Auto-switch to the requested tab after render
      if (activeTab && window.cwSwitchTab) {
        window.cwSwitchTab(activeTab);
      }
    } else {
      container.innerHTML = '<div class="p-6 text-neutral-500">Plugin page not available.</div>';
    }
  } catch (err) {
    container.innerHTML = `<div class="p-6 text-red-500">Error loading plugin page: ${err.message}</div>`;
  }

  // Update nav highlight
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const isActive = btn.dataset.page === `plugin:${pluginId}`;
    if (isActive) {
      btn.classList.remove('text-neutral-500', 'dark:text-neutral-400', 'hover:text-neutral-900', 'dark:hover:text-neutral-100', 'hover:bg-white/40', 'dark:hover:bg-neutral-800/40');
      btn.classList.add('bg-white/60', 'dark:bg-neutral-800/60', 'text-neutral-900', 'dark:text-neutral-100', 'shadow-sm', 'border', 'border-white/50', 'dark:border-neutral-700/50');
    } else {
      btn.classList.remove('bg-white/60', 'dark:bg-neutral-800/60', 'text-neutral-900', 'dark:text-neutral-100', 'shadow-sm', 'border', 'border-white/50', 'dark:border-neutral-700/50');
      btn.classList.add('text-neutral-500', 'dark:text-neutral-400', 'hover:text-neutral-900', 'dark:hover:text-neutral-100', 'hover:bg-white/40', 'dark:hover:bg-neutral-800/40');
    }
  });
};

// ── Init ────────────────────────────────────────────────────────
async function init() {
  // Auth disabled — always go straight to dashboard
  const user = await window.api.auth.getUser();
  window.AppState.currentUser = user || { email: 'Local User', isGuest: true };
  showDashboard();

  await window.ProviderManager.refreshLocal();
  AppRouter.updateModelDropdown();

  // Load plugin sidebar items
  await loadPluginSidebarItems();

  // Re-check provider status on chat page after models load
  if (window.ProviderManager.activeProvider) {
    const noProviderMsg = document.querySelector('#noProviderMsg');
    const sendBtn = document.querySelector('#sendBtn');
    if (noProviderMsg) noProviderMsg.classList.add('hidden');
    if (sendBtn) sendBtn.disabled = false;
  }

  // Poll Ollama status every 30s
  setInterval(async () => {
    await window.ProviderManager.refreshLocal();
    AppRouter.updateModelDropdown();

    if (window.ProviderManager.activeProvider) {
      const noProviderMsg = document.querySelector('#noProviderMsg');
      const sendBtn = document.querySelector('#sendBtn');
      if (noProviderMsg) noProviderMsg.classList.add('hidden');
      if (sendBtn && !sendBtn.closest('.hidden')) sendBtn.disabled = false;
    }
  }, 30000);
}

init();
