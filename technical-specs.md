# MoveSync — Technical Documentation

Deep dive into the architecture, module system, and data pipelines.

---

## System Overview

MoveSync is a **client-side single-page application** built with plain HTML, CSS, and JavaScript — no framework, no build step. Navigation is hash-based; page content is loaded by fetching HTML partials and injecting them into `#pageRoot`.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **No backend** | Privacy-first, zero cost, works offline, instant GitHub Pages deployment |
| **Vanilla JS + IIFE modules** | No build toolchain, no dependency management, contributors can read any file directly |
| **Hash router + HTML partials** | Avoids full-page reloads; each page ships its own HTML, CSS, and JS |
| **In-memory session store** | Files (video, CSV) are `File` objects that cannot survive localStorage; keeping everything in RAM avoids silent data loss |
| **Event-driven coordination** | Modules communicate via `CustomEvent` on `document`, keeping them decoupled |
| **ZIP export** | Self-contained, shareable projects without a database |

---

## File Structure

```
index.html                          # App shell, sidebar, intro overlay

app/
├── app-shell.js                    # Router, asset loader, namespace bootstrap
├── core/
│   └── session-store.js            # In-memory project/session store (MoveSyncSessionStore)
│
├── styles/
│   ├── styles.css                  # Global CSS entrypoint (@imports below)
│   ├── base/                       # fonts, variables, reset
│   └── layout/                     # background, shell, header, page-root, scrollbar
│
├── features/
│   ├── intro/                      # Splash overlay + flow-field canvas animation
│   ├── sidebar/
│   │   ├── sidebar.js              # Collapse/expand, ARIA, localStorage persistence
│   │   ├── theme/theme.js          # Light/dark toggle
│   │   └── search/search.js        # In-page Ctrl+F search with <mark> highlighting
│   └── tutorial/                   # Tutorial hub + auto-scroll step runner
│       └── tutorials/              # Per-feature tutorial definitions
│
└── navigation/
    ├── dashboard/                  # Dashboard page (KPIs, recent sessions)
    ├── upload/                     # Project + session upload wizard
    ├── library/                    # Project library (search, sort, export, import)
    ├── sport-presets/              # Sport preset CRUD
    ├── compare-sessions/           # Side-by-side session comparison
    └── session-viewer/             # Main analysis page
        ├── session-viewer.js       # Page controller + dep loader
        ├── session-viewer.html
        ├── session-viewer.css      # @imports all sub-panel CSS
        │
        ├── session-picker/         # Project + session dropdown picker
        ├── key-metrics-panel/      # Compact preset-driven metric tiles
        ├── timestamps/             # Timestamp annotation panel
        ├── time-sync/              # Video ↔ IMU time alignment
        ├── video-panel/            # Video player, pose overlay, metadata popover
        │   ├── arm-angle-analysis/ # Quaternion-based joint angle calculator
        │   └── pose-overlay/       # MoveNet loading, start/stop, joint UI
        └── bottom-panel/
            ├── 1-expanded-metrics/ # Full metric breakdown with inline graphs
            ├── 2-imu/              # IMU charts, cursor, CSV preview
            │   └── plots/          # imu-filters.js, time-series-chart.js
            └── 3-sensor-fusion/    # 3D disc visualisation, Madgwick wrapper
                ├── sensor-fusion.js
                └── ahrs_min.js     # Madgwick & Mahony filter implementations
        │
        └── imu-processing/
            └── imu-processing.js   # Full IMU pipeline (fusion, ZUPT, metrics)
```

---

## Application Bootstrap

### Startup Sequence

```
index.html loads
  → styles.css
  → session-store.js      (defines MoveSyncSessionStore)
  → app-shell.js          (defines MoveSyncApp, router, asset loader)
  → sidebar.js            (self-registers on movesync:app-init)
  → theme.js              (self-registers on movesync:app-init)
  → search.js             (self-registers on movesync:app-init)
  → intro.js              (runs DOMContentLoaded, starts splash)
      → User clicks "Start tracking"
          → MoveSyncApp.init()
              → initNavigation()   (wire sidebar links + hashchange)
              → hydrateRuntimeFromDb()
              → initFirstLoad()    (force Dashboard hash, load first page)
              → dispatchEvent(movesync:app-init)
                  → sidebar, theme, search modules initialise
```

### Global Namespaces

| Global | Purpose |
|--------|---------|
| `window.MoveSyncApp` | Router, asset loader, DOM cache, `app.init()` |
| `window.MoveSync` | Shared helpers (e.g. `goToPage(name)`) |
| `window.MoveSyncPages` | Page module registry: `{ "Dashboard": { init, destroy } }` |
| `window.MoveSyncSessionStore` | Project/session CRUD API |
| `window.MoveSyncTutorials` | Tutorial definition registry |

---

## Router & Asset Loader

### Hash-based Routing (`app-shell.js`)

Navigation links carry `data-page` and `data-src` attributes:

```html
<a href="#Dashboard" data-page="Dashboard"
   data-src="app/navigation/dashboard/dashboard.html">
```

On `hashchange` (or initial load), the router:
1. Decodes the hash to a page name
2. Finds the matching sidebar link
3. Fetches `data-src` via `fetch()`
4. Injects the HTML into `#pageRoot`
5. Calls `loadAssetsForPage(name)` which loads CSS and JS
6. Calls `mount()` or `init()` on the registered page module

### Page Asset Manifest

Each page declares its CSS and JS in `app.PAGE_ASSETS`:

```javascript
"Session Viewer": {
  css: "app/navigation/session-viewer/session-viewer.css",
  js: { always: ["app/navigation/session-viewer/session-viewer.js"] }
}
```

- **`once`**: Scripts that must only ever be injected once (e.g. heavy models)
- **`always`**: Scripts re-injected on every page visit (page controller logic)

### Page Module Lifecycle

```javascript
// Register a page:
window.MoveSyncPages["Dashboard"] = {
  init()    { /* wire events, fetch data, render */ },
  destroy() { /* abort controllers, clear references */ },
};
```

`init()` (or `mount()`) is called after HTML injection. `destroy()` is called before navigating away.

---

## Session Store (`session-store.js`)

All project and session data lives in `window.MoveSync.runtime.sessionViewer` — a plain object in RAM. There is no IndexedDB or localStorage persistence for file data (because `File` objects cannot be serialised).

### Data Shape

```javascript
runtime.sessionViewer = {
  projects: [
    {
      id: 1,
      name: "Athlete A — Week 3",
      notes: "...",
      createdAt: "ISO string",
      updatedAt: "ISO string",
      sessions: [
        {
          id: 1,
          name: "Warm-up",
          notes: "...",
          createdAt: "ISO string",
          videoFile: File | null,
          imuFiles: [File, ...],
          imus: [
            { id, label, file, csvText, skeletonNode }
          ],
          projectId: 1,
          project: { id: 1, name: "..." }
        }
      ]
    }
  ],
  activeProjectId: 1,
  activeSession: { /* session object */ },
  activeSessionRef: { projectId: 1, sessionId: 2 }
}
```

### Key API Methods

| Method | Description |
|--------|-------------|
| `getProjects()` | Returns all projects |
| `saveRuntimeProject(project)` | Upsert a project (assigns IDs if missing) |
| `deleteProject(id)` | Remove project and its sessions |
| `setActiveSession(projectId, sessionId)` | Set the active session; fires events |
| `getActiveSession()` | Returns the current active session object |
| `getSessionsForProject(projectId)` | Returns sessions for a given project |
| `hydrateRuntimeFromDb()` | Normalises IDs and fires change events on startup |

### Events Fired

| Event | When |
|-------|------|
| `movesync:projects-changed` | Any project create/update/delete |
| `movesync:sessions-changed` | Any session change or active session change |
| `movesync:active-session-changed` | Active session pointer changes |

---

## IMU Processing Pipeline (`imu-processing.js`)

Triggered by `movesync:imu-data-ready`, which `imu-panel.js` fires after parsing a CSV. The pipeline reads `window.__currentImuReadoutCache` (set by `imu-panel.js`) and writes `window.currentProcessedSession`.

### Pipeline Steps

```
1. detectSampleRate(t[])
   └── Median inter-sample interval → Hz (clamped 10–1000)

2. runMadgwick(raw, sampleRate)
   ├── Detect gyro units (p75 magnitude: >0.5 = deg/s, else rad/s)
   ├── Hard-iron calibration (per-axis median subtraction on magnetometer)
   ├── Run Madgwick filter sample-by-sample (6-DOF or 9-DOF)
   └── Return quaternions[n], valid, hasMag

3. removeGravity(raw, quaternions, n)
   ├── Rotate world gravity [0,0,-1] into body frame per sample
   ├── Subtract from raw accelerometer to get linear accel (body frame)
   └── Rotate back to world frame → linear.{x,y,z} in m/s²

4. lowPass(data, sampleRate, cutoff=20Hz)   ← applied once per signal
   └── First-order IIR — no double-smoothing

5. computeJerk(accelMagnitudeSmooth, t[])
   └── Central difference derivative → g/s

6. integrateWithZUPT(linear, raw, t[], sampleRate)
   ├── Stillness detection: gyro < 8°/s AND accel ∈ [0.80, 1.20] g
   │   for ≥ 8 consecutive samples
   ├── Reset velocity to zero at each ZUPT event
   └── Trapezoidal integration → velocity (m/s), displacement (m),
       cumulative distance (m), stillnessMask

7. computeEuler(quaternions)
   └── Roll, pitch, yaw in degrees

8. computeSummary(derived, motion, euler)
   └── Peak/mean accel, peak speed, total distance, ZUPT count,
       pitch/roll/yaw range, session duration
```

### Output: `ProcessedSession`

```javascript
{
  sampleRate, duration, frameCount,
  t,           // Float64Array of timestamps (seconds, zero-based)
  raw,         // { acc:{x,y,z}, gyro:{x,y,z}, mag:{x,y,z} } as Float32Arrays
  fusion: { quaternions, euler:{roll,pitch,yaw}, valid, hasMag },
  linear,      // { x, y, z } world-frame linear accel (Float32Array, m/s²)
  derived: {
    accelMagnitude, accelMagnitudeSmooth,
    gyroMagnitude, gyroMagnitudeSmooth,
    linearMagnitude, linearMagnitudeSmooth,
    jerk
  },
  motion: {
    velocityX, velocityY, velocityZ,
    displacementX, displacementY, displacementZ,
    speed, totalDistance, zuptEvents, stillnessMask
  },
  summary: { peakAccel, peakSpeed, totalDistance, ... }
}
```

### Events Fired

| Event | Payload |
|-------|---------|
| `movesync:imu-data-ready` | `{ index }` — fired by `imu-panel.js` after CSV parse |
| `movesync:imu-processed` | `{ index, processed }` — fired after full pipeline completes |

### Fast Cursor Lookup

`MoveSyncIMUProcessing.getValuesAtTime(processed, t)` uses binary search (`nearestIndex`) to return all derived values at a given IMU time in O(log n). This is called on every cursor update and video `timeupdate` event.

---

## IMU Panel (`imu-panel.js`)

Manages CSV parsing, chart rendering, cursor, and multi-sensor tab switching.

### CSV Parsing

```
parseCsv(text)
  → headers[], rows[][]

findTimeIndex(headers)
  → index of time column, or -1

detectTimeScaleFactor(rows, timeIdx)
  → scale factor to convert raw time values to seconds
    (e.g. milliseconds → 0.001, microseconds → 0.000001)

normalizeTimeColumnInPlace(rows, timeIdx)
  → zero-base and scale time column in-place; return { t0, maxT, scale }

buildImuReadoutCache(headers, rows, timeIdx)
  → { t[], acc:{x,y,z}, gyro:{x,y,z}, mag:{x,y,z} }
     (all plain JS arrays, sorted by time)
```

### Synthetic Timestamps

When no time column is found:
1. A banner appears with a sample-rate input (default 100 Hz)
2. A synthetic `t` column is prepended: `t[i] = i / hz`
3. Re-render is triggered if the user changes the Hz and clicks **Apply**

### Chart Rendering

Three `TimeSeriesChart` instances (from `time-series-chart.js`):
- `charts.acc` → `ax, ay, az`
- `charts.gyro` → `gx, gy, gz`
- `charts.mag` → `mx, my, mz`

Each chart includes the `movesyncCursor` plugin that draws:
- **Yellow solid line** — cursor position
- **Yellow dashed line** — IMU marker (time-sync reference point)
- **Green dashed line** — T1 start
- **Red dashed line** — T2 end

### Cursor Slider Alignment

The cursor `<input type="range">` must visually align with the chart plot area (which has dynamic padding for axis labels). After `Chart.js` computes `chartArea`, `alignImuCursorSliderToChartArea()` reads `chartArea.left` and `chartArea.right` and sets `margin-left` + `width` on the slider's wrapping column.

### Events Fired

| Event | Payload |
|-------|---------|
| `movesync:imu-cursor-changed` | `{ imuTime }` |
| `movesync:imu-selected` | `{ index }` — when IMU tab is switched |
| `movesync:imu-data-ready` | `{ index, hasData }` — triggers processing pipeline |

---

## Sensor Fusion 3D Panel (`sensor-fusion.js`)

`FusionPanel` (the singleton exposed as `window.MoveSyncViewerFusionPanel`) listens for `movesync:imu-processed`, calls `FusionProcessor.buildFromProcessed()` to convert the `ProcessedSession` to a display-ready orientation array, and then passes it to `FusionUI`.

### 3D Rendering

The disc is rendered on a plain Canvas 2D element — no WebGL dependency. Each frame:
1. Rotate 8 reference points (front ring, back ring) using `rotateVectorByQuaternion`
2. Sort side quads by average depth (painter's algorithm)
3. Draw back face → sorted sides → front face
4. Draw 3 axis arrows (X/Y/Z) with depth-dimmed opacity

### Video Sync

`FusionPanel` attaches to `timeupdate` and runs a `requestAnimationFrame` loop during playback. Cursor-driven updates are throttled to ~20 FPS via `renderThrottleMs`.

---

## Video Panel (`video-panel.js`)

Builds the video player HTML dynamically (via `getMarkup()`) and injects it into `#viewerVideoPanelMount`.

### Pose Overlay Loading

MoveNet dependencies are loaded lazily on first **Start tracking** click:
1. `TensorFlow.js` (one CDN bundle)
2. `@tensorflow-models/pose-detection`
3. `movenet.js` (local script)

A shared promise (`window.__MoveNetDetectorPromise`) ensures the detector is created exactly once, even if Start is clicked multiple times.

### Metadata Popover

An info button overlaid on the video opens a dark-glass popover showing session name, creation date, and notes. It supports both hover and click-to-pin behaviour.

---

## Time Sync (`time-sync.js`)

### Offset Calculation

```
offset = videoMarkerT - imuMarkerT

When video is at time V:
  corresponding IMU time = V - offset
```

### Follow Video Mode

When enabled, `session-viewer.js` runs a `requestAnimationFrame` loop that calls `imuPanel.setCursorX(videoTime - offset)` each frame. This is coordinated by `movesync:time-sync-mode-changed`.

### Bidirectional Slider Sync

`session-viewer.js` listens to delegated `input` events on the document. When `#viewerVcSeek` changes (video slider), it updates the IMU cursor. When `#viewerImuCursorRange` changes (IMU slider), it sets `video.currentTime`. A `syncing` flag prevents ping-pong feedback loops.

### T1 / T2 Timeframe

T1 and T2 store IMU-time values (seconds on the IMU x-axis). After both are set, **Apply Timeframe** fires `movesync:imu-timeframe-applied` which `imu-panel.js` uses to zoom the chart x-axis.

---

## Export / Import

### Project Export (Library)

`buildProjectExportPayload(project)` iterates sessions and:
- Encodes video files as base64 if under **30 MB**
- Encodes IMU CSV files as text if under **5 MB**
- Marks oversized files as `{ omitted: true }`

Single-project export produces a `.json` file (format `movesync-project-export-v2`).
Multi-project export uses **JSZip** to produce a `.zip` with one JSON per project plus a `manifest.json`.

### Project Import

Supports three formats:
- `movesync-project-export-v2` — full export with embedded files (restored to `File` objects)
- `movesync-project-export-v1` — metadata only, files missing
- `movesync-project-draft-v1` — structure only (from the Upload page draft export)

### Upload Draft Export

The Upload page can export the current project *structure* (session names, notes, filenames) as a lightweight JSON draft. This is useful for templating recurring project shapes without embedding large binary files.

---

## Intro Overlay (`intro.js`)

The splash screen renders a **flow-field particle animation** on a Canvas element:
- `N` particles (scaled to viewport area, capped at 140) follow a curl-noise vector field
- Pointer hover pulls nearby particles
- On "Start tracking": a `burstRamp` accelerates all particles downward while the overlay fades out and the app shell rises with a 3D CSS transform (`translateY` + `rotateX`)

After the first successful start, `localStorage.setItem("movesync-force-dashboard", "1")` ensures every subsequent page load goes directly to Dashboard, bypassing the intro.

---

## Event Reference

| Event | Fired by | Consumed by |
|-------|----------|-------------|
| `movesync:app-init` | `app-shell.js` | sidebar, theme, search modules |
| `movesync:page-loaded` | `app-shell.js` | search module (re-runs highlight) |
| `movesync:projects-changed` | `session-store.js` | dashboard, library, session viewer |
| `movesync:sessions-changed` | `session-store.js` | session viewer |
| `movesync:active-session-changed` | `session-store.js` | picker, video panel, IMU, fusion, timestamps, time-sync |
| `movesync:imu-data-ready` | `imu-panel.js` | `imu-processing.js` |
| `movesync:imu-processed` | `imu-processing.js` | key-metrics, expanded-metrics, fusion panel, session viewer HUD |
| `movesync:imu-cursor-changed` | `imu-panel.js` | fusion panel, session viewer live-speed HUD |
| `movesync:imu-selected` | `imu-panel.js` | fusion panel |
| `movesync:time-sync-changed` | `time-sync.js` | session viewer (offset cache), fusion panel |
| `movesync:time-sync-mode-changed` | `time-sync.js` | session viewer (follow-video loop) |
| `movesync:imu-timeframe-applied` | `time-sync.js` | `imu-panel.js` (zoom charts) |
| `movesync:imu-timeframe-reset` | `time-sync.js` | `imu-panel.js` |
| `movesync:imu-timeframe-marked` | `time-sync.js` | (future consumers) |
| `movesync:viewer-tab-changed` | `session-viewer.js` | IMU panel (align slider), fusion panel (ensure mounted) |
| `movesync:session-timestamps-changed` | `timestamps.js` | `timestamps.js` (re-render list) |
| `movesync:fusion-ready` | `sensor-fusion.js` | arm-angle-analysis (populate selectors) |

---

## Performance Notes

- **Chart.js `parsing: false` + `normalized: true`**: Data is pre-formatted as `{x, y}` pairs; Chart.js skips its own parsing step.
- **`animation: false`** and **`pointRadius: 0`**: Avoids per-frame animation overhead for large datasets.
- **Downsampling**: `expanded-metrics-panel.js` uses peak-preserving bucketing (max abs per bucket) to cap all graph signals at 600 points.
- **IMU processing is synchronous on the main thread**: For very long recordings (>30 min at 100 Hz = 180k samples), this can cause a brief UI freeze. A Web Worker migration would eliminate this.
- **Fusion throttle**: `FusionUI.renderThrottleMs = 50` (~20 FPS) prevents the 3D canvas from saturating the main thread during fast video playback.

---

## Development

### Local Server

```bash
python -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000`. No build step — edit any file and refresh.

### Cache Busting (Dev)

Set `DEV_CACHE_BUST = true` in `app-shell.js` and/or `session-viewer.js` to append `?v=<timestamp>` to all script and CSS loads, preventing stale cached files during development.

### Debugging Tips

```javascript
// Inspect active session
window.MoveSyncSessionStore.getActiveSession()

// Inspect processed IMU data
window.currentProcessedSession?.summary

// Check Madgwick fusion validity
window.currentProcessedSession?.fusion.valid

// Inspect all projects
window.MoveSyncSessionStore.getProjects()

// Current IMU cursor position
// (read from the closure inside imu-panel — not directly accessible)
// Use the movesync:imu-cursor-changed event listener instead:
document.addEventListener('movesync:imu-cursor-changed', e => console.log(e.detail))
```

### Adding a New Page

1. Create `app/navigation/my-page/my-page.{html,css,js}`
2. Add a sidebar link in `index.html` with `data-page="My Page"` and `data-src="...html"`
3. Register assets in `app.PAGE_ASSETS` in `app-shell.js`
4. Export `window.MoveSyncPages["My Page"] = { init(), destroy() }`

### Adding a New Metric

1. Add an entry to `REGISTRY` in `key-metrics-panel.js`
2. Add the computation in `extractMetrics()` in `key-metrics-panel.js`
3. Add an entry to `GROUPS` in `expanded-metrics-panel.js` (with `source` dot-path for graph support)

---

## Deployment

### GitHub Pages

1. Push the repo to GitHub
2. Go to **Settings → Pages → Source: Deploy from branch → `main` / root**
3. Your app will be live at `https://<username>.github.io/<repo>/`

No build process. All external libraries are loaded from CDNs:

| Library | CDN |
|---------|-----|
| Chart.js 4.4.1 | `cdn.jsdelivr.net` |
| JSZip 3.10.1 | `cdn.jsdelivr.net` |
| TensorFlow.js 4.22.0 | `cdn.jsdelivr.net` |
| @tensorflow-models/pose-detection 2.1.3 | `cdn.jsdelivr.net` |
| Boxicons 2.1.4 | `unpkg.com` |
| Poppins (font) | `fonts.googleapis.com` |

AHRS (Madgwick/Mahony) is bundled locally as `ahrs_min.js`.

---

**Last Updated:** April 2026
