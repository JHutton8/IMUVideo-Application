// =======================================
// MoveSync page module: Session Viewer
// File: app/navigation/session-viewer/session-viewer.js
// Thin orchestrator: create features, wire events, refresh controller
//
// ✅ Now also forces a full UI reset on every page entry.
// =======================================

(() => {
  "use strict";

  const PAGE_NAME = "Session Viewer";
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // 0) Dependency manifest (session-viewer "owns" these)
  // ---------------------------------------------------------------------------
  // NOTE: Keep this order so globals exist before init uses them.
  const DEPS_ONCE = [
    "app/navigation/session-viewer/video-panel/pose-overlay/movenet.js",
  ];

  const DEPS_ALWAYS = [
    "app/navigation/session-viewer/imu-panel/imu-panel.js",
    "app/navigation/session-viewer/session-picker/session-picker.js",
    "app/navigation/session-viewer/session-viewer-controller/session-viewer-controller.js",
    "app/navigation/session-viewer/time-sync/time-sync.js",
    "app/navigation/session-viewer/timestamps/timestamps.js",
    "app/navigation/session-viewer/video-panel/video-panel.js",
  ];

  // ---------------------------------------------------------------------------
  // 1) Script loader (reuses MoveSyncApp.state.loadedScripts if present)
  // ---------------------------------------------------------------------------
  const DEV_CACHE_BUST = false;

  function withCacheBust(url) {
    if (!DEV_CACHE_BUST || !url) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${Date.now()}`;
  }

  function getLoadedSet() {
    const globalSet = window.MoveSyncApp?.state?.loadedScripts;
    if (globalSet && typeof globalSet.has === "function") return globalSet;

    window.__MoveSyncLoadedScripts = window.__MoveSyncLoadedScripts || new Set();
    return window.__MoveSyncLoadedScripts;
  }

  function loadScript(src, { once = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!src) return resolve();

      const loaded = getLoadedSet();
      if (once && loaded.has(src)) return resolve();
      if (document.querySelector(`script[data-session-viewer-src="${src}"]`)) return resolve();

      const s = document.createElement("script");
      s.src = withCacheBust(src);
      s.async = false;
      s.dataset.sessionViewerDep = "true";
      s.dataset.sessionViewerSrc = src;

      s.onload = () => {
        if (once) loaded.add(src);
        resolve();
      };
      s.onerror = () => reject(new Error(`Session Viewer failed to load: ${src}`));

      document.body.appendChild(s);
    });
  }

  async function loadDeps() {
    for (const src of DEPS_ONCE) await loadScript(src, { once: true });
    for (const src of DEPS_ALWAYS) await loadScript(src, { once: false });
  }

  let depsPromise = null;
  function ensureDepsLoaded() {
    if (!depsPromise) depsPromise = loadDeps();
    return depsPromise;
  }

  // ---------------------------------------------------------------------------
  // 2) Original module state
  // ---------------------------------------------------------------------------
  let controllerAbort = null;

  // Feature instances
  let videoPanel = null;
  let videoMeta = null;
  let timestampsPanel = null;
  let imuPanel = null;
  let timeSyncPanel = null;

  // Controller (render pipeline)
  let viewerController = null;

  // Local time sync cache (optional)
  const timeSync = { offset: null };

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------------------------------------------------------------------------
  // 2.5) Hard reset helpers (run on EVERY page entry)
  // ---------------------------------------------------------------------------
  function forcePageResetUI() {
    // Video panel reset (this is the main piece)
    try {
      videoPanel?.resetUI?.({ rewind: true, stopPose: true });
    } catch (e) {
      console.warn("[Session Viewer] videoPanel.resetUI failed:", e);
    }

    // Best-effort resets for other panels (only if they expose something)
    try { timestampsPanel?.reset?.(); } catch {}
    try { timeSyncPanel?.reset?.(); } catch {}
    try { imuPanel?.reset?.(); } catch {}

    // Also ensure IMU markers are cleared if those APIs exist
    try { imuPanel?.setMarkerX?.(null); } catch {}
    try { imuPanel?.setCursorX?.(null); } catch {}
  }

  // ---------------------------------------------------------------------------
  // 3) Init (now waits for deps first)
  // ---------------------------------------------------------------------------
  function init() {
    controllerAbort?.abort?.();
    controllerAbort = new AbortController();
    const signal = controllerAbort.signal;

    // -----------------------------------------------------------------------
    // Video <-> IMU sync wiring (Follow Video mode)
    // -----------------------------------------------------------------------
    function wireVideoImuSync(signal) {
      const v = $("viewerVideo");
      if (!v) return;

      let suppressImuToVideo = false;
      let suppressVideoToImu = false;

      const canFollow = () =>
        !!window.IMU_STATE?.followVideo && Number.isFinite(timeSync.offset);

      // ------------------------------------------------------------
      // Fusion: make it follow VIDEO time (independent of Follow Video)
      // ------------------------------------------------------------
      let fusionReady = false;
      let fusionEnsurePromise = null;

      const ensureFusionReady = () => {
        if (fusionReady) return Promise.resolve(true);
        if (fusionEnsurePromise) return fusionEnsurePromise;

        fusionEnsurePromise = window.MoveSyncFusionLoader?.ensureLoaded?.()
          .then(() => {
            fusionReady = true;
            return true;
          })
          .catch((e) => {
            fusionEnsurePromise = null;
            console.warn("[Session Viewer] Fusion loader failed:", e);
            return false;
          });

        return fusionEnsurePromise;
      };

      const pushVideoTimeToFusion = (videoTimeSeconds) => {
        const fusionData = window.MoveSync?.runtime?.fusion || null;
        if (!fusionData) return; // fusion not computed yet

        // Map video time -> IMU time using offset if available, else assume same timeline
        const off = Number.isFinite(timeSync.offset) ? Number(timeSync.offset) : 0;
        const imuT = (Number(videoTimeSeconds) || 0) - off;

        try {
          window.FusionManager?.showPanel?.(true);
          window.FusionManager?.updateDisplay?.(fusionData, imuT);
        } catch (e) {
          console.warn("[Session Viewer] Fusion updateDisplay failed:", e);
        }
      };

      // VIDEO -> (Fusion always) + (IMU cursor only when Follow Video is enabled)
      const pushVideoTimeToImu = () => {
        if (suppressVideoToImu) return;

        const videoT = Number(v.currentTime) || 0;

        // ✅ Fusion should ALWAYS follow video time
        ensureFusionReady().then((ok) => {
          if (!ok) return;
          pushVideoTimeToFusion(videoT);
        });

        // IMU cursor follows video ONLY in Follow Video mode
        if (!canFollow()) return;

        const off = Number.isFinite(timeSync.offset) ? Number(timeSync.offset) : 0;
        const imuT = videoT - off;

        suppressImuToVideo = true;
        try {
          imuPanel?.setCursorX?.(imuT);
        } finally {
          suppressImuToVideo = false;
        }
      };

      // ✅ Update fusion live while dragging the video slider
      const seekSlider = $("viewerVcSeek");
      seekSlider?.addEventListener(
        "input",
        () => {
          const videoT = Number(seekSlider.value) || 0;

          ensureFusionReady().then((ok) => {
            if (!ok) return;
            pushVideoTimeToFusion(videoT);
          });

          // Do NOT move IMU cursor here unless Follow Video is on.
          // (Your video panel already sets v.currentTime from slider.)
        },
        { signal }
      );

      v.addEventListener("timeupdate", pushVideoTimeToImu, { signal });
      v.addEventListener("seeked", pushVideoTimeToImu, { signal });
      v.addEventListener("loadedmetadata", pushVideoTimeToImu, { signal });

      // IMU -> VIDEO (only if user moves IMU cursor while following)
      document.addEventListener(
        "movesync:imu-cursor-changed",
        (e) => {
          if (!canFollow() || suppressImuToVideo) return;

          const imuTime = e?.detail?.imuTime;
          if (!Number.isFinite(imuTime)) return;

          const videoT = imuTime + timeSync.offset;
          if (!Number.isFinite(videoT)) return;

          suppressVideoToImu = true;
          try { v.currentTime = Math.max(0, videoT); } finally { suppressVideoToImu = false; }
        },
        { signal }
      );

      // If mode or offset changes while following, snap IMU cursor to current video time
      document.addEventListener(
        "movesync:time-sync-mode-changed",
        () => { if (canFollow()) pushVideoTimeToImu(); },
        { signal }
      );
      document.addEventListener(
        "movesync:time-sync-changed",
        () => { if (canFollow()) pushVideoTimeToImu(); },
        { signal }
      );
    }

    ensureDepsLoaded()
      .then(() => {
        if (signal.aborted) return;

        // Ensure runtime exists + emit initial events
        window.MoveSyncSessionStore?.hydrateRuntimeFromDb?.();

        // 1) Video panel
        videoPanel = window.MoveSyncViewerVideoPanel?.create?.({
          canvasId: "viewerPoseCanvas",
        });
        videoPanel?.mount?.();
        videoPanel?.init?.(signal);

        // 2) Video metadata
        (window.__videoPanelDepsPromise || Promise.resolve())
          .then(() => {
            if (signal.aborted) return;

            videoMeta = window.MoveSyncViewerVideoMetadata?.create?.({
              getActiveSession: () => window.MoveSyncSessionStore?.getActiveSession?.() ?? null,
              mountId: "viewerVideoMetaPopoverMount",
            });
            videoMeta?.wire?.(signal);
          })
          .catch((e) => console.warn("[Session Viewer] video metadata deps failed:", e));

        // 3) Timestamps
        timestampsPanel = window.MoveSyncViewerTimestamps?.create?.({
          getActiveSession: () => window.MoveSyncSessionStore?.getActiveSession?.() ?? null,
          getVideoEl: () => $("viewerVideo"),
          mountId: "viewerTimestampsPanelMount",
        });
        timestampsPanel?.wire?.(signal);

        // 4) IMU panel
        imuPanel = window.MoveSyncViewerIMUPanel?.create?.({
          mountId: "viewerImuPanelMount",
        });

        imuPanel?.wireViewToggles?.(signal);
        imuPanel?.wireAxisButtons?.(signal);
        imuPanel?.syncAxisButtons?.();
        imuPanel?.wireCursor?.(signal);
        imuPanel?.wireTimeframe?.(signal);

        // 5) Time sync panel
        timeSyncPanel = window.MoveSyncViewerTimeSync?.create?.({
          mountId: "viewerTimeSyncPanelMount",
          getVideoEl: () => $("viewerVideo"),
          getImuCursorX: () => imuPanel?.getCursorX?.() ?? null,
          getImuMarkerX: () => imuPanel?.getMarkerX?.() ?? null,
          setImuMarkerX: (x) => imuPanel?.setMarkerX?.(x),
        });
        timeSyncPanel?.wire?.(signal);

        // Keep local offset cache (used by IMU follow-video)
        document.addEventListener(
          "movesync:time-sync-changed",
          (e) => {
            const off = e?.detail?.offset;
            timeSync.offset = Number.isFinite(off) ? Number(off) : null;
          },
          { signal }
        );

        imuPanel?.wireFollowVideo?.({
          getOffset: () => timeSync.offset,
        });

        // Wire actual playback/seek syncing between video + IMU (Follow Video mode)
        wireVideoImuSync(signal);

        // 6) Session picker feature
        const picker = window.MoveSyncSessionPicker?.create?.({
          selectId: "viewerSessionSelect",
          getSessions: () => window.MoveSyncSessionStore?.getSessions?.() ?? [],
          getActiveSession: () => window.MoveSyncSessionStore?.getActiveSession?.() ?? null,
          setActiveSessionById: (id) => window.MoveSyncSessionStore?.setActiveSessionById?.(id),
          escapeHtml,
        });
        picker?.render?.();
        picker?.wire?.(signal);

        // Library nav button
        $("viewerGoLibrary")?.addEventListener(
          "click",
          () => window.MoveSync?.goToPage?.("Session Library"),
          { signal }
        );

        // 8) Controller (render pipeline)
        viewerController = window.MoveSyncViewerController?.create?.({
          getSessions: () => window.MoveSyncSessionStore?.getSessions?.() ?? [],
          getActiveSession: () => window.MoveSyncSessionStore?.getActiveSession?.() ?? null,

          videoPanel,
          videoMeta,
          imuPanel,
          timestampsPanel,
        });

        document.addEventListener(
          "movesync:active-session-changed",
          () => viewerController?.refresh?.(),
          { signal }
        );
        document.addEventListener(
          "movesync:sessions-changed",
          () => viewerController?.refresh?.(),
          { signal }
        );

        // ✅ HARD RESET ON PAGE ENTRY (before first render)
        forcePageResetUI();

        // Initial render
        viewerController?.refresh?.();

        // Optional additions
        window.SessionViewerAdditions?.init?.();

        // ✅ HARD RESET AGAIN AFTER FIRST RENDER
        // (ensures UI is reset even if refresh reattached a video/session)
        forcePageResetUI();
      })
      .catch((e) => {
        console.warn("[Session Viewer] init failed:", e);
      });
  }

  function destroy() {
    controllerAbort?.abort?.();
    controllerAbort = null;

    viewerController = null;

    videoMeta = null;
    timestampsPanel = null;
    timeSyncPanel = null;

    videoPanel?.destroy?.();
    videoPanel = null;

    imuPanel = null;
  }

  window.MoveSyncPages = window.MoveSyncPages || {};
  window.MoveSyncPages[PAGE_NAME] = { init, destroy };
})();