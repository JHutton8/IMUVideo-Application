// app/navigation/session-viewer/imu-panel/plots/imu-filters.js
(() => {
  "use strict";

  function movingAverage(data, windowSize = 5) {
    if (!data?.length) return [];
    const half = Math.floor(windowSize / 2);
    const out = new Array(data.length);

    for (let i = 0; i < data.length; i++) {
      let sum = 0, count = 0;
      const a = Math.max(0, i - half);
      const b = Math.min(data.length - 1, i + half);
      for (let j = a; j <= b; j++) { sum += data[j]; count++; }
      out[i] = sum / Math.max(1, count);
    }
    return out;
  }

  function lowPass(data, sampleRateHz = 100, cutoffHz = 10) {
    if (!data?.length) return [];
    const RC = 1 / (cutoffHz * 2 * Math.PI);
    const dt = 1 / sampleRateHz;
    const alpha = dt / (RC + dt);

    const out = new Array(data.length);
    out[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      out[i] = alpha * data[i] + (1 - alpha) * out[i - 1];
    }
    return out;
  }

  function highPass(data, sampleRateHz = 100, cutoffHz = 0.5) {
    if (!data?.length) return [];
    const RC = 1 / (cutoffHz * 2 * Math.PI);
    const dt = 1 / sampleRateHz;
    const alpha = RC / (RC + dt);

    const out = new Array(data.length);
    out[0] = 0;
    for (let i = 1; i < data.length; i++) {
      out[i] = alpha * (out[i - 1] + data[i] - data[i - 1]);
    }
    return out;
  }

  function ewma(data, alpha = 0.3) {
    if (!data?.length) return [];
    const out = new Array(data.length);
    out[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      out[i] = alpha * data[i] + (1 - alpha) * out[i - 1];
    }
    return out;
  }

  function estimateSampleRateHz(times) {
    if (!times || times.length < 3) return 100;
    const diffs = [];
    for (let i = 1; i < times.length; i++) {
      const dt = times[i] - times[i - 1];
      if (dt > 0 && Number.isFinite(dt)) diffs.push(dt);
    }
    diffs.sort((a, b) => a - b);
    const median = diffs[Math.floor(diffs.length / 2)] || 0.01;
    return median > 0 ? 1 / median : 100;
  }

  function filterAccelerationAxis(axis, times, removeGravity = true) {
    const hz = estimateSampleRateHz(times);
    const ma = movingAverage(axis, 5);
    const lp = lowPass(ma, hz, 10);
    return removeGravity ? highPass(lp, hz, 0.5) : lp;
  }

  function magnitude(x, y, z) {
    const n = Math.min(x.length, y.length, z.length);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.sqrt(x[i] ** 2 + y[i] ** 2 + z[i] ** 2);
    return out;
  }

  function downsampleXY(times, values, maxPoints = 5000) {
    const n = Math.min(times.length, values.length);
    if (n <= maxPoints) {
      const out = [];
      for (let i = 0; i < n; i++) out.push({ x: times[i], y: values[i] });
      return out;
    }
    const step = Math.ceil(n / maxPoints);
    const out = [];
    for (let i = 0; i < n; i += step) out.push({ x: times[i], y: values[i] });
    return out;
  }

  window.MoveSyncIMUFilters = {
    filterAccelerationAxis,
    magnitude,
    ewma,
    downsampleXY,
  };
})();