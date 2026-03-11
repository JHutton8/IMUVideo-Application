// ============================
// Dashboard page controller (Projects -> Sessions)
// File: app/navigation/dashboard/dashboard.js
// ============================

(() => {
  const PAGE_NAME = "Dashboard";

  const LAST_VISIT_KEY = "movesync:last-visit";
  const LAST_ACTIVITY_KEY = "movesync:last-activity";

  const $ = (id) => document.getElementById(id);

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

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function store() {
    return window.MoveSyncSessionStore || null;
  }

  async function hydrate() {
    try {
      await store()?.hydrateRuntimeFromDb?.();
    } catch (e) {
      console.warn("[Dashboard] hydrateRuntimeFromDb failed:", e);
    }
  }

  function getProjectsSafe() {
    const s = store();
    const projects = s?.getProjects?.();
    return Array.isArray(projects) ? projects : [];
  }

  function collectSessionsAcrossProjects(projects) {
    const rows = [];

    for (const p of projects) {
      const sessions = Array.isArray(p?.sessions) ? p.sessions : [];
      for (const sess of sessions) {
        rows.push({
          projectId: p?.id,
          projectName: p?.name || "Untitled project",
          sessionId: sess?.id,
          sessionName: sess?.name || "Untitled session",
          when:
            sess?.updatedAt ||
            sess?.createdAt ||
            p?.updatedAt ||
            p?.createdAt ||
            "",
        });
      }
    }

    // newest first
    rows.sort((a, b) => (Date.parse(b.when) || 0) - (Date.parse(a.when) || 0));
    return rows;
  }

  function estimateLocalStorageUsageKB() {
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) || "";
      bytes += (k.length + v.length) * 2; // UTF-16 approx
    }
    return Math.max(1, Math.round(bytes / 1024));
  }

  function renderRecents(recentRows) {
    const root = $("dashRecents");
    if (!root) return;

    if (!recentRows.length) {
      return; // keep empty-state markup in HTML
    }

    const top = recentRows.slice(0, 5);

    root.innerHTML = top
      .map((r) => {
        const when = r.when ? new Date(r.when) : null;
        const whenTxt =
          when && !isNaN(when.getTime())
            ? `${formatDate(when)} · ${formatTime(when)}`
            : "No date";

        const title = `${r.sessionName}`;
        const meta = `${r.projectName}  ·  ${whenTxt}`;

        return `
          <div class="dash-recent"
               data-open-viewer="true"
               data-project-id="${escapeHtml(String(r.projectId ?? ""))}"
               data-session-id="${escapeHtml(String(r.sessionId ?? ""))}">
            <div>
              <div class="dash-recentTitle">${escapeHtml(title)}</div>
              <div class="dash-recentMeta">${escapeHtml(meta)}</div>
            </div>
            <div class="dash-pill">session</div>
          </div>
        `;
      })
      .join("");
  }

  function computeLastActivity(projects, recentRows) {
    // Prefer explicit "movesync:last-activity" if present
    const explicit = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (explicit) {
      const d = new Date(explicit);
      if (!isNaN(d.getTime())) return d;
    }

    // Otherwise use newest session date if any
    const newestRow = recentRows[0];
    if (newestRow?.when) {
      const d = new Date(newestRow.when);
      if (!isNaN(d.getTime())) return d;
    }

    // Otherwise use newest project updatedAt/createdAt
    let best = null;
    for (const p of projects) {
      const iso = p?.updatedAt || p?.createdAt || "";
      const t = Date.parse(iso) || 0;
      if (!t) continue;
      if (!best || t > best.getTime()) best = new Date(t);
    }
    if (best) return best;

    // Finally, fallback to last-visit
    const lastVisit = localStorage.getItem(LAST_VISIT_KEY);
    if (lastVisit) {
      const d = new Date(lastVisit);
      if (!isNaN(d.getTime())) return d;
    }

    return null;
  }

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

    // Clicking a recent item -> set active session (project+session) then open viewer
    const recentsRoot = $("dashRecents");
    recentsRoot?.addEventListener(
      "click",
      (e) => {
        const card = e.target.closest?.("[data-open-viewer='true']");
        if (!card) return;

        const projectId = card.getAttribute("data-project-id");
        const sessionId = card.getAttribute("data-session-id");
        if (!projectId || !sessionId) {
          window.MoveSync?.goToPage?.("Session Viewer");
          return;
        }

        try {
          store()?.setActiveSession?.(projectId, sessionId);
        } catch (err) {
          console.warn("[Dashboard] setActiveSession failed:", err);
        }

        window.MoveSync?.goToPage?.("Session Viewer");
      },
      { signal: controller.signal }
    );
  }

  async function initDashboard() {
    await hydrate();

    // Header date/time
    const now = new Date();
    setText("dashDate", `${formatDate(now)} · ${formatTime(now)}`);

    const projects = getProjectsSafe();
    const recentRows = collectSessionsAcrossProjects(projects);

    const projectCount = projects.length;
    const sessionCount = recentRows.length;

    setText("kpiProjects", String(projectCount));
    setText(
      "kpiProjectsMeta",
      projectCount ? "Organize sessions by project" : "Create or import a project"
    );

    setText("kpiSessions", String(sessionCount));
    setText(
      "kpiSessionsMeta",
      sessionCount ? "Ready to view & compare" : "Upload to get started"
    );

    renderRecents(recentRows);

    const last = computeLastActivity(projects, recentRows);
    if (last) {
      setText("kpiLastActivity", formatDate(last));
      setText("kpiLastActivityMeta", `at ${formatTime(last)}`);
    } else {
      setText("kpiLastActivity", "—");
      setText("kpiLastActivityMeta", "No activity recorded yet");
    }

    // Update last-visit now
    localStorage.setItem(LAST_VISIT_KEY, now.toISOString());

    // Local storage KPI
    setText("kpiStorage", `${estimateLocalStorageUsageKB()} KB`);
  }

  // Register module for your router
  window.MoveSyncPages = window.MoveSyncPages || {};
  window.MoveSyncPages[PAGE_NAME] = {
    _controller: null,

    init() {
      this._controller?.abort?.();
      this._controller = new AbortController();

      initDashboard();
      wireNavButtons(this._controller);

      // Keep dashboard live if projects change elsewhere
      document.addEventListener(
        "movesync:projects-changed",
        () => initDashboard(),
        { signal: this._controller.signal }
      );
    },

    destroy() {
      this._controller?.abort?.();
      this._controller = null;
    },
  };
})();