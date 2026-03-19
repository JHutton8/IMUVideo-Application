// =======================================
// MoveSync module: IMU Panel (CSV + Charts + Axis toggles + Cursor)
// File: app/navigation/session-viewer/imu-panel/imu-panel.js
//
// Public API: window.MoveSyncViewerIMUPanel.create({ mountId })
//
// Notes:
// - Loads plotting deps lazily (imu-filters.js, time-series-chart.js)
// - Supports multiple IMU CSVs per session via session.imus[]
// - Emits events:
//    • movesync:imu-cursor-changed { imuTime }
//    • movesync:imu-selected { index }
//    • movesync:imu-data-ready { index, hasData }
// =======================================
(() => {
  "use strict";

  // ------------------------------------------------------------
  // Deps loader: ONLY plot deps (no sensor fusion here)
  // ------------------------------------------------------------
  window.__imuPanelDepsPromise ??= (async function ensureImuPanelDeps() {
    if (window.__imuPanelDepsLoaded) return;

    const deps = [
      "app/navigation/session-viewer/bottom-panel/2-imu/plots/imu-filters.js",
      "app/navigation/session-viewer/bottom-panel/2-imu/plots/time-series-chart.js",
    ];

    const loadedSet =
      window.MoveSyncApp?.state?.loadedScripts ??
      (window.__MoveSyncLoadedScripts ??= new Set());

    function loadOnce(src) {
      return new Promise((resolve, reject) => {
        if (!src) return resolve();
        if (loadedSet.has(src)) return resolve();
        if (document.querySelector(`script[data-imu-src="${src}"]`)) {
          loadedSet.add(src);
          return resolve();
        }

        const s = document.createElement("script");
        s.src = src;
        s.async = false;
        s.dataset.imuSrc = src;

        s.onload = () => {
          loadedSet.add(src);
          resolve();
        };
        s.onerror = () => reject(new Error("IMU dep failed to load: " + src));
        document.body.appendChild(s);
      });
    }

    for (const src of deps) await loadOnce(src);
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

        <!-- ONLY format toggle now: Plots / CSV -->
        <div class="viewer-combined-toggle">
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

      <!-- Shown only when no timestamp column is detected -->
      <div id="viewerImuSynthBanner" class="viewer-synth-banner" hidden>
        <i class="bx bx-info-circle" aria-hidden="true"></i>
        <span id="viewerImuSynthMsg">No timestamp column detected — Sampling Frequency set at <strong id="viewerImuSynthHz">?</strong> Hz.</span>
        <label class="viewer-synth-label">
          Sample rate (Hz):
          <input
            id="viewerImuSynthRate"
            class="viewer-synth-input"
            type="number"
            min="1"
            max="2000"
            step="1"
            value="100"
            aria-label="Override sample rate"
          />
        </label>
        <button class="viewer-synth-btn" id="viewerImuSynthApply" type="button">Apply</button>
      </div>

      <!-- Plots panel -->
      <div id="viewerImuPlots" class="viewer-imuPlots" role="tabpanel">
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
            <div class="viewer-plotSub" id="viewerAccHint">—</div>
          </div>
          <div class="viewer-plotBody">
            <div class="viewer-plotCanvasWrap">
              <canvas id="viewerChartAcc"></canvas>
            </div>
            <div class="viewer-axisToggles" aria-label="Accelerometer axes">
              <button class="viewer-axisBtn is-on" data-chart="acc" data-axis="0" type="button">X</button>
              <button class="viewer-axisBtn is-on" data-chart="acc" data-axis="1" type="button">Y</button>
              <button class="viewer-axisBtn is-on" data-chart="acc" data-axis="2" type="button">Z</button>
              <button class="viewer-axisBtn viewer-axisBtn--total is-on" data-chart="acc" data-axis="3" type="button">Total</button>
            </div>
          </div>
        </div>

        <!-- GYRO -->
        <div class="viewer-plot">
          <div class="viewer-plotHead">
            <div class="viewer-plotTitle">Gyroscope</div>
            <div class="viewer-plotSub" id="viewerGyroHint">—</div>
          </div>
          <div class="viewer-plotBody">
            <div class="viewer-plotCanvasWrap">
              <canvas id="viewerChartGyro"></canvas>
            </div>
            <div class="viewer-axisToggles" aria-label="Gyroscope axes">
              <button class="viewer-axisBtn is-on" data-chart="gyro" data-axis="0" type="button">X</button>
              <button class="viewer-axisBtn is-on" data-chart="gyro" data-axis="1" type="button">Y</button>
              <button class="viewer-axisBtn is-on" data-chart="gyro" data-axis="2" type="button">Z</button>
              <button class="viewer-axisBtn viewer-axisBtn--total is-on" data-chart="gyro" data-axis="3" type="button">Total</button>
            </div>
          </div>
        </div>

        <!-- MAG -->
        <div class="viewer-plot">
          <div class="viewer-plotHead">
            <div class="viewer-plotTitle">Magnetometer</div>
            <div class="viewer-plotSub" id="viewerMagHint">—</div>
          </div>
          <div class="viewer-plotBody">
            <div class="viewer-plotCanvasWrap">
              <canvas id="viewerChartMag"></canvas>
            </div>
            <div class="viewer-axisToggles" aria-label="Magnetometer axes">
              <button class="viewer-axisBtn is-on" data-chart="mag" data-axis="0" type="button">X</button>
              <button class="viewer-axisBtn is-on" data-chart="mag" data-axis="1" type="button">Y</button>
              <button class="viewer-axisBtn is-on" data-chart="mag" data-axis="2" type="button">Z</button>
              <button class="viewer-axisBtn viewer-axisBtn--total is-on" data-chart="mag" data-axis="3" type="button">Total</button>
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
    if (mount.dataset.mounted === "1") return true;

    mount.innerHTML = imuPanelTemplate();
    mount.dataset.mounted = "1";
    return true;
  }

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

  function setHidden(elOrId, hidden) {
    const el = typeof elOrId === "string" ? $(elOrId) : elOrId;
    if (!el) return;
    el.hidden = !!hidden;
  }

  const imuCursor = { x: 0, minX: 0, maxX: 0 };
  const imuMarker = { x: null };

  let charts = {};
  let imuRows = [];
  let imuHeaders = [];
  let imuTimeIndex = -1;

  let selectedImuIndex = 0;
  let lastSessionForSelector = null;

  let imuReadoutCache = null;

  window.currentImuIndex = window.currentImuIndex || 0;

  function detectTimeScaleFactor(rows, timeIdx) {
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

    const DT_MIN_S = 0.0005;
    const DT_MAX_S = 2.0;
    const RATE_MIN = 1.0;
    const RATE_MAX = 500.0;

    for (let exp = 9; exp >= -3; exp--) {
      const scale = Math.pow(10, -exp);
      const dtSec = medianDt * scale;
      if (dtSec < DT_MIN_S || dtSec > DT_MAX_S) continue;

      const durSec = rawSpan * scale;
      if (durSec <= 0) continue;

      const rate = validCount / durSec;
      if (rate >= RATE_MIN && rate <= RATE_MAX) return scale;
    }

    return 0.01 / medianDt;
  }

  function normalizeTimeColumnInPlace(rows, timeIdx) {
    if (!Array.isArray(rows) || rows.length === 0) return { t0: null, maxT: 0 };
    if (timeIdx == null || timeIdx < 0) return { t0: null, maxT: 0 };

    const t0Raw = safeNum(rows[0]?.[timeIdx], null);
    if (t0Raw == null) return { t0: null, maxT: 0 };

    const scale = detectTimeScaleFactor(rows, timeIdx);

    let maxT = 0;
    for (const r of rows) {
      const tRaw = safeNum(r?.[timeIdx], null);
      if (tRaw == null) continue;

      const tScaled = (tRaw - t0Raw) * scale;
      r[timeIdx] = String(tScaled);
      if (tScaled > maxT) maxT = tScaled;
    }

    return { t0: 0, maxT, scale };
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
      const t = safeNum(r?.[timeIdx], null);
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
    let lo = 0, hi = times.length - 1;
    if (x <= times[0]) return 0;
    if (x >= times[hi]) return hi;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = times[mid];
      if (v === x) return mid;
      if (v < x) lo = mid + 1;
      else hi = mid - 1;
    }
    const a = hi, b = lo;
    if (a < 0) return b;
    if (b >= times.length) return a;
    return Math.abs(times[b] - x) < Math.abs(times[a] - x) ? b : a;
  }

  function mag3(x, y, z) {
    if (x == null || y == null || z == null) return null;
    return Math.sqrt(x * x + y * y + z * z);
  }

  function fmt(v, d = 3) {
    return v == null || !Number.isFinite(v) ? "—" : v.toFixed(d);
  }

  function updateImuReadouts() {
    if (!imuReadoutCache) {
      setText("viewerAccHint", "—");
      setText("viewerGyroHint", "—");
      setText("viewerMagHint", "—");
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

    setText("viewerAccHint", `X ${fmt(ax)}  ·  Y ${fmt(ay)}  ·  Z ${fmt(az)}  ·  Total ${fmt(mag3(ax, ay, az))}`);
    setText("viewerGyroHint", `X ${fmt(gx)}  ·  Y ${fmt(gy)}  ·  Z ${fmt(gz)}  ·  Total ${fmt(mag3(gx, gy, gz))}`);
    setText("viewerMagHint", `X ${fmt(mx)}  ·  Y ${fmt(my)}  ·  Z ${fmt(mz)}  ·  Total ${fmt(mag3(mx, my, mz))}`);
  }

  function updateCursorLabel() {
    const valEl = $("viewerImuCursorVal");
    if (!valEl) return;

    const t = (imuCursor.x || 0).toFixed(3);

    // value + unit on the same line
    valEl.innerHTML = `<span class="viewer-timeVal">${t}</span><span class="viewer-timeUnit">&nbsp;s</span>`;
  }

  function syncImuCursorSlider() {
    const slider = $("viewerImuCursorRange");
    if (!slider) return;
    slider.min = String(imuCursor.minX || 0);
    slider.max = String(imuCursor.maxX || 0);
    slider.step = "0.001";
    slider.value = String(imuCursor.x || 0);
  }

  function setImuCursorX(x) {
    imuCursor.x = clamp(Number(x) || 0, imuCursor.minX || 0, imuCursor.maxX || 0);

    updateImuReadouts();
    updateCursorLabel();

    Object.values(charts || {}).forEach((c) => c?.update?.("none"));
    syncImuCursorSlider();

    document.dispatchEvent(new CustomEvent("movesync:imu-cursor-changed", { detail: { imuTime: imuCursor.x } }));
  }

  function alignImuCursorSliderToChartArea() {
    const col = $("viewerImuCursorCol");
    if (!col) return;

    const accChart = charts?.acc?.chart;
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

    slider.addEventListener("input", () => setImuCursorX(slider.value), { signal });
    updateCursorLabel();

    window.addEventListener("resize", () => requestAnimationFrame(alignImuCursorSliderToChartArea), { signal });
  }

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
    document.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".viewer-axisBtn[data-chart][data-axis]");
      if (!btn) return;

      const chart = btn.dataset.chart;
      const axis = btn.dataset.axis;
      if (!chart || axis == null) return;

      const key = axisKey(chart, String(axis));
      const cur = localStorage.getItem(key) || "on";
      localStorage.setItem(key, cur === "on" ? "off" : "on");

      syncAllAxisButtons();
      Object.values(charts || {}).forEach((c) => c?.update?.());
    }, { signal });
  }

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

  function switchFormat(format) {
    setToggleState("viewerFormatToggle", format, "format");
    setHidden("viewerImuPlots", format !== "plots");
    setHidden("viewerImuCsv", format !== "csv");
  }

  function wireFormatToggle(signal) {
    switchFormat("plots");

    document.addEventListener("click", (e) => {
      const fmtBtn = e.target?.closest?.("#viewerFormatToggle .viewer-view-tab[data-format]");
      if (!fmtBtn) return;
      const fmt = fmtBtn.dataset.format;
      if (fmt === "plots" || fmt === "csv") switchFormat(fmt);
    }, { signal });
  }

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
      window.currentImuIndex = 0;
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
  }

  function findTimeIndex(headers) {
    if (!Array.isArray(headers)) return -1;
    const lower = headers.map((h) => String(h || "").toLowerCase());
    const candidates = ["time", "t", "timestamp", "timesec", "times", "sec", "seconds"];
    for (const c of candidates) {
      const idx = lower.indexOf(c);
      if (idx >= 0) return idx;
    }
    // No time column found — caller must synthesize timestamps.
    return -1;
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
      console.error("[IMUPanel] TimeSeriesChart not available yet. Did deps load? canvasId=", canvasId);
      return null;
    }

    const chartName =
      canvasId === "viewerChartAcc" ? "acc" :
      canvasId === "viewerChartGyro" ? "gyro" :
      canvasId === "viewerChartMag" ? "mag" : "unknown";

    return new ChartCtor(canvas, {
      rows: imuRows,
      headers: imuHeaders,
      timeIndex: timeIdx,
      series,

      getCursorX: () => imuCursor.x,
      getMarkerX: () => imuMarker.x,
      getAxisEnabled: (axisIdx) => getAxisEnabled(chartName, String(axisIdx)),
      getMinX: () => imuCursor.minX,
      getMaxX: () => imuCursor.maxX,
    });
  }

  function buildCharts() {
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

  async function renderImu(session) {
    await window.__imuPanelDepsPromise;

    const pre = $("viewerCsvPreview");
    const csvName = $("viewerCsvName");

    if (session !== lastSessionForSelector) {
      lastSessionForSelector = session;
      selectedImuIndex = 0;
      window.currentImuIndex = 0;

      document.dispatchEvent(new CustomEvent("movesync:imu-selected", { detail: { index: 0 } }));
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

      imuCursor.minX = 0;
      imuCursor.maxX = 0;
      imuCursor.x = 0;

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

    // ── Synthetic timestamps ─────────────────────────────────────────────────
    // When no time column exists we prepend one using a user-supplied (or
    // previously stored) sample rate.  The banner lets the user correct it
    // without re-uploading the file.
    const synthBanner  = $("viewerImuSynthBanner");
    const synthRateEl  = $("viewerImuSynthRate");
    const synthHzEl    = $("viewerImuSynthHz");
    const synthApplyEl = $("viewerImuSynthApply");

    if (imuTimeIndex === -1) {
      // Resolve rate: prefer value already shown in the input (user may have
      // typed a custom rate), then fall back to 100 Hz.
      const storedHz = parseFloat(synthRateEl?.value) || 100;
      const hz = (Number.isFinite(storedHz) && storedHz >= 1) ? storedHz : 100;

      // Prepend synthetic "t" column
      imuHeaders = ["t", ...imuHeaders];
      for (let i = 0; i < imuRows.length; i++) {
        imuRows[i] = [String(i / hz), ...imuRows[i]];
      }
      imuTimeIndex = 0;

      // Show banner
      if (synthBanner)  synthBanner.hidden = false;
      if (synthRateEl)  synthRateEl.value  = String(hz);
      if (synthHzEl)    synthHzEl.textContent = String(hz);

      // Wire "Apply" once (guard with a flag so we don't stack listeners)
      if (synthApplyEl && !synthApplyEl.dataset.wired) {
        synthApplyEl.dataset.wired = "1";
        synthApplyEl.addEventListener("click", () => {
          // Re-render with the new rate — just call renderImu again with the
          // same session; the rate will be read from the input.
          renderImu(lastSessionForSelector || {});
        });
      }
    } else {
      // Time column present — hide the banner
      if (synthBanner) synthBanner.hidden = true;
    }
    // ────────────────────────────────────────────────────────────────────────

    const norm = normalizeTimeColumnInPlace(rows, imuTimeIndex);

    imuReadoutCache = buildImuReadoutCache(imuHeaders, imuRows, imuTimeIndex);

    // If timestamps were synthesised, record the rate so imu-processing.js
    // can skip its own detection and use the exact value instead.
    if (imuReadoutCache) {
      const synthRateEl = $("viewerImuSynthRate");
      const bannerHidden = $("viewerImuSynthBanner")?.hidden !== false;
      imuReadoutCache._synthHz = bannerHidden ? null : (parseFloat(synthRateEl?.value) || null);
    }

    // Expose globally so imu-processing.js event handler can read it.
    window.__currentImuReadoutCache = imuReadoutCache;

    imuCursor.maxX = norm.maxT;
    imuCursor.minX = 0;
    imuCursor.x = 0;

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

    document.dispatchEvent(
      new CustomEvent("movesync:imu-data-ready", {
        detail: { index: selectedImuIndex, hasData: true },
      })
    );
  }

  function create({ mountId = "viewerImuPanelMount" } = {}) {
    ensureMounted(mountId);

    const mount = document.getElementById(mountId);
    if (mount) {
      try { mount.__imuAbort?.abort?.(); } catch {}
      const ac = new AbortController();
      mount.__imuAbort = ac;

      window.__imuPanelDepsPromise?.catch(console.error);

      // ✅ NEW: selector click wiring via addEventListener (won’t get overwritten)
      document.addEventListener("click", (e) => {
        const btn = e.target?.closest?.("#viewerImuSelector .viewer-imu-tab[data-idx]");
        if (!btn) return;

        const idx = Number(btn.dataset.idx);
        if (!Number.isFinite(idx)) return;

        selectedImuIndex = idx;
        window.currentImuIndex = idx;

        document.dispatchEvent(new CustomEvent("movesync:imu-selected", { detail: { index: idx } }));

        // rerender
        renderImu(lastSessionForSelector || {});
      }, { signal: ac.signal });

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

        clearMarker: () => {
          imuMarker.x = null;
          Object.values(charts || {}).forEach((c) => c?.update?.("none"));
        },

        render: renderImu,

        wireCursor: () => wireImuCursor(ac.signal),
        // Recompute slider alignment (useful when the IMU tab is shown)
        alignCursorSlider: () => requestAnimationFrame(alignImuCursorSliderToChartArea),
        wireAxisButtons: () => wireAxisToggleButtons(ac.signal),
        syncAxisButtons: syncAllAxisButtons,

        wireFormatToggle: () => wireFormatToggle(ac.signal),
        switchFormat,
      };
    }

    window.__imuPanelDepsPromise?.catch(console.error);

    return {
      getCursorX: () => imuCursor.x,
      getMarkerX: () => imuMarker.x,
      setCursorX: (x) => setImuCursorX(x),
      setMarkerX: () => {},
      clearMarker: () => {},
      render: renderImu,
      wireCursor: () => {},
      alignCursorSlider: () => requestAnimationFrame(alignImuCursorSliderToChartArea),
      wireAxisButtons: () => {},
      syncAxisButtons: syncAllAxisButtons,
      wireFormatToggle: () => {},
      switchFormat,
    };
  }

  window.MoveSyncViewerIMUPanel = { create };
})();