// app/features/theme/theme.js
// ------------------------------------------------------------
// Theme manager:
// - Persists theme choice (light/dark) to localStorage
// - Applies theme by toggling `body.dark`
//
// Accessibility:
// - Switch uses role="switch" + aria-checked
// - Supports click + Enter/Space
// ------------------------------------------------------------
(() => {
  "use strict";

  const app = window.MoveSyncApp;
  if (!app) {
    console.error("[theme] MoveSyncApp missing. Did namespace.js load?");
    return;
  }

  const { dom } = app;

  const THEME_KEY = "movesync-theme";
  const THEMES = { LIGHT: "light", DARK: "dark" };

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage might be blocked; theme still works for this session.
    }
  }

  function prefersDark() {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  }

  function getInitialTheme() {
    const saved = safeGet(THEME_KEY);
    if (saved === THEMES.DARK || saved === THEMES.LIGHT) return saved;
    // If user never chose, respect OS preference.
    return prefersDark() ? THEMES.DARK : THEMES.LIGHT;
  }

  function applyTheme(theme) {
    const isDark = theme === THEMES.DARK;

    dom.body?.classList.toggle("dark", isDark);

    // Text shows what you will switch TO (your existing behavior).
    if (dom.modeText) dom.modeText.textContent = isDark ? "Light mode" : "Dark mode";

    if (dom.themeSwitch) {
      dom.themeSwitch.setAttribute("aria-checked", String(isDark));
    }
  }

  function setTheme(theme) {
    safeSet(THEME_KEY, theme);
    applyTheme(theme);
  }

  function toggleTheme() {
    const isDark = dom.body?.classList.contains("dark");
    setTheme(isDark ? THEMES.LIGHT : THEMES.DARK);
  }

  function initTheme() {
    // Apply theme even if the switch is missing
    applyTheme(getInitialTheme());

    if (!dom.themeSwitch) return;

    dom.themeSwitch.addEventListener("click", toggleTheme);

    dom.themeSwitch.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleTheme();
      }
    });
  }

  app.theme = { initTheme };

  if (app.isInitialized) {
    initTheme();
  } else {
    document.addEventListener("movesync:app-init", initTheme, { once: true });
  }
})();