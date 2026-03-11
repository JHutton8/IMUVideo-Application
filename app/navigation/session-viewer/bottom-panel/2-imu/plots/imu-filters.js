
(() => {
  "use strict";

  // -------------------------------------------------------
  // Moving average (centred, clips at edges)
  // Still available for chart smoothing if needed.
  // -------------------------------------------------------
  function movingAverage(data, windowSize = 5) {
    if (!Array.isArray(data) || data.length === 0) return [];

    const w = Math.max(1, Math.floor(Number(windowSize) || 1));
    const half = Math.floor(w / 2);
    const out = new Array(data.length);

    for (let i = 0; i < data.length; i++) {
      let sum = 0, count = 0;
      const a = Math.max(0, i - half);
      const b = Math.min(data.length - 1, i + half);
      for (let j = a; j <= b; j++) {
        const v = Number(data[j]);
        if (!Number.isFinite(v)) continue;
        sum += v;
        count++;
      }
      out[i] = count ? sum / count : 0;
    }

    return out;
  }

  // -------------------------------------------------------
  // First-order IIR low-pass filter
  // alpha = dt / (RC + dt),  RC = 1 / (2π·fc)
  // -------------------------------------------------------
  function lowPass(data, sampleRateHz = 100, cutoffHz = 20) {
    if (!Array.isArray(data) || data.length === 0) return [];
    const sr = Math.max(1e-6, Number(sampleRateHz) || 100);
    const fc = Math.max(1e-6, Number(cutoffHz) || 20);

    const RC = 1 / (fc * 2 * Math.PI);
    const dt = 1 / sr;
    const alpha = dt / (RC + dt);

    const out = new Array(data.length);
    out[0] = Number(data[0]) || 0;

    for (let i = 1; i < data.length; i++) {
      const x = Number(data[i]) || 0;
      out[i] = alpha * x + (1 - alpha) * out[i - 1];
    }

    return out;
  }

  // -------------------------------------------------------
  // First-order IIR high-pass filter
  // alpha = RC / (RC + dt)
  //
  // NOTE: For gravity removal from accelerometer data, use
  // imu-processing.js (quaternion-based gravity removal) instead.
  // This high-pass is only appropriate for crude DC removal
  // on individual axes, not for producing linear acceleration.
  // -------------------------------------------------------
  function highPass(data, sampleRateHz = 100, cutoffHz = 0.5) {
    if (!Array.isArray(data) || data.length === 0) return [];
    const sr = Math.max(1e-6, Number(sampleRateHz) || 100);
    const fc = Math.max(1e-6, Number(cutoffHz) || 0.5);

    const RC = 1 / (fc * 2 * Math.PI);
    const dt = 1 / sr;
    const alpha = RC / (RC + dt);

    const out = new Array(data.length);
    out[0] = 0;

    for (let i = 1; i < data.length; i++) {
      const x     = Number(data[i])     || 0;
      const xPrev = Number(data[i - 1]) || 0;
      out[i] = alpha * (out[i - 1] + x - xPrev);
    }

    return out;
  }

  // -------------------------------------------------------
  // Exponential weighted moving average
  // alpha: 0 = very smooth (slow), 1 = no smoothing (raw)
  // -------------------------------------------------------
  function ewma(data, alpha = 0.3) {
    if (!Array.isArray(data) || data.length === 0) return [];
    const a = Math.min(1, Math.max(0, Number(alpha) || 0.3));

    const out = new Array(data.length);
    out[0] = Number(data[0]) || 0;

    for (let i = 1; i < data.length; i++) {
      const x = Number(data[i]) || 0;
      out[i] = a * x + (1 - a) * out[i - 1];
    }

    return out;
  }

  // -------------------------------------------------------
  // Sample rate estimator (median inter-sample interval)
  // Robust against gaps and outliers.
  // -------------------------------------------------------
  function estimateSampleRateHz(times) {
    if (!Array.isArray(times) || times.length < 3) return 100;

    const diffs = [];
    for (let i = 1; i < times.length; i++) {
      const a = Number(times[i - 1]);
      const b = Number(times[i]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const dt = b - a;
      // Ignore gaps > 2s (recording pauses) and negative/zero diffs
      if (dt > 0 && dt < 2.0) diffs.push(dt);
    }

    if (!diffs.length) return 100;

    diffs.sort((x, y) => x - y);
    const median = diffs[Math.floor(diffs.length / 2)] || 0.01;

    const hz = Math.round(1 / median);
    return Math.max(10, Math.min(1000, hz));
  }

  // -------------------------------------------------------
  // filterAccelerationAxis
  // -------------------------------------------------------
  function filterAccelerationAxis(axis, times) {
    const hz = estimateSampleRateHz(times);
    return lowPass(axis, hz, 20);
  }

  // -------------------------------------------------------
  // Vector magnitude over parallel x/y/z arrays
  // -------------------------------------------------------
  function magnitude(x, y, z) {
    const n = Math.min(x?.length || 0, y?.length || 0, z?.length || 0);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const xx = Number(x[i]) || 0;
      const yy = Number(y[i]) || 0;
      const zz = Number(z[i]) || 0;
      out[i] = Math.sqrt(xx * xx + yy * yy + zz * zz);
    }
    return out;
  }

  // -------------------------------------------------------
  // Downsampling for chart display (skip-based)
  // Keeps the visual shape while capping dataset size.
  // Not suitable for metric computation — use full arrays there.
  // -------------------------------------------------------
  function downsampleXY(times, values, maxPoints = 5000) {
    const n = Math.min(times?.length || 0, values?.length || 0);
    const cap = Math.max(1, Math.floor(Number(maxPoints) || 5000));

    if (n <= cap) {
      const out = [];
      for (let i = 0; i < n; i++) out.push({ x: times[i], y: values[i] });
      return out;
    }

    const step = Math.ceil(n / cap);
    const out = [];
    for (let i = 0; i < n; i += step) out.push({ x: times[i], y: values[i] });
    return out;
  }

  // -------------------------------------------------------
  // Public API
  // -------------------------------------------------------
  window.MoveSyncIMUFilters = {
    movingAverage,
    lowPass,
    highPass,
    ewma,
    estimateSampleRateHz,
    filterAccelerationAxis,
    magnitude,
    downsampleXY,
  };

})();
