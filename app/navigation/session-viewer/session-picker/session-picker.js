// =======================================
// MoveSync component: Session Picker
// File: pages/session-viewer/session-picker/session-picker.js
// =======================================

(() => {
  "use strict";

  function createSessionPicker({
    selectId,
    getSessions,
    getActiveSession,
    setActiveSessionById,
    escapeHtml,
  }) {
    const $ = (id) => document.getElementById(id);

    function render() {
      const select = $(selectId);
      if (!select) return;

      const sessions = (typeof getSessions === "function" ? getSessions() : []) || [];
      const active = typeof getActiveSession === "function" ? getActiveSession() : null;
      const activeId = active ? String(active.id) : "";

      const safe = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s ?? "");

      const options = [];
      options.push(
        `<option value="">${sessions.length ? "Select a session…" : "No sessions"}</option>`
      );

      sessions.forEach((s) => {
        const id = String(s.id);
        const name = safe(s.name || "Untitled session");
        options.push(`<option value="${id}">#${id} — ${name}</option>`);
      });

      select.innerHTML = options.join("");
      select.value = activeId;
    }

    function wire(signal) {
      const select = $(selectId);
      if (!select) return;

      select.addEventListener(
        "change",
        () => {
          const v = select.value;
          if (!v) return;
          if (typeof setActiveSessionById === "function") setActiveSessionById(v);
        },
        { signal }
      );

      document.addEventListener(
        "movesync:active-session-changed",
        () => {
          const active = typeof getActiveSession === "function" ? getActiveSession() : null;
          select.value = active ? String(active.id) : "";
        },
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

  // Global export
  window.MoveSyncSessionPicker = {
    create: createSessionPicker,
  };
})();