// =======================================
// MoveSync feature module: Video Panel (Session Viewer)
// File: app/navigation/session-viewer/video-panel/video-panel.js
// =======================================
(() => {
  "use strict";

  // --- Video Panel dep loader (exposes a promise so Session Viewer can wait) ---
  window.__videoPanelDepsPromise =
    window.__videoPanelDepsPromise ||
    (async function ensureVideoPanelDeps() {
      if (window.__videoPanelDepsLoaded) return;

      const deps = [
        "app/navigation/session-viewer/video-panel/arm-angle-analysis/arm-angle-analysis.js",
        "app/navigation/session-viewer/video-panel/pose-overlay/pose-overlay.js",
        "app/navigation/session-viewer/video-panel/video-metadata/video-metadata.js",
      ];

      const loadedSet =
        window.MoveSyncApp?.state?.loadedScripts ??
        (window.__MoveSyncLoadedScripts ??= new Set());

      function loadOnce(src) {
        return new Promise((resolve, reject) => {
          if (!src) return resolve();
          if (loadedSet.has(src)) return resolve();

          if (document.querySelector(`script[data-video-panel-src="${src}"]`)) {
            loadedSet.add(src);
            return resolve();
          }

          const s = document.createElement("script");
          s.src = src;
          s.async = false;
          s.dataset.videoPanelSrc = src;

          s.onload = () => {
            loadedSet.add(src);
            resolve();
          };
          s.onerror = () => reject(new Error("Video Panel dep failed to load: " + src));

          document.body.appendChild(s);
        });
      }

      for (const src of deps) await loadOnce(src);

      window.__videoPanelDepsLoaded = true;
    })();

  const $ = (id) => document.getElementById(id);

  function clamp(n, a, b) {
    const v = Number(n);
    if (!Number.isFinite(v)) return a;
    return Math.min(b, Math.max(a, v));
  }

  function fmtClock(t) {
    const s = Math.max(0, Number(t) || 0);
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${mm}:${String(ss).padStart(2, "0")}`;
  }

  function getMarkup() {
    return `
      <div class="viewer-card-title">
        <i class="bx bx-video" aria-hidden="true"></i>
        Video
      </div>

      <div class="viewer-videoWrap" id="viewerVideoWrap">
        <video id="viewerVideo" class="viewer-video" playsinline preload="metadata"></video>

        <!-- MoveNet pose overlay canvas -->
        <canvas id="viewerPoseCanvas" class="viewer-poseCanvas" aria-hidden="true"></canvas>

        <!-- Info button + metadata popover -->
        <button
          class="viewer-infoBtn"
          id="viewerVideoInfoBtn"
          type="button"
          aria-label="Show video metadata"
          aria-expanded="false"
          aria-controls="viewerVideoMetaPopover"
        >
          <i class="bx bx-info-circle" aria-hidden="true"></i>
        </button>

        <div
          class="viewer-metaPopover"
          id="viewerVideoMetaPopover"
          role="dialog"
          aria-label="Video metadata"
          hidden
        >
          <div id="viewerVideoMetaPopoverMount"></div>
        </div>

        <div id="viewerVideoEmpty" class="viewer-empty" hidden>
          <div class="viewer-empty-title">No video available</div>
          <div class="viewer-empty-desc">Upload a session with a video to see it here.</div>
        </div>
      </div>

      <!-- Custom video controls -->
      <div
        class="viewer-videoControls"
        id="viewerVideoControls"
        hidden
        aria-label="Video controls"
      >
        <div class="viewer-vcTop">
          <button class="viewer-vcBtn" id="viewerVcPlay" type="button" aria-label="Play">
            <i class="bx bx-play" aria-hidden="true"></i>
          </button>

          <button class="viewer-vcBtn" id="viewerVcRepeat" type="button" aria-label="Repeat" aria-pressed="false">
            <i class="bx bx-repeat" aria-hidden="true"></i>
          </button>

          <!-- Pose overlay controls -->
          <button class="viewer-vcBtn" id="viewerPoseStart" type="button" aria-label="Start motion tracking" disabled aria-pressed="false">
            <i class="bx bx-body" aria-hidden="true"></i>
          </button>
          <button class="viewer-vcBtn" id="viewerPoseStop" type="button" aria-label="Stop motion tracking" disabled aria-pressed="false">
            <i class="bx bx-stop" aria-hidden="true"></i>
          </button>

          <div class="viewer-vcTime" aria-label="Playback time">
            <span id="viewerVcTime">0:00</span>
            <span class="viewer-vcTimeSep">/</span>
            <span id="viewerVcDur">0:00</span>
          </div>

          <div class="viewer-vcSpacer"></div>

          <div class="viewer-vcSpeedRow" aria-label="Playback speed">
            <span class="viewer-vcSpeedLabel">Speed</span>

            <div class="viewer-vcSpeedPills" role="group" aria-label="Speed options">
              <button class="viewer-vcPill" type="button" data-rate="0.25">0.25×</button>
              <button class="viewer-vcPill" type="button" data-rate="0.5">0.5×</button>
              <button class="viewer-vcPill is-active" type="button" data-rate="1">1×</button>
              <button class="viewer-vcPill" type="button" data-rate="1.5">1.5×</button>
              <button class="viewer-vcPill" type="button" data-rate="2">2×</button>
            </div>
          </div>

          <button class="viewer-vcBtn" id="viewerVcFs" type="button" aria-label="Fullscreen">
            <i class="bx bx-fullscreen" aria-hidden="true"></i>
          </button>
        </div>

        <div class="viewer-vcSeekWrap" aria-label="Seek">
          <input
            id="viewerVcSeek"
            class="viewer-vcSeek"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value="0"
            aria-label="Seek"
          />
          <div id="viewerVcSeekMarker" class="viewer-vcSeekMarker" hidden aria-hidden="true"></div>
        </div>

        <div class="viewer-vcBottom">
          <button class="viewer-vcBtn" id="viewerVcMute" type="button" aria-label="Mute">
            <i class="bx bx-volume-full" aria-hidden="true"></i>
          </button>

          <input
            id="viewerVcVol"
            class="viewer-vcVol"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value="1"
            aria-label="Volume"
          />

          <div class="viewer-vcHint" id="viewerVcHint" aria-live="polite"></div>
        </div>

        <!-- Joint Analysis Controls -->
        <div class="viewer-joint" id="viewerJointAnalysis" hidden>
          <div class="viewer-joint-row">
            <div class="viewer-joint-select">
              <label for="viewerJointSelect" class="viewer-joint-label">Select Joint:</label>
              <select id="viewerJointSelect" class="viewer-jointSelect">
                <option value="">-- Select a joint --</option>
                <option value="left_ankle">Left Ankle</option>
                <option value="left_ear">Left Ear</option>
                <option value="left_elbow">Left Elbow</option>
                <option value="left_eye">Left Eye</option>
                <option value="left_hip">Left Hip</option>
                <option value="left_knee">Left Knee</option>
                <option value="left_shoulder">Left Shoulder</option>
                <option value="left_wrist">Left Wrist</option>
                <option value="nose">Nose</option>
                <option value="right_ankle">Right Ankle</option>
                <option value="right_ear">Right Ear</option>
                <option value="right_elbow">Right Elbow</option>
                <option value="right_eye">Right Eye</option>
                <option value="right_hip">Right Hip</option>
                <option value="right_knee">Right Knee</option>
                <option value="right_shoulder">Right Shoulder</option>
                <option value="right_wrist">Right Wrist</option>
              </select>
            </div>

            <div class="viewer-joint-btns">
              <button class="btn" id="viewerGetAngleBtn" type="button" disabled title="Select 3 joints to measure angle">
                <i class="bx bx-math" aria-hidden="true"></i>
                Get Angle
              </button>
              <button class="btn btn-ghost" id="viewerResetJointsBtn" type="button">
                <i class="bx bx-reset" aria-hidden="true"></i>
                Reset
              </button>
            </div>

            <div class="viewer-joint-selected">
              Selected: <span id="viewerSelectedJointsList">None</span>
            </div>
          </div>
        </div>

      </div>
    `;
  }

  function create({ canvasId = "viewerPoseCanvas" } = {}) {
    let currentVideoUrl = null;
    let controller = null;
    let poseOverlay = null;

    function showVideoEmpty(show) {
      const empty = $("viewerVideoEmpty");
      if (empty) empty.hidden = !show;
    }

    function setVideoControlsVisible(visible, hintText) {
      const controls = $("viewerVideoControls");
      if (controls) controls.hidden = !visible;

      const hint = $("viewerVcHint");
      if (hint) hint.textContent = hintText || "";
    }

    function clearVideo() {
      const videoEl = $("viewerVideo");
      if (!videoEl) return;

      if (currentVideoUrl) {
        try { URL.revokeObjectURL(currentVideoUrl); } catch {}
        currentVideoUrl = null;
      }

      try { videoEl.pause?.(); } catch {}
      videoEl.removeAttribute("src");
      try { videoEl.load?.(); } catch {}
    }

    function resetControlsUI({ rewind = true } = {}) {
      const v = $("viewerVideo");
      if (v) {
        // Always normalize state on page entry
        try { v.pause?.(); } catch {}
        try { v.playbackRate = 1; } catch {}
        try { v.muted = false; } catch {}
        try { v.volume = 1; } catch {}
        try { v.loop = false; } catch {}

        if (rewind) {
          try { v.currentTime = 0; } catch {}
        }
      }

      // Play icon
      const playBtn = $("viewerVcPlay");
      const icon = playBtn?.querySelector("i");
      if (icon) icon.className = "bx bx-play";

      // Repeat visual reset (OFF by default)
      const repeatBtn = $("viewerVcRepeat");
      if (repeatBtn) {
        repeatBtn.classList.remove("is-active-repeat");
        repeatBtn.setAttribute("aria-pressed", "false");
      }

      // Movement visual reset (OFF by default)
      const startBtn = $("viewerPoseStart");
      if (startBtn) {
        startBtn.classList.remove("is-active-movement");
        startBtn.setAttribute("aria-pressed", "false");
      }
      const stopBtn = $("viewerPoseStop");
      if (stopBtn) {
        stopBtn.classList.remove("is-active-stop");
        stopBtn.setAttribute("aria-pressed", "false");
      }

      // Seek slider
      const slider = $("viewerVcSeek");
      if (slider) {
        slider.value = "0";
        slider.max = "1";
      }

      // Times
      const timeCur = $("viewerVcTime");
      const timeDur = $("viewerVcDur");
      if (timeCur) timeCur.textContent = "0:00";
      if (timeDur) timeDur.textContent = "0:00";

      // Speed pills -> 1× active
      document.querySelectorAll(".viewer-vcPill").forEach((p) => {
        const r = Number(p.dataset.rate);
        p.classList.toggle("is-active", Number.isFinite(r) && r === 1);
      });

      // Mute icon
      const muteBtn = $("viewerVcMute");
      const muteIcon = muteBtn?.querySelector("i");
      if (muteIcon) muteIcon.className = "bx bx-volume-full";

      // Volume slider
      const vol = $("viewerVcVol");
      if (vol) vol.value = "1";

      // Hint/status
      const hint = $("viewerVcHint");
      if (hint) hint.textContent = "";

      // Seek marker hidden
      $("viewerVcSeekMarker")?.setAttribute("hidden", "");

      // Info popover closed + unpinned
      const infoBtn = $("viewerVideoInfoBtn");
      const pop = $("viewerVideoMetaPopover");
      if (pop) pop.hidden = true;
      if (infoBtn) {
        infoBtn.classList.remove("is-pinned");
        infoBtn.setAttribute("aria-expanded", "false");
      }

      // Joint analysis UI hidden + reset if possible
      $("viewerJointAnalysis")?.setAttribute("hidden", "");
      try { window.resetJointAnalysis?.(); } catch {}
      const listEl = $("viewerSelectedJointsList");
      if (listEl) listEl.textContent = "None";
      const getAngleBtn = $("viewerGetAngleBtn");
      if (getAngleBtn) getAngleBtn.disabled = true;
      const jointSelect = $("viewerJointSelect");
      if (jointSelect) jointSelect.value = "";
    }

    function wireVideoControls(signal) {
      const v = $("viewerVideo");
      if (!v) return;

      const playBtn = $("viewerVcPlay");
      const slider = $("viewerVcSeek");
      const timeCur = $("viewerVcTime");
      const timeDur = $("viewerVcDur");

      const speedPills = document.querySelectorAll(".viewer-vcPill");
      speedPills.forEach((pill) => {
        pill.addEventListener(
          "click",
          () => {
            const rate = Number(pill.dataset.rate);
            if (!Number.isFinite(rate)) return;

            v.playbackRate = rate;

            speedPills.forEach((p) => p.classList.remove("is-active"));
            pill.classList.add("is-active");
          },
          { signal }
        );
      });

      const repeatBtn = $("viewerVcRepeat");
      repeatBtn?.addEventListener(
        "click",
        () => {
          v.loop = !v.loop; // repeats forever when true

          // ✅ green when ON (requires CSS for .is-active-repeat)
          repeatBtn.classList.toggle("is-active-repeat", v.loop);
          repeatBtn.setAttribute("aria-pressed", v.loop ? "true" : "false");
        },
        { signal }
      );

      // Fullscreen toggle
      const fsBtn = $("viewerVcFs");
      const wrap = $("viewerVideoWrap");
      fsBtn?.addEventListener(
        "click",
        async () => {
          try {
            if (!document.fullscreenElement) {
              await wrap?.requestFullscreen?.();
            } else {
              await document.exitFullscreen?.();
            }
          } catch (err) {
            console.warn("Fullscreen failed:", err);
          }
        },
        { signal }
      );

      playBtn?.addEventListener(
        "click",
        () => {
          if (v.paused) v.play?.();
          else v.pause?.();
        },
        { signal }
      );

      slider?.addEventListener(
        "input",
        () => {
          if (!Number.isFinite(v.duration)) return;
          v.currentTime = clamp(Number(slider.value) || 0, 0, v.duration);
        },
        { signal }
      );

      // Mute + Volume
      const muteBtn = $("viewerVcMute");
      const vol = $("viewerVcVol");

      muteBtn?.addEventListener(
        "click",
        () => {
          v.muted = !v.muted;
          const mi = muteBtn.querySelector("i");
          if (mi) mi.className = v.muted ? "bx bx-volume-mute" : "bx bx-volume-full";
        },
        { signal }
      );

      vol?.addEventListener(
        "input",
        () => {
          const nv = clamp(Number(vol.value), 0, 1);
          v.volume = nv;
          if (nv === 0) v.muted = true;
          if (nv > 0 && v.muted) v.muted = false;

          const mi = muteBtn?.querySelector("i");
          if (mi) mi.className = v.muted ? "bx bx-volume-mute" : "bx bx-volume-full";
        },
        { signal }
      );

      const refresh = () => {
        if (slider) {
          slider.max = Number.isFinite(v.duration) ? String(v.duration) : "1";
          slider.value = Number.isFinite(v.currentTime) ? String(v.currentTime) : "0";
        }
        if (timeCur) timeCur.textContent = fmtClock(v.currentTime || 0);
        if (timeDur) timeDur.textContent = fmtClock(Number.isFinite(v.duration) ? v.duration : 0);

        const icon = playBtn?.querySelector("i");
        if (icon) icon.className = v.paused ? "bx bx-play" : "bx bx-pause";

        speedPills.forEach((p) => {
          const r = Number(p.dataset.rate);
          p.classList.toggle("is-active", Number.isFinite(r) && r === v.playbackRate);
        });

        const muteIcon = muteBtn?.querySelector("i");
        if (muteIcon) muteIcon.className = v.muted ? "bx bx-volume-mute" : "bx bx-volume-full";
        if (vol && Number.isFinite(v.volume)) vol.value = String(v.volume);

        // Keep repeat button UI synced with actual loop state
        if (repeatBtn) {
          repeatBtn.classList.toggle("is-active-repeat", !!v.loop);
          repeatBtn.setAttribute("aria-pressed", v.loop ? "true" : "false");
        }
      };

      v.addEventListener("timeupdate", refresh, { signal });
      v.addEventListener("loadedmetadata", refresh, { signal });
      v.addEventListener("play", refresh, { signal });
      v.addEventListener("pause", refresh, { signal });
      v.addEventListener("volumechange", refresh, { signal });

      refresh();
    }

    function wireInfoPopover(signal) {
      const btn = $("viewerVideoInfoBtn");
      const pop = $("viewerVideoMetaPopover");
      const wrap = $("viewerVideoWrap");
      if (!btn || !pop || !wrap) return;

      let pinned = false;

      const show = (open) => {
        pop.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      };

      const openHover = () => { if (!pinned) show(true); };
      const closeHover = () => { if (!pinned) show(false); };

      btn.addEventListener("mouseenter", openHover, { signal });
      btn.addEventListener("mouseleave", closeHover, { signal });
      btn.addEventListener("focus", openHover, { signal });
      btn.addEventListener("blur", closeHover, { signal });

      pop.addEventListener("mouseenter", () => show(true), { signal });
      pop.addEventListener("mouseleave", () => { if (!pinned) show(false); }, { signal });

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        pinned = !pinned;
        btn.classList.toggle("is-pinned", pinned);
        show(true);
      }, { signal });

      document.addEventListener("mousedown", (e) => {
        if (pop.hidden) return;
        const t = e.target;
        if (wrap.contains(t)) {
          if (!btn.contains(t) && !pop.contains(t) && pinned) {
            pinned = false;
            btn.classList.remove("is-pinned");
            show(false);
          }
          return;
        }
        pinned = false;
        btn.classList.remove("is-pinned");
        show(false);
      }, { signal });

      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        pinned = false;
        btn.classList.remove("is-pinned");
        show(false);
        btn.blur?.();
      }, { signal });
    }

    function mount() {
      const mountEl = $("viewerVideoPanelMount");
      if (!mountEl) return;
      mountEl.innerHTML = getMarkup();
    }

    function init(signal) {
      if (!$("viewerVideo")) {
        mount();
      }

      controller?.abort?.();
      controller = new AbortController();

      if (signal) {
        signal.addEventListener(
          "abort",
          () => controller?.abort?.(),
          { once: true }
        );
      }

      wireVideoControls(controller.signal);
      wireInfoPopover(controller.signal);

      // Pose overlay wiring (does NOT auto-load MoveNet; only loads on Start click)
      poseOverlay = window.MoveSyncViewerPoseOverlay?.create?.({
        getVideoEl: () => $("viewerVideo"),
        canvasId,

        // When movement starts/stops, color the Start/Stop buttons
        onPoseStateChanged: ({ running }) => {
          const startBtn = $("viewerPoseStart");
          const stopBtn = $("viewerPoseStop");

          // Start button blue when running
          if (startBtn) {
            startBtn.classList.toggle("is-active-movement", !!running);
            startBtn.setAttribute("aria-pressed", running ? "true" : "false");
          }

          // Stop button red when running
          if (stopBtn) {
            stopBtn.classList.toggle("is-active-stop", !!running);
            stopBtn.setAttribute("aria-pressed", running ? "true" : "false");
          }
        },
      });
      poseOverlay?.init?.(controller.signal);

      // Empty state events
      const videoEl = $("viewerVideo");
      videoEl?.addEventListener("loadeddata", () => showVideoEmpty(false), { signal: controller.signal });
      videoEl?.addEventListener("error", () => showVideoEmpty(true), { signal: controller.signal });
      videoEl?.addEventListener("emptied", () => showVideoEmpty(true), { signal: controller.signal });

      // ✅ Force a reset every time the panel is (re)initialized (page entry)
      resetUI({ rewind: true, stopPose: true });
    }

    function renderSession(session) {
      // Always stop pose + clear overlay when a session is rendered
      resetUI({ rewind: true, stopPose: true, keepSrc: false });

      clearVideo();

      const videoEl = $("viewerVideo");
      const videoFile = session?.videoFile || null;

      if (videoEl && videoFile) {
        currentVideoUrl = URL.createObjectURL(videoFile);
        videoEl.src = currentVideoUrl;
        videoEl.load();

        // ✅ On load: force start at 0, paused, 1×
        const onMeta = () => {
          try { videoEl.pause?.(); } catch {}
          try { videoEl.playbackRate = 1; } catch {}
          try { videoEl.currentTime = 0; } catch {}
          // ensure UI updates
          videoEl.dispatchEvent(new Event("pause"));
          videoEl.dispatchEvent(new Event("timeupdate"));
        };
        videoEl.addEventListener("loadedmetadata", onMeta, { once: true });

        showVideoEmpty(false);
        setVideoControlsVisible(true, "");
      } else {
        showVideoEmpty(true);
        setVideoControlsVisible(false, "");
      }
    }

    function renderNoSession() {
      resetUI({ rewind: true, stopPose: true, keepSrc: false });
      clearVideo();
      showVideoEmpty(true);
      setVideoControlsVisible(false, "Select a session with a video to enable playback.");
    }

    // Public: full reset callable by the page on entry
    function resetUI({ rewind = true, stopPose = true, keepSrc = true } = {}) {
      const v = $("viewerVideo");

      // Stop tracking WITHOUT initializing MoveNet
      if (stopPose) {
        try { poseOverlay?.reset?.(); } catch {}
        try {
          if (typeof window.handleStop === "function") window.handleStop();
          else if (typeof window.stopTracking === "function") window.stopTracking();
        } catch {}
      }

      // Clear overlay canvas regardless
      try { poseOverlay?.clearPoseCanvas?.(); } catch {}

      // Reset joints (if present)
      try { window.resetJointAnalysis?.(); } catch {}

      // Reset video state
      if (v) {
        try { v.pause?.(); } catch {}
        try { v.playbackRate = 1; } catch {}
        try { v.muted = false; } catch {}
        try { v.volume = 1; } catch {}
        try { v.loop = false; } catch {}
        if (rewind) {
          try { v.currentTime = 0; } catch {}
        }
        if (!keepSrc) {
          // caller wants to fully detach the source
          // (renderSession/renderNoSession will set up again)
        }
      }

      // Reset UI widgets
      resetControlsUI({ rewind });
    }

    function destroy() {
      controller?.abort?.();
      controller = null;

      // Ensure pose/video is stopped when leaving
      try { resetUI({ rewind: true, stopPose: true }); } catch {}

      poseOverlay = null;
      clearVideo();

      const mountEl = $("viewerVideoPanelMount");
      if (mountEl) mountEl.innerHTML = "";
    }

    return {
      mount,
      init,
      destroy,
      renderSession,
      renderNoSession,
      clearVideo,
      resetUI, // ✅ exposed
    };
  }

  window.MoveSyncViewerVideoPanel = { create };
})();