// app/core/session-store.js
// ------------------------------------------------------------
// Ephemeral storage (in-memory only)
// Supports: Projects -> Sessions
// ------------------------------------------------------------
(() => {
  "use strict";

  const LEGACY_DB_NAME = "movesync-db";

  function ensureRuntime() {
    window.MoveSync = window.MoveSync || {};
    window.MoveSync.runtime = window.MoveSync.runtime || {};
    window.MoveSync.runtime.sessionViewer = window.MoveSync.runtime.sessionViewer || {};

    const rt = window.MoveSync.runtime.sessionViewer;

    rt.projects = Array.isArray(rt.projects) ? rt.projects : [];
    rt.nextProjectId = Number.isFinite(rt.nextProjectId) ? rt.nextProjectId : 1;

    rt.sessions = Array.isArray(rt.sessions) ? rt.sessions : [];
    rt.nextSessionId = Number.isFinite(rt.nextSessionId) ? rt.nextSessionId : 1;

    rt.activeProjectId = rt.activeProjectId ?? null;
    rt.activeSession = rt.activeSession || null;
    rt.activeSessionRef = rt.activeSessionRef || null;

    return rt;
  }

  function purgeLegacyIndexedDb() {
    try {
      if (!("indexedDB" in window)) return;
      const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
      req.onsuccess = () => {};
      req.onerror = () => {};
      req.onblocked = () => {};
    } catch {}
  }

  // ✅ safer id parsing (prevents undefined -> 0)
  function parseId(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "string" && v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function normalizeSession(session) {
    if (!session || typeof session !== "object") return session;

    if (!Array.isArray(session.imuFiles)) {
      if (session.imuFile) session.imuFiles = [session.imuFile].filter(Boolean);
      else if (Array.isArray(session.imus)) session.imuFiles = session.imus.map((x) => x?.file).filter(Boolean);
      else session.imuFiles = [];
    }
    if (!Array.isArray(session.imus)) session.imus = [];

    // keep numeric id if present
    session.id = parseId(session.id) ?? session.id;

    return session;
  }

  function normalizeProject(project) {
    const p = project && typeof project === "object" ? project : {};
    const sessions = Array.isArray(p.sessions) ? p.sessions.map(normalizeSession) : [];
    const id = parseId(p.id);

    return {
      id, // null means "needs assignment"
      name: String(p.name || "Untitled project"),
      notes: String(p.notes || ""),
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || new Date().toISOString(),
      sessions,
    };
  }

  // Ensure each session carries a stable reference back to its project.
  // This makes it possible to:
  // - filter legacy flat session lists by projectId
  // - let the Session Picker + Viewer reliably find sessions for a project
  function attachProjectToSessions(project) {
    const p = project || {};
    const pid = p.id;
    const pname = p.name;

    const sessions = Array.isArray(p.sessions) ? p.sessions : [];
    sessions.forEach((s) => {
      if (!s || typeof s !== "object") return;
      // Do not overwrite if already present, but ensure at least projectId.
      if (s.projectId == null && pid != null) s.projectId = pid;
      if (!s.project && pid != null) s.project = { id: pid, name: pname };
      normalizeSession(s);
    });
  }

  function flattenSessions(projects) {
    const out = [];
    for (const p of projects || []) {
      attachProjectToSessions(p);
      for (const s of p.sessions || []) out.push(s);
    }
    return out;
  }

  function emitProjectsChanged() {
    document.dispatchEvent(new CustomEvent("movesync:projects-changed", { detail: { at: Date.now() } }));
  }
  function emitSessionsChanged(rt) {
    document.dispatchEvent(new CustomEvent("movesync:sessions-changed", { detail: { at: Date.now() } }));
    document.dispatchEvent(
      new CustomEvent("movesync:active-session-changed", { detail: { session: rt.activeSession, at: Date.now() } })
    );
  }

  function getProjects() {
    return ensureRuntime().projects;
  }

  function setProjects(projects) {
    const rt = ensureRuntime();
    rt.projects = Array.isArray(projects) ? projects.map(normalizeProject) : [];

    // assign ids where missing
    for (const p of rt.projects) {
      if (!parseId(p.id)) p.id = rt.nextProjectId++;
      attachProjectToSessions(p);
    }

    rt.sessions = flattenSessions(rt.projects).map(normalizeSession);

    if (rt.activeSessionRef) {
      const { projectId, sessionId } = rt.activeSessionRef;
      const found = findSession(projectId, sessionId);
      rt.activeSession = found || null;
      if (!found) rt.activeSessionRef = null;
    } else {
      rt.activeSession = null;
    }

    emitProjectsChanged();
    emitSessionsChanged(rt);
  }

  function saveRuntimeProject(project) {
    const rt = ensureRuntime();
    const normalized = normalizeProject(project);

    if (!parseId(normalized.id)) {
      normalized.id = rt.nextProjectId++;
    }

    // ensure session ids exist and are >0
    let nextSessId = 1;
    const existingMax = normalized.sessions.reduce((m, s) => Math.max(m, parseId(s?.id) || 0), 0);
    nextSessId = Math.max(nextSessId, existingMax + 1);

    normalized.sessions.forEach((s) => {
      if (!parseId(s.id)) s.id = nextSessId++;
      normalizeSession(s);
    });

    // Ensure sessions can always be queried by project.
    attachProjectToSessions(normalized);

    const idx = rt.projects.findIndex((p) => String(p.id) === String(normalized.id));
    if (idx === -1) rt.projects.unshift(normalized);
    else rt.projects[idx] = normalized;

    rt.sessions = flattenSessions(rt.projects);

    emitProjectsChanged();
    emitSessionsChanged(rt);

    return Promise.resolve(normalized);
  }

  function deleteProject(id) {
    const rt = ensureRuntime();
    const before = rt.projects.length;

    rt.projects = rt.projects.filter((p) => String(p?.id) !== String(id));
    rt.sessions = flattenSessions(rt.projects);

    if (rt.activeSessionRef?.projectId && String(rt.activeSessionRef.projectId) === String(id)) {
      rt.activeSessionRef = null;
      rt.activeSession = null;
      rt.activeProjectId = null;
    }

    if (rt.projects.length !== before) {
      emitProjectsChanged();
      emitSessionsChanged(rt);
    }

    return Promise.resolve();
  }

  function findSession(projectId, sessionId) {
    const rt = ensureRuntime();
    const p = rt.projects.find((x) => String(x?.id) === String(projectId));

    // Preferred: project tree
    if (p) {
      attachProjectToSessions(p);
      const s = (p.sessions || []).find((x) => String(x?.id) === String(sessionId)) || null;
      if (s) return normalizeSession(s);
    }

    // Fallback: legacy flat sessions that still carry projectId
    const pid = String(projectId ?? "");
    const sid = String(sessionId ?? "");
    const flat = (rt.sessions || []).map(normalizeSession);
    const found = flat.find(
      (s) => String(s?.id ?? "") === sid && String(s?.projectId ?? s?.project?.id ?? "") === pid
    );
    return found || null;
  }

  // New helper used by viewer/picker when the UI needs sessions for a project.
  // If the project tree is missing sessions (legacy imports), fall back to flat sessions.
  function getSessionsForProject(projectId) {
    const rt = ensureRuntime();
    const pid = String(projectId ?? "");
    if (!pid) return [];

    const p = rt.projects.find((x) => String(x?.id) === pid) || null;
    if (p && Array.isArray(p.sessions) && p.sessions.length) {
      attachProjectToSessions(p);
      return (p.sessions || []).map(normalizeSession);
    }

    // Fallback: legacy flat sessions that carry projectId
    const flat = (rt.sessions || []).map(normalizeSession);
    return flat.filter((s) => String(s?.projectId ?? s?.project?.id ?? "") === pid);
  }

  function setActiveSession(projectId, sessionId) {
    const rt = ensureRuntime();
    const found = findSession(projectId, sessionId);

    rt.activeProjectId = projectId ?? null;
    rt.activeSessionRef = found ? { projectId, sessionId } : null;
    rt.activeSession = found;

    emitSessionsChanged(rt);
  }

  function getActiveSession() {
    return ensureRuntime().activeSession || null;
  }

  // Legacy APIs
  function getSessions() {
    const rt = ensureRuntime();
    if (rt.projects.length) rt.sessions = flattenSessions(rt.projects).map(normalizeSession);
    else rt.sessions = (rt.sessions || []).map(normalizeSession);
    return rt.sessions;
  }

  function setSessions(sessions) {
    const rt = ensureRuntime();
    rt.sessions = Array.isArray(sessions) ? sessions.map(normalizeSession) : [];
    if (rt.activeSession && !rt.sessions.some((s) => String(s?.id) === String(rt.activeSession?.id))) {
      rt.activeSession = null;
      rt.activeSessionRef = null;
    }
    emitSessionsChanged(rt);
  }

  function setActiveSessionById(id) {
    const rt = ensureRuntime();

    if (rt.projects.length) {
      for (const p of rt.projects) {
        const found = (p.sessions || []).find((s) => String(s?.id) === String(id));
        if (found) {
          setActiveSession(p.id, found.id);
          return;
        }
      }
    }

    const found = (rt.sessions || []).find((s) => String(s?.id) === String(id)) || null;
    rt.activeSession = found;
    rt.activeSessionRef = null;
    emitSessionsChanged(rt);
  }

  function saveRuntimeSession(_session) {
    return Promise.resolve();
  }

  function deleteSession(id) {
    const rt = ensureRuntime();
    let changed = false;

    if (rt.projects.length) {
      rt.projects.forEach((p) => {
        const before = (p.sessions || []).length;
        p.sessions = (p.sessions || []).filter((s) => String(s?.id) !== String(id));
        if (p.sessions.length !== before) changed = true;
      });

      rt.sessions = flattenSessions(rt.projects);

      if (rt.activeSession && String(rt.activeSession.id) === String(id)) {
        rt.activeSession = rt.sessions[rt.sessions.length - 1] || null;
        rt.activeSessionRef = null;
      }
    } else {
      const before = rt.sessions.length;
      rt.sessions = rt.sessions.filter((s) => String(s?.id) !== String(id));
      changed = rt.sessions.length !== before;

      if (rt.activeSession && String(rt.activeSession.id) === String(id)) {
        rt.activeSession = rt.sessions[rt.sessions.length - 1] || null;
        rt.activeSessionRef = null;
      }
    }

    if (changed) {
      emitProjectsChanged();
      emitSessionsChanged(rt);
    }

    return Promise.resolve();
  }

  async function hydrateRuntimeFromDb() {
    const rt = ensureRuntime();

    rt.projects = (rt.projects || []).map(normalizeProject);

    // ensure ids are non-zero
    const maxPid = rt.projects.reduce((m, p) => Math.max(m, parseId(p?.id) || 0), 0);
    rt.nextProjectId = Math.max(rt.nextProjectId || 1, maxPid + 1);

    for (const p of rt.projects) {
      if (!parseId(p.id)) p.id = rt.nextProjectId++;
      attachProjectToSessions(p);
    }

    rt.sessions = flattenSessions(rt.projects).map(normalizeSession);

    const maxSid = rt.sessions.reduce((m, s) => Math.max(m, parseId(s?.id) || 0), 0);
    rt.nextSessionId = Math.max(rt.nextSessionId || 1, maxSid + 1);

    if (rt.activeSessionRef) {
      const found = findSession(rt.activeSessionRef.projectId, rt.activeSessionRef.sessionId);
      rt.activeSession = found || null;
      if (!found) rt.activeSessionRef = null;
    }

    emitProjectsChanged();
    emitSessionsChanged(rt);

    return rt;
  }

  purgeLegacyIndexedDb();

  window.MoveSyncSessionStore = {
    getProjects,
    setProjects,
    saveRuntimeProject,
    deleteProject,
    setActiveSession,

    // Project-first helpers
    getSessionsForProject,

    hydrateRuntimeFromDb,
    saveRuntimeSession,
    deleteSession,
    getSessions,
    setSessions,
    getActiveSession,
    setActiveSessionById,

    purgeLegacyIndexedDb,
  };
})();