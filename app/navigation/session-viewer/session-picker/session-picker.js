// =======================================
// MoveSync component: Session Picker (Project -> Session)
// File: app/navigation/session-viewer/session-picker/session-picker.js
// =======================================

(() => {
  "use strict";

  function createProjectSessionPicker({
    projectSelectId,
    sessionSelectId,
    getProjects,
    getActiveSession,
    setActiveSession,
    escapeHtml,
  }) {
    const $ = (id) => document.getElementById(id);
    const safe = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s ?? "");

    function normalizeProjects() {
      const projects = (typeof getProjects === "function" ? getProjects() : []) || [];
      return Array.isArray(projects) ? projects : [];
    }

    function getActiveProjectIdFromActiveSession() {
      const active = typeof getActiveSession === "function" ? getActiveSession() : null;
      const pid = active?.projectId ?? active?.project?.id ?? null;
      return pid != null ? String(pid) : "";
    }

    function getActiveSessionId() {
      const active = typeof getActiveSession === "function" ? getActiveSession() : null;
      return active?.id != null ? String(active.id) : "";
    }

    function findProjectById(projects, projectId) {
      return projects.find((p) => String(p?.id) === String(projectId));
    }

    function getSessionsForProject(projectId) {
      const projects = normalizeProjects();
      const p = projectId ? findProjectById(projects, projectId) : null;
      const direct = Array.isArray(p?.sessions) ? p.sessions : [];

      if (direct.length) return direct;

      // Fallback: ask the store (handles legacy flat sessions that still have projectId)
      try {
        const store = window.MoveSyncSessionStore;
        const fromStore = store?.getSessionsForProject?.(projectId);
        if (Array.isArray(fromStore) && fromStore.length) return fromStore;

        // Legacy fallback: filter flat sessions if they carry projectId
        const flat = store?.getSessions?.();
        if (Array.isArray(flat)) {
          const pid = String(projectId ?? "");
          return flat.filter((s) => String(s?.projectId ?? s?.project?.id ?? "") === pid);
        }
      } catch (e) {
        console.warn("[SessionPicker] getSessionsForProject fallback failed:", e);
      }

      return [];
    }

    function renderProjects() {
      const projectSelect = $(projectSelectId);
      if (!projectSelect) return;

      const projects = normalizeProjects();
      const activePid = getActiveProjectIdFromActiveSession();

      const opts = [];
      opts.push(`<option value="">${projects.length ? "Select a project…" : "No projects"}</option>`);

      projects.forEach((p) => {
        const pid = String(p?.id ?? "");
        const name = safe(p?.name || "Untitled project");
        opts.push(`<option value="${safe(pid)}">#${safe(pid)} — ${name}</option>`);
      });

      projectSelect.innerHTML = opts.join("");

      // keep selection if possible
      if (activePid && projects.some((p) => String(p?.id) === activePid)) {
        projectSelect.value = activePid;
      } else {
        projectSelect.value = "";
      }
    }

    function renderSessionsForProject(projectId) {
      const sessionSelect = $(sessionSelectId);
      if (!sessionSelect) return;

      const sessions = getSessionsForProject(projectId);
      const activeSid = getActiveSessionId();

      const opts = [];
      opts.push(`<option value="">${sessions.length ? "Select a session…" : "No sessions"}</option>`);

      sessions.forEach((s) => {
        const sid = String(s?.id ?? "");
        const sname = safe(s?.name || "Untitled session");
        opts.push(`<option value="${safe(sid)}">#${safe(sid)} — ${sname}</option>`);
      });

      sessionSelect.innerHTML = opts.join("");
      sessionSelect.disabled = !sessions.length;

      // keep selection if the active session belongs to this project
      if (activeSid && sessions.some((ss) => String(ss?.id) === activeSid)) {
        sessionSelect.value = activeSid;
      } else {
        sessionSelect.value = "";
      }
    }

    function render() {
      renderProjects();

      const projectSelect = $(projectSelectId);
      const pid = projectSelect?.value || getActiveProjectIdFromActiveSession() || "";
      renderSessionsForProject(pid);
    }

    function wire(signal) {
      const projectSelect = $(projectSelectId);
      const sessionSelect = $(sessionSelectId);
      if (!projectSelect || !sessionSelect) return;

      projectSelect.addEventListener(
        "change",
        () => {
          const pid = projectSelect.value || "";
          renderSessionsForProject(pid);

          // On project change: auto-select first session (if any) to avoid “blank viewer”
          const sessions = getSessionsForProject(pid);

          if (!pid || !sessions.length) return;

          const first = sessions[0];
          const sid = first?.id != null ? String(first.id) : "";
          if (!sid) return;

          // set select UI immediately
          sessionSelect.value = sid;

          // update runtime
          try {
            if (typeof setActiveSession === "function") setActiveSession(pid, sid);
          } catch (e) {
            console.warn("[SessionPicker] setActiveSession failed:", e);
          }
        },
        { signal }
      );

      sessionSelect.addEventListener(
        "change",
        () => {
          const pid = projectSelect.value || "";
          const sid = sessionSelect.value || "";
          if (!pid || !sid) return;

          try {
            if (typeof setActiveSession === "function") setActiveSession(pid, sid);
          } catch (e) {
            console.warn("[SessionPicker] setActiveSession failed:", e);
          }
        },
        { signal }
      );

      // If active session changes elsewhere, sync UI
      document.addEventListener("movesync:active-session-changed", () => render(), { signal });

      // If projects change, re-render options
      document.addEventListener("movesync:projects-changed", () => render(), { signal });
    }

    return { render, wire };
  }

  window.MoveSyncSessionPicker = {
    create: createProjectSessionPicker,
  };
})();