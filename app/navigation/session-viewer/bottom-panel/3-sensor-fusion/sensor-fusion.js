// =======================================
// Sensor Fusion — 3D Orientation Visualisation Panel
// File: app/navigation/session-viewer/imu-panel/sensor-fusion/sensor-fusion.js
//
// Responsibilities (this file only):
// - Consume quaternions already computed by imu-processing.js
//   (via window.currentProcessedSession)
// - Calibrate magnetometer bias (median-subtract) for heading reference
// - Derive rotation matrices from quaternions for the 3D canvas
// - Render the 3D box + axis widget on fusionCanvas3D
// - Keep the display in sync with the cursor / video playback
//
// Everything else (sample-rate detection, unit detection, Madgwick fusion,
// Euler angles, CSV parsing, time normalisation) is handled by imu-processing.js
// and is NOT duplicated here.
// =======================================

(() => {
  "use strict";

  // ============================================================
  // AHRS availability guard
  // ahrs.min.js is loaded upfront by session-viewer.js DEPS_ALWAYS.
  // All actual Madgwick fusion is now handled by imu-processing.js.
  // ensureAhrsLoaded() is kept so any external callers don't break.
  // ============================================================
  function ensureAhrsLoaded() {
    if (typeof window.Madgwick !== "undefined") return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        if (typeof window.Madgwick !== "undefined") {
          clearInterval(poll);
          resolve(true);
        } else if (attempts > 30) {
          clearInterval(poll);
          reject(new Error("[SensorFusion] Madgwick not available. Check ahrs.min.js is loaded."));
        }
      }, 100);
    });
  }

  // ============================================================
  // FusionProcessor
  //
  // Stripped to only what sensor-fusion.js uniquely needs:
  //   - calibrateMagnetometer      (hard-iron bias removal)
  //   - quaternionToRotationMatrix (rotation matrix card in UI)
  //   - rotateVectorByQuaternion   (3D canvas projection)
  //   - buildFromProcessed         (converts imu-processing output to display format)
  //
  // Removed (all handled by imu-processing.js):
  //   - findAxisKeys / hasAxisData / extractAxisData
  //   - sample-rate detection
  //   - gyro unit detection and conversion
  //   - calibrateAccelerometer (was also incorrect — destroyed gravity reference)
  //   - createFilter / Madgwick instantiation and update loop
  //   - quaternionToEuler
  //   - CSV parsing / time normalisation
  //   - full process() loop
  // ============================================================

function multiplyQuaternions(q1, q2) {
  const [w1, x1, y1, z1] = q1;
  const [w2, x2, y2, z2] = q2;
  return [
    w1*w2 - x1*x2 - y1*y2 - z1*z2,
    w1*x2 + x1*w2 + y1*z2 - z1*y2,
    w1*y2 - x1*z2 + y1*w2 + z1*x2,
    w1*z2 + x1*y2 - y1*x2 + z1*w2
  ];
}

  
  class FusionProcessor {

    // Magnetometer hard-iron bias removal.
    // Per-axis median so a full rotation sweep is not required.
    calibrateMagnetometer(magData) {
      const median = (arr) => {
        const s = [...arr].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      };
      return {
        x: magData.x.map((v) => v - median(magData.x)),
        y: magData.y.map((v) => v - median(magData.y)),
        z: magData.z.map((v) => v - median(magData.z)),
      };
    }

    // Rotation matrix from unit quaternion [w, x, y, z].
    // Used only to populate the rotation matrix card in the UI.
    quaternionToRotationMatrix(q) {
      const [w, x, y, z] = q;
      return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z),     2 * (x * z + w * y)    ],
        [2 * (x * y + w * z),     1 - 2 * (x * x + z * z), 2 * (y * z - w * x)    ],
        [2 * (x * z - w * y),     2 * (y * z + w * x),     1 - 2 * (x * x + y * y)],
      ];
    }

    // Rotate a 3-vector by a unit quaternion [w, x, y, z].
    // Used only for the 3D canvas projection.
    rotateVectorByQuaternion(v, q) {
      const [qw, qx, qy, qz] = q;
      const [vx, vy, vz] = v;
      const ix =  qw * vx + qy * vz - qz * vy;
      const iy =  qw * vy + qz * vx - qx * vz;
      const iz =  qw * vz + qx * vy - qy * vx;
      const iw = -qx * vx - qy * vy - qz * vz;
      return [
        ix * qw + iw * -qx + iy * -qz - iz * -qy,
        iy * qw + iw * -qy + iz * -qx - ix * -qz,
        iz * qw + iw * -qz + ix * -qy - iy * -qx,
      ];
    }

    // Build the display-ready orientation array from imu-processing.js output.
    // This is the only entry point for producing fusionData — no Madgwick is run here.
    //
    // processed = window.currentProcessedSession  (set by imu-processing.js)
    // Returns   = { times, orientations, sampleRate }
    buildFromProcessed(processed) {
      if (!processed?.fusion?.valid) return null;

      const { quaternions, euler } = processed.fusion;
      const n = quaternions.length;
      const orientations = new Array(n);

      for (let i = 0; i < n; i++) {
        const quat = quaternions[i]; // [w, x, y, z]
        orientations[i] = {
          quat,
          // euler arrays from imu-processing are Float32Arrays in radians
          euler: {
            roll:  euler.roll[i],
            pitch: euler.pitch[i],
            yaw:   euler.yaw[i],
          },
          rotMatrix: this.quaternionToRotationMatrix(quat),
        };
      }

      return {
        times:      Array.from(processed.t),
        orientations,
        sampleRate: processed.sampleRate,
      };
    }
  }

  // ============================================================
  // Fusion UI
  // ============================================================
  class FusionUI {
    constructor() {
      this.currentFusionData = null;
      this.lastRenderTime    = 0;
      this.renderThrottleMs  = 50; // ~20 FPS
      this.animationFrameId  = null;
    }

    ensureMarkup(mountId) {
      const mount = document.getElementById(mountId);
      if (!mount) return false;
      if (mount.dataset.fusionMounted === "1") return true;

      mount.innerHTML = `
        <div class="viewer-fusion" id="viewerFusion">
          <div class="viewer-fusion-header">
            <h4 class="viewer-fusion-title">
              <i class="bx bx-cube-alt" aria-hidden="true"></i>
              Sensor Fusion (9-DOF Orientation)
            </h4>
          </div>

          <div class="viewer-fusion-layout">
            <div class="viewer-fusion-viz-container">
              <div class="viewer-fusion-viz">
                <canvas id="fusionCanvas3D" width="300" height="300"></canvas>
              </div>
            </div>

            <div class="viewer-fusion-data-container">
              <div class="viewer-fusion-data">
                <div class="viewer-fusion-card">
                  <div class="viewer-fusion-label">Quaternion</div>
                  <div class="viewer-fusion-value" id="fusionQuat">—</div>
                </div>

                <div class="viewer-fusion-card">
                  <div class="viewer-fusion-label">Euler Angles</div>
                  <div class="viewer-fusion-value" id="fusionEuler">—</div>
                </div>

                <div class="viewer-fusion-card">
                  <div class="viewer-fusion-label">Rotation Matrix</div>
                  <pre class="viewer-fusion-matrix" id="fusionMatrix">—</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      mount.dataset.fusionMounted = "1";

      const panelInner = mount.closest(".viewer-tabPanelInner");
      if (panelInner) {
        const placeholder = panelInner.querySelector('.viewer-tabPlaceholder[data-placeholder="fusion"]');
        if (placeholder) placeholder.hidden = true;
      }

      return true;
    }

    findClosestIndex(times, t) {
      const n = times.length;
      if (n === 0) return 0;
      if (t <= times[0]) return 0;
      if (t >= times[n - 1]) return n - 1;
      let lo = 0, hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = times[mid];
        if (v === t) return mid;
        if (v < t) lo = mid + 1;
        else hi = mid - 1;
      }
      if (lo <= 0) return 0;
      if (lo >= n) return n - 1;
      return Math.abs(times[lo] - t) < Math.abs(times[lo - 1] - t) ? lo : lo - 1;
    }

    updateDisplay(fusionData, cursorTime) {
      this.currentFusionData = fusionData;
      if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
      const now = performance.now();
      if (now - this.lastRenderTime < this.renderThrottleMs) {
        this.animationFrameId = requestAnimationFrame(() => this._doRender(cursorTime));
        return;
      }
      this._doRender(cursorTime);
    }

    _doRender(cursorTime) {
      if (!this.currentFusionData) return;
      const times = this.currentFusionData.times;
      if (!times?.length) return;

      this.lastRenderTime = performance.now();

      const idx = this.findClosestIndex(times, cursorTime);
      const orientation = this.currentFusionData.orientations?.[idx];
      if (!orientation) return;

      const quatEl = document.getElementById("fusionQuat");
      if (quatEl) {
        const q = orientation.quat;
        quatEl.textContent = `w: ${q[0].toFixed(3)}, x: ${q[1].toFixed(3)}, y: ${q[2].toFixed(3)}, z: ${q[3].toFixed(3)}`;
      }

      const eulerEl = document.getElementById("fusionEuler");
      if (eulerEl) {
        const e = orientation.euler;
        // euler values are already in degrees from imu-processing.js
        eulerEl.innerHTML = `
          Roll:  ${e.roll.toFixed(1)}°<br>
          Pitch: ${e.pitch.toFixed(1)}°<br>
          Yaw:   ${e.yaw.toFixed(1)}°
        `;
      }

      const matrixEl = document.getElementById("fusionMatrix");
      if (matrixEl) {
        const m = orientation.rotMatrix;
        matrixEl.textContent = m
          .map((row) => row.map((v) => v.toFixed(3).padStart(7)).join(" "))
          .join("\n");
      }

      this.render3D(orientation.quat);
    }
    

    render3D(quaternion) {
      // ahrs_min.js has a cyclic axis permutation in its integration:
      //   physical gx → quaternion Z component (q3)
      //   physical gy → quaternion X component (q1)
      //   physical gz → quaternion Y component (q2)
      // To render correctly (physical Z = carousel, X/Y = tilts) we must remap:
      //   [w, q1, q2, q3]  →  [w, q3, q1, q2]
      const [qw, q1, q2, q3] = quaternion;
      const q = [qw, q3, q1, q2];

      const canvas = document.getElementById("fusionCanvas3D");
      if (!canvas) return;

      const ctx   = canvas.getContext("2d");
      const w     = canvas.width;
      const h     = canvas.height;
      const cx    = w / 2;
      const cy    = h / 2;
      const scale = 60;

      ctx.clearRect(0, 0, w, h);

      const processor = new FusionProcessor();

      // Projection: screenX=r[0], screenY=-r[1], depth=r[2]
      // Movesense: X=right, Y=up, Z=out-of-face (face normal = +Z)
      // Disc rim sits in XY plane at z=±H.
      // Z-rotation spins rim in XY → both screenX and screenY change → disc spins in place ✓
      // Y-rotation tilts rim into/out of screen → depth changes → disc tilts top/bottom ✓
      // X-rotation tilts rim left/right → depth changes → disc tilts sideways ✓
      const project = (v) => {
        const r = processor.rotateVectorByQuaternion(v, q);
        return { x: cx + r[0] * scale, y: cy - r[1] * scale, depth: r[2] };
      };

      const SEGS = 16;
      const R    = 1.0;
      const H    = 0.22;

      // Rim in XY plane, Z is face normal
      const frontRing = [], backRing = [];
      for (let s = 0; s < SEGS; s++) {
        const angle = (s / SEGS) * 2 * Math.PI;
        frontRing.push(project([R * Math.cos(angle), R * Math.sin(angle),  H]));
        backRing.push( project([R * Math.cos(angle), R * Math.sin(angle), -H]));
      }

      const frontDepth = frontRing.reduce((s, p) => s + p.depth, 0) / SEGS;
      const backDepth  = backRing.reduce( (s, p) => s + p.depth, 0) / SEGS;

      const sides = [];
      for (let s = 0; s < SEGS; s++) {
        const n = (s + 1) % SEGS;
        sides.push({
          s, n,
          depth: (frontRing[s].depth + frontRing[n].depth + backRing[s].depth + backRing[n].depth) / 4,
        });
      }
      sides.sort((a, b) => a.depth - b.depth);

      const drawFace = (ring, depth) => {
        ctx.beginPath();
        ring.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fillStyle   = depth > 0 ? "#4fb36499" : "#2d6b3f55";
        ctx.strokeStyle = depth > 0 ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.15)";
        ctx.lineWidth   = depth > 0 ? 2 : 1;
        ctx.fill(); ctx.stroke();
      };

      if (backDepth < frontDepth) drawFace(backRing, backDepth);

      sides.forEach(({ s, n, depth }) => {
        ctx.beginPath();
        ctx.moveTo(frontRing[s].x, frontRing[s].y);
        ctx.lineTo(frontRing[n].x, frontRing[n].y);
        ctx.lineTo(backRing[n].x,  backRing[n].y);
        ctx.lineTo(backRing[s].x,  backRing[s].y);
        ctx.closePath();
        ctx.fillStyle   = depth > 0 ? "#3a8c4fcc" : "#1e5c3366";
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth   = 1;
        ctx.fill(); ctx.stroke();
      });

      if (frontDepth >= backDepth) drawFace(frontRing, frontDepth);

      if (Math.max(frontDepth, backDepth) > 0) {
        const ring = frontDepth > backDepth ? frontRing : backRing;
        const lx = ring.reduce((s, p) => s + p.x, 0) / SEGS;
        const ly = ring.reduce((s, p) => s + p.y, 0) / SEGS;
        ctx.fillStyle    = "rgba(255,255,255,0.85)";
        ctx.font         = "bold 10px Poppins, sans-serif";
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("MOVESENSE", lx, ly);
      }

      // Axis arrows — same projection as disc
      const axisLength = 80;
      [
        { dir: [1, 0, 0], color: "#ff5252", label: "X" },
        { dir: [0, 1, 0], color: "#00e676", label: "Y" },
        { dir: [0, 0, 1], color: "#40c4ff", label: "Z" },
      ].forEach(({ dir, color, label }) => {
        const r     = processor.rotateVectorByQuaternion(dir, q);
        const x2d   =  r[0];
        const y2d   = -r[1];
        const depth =  r[2];

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + x2d * axisLength, cy + y2d * axisLength);
        ctx.lineWidth   = depth < 0 ? 2 : 3;
        ctx.strokeStyle = color;
        ctx.globalAlpha = depth < 0 ? 0.3 : 1.0;
        ctx.stroke();
        ctx.globalAlpha = 1.0;

        ctx.fillStyle   = color;
        ctx.font        = "bold 13px Poppins, sans-serif";
        ctx.globalAlpha = depth < 0 ? 0.3 : 1.0;
        ctx.fillText(label, cx + x2d * axisLength + 12, cy + y2d * axisLength);
        ctx.globalAlpha = 1.0;
      });

      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.font      = "10px Poppins, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("IMU Sensor (Body Frame)", 10, h - 10);
    }
  }

  // ============================================================
  // Fusion Manager
  // ============================================================
  class FusionManager {
    constructor() {
      this.processor = new FusionProcessor();
      this.ui        = new FusionUI();
      this.mountId   = "viewerFusionPanelMount";
    }

    setMountId(id) { this.mountId = id; }
    init()         { this.ui.ensureMarkup(this.mountId); }

    async ensureReady() {
      await ensureAhrsLoaded();
      this.init();
      return true;
    }

    updateDisplay(fusionData, timeSeconds) {
      this.ui.updateDisplay(fusionData, timeSeconds);
    }
  }

  window.FusionManager = window.FusionManager || new FusionManager();

  // ============================================================
  // Fusion Panel — event wiring + video sync
  // ============================================================
  const FusionPanel = (() => {
    const cache = new Map();
    let activeImuIndex   = 0;
    let lastCursorTime   = 0;
    let timeSyncOffset   = 0;
    let rafId            = null;
    let lastVideoDrivenT = null;

    function isFusionTabVisible() {
      const p = document.getElementById("viewerTabPanelFusion");
      return !p || !p.hidden;
    }

    function getVideoEl() { return document.getElementById("viewerVideo"); }

    function getImuTimeFromVideo(t) {
      return t - (Number.isFinite(timeSyncOffset) ? timeSyncOffset : 0);
    }

    function renderAtImuTime(tImu) {
      if (!Number.isFinite(tImu)) return;
      lastCursorTime = tImu;
      const fusionData = cache.get(activeImuIndex);
      if (!fusionData || !isFusionTabVisible()) return;
      window.FusionManager.updateDisplay(fusionData, tImu);
    }

    function stopVideoLoop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      lastVideoDrivenT = null;
    }

    function startVideoLoop() {
      stopVideoLoop();
      const tick = () => {
        rafId = requestAnimationFrame(tick);
        const v = getVideoEl();
        if (!v || v.paused || v.ended) { stopVideoLoop(); return; }
        const tVideo = v.currentTime;
        if (!Number.isFinite(tVideo)) return;
        if (lastVideoDrivenT != null && Math.abs(tVideo - lastVideoDrivenT) < 1 / 60) return;
        lastVideoDrivenT = tVideo;
        renderAtImuTime(getImuTimeFromVideo(tVideo));
      };
      rafId = requestAnimationFrame(tick);
    }

    function buildFusionData(imuIndex) {
      const processed = window.currentProcessedSession;
      if (!processed?.fusion?.valid) return null;

      const fusionData = window.FusionManager.processor.buildFromProcessed(processed);
      if (!fusionData) return null;

      cache.set(imuIndex, fusionData);
      window.imuFusionData = window.imuFusionData || {};
      window.imuFusionData[imuIndex] = fusionData;

      document.dispatchEvent(new CustomEvent("movesync:fusion-ready", {
        detail: { index: imuIndex }
      }));

      return fusionData;
    }

    async function ensureAndRender() {
      await window.FusionManager.ensureReady();
      window.FusionManager.setMountId("viewerFusionPanelMount");
      window.FusionManager.init();

      let fusionData = cache.get(activeImuIndex) || buildFusionData(activeImuIndex);
      if (!fusionData) return; // imu-processing hasn't fired yet — wait for the event

      const v = getVideoEl();
      renderAtImuTime(v && Number.isFinite(v.currentTime)
        ? getImuTimeFromVideo(v.currentTime)
        : lastCursorTime || 0);
    }

    function setSession(session) {
      cache.clear();
      if (window.imuFusionData && typeof window.imuFusionData === "object") {
        Object.entries(window.imuFusionData).forEach(([k, v]) => {
          const i = Number(k);
          if (Number.isFinite(i)) cache.set(i, v);
        });
      }
    }

    function setActiveImuIndex(idx) { if (Number.isFinite(idx)) activeImuIndex = idx; }
    function setCursorTime(t)       { if (Number.isFinite(t))   lastCursorTime  = t;  }

    function wire(signal) {
      // Primary trigger — re-build whenever imu-processing finishes
      document.addEventListener("movesync:imu-processed", (e) => {
        const idx = Number(e?.detail?.index);
        cache.delete(Number.isFinite(idx) ? idx : activeImuIndex);
        ensureAndRender().catch(() => {});
      }, { signal });

      document.addEventListener("movesync:imu-selected", (e) => {
        const idx = Number(e?.detail?.index);
        if (!Number.isFinite(idx)) return;
        setActiveImuIndex(idx);
        ensureAndRender().catch(() => {});
      }, { signal });

      document.addEventListener("movesync:imu-cursor-changed", (e) => {
        const t = Number(e?.detail?.imuTime);
        if (!Number.isFinite(t)) return;
        setCursorTime(t);
        const fusionData = cache.get(activeImuIndex);
        if (fusionData) {
          const v = getVideoEl();
          if (!(v && !v.paused && !v.ended)) {
            window.FusionManager.updateDisplay(fusionData, t);
          }
        }
      }, { signal });

      document.addEventListener("movesync:active-session-changed", () => {
        setSession(window.MoveSyncSessionStore?.getActiveSession?.() ?? null);
        ensureAndRender().catch(() => {});
      }, { signal });

      document.addEventListener("movesync:time-sync-changed", (e) => {
        const off = Number(e?.detail?.offset);
        if (!Number.isFinite(off)) return;
        timeSyncOffset = off;
        const v = getVideoEl();
        if (v && Number.isFinite(v.currentTime)) renderAtImuTime(getImuTimeFromVideo(v.currentTime));
      }, { signal });

      const attachToVideoWhenReady = () => {
        const v = getVideoEl();
        if (!v) return;
        v.addEventListener("timeupdate", () => {
          if (Number.isFinite(v.currentTime)) renderAtImuTime(getImuTimeFromVideo(v.currentTime));
        }, { signal });
        v.addEventListener("play",  () => startVideoLoop(), { signal });
        v.addEventListener("pause", () => stopVideoLoop(),  { signal });
        v.addEventListener("ended", () => stopVideoLoop(),  { signal });
        if (!v.paused && !v.ended) startVideoLoop();
      };

      attachToVideoWhenReady();
      const retry = setInterval(() => {
        if (signal?.aborted) { clearInterval(retry); return; }
        if (getVideoEl()) { clearInterval(retry); attachToVideoWhenReady(); }
      }, 250);

      if (signal) signal.addEventListener("abort", () => {
        clearInterval(retry); stopVideoLoop();
      }, { once: true });
    }

    async function mount({ mountId = "viewerFusionPanelMount", session = null, imuIndex = 0 } = {}) {
      window.FusionManager.setMountId(mountId);
      setSession(session);
      setActiveImuIndex(imuIndex);
      await ensureAndRender();
    }

    return { wire, mount, setSession, setActiveImuIndex, setCursorTime, ensureAndRender };
  })();

  window.MoveSyncViewerFusionPanel = FusionPanel;
})();