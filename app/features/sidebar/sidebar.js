// app/features/sidebar/sidebar.js
// ------------------------------------------------------------
// Sidebar behavior:
// - Toggle open/close (collapsed state) via the toggle button.
// - Syncs ARIA so screen readers understand state.
// - (Optional) Persists collapsed state to localStorage.
//
// CSS owns the visuals via `.sidebar.close`.
// ------------------------------------------------------------
(() => {
  "use strict";

  const app = window.MoveSyncApp;
  if (!app) {
    console.error("[sidebar] MoveSyncApp missing. Did namespace.js load?");
    return;
  }

  const { dom } = app;

  const STORAGE_KEY = "movesync-sidebar-collapsed";

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
      // Storage might be blocked; ignore.
    }
  }

  function setCollapsed(isCollapsed) {
    if (!dom?.sidebar) return;

    dom.sidebar.classList.toggle("close", isCollapsed);

    document.documentElement.style.setProperty(
      "--sidebar-width",
      isCollapsed ? "88px" : "250px"
    );

    // Accessibility: tell assistive tech what happened.
    // Expecting toggle button to be a <button> (or similar).
    if (dom.toggleBtn) {
      dom.toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
      dom.toggleBtn.setAttribute("aria-label", isCollapsed ? "Expand sidebar" : "Collapse sidebar");
    }

    safeSet(STORAGE_KEY, isCollapsed ? "1" : "0");
  }

  function getInitialCollapsed() {
    const stored = safeGet(STORAGE_KEY);

    // If user has a saved preference, obey it.
    if (stored === "1") return true;
    if (stored === "0") return false;

    // Otherwise, respect the HTML/CSS default (your <nav class="sidebar close">).
    return dom.sidebar?.classList.contains("close") ?? false;
  }

  function initSidebarToggle() {
    // Re-query in case the DOM cache was created before the shell became visible
    dom.sidebar = dom.sidebar || document.querySelector(".sidebar");
    dom.toggleBtn = dom.toggleBtn || document.querySelector(".sidebar header .toggle");

    if (!dom.sidebar || !dom.toggleBtn) {
      console.warn("[sidebar] Missing .sidebar or .toggle button in DOM.");
      return;
    }

    // Prevent double-binding if init is called more than once
    if (dom.toggleBtn.dataset.sidebarBound === "1") return;
    dom.toggleBtn.dataset.sidebarBound = "1";

    // Initial state (optional persistence)
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