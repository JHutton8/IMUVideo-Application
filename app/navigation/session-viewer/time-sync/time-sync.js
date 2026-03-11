// =======================================
// Feature: Time Sync panel
// File: app/navigation/session-viewer/time-sync/time-sync.js
// =======================================

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function buildPanelMarkup() {
    return `
      <div class="viewer-card-title">
        <i class="bx bx-shuffle" aria-hidden="true"></i>
        Time Sync
      </div>

      <div class="viewer-sync">
        <!-- Values -->
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

            <div class="viewer-syncRow viewer-syncRow--applied">
              <div class="viewer-syncLabel">Applied</div>
              <div class="viewer-syncValue viewer-mono" id="viewerSyncAppliedWindow">—</div>
            </div>
          </div>
        </div>

        <!-- Actions: split into two guided columns -->
        <div class="viewer-syncActionGrid" aria-label="Time sync actions">
          <!-- LEFT: Compute Offset -->
          <section class="viewer-syncGroup viewer-syncGroup--offset" aria-label="Compute offset">
            <div class="viewer-syncGroupTitle">
              <div class="viewer-syncGroupTitleLeft">
                <i class="bx bx-calculator" aria-hidden="true"></i>
                Compute Offset
              </div>

              <div class="viewer-syncGroupTitleRight">
                <span class="viewer-syncGroupPill" title="Align video time to IMU time">Align</span>

                <!-- Compact cursor-mode control -->
                <div class="viewer-syncMiniMode" role="group" aria-label="IMU cursor mode">
                  <button
                    class="viewer-syncMiniToggle"
                    id="viewerFollowVideoBtn"
                    type="button"
                    aria-pressed="false"
                    title="Follow video (video drives IMU cursor using computed offset)"
                  >
                    <i class="bx bx-play-circle" aria-hidden="true"></i>
                    <span class="viewer-syncMiniText">Follow</span>
                  </button>

                  <button
                    class="viewer-syncMiniToggle"
                    id="viewerUnfollowVideoBtn"
                    type="button"
                    aria-pressed="true"
                    title="Manual (you control IMU cursor)"
                  >
                    <i class="bx bx-hand" aria-hidden="true"></i>
                    <span class="viewer-syncMiniText">Manual</span>
                  </button>
                </div>
              </div>
            </div>

            <div class="viewer-syncGroupBtns">
              <button class="btn" id="viewerSyncMarkVideoBtn" type="button" title="Pick a moment in the video">
                <span class="viewer-syncStep" aria-hidden="true">1</span>
                <i class="bx bx-video" aria-hidden="true"></i>
                Mark video
              </button>

              <button class="btn btn-ghost" id="viewerSyncMarkImuBtn" type="button" title="Pick the matching moment on the IMU cursor">
                <span class="viewer-syncStep" aria-hidden="true">2</span>
                <i class="bx bx-pin" aria-hidden="true"></i>
                Mark IMU
              </button>

              <button class="btn" id="viewerSyncComputeOffsetBtn" type="button" title="Compute offset from your two markers">
                <span class="viewer-syncStep" aria-hidden="true">3</span>
                <i class="bx bx-math" aria-hidden="true"></i>
                Compute
              </button>

              <!-- Reset (rightmost) -->
              <button class="btn btn-ghost" id="viewerSyncResetOffsetBtn" type="button" title="Reset offset + markers for offset computation">
                <i class="bx bx-x" aria-hidden="true"></i>
                Reset
              </button>
            </div>

            <div class="viewer-syncMicroHint">
              Cursor mode unlocks after offset is computed. We default to <b>Follow</b>.
            </div>
          </section>

          <!-- RIGHT: Apply Timeframe -->
          <section class="viewer-syncGroup viewer-syncGroup--timeframe" aria-label="Apply timeframe">
            <div class="viewer-syncGroupTitle">
              <div class="viewer-syncGroupTitleLeft">
                <i class="bx bx-crop" aria-hidden="true"></i>
                Apply Timeframe
              </div>
              <span class="viewer-syncGroupPill" title="Crop analysis to a window">Window</span>
            </div>

            <div class="viewer-syncGroupBtns">
              <button class="btn" id="viewerSyncMarkT1Btn" type="button" title="Mark start of timeframe at IMU cursor">
                <span class="viewer-syncStep" aria-hidden="true">1</span>
                <i class="bx bx-time-five" aria-hidden="true"></i>
                Mark T1
              </button>

              <button class="btn" id="viewerSyncMarkT2Btn" type="button" title="Mark end of timeframe at IMU cursor">
                <span class="viewer-syncStep" aria-hidden="true">2</span>
                <i class="bx bx-time" aria-hidden="true"></i>
                Mark T2
              </button>

              <button class="btn btn-primary" id="viewerSyncApplyTimeframeBtn" type="button" disabled title="Apply the marked timeframe to IMU analysis">
                <span class="viewer-syncStep" aria-hidden="true">3</span>
                <i class="bx bx-check-circle" aria-hidden="true"></i>
                Apply
              </button>

              <button class="btn btn-ghost" id="viewerSyncResetTBtn" type="button" title="Clear T1/T2 markers and applied window">
                <i class="bx bx-x" aria-hidden="true"></i>
                Reset
              </button>
            </div>

            <div class="viewer-syncMicroHint">
              Works on IMU time (the x-axis). Order doesn't matter — only <b>T1 &lt; T2</b>.
            </div>
          </section>
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
    getVideoEl,
    getImuCursorX, // seconds or null
    getImuMarkerX, // seconds or null
    setImuMarkerX, // (x:number|null) => void
  } = {}) {
    const state = {
      videoMarkerT: null, // seconds (video)
      offset: null, // seconds: videoT - imuT

      t1: null, // seconds (IMU)
      t2: null, // seconds (IMU)

      appliedStart: null,
      appliedEnd: null,
    };

    function setText(id, txt) {
      const el = $(id);
      if (el) el.textContent = txt ?? "";
    }

    function setHint(msg) {
      const el = $("viewerSyncHint");
      if (el) el.textContent = msg ?? "";
    }

    function flashBtn(id) {
      const el = $(id);
      if (!el) return;
      el.classList.add("is-flash");
      setTimeout(() => el.classList.remove("is-flash"), 450);
    }

    function fmtV(t) {
      return t == null ? "—" : `${Number(t).toFixed(3)} s`;
    }
    function fmtI(x) {
      return x == null ? "—" : `${Number(x).toFixed(3)} s`;
    }
    function fmtApplied(a, b) {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return "—";
      return `${Number(a).toFixed(3)} → ${Number(b).toFixed(3)} s`;
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

    function setApplyEnabled(enabled) {
      const btn = $("viewerSyncApplyTimeframeBtn");
      if (!btn) return;
      if (enabled) btn.removeAttribute("disabled");
      else btn.setAttribute("disabled", "");
    }

    function hasBothT() {
      return Number.isFinite(state.t1) && Number.isFinite(state.t2);
    }

    function isTimeframeValid() {
      return hasBothT() && state.t1 < state.t2;
    }

    function clearAppliedWindow() {
      state.appliedStart = null;
      state.appliedEnd = null;
    }

    // IMPORTANT: When video is playing in Follow mode, grab the live IMU time from video time + offset.
    // This guarantees marking works during playback even while the cursor is being driven continuously.
    function getLiveImuTimeForMarking() {
      const follow = !!window.IMU_STATE?.followVideo;
      const hasOffset = Number.isFinite(state.offset);

      if (follow && hasOffset) {
        const v = typeof getVideoEl === "function" ? getVideoEl() : $("viewerVideo");
        if (v && Number.isFinite(v.currentTime)) {
          return Number(v.currentTime) - Number(state.offset);
        }
      }

      const x = typeof getImuCursorX === "function" ? getImuCursorX() : null;
      return Number.isFinite(x) ? Number(x) : null;
    }

    function render() {
      const mount = ensureMounted();
      if (!mount) return;

      const imuMarker = typeof getImuMarkerX === "function" ? getImuMarkerX() : null;

      setText("viewerSyncVideoT", fmtV(state.videoMarkerT));
      setText("viewerSyncImuT", fmtI(imuMarker));
      setText("viewerSyncOffset", state.offset == null ? "—" : `${state.offset.toFixed(3)} s`);

      setText("viewerSyncT1", fmtI(state.t1));
      setText("viewerSyncT2", fmtI(state.t2));
      setText("viewerSyncAppliedWindow", fmtApplied(state.appliedStart, state.appliedEnd));

      setApplyEnabled(isTimeframeValid());
    }

    // -----------------------------
    // Compute Offset actions
    // -----------------------------
    function markVideo() {
      const v = typeof getVideoEl === "function" ? getVideoEl() : $("viewerVideo");
      if (!v || !Number.isFinite(v.currentTime)) return;

      state.videoMarkerT = Number(v.currentTime);
      render();

      const imuMarker = typeof getImuMarkerX === "function" ? getImuMarkerX() : null;
      if (!Number.isFinite(imuMarker)) {
        setHint("Video marked. Now mark the matching IMU moment.");
      } else {
        setHint("Video marker updated.");
      }
    }

    function markImu() {
      const x = typeof getImuCursorX === "function" ? getImuCursorX() : null;
      if (!Number.isFinite(x)) return;

      if (typeof setImuMarkerX === "function") setImuMarkerX(Number(x));
      render();

      if (!Number.isFinite(state.videoMarkerT)) {
        setHint("IMU marked. Now mark the matching video moment.");
      } else {
        setHint("IMU marker updated.");
      }
    }

    function computeOffset() {
      const imuMarker = typeof getImuMarkerX === "function" ? getImuMarkerX() : null;
      if (!Number.isFinite(state.videoMarkerT) || !Number.isFinite(imuMarker)) {
        setHint("Mark a video moment and the matching IMU moment first.");
        return;
      }

      // offset definition: videoT = imuT + offset  => offset = videoT - imuT
      state.offset = Number(state.videoMarkerT) - Number(imuMarker);
      render();

      // unlock cursor mode and DEFAULT to FOLLOW VIDEO after compute
      setFollowManualEnabled(true);
      setFollowVideoMode(true);

      document.dispatchEvent(new CustomEvent("movesync:time-sync-changed", { detail: { ...state } }));
      setHint("Offset computed. Cursor is now following the video.");
    }

    function resetOffsetGroup() {
      state.videoMarkerT = null;
      state.offset = null;

      if (typeof setImuMarkerX === "function") setImuMarkerX(null);

      // lock cursor mode until offset computed again
      setFollowManualEnabled(false);
      setFollowVideoMode(false);

      render();
      document.dispatchEvent(new CustomEvent("movesync:time-sync-changed", { detail: { ...state } }));
      setHint("Offset reset.");
    }

    // -----------------------------
    // Timeframe actions (IMU time)
    // -----------------------------
    function notifyIfInvalidTimeframe(lastPressedBtnId) {
      if (!hasBothT()) return;

      if (!(state.t1 < state.t2)) {
        flashBtn(lastPressedBtnId);
        flashBtn("viewerSyncApplyTimeframeBtn");
        setHint("Invalid timeframe: T1 must be before T2 (T1 < T2).");
      }
    }

    function markT1() {
      const x = getLiveImuTimeForMarking();
      if (!Number.isFinite(x)) return;

      state.t1 = Number(x);
      clearAppliedWindow();
      render();

      document.dispatchEvent(
        new CustomEvent("movesync:imu-timeframe-marked", {
          detail: { t1: state.t1, t2: state.t2 },
        })
      );

      if (hasBothT() && state.t1 < state.t2) setHint("T1 marked.");
      else if (!Number.isFinite(state.t2)) setHint("T1 marked. Now mark T2.");
      notifyIfInvalidTimeframe("viewerSyncMarkT1Btn");
    }

    function markT2() {
      const x = getLiveImuTimeForMarking();
      if (!Number.isFinite(x)) return;

      state.t2 = Number(x);
      clearAppliedWindow();
      render();

      document.dispatchEvent(
        new CustomEvent("movesync:imu-timeframe-marked", {
          detail: { t1: state.t1, t2: state.t2 },
        })
      );

      if (hasBothT() && state.t1 < state.t2) setHint("T2 marked.");
      else if (!Number.isFinite(state.t1)) setHint("T2 marked. Now mark T1.");
      notifyIfInvalidTimeframe("viewerSyncMarkT2Btn");
    }

    function resetT1T2() {
      state.t1 = null;
      state.t2 = null;
      clearAppliedWindow();

      document.dispatchEvent(new CustomEvent("movesync:imu-timeframe-reset"));

      render();
      setHint("Timeframe reset.");
    }

    function applyTimeframe() {
      if (!isTimeframeValid()) {
        flashBtn("viewerSyncApplyTimeframeBtn");
        if (!hasBothT()) setHint("Mark T1 and T2 (order doesn't matter). Then ensure T1 < T2.");
        else setHint("Cannot apply: T1 must be before T2 (T1 < T2).");
        return;
      }

      const start = state.t1;
      const end = state.t2;

      state.appliedStart = start;
      state.appliedEnd = end;

      document.dispatchEvent(
        new CustomEvent("movesync:imu-timeframe-applied", {
          detail: { start, end, t1: state.t1, t2: state.t2 },
        })
      );

      render();
      setHint("Timeframe applied.");
    }

    // -----------------------------
    // Internal full reset (no UI button)
    // -----------------------------
    function resetAllInternal() {
      state.videoMarkerT = null;
      state.offset = null;

      state.t1 = null;
      state.t2 = null;
      clearAppliedWindow();

      if (typeof setImuMarkerX === "function") setImuMarkerX(null);

      document.dispatchEvent(new CustomEvent("movesync:imu-timeframe-reset"));

      setFollowManualEnabled(false);
      setFollowVideoMode(false);

      render();
      document.dispatchEvent(new CustomEvent("movesync:time-sync-changed", { detail: { ...state } }));
      setHint("");
    }

    function wire(signal) {
      ensureMounted();

      // Follow/Manual are locked until an offset exists
      setFollowManualEnabled(false);
      setFollowVideoMode(false);

      $("viewerSyncMarkVideoBtn")?.addEventListener("click", markVideo, { signal });
      $("viewerSyncMarkImuBtn")?.addEventListener("click", markImu, { signal });
      $("viewerSyncComputeOffsetBtn")?.addEventListener("click", computeOffset, { signal });
      $("viewerSyncResetOffsetBtn")?.addEventListener("click", resetOffsetGroup, { signal });

      $("viewerSyncMarkT1Btn")?.addEventListener("click", markT1, { signal });
      $("viewerSyncMarkT2Btn")?.addEventListener("click", markT2, { signal });
      $("viewerSyncApplyTimeframeBtn")?.addEventListener("click", applyTimeframe, { signal });
      $("viewerSyncResetTBtn")?.addEventListener("click", resetT1T2, { signal });

      $("viewerFollowVideoBtn")?.addEventListener(
        "click",
        () => {
          if ($("viewerFollowVideoBtn")?.hasAttribute("disabled")) return;
          setFollowVideoMode(true);
          setHint("Follow mode.");
        },
        { signal }
      );

      $("viewerUnfollowVideoBtn")?.addEventListener(
        "click",
        () => {
          if ($("viewerUnfollowVideoBtn")?.hasAttribute("disabled")) return;
          setFollowVideoMode(false);
          setHint("Manual mode.");
        },
        { signal }
      );

      // Session change: reset everything (no Clear button needed)
      document.addEventListener("movesync:active-session-changed", () => resetAllInternal(), { signal });

      render();
    }

    return { wire, render, getState: () => ({ ...state }) };
  }

  window.MoveSyncViewerTimeSync = { create };
})();