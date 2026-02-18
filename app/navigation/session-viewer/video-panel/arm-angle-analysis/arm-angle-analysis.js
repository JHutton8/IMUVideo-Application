// =======================================
// Arm Angle Analysis Module (clean + professional)
// - Three separate joint selectors (shoulder / elbow / wrist)
// - Safer math + validation
// - Better separation of concerns
// - Chart updates are resilient (re-use/destroy)
// =======================================

(function () {
  "use strict";

  // -------------------------------
  // Small utilities
  // -------------------------------
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rad2deg = (r) => (r * 180) / Math.PI;

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function readIndex(selectEl) {
    const v = selectEl?.value ?? "";
    return v === "" ? null : Number(v);
  }

  // -------------------------------
  // Math: Quaternion ops
  // Quat format: [w, x, y, z]
  // -------------------------------
  const Quat = {
    conjugate([w, x, y, z]) {
      return [w, -x, -y, -z];
    },

    multiply([w1, x1, y1, z1], [w2, x2, y2, z2]) {
      return [
        w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
        w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
        w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
        w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
      ];
    },

    // Ensure q and -q represent same rotation, but keep w >= 0 for stable acos
    canonicalize([w, x, y, z]) {
      return w < 0 ? [-w, -x, -y, -z] : [w, x, y, z];
    },

    // Relative rotation angle between orientations qA -> qB
    relativeAngleDeg(qA, qB) {
      const a = Quat.canonicalize(qA);
      const b = Quat.canonicalize(qB);

      const qRel = Quat.multiply(b, Quat.conjugate(a));
      const w = clamp(qRel[0], -1, 1);
      const angleRad = 2 * Math.acos(w);
      return rad2deg(angleRad);
    },
  };

  // -------------------------------
  // Core analyser
  // -------------------------------
  class ArmAngleAnalyser {
    #shoulder = null;
    #elbow = null;
    #wrist = null;
    #angles = null;

    setImuData({ shoulder, elbow, wrist }) {
      assert(shoulder && elbow && wrist, "All three IMUs (shoulder, elbow, wrist) must be set");
      assert(Array.isArray(shoulder.orientations), "Shoulder data missing orientations[]");
      assert(Array.isArray(elbow.orientations), "Elbow data missing orientations[]");
      assert(Array.isArray(wrist.orientations), "Wrist data missing orientations[]");
      assert(Array.isArray(shoulder.times), "Shoulder data missing times[]");

      this.#shoulder = shoulder;
      this.#elbow = elbow;
      this.#wrist = wrist;

      this.#compute();
      return this.#angles;
    }

    getAngles() {
      return this.#angles;
    }

    getStatistics() {
      if (!this.#angles) return null;

      const elbow = this.#angles.elbow;
      const wrist = this.#angles.wrist;

      return {
        elbow: statsOf(elbow),
        wrist: statsOf(wrist),
      };
    }

    #compute() {
      const s = this.#shoulder;
      const e = this.#elbow;
      const w = this.#wrist;

      const n = Math.min(s.orientations.length, e.orientations.length, w.orientations.length, s.times.length);
      assert(n > 0, "No samples available to compute angles.");

      const out = {
        elbow: new Array(n),
        wrist: new Array(n),
        shoulder: new Array(n),
        times: s.times.slice(0, n),
      };

      for (let i = 0; i < n; i++) {
        const sQuat = s.orientations[i]?.quat;
        const eQuat = e.orientations[i]?.quat;
        const wQuat = w.orientations[i]?.quat;

        assert(Array.isArray(sQuat) && sQuat.length === 4, `Invalid shoulder quat at i=${i}`);
        assert(Array.isArray(eQuat) && eQuat.length === 4, `Invalid elbow quat at i=${i}`);
        assert(Array.isArray(wQuat) && wQuat.length === 4, `Invalid wrist quat at i=${i}`);

        out.elbow[i] = Quat.relativeAngleDeg(sQuat, eQuat);
        out.wrist[i] = Quat.relativeAngleDeg(eQuat, wQuat);

        const euler = s.orientations[i]?.euler ?? null;
        out.shoulder[i] = euler
          ? { pitch: rad2deg(euler.pitch), roll: rad2deg(euler.roll), yaw: rad2deg(euler.yaw) }
          : null;
      }

      this.#angles = out;
    }
  }

  function statsOf(arr) {
    if (!arr.length) return { mean: NaN, min: NaN, max: NaN, range: NaN };
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const v of arr) {
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mean = sum / arr.length;
    return { mean, min, max, range: max - min };
  }

  // -------------------------------
  // UI
  // Assumes:
  // - container: #viewerFusionView
  // - global fusion data: window.imuFusionData (object keyed by IMU index)
  // - Chart.js available as window.Chart (optional)
  // -------------------------------
  class ArmAngleUI {
    constructor() {
      this.analyser = new ArmAngleAnalyser();
      this.charts = { elbow: null, wrist: null };
      this.ids = {
        panel: "armAnglePanel",
        shoulder: "armShoulderSelect",
        elbow: "armElbowSelect",
        wrist: "armWristSelect",
        btn: "armCalculateBtn",
        results: "armAngleResults",
        elbowStats: "armElbowStats",
        wristStats: "armWristStats",
        elbowChart: "armElbowChart",
        wristChart: "armWristChart",
        warn: "armAngleWarning",
      };
    }

    init() {
      this.#render();
      this.#wire();
    }

    populateSelectors(imuList) {
      const { shoulder, elbow, wrist } = this.#els();
      if (!shoulder || !elbow || !wrist) return;

      const fill = (selectEl) => {
        selectEl.innerHTML = `<option value="">Select IMU...</option>`;
        imuList.forEach((imu, idx) => {
          const opt = document.createElement("option");
          opt.value = String(idx);
          opt.textContent = imu?.label ?? `IMU ${idx + 1}`;
          selectEl.appendChild(opt);
        });
      };

      fill(shoulder);
      fill(elbow);
      fill(wrist);

      // Auto-select based on the skeletonNode assigned during upload.
      // skeletonNode values are like "left_shoulder", "right_elbow", "left_wrist", etc.
      // Only auto-assign if the selector is still unset (preserves manual user choices).
      imuList.forEach((imu, idx) => {
        const node = String(imu?.skeletonNode ?? "").toLowerCase();
        if (!node) return;
        const strIdx = String(idx);
        if (node.includes("shoulder") && shoulder.value === "") shoulder.value = strIdx;
        if (node.includes("elbow")    && elbow.value   === "") elbow.value   = strIdx;
        if (node.includes("wrist")    && wrist.value   === "") wrist.value   = strIdx;
      });

      this.#validateSelections();
    }

    // --------------------------
    // Internal helpers
    // --------------------------
    #els() {
      const byId = (id) => document.getElementById(id);
      return {
        panel: byId(this.ids.panel),
        shoulder: byId(this.ids.shoulder),
        elbow: byId(this.ids.elbow),
        wrist: byId(this.ids.wrist),
        btn: byId(this.ids.btn),
        results: byId(this.ids.results),
        elbowStats: byId(this.ids.elbowStats),
        wristStats: byId(this.ids.wristStats),
        elbowChart: byId(this.ids.elbowChart),
        wristChart: byId(this.ids.wristChart),
        warn: byId(this.ids.warn),
      };
    }

    #render() {
      const fusionView = document.getElementById("viewerFusionView");
      if (!fusionView) return;
      if (document.getElementById(this.ids.panel)) return;

      const panel = document.createElement("div");
      panel.id = this.ids.panel;
      panel.className = "viewer-fusion";
      panel.style.marginTop = "20px";

      panel.innerHTML = `
        <div class="viewer-fusion-header">
          <h4 class="viewer-fusion-title">
            <i class="bx bx-body" aria-hidden="true"></i>
            Arm Angle Analysis
          </h4>
        </div>

        <div class="viewer-fusion-settings" style="margin-bottom: 16px;">
          <div id="${this.ids.warn}" style="display:none; padding:10px 12px; border-radius:12px; border:1px solid var(--card-border); background:rgba(255, 193, 7, 0.08); margin-bottom:12px;">
            <div style="font-weight:600; margin-bottom:4px;">Selection issue</div>
            <div style="opacity:0.9; font-size:13px;">â€”</div>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
            ${this.#selectBlock("Shoulder IMU", this.ids.shoulder)}
            ${this.#selectBlock("Elbow IMU", this.ids.elbow)}
            ${this.#selectBlock("Wrist IMU", this.ids.wrist)}
          </div>

          <button id="${this.ids.btn}" class="btn" style="margin-top: 12px; width: 100%;" disabled>
            <i class="bx bx-calculator" aria-hidden="true"></i>
            Calculate Angles
          </button>
        </div>

        <div id="${this.ids.results}" style="display:none;">
          <div class="viewer-fusion-data">
            <div class="viewer-fusion-card">
              <div class="viewer-fusion-label">Elbow Angle</div>
              <div class="viewer-fusion-value" id="${this.ids.elbowStats}">â€”</div>
            </div>

            <div class="viewer-fusion-card">
              <div class="viewer-fusion-label">Wrist Angle</div>
              <div class="viewer-fusion-value" id="${this.ids.wristStats}">â€”</div>
            </div>
          </div>

          <div style="margin-top:16px;">
            ${this.#chartBlock("Elbow Angle Over Time", this.ids.elbowChart)}
            ${this.#chartBlock("Wrist Angle Over Time", this.ids.wristChart)}
          </div>
        </div>
      `;

      fusionView.appendChild(panel);
    }

    #selectBlock(label, id) {
      return `
        <div>
          <label style="display:block; font-size:12px; margin-bottom:6px; opacity:0.9;">${label}</label>
          <select id="${id}" class="viewer-fusion-select" style="width:100%;">
            <option value="">Select IMU...</option>
          </select>
        </div>
      `;
    }

    #chartBlock(title, canvasId) {
      return `
        <div style="margin-bottom:12px;">
          <div style="font-weight:600; margin-bottom:8px;">${title}</div>
          <div style="height:200px; border:1px solid var(--card-border); border-radius:12px; padding:8px; background: var(--sidebar-color);">
            <canvas id="${canvasId}"></canvas>
          </div>
        </div>
      `;
    }

    #wire() {
      const { shoulder, elbow, wrist, btn } = this.#els();
      if (!shoulder || !elbow || !wrist || !btn) return;

      const onChange = () => this.#validateSelections();
      shoulder.addEventListener("change", onChange);
      elbow.addEventListener("change", onChange);
      wrist.addEventListener("change", onChange);

      btn.addEventListener("click", () => this.calculate());
    }

    #validateSelections() {
      const { shoulder, elbow, wrist, btn } = this.#els();
      if (!shoulder || !elbow || !wrist || !btn) return;

      const s = readIndex(shoulder);
      const e = readIndex(elbow);
      const w = readIndex(wrist);

      const allSelected = s !== null && e !== null && w !== null;
      const allDifferent = new Set([s, e, w]).size === 3;

      // button enablement
      btn.disabled = !(allSelected && allDifferent);

      // warning
      const warnMsg =
        !allSelected
          ? "Select three IMUs (shoulder, elbow, wrist)."
          : !allDifferent
            ? "Each joint must use a different IMU (no duplicates)."
            : null;

      this.#setWarning(warnMsg);
    }

    #setWarning(message) {
      const { warn } = this.#els();
      if (!warn) return;
      if (!message) {
        warn.style.display = "none";
        return;
      }
      warn.style.display = "block";
      warn.querySelector("div:nth-child(2)").textContent = message;
    }

    async calculate() {
      const { shoulder, elbow, wrist } = this.#els();
      if (!shoulder || !elbow || !wrist) return;

      const sIdx = readIndex(shoulder);
      const eIdx = readIndex(elbow);
      const wIdx = readIndex(wrist);

      try {
        assert(sIdx !== null && eIdx !== null && wIdx !== null, "Select three IMUs first.");
        assert(new Set([sIdx, eIdx, wIdx]).size === 3, "Shoulder, elbow, wrist must be different IMUs.");

        // imuFusionData is a plain object {0: fusionData, 1: fusionData, ...} - NOT an array.
        const fusion = window.imuFusionData;
        assert(
          fusion != null && typeof fusion === "object" && Object.keys(fusion).length > 0,
          "No fusion data found. Fusion runs automatically on load - check the console for errors " +
          "(e.g. missing magnetometer columns mx/my/mz in the CSV)."
        );

        const sData = fusion[sIdx];
        const eData = fusion[eIdx];
        const wData = fusion[wIdx];

        // Give specific messages if a particular IMU fusion result is missing
        assert(sData, `Shoulder IMU (index ${sIdx}) has no fusion data - check its CSV has ax/ay/az, gx/gy/gz and mx/my/mz columns.`);
        assert(eData, `Elbow IMU (index ${eIdx}) has no fusion data - check its CSV has ax/ay/az, gx/gy/gz and mx/my/mz columns.`);
        assert(wData, `Wrist IMU (index ${wIdx}) has no fusion data - check its CSV has ax/ay/az, gx/gy/gz and mx/my/mz columns.`);

        const angles = this.analyser.setImuData({ shoulder: sData, elbow: eData, wrist: wData });
        this.#displayResults(angles, this.analyser.getStatistics());
      } catch (err) {
        console.error("Arm angle calculation failed:", err);
        alert(`Failed to calculate arm angles: ${err.message}`);
      }
    }

    #displayResults(angles, stats) {
      const { results, elbowStats, wristStats } = this.#els();
      if (!angles || !stats) return;

      if (results) results.style.display = "block";

      if (elbowStats) {
        elbowStats.innerHTML = `
          Mean: ${stats.elbow.mean.toFixed(1)}Â°<br>
          Range: ${stats.elbow.min.toFixed(1)}Â° - ${stats.elbow.max.toFixed(1)}Â°<br>
          ROM: ${stats.elbow.range.toFixed(1)}Â°
        `;
      }

      if (wristStats) {
        wristStats.innerHTML = `
          Mean: ${stats.wrist.mean.toFixed(1)}Â°<br>
          Range: ${stats.wrist.min.toFixed(1)}Â° - ${stats.wrist.max.toFixed(1)}Â°<br>
          ROM: ${stats.wrist.range.toFixed(1)}Â°
        `;
      }

      this.#updateCharts(angles);
    }

    #updateCharts(angles) {
      if (!window.Chart) return;

      const elbowCanvas = document.getElementById(this.ids.elbowChart);
      const wristCanvas = document.getElementById(this.ids.wristChart);

      if (elbowCanvas) {
        this.charts.elbow?.destroy?.();
        this.charts.elbow = this.#makeLineChart(elbowCanvas, {
          label: "Elbow Angle",
          points: angles.times.map((t, i) => ({ x: t, y: angles.elbow[i] })),
        });
      }

      if (wristCanvas) {
        this.charts.wrist?.destroy?.();
        this.charts.wrist = this.#makeLineChart(wristCanvas, {
          label: "Wrist Angle",
          points: angles.times.map((t, i) => ({ x: t, y: angles.wrist[i] })),
        });
      }
    }

    #makeLineChart(canvas, { label, points }) {
      const ctx = canvas.getContext("2d");
      return new window.Chart(ctx, {
        type: "line",
        data: {
          datasets: [
            {
              label,
              data: points,
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.2,
              backgroundColor: "transparent",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { type: "linear", title: { display: true, text: "Time (s)" } },
            y: { title: { display: true, text: "Angle (Â°)" } },
          },
        },
      });
    }
  }

  // -----------------------------------
  // Export singleton
  // -----------------------------------
  window.ArmAngleUI = new ArmAngleUI();
})();