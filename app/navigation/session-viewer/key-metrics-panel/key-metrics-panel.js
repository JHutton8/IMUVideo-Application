// =======================================
// Key Metrics Panel — Session Viewer sidebar
// Listens for movesync:imu-processed and fills tiles with real values.
// Speed/distance use burst-corrected ZUPT integration from imu-processing.js.
// =======================================
(() => {
  "use strict";

  const REGISTRY = {
    peak_accel:       { label: "Peak acceleration",      unit: "G",    icon: "bx-trending-up" },
    mean_accel:       { label: "Mean acceleration",      unit: "G",    icon: "bx-bar-chart-alt-2" },
    accel_rms:        { label: "Acceleration RMS",       unit: "G",    icon: "bx-pulse" },
    peak_jerk:        { label: "Peak jerk",              unit: "G/s",  icon: "bx-zap" },
    peak_speed:       { label: "Peak speed",             unit: "m/s",  icon: "bx-wind" },
    mean_burst_speed: { label: "Avg peak speed (per burst)",  unit: "m/s",  icon: "bx-transfer" },
    total_distance:   { label: "Total distance",         unit: "m",    icon: "bx-run" },
    peak_gyro:        { label: "Peak angular velocity",  unit: "°/s",  icon: "bx-rotate-right" },
    mean_gyro:        { label: "Mean angular velocity",  unit: "°/s",  icon: "bx-rotate-left" },
    mean_pitch:       { label: "Mean pitch",             unit: "°",    icon: "bx-trending-up" },
    mean_roll:        { label: "Mean roll",              unit: "°",    icon: "bx-rotate-right" },
    pitch_range:      { label: "Pitch range",            unit: "°",    icon: "bx-expand" },
    roll_range:       { label: "Roll range",             unit: "°",    icon: "bx-expand" },
    cadence:          { label: "Cadence",                unit: "spm",  icon: "bx-time-five" },
    rep_count:        { label: "Rep count",              unit: "",     icon: "bx-list-ol" },
    mean_rep_time:    { label: "Mean rep time",          unit: "s",    icon: "bx-timer" },
    total_duration:   { label: "Session duration",       unit: "s",    icon: "bx-time" },
    active_time:      { label: "Active time",            unit: "s",    icon: "bx-walk" },
    total_impulse:    { label: "Total impulse",          unit: "G·s",  icon: "bx-pulse" },
  };

  function getMeta(id) {
    return REGISTRY[id] || { label: id, unit: "", icon: "bx-data" };
  }

  // -------------------------------------------------------
  // Compute all scalar metrics from a ProcessedSession.
  // Returns { metricId: "formatted string" }
  // Exposed on window so expanded-metrics-panel can reuse it.
  // -------------------------------------------------------
  function extractMetrics(processed) {
    if (!processed) return {};
    const s  = processed.summary;
    const e  = processed.fusion?.euler;
    const d  = processed.derived;
    const m  = processed.motion;
    const n  = processed.frameCount;
    const sr = processed.sampleRate;
    const out = {};

    function set(id, val, dp) {
      if (val == null || !isFinite(val)) return;
      out[id] = Number(val).toFixed(dp);
    }

    // Acceleration
    set("peak_accel", s.peakAccel, 2);
    set("mean_accel", s.meanAccel, 2);
    set("peak_jerk",  s.peakJerk,  2);
    if (d?.accelMagnitude && n > 0) {
      let sq = 0;
      for (let i = 0; i < n; i++) sq += d.accelMagnitude[i] ** 2;
      set("accel_rms", Math.sqrt(sq / n), 2);
    }

    // Speed & distance — values come from burst-corrected integration in imu-processing.js
    set("peak_speed",       s.peakSpeed,       2);
    set("mean_burst_speed", s.meanBurstSpeed,  2);
    set("total_distance",   s.totalDistance,   2);

    // Angular velocity
    set("peak_gyro", s.peakGyro, 1);
    if (d?.gyroMagnitude && n > 0) {
      let gs = 0;
      for (let i = 0; i < n; i++) gs += d.gyroMagnitude[i];
      set("mean_gyro", gs / n, 1);
    }

    // Orientation (segment angles from AHRS fusion)
    if (e && n > 0) {
      let sumP = 0, sumR = 0;
      let minP = Infinity, maxP = -Infinity, minR = Infinity, maxR = -Infinity;
      for (let i = 0; i < n; i++) {
        sumP += e.pitch[i]; sumR += e.roll[i];
        if (e.pitch[i] < minP) minP = e.pitch[i];
        if (e.pitch[i] > maxP) maxP = e.pitch[i];
        if (e.roll[i]  < minR) minR = e.roll[i];
        if (e.roll[i]  > maxR) maxR = e.roll[i];
      }
      set("mean_pitch",  sumP / n,    1);
      set("mean_roll",   sumR / n,    1);
      set("pitch_range", maxP - minP, 1);
      set("roll_range",  maxR - minR, 1);
    } else if (s.pitchRange != null) {
      set("pitch_range", s.pitchRange, 1);
      set("roll_range",  s.rollRange,  1);
    }

    // Rhythm / cadence via peak detection on smoothed accel magnitude
    const rhythm = _detectRhythm(processed);
    if (rhythm) {
      set("cadence",       rhythm.cadence,     0);
      set("rep_count",     rhythm.repCount,    0);
      set("mean_rep_time", rhythm.meanRepTime, 2);
    }

    // Session totals
    set("total_duration", s.duration, 1);
    if (d?.accelMagnitude && sr > 0 && n > 0) {
      let imp = 0, active = 0;
      const dt = 1 / sr;
      for (let i = 0; i < n; i++) {
        imp += d.accelMagnitude[i] * dt;
        if (d.accelMagnitude[i] > 1.15) active++;
      }
      set("total_impulse", imp,         1);
      set("active_time",   active / sr, 1);
    }

    return out;
  }

  function _detectRhythm(processed) {
    const d  = processed?.derived;
    const t  = processed?.t;
    const sr = processed?.sampleRate;
    if (!d || !t || !sr || sr <= 0) return null;
    const sig = d.accelMagnitudeSmooth;
    const n   = sig.length;
    if (n < sr * 1.5) return null;

    let sum = 0, sum2 = 0;
    for (let i = 0; i < n; i++) { sum += sig[i]; sum2 += sig[i] ** 2; }
    const mean = sum / n;
    const std  = Math.sqrt(Math.max(0, sum2 / n - mean ** 2));
    const thr  = mean + 0.4 * std;
    const minSep = Math.max(1, Math.round(sr * 0.2));

    const peaks = [];
    for (let i = minSep; i < n - minSep; i++) {
      if (sig[i] < thr) continue;
      let ok = true;
      for (let j = i - minSep; j <= i + minSep; j++) {
        if (j !== i && sig[j] >= sig[i]) { ok = false; break; }
      }
      if (ok) peaks.push(i);
    }
    if (peaks.length < 2) return null;

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) intervals.push(t[peaks[i]] - t[peaks[i-1]]);
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    if (!isFinite(median) || median <= 0) return null;
    return { cadence: 60 / median, repCount: peaks.length, meanRepTime: median };
  }

  // -------------------------------------------------------
  // Panel factory
  // -------------------------------------------------------
  function create({ mountId }) {
    let _mountEl = null;
    let _session = null;
    let _vals    = {};

    function mount() { _mountEl = document.getElementById(mountId); }

    function render(session) {
      _session = session || null;
      _vals    = {};
      _renderHTML(_mountEl || (_mountEl = document.getElementById(mountId)));
    }

    function onProcessed(processed) {
      _vals = extractMetrics(processed);
      _mountEl?.querySelectorAll("[data-kmp-metric]").forEach(span => {
        span.textContent = _vals[span.getAttribute("data-kmp-metric")] ?? "—";
      });
    }

    function _renderHTML(el) {
      if (!el) return;
      const keyMetrics = Array.isArray(_session?.keyMetrics) ? _session.keyMetrics : [];
      const presetName = _session?.presetName || null;

      if (!keyMetrics.length) {
        el.innerHTML = `
          <div class="kmp-card">
            <div class="kmp-head">
              <div class="kmp-title"><i class="bx bx-line-chart" aria-hidden="true"></i> Key Metrics</div>
            </div>
            <div class="kmp-empty">
              <i class="bx bx-info-circle kmp-empty-icon" aria-hidden="true"></i>
              <div class="kmp-empty-text">
                No sport preset selected for this session.<br>
                Assign a preset in <b>Upload</b> to see key metrics here.
              </div>
            </div>
          </div>`;
        return;
      }

      el.innerHTML = `
        <div class="kmp-card">
          <div class="kmp-head">
            <div class="kmp-title"><i class="bx bx-line-chart" aria-hidden="true"></i> Key Metrics</div>
            ${presetName ? `<div class="kmp-preset-badge">${presetName}</div>` : ""}
          </div>
          <div class="kmp-grid">
            ${keyMetrics.map(id => {
              const meta = getMeta(id);
              return `<div class="kmp-tile">
                <div class="kmp-tile-icon"><i class="bx ${meta.icon}" aria-hidden="true"></i></div>
                <div class="kmp-tile-body">
                  <div class="kmp-tile-label">${meta.label}</div>
                  <div class="kmp-tile-value">
                    <span class="kmp-tile-num" data-kmp-metric="${id}">${_vals[id] ?? "—"}</span>
                    ${meta.unit ? `<span class="kmp-tile-unit">${meta.unit}</span>` : ""}
                  </div>
                </div>
              </div>`;
            }).join("")}
          </div>
        </div>`;
    }

    return { mount, render, onProcessed };
  }

  window.MoveSyncKeyMetricsPanel = { create, extractMetrics };
})();