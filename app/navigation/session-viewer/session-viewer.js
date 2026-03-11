// =======================================
// Session Viewer page (page controller)
// File: app/navigation/session-viewer/session-viewer.js
//
// Responsibilities:
// - Load page-specific dependencies (once + always)
// - Mount/wire submodules (video, timestamps, IMU, fusion, time-sync, picker)
// - Provide a simple controller that renders either the active session or an empty state
// =======================================

(() => {
  "use strict";

  const PAGE_NAME = "Session Viewer";
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Dependency loading
  // ---------------------------------------------------------------------------
  // Some deps should only ever be loaded once per app lifetime (heavier models, etc.)
  const DEPS_ONCE = [
    "app/navigation/session-viewer/video-panel/pose-overlay/movenet.js",
  ];

  // Other deps can be re-used, but we allow re-loading on page enter
  // (the loader still de-dupes by DOM tag).
  const DEPS_ALWAYS = [
    // Load AHRS library first so window.Madgwick is available to both
    // sensor-fusion.js and imu-processing.js without either having to
    // lazy-load it themselves.
    "app/navigation/session-viewer/bottom-panel/3-sensor-fusion/ahrs.min.js",

    // Key metrics panel
    "app/navigation/session-viewer/key-metrics-panel/key-metrics-panel.js",
    // Expanded metrics analysis panel
    "app/navigation/session-viewer/bottom-panel/1-expanded-metrics/expanded-metrics-panel.js",

    "app/navigation/session-viewer/bottom-panel/2-imu/imu-panel.js",
    "app/navigation/session-viewer/bottom-panel/3-sensor-fusion/sensor-fusion.js",
    "app/navigation/session-viewer/imu-processing/imu-processing.js",

    "app/navigation/session-viewer/session-picker/session-picker.js",
    "app/navigation/session-viewer/time-sync/time-sync.js",
    "app/navigation/session-viewer/timestamps/timestamps.js",
    "app/navigation/session-viewer/video-panel/video-panel.js",
  ];

  // Useful during development if you're changing scripts and want forced reload.
  const DEV_CACHE_BUST = false;

  function withCacheBust(url) {
    if (!DEV_CACHE_BUST || !url) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${Date.now()}`;
  }

  function getLoadedSet() {
    const globalSet = window.MoveSyncApp?.state?.loadedScripts;
    if (globalSet && typeof globalSet.has === "function") return globalSet;

    // Fallback for older app shells
    window.__MoveSyncLoadedScripts = window.__MoveSyncLoadedScripts || new Set();
    return window.__MoveSyncLoadedScripts;
  }

  function loadScript(src, { once = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!src) return resolve();

      const loaded = getLoadedSet();

      // De-dupe by set and by existing DOM tags.
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
  // Small helpers (store + escape)
  // ---------------------------------------------------------------------------
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function store() {
    return window.MoveSyncSessionStore || null;
  }

  function getProjectsSafe() {
    const projects = store()?.getProjects?.();
    return Array.isArray(projects) ? projects : [];
  }

  function getActiveSessionSafe() {
    return store()?.getActiveSession?.() ?? null;
  }

  function getActiveProjectId() {
    const active = getActiveSessionSafe();
    const pid = active?.projectId ?? active?.project?.id ?? null;
    return pid != null ? String(pid) : "";
  }

  function getSessionsForActiveProject() {
    const pid = getActiveProjectId();
    if (!pid) return [];

    // Preferred: store helper method
    const s = store();
    const direct = s?.getSessionsForProject?.(pid);
    if (Array.isArray(direct)) return direct;

    // Fallback: search inside projects
    const p = getProjectsSafe().find((pp) => String(pp?.id) === String(pid));
    return Array.isArray(p?.sessions) ? p.sessions : [];
  }

  // ---------------------------------------------------------------------------
  // Controller (render active session or empty state)
  // ---------------------------------------------------------------------------
  function createViewerController({
    getSessions,
    getActiveSession,
    emptyOverlay,
    videoPanel,
    videoMeta,
    keyMetricsPanel,
    imuPanel,
    timestampsPanel,
    fusionPanel,
  }) {
    const hasSessions = () => (typeof getSessions === "function" ? getSessions() : []).length > 0;

    async function renderSession(session) {
      // Reset marker when switching sessions
      imuPanel?.clearMarker?.();

      // Key metrics panel
      keyMetricsPanel?.render?.(session);

      // Expanded metrics panel
      expandedMetricsPanel?.setSession?.(session);

      // Video + metadata
      videoMeta?.render?.(session);
      videoPanel?.renderSession?.(session);

      // IMU charts/CSV
      await imuPanel?.render?.(session);

      // Ensure slider alignment after Chart.js computes chartArea.
      try {
        imuPanel?.alignCursorSlider?.();
      } catch {}

      // Keep fusion panel in sync with session + current IMU selection
      try {
        fusionPanel?.setSession?.(session);
        fusionPanel?.setActiveImuIndex?.(window.currentImuIndex || 0);
        fusionPanel?.ensureAndRender?.();
      } catch {}

      // Timestamps list
      timestampsPanel?.updateNow?.();
      timestampsPanel?.render?.(session);
    }

    async function renderNoSession() {
      // Clear key metrics
      keyMetricsPanel?.render?.(null);
      expandedMetricsPanel?.setSession?.(null);

      // Clear video
      videoMeta?.render?.(null);
      videoPanel?.renderNoSession?.();

      // Clear IMU
      imuPanel?.clearMarker?.();
      await imuPanel?.render?.({});

      try {
        imuPanel?.alignCursorSlider?.();
      } catch {}

      // Clear fusion
      try {
        fusionPanel?.setSession?.(null);
      } catch {}

      // Clear timestamps
      timestampsPanel?.render?.(null);
      timestampsPanel?.updateNow?.();
    }

    function refresh() {
      const sessionsExist = hasSessions();
      emptyOverlay?.setVisible?.(!sessionsExist);

      const active = typeof getActiveSession === "function" ? getActiveSession() : null;
      if (!sessionsExist || !active) return renderNoSession();
      return renderSession(active);
    }

    return { refresh, renderSession, renderNoSession };
  }

  // ---------------------------------------------------------------------------
  // Main (top-level) tabs
  // ---------------------------------------------------------------------------
  function initGeneralTabs(signal) {
    const root = $("viewerGeneralTabs");
    if (!root) return;

    const btns = Array.from(root.querySelectorAll('[role="tab"][data-tab]'));
    const panels = Array.from(root.querySelectorAll('[role="tabpanel"][data-panel]'));

    function setActive(tab) {
      for (const b of btns) {
        const isActive = b.dataset.tab === tab;
        b.classList.toggle("is-active", isActive);
        b.setAttribute("aria-selected", isActive ? "true" : "false");
        b.tabIndex = isActive ? 0 : -1;
      }

      for (const p of panels) {
        p.hidden = p.dataset.panel !== tab;
      }

      // Let other modules react to tab visibility changes.
      document.dispatchEvent(new CustomEvent("movesync:viewer-tab-changed", { detail: { tab } }));

      // When entering fusion tab, ensure the fusion markup is mounted.
      if (tab === "fusion") {
        try {
          window.FusionManager?.setMountId?.("viewerFusionPanelMount");
          window.FusionManager?.init?.();
        } catch {}
      }
    }

    for (const b of btns) {
      b.addEventListener("click", () => setActive(b.dataset.tab), { signal });
    }

    setActive("analysis");
  }

  // ---------------------------------------------------------------------------
  // Page init/destroy
  // ---------------------------------------------------------------------------
  let controllerAbort = null;

  // Submodules
  let videoPanel = null;
  let videoMeta = null;
  let keyMetricsPanel = null;
  let expandedMetricsPanel = null;
  let timestampsPanel = null;
  let imuPanel = null;
  let timeSyncPanel = null;
  let fusionPanel = null;

  let viewerController = null;

  // kept for compatibility (events update it)
  const timeSync = { offset: null };

  function init() {
    controllerAbort?.abort?.();
    controllerAbort = new AbortController();
    const signal = controllerAbort.signal;

    ensureDepsLoaded()
      .then(() => {
        if (signal.aborted) return;

        store()?.hydrateRuntimeFromDb?.();

        // 1) Video panel
        videoPanel = window.MoveSyncViewerVideoPanel?.create?.({ canvasId: "viewerPoseCanvas" });
        videoPanel?.mount?.();
        videoPanel?.init?.(signal);

        // 2) Video metadata (depends on video panel deps)
        (window.__videoPanelDepsPromise || Promise.resolve())
          .then(() => {
            if (signal.aborted) return;

            videoMeta = window.MoveSyncViewerVideoMetadata?.create?.({
              getActiveSession: () => getActiveSessionSafe(),
              mountId: "viewerVideoMetaPopoverMount",
            });
            videoMeta?.wire?.(signal);
          })
          .catch((e) => console.warn("[Session Viewer] video metadata deps failed:", e));

        // 3) Key metrics panel
        keyMetricsPanel = window.MoveSyncKeyMetricsPanel?.create?.({
          mountId: "viewerKeyMetricsPanelMount",
        });
        keyMetricsPanel?.mount?.();

        // Mount expanded metrics analysis panel into the analysis tab
        if (window.MoveSyncExpandedMetricsPanel) {
          window.MoveSyncExpandedMetricsPanel.mount("viewerAnalysisPanelMount");
          expandedMetricsPanel = window.MoveSyncExpandedMetricsPanel;
          // Hide placeholder text when panel is active
          const ph = document.querySelector('[data-placeholder="analysis"]');
          if (ph) ph.hidden = true;
        }

        // 4) Timestamps panel (renumbered to keep ordering comments valid)
        timestampsPanel = window.MoveSyncViewerTimestamps?.create?.({
          getActiveSession: () => getActiveSessionSafe(),
          getVideoEl: () => $("viewerVideo"),
          mountId: "viewerTimestampsPanelMount",
        });
        timestampsPanel?.wire?.(signal);

        // 4) IMU panel
        imuPanel = window.MoveSyncViewerIMUPanel?.create?.({ mountId: "viewerImuPanelMount" });
        imuPanel?.wireAxisButtons?.(signal);
        imuPanel?.syncAxisButtons?.();
        imuPanel?.wireCursor?.(signal);
        imuPanel?.wireFormatToggle?.(signal);

        // Align slider when IMU tab becomes visible (fix: tab-hidden charts).
        document.addEventListener(
          "movesync:viewer-tab-changed",
          (e) => {
            if (e?.detail?.tab !== "imu") return;
            try {
              // Double-rAF: first frame lets Chart.js compute chartArea,
              // second frame lets the slider position update correctly.
              requestAnimationFrame(() => requestAnimationFrame(() => imuPanel?.alignCursorSlider?.()));
            } catch {}
          },
          { signal }
        );

        // 5) Fusion panel module (event-driven)
        fusionPanel = window.MoveSyncViewerFusionPanel;
        fusionPanel?.wire?.(signal);

        // 6) Time-sync panel
        timeSyncPanel = window.MoveSyncViewerTimeSync?.create?.({
          mountId: "viewerTimeSyncPanelMount",
          getVideoEl: () => $("viewerVideo"),
          getImuCursorX: () => imuPanel?.getCursorX?.() ?? null,
          getImuMarkerX: () => imuPanel?.getMarkerX?.() ?? null,
          setImuMarkerX: (x) => imuPanel?.setMarkerX?.(x),
        });
        timeSyncPanel?.wire?.(signal);

        // Keep a local copy of offset (in case other components read it).
        document.addEventListener(
          "movesync:time-sync-changed",
          (e) => {
            const off = e?.detail?.offset;
            timeSync.offset = Number.isFinite(off) ? Number(off) : null;
          },
          { signal }
        );

        // Follow video: when enabled, drive the IMU cursor from video timeupdate.
        // time-sync.js fires movesync:time-sync-mode-changed but nothing was
        // wiring it through to imuPanel.setCursorX — this is that missing link.
        let followVideoRafId = null;

        function driveImuCursorFromVideo() {
          if (followVideoRafId) cancelAnimationFrame(followVideoRafId);
          const tick = () => {
            if (!window.IMU_STATE?.followVideo) return; // mode was turned off
            const v = $("viewerVideo");
            if (v && !v.paused && !v.ended && Number.isFinite(v.currentTime)) {
              const offset = Number.isFinite(timeSync.offset) ? timeSync.offset : 0;
              imuPanel?.setCursorX?.(v.currentTime - offset);
            }
            followVideoRafId = requestAnimationFrame(tick);
          };
          followVideoRafId = requestAnimationFrame(tick);
        }

        document.addEventListener(
          "movesync:time-sync-mode-changed",
          (e) => {
            if (e?.detail?.followVideo) {
              driveImuCursorFromVideo();
            } else {
              if (followVideoRafId) {
                cancelAnimationFrame(followVideoRafId);
                followVideoRafId = null;
              }
            }
          },
          { signal }
        );

        // Also drive cursor on timeupdate when follow mode is already active
        // (e.g. video scrubbed manually while follow is on)
        $("viewerVideo")?.addEventListener(
          "timeupdate",
          () => {
            if (!window.IMU_STATE?.followVideo) return;
            const v = $("viewerVideo");
            if (!v || !Number.isFinite(v.currentTime)) return;
            const offset = Number.isFinite(timeSync.offset) ? timeSync.offset : 0;
            imuPanel?.setCursorX?.(v.currentTime - offset);
          },
          { signal }
        );

        // 6b) Bidirectional slider sync (Video seek <-> IMU cursor)
        // After an offset is computed, dragging either slider will move the other.
        (() => {
          const clamp = (n, a, b) => {
            const v = Number(n);
            if (!Number.isFinite(v)) return a;
            return Math.min(b, Math.max(a, v));
          };

          // Guard to avoid any ping-pong if a browser fires extra events.
          let syncing = false;

          function getOffset() {
            return Number.isFinite(timeSync.offset) ? Number(timeSync.offset) : null;
          }

          function setImuFromVideoTime(videoTime) {
            const off = getOffset();
            if (off == null) return;

            const imuT = Number(videoTime) - off;
            if (!Number.isFinite(imuT)) return;

            syncing = true;
            try {
              imuPanel?.setCursorX?.(imuT);
            } finally {
              syncing = false;
            }
          }

          function setVideoFromImuTime(imuTime) {
            const off = getOffset();
            if (off == null) return;

            const v = $("viewerVideo");
            if (!v) return;

            const target = Number(imuTime) + off;
            if (!Number.isFinite(target)) return;

            const dur = Number.isFinite(v.duration) ? Number(v.duration) : null;
            const t = dur == null ? Math.max(0, target) : clamp(target, 0, dur);

            syncing = true;
            try {
              v.currentTime = t;
              // Nudge custom controls UI to update immediately (video-panel listens to timeupdate)
              v.dispatchEvent(new Event("timeupdate"));
            } catch {
              // ignore
            } finally {
              syncing = false;
            }
          }

          // Use delegated input listener so this keeps working even if panels re-mount.
          document.addEventListener(
            "input",
            (ev) => {
              if (syncing) return;
              if (getOffset() == null) return;

              const t = ev?.target;
              if (!(t instanceof HTMLInputElement)) return;

              // Video seek slider -> IMU cursor
              if (t.id === "viewerVcSeek") {
                const videoT = Number(t.value);
                if (Number.isFinite(videoT)) setImuFromVideoTime(videoT);
                return;
              }

              // IMU cursor slider -> Video seek
              if (t.id === "viewerImuCursorRange") {
                const imuT = Number(t.value);
                if (Number.isFinite(imuT)) setVideoFromImuTime(imuT);
              }
            },
            { signal }
          );
        })();

        // 7) Project/session picker
        const picker = window.MoveSyncSessionPicker?.create?.({
          projectSelectId: "viewerProjectSelect",
          sessionSelectId: "viewerSessionSelect",
          getProjects: () => getProjectsSafe(),
          getActiveSession: () => getActiveSessionSafe(),
          setActiveSession: (projectId, sessionId) => store()?.setActiveSession?.(projectId, sessionId),
          escapeHtml,
        });
        picker?.render?.();
        picker?.wire?.(signal);

        // 8) Navigation button
        $("viewerGoLibrary")?.addEventListener("click", () => window.MoveSync?.goToPage?.("Library"), { signal });

        // 9) Main tabs
        initGeneralTabs(signal);

        // 10) Page controller
        viewerController = createViewerController({
          getSessions: () => getSessionsForActiveProject(),
          getActiveSession: () => getActiveSessionSafe(),
          videoPanel,
          videoMeta,
          keyMetricsPanel,
          imuPanel,
          timestampsPanel,
          fusionPanel,
        });

        // Refresh on store events
        document.addEventListener("movesync:active-session-changed", () => viewerController?.refresh?.(), { signal });
        document.addEventListener("movesync:sessions-changed", () => viewerController?.refresh?.(), { signal });
        document.addEventListener("movesync:projects-changed", () => viewerController?.refresh?.(), { signal });

        viewerController?.refresh?.();

        // Route imu-processed to metrics panels and timestamps panel
        document.addEventListener("movesync:imu-processed", (ev) => {
          const processed = ev?.detail?.processed;
          if (!processed) return;
          keyMetricsPanel?.onProcessed?.(processed);
          expandedMetricsPanel?.onProcessed?.(processed);
          timestampsPanel?.onProcessed?.(processed);
          // Show live speed HUD once data is ready
          const liveEl = $("viewerLiveSpeed");
          if (liveEl) liveEl.hidden = false;
        }, { signal });

        // Live speed: update on every cursor movement
        document.addEventListener("movesync:imu-cursor-changed", (ev) => {
          const t = ev?.detail?.imuTime;
          const processed = window.currentProcessedSession;
          const valEl = $("viewerLiveSpeedVal");
          const subEl = $("viewerLiveSpeedSub");
          if (!valEl) return;
          if (!processed || !Number.isFinite(t)) { valEl.textContent = "—"; return; }
          const frame = window.MoveSyncIMUProcessing?.getValuesAtTime?.(processed, t);
          if (!frame) { valEl.textContent = "—"; return; }
          valEl.textContent = frame.speed.toFixed(2);
          // Show still/moving status
          if (subEl) {
            if (frame.isStill) {
              subEl.textContent = "stationary";
              subEl.className = "viewer-live-speed-sub is-still";
            } else {
              // Show accel alongside speed for context
              subEl.textContent = `${frame.accelMagnitude.toFixed(2)} G`;
              subEl.className = "viewer-live-speed-sub";
            }
          }
        }, { signal });
      })
      .catch((e) => console.warn("[Session Viewer] init failed:", e));
  }

  function destroy() {
    controllerAbort?.abort?.();
    controllerAbort = null;

    viewerController = null;
    videoMeta = null;
    keyMetricsPanel = null;
    expandedMetricsPanel = null;
    timestampsPanel = null;
    timeSyncPanel = null;
    imuPanel = null;
    fusionPanel = null;

    videoPanel?.destroy?.();
    videoPanel = null;
  }

  window.MoveSyncPages = window.MoveSyncPages || {};
  window.MoveSyncPages[PAGE_NAME] = { init, destroy };
})();