// app/navigation/session-viewer/imu-panel/plots/time-series-chart.js
(() => {
  "use strict";

  window.MoveSyncCharts = window.MoveSyncCharts || {};

  const lower = (s) => String(s ?? "").trim().toLowerCase();

  function findCol(headers, key) {
    const idx = headers.map(lower).indexOf(lower(key));
    return idx >= 0 ? idx : -1;
  }

  function toNum(x) {
    const v = Number(x);
    return Number.isFinite(v) ? v : null;
  }

  function buildSeries(rows, tIdx, xIdx, yIdx, zIdx) {
    const xs = [];
    const ys = [];
    const zs = [];
    const mags = [];

    for (const r of rows) {
      const t = toNum(r?.[tIdx]);
      if (t == null) continue;

      const x = toNum(r?.[xIdx]);
      const y = toNum(r?.[yIdx]);
      const z = toNum(r?.[zIdx]);

      if (x != null) xs.push({ x: t, y: x });
      if (y != null) ys.push({ x: t, y: y });
      if (z != null) zs.push({ x: t, y: z });

      if (x != null && y != null && z != null) {
        mags.push({ x: t, y: Math.sqrt(x * x + y * y + z * z) });
      }
    }

    // If time is not strictly increasing, Chart.js lines can look â€œscribblyâ€.
    const byT = (a, b) => a.x - b.x;
    xs.sort(byT);
    ys.sort(byT);
    zs.sort(byT);
    mags.sort(byT);

    return { xs, ys, zs, mags };
  }

  // Draw cursor + marker + T1/T2 lines (fast; does not require rebuilding datasets)
  const cursorPlugin = {
    id: "movesyncCursor",
    afterDatasetsDraw(chart, args, pluginOptions) {
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      if (!xScale) return;

      const cursorX = pluginOptions?.getCursorX?.();
      const markerX = pluginOptions?.getMarkerX?.();
      const t1X = pluginOptions?.getT1X?.();
      const t2X = pluginOptions?.getT2X?.();

      const drawLineAt = (xValue, dash, stroke, width = 1) => {
        if (xValue == null || !Number.isFinite(xValue)) return;
        const px = xScale.getPixelForValue(xValue);
        if (px < chartArea.left || px > chartArea.right) return;

        ctx.save();
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        ctx.moveTo(px, chartArea.top);
        ctx.lineTo(px, chartArea.bottom);
        ctx.lineWidth = width;
        ctx.strokeStyle = stroke || "rgba(0,0,0,0.65)";
        ctx.stroke();
        ctx.restore();
      };

      // Cursor solid
      drawLineAt(cursorX, [], "rgba(0,0,0,0.65)", 1);

      // IMU marker dashed (yellow)
      drawLineAt(markerX, [6, 6], "rgba(232,232,22,0.95)", 1);

      // T1/T2 dashed lines
      drawLineAt(t1X, [4, 4], "rgba(79,179,100,0.95)", 1.25); // green-ish
      drawLineAt(t2X, [4, 4], "rgba(230,70,70,0.95)", 1.25); // red-ish
    },
  };

  class TimeSeriesChart {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.opts = opts || {};
      this.chart = null;

      if (!window.Chart) {
        console.warn("[TimeSeriesChart] Chart.js not found on window.Chart");
        return;
      }

      this._buildOrRebuild();
    }

    setRows(rows) {
      this.opts.rows = rows;
      this._buildOrRebuild();
    }

    _enabled(axisIdx) {
      const fn = this.opts.getAxisEnabled;
      return typeof fn === "function" ? !!fn(axisIdx) : true;
    }

    _buildOrRebuild() {
      const { headers, rows, timeIndex, series } = this.opts;
      if (!this.canvas || !headers?.length || !rows?.length || timeIndex == null) {
        this._destroy();
        return;
      }

      const xKey = series?.[0];
      const yKey = series?.[1];
      const zKey = series?.[2];

      const xIdx = findCol(headers, xKey);
      const yIdx = findCol(headers, yKey);
      const zIdx = findCol(headers, zKey);

      if (xIdx < 0 || yIdx < 0 || zIdx < 0) {
        console.warn("[TimeSeriesChart] Missing expected columns:", { xKey, yKey, zKey, headers });
        this._destroy();
        return;
      }

      const { xs, ys, zs, mags } = buildSeries(rows, timeIndex, xIdx, yIdx, zIdx);

      let seriesX = xs, seriesY = ys, seriesZ = zs, seriesMag = mags;

      const isAccel =
        lower(xKey) === "ax" && lower(yKey) === "ay" && lower(zKey) === "az";

      if (isAccel && window.MoveSyncIMUFilters) {
        // Build raw arrays from rows
        const times = [];
        const ax = [];
        const ay = [];
        const az = [];

        for (const r of rows) {
          const t = toNum(r?.[timeIndex]);
          if (t == null) continue;
          const x = toNum(r?.[xIdx]);
          const y = toNum(r?.[yIdx]);
          const z = toNum(r?.[zIdx]);
          if (x == null || y == null || z == null) continue;

          times.push(t); ax.push(x); ay.push(y); az.push(z);
        }

        // Ensure time-ordered
        const order = times
          .map((t, i) => ({ t, i }))
          .sort((a, b) => a.t - b.t)
          .map(o => o.i);

        const T = order.map(i => times[i]);
        const X = order.map(i => ax[i]);
        const Y = order.map(i => ay[i]);
        const Z = order.map(i => az[i]);

        const F = window.MoveSyncIMUFilters;
        const fx = F.filterAccelerationAxis(X, T, true);
        const fy = F.filterAccelerationAxis(Y, T, true);
        const fz = F.filterAccelerationAxis(Z, T, true);

        const mag = F.magnitude(fx, fy, fz);
        const magSmooth = F.ewma(mag, 0.3);

        // Downsample
        seriesX = F.downsampleXY(T, fx, 5000);
        seriesY = F.downsampleXY(T, fy, 5000);
        seriesZ = F.downsampleXY(T, fz, 5000);
        seriesMag = F.downsampleXY(T, magSmooth, 5000);
      }

      // Stable dataset order:
      // 0:X 1:Y 2:Z 3:Total
      const datasets = [
        {
          label: "X",
          data: seriesX,
          hidden: !this._enabled(0),
          borderColor: "#ff5252",
          backgroundColor: "transparent",
        },
        {
          label: "Y",
          data: seriesY,
          hidden: !this._enabled(1),
          borderColor: "#00e676",
          backgroundColor: "transparent",
        },
        {
          label: "Z",
          data: seriesZ,
          hidden: !this._enabled(2),
          borderColor: "#40c4ff",
          backgroundColor: "transparent",
        },
        {
          label: "Total",
          data: seriesMag,
          hidden: !this._enabled(3),
          borderColor: "#ff9800",
          backgroundColor: "transparent",
        },
      ];

      // If already built, only replace data
      if (this.chart) {
        this.chart.data.datasets = datasets;
        this.chart.update("none");
        return;
      }

      this.chart = new window.Chart(this.canvas, {
        type: "line",
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          parsing: false,
          normalized: true,

          // âœ… CRITICAL: hover/tooltip aligns by X-time (so you get X/Y/Z/Total together)
          interaction: { mode: "x", intersect: false },

          elements: {
            line: { borderWidth: 1.25 },
            point: { radius: 0 },
          },
          scales: {
            x: {
              type: "linear",
              min: (typeof this.opts.getMinX === "function" ? this.opts.getMinX() : 0),
              max: (typeof this.opts.getMaxX === "function" ? this.opts.getMaxX() : undefined),
              bounds: "ticks",
              grace: 0,
              title: { display: true, text: "Time (s)" },
              ticks: { maxTicksLimit: 8 },
            },
            y: {
              type: "linear",
              ticks: { maxTicksLimit: 6 },
            },
          },
          plugins: {
            legend: { display: false },

            // Tooltip: show ALL series at this time
            tooltip: {
              enabled: true,
              mode: "x",
              intersect: false,

              filter: (item, index, items) => {
                return items.findIndex(p => p.datasetIndex === item.datasetIndex) === index;
              },

              itemSort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0),

              callbacks: {
                title: (items) => {
                  const t = items?.[0]?.parsed?.x;
                  return Number.isFinite(t) ? `t = ${t.toFixed(3)} s` : "";
                },
                label: (ctx) => {
                  const y = ctx?.parsed?.y;
                  const name = ctx?.dataset?.label || "";
                  return Number.isFinite(y) ? `${name}: ${y.toFixed(3)}` : `${name}: â€”`;
                },
              },
            },

            movesyncCursor: {
              getCursorX: this.opts.getCursorX,
              getMarkerX: this.opts.getMarkerX,
              getT1X: this.opts.getT1X,
              getT2X: this.opts.getT2X,
            },
          },
        },
        plugins: [cursorPlugin],
      });
    }

    destroy() {
      this._destroy();
    }

    update(mode) {
      if (!this.chart) {
        this._buildOrRebuild();
        return;
      }

      const minX = (typeof this.opts.getMinX === "function" ? this.opts.getMinX() : 0);
      const maxX = (typeof this.opts.getMaxX === "function" ? this.opts.getMaxX() : null);

      if (Number.isFinite(minX)) this.chart.options.scales.x.min = minX;
      if (maxX != null && Number.isFinite(maxX)) this.chart.options.scales.x.max = maxX;

      // Update visibility
      const ds = this.chart.data.datasets || [];
      if (ds[0]) ds[0].hidden = !this._enabled(0);
      if (ds[1]) ds[1].hidden = !this._enabled(1);
      if (ds[2]) ds[2].hidden = !this._enabled(2);
      if (ds[3]) ds[3].hidden = !this._enabled(3);

      this.chart.update(mode || "none");
    }

    _destroy() {
      if (this.chart) {
        try { this.chart.destroy(); } catch {}
        this.chart = null;
      }
    }
  }

  window.MoveSyncCharts.TimeSeriesChart = TimeSeriesChart;
})();