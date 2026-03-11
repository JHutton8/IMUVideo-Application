// app/features/sidebar/sidebar.js
// ------------------------------------------------------------
// Sidebar behavior:
// - Toggle open/close (collapsed state) via the toggle button.
// - Syncs ARIA so screen readers understand state.
// - Persists collapsed state to localStorage.
//
// CSS owns layout width via body.sidebar-collapsed + --sidebar-width.
// CSS owns visuals via .sidebar.close.
// ------------------------------------------------------------
(() => {
  "use strict";

  const app = window.MoveSyncApp;
  if (!app) {
    console.error("[sidebar] MoveSyncApp missing.");
    return;
  }

  const { dom } = app;

  const STORAGE_KEY = "movesync-sidebar-collapsed";

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  }

  function setCollapsed(isCollapsed) {
    if (!dom?.sidebar) return;

    // Visual state
    dom.sidebar.classList.toggle("close", isCollapsed);

    // Global state (layout reads this; no inline style needed)
    dom.body?.classList.toggle("sidebar-collapsed", isCollapsed);

    // Accessibility
    if (dom.toggleBtn) {
      dom.toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
      dom.toggleBtn.setAttribute(
        "aria-label",
        isCollapsed ? "Expand sidebar" : "Collapse sidebar"
      );
    }

    safeSet(STORAGE_KEY, isCollapsed ? "1" : "0");
  }

  function getInitialCollapsed() {
    const stored = safeGet(STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;

    // If no stored preference, respect initial DOM state
    return dom.sidebar?.classList.contains("close") ?? false;
  }

  function initSidebarToggle() {
    dom.sidebar = dom.sidebar || document.querySelector(".sidebar");
    dom.toggleBtn = dom.toggleBtn || document.querySelector(".sidebar header .toggle");

    if (!dom.sidebar || !dom.toggleBtn) {
      console.warn("[sidebar] Missing .sidebar or .toggle button in DOM.");
      return;
    }

    if (dom.toggleBtn.dataset.sidebarBound === "1") return;
    dom.toggleBtn.dataset.sidebarBound = "1";

    setCollapsed(getInitialCollapsed());

    dom.toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const isCollapsed = dom.sidebar.classList.contains("close");
      setCollapsed(!isCollapsed);
    });
  }

  app.sidebar = {
    initSidebarToggle,
    setCollapsed,
    open: () => setCollapsed(false),
    close: () => setCollapsed(true),
  };

  if (app.isInitialized) {
    initSidebarToggle();
  } else {
    document.addEventListener("movesync:app-init", initSidebarToggle, { once: true });
  }
})();