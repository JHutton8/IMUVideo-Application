# MoveSync

**Motion captured. Patterns revealed.**

MoveSync is a browser-based sports motion analysis platform that combines IMU sensor data visualization, video playback, pose estimation, and sensor fusion into a single, privacy-first application. No installation, no server, no account required.

**Deployment Link:** https://jhutton8.github.io/IMUVideo-Application/

---

## Features

### Project & Session Management
- Organize recordings into **Projects**, each containing one or more **Sessions**
- Each session can hold a video file and multiple IMU CSV files simultaneously
- Import and export projects as ZIP archives (preserving all files and metadata)
- Persistent in-memory session store with full library management

### Video Panel
- Video playback with custom controls (play/pause, seek, speed, volume, loop, fullscreen)
- Configurable playback speed (0.25×, 0.5×, 1×, 1.5×, 2×)
- **MoveNet Thunder** pose overlay — real-time skeleton rendering on video
- Joint selection and angle measurement tools
- Video metadata popover with session info

### IMU Data Visualization
- Multi-sensor support — load and switch between multiple IMU CSVs per session
- Interactive **accelerometer**, **gyroscope**, and **magnetometer** charts (Chart.js)
- Per-axis toggle buttons with persistence via localStorage
- Draggable cursor slider with real-time axis readouts at cursor position
- Auto-detects time column; synthesises timestamps when none is present (configurable Hz)
- Switchable between **Plots** and **CSV preview** views

### IMU Processing Pipeline
After CSV data is loaded, a full processing pipeline runs automatically:
- **Madgwick sensor fusion** (6-DOF or 9-DOF with magnetometer) producing quaternions per sample
- **Gravity removal** via quaternion rotation to world frame, yielding linear acceleration
- **ZUPT** (Zero Velocity Update) integration for speed and distance estimates
- **Jerk** computation (central difference derivative of smoothed accel magnitude)
- **Cadence / rep detection** via adaptive peak detection
- **Session summary statistics**: peak/mean acceleration, peak speed, total distance, angular velocity, orientation range, active time, total impulse

### Sensor Fusion 3D Panel
- Live 3D disc visualisation of sensor orientation (WebGL-free, pure Canvas 2D)
- Quaternion, Euler angle, and rotation matrix readouts
- Updates in sync with video playback or IMU cursor position

### Expanded Metrics Analysis Panel
- Full breakdown of all computed metrics, grouped by category (Acceleration, Speed & Distance, Angular Velocity, Orientation, Rhythm, Session)
- Filter to **Key Metrics** defined by a sport preset, or view all
- Per-metric time-series graphs (inline Chart.js, downsampled with peak-preserving bucketing)
- Live search across all metric names

### Key Metrics Panel
- Compact tile display of metrics selected by the active sport preset
- Values update automatically when IMU data is processed

### Time Sync
- **Mark video** and **Mark IMU** reference points to compute a time offset
- **Follow video** mode: IMU cursor tracks video playback automatically
- **Manual** mode: independent cursor control
- **T1 / T2** range markers on all IMU charts with **Apply Timeframe** to zoom in
- Bidirectional slider sync: dragging either the video seek bar or IMU cursor moves the other (when an offset is set)

### Timestamps Panel
- Add, edit, and delete timestamped annotations on any session
- Labels auto-coloured by a deterministic hue hash
- Click any timestamp to seek video directly to that moment
- Notes field with `Ctrl+Enter` shortcut to save

### Sport Presets
- Create and manage sport configurations defining default sensor, overlay mode, key metrics, and timestamp types
- Metrics and timestamp types are reusable across sessions
- Import / export presets as JSON

### Library
- Browse all projects with search and sort (by date, name, sessions count)
- Multi-select for bulk ZIP export
- Expand any project card to see its sessions inline
- Import previously exported project JSON files (v1 and v2 formats, with file restoration)

### Compare Sessions
- Side-by-side metadata and computed statistics comparison of any two sessions
- Swap A/B, open either session directly in the viewer

### Tutorial System
- Interactive step-by-step tutorials for key features
- Auto-scroll runner with keyboard shortcuts (`Enter` / `Shift+Enter` / `Esc`)
- Configurable finish action per tutorial step

### Global Search
- Ctrl+F style in-page search across any loaded page
- Next / previous match navigation with live counter
- Highlights auto-clear when navigating away

---

## Basic Workflow

1. **Upload** — go to *Upload*, create a project, add one or more sessions (each with a video and/or IMU CSVs), then click **Save project**.
2. **Library** — find your project in the Library. Expand it to see sessions; click **View** to open one in the Session Viewer.
3. **Session Viewer** — select a project and session from the pickers at the top. Video and IMU data load automatically.
4. **Sync** — use the *Time Sync* card to align the video and IMU timelines if they were recorded separately.
5. **Analyse** — switch tabs to explore IMU graphs, sensor fusion 3D, or the expanded metrics panel.
6. **Annotate** — add timestamps with labels and notes as you scrub through the video.
7. **Export** — go to the Library and export your project as a ZIP to preserve all files and metadata.

---

## IMU CSV Format

MoveSync auto-detects column names (case-insensitive). The recognised column headers are:

| Column | Signal |
|--------|--------|
| `ax`, `ay`, `az` | Accelerometer (m/s²) |
| `gx`, `gy`, `gz` | Gyroscope (deg/s or rad/s — auto-detected) |
| `mx`, `my`, `mz` | Magnetometer (µT) — optional |
| `time`, `t`, `timestamp`, `timesec`, `sec`, `seconds` | Time column (any one of these) |

If no time column is found, MoveSync synthesises timestamps using a configurable sample rate (default 100 Hz, adjustable via the banner that appears in the IMU panel).

**Example (with time column):**
```csv
time,ax,ay,az,gx,gy,gz,mx,my,mz
0.000,0.12,9.81,0.05,1.2,-0.5,0.3,45.2,-12.3,38.7
0.010,0.15,9.82,0.04,1.1,-0.6,0.2,45.1,-12.4,38.8
```

**Example (no time column — timestamps synthesised):**
```csv
ax,ay,az,gx,gy,gz,mx,my,mz
0.12,9.81,0.05,1.2,-0.5,0.3,45.2,-12.3,38.7
0.15,9.82,0.04,1.1,-0.6,0.2,45.1,-12.4,38.8
```

---

## Troubleshooting

### Video won't load
- **Supported formats:** MP4 (H.264), WebM, MOV — exact support depends on your browser. Re-encoding to H.264 MP4 gives the widest compatibility.
- **Large files:** Videos over ~1 GB may cause slowdown. Compress or trim the video before uploading.

### CSV not loading / charts are empty
- **Check headers:** MoveSync looks for `ax, ay, az`, `gx, gy, gz`, and optionally `mx, my, mz`. Column names are case-insensitive.
- **No time column:** If your CSV has no time column, a yellow banner will appear in the IMU panel — set the correct sample rate and click **Apply**.
- **Encoding:** Save the CSV as UTF-8 without BOM, using commas as separators (not semicolons or tabs).

### IMU and video feel out of sync
- Use the **Time Sync** card in the Session Viewer: mark a recognisable event (e.g. a jump or impact) in both the video and the IMU cursor, then click **Compute offset**. Enable **Follow video** to lock the IMU cursor to playback.

### Sensor fusion 3D panel shows nothing
- The panel requires at least `ax/ay/az` and `gx/gy/gz` columns. Check the browser console for any processing errors.
- Adding `mx/my/mz` (magnetometer) enables 9-DOF fusion and improves heading accuracy.

### Project data disappeared after refreshing
- MoveSync stores everything in memory — data is lost on page reload by design (because `File` objects cannot be serialised to localStorage). Always **Export** your project as a ZIP before closing the tab.

### Pose overlay (MoveNet) is slow or doesn't start
- MoveNet Thunder loads from a CDN on first use — allow a few seconds for the model to download.
- Make sure the video is fully loaded before clicking **Start tracking**.
- Close other browser tabs to free GPU/CPU resources.

### App shows a blank page or "Failed to load" error
- The app must be served over HTTP, not opened directly as a `file://` URL. Use the deployed GitHub Pages link, or run a local server (`python -m http.server 8000`).

---

## Privacy

Everything runs locally in the browser. No data is sent to any server. There are no accounts, no analytics, and no telemetry. Projects are stored in memory only — use **Export** to persist them between sessions.


---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

The MIT License allows you to:
- Use the software for any purpose (commercial or non-commercial)
- Modify the software
- Distribute copies of the software
- Sublicense the software

The only requirement is that you include the original copyright notice and license in any copies or substantial portions of the software.

---

## Team

Developed by the IMUVideo team in the CM2018 PCC at KTH as part of an effort to create affordable, accessible motion analysis tools for sports and physiotherapy applications.

---

## Contact & Support

- **Documentation**: This README and inline code comments

For technical details about the architecture and implementation, see [TECHNICAL.md](TECHNICAL.md).

---

## Additional Resources

- [MoveNet Documentation](https://www.tensorflow.org/hub/tutorials/movenet)
- [TensorFlow.js Guide](https://www.tensorflow.org/js)
- [IMU Sensor Basics](https://www.sparkfun.com/pages/accel_gyro_guide)
- [Human Pose Estimation Overview](https://viso.ai/deep-learning/pose-estimation-ultimate-overview/)

---

**Version**: 8.0  
**Last Updated**: April 2026
