// =======================================
// Feature: MoveNet overlay + joint analysis UI
// File: app/navigation/session-viewer/video-panel/pose-overlay/pose-overlay.js
// =======================================

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // movenet.js sits in the SAME folder as this file
  const MOVENET_SRC = new URL("./movenet.js", document.currentScript?.src || location.href).href;

  // =======================================
  // Robust external dependency loader
  // =======================================

  function loadScriptOnce(src, globalCheck) {
    window.__MoveSyncScriptPromises ??= {};

    if (globalCheck?.()) return Promise.resolve();

    if (window.__MoveSyncScriptPromises[src]) {
      return window.__MoveSyncScriptPromises[src];
    }

    window.__MoveSyncScriptPromises[src] = new Promise((resolve, reject) => {
      let existing = document.querySelector(`script[src="${src}"]`);

      if (!existing) {
        existing = document.createElement("script");
        existing.src = src;
        existing.async = true;
        document.head.appendChild(existing);
      }

      const checkReady = () => {
        try {
          if (globalCheck?.()) {
            resolve();
            return true;
          }
        } catch {}

        return false;
      };

      // If already loaded
      if (checkReady()) return;

      existing.addEventListener("load", () => {
        const waitForGlobal = () => {
          if (checkReady()) return;
          requestAnimationFrame(waitForGlobal);
        };
        waitForGlobal();
      });

      existing.addEventListener("error", () => {
        reject(new Error("Failed to load script: " + src));
      });
    });

    return window.__MoveSyncScriptPromises[src];
  }


  // =======================================
  // Ensure TensorFlow + poseDetection
  // =======================================

  async function ensureMoveNetDeps() {

    window.__MoveNetDepsPromise ??= (async () => {

      // 1️⃣ Load TensorFlow
      await loadScriptOnce(
        "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js",
        () => window.tf && typeof window.tf.ready === "function"
      );

      // 2️⃣ Wait for TFJS backend
      await tf.ready();

      // 3️⃣ Load pose detection
      await loadScriptOnce(
        "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js",
        () => window.poseDetection && typeof window.poseDetection.createDetector === "function"
      );

      // 4️⃣ Ensure WebGL backend
      try {
        const backend = tf.getBackend?.();
        if (backend !== "webgl") {
          await tf.setBackend("webgl");
          await tf.ready();
        }
      } catch (err) {
        console.warn("WebGL backend unavailable, using:", tf.getBackend?.());
      }

    })();

    return window.__MoveNetDepsPromise;
  }


  // =======================================
  // Load movenet.js (local script)
  // =======================================

  function loadMoveNetOnce() {

    const isReady = () =>
      typeof window.handleStart === "function" &&
      typeof window.handleStop === "function";

    if (isReady()) return Promise.resolve();

    window.__MoveNetScriptPromise ??= new Promise((resolve, reject) => {

      const src = new URL("./movenet.js", document.currentScript.src).href;

      let script = document.querySelector(`script[src="${src}"]`);

      if (!script) {
        script = document.createElement("script");
        script.src = src;
        script.async = true;
        document.head.appendChild(script);
      }

      const waitUntilReady = () => {
        if (isReady()) {
          resolve();
          return;
        }
        requestAnimationFrame(waitUntilReady);
      };

      script.addEventListener("load", waitUntilReady);
      script.addEventListener("error", () => reject(new Error("Failed to load movenet.js")));

      waitUntilReady();
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