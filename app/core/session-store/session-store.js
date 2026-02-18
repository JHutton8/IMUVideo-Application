// app/core/session-store.js
// ------------------------------------------------------------
// Ephemeral session storage (in-memory only)
// ------------------------------------------------------------
// Why this file exists:
// - Other pages call `MoveSyncSessionStore.saveRuntimeSession()` / `.hydrateRuntimeFromDb()`.
// - Previously this used IndexedDB to persist sessions across refresh.
// - Requirement: **Do NOT save sessions after a browser refresh**.
//
// What we do now:
// - Keep sessions in `window.MoveSync.runtime.sessionViewer` only (memory).
// - Best-effort purge any legacy IndexedDB database from older builds so
//   previously-saved sessions don't unexpectedly reappear.
//
// Public API (unchanged):
//   MoveSyncSessionStore.hydrateRuntimeFromDb(): Promise<runtime>
//   MoveSyncSessionStore.saveRuntimeSession(session): Promise<void>
//   MoveSyncSessionStore.deleteSession(id): Promise<void>
// ------------------------------------------------------------
(() => {
  "use strict";

  /**
   * Legacy DB name from previous implementation (IndexedDB).
   * We attempt to delete it on load so nothing persists after refresh.
   */
  const LEGACY_DB_NAME = "movesync-db";

  // ------------------------------------------------------------
  // Session Viewer runtime getters/setters (NEW)
  // ------------------------------------------------------------
  function getSessions() {
    return ensureRuntime().sessions;
  }

  function setSessions(sessions) {
    const rt = ensureRuntime();
    rt.sessions = Array.isArray(sessions) ? sessions : [];

    // reset active if invalid
    if (rt.activeSession && !rt.sessions.some(s => String(s?.id) === String(rt.activeSession?.id))) {
      rt.activeSession = null;
    }

    document.dispatchEvent(new CustomEvent("movesync:sessions-changed", { detail: { at: Date.now() } }));
    document.dispatchEvent(new CustomEvent("movesync:active-session-changed", { detail: { session: rt.activeSession, at: Date.now() } }));
  }

  function getActiveSession() {
    return ensureRuntime().activeSession || null;
  }

  function setActiveSession(session) {
    const rt = ensureRuntime();
    rt.activeSession = session || null;

    document.dispatchEvent(
      new CustomEvent("movesync:active-session-changed", { detail: { session: rt.activeSession, at: Date.now() } })
    );
  }

  function setActiveSessionById(id) {
    const rt = ensureRuntime();
    const found = rt.sessions.find(s => String(s?.id) === String(id)) || null;
    setActiveSession(found);
  }

  /**
   * Ensures the global runtime shape exists and returns the sessionViewer runtime object.
   * The app uses this to share state across pages without a backend.
   */
  function ensureRuntime() {
    window.MoveSync = window.MoveSync || {};
    window.MoveSync.runtime = window.MoveSync.runtime || {};
    window.MoveSync.runtime.sessionViewer = window.MoveSync.runtime.sessionViewer || {};

    const rt = window.MoveSync.runtime.sessionViewer;
    rt.sessions = Array.isArray(rt.sessions) ? rt.sessions : [];
    rt.nextSessionId = Number.isFinite(rt.nextSessionId) ? rt.nextSessionId : 1;
    rt.activeSession = rt.activeSession || null;

    return rt;
  }

  /**
   * Best-effort purge of legacy persistent storage.
   * - If the browser blocks it (privacy settings), we just ignore errors.
   * - This is async but we don't *depend* on it to keep the app working.
   */
  function purgeLegacyIndexedDb() {
    try {
      if (!("indexedDB" in window)) return;

      const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);

      // Some browsers require handlers to actually run the request reliably.
      req.onsuccess = () => {};
      req.onerror = () => {};
      req.onblocked = () => {};
    } catch {
      // Intentionally ignore: the app should still function without persistence.
    }
  }

  /**
   * "Hydration" now simply ensures runtime exists and notifies the UI.
   * We do NOT load anything from disk.
   */
  async function hydrateRuntimeFromDb() {
    const rt = ensureRuntime();

    // If there are no sessions yet, make sure activeSession is null.
    if (!rt.sessions.length) rt.activeSession = null;

    // Keep nextSessionId consistent (maxId + 1).
    const maxId = rt.sessions.reduce((m, s) => Math.max(m, Number(s?.id) || 0), 0);
    rt.nextSessionId = Math.max(rt.nextSessionId || 1, maxId + 1);

    // Notify UI/pages that sessions are (re)available.
    document.dispatchEvent(new CustomEvent("movesync:sessions-changed", { detail: { at: Date.now() } }));
    document.dispatchEvent(
      new CustomEvent("movesync:active-session-changed", { detail: { session: rt.activeSession, at: Date.now() } })
    );

    return rt;
  }

  /**
   * Previously persisted to IndexedDB; now this is intentionally a no-op.
   * The runtime session is already in memory in `window.MoveSync.runtime.sessionViewer.sessions`.
   */
  async function saveRuntimeSession(_session) {
    // no-op (ephemeral by design)
  }

  /**
   * Removes a session from runtime (memory) and updates active session if needed.
   */
  async function deleteSession(id) {
    const rt = ensureRuntime();
    const before = rt.sessions.length;

    rt.sessions = rt.sessions.filter((s) => String(s?.id) !== String(id));

    if (rt.activeSession && String(rt.activeSession.id) === String(id)) {
      rt.activeSession = rt.sessions[rt.sessions.length - 1] || null;
    }

    // If nothing changed, don't spam events.
    if (rt.sessions.length !== before) {
      document.dispatchEvent(new CustomEvent("movesync:sessions-changed", { detail: { at: Date.now() } }));
      document.dispatchEvent(
        new CustomEvent("movesync:active-session-changed", { detail: { session: rt.activeSession, at: Date.now() } })
      );
    }
  }

  // Purge legacy persisted data on every load/refresh.
  purgeLegacyIndexedDb();

  window.MoveSyncSessionStore = {
    hydrateRuntimeFromDb,
    saveRuntimeSession,
    deleteSession,
    getSessions,
    setSessions,
    getActiveSession,
    setActiveSession,
    setActiveSessionById,
    
    // Exposed for debugging/manual use (optional)
    purgeLegacyIndexedDb,
  };
})();