// app/app-shell.js
// ------------------------------------------------------------
// App shell responsibilities (single-file core):
// 1) Create global namespaces (MoveSync, MoveSyncPages, MoveSyncApp)
// 2) Cache DOM references (app.dom)
// 3) Define per-page asset manifest (CSS + JS)
// 4) Router: hash-based navigation + HTML fetch injection
// 5) Asset loader: load CSS and page scripts with a clear lifecycle
// 6) Bootstrap: wire navigation + init features + first route
// ------------------------------------------------------------
(() => {
  "use strict";

  // ============================================================
  // 0) Constants
  // ============================================================
  const FORCE_DASH_KEY = "movesync-force-dashboard";
  const DASHBOARD_PAGE = "Dashboard";

  // ============================================================
  // 1) Global namespace
  // ============================================================
  window.MoveSync = window.MoveSync || {};
  window.MoveSyncPages = window.MoveSyncPages || {};

  const existingApp = window.MoveSyncApp;

  window.MoveSyncApp = existingApp || {
    state: {
      currentPageName: null,
      currentCssEl: null,

      // For scripts that truly should only be loaded once (libraries, workers, etc.)
      loadedScripts: new Set(),
    },
    isInitialized: false,
  };

  const app = window.MoveSyncApp;

  // ============================================================
  // 2) DOM helpers + dom cache
  // ============================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const dom = {
    body: document.body,
    sidebar: $(".sidebar"),
    toggleBtn: $(".sidebar header .toggle"),

    searchBox: $(".search-box"),
    searchInput: $(".search-box input"),

    themeSwitch: $("#themeSwitch"),
    modeText: $(".mode-text"),

    pageRoot: $("#pageRoot"),

    menuLinks: $$(".sidebar a[data-page][data-src]"),

    refreshMenuLinks() {
      dom.menuLinks = $$(".sidebar a[data-page][data-src]");
      return dom.menuLinks;
    },
  };

  app.dom = dom;

  // ============================================================
  // 3) Page manifest (CSS + JS)
  // ============================================================
  app.PAGE_ASSETS = {
    "Dashboard": {
      css: "app/navigation/dashboard/dashboard.css",
      js: { always: ["app/navigation/dashboard/dashboard.js"] },
    },

    "Upload": {
      css: "app/navigation/upload/upload.css",
      js: { always: ["app/navigation/upload/upload.js"] },
    },

    "Library": {
      css: "app/navigation/library/library.css",
      js: { always: ["app/navigation/library/library.js"] },
    },

    "Session Viewer": {
      css: "app/navigation/session-viewer/session-viewer.css",
      js: { always: ["app/navigation/session-viewer/session-viewer.js"] },
    },

    "Compare Sessions": {
      css: "app/navigation/compare-sessions/compare-sessions.css",
      js: { always: ["app/navigation/compare-sessions/compare-sessions.js"] },
    },

    "Tutorial": {
      css: "app/navigation/tutorial/tutorial.css",
      js: {
        always: [
          "app/navigation/tutorial/tutorials/tut.compare-sessions.js",
          "app/navigation/tutorial/tutorials/tut.session-viewer.js",
          "app/navigation/tutorial/tutorials/tut.library.js",
          "app/navigation/tutorial/tutorial.js",
        ],
      },
    },
  };

  app.getPageAssets = (pageName) => app.PAGE_ASSETS?.[pageName] || null;

  // ============================================================
  // 4) Asset loader (CSS + JS) + page lifecycle
  // ============================================================
  const { state } = app;

  const DEV_CACHE_BUST = false;

  function withCacheBust(url) {
    if (!DEV_CACHE_BUST || !url) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${Date.now()}`;
  }

  function toArray(v) {
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  }

  function callPageHook(pageName, methodNames) {
    const mod = window.MoveSyncPages?.[pageName];
    if (!mod) return;

    for (const name of methodNames) {
      if (typeof mod[name] === "function") {
        try {
          mod[name]();
        } catch (e) {
          console.warn(`[page] ${pageName}.${name}() failed:`, e);
        }
        return;
      }
    }
  }

  function unloadCurrentPage() {
    if (!state.currentPageName) return;
    callPageHook(state.currentPageName, ["unmount", "destroy"]);
    state.currentPageName = null;
  }

  function setPageCss(href) {
    if (state.currentCssEl) {
      state.currentCssEl.remove();
      state.currentCssEl = null;
    }
    if (!href) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = withCacheBust(href);
    link.dataset.pageCss = "true";

    document.head.appendChild(link);
    state.currentCssEl = link;
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (!src) return resolve();
      if (state.loadedScripts.has(src)) return resolve();

      const s = document.createElement("script");
      s.src = withCacheBust(src);
      s.dataset.pageScript = "true";
      s.async = false;

      s.onload = () => {
        state.loadedScripts.add(src);
        resolve();
      };
      s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.body.appendChild(s);
    });
  }

  async function loadScriptsOnce(list) {
    for (const src of toArray(list)) await loadScriptOnce(src);
  }

  function loadScriptAlways(src) {
    return new Promise((resolve, reject) => {
      if (!src) return resolve();

      const s = document.createElement("script");
      s.src = withCacheBust(src);
      s.dataset.pageScript = "true";
      s.async = false;

      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.body.appendChild(s);
    });
  }

  async function loadScriptsAlways(list) {
    for (const src of toArray(list)) await loadScriptAlways(src);
  }

  async function loadAssetsForPage(pageName) {
    if (!pageName) return;

    unloadCurrentPage();

    const assets = app.getPageAssets(pageName);

    try {
      setPageCss(assets?.css || null);
    } catch (e) {
      console.warn("[assets] CSS load failed:", pageName, e);
    }

    try {
      const js = assets?.js || {};
      await loadScriptsOnce(js.once || null);
      await loadScriptsAlways(js.always || js || null);
    } catch (e) {
      console.warn("[assets] Script load failed:", pageName, e);
      state.currentPageName = null;
      throw e;
    }

    document.dispatchEvent(
      new CustomEvent("movesync:page-loaded", { detail: { page: pageName, assets } })
    );

    callPageHook(pageName, ["mount", "init"]);
    state.currentPageName = pageName;
  }

  app.assets = {
    unloadCurrentPage,
    setPageCss,
    loadScriptOnce,
    loadAssetsForPage,
    destroyCurrentPage: unloadCurrentPage,
    loadPageScriptOnce: loadScriptOnce,
  };

  // ============================================================
  // 5) Router (hash-based)
  // ============================================================
  function setActive(link) {
    dom.menuLinks.forEach((a) => a.classList.remove("active"));
    if (link) link.classList.add("active");
  }

  function currentHashName() {
    const raw = location.hash.slice(1);
    return decodeURIComponent(raw || "");
  }

  function linkFromHash() {
    const hash = currentHashName();
    const match = dom.menuLinks.find((a) => (a.dataset.page || "") === hash) || null;
    return match || dom.menuLinks[0] || null;
  }

  function getPageMeta(link) {
    const name = (link?.dataset.page || link?.textContent || "").trim();
    const src = link?.dataset.src || "";
    return { name, src };
  }

  function getReadableFetchHint() {
    if (location.protocol === "file:") {
      return "Tip: open this site via a local server (not file://). Example: `python -m http.server`.";
    }
    return "";
  }

  async function loadPageFromLink(link) {
    if (!link || !dom.pageRoot) return;

    const { name, src } = getPageMeta(link);

    if (!src) {
      dom.pageRoot.innerHTML = `
        <div class="page-error">
          <div><strong>Missing data-src for page: ${name || "(unknown)"}</strong></div>
        </div>
      `;
      return;
    }

    dom.pageRoot.classList.add("page-loading");
    dom.pageRoot.innerHTML = "Loading...";

    try {
      const res = await fetch(src, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Could not load ${src} (${res.status})`);

      dom.pageRoot.innerHTML = await res.text();
      await app.assets.loadAssetsForPage(name);
    } catch (e) {
      app.assets.destroyCurrentPage();
      app.assets.setPageCss(null);

      const hint = getReadableFetchHint();
      const msg = e?.message || "Unknown error";

      dom.pageRoot.innerHTML = `
        <div class="page-error">
          <div><strong>${msg}</strong></div>
          ${hint ? `<div style="margin-top:8px;">${hint}</div>` : ""}
        </div>
      `;
    } finally {
      dom.pageRoot.classList.remove("page-loading");
    }
  }

  function handleRoute() {
    dom.refreshMenuLinks();

    const hash = currentHashName();
    const link = linkFromHash();
    if (!link) return;

    const { name } = getPageMeta(link);
    if (!name) return;

    if (hash && hash !== name) {
      location.hash = encodeURIComponent(name);
      return;
    }

    setActive(link);
    loadPageFromLink(link);
  }

  window.MoveSync.goToPage = (pageName) => {
    dom.refreshMenuLinks();
    const link = dom.menuLinks.find((a) => (a.dataset.page || "") === pageName);
    if (!link) return;

    const curr = currentHashName();
    if (curr !== pageName) {
      location.hash = encodeURIComponent(pageName);
    } else {
      handleRoute();
    }
  };

  app.router = { setActive, currentHashName, linkFromHash, handleRoute };

  // ============================================================
  // 6) Bootstrap (runs once)
  // ============================================================
  function getLinkRouteName(link) {
    return (link.dataset.page || link.textContent || "").trim();
  }

  function onNavClick(link, e) {
    e.preventDefault();
    const name = getLinkRouteName(link);
    if (!name) return;

    app.router.setActive(link);

    const current = app.router.currentHashName();
    if (current !== name) location.hash = encodeURIComponent(name);
    else app.router.handleRoute();
  }

  function initNavigation() {
    dom.refreshMenuLinks();

    if (!dom.menuLinks.length) {
      console.warn("[bootstrap] No sidebar links found.");
      return;
    }

    dom.menuLinks.forEach((link) => {
      link.addEventListener("click", (e) => onNavClick(link, e));
    });

    window.addEventListener("hashchange", () => app.router.handleRoute());
  }

  function initFirstLoad() {
    dom.refreshMenuLinks();

    // If user has started tracking before, ALWAYS open Dashboard on refresh/reload,
    // regardless of whatever hash was in the URL.
    const forceDash = localStorage.getItem(FORCE_DASH_KEY) === "1";
    if (forceDash) {
      const current = app.router.currentHashName();
      if (current !== DASHBOARD_PAGE) {
        location.hash = encodeURIComponent(DASHBOARD_PAGE);
        return; // hashchange will route
      }
    }

    const initialLink = app.router.linkFromHash();
    if (!initialLink) return;

    app.router.setActive(initialLink);

    const initialName = getLinkRouteName(initialLink);
    if (!initialName) return;

    if (!app.router.currentHashName()) {
      location.hash = encodeURIComponent(initialName);
      return;
    }

    app.router.handleRoute();
  }

  app.init = () => {
    if (app.isInitialized) return;
    app.isInitialized = true;

    initNavigation();

    if (window.MoveSyncSessionStore?.hydrateRuntimeFromDb) {
      window.MoveSyncSessionStore.hydrateRuntimeFromDb().catch((e) => {
        console.warn("[session-store] hydrate failed:", e);
      });
    }

    app.sidebar?.initSidebarToggle?.();
    app.theme?.initTheme?.();
    app.search?.initGlobalSearch?.();

    initFirstLoad();
    document.dispatchEvent(new CustomEvent("movesync:app-init"));
  };
})();