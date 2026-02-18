// =======================================
// Feature: Video Metadata panel
// File: app/navigation/session-viewer/video-metadata/video-metadata.js
// =======================================

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return "—";
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function buildPanelMarkup() {
    return `
      <div class="viewer-card-title">
        <i class="bx bx-info-circle" aria-hidden="true"></i>
        Video Metadata
      </div>

      <div class="viewer-meta">
        <div class="viewer-metaRow">
          <span class="viewer-metaLabel">Session</span>
          <span class="viewer-metaValue" data-field="name">—</span>
        </div>

        <div class="viewer-metaRow">
          <span class="viewer-metaLabel">Created</span>
          <span class="viewer-metaValue" data-field="created">—</span>
        </div>

        <div class="viewer-metaRow">
          <span class="viewer-metaLabel">Notes</span>
          <span class="viewer-metaValue" data-field="notes">—</span>
        </div>
      </div>
    `.trim();
  }

  function ensureMounted(mountId) {
    const mount = $(mountId);
    if (!mount) return null;

    // Avoid double-mounting if create() is called multiple times
    if (!mount.dataset.mounted) {
      mount.innerHTML = buildPanelMarkup();
      mount.dataset.mounted = "1";
    }
    return mount;
  }

  function create({ getActiveSession, mountId = "viewerMetaPanelMount" } = {}) {
    function render(session) {
      // Ensure DOM exists before trying to fill values
      const mount = ensureMounted(mountId);
      if (!mount) return;

      const s =
        session ??
        (typeof getActiveSession === "function" ? getActiveSession() : null);

      const nameEl = mount.querySelector('[data-field="name"]');
      const createdEl = mount.querySelector('[data-field="created"]');
      const notesEl = mount.querySelector('[data-field="notes"]');

      if (!s) {
        if (nameEl) nameEl.textContent = "—";
        if (createdEl) createdEl.textContent = "—";
        if (notesEl) notesEl.textContent = "—";
        return;
      }

      const name = s.name || `Session #${s.id ?? "—"}`;
      const created = fmtDate(s.createdAt || s.created || s.createdISO);
      const notes = s.notes || "—";

      if (nameEl) nameEl.textContent = name;
      if (createdEl) createdEl.textContent = created;
      if (notesEl) notesEl.textContent = notes;
    }

    function wire(signal) {
      // Mount immediately so the panel appears even before a session is selected
      ensureMounted(mountId);
      render();

      document.addEventListener(
        "movesync:active-session-changed",
        (e) => render(e?.detail?.session || null),
        { signal }
      );

      document.addEventListener(
        "movesync:sessions-changed",
        () => render(),
        { signal }
      );
    }

    return { render, wire };
  }

  window.MoveSyncViewerVideoMetadata = { create };
})();