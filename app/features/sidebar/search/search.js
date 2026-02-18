// app/features/search/search.js
// ------------------------------------------------------------
// In-page search (Ctrl+F style) for the currently loaded page content.
// Highlights matches inside dom.pageRoot using <mark> tags.
//
// Controls:
// - Enter: next match
// - Shift+Enter: previous match
// - Escape: clear query + highlights
//
// Re-runs automatically when a new page is loaded (movesync:page-loaded).
// ------------------------------------------------------------
(() => {
  "use strict";

  const app = window.MoveSyncApp;
  if (!app) {
    console.error("[search] MoveSyncApp missing. Did namespace.js load?");
    return;
  }

  const { dom } = app;

  function initGlobalSearch() {
    const searchBox = dom.searchBox;
    const searchInput = dom.searchInput;
    const pageRoot = dom.pageRoot;

    if (!searchBox || !searchInput || !pageRoot) return;

    const prevBtn = searchBox.querySelector(".search-prev");
    const nextBtn = searchBox.querySelector(".search-next");
    const countEl = searchBox.querySelector(".search-count");
    const controlsEl = searchBox.querySelector(".search-controls");

    // Measure text width so input can auto-expand.
    const measurer = document.createElement("span");
    measurer.style.position = "fixed";
    measurer.style.left = "-9999px";
    measurer.style.top = "-9999px";
    measurer.style.whiteSpace = "pre";
    measurer.style.visibility = "hidden";
    document.body.appendChild(measurer);

    let marks = [];
    let activeIndex = -1;
    let debounceTimer = null;

    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

    function syncMeasurerStyle() {
      const cs = getComputedStyle(searchInput);
      measurer.style.font = cs.font;
      measurer.style.letterSpacing = cs.letterSpacing;
    }

    function setControlsVisible(isVisible) {
      controlsEl?.classList.toggle("is-visible", isVisible);
    }

    function updateCounter() {
      const total = marks.length;
      const current = total ? activeIndex + 1 : 0;
      if (countEl) countEl.textContent = `${current}/${total}`;
    }

    function unwrapMark(markEl) {
      // Replace <mark> with its text content and keep DOM sane.
      markEl.replaceWith(document.createTextNode(markEl.textContent || ""));
    }

    function clearHighlights() {
      pageRoot.querySelectorAll("mark.ms-find-mark").forEach(unwrapMark);
      pageRoot.normalize(); // merges adjacent text nodes => avoids fragmentation
      marks = [];
      activeIndex = -1;
      updateCounter();
    }

    function setActiveMark(index) {
      if (!marks.length) return;

      marks.forEach((m) => m.classList.remove("ms-find-active"));

      activeIndex = ((index % marks.length) + marks.length) % marks.length;
      const m = marks[activeIndex];

      m.classList.add("ms-find-active");
      m.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

      updateCounter();
    }

    function jump(delta) {
      if (!marks.length) return;
      setActiveMark(activeIndex + delta);
    }

    function highlightAll(query) {
      clearHighlights();
      if (!query) return;

      const qLower = query.toLowerCase();

      // Walk only text nodes inside pageRoot, skipping inputs/scripts/etc.
      const walker = document.createTreeWalker(
        pageRoot,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const value = node.nodeValue;
            if (!value || !value.trim()) return NodeFilter.FILTER_REJECT;

            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;

            const tag = parent.tagName?.toLowerCase();
            if (
              tag === "script" ||
              tag === "style" ||
              tag === "textarea" ||
              tag === "input" ||
              parent.isContentEditable
            ) {
              return NodeFilter.FILTER_REJECT;
            }

            // Avoid nesting marks.
            if (parent.closest("mark.ms-find-mark")) return NodeFilter.FILTER_REJECT;

            return NodeFilter.FILTER_ACCEPT;
          },
        },
        false
      );

      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      for (const node of textNodes) {
        const text = node.nodeValue;
        const lower = text.toLowerCase();

        let start = 0;
        let idx = lower.indexOf(qLower, start);
        if (idx === -1) continue;

        const frag = document.createDocumentFragment();

        while (idx !== -1) {
          if (idx > start) frag.appendChild(document.createTextNode(text.slice(start, idx)));

          const mark = document.createElement("mark");
          mark.className = "ms-find-mark";
          mark.textContent = text.slice(idx, idx + query.length);

          frag.appendChild(mark);
          marks.push(mark);

          start = idx + query.length;
          idx = lower.indexOf(qLower, start);
        }

        if (start < text.length) frag.appendChild(document.createTextNode(text.slice(start)));

        node.parentNode.replaceChild(frag, node);
      }

      if (marks.length) setActiveMark(0);
      else updateCounter();
    }

    function autoExpandInput() {
      syncMeasurerStyle();

      const value = searchInput.value || searchInput.placeholder || "";
      measurer.textContent = value;

      const textWidth = measurer.getBoundingClientRect().width;

      const padding = 28;
      const minW = 160;

      const inputLeft = searchInput.getBoundingClientRect().left;
      const maxW = Math.max(minW, window.innerWidth - inputLeft - 24);

      const nextW = clamp(Math.ceil(textWidth + padding), minW, maxW);
      searchInput.style.width = `${nextW}px`;

      // Keep controls aligned with expanded input.
      if (controlsEl) {
        controlsEl.style.left = `calc(60px + ${nextW}px + 8px)`;
      }
    }

    function runSearchNow() {
      const q = searchInput.value.trim();
      const hasQuery = q.length > 0;

      setControlsVisible(hasQuery);
      highlightAll(q);
      autoExpandInput();
    }

    function runSearchDebounced() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearchNow, 120);
    }

    // Clicking search container expands sidebar and focuses input.
    searchBox.addEventListener("click", () => {
      // Open sidebar using the official sidebar API (keeps ARIA + storage in sync)
      if (app.sidebar?.open) app.sidebar.open();
      else dom.sidebar?.classList.remove("close"); // fallback if sidebar module didn't load

      searchInput.focus();
    });

    searchInput.addEventListener("input", () => {
      autoExpandInput();
      runSearchDebounced();
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.shiftKey ? jump(-1) : jump(1);
      }

      if (e.key === "Escape") {
        searchInput.value = "";
        autoExpandInput();
        setControlsVisible(false);
        clearHighlights();
      }
    });

    prevBtn?.addEventListener("click", () => jump(-1));
    nextBtn?.addEventListener("click", () => jump(1));

    // When a new page is injected, re-run search so highlights match new content.
    document.addEventListener("movesync:page-loaded", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearchNow, 0);
    });

    window.addEventListener("resize", autoExpandInput);

    // Cleanup measurer if needed (optional)
    window.addEventListener("pagehide", () => measurer.remove(), { once: true });

    // Initial UI state
    autoExpandInput();
    updateCounter();
    setControlsVisible(false);
  }

  app.search = { initGlobalSearch };

  if (app.isInitialized) {
    initGlobalSearch();
  } else {
    document.addEventListener("movesync:app-init", initGlobalSearch, { once: true });
  }
})();