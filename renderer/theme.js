// Theme manager — manual light/dark toggle, persisted to localStorage

const ThemeManager = {
  _current: 'light',

  init() {
    const saved = localStorage.getItem('iimagine-theme');
    this._current = saved === 'dark' ? 'dark' : 'light';
    this._apply();
  },

  get current() {
    return this._current;
  },

  toggle() {
    this._current = this._current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('iimagine-theme', this._current);
    this._apply();
  },

  set(theme) {
    this._current = theme === 'dark' ? 'dark' : 'light';
    localStorage.setItem('iimagine-theme', this._current);
    this._apply();
  },

  _apply() {
    const html = document.documentElement;
    if (this._current === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }
};

window.ThemeManager = ThemeManager;

// Initialize immediately so there's no flash
ThemeManager.init();
