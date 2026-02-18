// =======================================
// Feature: Time Sync panel
// File: app/navigation/session-viewer/time-sync/time-sync.js
// =======================================

(() => {
  "use strict";

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

  function buildPanelMarkup() {
    return `
      <div class="viewer-card-title">
        <i class="bx bx-shuffle" aria-hidden="true"></i>
        Time Sync
      </div>

      <div class="viewer-sync">
        <!-- NEW: 2-column values grid -->
        <div class="viewer-syncGrid">
          <div class="viewer-syncCol">
            <div class="viewer-syncRow">
              <div class="viewer-syncLabel">Video marker</div>
              <div class="viewer-syncValue viewer-mono" id="viewerSyncVideoT">—</div>
            </div>

            <div class="viewer-syncRow">
              <div class="viewer-syncLabel">IMU marker</div>
              <div class="viewer-syncValue viewer-mono" id="viewerSyncImuT">—</div>
            </div>

            <div class="viewer-syncRow">
              <div class="viewer-syncLabel">Offset</div>
              <div class="viewer-syncValue viewer-mono" id="viewerSyncOffset">—</div>
            </div>
          </div>

          <div class="viewer-syncCol">
            <div class="viewer-syncRow">
              <div class="viewer-syncLabel">T1 (start)</div>
              <div class="viewer-syncValue viewer-mono" id="viewerSyncT1">—</div>
            </div>

            <div class="viewer-syncRow">
              <div class="viewer-syncLabel">T2 (end)</div>
              <div class="viewer-syncValue viewer-mono" id="viewerSyncT2">—</div>
            </div>
          </div>
        </div>

        <div class="viewer-syncBtns">
          <button class="btn" id="viewerSyncMarkVideoBtn" type="button">
            <i class="bx bx-video" aria-hidden="true"></i>
            Mark video
          </button>

          <button class="btn btn-ghost" id="viewerSyncMarkImuBtn" type="button">
            <i class="bx bx-pin" aria-hidden="true"></i>
            Mark IMU
          </button>

          <button class="btn" id="viewerSyncComputeOffsetBtn" type="button">
            <i class="bx bx-calculator" aria-hidden="true"></i>
            Compute offset
          </button>

          <div class="viewer-syncToggleGroup" role="group" aria-label="IMU cursor mode">
            <button class="viewer-syncToggle" id="viewerFollowVideoBtn" type="button" aria-pressed="false">
              <i class="bx bx-play-circle" aria-hidden="true"></i>
              Follow video
            </button>

            <button class="viewer-syncToggle" id="viewerUnfollowVideoBtn" type="button" aria-pressed="true">
              <i class="bx bx-hand" aria-hidden="true"></i>
              Manual
            </button>
          </div>

          <button class="btn" id="viewerSyncMarkT1Btn" type="button">
            <i class="bx bx-time-five" aria-hidden="true"></i>
            Mark T1
          </button>

          <button class="btn" id="viewerSyncMarkT2Btn" type="button">
            <i class="bx bx-time" aria-hidden="true"></i>
            Mark T2
          </button>

          <button class="btn btn-ghost" id="viewerSyncResetTBtn" type="button">
            <i class="bx bx-reset" aria-hidden="true"></i>
            Reset T1/T2
          </button>

          <button class="btn btn-primary" id="viewerSyncApplyTimeframeBtn" type="button" disabled>
            <i class="bx bx-crop" aria-hidden="true"></i>
            Apply Timeframe
          </button>

          <button class="btn btn-ghost" id="viewerSyncClearBtn" type="button">
            <i class="bx bx-x" aria-hidden="true"></i>
            Clear
          </button>
        </div>

        <div class="viewer-syncHint" id="viewerSyncHint" aria-live="polite"></div>
      </div>
    `.trim();
  }

  function ensureMounted() {
    const mount = $("viewerTimeSyncPanelMount");
    if (!mount) return null;

    if (!mount.dataset.mounted) {
      mount.innerHTML = buildPanelMarkup();
      mount.dataset.mounted = "1";
    }
    return mount;
  }

  function create({
    // getters
    getVideoEl,
    getImuCursorX, // should return seconds (number) or null
    getImuMarkerX, // should return seconds (number) or null

    // setters (optional)
    setImuMarkerX, // (x:number|null) => void
  } = {}) {
    const state = {
      videoMarkerT: null, // seconds (video)
      offset: null, // seconds: videoT - imuT

      // IMPORTANT: T1/T2 are IMU time seconds (x-axis / slider)
      t1: null, // seconds (IMU)
      t2: null, // seconds (IMU)
    };

    function setText(id, txt) {
      const el = $(id);
      if (el) el.textContent = txt ?? "";
    }

    function setHint(msg) {
      const el = $("viewerSyncHint");
      if (el) el.textContent = msg ?? "";
    }

    function fmtV(t) {
      return t == null ? "—" : `${Number(t).toFixed(3)} s`;
    }

    function fmtI(x) {
      return x == null ? "—" : `${Number(x).toFixed(3)} s`;
    }

    function setModeUI(followVideo) {
      const follow = $("viewerFollowVideoBtn");
      const manual = $("viewerUnfollowVideoBtn");
      if (!follow || !manual) return;

      follow.setAttribute("aria-pressed", followVideo ? "true" : "false");
      manual.setAttribute("aria-pressed", followVideo ? "false" : "true");
    }

    function setFollowVideoMode(followVideo) {
      window.IMU_STATE = window.IMU_STATE || {};
      window.IMU_STATE.followVideo = !!followVideo;

      setModeUI(!!followVideo);

      document.dispatchEvent(
        new CustomEvent("movesync:time-sync-mode-changed", {
          detail: { followVideo: !!followVideo },
        })
      );
    }

    function setFollowManualEnabled(enabled) {
      const follow = $("viewerFollowVideoBtn");
      const manual = $("viewerUnfollowVideoBtn");
      if (!follow || !manual) return;

      if (enabled) {
        follow.removeAttribute("disabled");
        manual.removeAttribute("disabled");
      } else {
        follow.setAttribute("disabled", "");
        manual.setAttribute("disabled", "");
      }
    }

    function forceManualMode() {
      setFollowVideoMode(false);
    }

    function setApplyEnabled(enabled) {
      const btn = $("viewerSyncApplyTimeframeBtn");
      if (!btn) return;
      if (enabled) btn.removeAttribute("disabled");
      else btn.setAttribute("disabled", "");
    }

    function canApplyTimeframe() {
      return Number.isFinite(state.t1) && Number.isFinite(state.t2) && state.t1 !== state.t2;
    }

    function render() {
      // Ensure DOM exists before writing into it
      const mount = ensureMounted();
      if (!mount) return;

      const imuMarker = typeof getImuMarkerX === "function" ? getImuMarkerX() : null;

      setText("viewerSyncVideoT", fmtV(state.videoMarkerT));
      setText("viewerSyncImuT", fmtI(imuMarker));
      setText("viewerSyncOffset", state.offset == null ? "—" : `${state.offset.toFixed(3)} s`);

      // Display T1/T2 as IMU seconds
      setText("viewerSyncT1", fmtI(state.t1));
      setText("viewerSyncT2", fmtI(state.t2));

      setApplyEnabled(canApplyTimeframe());
    }

    function markVideo() {
      const v = typeof getVideoEl === "function" ? getVideoEl() : $("viewerVideo");
      if (!v || !Number.isFinite(v.currentTime)) return;
      state.videoMarkerT = Number(v.currentTime);
      render();
    }

    function markImu() {
      const x = typeof getImuCursorX === "function" ? getImuCursorX() : null;
      if (!Number.isFinite(x)) return;

      // Store marker through viewer (so charts can update), otherwise just render it from getter.
      if (typeof setImuMarkerX === "function") setImuMarkerX(Number(x));
      render();
    }

    function computeOffset() {
      const imuMarker = typeof getImuMarkerX === "function" ? getImuMarkerX() : null;
      if (!Number.isFinite(state.videoMarkerT) || !Number.isFinite(imuMarker)) return;

      // offset definition: videoT = imuT + offset  => offset = videoT - imuT
      state.offset = Number(state.videoMarkerT) - Number(imuMarker);
      render();

      setFollowManualEnabled(true);
      forceManualMode(); // default after compute is Manual

      document.dispatchEvent(new CustomEvent("movesync:time-sync-changed", { detail: { ...state } }));
    }

    function clearAll() {
      state.videoMarkerT = null;
      state.offset = null;
      state.t1 = null;
      state.t2 = null;

      if (typeof setImuMarkerX === "function") setImuMarkerX(null);

      // Clear IMU timeframe + markers as well
      document.dispatchEvent(new CustomEvent("movesync:imu-timeframe-reset"));

      render();

      setFollowManualEnabled(false);
      forceManualMode();

      document.dispatchEvent(new CustomEvent("movesync:time-sync-changed", { detail: { ...state } }));
      setHint("");
    }

    // -----------------------------
    // T1/T2 are IMU-time markings (vertical lines on IMU charts)
    // -----------------------------
    function markT1() {
      const x = typeof getImuCursorX === "function" ? getImuCursorX() : null;
      if (!Number.isFinite(x)) return;

      state.t1 = Number(x);
      render();

      document.dispatchEvent(
        new CustomEvent("movesync:imu-timeframe-marked", {
          detail: { t1: state.t1, t2: state.t2 },
        })
      );

      setHint(`Marked T1 at ${state.t1.toFixed(3)} s (IMU).`);
    }

    function markT2() {
      const x = typeof getImuCursorX === "function" ? getImuCursorX() : null;
      if (!Number.isFinite(x)) return;

      state.t2 = Number(x);
      render();

      document.dispatchEvent(
        new CustomEvent("movesync:imu-timeframe-marked", {
          detail: { t1: state.t1, t2: state.t2 },
        })
      );

      setHint(`Marked T2 at ${state.t2.toFixed(3)} s (IMU).`);
    }

    function resetT1T2() {
      state.t1 = null;
      state.t2 = null;

      document.dispatchEvent(new CustomEvent("movesync:imu-timeframe-reset"));

      render();
      setHint("Cleared T1/T2.");
    }

    function applyTimeframe() {
      if (!canApplyTimeframe()) return;

      const start = Math.min(state.t1, state.t2);
      const end = Math.max(state.t1, state.t2);

      document.dispatchEvent(
        new CustomEvent("movesync:imu-timeframe-applied", {
          detail: { start, end, t1: state.t1, t2: state.t2 },
        })
      );

      setHint(`Applied IMU timeframe: ${start.toFixed(3)} s → ${end.toFixed(3)} s.`);
    }

    function wire(signal) {
      // Mount immediately so buttons/labels exist
      ensureMounted();

      // Follow/Manual are locked until an offset exists
      setFollowManualEnabled(false);
      forceManualMode();

      $("viewerSyncMarkVideoBtn")?.addEventListener("click", markVideo, { signal });
      $("viewerSyncMarkImuBtn")?.addEventListener("click", markImu, { signal });
      $("viewerSyncComputeOffsetBtn")?.addEventListener("click", computeOffset, { signal });
      $("viewerSyncClearBtn")?.addEventListener("click", clearAll, { signal });

      $("viewerSyncMarkT1Btn")?.addEventListener("click", markT1, { signal });
      $("viewerSyncMarkT2Btn")?.addEventListener("click", markT2, { signal });
      $("viewerSyncResetTBtn")?.addEventListener("click", resetT1T2, { signal });
      $("viewerSyncApplyTimeframeBtn")?.addEventListener("click", applyTimeframe, { signal });

      $("viewerFollowVideoBtn")?.addEventListener(
        "click",
        () => {
          if ($("viewerFollowVideoBtn")?.hasAttribute("disabled")) return;
          setFollowVideoMode(true);
        },
        { signal }
      );

      $("viewerUnfollowVideoBtn")?.addEventListener(
        "click",
        () => {
          if ($("viewerUnfollowVideoBtn")?.hasAttribute("disabled")) return;
          setFollowVideoMode(false);
        },
        { signal }
      );

      document.addEventListener(
        "movesync:active-session-changed",
        () => {
          clearAll();
        },
        { signal }
      );

      render();
    }

    return { wire, render, getState: () => ({ ...state }) };
  }

  window.MoveSyncViewerTimeSync = { create };
})();