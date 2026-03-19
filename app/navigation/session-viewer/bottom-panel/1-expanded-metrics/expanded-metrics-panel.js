// =======================================
// Expanded Metrics Analysis Panel
// - No full re-render on graph toggle (just flip hidden + draw one chart)
// - Graphs show time in seconds on x-axis
// - Signal arrays downsampled + cached after first build
// =======================================
(() => {
  "use strict";

  // source = dot-path into ProcessedSession for graph signal
  const GROUPS = [
    { name: "Acceleration", metrics: [
      { id: "peak_accel",       label: "Peak acceleration",      unit: "G",    icon: "bx-trending-up",     graphable: true,  source: "derived.accelMagnitude" },
      { id: "mean_accel",       label: "Mean acceleration",      unit: "G",    icon: "bx-bar-chart-alt-2", graphable: true,  source: "derived.accelMagnitudeSmooth" },
      { id: "accel_rms",        label: "Acceleration RMS",       unit: "G",    icon: "bx-pulse",           graphable: false, source: null },
      { id: "peak_jerk",        label: "Peak jerk",              unit: "G/s",  icon: "bx-zap",             graphable: true,  source: "derived.jerk" },
    ]},
    { name: "Speed & Distance", metrics: [
      { id: "peak_speed",       label: "Peak speed",             unit: "m/s",  icon: "bx-wind",         graphable: true,  source: "motion.speed" },
      { id: "mean_speed",       label: "Mean speed",             unit: "m/s",  icon: "bx-transfer-alt", graphable: false, source: null },
      { id: "mean_burst_speed", label: "Avg peak speed (per burst)",  unit: "m/s",  icon: "bx-transfer",     graphable: false, source: null },
      { id: "total_distance",   label: "Total distance",         unit: "m",    icon: "bx-run",          graphable: true,  source: "motion.totalDistance" },
    ]},
    { name: "Angular Velocity", metrics: [
      { id: "peak_gyro",        label: "Peak angular velocity",  unit: "°/s",  icon: "bx-rotate-right",    graphable: true,  source: "derived.gyroMagnitude" },
      { id: "mean_gyro",        label: "Mean angular velocity",  unit: "°/s",  icon: "bx-rotate-left",     graphable: true,  source: "derived.gyroMagnitudeSmooth" },
    ]},
    { name: "Orientation",
      note: "Orientation of the sensor body (segment angles). Joint angles need a second IMU per joint.",
      metrics: [
      { id: "mean_pitch",       label: "Mean pitch",             unit: "°",    icon: "bx-trending-up",     graphable: true,  source: "fusion.euler.pitch" },
      { id: "mean_roll",        label: "Mean roll",              unit: "°",    icon: "bx-rotate-right",    graphable: true,  source: "fusion.euler.roll" },
      { id: "pitch_range",      label: "Pitch range",            unit: "°",    icon: "bx-expand",          graphable: false, source: null },
      { id: "roll_range",       label: "Roll range",             unit: "°",    icon: "bx-expand",          graphable: false, source: null },
    ]},
    { name: "Rhythm & Repetitions", metrics: [
      { id: "cadence",          label: "Cadence",                unit: "spm",  icon: "bx-time-five",       graphable: false, source: null },
      { id: "rep_count",        label: "Rep count",              unit: "",     icon: "bx-list-ol",         graphable: false, source: null },
      { id: "mean_rep_time",    label: "Mean rep time",          unit: "s",    icon: "bx-timer",           graphable: false, source: null },
    ]},
    { name: "Session", metrics: [
      { id: "total_duration",   label: "Session duration",       unit: "s",    icon: "bx-time",            graphable: false, source: null },
      { id: "active_time",      label: "Active time",            unit: "s",    icon: "bx-walk",            graphable: false, source: null },
      { id: "total_impulse",    label: "Total impulse",          unit: "G·s",  icon: "bx-pulse",           graphable: false, source: null },
    ]},
  ];

  const METRIC_MAP = {};
  for (const g of GROUPS) for (const m of g.metrics) METRIC_MAP[m.id] = m;

  let _mountEl   = null;
  let _session   = null;
  let _processed = null;
  let _vals      = {};
  let _filter    = "key";
  let _search    = "";
  let _charts    = {};
  let _sigCache  = {};  // source → { data: Float32Array, times: Float32Array }

  function esc(s) {
    return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;")
      .replaceAll(">","&gt;").replaceAll('"',"&quot;");
  }

  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => o?.[k], obj) ?? null;
  }

  // ── Public API ──────────────────────────────────────────────

  function mount(mountId) {
    _mountEl = document.getElementById(mountId);
    if (_mountEl) _fullRender();
  }

  function setSession(session) {
    _session = session || null; _processed = null; _vals = {};
    _filter = "key"; _search = ""; _sigCache = {};
    _destroyAllCharts();
    if (_mountEl) _fullRender();
  }

  function render(session) { setSession(session); }

  function onProcessed(processed) {
    _processed = processed;
    _sigCache  = {};
    _vals = window.MoveSyncKeyMetricsPanel?.extractMetrics?.(processed) || {};
    if (!_mountEl) return;
    // Update values in-place — no re-render
    _mountEl.querySelectorAll("[data-ema-val]").forEach(span => {
      span.textContent = _vals[span.getAttribute("data-ema-val")] ?? "—";
    });
    // Enable graph buttons
    _mountEl.querySelectorAll(".ema-graph-btn[disabled]").forEach(btn => {
      btn.disabled = false; btn.title = "";
    });
  }

  // ── Render ──────────────────────────────────────────────────

  function _fullRender() {
    const el = _mountEl;
    if (!el) return;
    _destroyAllCharts();

    const keySet = new Set(Array.isArray(_session?.keyMetrics) ? _session.keyMetrics : []);
    const totalN = GROUPS.reduce((n, g) => n + g.metrics.length, 0);
    const keyN   = keySet.size;
    const preset = _session?.presetName || null;
    const groups = _filteredGroups(keySet);

    el.innerHTML = `
      <div class="ema-panel">
        <div class="ema-toolbar">
          <div class="ema-toolbar-left">
            <div class="ema-filter-tabs" role="tablist">
              <button class="ema-filter-btn ${_filter==="key"?"is-active":""}" data-ema-filter="key" type="button">
                <i class="bx bx-star" aria-hidden="true"></i> Key metrics
                ${keyN ? `<span class="ema-filter-count">${keyN}</span>` : ""}
              </button>
              <button class="ema-filter-btn ${_filter==="all"?"is-active":""}" data-ema-filter="all" type="button">
                <i class="bx bx-list-ul" aria-hidden="true"></i> All metrics
                <span class="ema-filter-count">${totalN}</span>
              </button>
            </div>
            ${preset && _filter==="key" ? `<span class="ema-preset-tag"><i class="bx bx-slider-alt" aria-hidden="true"></i> ${esc(preset)}</span>` : ""}
          </div>
          <div class="ema-toolbar-right">
            <div class="ema-search">
              <i class="bx bx-search" aria-hidden="true"></i>
              <input class="ema-search-input" id="emaSearchInput" type="text"
                placeholder="Search metrics…" value="${esc(_search)}"
                autocomplete="off" spellcheck="false" />
            </div>
          </div>
        </div>

        ${groups.length === 0 ? `
          <div class="ema-empty">
            <i class="bx ${_filter==="key"&&keyN===0?"bx-info-circle":"bx-search-alt"} ema-empty-icon"></i>
            <div class="ema-empty-title">${_filter==="key"&&keyN===0?"No preset selected":"No results"}</div>
            <div class="ema-empty-sub">${_filter==="key"&&keyN===0
              ? "Assign a sport preset when uploading a session, or switch to <b>All metrics</b>."
              : "Try a different search term."}</div>
          </div>
        ` : `
          <div class="ema-groups">
            ${groups.map(g => `
              <section class="ema-group">
                <div class="ema-group-label">${esc(g.name)}${g.note
                  ? `<span class="ema-group-note">${esc(g.note)}</span>` : ""}</div>
                <div class="ema-metric-grid">
                  ${g.metrics.map(m => _cardHtml(m, keySet.has(m.id))).join("")}
                </div>
              </section>`).join("")}
          </div>
        `}
      </div>`;

    _wireToolbar(el);
    _wireGraphButtons(el);
  }

  function _filteredGroups(keySet) {
    const q = _search.toLowerCase();
    return GROUPS.map(g => ({
      ...g,
      metrics: g.metrics.filter(m => {
        if (_filter === "key" && keySet.size > 0 && !keySet.has(m.id)) return false;
        if (q && !m.label.toLowerCase().includes(q) && !g.name.toLowerCase().includes(q)) return false;
        return true;
      })
    })).filter(g => g.metrics.length > 0);
  }

  function _cardHtml(m, isKey) {
    const val     = _vals[m.id] ?? "—";
    const hasData = !!_processed;
    return `
      <div class="ema-metric-card ${isKey?"is-key":""}" data-ema-card="${m.id}">
        <div class="ema-metric-card-head">
          <i class="bx ${m.icon}" aria-hidden="true"></i>
          <span class="ema-metric-label">${m.label}</span>
          ${isKey ? `<span class="ema-key-badge">Key</span>` : ""}
        </div>
        <div class="ema-metric-value-row">
          <span class="ema-metric-value" data-ema-val="${m.id}">${val}</span>
          ${m.unit ? `<span class="ema-metric-unit">${m.unit}</span>` : ""}
        </div>
        ${m.graphable ? `
          <div class="ema-card-actions">
            <button class="ema-graph-btn" data-graph-id="${m.id}" type="button"
              ${!hasData ? 'disabled title="Load IMU data first"' : ""}>
              <i class="bx bx-line-chart" aria-hidden="true"></i> Show graph
            </button>
          </div>
          <div class="ema-graph-area" data-graph-area="${m.id}" hidden>
            <canvas id="emachart-${m.id}"></canvas>
          </div>
        ` : ""}
      </div>`;
  }

  // ── Toolbar wiring ───────────────────────────────────────────

  function _wireToolbar(el) {
    el.querySelectorAll("[data-ema-filter]").forEach(btn => {
      btn.addEventListener("click", () => { _filter = btn.getAttribute("data-ema-filter"); _fullRender(); });
    });
    const si = el.querySelector("#emaSearchInput");
    if (si) {
      si.addEventListener("input", ev => {
        _search = ev.target.value || "";
        _fullRender();
        _mountEl?.querySelector("#emaSearchInput")?.focus();
      });
    }
  }

  // ── Graph toggle — NO re-render ──────────────────────────────

  function _wireGraphButtons(el) {
    el.querySelectorAll("[data-graph-id]").forEach(btn => {
      btn.addEventListener("click", () => _toggleGraph(btn.getAttribute("data-graph-id")));
    });
  }

  function _toggleGraph(id) {
    const area = _mountEl?.querySelector(`[data-graph-area="${id}"]`);
    const btn  = _mountEl?.querySelector(`[data-graph-id="${id}"]`);
    if (!area || !btn) return;
    const opening = area.hidden;
    area.hidden = !opening;
    if (opening) {
      btn.innerHTML = `<i class="bx bx-hide" aria-hidden="true"></i> Hide graph`;
      btn.classList.add("is-active");
      _drawChart(id);
    } else {
      btn.innerHTML = `<i class="bx bx-line-chart" aria-hidden="true"></i> Show graph`;
      btn.classList.remove("is-active");
      _destroyChart(id);
    }
  }

  // ── Signal downsampling (cached) ─────────────────────────────

  function _getSignal(source) {
    if (!_processed || !source) return null;
    if (_sigCache[source]) return _sigCache[source];

    let raw = getPath(_processed, source);
    if (!raw?.length) return null;

    // Abs jerk for readability
    if (source === "derived.jerk") raw = Array.from(raw).map(Math.abs);

    const t0   = _processed.t[0];
    const tRaw = _processed.t;
    const n    = raw.length;
    const MAX  = 600;
    const step = Math.max(1, Math.floor(n / MAX));

    // Max-preserving downsample: within each bucket keep the sample
    // with the highest absolute value so peaks are never hidden.
    const count = Math.ceil(n / step);
    const data  = new Float32Array(count);
    const times = new Float32Array(count);

    for (let j = 0; j < count; j++) {
      const bStart = j * step;
      const bEnd   = Math.min(bStart + step, n) - 1;
      let maxAbs = -Infinity, maxIdx = bStart;
      for (let i = bStart; i <= bEnd; i++) {
        const av = Math.abs(raw[i]);
        if (av > maxAbs) { maxAbs = av; maxIdx = i; }
      }
      data[j]  = raw[maxIdx];
      times[j] = tRaw[maxIdx] - t0;  // seconds from session start
    }

    _sigCache[source] = { data, times };
    return _sigCache[source];
  }

  // ── Chart drawing ─────────────────────────────────────────────

  function _drawChart(id) {
    if (typeof Chart === "undefined") return;
    const m = METRIC_MAP[id];
    if (!m?.graphable) return;
    _destroyChart(id);

    const canvas = _mountEl?.querySelector(`#emachart-${id}`);
    if (!canvas) return;

    const sig = _getSignal(m.source);
    if (!sig) {
      canvas.parentElement.innerHTML = `<div class="ema-graph-placeholder">No signal data available</div>`;
      return;
    }

    const { data, times } = sig;
    const dark    = document.body.classList.contains("dark");
    const lineClr = dark ? "rgba(138,171,255,0.85)" : "rgba(60,120,255,0.85)";
    const fillClr = dark ? "rgba(138,171,255,0.10)" : "rgba(60,120,255,0.07)";
    const gridClr = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
    const tickClr = dark ? "rgba(245,247,255,0.35)" : "rgba(17,19,26,0.4)";

    // Use plain numeric array as labels — Chart.js only calls the tick
    // callback for actually-visible ticks, so no string pre-formatting cost.
    const numericTimes = Array.from(times);  // Float32 → plain JS numbers

    _charts[id] = new Chart(canvas, {
      type: "line",
      data: {
        datasets: [{
          // {x, y} pairs so the linear x-axis reads actual time values
          data: Array.from(data, (v, i) => ({ x: numericTimes[i], y: v })),
          borderColor: lineClr, backgroundColor: fillClr,
          borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: "index", intersect: false,
            callbacks: {
              title: ctx => `t = ${Number(ctx[0].label).toFixed(1)} s`,
              label: ctx => `${Number(ctx.parsed.y).toFixed(2)}${m.unit ? " " + m.unit : ""}`,
            }
          }
        },
        scales: {
          x: {
            type: "linear",   // treat labels as real numbers, not categories
            display: true,
            ticks: {
              color: tickClr, font: { size: 9 }, maxTicksLimit: 7,
              callback: (val) => `${Number(val).toFixed(0)}s`,
            },
            grid: { color: gridClr },
          },
          y: {
            display: true, grid: { color: gridClr },
            ticks: { color: tickClr, font: { size: 9 }, maxTicksLimit: 4 }
          }
        }
      }
    });
  }

  function _destroyChart(id) {
    if (_charts[id]) { try { _charts[id].destroy(); } catch {} delete _charts[id]; }
  }

  function _destroyAllCharts() {
    for (const id in _charts) _destroyChart(id);
  }

  window.MoveSyncExpandedMetricsPanel = { mount, render, setSession, onProcessed };
})();