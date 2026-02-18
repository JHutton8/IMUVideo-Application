// =======================================
// Feature: MoveNet overlay + joint analysis UI
// File: app/navigation/session-viewer/video-panel/pose-overlay/pose-overlay.js
// =======================================

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // movenet.js sits in the SAME folder as this file
  const MOVENET_SRC = new URL("./movenet.js", document.currentScript?.src || location.href).href;

  // ---- Robust "load once" helpers (promise-based) ----
  function loadExternalScriptOnce(src, globalCheckFn, key) {
    // If already present, resolve immediately
    try {
      if (globalCheckFn?.()) return Promise.resolve();
    } catch {}

    window.__MoveSyncScriptPromises ??= {};
    if (window.__MoveSyncScriptPromises[key]) return window.__MoveSyncScriptPromises[key];

    window.__MoveSyncScriptPromises[key] = new Promise((resolve, reject) => {
      let s =
        document.querySelector(`script[data-movesync="${key}"]`) ||
        document.querySelector(`script[src="${src}"]`);

      const isReady = () => {
        try {
          return !!globalCheckFn?.();
        } catch {
          return false;
        }
      };

      // Already ready? resolve now
      if (isReady()) {
        resolve();
        return;
      }

      if (!s) {
        s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.dataset.movesync = key;
        document.head.appendChild(s);
      }

      const pollUntilReady = () => {
        const start = performance.now();
        const tick = () => {
          if (isReady()) {
            resolve();
            return;
          }
          if (performance.now() - start > 2000) {
            reject(new Error(`Loaded ${src} but globals not available for key="${key}"`));
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      };

      // If it loads after we attach listeners
      s.addEventListener("load", pollUntilReady, { once: true });
      s.addEventListener("error", () => reject(new Error("Failed to load: " + src)), { once: true });

      // If it was already loaded before listeners attached, poll anyway
      pollUntilReady();
    });

    return window.__MoveSyncScriptPromises[key];
  }

  async function ensureMoveNetDeps() {
    // Ensure this whole dependency process runs only once
    window.__MoveNetDepsPromise ??= (async () => {
      // Use ONE TFJS distribution to prevent duplicate kernel/backend registration spam
      await loadExternalScriptOnce(
        "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js",
        () => !!window.tf && typeof window.tf.ready === "function",
        "tfjs"
      );

      await loadExternalScriptOnce(
        "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js",
        () => !!window.poseDetection && typeof window.poseDetection.createDetector === "function",
        "pose-detection"
      );

      // Backend init (idempotent)
      await window.tf.ready();
      const current = window.tf.getBackend?.();
      if (current !== "webgl") {
        try {
          await window.tf.setBackend("webgl");
          await window.tf.ready();
        } catch (e) {
          // Fallback: keep whatever backend TFJS chose (CPU / WASM / etc.)
          console.warn("TFJS backend switch to webgl failed; continuing with", window.tf.getBackend?.(), e);
        }
      }
    })();

    return window.__MoveNetDepsPromise;
  }

  function loadMoveNetOnce() {
    // If movenet already present, resolve (handleStart/handleStop are installed by movenet.js)
    const isReady = () =>
      typeof window.handleStart === "function" && typeof window.handleStop === "function";

    if (isReady()) return Promise.resolve();

    // In-flight / loaded guard
    window.__MoveNetScriptPromise ??= new Promise((resolve, reject) => {
      // Avoid injecting twice
      const existing =
        document.querySelector(`script[data-movesync="movenet"]`) ||
        document.querySelector(`script[src="${MOVENET_SRC}"]`);

      const pollUntilReady = () => {
        const start = performance.now();
        const tick = () => {
          if (isReady()) {
            resolve();
            return;
          }
          if (performance.now() - start > 2000) {
            reject(new Error("Loaded movenet.js but globals were not installed."));
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      };

      if (existing) {
        existing.addEventListener("load", pollUntilReady, { once: true });
        existing.addEventListener("error", () => reject(new Error("Failed to load: " + MOVENET_SRC)), {
          once: true,
        });
        // If it already executed before we attached listeners
        pollUntilReady();
        return;
      }

      const s = document.createElement("script");
      s.src = MOVENET_SRC;
      s.async = true;
      s.dataset.movesync = "movenet";
      s.addEventListener("load", pollUntilReady, { once: true });
      s.addEventListener("error", () => reject(new Error("Failed to load: " + MOVENET_SRC)), { once: true });
      document.head.appendChild(s);

      // In case it loads synchronously from cache
      pollUntilReady();
    });

    return window.__MoveNetScriptPromise;
  }

  function create({ getVideoEl, canvasId = "viewerPoseCanvas", onPoseStateChanged } = {}) {
    let poseCanvas = null;
    let poseCtx = null;

    function clearPoseCanvas() {
      if (!poseCanvas || !poseCtx) return;
      poseCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
    }

    function syncVideoAndCanvasSize() {
      const video = typeof getVideoEl === "function" ? getVideoEl() : $("viewerVideo");
      if (!video || !poseCanvas || !poseCtx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(video.clientWidth * dpr));
      const h = Math.max(1, Math.round(video.clientHeight * dpr));

      if (poseCanvas.width !== w) poseCanvas.width = w;
      if (poseCanvas.height !== h) poseCanvas.height = h;

      // visually match the video
      poseCanvas.style.width = "100%";
      poseCanvas.style.height = "100%";

      // draw in CSS pixel coords
      poseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function setStatus(msg) {
      const hint = $("viewerVcHint");
      if (hint) hint.textContent = msg || "";
    }

    function setButtonsRunning(running) {
      const startBtn = $("viewerPoseStart");
      const stopBtn = $("viewerPoseStop");

      if (startBtn) startBtn.disabled = !!running;
      if (stopBtn) stopBtn.disabled = !running;

      const jointPanel = $("viewerJointAnalysis");
      if (jointPanel) jointPanel.hidden = !running;
    }

    function initMoveNetGlobals() {
      const video = typeof getVideoEl === "function" ? getVideoEl() : $("viewerVideo");
      poseCanvas = $(canvasId);

      if (!video || !poseCanvas) return false;

      poseCtx = poseCanvas.getContext("2d");
      if (!poseCtx) return false;

      // Globals expected by movenet.js
      window.video = video;
      window.canvas = poseCanvas;
      window.ctx = poseCtx;

      window.syncVideoAndCanvasSize = syncVideoAndCanvasSize;
      window.setStatus = setStatus;
      window.setButtonsRunning = setButtonsRunning;

      window.formatTime = (t) => {
        const s = Math.max(0, Number(t) || 0);
        const mm = Math.floor(s / 60);
        const ss = Math.floor(s % 60);
        return `${mm}:${String(ss).padStart(2, "0")}`;
      };

      video.addEventListener("loadedmetadata", syncVideoAndCanvasSize, { once: true });
      return true;
    }

    function setPoseButtonsEnabled(enabled) {
      const startBtn = $("viewerPoseStart");
      const stopBtn = $("viewerPoseStop");

      if (startBtn) startBtn.disabled = !enabled;
      if (stopBtn) stopBtn.disabled = true;
    }

    function wireMoveNetButtons(signal) {
      $("viewerPoseStart")?.addEventListener(
        "click",
        async () => {
          try {
            setStatus("Loading MoveNet…");
            await ensureMoveNetDeps();
            await loadMoveNetOnce();
          } catch (e) {
            setStatus("Failed to load MoveNet dependencies/scripts.");
            console.error(e);
            return;
          }

          if (!window.video || !window.canvas || !window.ctx) {
            const ok = initMoveNetGlobals();
            if (!ok) {
              setStatus("Pose overlay init failed (missing video/canvas).");
              return;
            }
          }

          syncVideoAndCanvasSize();

          if (typeof window.handleStart === "function") {
            window.handleStart();
            onPoseStateChanged?.({ running: true });
          } else {
            setStatus("MoveNet start function not found.");
          }
        },
        { signal }
      );

      $("viewerPoseStop")?.addEventListener(
        "click",
        () => {
          if (typeof window.handleStop === "function") window.handleStop();
          else if (typeof window.stopTracking === "function") window.stopTracking();

          clearPoseCanvas();
          setButtonsRunning(false);
          onPoseStateChanged?.({ running: false });
        },
        { signal }
      );
    }

    function wireJointAnalysisControls(signal) {
      const panel = $("viewerJointAnalysis");
      const jointSelect = $("viewerJointSelect");
      const getAngleBtn = $("viewerGetAngleBtn");
      const resetBtn = $("viewerResetJointsBtn");
      const listEl = $("viewerSelectedJointsList");

      const renderSelected = () => {
        const joints = typeof window.getSelectedJoints === "function" ? window.getSelectedJoints() : [];
        if (listEl) listEl.textContent = joints.length ? joints.join(", ") : "None";
        if (getAngleBtn) getAngleBtn.disabled = joints.length < 3;
      };

      if (panel) panel.hidden = true;

      jointSelect?.addEventListener(
        "change",
        () => {
          const name = jointSelect.value;
          if (!name) return;

          if (typeof window.addSelectedJoint === "function") {
            window.addSelectedJoint(name);
            renderSelected();
          }

          jointSelect.value = "";
        },
        { signal }
      );

      getAngleBtn?.addEventListener(
        "click",
        () => {
          if (typeof window.measureAngle !== "function") return;

          const angle = window.measureAngle();
          if (angle == null) {
            setStatus("Angle not available yet (pose not confident or not detected).");
            return;
          }

          setStatus(`Angle measured: ${angle.toFixed(1)}° (overlay will keep updating)`);
          renderSelected();
        },
        { signal }
      );

      resetBtn?.addEventListener(
        "click",
        () => {
          if (typeof window.resetJointAnalysis === "function") window.resetJointAnalysis();
          renderSelected();
          setStatus("Joint selections reset.");
        },
        { signal }
      );

      renderSelected();
    }

    async function init(signal) {
      const ok = initMoveNetGlobals();
      setPoseButtonsEnabled(ok);

      wireMoveNetButtons(signal);
      wireJointAnalysisControls(signal);

      if (!ok) clearPoseCanvas();
    }

    return { init, clearPoseCanvas };
  }

  window.MoveSyncViewerPoseOverlay = { create };
})();