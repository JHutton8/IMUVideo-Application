// ============================
// Dashboard page controller
// File: app/navigation/dashboard/dashboard.js
// ============================

(() => {
  const PAGE_NAME = "Dashboard";

  // Possible session storage keys across versions / pages.
  // Dashboard will "best-effort" read whichever exists.
  const SESSION_KEYS = [
    "movesync:sessions",
    "movesync-sessions",
    "MoveSync:sessions",
    "sessions",
  ];

  const LAST_VISIT_KEY = "movesync:last-visit";
  const LAST_ACTIVITY_KEY = "movesync:last-activity";

  // Small helper to get DOM elements by id
  function $(id) {
    return document.getElementById(id);
  }

  function formatDate(d) {
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function formatTime(d) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function tryParseJSON(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  /**
   * Attempts to load sessions from localStorage using a list of possible keys.
   * Supports either:
   *   - Array directly:  [ {...}, {...} ]
   *   - Object wrapper:  { sessions: [ ... ] }
   */
  function loadSessionsFromStorage() {
    for (const key of SESSION_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const parsed = tryParseJSON(raw);

      if (Array.isArray(parsed)) return { key, sessions: parsed };
      if (parsed && Array.isArray(parsed.sessions)) return { key, sessions: parsed.sessions };
    }
    return { key: null, sessions: [] };
  }

  /**
   * Rough estimate of localStorage usage (UTF-16 approximation).
   * Good enough for a KPI-style display.
   */
  function estimateLocalStorageUsageKB() {
    let bytes = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;

      const v = localStorage.getItem(k) || "";
      bytes += (k.length + v.length) * 2;
    }

    // Never show 0 KB (looks odd). If storage is empty-ish, show 1 KB.
    return Math.max(1, Math.round(bytes / 1024));
  }

  /**
   * Renders up to 5 most recent sessions into the "Recent sessions" panel.
   * If there are no sessions, we keep the static HTML empty-state already in the page.
   */
  function renderRecents(sessions) {
    const root = $("dashRecents");
    if (!root) return;

    if (!sessions || sessions.length === 0) {
      return; // keep the empty state markup
    }

    // Copy so we don't mutate the original array
    const copy = sessions.slice();

    // Best-effort sort by a date-like field, falling back to original order
    copy.sort((a, b) => {
      const da = Date.parse(a?.updatedAt || a?.date || a?.createdAt || "") || 0;
      const db = Date.parse(b?.updatedAt || b?.date || b?.createdAt || "") || 0;
      return db - da;
    });

    const recent = copy.slice(0, 5);

    root.innerHTML = recent
      .map((s, idx) => {
        const title =
          s?.name ||
          s?.title ||
          s?.sessionName ||
          `Session ${String(idx + 1).padStart(2, "0")}`;

        const whenRaw = s?.updatedAt || s?.date || s?.createdAt || "";
        const when = whenRaw ? new Date(whenRaw) : null;

        const metaParts = [];
        if (when && !isNaN(when.getTime())) {
          metaParts.push(`${formatDate(when)} · ${formatTime(when)}`);
        }
        if (s?.subject) metaParts.push(String(s.subject));
        if (s?.label) metaParts.push(String(s.label));
        if (s?.duration) metaParts.push(`Duration: ${String(s.duration)}`);

        const meta = metaParts.length ? metaParts.join("  ·  ") : "No metadata available yet";
        const badge = s?.type || s?.source || "session";

        return `
          <div class="dash-recent" data-open-viewer="true">
            <div>
              <div class="dash-recentTitle">${escapeHtml(title)}</div>
              <div class="dash-recentMeta">${escapeHtml(meta)}</div>
            </div>
            <div class="dash-pill">${escapeHtml(String(badge))}</div>
          </div>
        `;
      })
      .join("");
  }

  // Prevent HTML injection when rendering dynamic session metadata.
  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /**
   * Wire all navigation buttons that use data-goto="Page Name".
   * Also lets the user click a recent card to go to Session Viewer.
   */
  function wireNavButtons(controller) {
    const buttons = Array.from(document.querySelectorAll("[data-goto]"));

    buttons.forEach((btn) => {
      const onClick = () => {
        const page = btn.getAttribute("data-goto");
        if (!page) return;
        window.MoveSync?.goToPage?.(page);
      };
      btn.addEventListener("click", onClick, { signal: controller.signal });
    });

    // Clicking a recent item -> open Session Viewer (generic for now)
    const recentsRoot = $("dashRecents");
    if (recentsRoot) {
      recentsRoot.addEventListener(
        "click",
        (e) => {
          const card = e.target.closest?.("[data-open-viewer='true']");
          if (!card) return;
          window.MoveSync?.goToPage?.("Session Viewer");
        },
        { signal: controller.signal }
      );
    }
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function initDashboard() {
    // Header date/time
    const now = new Date();
    setText("dashDate", `${formatDate(now)} · ${formatTime(now)}`);

    // Sessions + recents panel
    const { sessions } = loadSessionsFromStorage();
    setText("kpiSessions", sessions.length ? String(sessions.length) : "0");
    setText("kpiSessionsMeta", sessions.length ? "Ready to view & compare" : "Upload to get started");

    renderRecents(sessions);

    // Last visit (fallback if no explicit last-activity exists)
    const lastVisit = localStorage.getItem(LAST_VISIT_KEY);
    if (lastVisit) {
      const d = new Date(lastVisit);
      if (!isNaN(d.getTime())) {
        setText("kpiLastActivity", formatDate(d));
        setText("kpiLastActivityMeta", `Last visit at ${formatTime(d)}`);
      }
    } else {
      setText("kpiLastActivity", "—");
      setText("kpiLastActivityMeta", "No activity recorded yet");
    }

    // Update last-visit now
    localStorage.setItem(LAST_VISIT_KEY, now.toISOString());

    // If other pages write "movesync:last-activity", show that instead
    const lastAct = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (lastAct) {
      const d = new Date(lastAct);
      if (!isNaN(d.getTime())) {
        setText("kpiLastActivity", formatDate(d));
        setText("kpiLastActivityMeta", `Last activity at ${formatTime(d)}`);
      }
    }

    // Local storage KPI
    setText("kpiStorage", `${estimateLocalStorageUsageKB()} KB`);
  }

  // Register module for your router
  window.MoveSyncPages = window.MoveSyncPages || {};
  window.MoveSyncPages[PAGE_NAME] = {
    _controller: null,

    init() {
      // Abort previous listeners if re-entering the page
      this._controller?.abort?.();
      this._controller = new AbortController();

      initDashboard();
      wireNavButtons(this._controller);
    },

    destroy() {
      this._controller?.abort?.();
      this._controller = null;
    },
  };
})();