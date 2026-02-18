// =======================================
// MoveSync module: IMU Panel (Raw CSV + Charts + Axis toggles + Cursor + Fusion)
// File: app/navigation/session-viewer/imu-panel/imu-panel.js
// =======================================

(() => {
  "use strict";

  // ------------------------------------------------------------
  // Deps loader (single shared promise; awaited by render paths)
  // ------------------------------------------------------------
  window.__imuPanelDepsPromise ??= (async function ensureImuPanelDeps() {
    // Prevent loading these deps more than once across SPA navigation
    if (window.__imuPanelDepsLoaded) return;

    const deps = [
      "app/navigation/session-viewer/imu-panel/sensor-fusion/ahrs.min.js",
      "app/navigation/session-viewer/imu-panel/sensor-fusion/fusion-loader.js",
      "app/navigation/session-viewer/imu-panel/plots/imu-filters.js",
      "app/navigation/session-viewer/imu-panel/plots/time-series-chart.js",
    ];

    // Reuse app-shellâ€™s global loadedScripts set if present
    const loadedSet =
      window.MoveSyncApp?.state?.loadedScripts ??
      (window.__MoveSyncLoadedScripts ??= new Set());

    function loadOnce(src) {
      return new Promise((resolve, reject) => {
        if (!src) return resolve();

        // Skip if already recorded
        if (loadedSet.has(src)) return resolve();

        // Extra guard: skip if a matching tag is already in DOM
        if (document.querySelector(`script[data-imu-src="${src}"]`)) {
          loadedSet.add(src);
          return resolve();
        }

        const s = document.createElement("script");
        s.src = src;
        s.async = false; // keep order
        s.dataset.imuSrc = src;

        s.onload = () => {
          loadedSet.add(src);
          resolve();
        };
        s.onerror = () => reject(new Error("IMU dep failed to load: " + src));

        document.body.appendChild(s);
      });
    }

    // Load sequentially
    for (const src of deps) {
      await loadOnce(src);
    }

    window.__imuPanelDepsLoaded = true;
  })().catch((e) => {
    console.error("[IMUPanel] Dep loader failed:", e);
    throw e;
  });

  const $ = (id) => document.getElementById(id);

  function imuPanelTemplate() {
    return `
      <div class="viewer-section-header">
        <h3>IMU Data</h3>

        <!-- COMBINED TOGGLE: Raw Data/Sensor Fusion + Plots/CSV -->
        <div class="viewer-combined-toggle">
          <div class="viewer-view-toggle" id="viewerViewToggle" role="tablist" aria-label="IMU mode">
            <button
              class="viewer-view-tab active"
              data-view="charts"
              role="tab"
              aria-selected="true"
              aria-controls="viewerChartsView"
              type="button"
            >
              <i class="bx bx-line-chart" aria-hidden="true"></i>
              Raw Data
            </button>

            <button
              class="viewer-view-tab"
              data-view="fusion"
              role="tab"
              aria-selected="false"
              aria-controls="viewerFusionView"
              type="button"
            >
              <i class="bx bx-cube-alt" aria-hidden="true"></i>
              Sensor Fusion
            </button>
          </div>

          <div class="viewer-view-toggle" id="viewerFormatToggle" role="tablist" aria-label="Data format">
            <button
              class="viewer-view-tab active"
              data-format="plots"
              role="tab"
              aria-selected="true"
              aria-controls="viewerImuPlots"
              type="button"
            >
              <i class="bx bx-bar-chart-alt-2" aria-hidden="true"></i>
              Plots
            </button>

            <button
              class="viewer-view-tab"
              data-format="csv"
              role="tab"
              aria-selected="false"
              aria-controls="viewerImuCsv"
              type="button"
            >
              <i class="bx bx-table" aria-hidden="true"></i>
              CSV
            </button>
          </div>
        </div>
      </div>

      <div id="viewerImuSelector" class="viewer-imu-selector" hidden></div>

      <!-- Plots panel -->
      <div id="viewerImuPlots" class="viewer-imuPlots" role="tabpanel">
        <!-- RAW DATA VIEW -->
        <div id="viewerChartsView" class="viewer-view-container active" role="tabpanel">
          <div id="viewerImuEmpty" class="viewer-empty viewer-empty--light" hidden>
            <div class="viewer-empty-title">No IMU data available</div>
            <div class="viewer-empty-desc">Upload a session with an IMU CSV to see the plots.</div>
          </div>

          <div class="viewer-cursor" id="viewerImuCursor" hidden>
            <div class="viewer-cursorBody">
              <div class="viewer-cursorCol" id="viewerImuCursorCol">
                <input
                  id="viewerImuCursorRange"
                  class="viewer-cursorRange"
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value="0"
                  aria-label="IMU plot cursor"
                />
              </div>

              <div class="viewer-cursorVal" id="viewerImuCursorVal">0.000 s</div>

              <div class="viewer-cursorSpacer" aria-hidden="true"></div>
            </div>
          </div>

          <!-- ACC -->
          <div class="viewer-plot">
            <div class="viewer-plotHead">
              <div class="viewer-plotTitle">Accelerometer</div>
              <div class="viewer-plotSub" id="viewerAccHint">â€”</div>
            </div>
            <div class="viewer-plotBody">
              <div class="viewer-plotCanvasWrap">
                <canvas id="viewerChartAcc"></canvas>
              </div>
              <div class="viewer-axisToggles" aria-label="Accelerometer axes">
                <button class="viewer-axisBtn is-on" data-chart="acc" data-axis="0">X</button>
                <button class="viewer-axisBtn is-on" data-chart="acc" data-axis="1">Y</button>
                <button class="viewer-axisBtn is-on" data-chart="acc" data-axis="2">Z</button>
                <button class="viewer-axisBtn viewer-axisBtn--total is-on" data-chart="acc" data-axis="3">Total</button>
              </div>
            </div>
          </div>

          <!-- GYRO -->
          <div class="viewer-plot">
            <div class="viewer-plotHead">
              <div class="viewer-plotTitle">Gyroscope</div>
              <div class="viewer-plotSub" id="viewerGyroHint">â€”</div>
            </div>
            <div class="viewer-plotBody">
              <div class="viewer-plotCanvasWrap">
                <canvas id="viewerChartGyro"></canvas>
              </div>
              <div class="viewer-axisToggles" aria-label="Gyroscope axes">
                <button class="viewer-axisBtn is-on" data-chart="gyro" data-axis="0">X</button>
                <button class="viewer-axisBtn is-on" data-chart="gyro" data-axis="1">Y</button>
                <button class="viewer-axisBtn is-on" data-chart="gyro" data-axis="2">Z</button>
                <button class="viewer-axisBtn viewer-axisBtn--total is-on" data-chart="gyro" data-axis="3">Total</button>
              </div>
            </div>
          </div>

          <!-- MAG -->
          <div class="viewer-plot">
            <div class="viewer-plotHead">
              <div class="viewer-plotTitle">Magnetometer</div>
              <div class="viewer-plotSub" id="viewerMagHint">â€”</div>
            </div>
            <div class="viewer-plotBody">
              <div class="viewer-plotCanvasWrap">
                <canvas id="viewerChartMag"></canvas>
              </div>
              <div class="viewer-axisToggles" aria-label="Magnetometer axes">
                <button class="viewer-axisBtn is-on" data-chart="mag" data-axis="0">X</button>
                <button class="viewer-axisBtn is-on" data-chart="mag" data-axis="1">Y</button>
                <button class="viewer-axisBtn is-on" data-chart="mag" data-axis="2">Z</button>
                <button class="viewer-axisBtn viewer-axisBtn--total is-on" data-chart="mag" data-axis="3">Total</button>
              </div>
            </div>
          </div>
        </div>

        <!-- SENSOR FUSION VIEW -->
        <div id="viewerFusionView" class="viewer-view-container" role="tabpanel" hidden>
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
                    <div class="viewer-fusion-value" id="fusionQuat">â€”</div>
                  </div>

                  <div class="viewer-fusion-card">
                    <div class="viewer-fusion-label">Euler Angles</div>
                    <div class="viewer-fusion-value" id="fusionEuler">â€”</div>
                  </div>

                  <div class="viewer-fusion-card">
                    <div class="viewer-fusion-label">Rotation Matrix</div>
                    <pre class="viewer-fusion-matrix" id="fusionMatrix">â€”</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- CSV view -->
      <div id="viewerImuCsv" class="viewer-csv" role="tabpanel" hidden>
        <div class="viewer-csv-head">
          <div class="viewer-csv-file" id="viewerCsvName">No CSV loaded</div>
          <div class="viewer-csv-hint">Showing first ~40 lines</div>
        </div>

        <pre id="viewerCsvPreview" class="viewer-csv-preview">No IMU data available.</pre>
      </div>
    `;
  }

  function ensureMounted(mountId = "viewerImuPanelMount") {
    const mount = document.getElementById(mountId);
    if (!mount) return false;

    // Avoid re-injecting if navigating back/forward etc.
    if (mount.dataset.mounted === "1") return true;

    mount.innerHTML = imuPanelTemplate();
    mount.dataset.mounted = "1";
    return true;
  }

  // -----------------------------
  // Small utilities (local to IMU panel)
  // -----------------------------
  function clamp(n, a, b) {
    const v = Number(n);
    if (!Number.isFinite(v)) return a;
    return Math.min(b, Math.max(a, v));
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text ?? "";
  }

  function safeNum(x, fallback = null) {
    const v = Number(x);
    return Number.isFinite(v) ? v : fallback;
  }

  // -----------------------------
  // IMU state
  // -----------------------------
  const imuCursor = { x: 0, minX: 0, maxX: 0 };
  const imuMarker = { x: null };
  const imuTimeframe = {
    t1: null,
    t2: null,
    active: false,
    start: 0,
    end: 0,
  };

  let charts = {};
  let imuRows = [];
  let imuHeaders = [];
  let imuTimeIndex = -1;
  let selectedImuIndex = 0;
  let lastSessionForSelector = null;

  // Cursor readouts cache
  let imuReadoutCache = null;

  // Keep scale info for external consumers (e.g. follow-video mapping)
  let imuTimeScaleInfo = { t0Raw: null, maxTRaw: 0, scale: 1.0 };
  let imuFullRangeMaxX = 0;

  // ------------------------------------------------------------------
  // Auto-detect timestamp scale factor.
  //
  // Sensors can output timestamps in any unit (raw counts, ms, us, ns,
  // or something entirely proprietary). Rather than hard-coding unit
  // names, we use the total span of the raw data to find whichever
  // power-of-10 multiplier places the session duration in a plausible
  // range (1 s - 14400 s / 4 h). Works for any sampling frequency.
  // ------------------------------------------------------------------
  function detectTimeScaleFactor(rows, timeIdx) {
    // Strategy: compute median inter-sample dt from the first ~200 rows,
    // then for each candidate power-of-10 scale check TWO conditions:
    //   1. The per-sample dt falls in a physically plausible range (0.5ms-2s)
    //   2. The implied sample rate (rows / total_duration) is 1-500 Hz
    // The second condition disambiguates cases like raw_dt=10 which could be
    // 10ms (100 Hz) or 1ms (1000 Hz) - row count picks the right one.

    const dts = [];
    let prev = null;
    let firstVal = null;
    let lastVal = null;
    let validCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const v = Number(rows[i]?.[timeIdx]);
      if (!Number.isFinite(v)) continue;
      if (firstVal === null) firstVal = v;
      lastVal = v;
      validCount++;
      if (prev !== null && i < 201) {
        const dt = v - prev;
        if (dt > 0) dts.push(dt);
      }
      prev = v;
    }

    if (!dts.length || firstVal === null || lastVal === null) return 1.0;

    dts.sort((a, b) => a - b);
    const medianDt = dts[Math.floor(dts.length / 2)];
    const rawSpan = lastVal - firstVal;
    if (rawSpan <= 0) return 1.0;

    const DT_MIN_S  = 0.0005;  // 2000 Hz physical max
    const DT_MAX_S  = 2.0;     // 0.5 Hz physical min
    const RATE_MIN  = 1.0;     // 1 Hz minimum expected rate
    const RATE_MAX  = 500.0;   // 500 Hz maximum for movement analysis

    for (let exp = 9; exp >= -3; exp--) {
      const scale  = Math.pow(10, -exp);
      const dtSec  = medianDt * scale;
      if (dtSec < DT_MIN_S || dtSec > DT_MAX_S) continue;

      const durSec = rawSpan * scale;
      if (durSec <= 0) continue;

      const rate = validCount / durSec;
      if (rate >= RATE_MIN && rate <= RATE_MAX) return scale;
    }

    // Fallback: scale so median dt == 10 ms (100 Hz assumption)
    return 0.01 / medianDt;
  }

  function normalizeTimeColumnInPlace(rows, timeIdx) {
    if (!Array.isArray(rows) || rows.length === 0) return { t0: null, maxT: 0, t0Raw: null, maxTRaw: 0 };
    if (timeIdx == null || timeIdx < 0) return { t0: null, maxT: 0, t0Raw: null, maxTRaw: 0 };

    const t0Raw = safeNum(rows[0]?.[timeIdx], null);
    if (t0Raw == null) return { t0: null, maxT: 0, t0Raw: null, maxTRaw: 0 };

    const scale = detectTimeScaleFactor(rows, timeIdx);

    let maxTRaw = 0;
    let maxT = 0;

    for (const r of rows) {
      const tRaw = safeNum(r?.[timeIdx], null);
      if (tRaw == null) continue;

      const tRebasedRaw = tRaw - t0Raw;
      const tScaled = tRebasedRaw * scale;

      r[timeIdx] = String(tScaled);

      if (tRebasedRaw > maxTRaw) maxTRaw = tRebasedRaw;
      if (tScaled > maxT) maxT = tScaled;
    }

    return { t0: 0, maxT, t0Raw, maxTRaw, scale };
  }

  function setHidden(elOrId, hidden) {
    const el = typeof elOrId === "string" ? $(elOrId) : elOrId;
    if (!el) return;
    el.hidden = !!hidden;
  }

  function setActive(elOrId, active) {
    const el = typeof elOrId === "string" ? $(elOrId) : elOrId;
    if (!el) return;
    el.classList.toggle("active", !!active);
  }

  function colIndex(headers, name) {
    const key = String(name || "").trim().toLowerCase();
    const lower = (headers || []).map((h) => String(h || "").trim().toLowerCase());
    const i = lower.indexOf(key);
    return i >= 0 ? i : -1;
  }

  function buildImuReadoutCache(headers, rows, timeIdx) {
    if (!headers?.length || !rows?.length || timeIdx == null || timeIdx < 0) return null;

    const axI = colIndex(headers, "ax"),
      ayI = colIndex(headers, "ay"),
      azI = colIndex(headers, "az");
    const gxI = colIndex(headers, "gx"),
      gyI = colIndex(headers, "gy"),
      gzI = colIndex(headers, "gz");
    const mxI = colIndex(headers, "mx"),
      myI = colIndex(headers, "my"),
      mzI = colIndex(headers, "mz");

    const tmp = [];
    for (const r of rows) {
      const t = safeNum(r?.[timeIdx], null); // scaled time
      if (t == null) continue;
      tmp.push({ t, r });
    }
    tmp.sort((a, b) => a.t - b.t);

    const t = [];
    const acc = { x: [], y: [], z: [] };
    const gyro = { x: [], y: [], z: [] };
    const mag = { x: [], y: [], z: [] };

    for (const o of tmp) {
      const r = o.r;
      t.push(o.t);

      acc.x.push(safeNum(r?.[axI], null));
      acc.y.push(safeNum(r?.[ayI], null));
      acc.z.push(safeNum(r?.[azI], null));

      gyro.x.push(safeNum(r?.[gxI], null));
      gyro.y.push(safeNum(r?.[gyI], null));
      gyro.z.push(safeNum(r?.[gzI], null));

      mag.x.push(safeNum(r?.[mxI], null));
      mag.y.push(safeNum(r?.[myI], null));
      mag.z.push(safeNum(r?.[mzI], null));
    }

    return { t, acc, gyro, mag };
  }

  function nearestIndex(times, x) {
    if (!times?.length) return -1;
    let lo = 0,
      hi = times.length - 1;
    if (x <= times[0]) return 0;
    if (x >= times[hi]) return hi;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = times[mid];
      if (v === x) return mid;
      if (v < x) lo = mid + 1;
      else hi = mid - 1;
    }
    const a = hi,
      b = lo;
    if (a < 0) return b;
    if (b >= times.length) return a;
    return Math.abs(times[b] - x) < Math.abs(times[a] - x) ? b : a;
  }

  function mag3(x, y, z) {
    if (x == null || y == null || z == null) return null;
    return Math.sqrt(x * x + y * y + z * z);
  }

  function fmt(v, d = 3) {
    return v == null || !Number.isFinite(v) ? "â€”" : v.toFixed(d);
  }

  function updateImuReadouts() {
    if (!imuReadoutCache) {
      setText("viewerAccHint", "â€”");
      setText("viewerGyroHint", "â€”");
      setText("viewerMagHint", "â€”");
      return;
    }

    const i = nearestIndex(imuReadoutCache.t, imuCursor.x || 0);
    if (i < 0) return;

    const ax = imuReadoutCache.acc.x[i],
      ay = imuReadoutCache.acc.y[i],
      az = imuReadoutCache.acc.z[i];
    const gx = imuReadoutCache.gyro.x[i],
      gy = imuReadoutCache.gyro.y[i],
      gz = imuReadoutCache.gyro.z[i];
    const mx = imuReadoutCache.mag.x[i],
      my = imuReadoutCache.mag.y[i],
      mz = imuReadoutCache.mag.z[i];

    const at = mag3(ax, ay, az);
    const gt = mag3(gx, gy, gz);
    const mt = mag3(mx, my, mz);

    setText("viewerAccHint", `X ${fmt(ax)}  Â·  Y ${fmt(ay)}  Â·  Z ${fmt(az)}  Â·  Total ${fmt(at)}`);
    setText("viewerGyroHint", `X ${fmt(gx)}  Â·  Y ${fmt(gy)}  Â·  Z ${fmt(gz)}  Â·  Total ${fmt(gt)}`);
    setText("viewerMagHint", `X ${fmt(mx)}  Â·  Y ${fmt(my)}  Â·  Z ${fmt(mz)}  Â·  Total ${fmt(mt)}`);
  }

  function updateCursorLabel() {
    const valEl = $("viewerImuCursorVal");
    if (valEl) valEl.textContent = `${(imuCursor.x || 0).toFixed(3)} s`;
  }

  // -----------------------------
  // Fusion state (per IMU)
  // -----------------------------
  const fusionCacheByImu = new Map(); // key: selectedImuIndex, value: fusionData

  function getCurrentFusionData() {
    return fusionCacheByImu.get(selectedImuIndex) || null;
  }

  function renderFusionAtCursor() {
    const fusionData = getCurrentFusionData() || window.MoveSync?.runtime?.fusion || null;
    if (!fusionData) return;

    try {
      window.FusionManager?.showPanel?.(true);
      window.FusionManager?.updateDisplay?.(fusionData, imuCursor.x || 0);
    } catch (e) {
      console.warn("[IMUPanel] Fusion render failed:", e);
    }
  }

  async function updateFusionAtTime(imuTime) {
    const t = safeNum(imuTime, null);
    if (t == null) return;

    try {
      await window.__imuPanelDepsPromise;
      await window.MoveSyncFusionLoader?.ensureLoaded?.();
    } catch (e) {
      console.warn("[IMUPanel] Fusion loader failed:", e);
      return;
    }

    wireFusionOnce();

    const fusionData = getCurrentFusionData();
    if (!fusionData) return;

    try {
      window.FusionManager?.showPanel?.(true);
      window.FusionManager?.updateDisplay?.(fusionData, t);
    } catch (e) {
      console.warn("[IMUPanel] Fusion updateDisplay failed:", e);
    }
  }

  function wireFusionOnce() {
    if (window.__movesyncFusionCursorWired) return;
    window.__movesyncFusionCursorWired = true;

    document.addEventListener("movesync:imu-cursor-changed", (ev) => {
      const t = safeNum(ev?.detail?.imuTime, null);
      if (t == null) return;

      const fusionData = getCurrentFusionData();
      if (!fusionData) return;

      try {
        window.FusionManager?.updateDisplay?.(fusionData, t);
      } catch (e) {
        console.warn("[IMUPanel] Fusion cursor update failed:", e);
      }
    });
  }

  function clearImuMarker() {
    imuMarker.x = null;
    Object.values(charts || {}).forEach((c) => c?.update?.("none"));
  }

  function resetZoomToFullRange() {
    imuCursor.minX = 0;
    imuCursor.maxX = Number.isFinite(imuFullRangeMaxX) ? imuFullRangeMaxX : 0;

    imuCursor.x = clamp(Number(imuCursor.x) || 0, imuCursor.minX, imuCursor.maxX || 0);

    syncImuCursorSlider();
    updateImuReadouts();
    updateCursorLabel();

    redrawCharts();
    requestAnimationFrame(alignImuCursorSliderToChartArea);
  }

  function setImuCursorX(x) {
    imuCursor.x = clamp(Number(x) || 0, imuCursor.minX || 0, imuCursor.maxX || 0);

    updateImuReadouts();
    updateCursorLabel();

    Object.values(charts || {}).forEach((c) => c?.update?.("none"));
    syncImuCursorSlider();

    document.dispatchEvent(
      new CustomEvent("movesync:imu-cursor-changed", {
        detail: { imuTime: imuCursor.x },
      })
    );
  }

  function syncImuCursorSlider() {
    const slider = $("viewerImuCursorRange");
    if (!slider) return;
    slider.min = String(imuCursor.minX || 0);
    slider.max = String(imuCursor.maxX || 0);
    slider.step = "0.001";
    slider.value = String(imuCursor.x || 0);
  }

  function alignImuCursorSliderToChartArea() {
    const col = $("viewerImuCursorCol");
    if (!col) return;

    const accChart = charts?.acc?.chart; // Chart.js instance
    if (!accChart?.chartArea || !accChart?.canvas) return;

    const area = accChart.chartArea;

    const dpr = window.devicePixelRatio || 1;
    const leftCss = area.left / dpr;
    const rightCss = area.right / dpr;

    col.style.marginLeft = `${leftCss}px`;
    col.style.width = `${Math.max(0, rightCss - leftCss)}px`;
  }

  function wireImuCursor(signal) {
    const slider = $("viewerImuCursorRange");
    if (!slider) return;

    slider.addEventListener(
      "input",
      () => {
        setImuCursorX(slider.value);
      },
      { signal }
    );

    updateCursorLabel();

    window.addEventListener(
      "resize",
      () => {
        requestAnimationFrame(alignImuCursorSliderToChartArea);
      },
      { signal }
    );
  }

  // -----------------------------
  // View toggles (HTML tabs)
  // -----------------------------
  function setToggleState(rootId, activeKey, datasetKey) {
    const root = $(rootId);
    if (!root) return;

    root.querySelectorAll(".viewer-view-tab").forEach((btn) => {
      const isActive = btn?.dataset?.[datasetKey] === activeKey;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.setAttribute("tabindex", isActive ? "0" : "-1");
    });
  }

  function switchModeView(view /* "charts" | "fusion" */) {
    setToggleState("viewerViewToggle", view, "view");

    const chartsEl = $("viewerChartsView");
    const fusionEl = $("viewerFusionView");

    if (chartsEl) {
      setActive(chartsEl, view === "charts");
      setHidden(chartsEl, view !== "charts");
    }
    if (fusionEl) {
      setActive(fusionEl, view === "fusion");
      setHidden(fusionEl, view !== "fusion");
    }

    if (view === "charts") requestAnimationFrame(alignImuCursorSliderToChartArea);
  }

  function switchFormat(format /* "plots" | "csv" */) {
    setToggleState("viewerFormatToggle", format, "format");

    const plots = $("viewerImuPlots");
    const csv = $("viewerImuCsv");

    if (plots) setHidden(plots, format !== "plots");
    if (csv) setHidden(csv, format !== "csv");
  }

  function getInitialViewState() {
    const viewRoot = $("viewerViewToggle");
    const fmtRoot = $("viewerFormatToggle");

    const activeViewBtn =
      viewRoot?.querySelector?.(".viewer-view-tab.active[data-view]") ||
      viewRoot?.querySelector?.(".viewer-view-tab[data-view]");
    const activeFmtBtn =
      fmtRoot?.querySelector?.(".viewer-view-tab.active[data-format]") ||
      fmtRoot?.querySelector?.(".viewer-view-tab[data-format]");

    const view = activeViewBtn?.dataset?.view || "charts";
    const format = activeFmtBtn?.dataset?.format || "plots";

    return { view, format };
  }

  function wireViewToggles(signal) {
    const init = getInitialViewState();
    switchModeView(init.view);
    switchFormat(init.format);

    document.addEventListener(
      "click",
      (e) => {
        const viewBtn = e.target?.closest?.("#viewerViewToggle .viewer-view-tab[data-view]");
        if (viewBtn) {
          const view = viewBtn.dataset.view;
          if (view === "charts" || view === "fusion") {
            if (view === "fusion") {
              window.__imuPanelDepsPromise
                .then(() => window.MoveSyncFusionLoader?.ensureLoaded?.())
                .then(() => {
                  wireFusionOnce();
                  renderFusionAtCursor();
                })
                .catch(console.error);
            }

            switchModeView(view);

            if (view === "fusion") {
              wireFusionOnce();
              renderFusionAtCursor();
            }
          }
          return;
        }

        const fmtBtn = e.target?.closest?.("#viewerFormatToggle .viewer-view-tab[data-format]");
        if (fmtBtn) {
          const fmt = fmtBtn.dataset.format;
          if (fmt === "plots" || fmt === "csv") switchFormat(fmt);
        }
      },
      { signal }
    );
  }

  // -----------------------------
  // Axis toggles
  // -----------------------------
  function axisKey(chart, axis) {
    return `movesync.viewer.axis.${chart}.${axis}`;
  }

  function getAxisEnabled(chart, axis) {
    const key = axisKey(chart, axis);
    const cur = localStorage.getItem(key) || "on";
    return cur !== "off";
  }

  function syncAllAxisButtons() {
    document.querySelectorAll(".viewer-axisBtn[data-chart][data-axis]").forEach((btn) => {
      const chart = btn.dataset.chart;
      const axis = btn.dataset.axis;
      if (!chart || axis == null) return;

      const enabled = getAxisEnabled(chart, String(axis));
      btn.classList.toggle("is-on", enabled);
      btn.classList.toggle("is-off", !enabled);
      btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    });
  }

  function wireAxisToggleButtons(signal) {
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(".viewer-axisBtn[data-chart][data-axis]");
        if (!btn) return;

        const chart = btn.dataset.chart;
        const axis = btn.dataset.axis;
        if (!chart || axis == null) return;

        const key = axisKey(chart, String(axis));
        const cur = localStorage.getItem(key) || "on";
        localStorage.setItem(key, cur === "on" ? "off" : "on");

        syncAllAxisButtons();
        redrawCharts();
      },
      { signal }
    );
  }

  function redrawCharts() {
    Object.values(charts || {}).forEach((c) => c?.update?.());
  }

  // -----------------------------
  // CSV parsing + chart creation
  // -----------------------------
  function getSessionImuList(session) {
    const list = Array.isArray(session?.imus) ? session.imus : [];
    if (list.length) return list;

    const legacyText = session?.csvText || session?.imuText || "";
    const legacyFile = session?.imuFile || null;
    const legacyName = session?.csvName || legacyFile?.name || "IMU.csv";

    return legacyText
      ? [{ label: "IMU 1", csvText: legacyText, file: legacyFile, skeletonNode: "", _name: legacyName }]
      : [];
  }

  function renderImuSelector(session) {
    const el = $("viewerImuSelector");
    if (!el) return;

    const imus = getSessionImuList(session);

    if (imus.length <= 1) {
      el.hidden = true;
      el.innerHTML = "";
      selectedImuIndex = 0;
      return;
    }

    el.hidden = false;

    selectedImuIndex = clamp(selectedImuIndex, 0, imus.length - 1);

    el.innerHTML = imus
      .map((imu, idx) => {
        const label = imu?.label || `IMU ${idx + 1}`;
        const node = imu?.skeletonNode ? ` (${imu.skeletonNode})` : "";
        const active = idx === selectedImuIndex ? "is-active" : "";
        return `
          <button class="viewer-imu-tab ${active}" type="button" data-idx="${idx}">
            <i class="bx bx-chip" aria-hidden="true"></i>
            ${label}${node}
          </button>`;
      })
      .join("");

    el.onclick = (e) => {
      const btn = e.target?.closest?.(".viewer-imu-tab[data-idx]");
      if (!btn) return;
      const idx = Number(btn.dataset.idx);
      if (!Number.isFinite(idx)) return;

      selectedImuIndex = idx;
      renderImu(session);
    };
  }

  function findTimeIndex(headers) {
    if (!Array.isArray(headers)) return -1;
    const lower = headers.map((h) => String(h || "").toLowerCase());
    const candidates = ["time", "t", "timestamp", "timesec", "times", "sec", "seconds"];
    for (const c of candidates) {
      const idx = lower.indexOf(c);
      if (idx >= 0) return idx;
    }
    return 0;
  }

  function parseCsv(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (!lines.length) return { headers: [], rows: [] };

    const headers = lines[0].split(",").map((h) => h.trim());
    const rows = lines.slice(1).map((line) => line.split(",").map((x) => x.trim()));

    return { headers, rows };
  }

  function createChart(canvasId, series, timeIdx) {
    const canvas = $(canvasId);
    if (!canvas) return null;

    const ChartCtor = window.MoveSyncCharts?.TimeSeriesChart || window.TimeSeriesChart;
    if (!ChartCtor) {
      console.error(
        "[IMUPanel] TimeSeriesChart not available yet. Did deps load? canvasId=",
        canvasId
      );
      return null;
    }

    const chartName =
      canvasId === "viewerChartAcc"
        ? "acc"
        : canvasId === "viewerChartGyro"
        ? "gyro"
        : canvasId === "viewerChartMag"
        ? "mag"
        : "unknown";

    return new ChartCtor(canvas, {
      rows: imuRows,
      headers: imuHeaders,
      timeIndex: timeIdx,
      series,
      getCursorX: () => imuCursor.x,
      getMarkerX: () => imuMarker.x,
      getT1X: () => imuTimeframe.t1,
      getT2X: () => imuTimeframe.t2,
      getAxisEnabled: (axisIdx) => getAxisEnabled(chartName, String(axisIdx)),
      getMinX: () => imuCursor.minX,
      getMaxX: () => imuCursor.maxX,

      // One hover path: Chart.js hover gives time; we update cursor -> updates ALL readouts

    });
  }

  function buildCharts() {
    // Destroy existing Chart.js instances to avoid canvas-reuse conflicts
    Object.values(charts || {}).forEach((c) => c?.destroy?.());
    charts = {};
    charts.acc = createChart("viewerChartAcc", ["ax", "ay", "az"], imuTimeIndex);
    charts.gyro = createChart("viewerChartGyro", ["gx", "gy", "gz"], imuTimeIndex);
    charts.mag = createChart("viewerChartMag", ["mx", "my", "mz"], imuTimeIndex);

    Object.values(charts).forEach((c) => c?.update?.());
    requestAnimationFrame(alignImuCursorSliderToChartArea);
  }

  function setImuEmptyState(isEmpty) {
    setHidden("viewerImuEmpty", !isEmpty);
    setHidden("viewerImuCursor", isEmpty);
  }

  function wireTimeframe(signal) {
    document.addEventListener(
      "movesync:imu-timeframe-marked",
      (ev) => {
        imuTimeframe.t1 = safeNum(ev?.detail?.t1, imuTimeframe.t1);
        imuTimeframe.t2 = safeNum(ev?.detail?.t2, imuTimeframe.t2);
        Object.values(charts || {}).forEach((c) => c?.update?.("none"));
      },
      { signal }
    );

    document.addEventListener(
      "movesync:imu-timeframe-reset",
      () => {
        imuTimeframe.t1 = null;
        imuTimeframe.t2 = null;
        imuTimeframe.active = false;
        imuTimeframe.start = 0;
        imuTimeframe.end = 0;

        resetZoomToFullRange();
        Object.values(charts || {}).forEach((c) => c?.update?.("none"));
      },
      { signal }
    );

    document.addEventListener(
      "movesync:imu-timeframe-applied",
      (ev) => {
        const start = safeNum(ev?.detail?.start, null);
        const end = safeNum(ev?.detail?.end, null);
        if (start == null || end == null) return;

        const a = Math.min(start, end);
        const b = Math.max(start, end);

        imuTimeframe.active = true;
        imuTimeframe.start = a;
        imuTimeframe.end = b;

        imuTimeframe.t1 = safeNum(ev?.detail?.t1, imuTimeframe.t1);
        imuTimeframe.t2 = safeNum(ev?.detail?.t2, imuTimeframe.t2);

        imuCursor.minX = a;
        imuCursor.maxX = b;
        imuCursor.x = clamp(imuCursor.x, imuCursor.minX, imuCursor.maxX);

        syncImuCursorSlider();
        updateImuReadouts();
        updateCursorLabel();

        redrawCharts();
        requestAnimationFrame(alignImuCursorSliderToChartArea);
      },
      { signal }
    );
  }

  // -----------------------------
  // Public render function
  // -----------------------------
  async function renderImu(session) {
    // Ensure deps exist before we try to construct charts / fusion
    await window.__imuPanelDepsPromise;

    const pre = $("viewerCsvPreview");
    const csvName = $("viewerCsvName");

    if (session !== lastSessionForSelector) {
      lastSessionForSelector = session;
      selectedImuIndex = 0;
    }
    renderImuSelector(session);

    const imus = getSessionImuList(session);
    const imu = imus[selectedImuIndex] || imus[0] || null;

    const csvText = imu?.csvText || "";
    const csvFileName = imu?.file?.name || imu?._name || `IMU_${selectedImuIndex + 1}.csv`;

    if (!csvText) {
      if (csvName) csvName.textContent = "No CSV loaded";
      if (pre) pre.textContent = "No IMU CSV data in this session.";

      imuRows = [];
      imuHeaders = [];
      imuTimeIndex = -1;

      imuReadoutCache = null;
      updateImuReadouts();
      updateCursorLabel();

      fusionCacheByImu.delete(selectedImuIndex);

      imuCursor.minX = 0;
      imuCursor.maxX = 0;
      imuCursor.x = 0;
      imuFullRangeMaxX = 0;

      clearImuMarker();
      syncImuCursorSlider();
      setImuEmptyState(true);
      buildCharts();
      return;
    }

    if (csvName) csvName.textContent = csvFileName;

    const { headers, rows } = parseCsv(csvText);
    imuHeaders = headers;
    imuRows = rows;
    imuTimeIndex = findTimeIndex(headers);

    const norm = normalizeTimeColumnInPlace(rows, imuTimeIndex);
    imuTimeScaleInfo = { t0Raw: norm.t0Raw, maxTRaw: norm.maxTRaw, scale: norm.scale ?? 1.0 };

    imuReadoutCache = buildImuReadoutCache(imuHeaders, imuRows, imuTimeIndex);

    imuCursor.maxX = norm.maxT;
    imuCursor.minX = 0;
    imuCursor.x = 0;
    imuFullRangeMaxX = norm.maxT;

    updateImuReadouts();
    updateCursorLabel();
    syncImuCursorSlider();

    setImuEmptyState(rows.length === 0 || headers.length === 0);

    if (pre) {
      const head = [headers.join(",")];
      for (let i = 0; i < Math.min(rows.length, 40); i++) head.push(rows[i].join(","));
      pre.textContent = head.join("\n");
    }

    buildCharts();

    // Optional fusion pipeline
    try {
      await window.MoveSyncFusionLoader?.ensureLoaded?.();

      const timeSeconds = imuRows.map((r) => {
        const v = Number(r?.[imuTimeIndex]); // scaled
        return Number.isFinite(v) ? v : 0;
      });

      const fusionData = await window.FusionManager.processFusion({
        rows,
        headers,
        timeSeconds,
      });

      fusionCacheByImu.set(selectedImuIndex, fusionData || null);

      window.MoveSync = window.MoveSync || {};
      window.MoveSync.runtime = window.MoveSync.runtime || {};
      window.MoveSync.runtime.fusion = fusionData || null;

      // Store per-IMU fusion data globally for ArmAngleUI and other consumers
      window.imuFusionData = window.imuFusionData || {};
      window.imuFusionData[selectedImuIndex] = fusionData || null;

      // Ensure ArmAngleUI panel is rendered (safe to call before fusion view is visible)
      try { window.ArmAngleUI?.init?.(); } catch {}

      // Populate + auto-assign the arm-angle joint selectors from session skeleton nodes
      try {
        const _arms = getSessionImuList(session);
        window.ArmAngleUI?.populateSelectors?.(_arms);
      } catch {}

      wireFusionOnce();
      const fusionViewEl = $("viewerFusionView");
      const fusionViewActive =
        fusionViewEl && !fusionViewEl.hidden && fusionViewEl.classList.contains("active");
      if (fusionViewActive) renderFusionAtCursor();
    } catch (err) {
      console.warn("[IMUPanel] Fusion processing failed:", err);
    }
    // Kick off background fusion for all other IMUs so arm-angle analysis works
    // immediately without needing to visit every IMU tab first.
    precomputeAllImuFusion(session).catch(() => {});

  }
  // -----------------------------
  // Pre-compute fusion for ALL IMUs in a session so arm-angle analysis
  // works without the user needing to visit every IMU tab first.
  // -----------------------------
  let _lastPrecomputeSession = null;

  async function precomputeAllImuFusion(session) {
    if (!session || session === _lastPrecomputeSession) return;
    _lastPrecomputeSession = session;

    const imus = getSessionImuList(session);
    if (imus.length < 2) return; // Nothing extra to compute

    try {
      await window.__imuPanelDepsPromise;
      await window.MoveSyncFusionLoader?.ensureLoaded?.();
    } catch { return; }

    window.imuFusionData = window.imuFusionData || {};

    for (let idx = 0; idx < imus.length; idx++) {
      // Skip IMUs whose fusion is already cached
      if (window.imuFusionData[idx] != null) continue;

      const imu = imus[idx];
      const csvText = imu?.csvText || "";
      if (!csvText) continue;

      try {
        const { headers, rows } = parseCsv(csvText);
        if (!headers.length || !rows.length) continue;

        const timeIdx = findTimeIndex(headers);
        // Work on a copy of rows so we do not mutate the original
        const rowsCopy = rows.map(r => [...r]);
        normalizeTimeColumnInPlace(rowsCopy, timeIdx);

        const timeSeconds = rowsCopy.map(r => {
          const v = Number(r?.[timeIdx]);
          return Number.isFinite(v) ? v : 0;
        });

        const fusionData = await window.FusionManager.processFusion({
          rows: rowsCopy,
          headers,
          timeSeconds,
        });

        window.imuFusionData[idx] = fusionData || null;
        fusionCacheByImu.set(idx, fusionData || null);
      } catch (err) {
        console.warn(`[IMUPanel] Background fusion failed for IMU ${idx}:`, err.message);
        window.imuFusionData[idx] = null;
      }
    }

    // Re-populate arm-angle selectors now that all fusion data is ready
    try {
      const _arms = getSessionImuList(session);
      window.ArmAngleUI?.populateSelectors?.(_arms);
    } catch {}
  }


  // -----------------------------
  // Sync follow-video (public hook)
  // -----------------------------
  function wireSyncPanel(signal, { getOffset } = {}) {
    window.IMU_STATE = window.IMU_STATE || {};
    if (typeof window.IMU_STATE.followVideo !== "boolean") window.IMU_STATE.followVideo = false;

    const applyMode = (followVideo) => {
      if (followVideo) {
        const off = typeof getOffset === "function" ? getOffset() : null;
        if (off == null) followVideo = false;
      }
      window.IMU_STATE.followVideo = !!followVideo;
    };

    applyMode(!!window.IMU_STATE.followVideo);

    document.addEventListener(
      "movesync:time-sync-mode-changed",
      (ev) => {
        const followVideo = !!ev?.detail?.followVideo;
        applyMode(followVideo);
      },
      { signal }
    );
  }

  // -----------------------------
  // Public API (module)
  // -----------------------------
  function create({ mountId = "viewerImuPanelMount" } = {}) {
    ensureMounted(mountId);

    // SPA safety: abort previous listeners for this mount (prevents stacking)
    const mount = document.getElementById(mountId);
    if (mount) {
      try {
        mount.__imuAbort?.abort?.();
      } catch {}
      const ac = new AbortController();
      mount.__imuAbort = ac;

      // Kick deps in the background (still awaited by render)
      window.__imuPanelDepsPromise?.catch(console.error);

      return {
        getCursorX: () => imuCursor.x,
        getMarkerX: () => imuMarker.x,

        setCursorX: (x) => setImuCursorX(x),
        setMarkerX: (x) => {
          if (x == null) {
            imuMarker.x = null;
            Object.values(charts || {}).forEach((c) => c?.update?.("none"));
            return;
          }

          const v = Number(x);
          if (!Number.isFinite(v)) return;

          imuMarker.x = clamp(v, 0, imuCursor.maxX || 0);
          Object.values(charts || {}).forEach((c) => c?.update?.("none"));
        },

        clearMarker: clearImuMarker,
        render: renderImu,

        wireCursor: () => wireImuCursor(ac.signal),
        wireAxisButtons: () => wireAxisToggleButtons(ac.signal),
        syncAxisButtons: syncAllAxisButtons,
        wireFollowVideo: (...args) => {
          // Supports both:
          //   wireFollowVideo(opts)
          //   wireFollowVideo(signal, opts)
          let signal = ac.signal;
          let opts = null;

          if (args.length === 1) {
            opts = args[0];
          } else if (args.length >= 2) {
            const maybeSignal = args[0];
            if (maybeSignal && typeof maybeSignal === "object" && "aborted" in maybeSignal) {
              signal = maybeSignal;
            }
            opts = args[1];
          }

          return wireSyncPanel(signal, opts);
        },

        wireViewToggles: () => wireViewToggles(ac.signal),
        switchModeView,
        switchFormat,
        wireTimeframe: () => wireTimeframe(ac.signal),
        updateFusionAtTime,
      };
    }

    // If mount missing, still return API (no wiring)
    window.__imuPanelDepsPromise?.catch(console.error);

    return {
      getCursorX: () => imuCursor.x,
      getMarkerX: () => imuMarker.x,

      setCursorX: (x) => setImuCursorX(x),
      setMarkerX: (x) => {
        if (x == null) {
          imuMarker.x = null;
          Object.values(charts || {}).forEach((c) => c?.update?.("none"));
          return;
        }

        const v = Number(x);
        if (!Number.isFinite(v)) return;

        imuMarker.x = clamp(v, 0, imuCursor.maxX || 0);
        Object.values(charts || {}).forEach((c) => c?.update?.("none"));
      },

      clearMarker: clearImuMarker,
      render: renderImu,

      wireCursor: () => {},
      wireAxisButtons: () => {},
      syncAxisButtons: syncAllAxisButtons,
      wireFollowVideo: () => {},

      wireViewToggles: () => {},
      switchModeView,
      switchFormat,
      wireTimeframe: () => {},
      updateFusionAtTime,
    };
  }

  window.MoveSyncViewerIMUPanel = { create };
})();