// =======================================
// Feature: FusionManager loader
// File: app/navigation/session-viewer/imu-panel/sensor-fusion/fusion-loader.js
// =======================================

(() => {
  "use strict";

  const FUSION_SRC =
    "app/navigation/session-viewer/imu-panel/sensor-fusion/fusion-processor.js";

  let loaded = false;
  let loadingPromise = null;

    function ensureLoaded() {
    // ✅ Already present (e.g. loaded by IMU deps or previous SPA visit)
    if (window.FusionManager) {
      loaded = true;
      try { window.FusionManager?.init?.(); } catch {}
      return Promise.resolve(true);
    }

    if (loaded) return Promise.resolve(true);
    if (loadingPromise) return loadingPromise;

    loadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = FUSION_SRC;

      script.onload = () => {
        loaded = true;
        try {
          window.FusionManager?.init?.();
          resolve(true);
        } catch (err) {
          reject(err);
        }
      };

      script.onerror = () =>
        reject(new Error(`Failed to load: ${FUSION_SRC}`));

      document.head.appendChild(script);
    });

    return loadingPromise;
  }

  window.MoveSyncFusionLoader = { ensureLoaded };
})();