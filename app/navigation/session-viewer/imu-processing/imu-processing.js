// =======================================
// MoveSync — IMU Processing Pipeline
// File: app/navigation/session-viewer/imu-processing.js
//
// Responsibilities:
// - Detect sample rate from time column (median dt method)
// - Run Madgwick sensor fusion to produce quaternions per sample
// - Remove gravity using quaternion rotation to get linear acceleration
// - Apply a single clean low-pass filter (20 Hz) — no double-smoothing
// - Compute jerk (central difference derivative of accel magnitude)
// - Integrate linear acceleration with ZUPT to produce speed + distance
// - Compute session-level summary statistics
// - Expose fast cursor-time lookup for all derived signals
//
// Output: window.currentProcessedSession (ProcessedSession object)
// Public API: window.MoveSyncIMUProcessing
//
// Dependencies:
// - window.Madgwick (from ahrs_min.js, loaded by sensor-fusion.js)
//
// Event fired when processing completes:
// - movesync:imu-processed  { index, processed }
// =======================================

(() => {
  "use strict";

  // ============================================================
  // Tunable constants — adjust here for different devices/use cases
  // ============================================================
  const CFG = {
    // Madgwick filter gain. Lower = smoother but slower to converge.
    // 0.033 is good for slow/moderate motion; 0.1 for faster dynamic motion.
    MADGWICK_BETA: 0.033,

    // Low-pass cutoff for smoothed signals (Hz).
    // 20 Hz keeps all meaningful human motion, removes high-frequency noise.
    LP_CUTOFF_HZ: 20,

    // ZUPT detection: a sample window is "still" when ALL of these hold
    // for at least ZUPT_MIN_SAMPLES consecutive samples.
    ZUPT_GYRO_THRESHOLD_DEGS: 15,    // deg/s — gyro magnitude below this
    ZUPT_ACCEL_MIN_G: 0.70,           // g — accel magnitude lower bound (near 1g = gravity only)
    ZUPT_ACCEL_MAX_G: 1.35,           // g — accel magnitude upper bound
    ZUPT_MIN_SAMPLES: 5,              // consecutive samples required to confirm stillness

    // Gravity constant (m/s²)
    GRAVITY_MS2: 9.80665,

    // Fallback sample rate if detection fails
    FALLBACK_SAMPLE_RATE_HZ: 100,

    // Madgwick warm-up: run this many samples before trusting the quaternion.
    // Gives the filter time to converge from identity before we use orientation.
    FUSION_WARMUP_SAMPLES: 50,
  };

  // ============================================================
  // Utility: binary search for nearest index
  // ============================================================
  function nearestIndex(times, x) {
    const n = times.length;
    if (!n) return -1;
    if (x <= times[0]) return 0;
    if (x >= times[n - 1]) return n - 1;

    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = times[mid];
      if (v === x) return mid;
      if (v < x) lo = mid + 1;
      else hi = mid - 1;
    }
    const a = hi, b = lo;
    if (a < 0) return b;
    if (b >= n) return a;
    return Math.abs(times[b] - x) < Math.abs(times[a] - x) ? b : a;
  }

  // ============================================================
  // Step 1: Sample rate detection (median inter-sample interval)
  // ============================================================
  function detectSampleRate(tArray) {
    if (!tArray || tArray.length < 3) return CFG.FALLBACK_SAMPLE_RATE_HZ;

    const diffs = [];
    for (let i = 1; i < tArray.length; i++) {
      const dt = tArray[i] - tArray[i - 1];
      if (dt > 0 && dt < 2.0) diffs.push(dt); // ignore gaps > 2s (recording pauses)
    }

    if (!diffs.length) return CFG.FALLBACK_SAMPLE_RATE_HZ;

    diffs.sort((a, b) => a - b);
    const median = diffs[Math.floor(diffs.length / 2)];

    const hz = Math.round(1 / median);
    // Sanity check: clamp to plausible IMU range
    return Math.max(10, Math.min(1000, hz));
  }

  // ============================================================
  // Step 2: First-order IIR low-pass filter
  // Applied once, with correct sample rate and meaningful cutoff.
  // ============================================================
  function lowPass(data, sampleRateHz, cutoffHz) {
    const n = data.length;
    if (!n) return new Float32Array(0);

    const RC = 1 / (cutoffHz * 2 * Math.PI);
    const dt = 1 / sampleRateHz;
    const alpha = dt / (RC + dt);

    const out = new Float32Array(n);
    out[0] = data[0];
    for (let i = 1; i < n; i++) {
      out[i] = alpha * data[i] + (1 - alpha) * out[i - 1];
    }
    return out;
  }

  // ============================================================
  // Step 3: Madgwick fusion
  // Returns quaternion [w,x,y,z] per sample.
  // Uses window.Madgwick from ahrs_min.js.
  // ============================================================
  function runMadgwick(raw, sampleRateHz) {
    const n = raw.acc.x.length;
    const hasMag = raw.mag.x && raw.mag.x.length === n &&
      raw.mag.x.some(v => v !== 0);

    if (typeof window.Madgwick === "undefined") {
      console.warn("[IMUProcessing] Madgwick not loaded yet — fusion skipped.");
      return { quaternions: null, valid: false, hasMag };
    }

    const filter = new window.Madgwick({
      sampleInterval: 1000 / sampleRateHz,
      beta: CFG.MADGWICK_BETA,
    });

    // Detect gyro units using 75th-percentile magnitude across the recording.
    // A single-sample threshold fails when the sensor is nearly still at t=0
    // (e.g. Movesense at rest sums to ~9.2 deg/s, which falls below a threshold
    // of 10 and gets misclassified as rad/s, causing catastrophic drift).
    // deg/s at rest: 1–10; in motion: 50–500+. rad/s at rest: 0.01–0.1.
    // Any p75 > 0.5 is unambiguously deg/s.
    const DEG2RAD = Math.PI / 180;
    const _gyroN = raw.gyro.x.length;
    const _gyroStep = Math.max(1, Math.floor(_gyroN / 500));
    const _gyroMags = [];
    for (let k = 0; k < _gyroN; k += _gyroStep) {
      const gx = raw.gyro.x[k], gy = raw.gyro.y[k], gz = raw.gyro.z[k];
      _gyroMags.push(Math.sqrt(gx*gx + gy*gy + gz*gz));
    }
    _gyroMags.sort((a, b) => a - b);
    const _gyroP75 = _gyroMags[Math.floor(_gyroMags.length * 0.75)];
    const gyroIsDegrees = _gyroP75 > 0.5;

    // Hard-iron calibration: subtract per-axis median from magnetometer.
    // The Movesense mag bias is 85–161 µT vs Earth's ~50 µT signal — without
    // this, Madgwick fights a static offset the entire recording and drifts
    // continuously even when the device is completely stationary.
    let magBiasX = 0, magBiasY = 0, magBiasZ = 0;
    if (hasMag) {
      const _step = Math.max(1, Math.floor(n / 1000));
      const _mx = [], _my = [], _mz = [];
      for (let k = 0; k < n; k += _step) {
        _mx.push(raw.mag.x[k]);
        _my.push(raw.mag.y[k]);
        _mz.push(raw.mag.z[k]);
      }
      const _med = (arr) => {
        const s = arr.slice().sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };
      magBiasX = _med(_mx);
      magBiasY = _med(_my);
      magBiasZ = _med(_mz);
    }

    const quaternions = new Array(n);

    for (let i = 0; i < n; i++) {
      const ax = raw.acc.x[i], ay = raw.acc.y[i], az = raw.acc.z[i];

      let gx = raw.gyro.x[i], gy = raw.gyro.y[i], gz = raw.gyro.z[i];
      if (gyroIsDegrees) {
        gx *= DEG2RAD; gy *= DEG2RAD; gz *= DEG2RAD;
      }

      if (hasMag) {
        const mx = raw.mag.x[i] - magBiasX;
        const my = raw.mag.y[i] - magBiasY;
        const mz = raw.mag.z[i] - magBiasZ;
        filter.update(gx, gy, gz, ax, ay, az, mx, my, mz);
      } else {
        // 6-DOF mode: pass zero magnetometer
        filter.update(gx, gy, gz, ax, ay, az, 0, 0, 0);
      }

      quaternions[i] = filter.getQuaternion(); // [w, x, y, z]
    }

    return { quaternions, valid: true, hasMag };
  }

  // ============================================================
  // Step 4: Gravity removal + world-frame linear acceleration
  //
  // For each sample:
  //   1. The gravity vector in world frame is [0, 0, 1] (in g units)
  //   2. Rotate it into body frame using conjugate of quaternion
  //   3. Subtract from raw accelerometer reading → linear accel in body frame
  //   4. Rotate result back to world frame for integration
  //
  // Returns linear accel in m/s² in world frame.
  // ============================================================
  function removeGravity(raw, quaternions, n) {
    const G = CFG.GRAVITY_MS2;

    const lx = new Float32Array(n);
    const ly = new Float32Array(n);
    const lz = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const q = quaternions[i];
      const qw = q[0], qx = q[1], qy = q[2], qz = q[3];

      // Gravity vector in body frame (rotate world [0,0,1] by conjugate quaternion)
      // This is the direction gravity appears to point from the sensor's perspective
      const gxB = 2 * (qx * qz - qw * qy);
      const gyB = 2 * (qw * qx + qy * qz);
      const gzB = qw * qw - qx * qx - qy * qy + qz * qz;

      // Raw accel in g — subtract gravity component
      const ax = raw.acc.x[i] - gxB;
      const ay = raw.acc.y[i] - gyB;
      const az = raw.acc.z[i] - gzB;

      // Rotate linear accel into world frame
      // Rotate vector v by quaternion q: v' = q * v * q*
      const ix = qw * ax + qy * az - qz * ay;
      const iy = qw * ay + qz * ax - qx * az;
      const iz = qw * az + qx * ay - qy * ax;
      const iw = -qx * ax - qy * ay - qz * az;

      lx[i] = (ix * qw + iw * (-qx) + iy * (-qz) - iz * (-qy)) * G;
      ly[i] = (iy * qw + iw * (-qy) + iz * (-qx) - ix * (-qz)) * G;
      lz[i] = (iz * qw + iw * (-qz) + ix * (-qy) - iy * (-qx)) * G;
    }

    return { x: lx, y: ly, z: lz };
  }

  // ============================================================
  // Step 5: ZUPT detection + velocity/displacement integration
  //
  // Strategy:
  // - Scan for windows where the sensor is stationary (low gyro + accel ≈ 1g)
  // - At each ZUPT: reset velocity to zero
  // - Between ZUPTs: trapezoidal integration of linear acceleration
  //
  // Returns velocity (m/s) and displacement (m) arrays in world frame,
  // plus scalar speed and total distance.
  // ============================================================
  function integrateWithZUPT(linear, raw, tArray, sampleRateHz) {
    const n = tArray.length;
    const DEG2RAD = Math.PI / 180;

    // --- Stillness detection ---
    // Gyro magnitude in deg/s (keep in degrees for threshold comparison)
    const gyroMag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const gx = raw.gyro.x[i], gy = raw.gyro.y[i], gz = raw.gyro.z[i];
      gyroMag[i] = Math.sqrt(gx * gx + gy * gy + gz * gz);
    }

    // Accel magnitude in g
    const accMag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ax = raw.acc.x[i], ay = raw.acc.y[i], az = raw.acc.z[i];
      accMag[i] = Math.sqrt(ax * ax + ay * ay + az * az);
    }

    // Build stillness boolean array
    const still = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      still[i] = (
        gyroMag[i] < CFG.ZUPT_GYRO_THRESHOLD_DEGS &&
        accMag[i] >= CFG.ZUPT_ACCEL_MIN_G &&
        accMag[i] <= CFG.ZUPT_ACCEL_MAX_G
      ) ? 1 : 0;
    }

    // Confirm stillness: require ZUPT_MIN_SAMPLES consecutive still samples
    const confirmed = new Uint8Array(n);
    let run = 0;
    for (let i = 0; i < n; i++) {
      if (still[i]) {
        run++;
        if (run >= CFG.ZUPT_MIN_SAMPLES) {
          // Mark the whole run
          for (let j = i - run + 1; j <= i; j++) confirmed[j] = 1;
        }
      } else {
        run = 0;
      }
    }

    // Collect ZUPT events (start index of each confirmed still region)
    const zuptEvents = [];
    let inZupt = false;
    for (let i = 0; i < n; i++) {
      if (confirmed[i] && !inZupt) {
        zuptEvents.push({ index: i, t: tArray[i] });
        inZupt = true;
      } else if (!confirmed[i]) {
        inZupt = false;
      }
    }

    // --- Integration ---
    const vx = new Float32Array(n);
    const vy = new Float32Array(n);
    const vz = new Float32Array(n);
    const dx = new Float32Array(n);
    const dy = new Float32Array(n);
    const dz = new Float32Array(n);

    // Start with zero velocity
    vx[0] = 0; vy[0] = 0; vz[0] = 0;
    dx[0] = 0; dy[0] = 0; dz[0] = 0;

    for (let i = 1; i < n; i++) {
      const dt = tArray[i] - tArray[i - 1];
      if (dt <= 0 || dt > 0.5) {
        // Skip bad intervals (gaps in data)
        vx[i] = vx[i-1]; vy[i] = vy[i-1]; vz[i] = vz[i-1];
        dx[i] = dx[i-1]; dy[i] = dy[i-1]; dz[i] = dz[i-1];
        continue;
      }

      // ZUPT: reset velocity if confirmed still
      if (confirmed[i]) {
        vx[i] = 0; vy[i] = 0; vz[i] = 0;
      } else {
        // Trapezoidal integration: v[i] = v[i-1] + 0.5*(a[i-1]+a[i])*dt
        vx[i] = vx[i-1] + 0.5 * (linear.x[i-1] + linear.x[i]) * dt;
        vy[i] = vy[i-1] + 0.5 * (linear.y[i-1] + linear.y[i]) * dt;
        vz[i] = vz[i-1] + 0.5 * (linear.z[i-1] + linear.z[i]) * dt;
      }

      // Integrate velocity → displacement (trapezoidal)
      dx[i] = dx[i-1] + 0.5 * (vx[i-1] + vx[i]) * dt;
      dy[i] = dy[i-1] + 0.5 * (vy[i-1] + vy[i]) * dt;
      dz[i] = dz[i-1] + 0.5 * (vz[i-1] + vz[i]) * dt;
    }

    // Scalar speed
    const speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      speed[i] = Math.sqrt(vx[i]*vx[i] + vy[i]*vy[i] + vz[i]*vz[i]);
    }

    // Cumulative path length (total distance travelled, not displacement)
    const totalDistance = new Float32Array(n);
    totalDistance[0] = 0;
    for (let i = 1; i < n; i++) {
      const ddx = dx[i] - dx[i-1];
      const ddy = dy[i] - dy[i-1];
      const ddz = dz[i] - dz[i-1];
      totalDistance[i] = totalDistance[i-1] + Math.sqrt(ddx*ddx + ddy*ddy + ddz*ddz);
    }

    // ── Burst-corrected speed / distance ──────────────────────────────
    // Compute peak speed and distance INDEPENDENTLY for each movement burst
    // (the non-still runs between consecutive ZUPT windows).
    // Because velocity is reset to zero at every ZUPT, each burst's
    // integration starts fresh — drift cannot accumulate across the session.
    const burstPeakSpeeds = [];
    const burstDistances  = [];

    let bStart = -1;
    for (let i = 0; i < n; i++) {
      const enteringBurst = !confirmed[i] && (i === 0 || confirmed[i - 1]);
      const leavingBurst  =  confirmed[i] && i > 0 && !confirmed[i - 1];

      if (enteringBurst) bStart = i;

      if (bStart >= 0 && (leavingBurst || i === n - 1)) {
        const bEnd = leavingBurst ? i - 1 : i;
        let bPeak = 0, bDist = 0;
        for (let j = bStart; j <= bEnd; j++) {
          const spd = speed[j];
          if (spd > bPeak) bPeak = spd;
          if (j > bStart) {
            const ddx = dx[j] - dx[j-1];
            const ddy = dy[j] - dy[j-1];
            const ddz = dz[j] - dz[j-1];
            bDist += Math.sqrt(ddx*ddx + ddy*ddy + ddz*ddz);
          }
        }
        if (bEnd > bStart) {          // ignore single-sample bursts
          burstPeakSpeeds.push(bPeak);
          burstDistances.push(bDist);
        }
        bStart = -1;
      }
    }

    const burstPeakSpeed = burstPeakSpeeds.length ? Math.max(...burstPeakSpeeds) : 0;
    const burstMeanSpeed = burstPeakSpeeds.length
      ? burstPeakSpeeds.reduce((a, b) => a + b, 0) / burstPeakSpeeds.length : 0;
    const burstTotalDist = burstDistances.reduce((a, b) => a + b, 0);

    return {
      velocityX: vx, velocityY: vy, velocityZ: vz,
      displacementX: dx, displacementY: dy, displacementZ: dz,
      speed,
      totalDistance,
      burstPeakSpeed,
      burstMeanSpeed,
      burstTotalDist,
      burstPeakSpeeds,
      burstDistances,
      zuptEvents,
      stillnessMask: confirmed,
    };
  }

  // ============================================================
  // Step 6: Jerk (central difference derivative of accel magnitude)
  // ============================================================
  function computeJerk(accelMag, tArray) {
    const n = accelMag.length;
    const jerk = new Float32Array(n);

    for (let i = 1; i < n - 1; i++) {
      const dt = tArray[i + 1] - tArray[i - 1];
      if (dt > 0) {
        jerk[i] = (accelMag[i + 1] - accelMag[i - 1]) / dt;
      }
    }
    // Edges: forward/backward difference
    if (n > 1) {
      const dt0 = tArray[1] - tArray[0];
      jerk[0] = dt0 > 0 ? (accelMag[1] - accelMag[0]) / dt0 : 0;
      const dtN = tArray[n-1] - tArray[n-2];
      jerk[n-1] = dtN > 0 ? (accelMag[n-1] - accelMag[n-2]) / dtN : 0;
    }

    return jerk;
  }

  // ============================================================
  // Step 7: Euler angles from quaternions
  // ============================================================
  function computeEuler(quaternions) {
    const n = quaternions.length;
    const roll  = new Float32Array(n);
    const pitch = new Float32Array(n);
    const yaw   = new Float32Array(n);
    const RAD2DEG = 180 / Math.PI;

    for (let i = 0; i < n; i++) {
      const [qw, qx, qy, qz] = quaternions[i];

      const sinr = 2 * (qw * qx + qy * qz);
      const cosr = 1 - 2 * (qx * qx + qy * qy);
      roll[i] = Math.atan2(sinr, cosr) * RAD2DEG;

      const sinp = 2 * (qw * qy - qz * qx);
      pitch[i] = (Math.abs(sinp) >= 1
        ? Math.sign(sinp) * 90
        : Math.asin(sinp) * RAD2DEG);

      const siny = 2 * (qw * qz + qx * qy);
      const cosy = 1 - 2 * (qy * qy + qz * qz);
      yaw[i] = Math.atan2(siny, cosy) * RAD2DEG;
    }

    return { roll, pitch, yaw };
  }

  // ============================================================
  // Step 8: Session summary statistics
  // ============================================================
  function computeSummary(derived, motion, euler) {
    function maxAbs(arr) {
      let m = 0;
      for (let i = 0; i < arr.length; i++) {
        const v = Math.abs(arr[i]);
        if (v > m) m = v;
      }
      return m;
    }

    function max(arr) {
      let m = -Infinity;
      for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
      return m;
    }

    function mean(arr) {
      let s = 0;
      for (let i = 0; i < arr.length; i++) s += arr[i];
      return s / arr.length;
    }

    // Range of motion: max - min for each euler angle (degrees)
    function range(arr) {
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] < mn) mn = arr[i];
        if (arr[i] > mx) mx = arr[i];
      }
      return mx - mn;
    }

    // Total rotation: integral of gyro magnitude over session
    // (this is already in derived.gyroMagnitude which is in deg/s)
    // We sum |gyro| * dt, but we don't have dt here directly —
    // approximate as gyroMagnitude sum / sampleRate
    // (caller passes sampleRate separately if needed; skip for summary)

    return {
      peakAccel:       max(derived.accelMagnitude),           // g
      peakLinearAccel: max(derived.linearMagnitude),          // m/s²
      peakGyro:        max(derived.gyroMagnitude),            // deg/s
      peakJerk:        maxAbs(derived.jerk),                  // g/s
      // Speed and distance are burst-corrected (per-ZUPT-window integration).
      // Each burst starts from zero velocity so drift cannot compound.
      peakSpeed:       motion.burstPeakSpeed,                  // m/s
      meanBurstSpeed:  motion.burstMeanSpeed,                   // m/s average burst peak
      totalDistance:   motion.burstTotalDist,                   // m
      meanAccel:       mean(derived.accelMagnitude),          // g
      rollRange:       euler ? range(euler.roll)  : null,     // degrees
      pitchRange:      euler ? range(euler.pitch) : null,
      yawRange:        euler ? range(euler.yaw)   : null,
      zuptCount:       motion.zuptEvents.length,
    };
  }

  // ============================================================
  // Main entry point: processSession
  //
  // @param cache  — imuReadoutCache from imu-panel.js
  //                 { t:[], acc:{x,y,z}, gyro:{x,y,z}, mag:{x,y,z} }

  //                              (avoids running Madgwick twice)
  // @returns ProcessedSession object
  // ============================================================
  function processSession(cache) {
    const t = cache.t;
    const n = t.length;

    if (!n || n < 10) {
      console.warn("[IMUProcessing] Not enough samples to process.");
      return null;
    }

    const sampleRate = detectSampleRate(t);

    // --- Build raw typed arrays from cache (which uses plain JS arrays) ---
    const raw = {
      acc: {
        x: Float32Array.from(cache.acc.x.map(v => v ?? 0)),
        y: Float32Array.from(cache.acc.y.map(v => v ?? 0)),
        z: Float32Array.from(cache.acc.z.map(v => v ?? 0)),
      },
      gyro: {
        x: Float32Array.from(cache.gyro.x.map(v => v ?? 0)),
        y: Float32Array.from(cache.gyro.y.map(v => v ?? 0)),
        z: Float32Array.from(cache.gyro.z.map(v => v ?? 0)),
      },
      mag: {
        x: Float32Array.from((cache.mag?.x || []).map(v => v ?? 0)),
        y: Float32Array.from((cache.mag?.y || []).map(v => v ?? 0)),
        z: Float32Array.from((cache.mag?.z || []).map(v => v ?? 0)),
      },
    };

    const tArr = Float64Array.from(t);

    // --- Accelerometer unit detection ---
    // Compute median accel magnitude over a sample of points.
    // At rest: G units → ~1.0,  m/s² units → ~9.81.
    // Threshold of 3.0 cleanly separates the two.
    // If m/s², normalise all axes to G so every downstream step
    // (gravity removal, ZUPT detection, display) works in consistent units.
    {
      const _step = Math.max(1, Math.floor(n / 500));
      const _mags = [];
      for (let k = 0; k < n; k += _step) {
        const ax = raw.acc.x[k], ay = raw.acc.y[k], az = raw.acc.z[k];
        _mags.push(Math.sqrt(ax*ax + ay*ay + az*az));
      }
      _mags.sort((a, b) => a - b);
      const _medMag = _mags[Math.floor(_mags.length / 2)];
      if (_medMag > 3.0) {
        // Data is in m/s² — convert to G
        const INV_G = 1 / CFG.GRAVITY_MS2;
        for (let k = 0; k < n; k++) {
          raw.acc.x[k] *= INV_G;
          raw.acc.y[k] *= INV_G;
          raw.acc.z[k] *= INV_G;
        }
        console.info("[IMUProcessing] Accel detected as m/s² (median mag " + _medMag.toFixed(2) + ") — normalised to G.");
      } else {
        console.info("[IMUProcessing] Accel detected as G (median mag " + _medMag.toFixed(2) + ").");
      }
    }

    // --- Madgwick fusion --- runs exactly once per session load
    const fusionResult = runMadgwick(raw, sampleRate);

    const { quaternions, valid: fusionValid, hasMag } = fusionResult;

    // --- Euler angles ---
    const euler = fusionValid ? computeEuler(quaternions) : null;

    // --- Raw accel magnitude (in g, no gravity removal) ---
    const accelMagnitude = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ax = raw.acc.x[i], ay = raw.acc.y[i], az = raw.acc.z[i];
      accelMagnitude[i] = Math.sqrt(ax*ax + ay*ay + az*az);
    }

    // --- Gyro magnitude (deg/s) ---
    const gyroMagnitude = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const gx = raw.gyro.x[i], gy = raw.gyro.y[i], gz = raw.gyro.z[i];
      gyroMagnitude[i] = Math.sqrt(gx*gx + gy*gy + gz*gz);
    }

    // --- Linear acceleration (gravity removed, world frame, m/s²) ---
    let linear, linearMagnitude, linearMagnitudeSmooth;
    if (fusionValid) {
      linear = removeGravity(raw, quaternions, n);

      linearMagnitude = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const lx = linear.x[i], ly = linear.y[i], lz = linear.z[i];
        linearMagnitude[i] = Math.sqrt(lx*lx + ly*ly + lz*lz);
      }

      linearMagnitudeSmooth = lowPass(linearMagnitude, sampleRate, CFG.LP_CUTOFF_HZ);
    } else {
      // Fallback: use raw accel magnitude * G as rough approximation
      linear = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n) };
      linearMagnitude = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        linearMagnitude[i] = accelMagnitude[i] * CFG.GRAVITY_MS2;
      }
      linearMagnitudeSmooth = lowPass(linearMagnitude, sampleRate, CFG.LP_CUTOFF_HZ);
    }

    // --- Smoothed signals (single low-pass pass) ---
    const accelMagnitudeSmooth = lowPass(accelMagnitude, sampleRate, CFG.LP_CUTOFF_HZ);
    const gyroMagnitudeSmooth  = lowPass(gyroMagnitude,  sampleRate, CFG.LP_CUTOFF_HZ);

    // --- Jerk (on smoothed accel magnitude, in g/s) ---
    const jerk = computeJerk(accelMagnitudeSmooth, tArr);

    // --- ZUPT + integration ---
    const motion = integrateWithZUPT(linear, raw, tArr, sampleRate);

    // --- Derived object ---
    const derived = {
      accelMagnitude,
      accelMagnitudeSmooth,
      gyroMagnitude,
      gyroMagnitudeSmooth,
      linearMagnitude,
      linearMagnitudeSmooth,
      jerk,
    };

    // --- Summary ---
    const summary = computeSummary(derived, motion, euler);
    summary.sampleRate = sampleRate;
    summary.duration = tArr[n - 1] - tArr[0];
    summary.frameCount = n;
    summary.fusionValid = fusionValid;
    summary.hasMag = hasMag;

    const processed = {
      // Meta
      sampleRate,
      duration: summary.duration,
      frameCount: n,
      t: tArr,

      // Raw typed arrays
      raw,

      // Sensor fusion
      fusion: {
        quaternions,
        euler,
        valid: fusionValid,
        hasMag,
      },

      // Gravity-removed linear acceleration (world frame, m/s²)
      linear,

      // Derived scalar arrays
      derived,

      // Velocity, speed, displacement
      motion,

      // Session-level summary
      summary,
    };

    return processed;
  }

  // ============================================================
  // Fast cursor lookup
  // Returns all metric values at a given IMU time t (seconds).
  // This is called on every cursor/video frame update — must be fast.
  // ============================================================
  function getValuesAtTime(processed, t) {
    if (!processed) return null;

    const i = nearestIndex(processed.t, t);
    if (i < 0) return null;

    const d = processed.derived;
    const m = processed.motion;
    const e = processed.fusion.euler;
    const r = processed.raw;

    return {
      // Time
      t: processed.t[i],
      index: i,

      // Raw sensor values
      accelX: r.acc.x[i], accelY: r.acc.y[i], accelZ: r.acc.z[i],
      gyroX:  r.gyro.x[i], gyroY: r.gyro.y[i], gyroZ: r.gyro.z[i],

      // Magnitude (g)
      accelMagnitude:       d.accelMagnitude[i],
      accelMagnitudeSmooth: d.accelMagnitudeSmooth[i],

      // Angular velocity (deg/s)
      gyroMagnitude:        d.gyroMagnitude[i],
      gyroMagnitudeSmooth:  d.gyroMagnitudeSmooth[i],

      // Linear acceleration (m/s², gravity removed)
      linearAccelX: processed.linear.x[i],
      linearAccelY: processed.linear.y[i],
      linearAccelZ: processed.linear.z[i],
      linearMagnitude:       d.linearMagnitude[i],
      linearMagnitudeSmooth: d.linearMagnitudeSmooth[i],

      // Jerk (g/s)
      jerk: d.jerk[i],

      // Orientation (degrees) — null if fusion not valid
      roll:  e ? e.roll[i]  : null,
      pitch: e ? e.pitch[i] : null,
      yaw:   e ? e.yaw[i]   : null,

      // Motion (m/s, m)
      speed:           m.speed[i],
      velocityX:       m.velocityX[i],
      velocityY:       m.velocityY[i],
      velocityZ:       m.velocityZ[i],
      displacementX:   m.displacementX[i],
      displacementY:   m.displacementY[i],
      displacementZ:   m.displacementZ[i],
      totalDistance:   m.totalDistance[i],

      // Stillness
      isStill: processed.motion.stillnessMask[i] === 1,
    };
  }

  // ============================================================
  // Compute metrics over a time window [tStart, tEnd]
  // Used for timestamp-range metric display in the analysis panel.
  // ============================================================
  function getWindowMetrics(processed, tStart, tEnd) {
    if (!processed) return null;

    const iStart = nearestIndex(processed.t, tStart);
    const iEnd   = nearestIndex(processed.t, tEnd);
    if (iStart < 0 || iEnd <= iStart) return null;

    const d = processed.derived;
    const m = processed.motion;
    const e = processed.fusion.euler;

    function sliceMax(arr, a, b) {
      let mx = -Infinity;
      for (let i = a; i <= b; i++) if (arr[i] > mx) mx = arr[i];
      return mx;
    }

    function sliceMin(arr, a, b) {
      let mn = Infinity;
      for (let i = a; i <= b; i++) if (arr[i] < mn) mn = arr[i];
      return mn;
    }

    function sliceMean(arr, a, b) {
      let s = 0;
      for (let i = a; i <= b; i++) s += arr[i];
      return s / (b - a + 1);
    }

    function sliceRange(arr, a, b) {
      return sliceMax(arr, a, b) - sliceMin(arr, a, b);
    }

    const duration = processed.t[iEnd] - processed.t[iStart];

    return {
      duration,                          // s
      peakAccel:       sliceMax(d.accelMagnitude, iStart, iEnd),       // g
      peakLinearAccel: sliceMax(d.linearMagnitude, iStart, iEnd),      // m/s²
      peakGyro:        sliceMax(d.gyroMagnitude, iStart, iEnd),        // deg/s
      peakJerk:        sliceMax(d.jerk.map(Math.abs), iStart, iEnd),   // g/s
      peakSpeed:       sliceMax(m.speed, iStart, iEnd),                // m/s
      meanAccel:       sliceMean(d.accelMagnitude, iStart, iEnd),      // g
      meanSpeed:       sliceMean(m.speed, iStart, iEnd),               // m/s
      // Distance within this window using burst-local integration
      distanceTravelled: (() => {
        const still = m.stillnessMask;
        let dist = 0;
        for (let i = iStart + 1; i <= iEnd; i++) {
          if (!still[i] && !still[i-1]) {
            const ddx = m.displacementX[i] - m.displacementX[i-1];
            const ddy = m.displacementY[i] - m.displacementY[i-1];
            const ddz = m.displacementZ[i] - m.displacementZ[i-1];
            dist += Math.sqrt(ddx*ddx + ddy*ddy + ddz*ddz);
          }
        }
        return dist;
      })(), // m
      rollRange:   e ? sliceRange(e.roll,  iStart, iEnd) : null,       // degrees
      pitchRange:  e ? sliceRange(e.pitch, iStart, iEnd) : null,
      yawRange:    e ? sliceRange(e.yaw,   iStart, iEnd) : null,
    };
  }

  // ============================================================
  // Trigger processing after imu-data-ready fires.
  // Hooks into the existing event system — no changes to imu-panel.js needed.
  // ============================================================
  document.addEventListener("movesync:imu-data-ready", (e) => {
    const index = e?.detail?.index ?? 0;

    // imuReadoutCache is a module-level var inside imu-panel.js's IIFE.
    // imu-panel.js exposes it via the global it sets on window after processing.
    // We need to read it from the global the panel sets.
    // imu-panel.js doesn't currently expose imuReadoutCache directly —
    // we rely on it being set before this event fires (it always is).
    // Access via the internal global that imu-panel sets:
    const cache = window.__currentImuReadoutCache;
    if (!cache || !cache.t || !cache.t.length) {
      console.warn("[IMUProcessing] imu-data-ready fired but no cache found.");
      return;
    }

    // sensor-fusion.js no longer runs its own Madgwick — it reads from
    // window.currentProcessedSession after this fires. Fusion runs once here.
    let processed = null;
    try {
      processed = processSession(cache);
    } catch (err) {
      console.error("[IMUProcessing] processSession failed:", err);
      return;
    }

    if (!processed) return;

    // Store globally for access by metrics panel, HUD, analysis panel
    window.currentProcessedSession = processed;
    window.currentProcessedImuIndex = index;

    document.dispatchEvent(new CustomEvent("movesync:imu-processed", {
      detail: { index, processed }
    }));

    console.info(
      `[IMUProcessing] Done. ${processed.frameCount} samples @ ${processed.sampleRate} Hz. ` +
      `Fusion: ${processed.fusion.valid ? (processed.fusion.hasMag ? "9-DOF" : "6-DOF") : "FAILED"}. ` +
      `ZUPTs: ${processed.motion.zuptEvents.length}. ` +
      `Peak speed: ${processed.summary.peakSpeed.toFixed(2)} m/s. ` +
      `Peak accel: ${processed.summary.peakAccel.toFixed(2)} g.`
    );
  });

  // ============================================================
  // Public API
  // ============================================================
  window.MoveSyncIMUProcessing = {
    processSession,
    getValuesAtTime,
    getWindowMetrics,
    detectSampleRate,
    CFG, // expose config so other modules can read tuning params
  };

})();