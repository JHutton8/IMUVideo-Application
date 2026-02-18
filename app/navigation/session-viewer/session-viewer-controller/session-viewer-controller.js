// =======================================
// Session Viewer Controller
// File: app/navigation/session-viewer/session-viewer-controller.js
// Owns render pipeline + empty/active decisions
// =======================================

(() => {
  "use strict";

  function create({
    getSessions,
    getActiveSession,

    emptyOverlay,
    videoPanel,
    videoMeta,
    imuPanel,
    timestampsPanel,
  }) {
    const hasSessions = () => (typeof getSessions === "function" ? getSessions() : []).length > 0;

    async function renderSession(session) {
      imuPanel?.clearMarker?.();

      videoMeta?.render?.(session);
      videoPanel?.renderSession?.(session);

      await imuPanel?.render?.(session);

      timestampsPanel?.updateNow?.();
      timestampsPanel?.render?.(session);
    }

    async function renderNoSession() {
      videoMeta?.render?.(null);
      videoPanel?.renderNoSession?.();

      imuPanel?.clearMarker?.();
      await imuPanel?.render?.({}); // IMU module shows its empty UI

      timestampsPanel?.render?.(null);
      timestampsPanel?.updateNow?.();
    }

    function refresh() {
      const sessionsExist = hasSessions();
      emptyOverlay?.setVisible?.(!sessionsExist);

      const active = typeof getActiveSession === "function" ? getActiveSession() : null;

      if (!sessionsExist) return renderNoSession();
      if (!active) return renderNoSession();

      return renderSession(active);
    }

    return { refresh, renderSession, renderNoSession };
  }

  window.MoveSyncViewerController = { create };
})();