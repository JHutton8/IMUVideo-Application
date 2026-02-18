(() => {
  const PAGE_NAME = "Library";
  const $ = (id) => document.getElementById(id);

  let controller = null;

  function getRuntime() {
    window.MoveSyncRuntime = window.MoveSyncRuntime || {};
    window.MoveSyncRuntime.sessions = window.MoveSyncRuntime.sessions || [];
    window.MoveSyncRuntime.nextSessionId = window.MoveSyncRuntime.nextSessionId || 1;
    return window.MoveSyncRuntime;
  }

  function getSessions() {
    return getRuntime().sessions;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString(); } catch { return ""; }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderCount(n) {
    const el = $("libCount");
    if (el) el.textContent = `${n} session${n === 1 ? "" : "s"}`;
  }

  function renderList(sessions) {
    const list = $("libList");
    const empty = $("libEmpty");
    if (!list || !empty) return;

    if (!sessions.length) {
      list.innerHTML = "";
      empty.hidden = false;
      renderCount(0);
      return;
    }

    empty.hidden = true;
    renderCount(sessions.length);

    list.innerHTML = sessions.map((s) => {
      const title = escapeHtml(s.name || "Untitled session");
      const notes = escapeHtml(s.notes || "");
      const created = escapeHtml(fmtDate(s.createdAt) || "");
      const sid = escapeHtml(String(s.id));
      const videoName = escapeHtml(s.videoFile?.name || "—");
      const imuName = escapeHtml(s.imuFile?.name || "—");

      return `
        <article class="lib-card" data-id="${sid}">
          <div class="lib-card-head">
            <div>
              <h3 class="lib-card-title">#${sid} — ${title}</h3>
              <div class="lib-card-sub">${created}</div>
            </div>
          </div>

          <div class="lib-chipRow">
            <span class="lib-chip"><i class="bx bx-video" aria-hidden="true"></i> ${videoName}</span>
            <span class="lib-chip"><i class="bx bx-spreadsheet" aria-hidden="true"></i> ${imuName}</span>
          </div>

          ${notes
            ? `<div class="lib-card-notes">${notes}</div>`
            : `<div class="lib-card-notes" style="opacity:.6">No notes</div>`}

          <div class="lib-card-actions">
            <button class="btn btn-primary" type="button" data-action="view">
              <i class="bx bx-video" aria-hidden="true"></i>
              View
            </button>
            <button class="btn btn-ghost" type="button" data-action="delete">
              <i class="bx bx-trash" aria-hidden="true"></i>
              Delete
            </button>
          </div>
        </article>
      `;
    }).join("");
  }

  function applyFilterAndRender() {
    const q = ($("libSearchInput")?.value || "").trim().toLowerCase();
    const sessions = getSessions();

    const filtered = !q ? sessions : sessions.filter((s) => {
      const name = (s.name || "").toLowerCase();
      const notes = (s.notes || "").toLowerCase();
      const v = (s.videoFile?.name || "").toLowerCase();
      const imu = (s.imuFile?.name || "").toLowerCase();
      const id = String(s.id || "").toLowerCase();
      return name.includes(q) || notes.includes(q) || v.includes(q) || imu.includes(q) || id.includes(q);
    });

    renderList(filtered);
  }

  async function deleteSession(sessionId) {
    const rt = getRuntime();
    const idx = rt.sessions.findIndex(s => String(s.id) === String(sessionId));
    if (idx === -1) return;

    rt.sessions.splice(idx, 1);

    if (rt.activeSession && String(rt.activeSession.id) === String(sessionId)) {
      rt.activeSession = null;
      document.dispatchEvent(new CustomEvent("movesync:active-session-changed", { detail: { session: null, at: Date.now() } }));
    }

    document.dispatchEvent(new CustomEvent("movesync:sessions-changed", { detail: { at: Date.now() } }));
    applyFilterAndRender();
  }

  async function clearAll() {
    const rt = getRuntime();
    if (!rt.sessions.length) return;

    const ok = confirm("Delete all sessions? (Memory only — refreshing already clears them.)");
    if (!ok) return;

    rt.sessions = [];
    rt.activeSession = null;

    document.dispatchEvent(new CustomEvent("movesync:sessions-changed", { detail: { at: Date.now() } }));
    document.dispatchEvent(new CustomEvent("movesync:active-session-changed", { detail: { session: null, at: Date.now() } }));

    applyFilterAndRender();
  }

  function setActiveSessionById(id) {
    const rt = getRuntime();
    const session = rt.sessions.find(s => String(s.id) === String(id)) || null;
    rt.activeSession = session;

    document.dispatchEvent(
      new CustomEvent("movesync:active-session-changed", {
        detail: { session, at: Date.now() },
      })
    );
  }

  function wireEvents() {
    $("libGoUpload")?.addEventListener("click", () => {
      window.MoveSync?.goToPage?.("Upload Session");
    }, { signal: controller.signal });

    $("libEmptyUpload")?.addEventListener("click", () => {
      window.MoveSync?.goToPage?.("Upload Session");
    }, { signal: controller.signal });

    $("libClearAll")?.addEventListener("click", clearAll, { signal: controller.signal });

    $("libSearchInput")?.addEventListener("input", applyFilterAndRender, { signal: controller.signal });

    $("libList")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const card = e.target.closest(".lib-card");
      const id = card?.dataset?.id;
      if (!id) return;

      const action = btn.dataset.action;

      if (action === "view") {
        setActiveSessionById(id);
        window.MoveSync?.goToPage?.("Session Viewer");
      }

      if (action === "delete") {
        const ok = confirm("Delete this session?");
        if (!ok) return;
        await deleteSession(id);
      }
    }, { signal: controller.signal });

    document.addEventListener("movesync:sessions-changed", () => applyFilterAndRender(), { signal: controller.signal });
  }

  function init() {
    controller?.abort?.();
    controller = new AbortController();

    wireEvents();
    applyFilterAndRender();
  }

  function destroy() {
    controller?.abort?.();
    controller = null;
  }

  window.MoveSyncPages = window.MoveSyncPages || {};
  window.MoveSyncPages[PAGE_NAME] = { init, destroy };
})();