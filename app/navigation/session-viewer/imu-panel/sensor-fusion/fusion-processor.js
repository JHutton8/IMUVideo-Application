// =======================================
// Sensor Fusion Processor - IMPROVED VERSION
// File: fusion-processor.js
//
// Handles 9-DOF sensor fusion using Madgwick/Mahony algorithms
// IMPROVEMENTS:
// - Accelerometer drift correction using high-pass filter
// - Optimised rendering with animation frame throttling
// - Support for multiple IMUs with separate 3D displays
// =======================================

(function() {
  'use strict';
  
  // =============================================
  // Core Fusion Processor Class
  // =============================================
  
  class FusionProcessor {
    constructor() {
      this.algorithms = {
        madgwick: null,
        mahony: null,
        complementary: null
      };
    }
    
    /**
     * Process IMU data and compute orientation time series
     */
    process(options) {
      const {
        rows,
        headers,
        timeSeconds,
        sampleRate = 100,
        algorithm = 'madgwick',
        beta = 0.1
      } = options;
      
      if (!rows.length) {
        throw new Error('No IMU data to process');
      }
      
      // Validate 9-DOF data availability
      const hasAcc = this.hasAxisData(headers, 'acc');
      const hasGyro = this.hasAxisData(headers, 'gyro');
      const hasMag = this.hasAxisData(headers, 'mag');
      
      if (!hasAcc || !hasGyro || !hasMag) {
        throw new Error('9-DOF data required (acc + gyro + mag)');
      }
      
      // Extract sensor columns
      const accData = this.extractAxisData(rows, headers, 'acc');
      const gyroData = this.extractAxisData(rows, headers, 'gyro');
      const magData = this.extractAxisData(rows, headers, 'mag');
      
      // NEW: Apply high-pass filter to remove gravity/DC component from accelerometer
      const filteredAccData = this.removeGravityBias(accData, sampleRate);
      
      // Detect if gyro is in deg/s or rad/s
      const gyroSample = Math.abs(gyroData.x[0]) + Math.abs(gyroData.y[0]) + Math.abs(gyroData.z[0]);
      const gyroIsDegrees = gyroSample > 10;
      
      // Calibrate magnetometer (remove hard iron bias)
      const magCal = this.calibrateMagnetometer(magData);
      
      // Calibrate accelerometer (normalise to 1g) - use filtered data
      const accCal = this.calibrateAccelerometer(filteredAccData);
      
      // Initialise fusion algorithm
      const filter = this.createFilter(algorithm, sampleRate, beta);
      
      // Process each sample
      const orientations = [];
      const dt = 1.0 / sampleRate;
      
      for (let i = 0; i < rows.length; i++) {
        // Get calibrated sensor readings
        let ax = accCal.x[i];
        let ay = accCal.y[i];
        let az = accCal.z[i];
        
        let gx = gyroData.x[i];
        let gy = gyroData.y[i];
        let gz = gyroData.z[i];
        
        let mx = magCal.x[i];
        let my = magCal.y[i];
        let mz = magCal.z[i];
        
        // Convert gyro to rad/s if needed
        if (gyroIsDegrees) {
          gx = gx * Math.PI / 180;
          gy = gy * Math.PI / 180;
          gz = gz * Math.PI / 180;
        }
        
        // Update filter
        filter.update(gx, gy, gz, ax, ay, az, mx, my, mz, dt);
        
        // Get orientation
        const quat = filter.getQuaternion();
        const euler = this.quaternionToEuler(quat);
        const rotMatrix = this.quaternionToRotationMatrix(quat);
        
        orientations.push({
          quat: quat,
          euler: euler,
          rotMatrix: rotMatrix
        });
      }
      
      return {
        times: timeSeconds,
        orientations: orientations,
        algorithm: algorithm,
        sampleRate: sampleRate
      };
    }
    
    /**
     * Remove gravity bias using high-pass filter
     * This prevents drift from constant accelerations
     */
    removeGravityBias(accData, sampleRate) {
      const cutoffFreq = 0.5; // Hz - removes low-frequency components (gravity)
      
      return {
        x: this.highPassFilter(accData.x, sampleRate, cutoffFreq),
        y: this.highPassFilter(accData.y, sampleRate, cutoffFreq),
        z: this.highPassFilter(accData.z, sampleRate, cutoffFreq)
      };
    }
    
    highPassFilter(data, sampleRate, cutoffFreq) {
      const RC = 1.0 / (cutoffFreq * 2 * Math.PI);
      const dt = 1.0 / sampleRate;
      const alpha = RC / (RC + dt);
      
      const filtered = [0]; // Start at zero
      
      for (let i = 1; i < data.length; i++) {
        filtered[i] = alpha * (filtered[i - 1] + data[i] - data[i - 1]);
      }
      
      return filtered;
    }
    
    hasAxisData(headers, sensor) {
      const keys = this.findAxisKeys(headers, sensor);
      return keys.x != null && keys.y != null && keys.z != null;
    }
    
    extractAxisData(rows, headers, sensor) {
      const keys = this.findAxisKeys(headers, sensor);
      return {
        x: rows.map(r => Number(r[keys.x] || 0)),
        y: rows.map(r => Number(r[keys.y] || 0)),
        z: rows.map(r => Number(r[keys.z] || 0))
      };
    }
    
    calibrateMagnetometer(magData) {
      // Remove hard iron bias (DC offset)
      const biasX = this.median(magData.x);
      const biasY = this.median(magData.y);
      const biasZ = this.median(magData.z);
      
      return {
        x: magData.x.map(v => v - biasX),
        y: magData.y.map(v => v - biasY),
        z: magData.z.map(v => v - biasZ)
      };
    }

    calibrateAccelerometer(accData) {
      // Normalise to 1g (assuming stationary calibration period exists)
      const magnitudes = accData.x.map((_, i) => {
        const ax = accData.x[i];
        const ay = accData.y[i];
        const az = accData.z[i];
        return Math.sqrt(ax*ax + ay*ay + az*az);
      });
      
      const avgMagnitude = this.mean(magnitudes);
      const scale = avgMagnitude > 0 ? 1.0 / avgMagnitude : 1.0;
      
      return {
        x: accData.x.map(v => v * scale),
        y: accData.y.map(v => v * scale),
        z: accData.z.map(v => v * scale)
      };
    }

    median(arr) {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    mean(arr) {
      return arr.reduce((sum, v) => sum + v, 0) / arr.length;
    }

    findAxisKeys(headers, sensor) {
      const normalize = (s) =>
        String(s || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');

      const candidates = {
        acc: {
          x: ['acc_x', 'accel_x', 'ax', 'accelerometer_x', 'accx'],
          y: ['acc_y', 'accel_y', 'ay', 'accelerometer_y', 'accy'],
          z: ['acc_z', 'accel_z', 'az', 'accelerometer_z', 'accz']
        },
        gyro: {
          x: ['gyro_x', 'gx', 'gyroscope_x', 'gyrox'],
          y: ['gyro_y', 'gy', 'gyroscope_y', 'gyroy'],
          z: ['gyro_z', 'gz', 'gyroscope_z', 'gyroz']
        },
        mag: {
          x: ['mag_x', 'mx', 'magnetometer_x', 'magx'],
          y: ['mag_y', 'my', 'magnetometer_y', 'magy'],
          z: ['mag_z', 'mz', 'magnetometer_z', 'magz']
        }
      };

      const normHeaders = Array.isArray(headers) ? headers.map(normalize) : [];

      const findIndex = (axis) => {
        for (const c of candidates[sensor][axis]) {
          const idx = normHeaders.indexOf(normalize(c));
          if (idx >= 0) return idx; // ✅ return index, not header string
        }
        return null;
      };

      return {
        x: findIndex('x'),
        y: findIndex('y'),
        z: findIndex('z')
      };
    }
    
    createFilter(algorithm, sampleRate, beta) {
      if (typeof Madgwick === 'undefined') {
        throw new Error('AHRS library not loaded. Add ahrs_min.js to your project');
      }
      
      switch (algorithm) {
        case 'madgwick':
          return new Madgwick({ sampleInterval: 1000 / sampleRate, beta: beta });
        case 'mahony':
          return new Mahony({ sampleInterval: 1000 / sampleRate });
        case 'complementary':
          return new Madgwick({ sampleInterval: 1000 / sampleRate, beta: beta });
        default:
          throw new Error('Unknown algorithm: ' + algorithm);
      }
    }
    
    quaternionToEuler(q) {
      const [w, x, y, z] = q;
      
      // Roll (x-axis rotation)
      const sinr_cosp = 2 * (w * x + y * z);
      const cosr_cosp = 1 - 2 * (x * x + y * y);
      const roll = Math.atan2(sinr_cosp, cosr_cosp);
      
      // Pitch (y-axis rotation)
      const sinp = 2 * (w * y - z * x);
      const pitch = Math.abs(sinp) >= 1
        ? Math.sign(sinp) * Math.PI / 2
        : Math.asin(sinp);
      
      // Yaw (z-axis rotation)
      const siny_cosp = 2 * (w * z + x * y);
      const cosy_cosp = 1 - 2 * (y * y + z * z);
      const yaw = Math.atan2(siny_cosp, cosy_cosp);
      
      return { roll, pitch, yaw };
    }
    
    quaternionToRotationMatrix(q) {
      const [w, x, y, z] = q;
      
      return [
        [1 - 2*(y*y + z*z), 2*(x*y - w*z), 2*(x*z + w*y)],
        [2*(x*y + w*z), 1 - 2*(x*x + z*z), 2*(y*z - w*x)],
        [2*(x*z - w*y), 2*(y*z + w*x), 1 - 2*(x*x + y*y)]
      ];
    }
    
    rotateVectorByQuaternion(v, q) {
      const [qw, qx, qy, qz] = q;
      const [vx, vy, vz] = v;
      
      // qvq* formula
      const ix =  qw * vx + qy * vz - qz * vy;
      const iy =  qw * vy + qz * vx - qx * vz;
      const iz =  qw * vz + qx * vy - qy * vx;
      const iw = -qx * vx - qy * vy - qz * vz;
      
      return [
        ix * qw + iw * -qx + iy * -qz - iz * -qy,
        iy * qw + iw * -qy + iz * -qx - ix * -qz,
        iz * qw + iw * -qz + ix * -qy - iy * -qx
      ];
    }
  }
  
  // =============================================
  // Fusion UI Class (IMPROVED with throttling)
  // =============================================
  
  class FusionUI {
    constructor() {
      this.currentFusionData = null;
      this.lastRenderTime = 0;
      this.renderThrottleMs = 50; // Max 20 FPS for smooth rendering
      this.animationFrameId = null;
    }
    
    init() {
      // UI is already in HTML, no need to create
    }
    
    updateDisplay(fusionData, cursorTime) {
      this.currentFusionData = fusionData;
      
      // Cancel any pending animation frame
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
      }
      
      // Throttle rendering to prevent choppiness
      const now = performance.now();
      if (now - this.lastRenderTime < this.renderThrottleMs) {
        // Schedule for next frame
        this.animationFrameId = requestAnimationFrame(() => {
          this._doRender(cursorTime);
        });
        return;
      }
      
      this._doRender(cursorTime);
    }
    
    _doRender(cursorTime) {
      if (!this.currentFusionData) return;
      
      this.lastRenderTime = performance.now();
      
      // Find closest orientation to cursor time
      const times = this.currentFusionData.times;
      let closestIndex = 0;
      let minDiff = Math.abs(times[0] - cursorTime);
      
      for (let i = 1; i < times.length; i++) {
        const diff = Math.abs(times[i] - cursorTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestIndex = i;
        }
      }
      
      const orientation = this.currentFusionData.orientations[closestIndex];
      
      // Update quaternion display
      const quatEl = document.getElementById('fusionQuat');
      if (quatEl && orientation) {
        const q = orientation.quat;
        quatEl.textContent = `w: ${q[0].toFixed(3)}, x: ${q[1].toFixed(3)}, y: ${q[2].toFixed(3)}, z: ${q[3].toFixed(3)}`;
      }
      
      // Update Euler angles display
      const eulerEl = document.getElementById('fusionEuler');
      if (eulerEl && orientation) {
        const e = orientation.euler;
        eulerEl.innerHTML = `
          Roll: ${(e.roll * 180 / Math.PI).toFixed(1)}°<br>
          Pitch: ${(e.pitch * 180 / Math.PI).toFixed(1)}°<br>
          Yaw: ${(e.yaw * 180 / Math.PI).toFixed(1)}°
        `;
      }
      
      // Update rotation matrix display
      const matrixEl = document.getElementById('fusionMatrix');
      if (matrixEl && orientation) {
        const m = orientation.rotMatrix;
        matrixEl.textContent = m.map(row => 
          row.map(v => v.toFixed(3).padStart(7)).join(' ')
        ).join('\n');
      }
      
      // Render 3D visualisation
      this.render3D(orientation.quat);
    }
    
    render3D(quaternion) {
      const canvas = document.getElementById('fusionCanvas3D');
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const scale = 60;
      
      // Clear canvas
      ctx.clearRect(0, 0, w, h);
      
      // Define IMU box vertices (rectangular prism)
      const vertices = [
        [-1, -0.5, 0.25], [1, -0.5, 0.25], [1, 0.5, 0.25], [-1, 0.5, 0.25],  // Front
        [-1, -0.5, -0.25], [1, -0.5, -0.25], [1, 0.5, -0.25], [-1, 0.5, -0.25]
      ];
      
      // Rotate vertices by quaternion
      const processor = new FusionProcessor();
      const rotatedVertices = vertices.map(v => {
        const rotated = processor.rotateVectorByQuaternion(v, quaternion);
        // Project to 2D (orthographic)
        return {
          x: cx + rotated[0] * scale,
          y: cy - rotated[2] * scale,
          depth: rotated[1]  // Y is depth (forward/back)
        };
      });
      
      // Define faces (vertex indices)
      const faces = [
        { indices: [0, 1, 2, 3], color: '#4fb364', label: 'TOP' },     // Front (green)
        { indices: [4, 5, 6, 7], color: '#2d6b3f', label: '' },        // Back (dark green)
        { indices: [0, 1, 5, 4], color: '#3a8c4f', label: '' },        // Bottom
        { indices: [2, 3, 7, 6], color: '#5ec977', label: '' },        // Top
        { indices: [0, 3, 7, 4], color: '#45a059', label: 'X+' },      // Left
        { indices: [1, 2, 6, 5], color: '#45a059', label: '' },        // Right
      ];
      
      // Calculate face depths for z-ordering
      const facesWithDepth = faces.map(face => {
        const avgDepth = face.indices.reduce((sum, i) => sum + rotatedVertices[i].depth, 0) / face.indices.length;
        return { ...face, depth: avgDepth };
      });
      
      // Sort faces back-to-front (painter's algorithm)
      facesWithDepth.sort((a, b) => a.depth - b.depth);
      
      // Draw faces
      facesWithDepth.forEach(face => {
        ctx.beginPath();
        face.indices.forEach((vi, i) => {
          const v = rotatedVertices[vi];
          if (i === 0) ctx.moveTo(v.x, v.y);
          else ctx.lineTo(v.x, v.y);
        });
        ctx.closePath();
        
        // Fill with depth-based opacity
        const opacity = face.depth < 0 ? 0.4 : 0.8;
        ctx.fillStyle = face.color + Math.floor(opacity * 255).toString(16).padStart(2, '0');
        ctx.fill();
        
        // Stroke edges
        ctx.strokeStyle = face.depth < 0 ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.5)';
        ctx.lineWidth = face.depth < 0 ? 1 : 2;
        ctx.stroke();
        
        // Draw label on front face
        if (face.label && face.depth > 0) {
          const centerX = face.indices.reduce((sum, i) => sum + rotatedVertices[i].x, 0) / face.indices.length;
          const centerY = face.indices.reduce((sum, i) => sum + rotatedVertices[i].y, 0) / face.indices.length;
          
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 11px Poppins, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(face.label, centerX, centerY);
        }
      });
      
      // Draw axes overlaid
      const axisLength = 80;
      const axes = [
        { dir: [1, 0, 0], color: '#ff5252', label: 'X' },
        { dir: [0, 1, 0], color: '#00e676', label: 'Y' },
        { dir: [0, 0, 1], color: '#40c4ff', label: 'Z' },
      ];
      
      axes.forEach(axis => {
        const rotated = processor.rotateVectorByQuaternion(axis.dir, quaternion);
        const x2d = rotated[0];
        const y2d = -rotated[2];
        const depth = rotated[1];
        const alpha = depth < 0 ? 0.3 : 1.0;
        
        // Draw line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + x2d * axisLength, cy + y2d * axisLength);
        ctx.lineWidth = depth < 0 ? 2 : 3;
        ctx.strokeStyle = axis.color;
        ctx.globalAlpha = alpha;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
        
        // Draw arrow
        const angle = Math.atan2(y2d, x2d);
        const tipX = cx + x2d * axisLength;
        const tipY = cy + y2d * axisLength;
        const arrowSize = 8;
        
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - arrowSize * Math.cos(angle - Math.PI / 6),
          tipY - arrowSize * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - arrowSize * Math.cos(angle + Math.PI / 6),
          tipY - arrowSize * Math.sin(angle + Math.PI / 6)
        );
        ctx.strokeStyle = axis.color;
        ctx.globalAlpha = alpha;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
        
        // Label
        ctx.fillStyle = axis.color;
        ctx.font = 'bold 13px Poppins, sans-serif';
        ctx.globalAlpha = alpha;
        ctx.fillText(axis.label, tipX + 12, tipY);
        ctx.globalAlpha = 1.0;
      });
      
      // Draw frame hint
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.font = '10px Poppins, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('IMU Sensor (Body Frame)', 10, h - 10);
    }
    
    showPanel(show) {
      const panel = document.getElementById('viewerFusion');
      if (panel) {
        panel.style.display = show ? 'block' : 'none';
      }
    }
  }
  
  // =============================================
  // Fusion Manager (coordinates processor + UI)
  // =============================================
  
  class FusionManager {
    constructor() {
      this.processor = new FusionProcessor();
      this.ui = new FusionUI();
      this.currentSettings = {
        algorithm: 'madgwick',
        beta: 0.1
      };
    }
    
    init() {
      this.ui.init();
    }
    
    async processFusion(options) {
      try {
        // --- Compatibility layer ---
        // Some callers pass { timeSecondsIndex } instead of { timeSeconds }.
        // FusionProcessor.process() requires an explicit timeSeconds array.
        const normalized = { ...(options || {}) };

        // Build timeSeconds from CSV rows if needed
        if (!Array.isArray(normalized.timeSeconds) && normalized.timeSecondsIndex != null) {
          const tIdx = Number(normalized.timeSecondsIndex);
          const rows = Array.isArray(normalized.rows) ? normalized.rows : [];
          normalized.timeSeconds = rows.map(r => {
            const v = Number(r?.[tIdx]);
            return Number.isFinite(v) ? v : 0;
          });
        }

        // Estimate sampleRate if not provided but timeSeconds exists
        if (!Number.isFinite(normalized.sampleRate) &&
            Array.isArray(normalized.timeSeconds) &&
            normalized.timeSeconds.length > 2) {

          const ts = normalized.timeSeconds;
          // Median dt over first ~200 samples for robustness
          const n = Math.min(ts.length - 1, 200);
          const dts = [];
          for (let i = 1; i <= n; i++) {
            const dt = ts[i] - ts[i - 1];
            if (Number.isFinite(dt) && dt > 0) dts.push(dt);
          }
          dts.sort((a, b) => a - b);
          const mid = Math.floor(dts.length / 2);
          const medianDt = dts.length ? (dts.length % 2 ? dts[mid] : (dts[mid - 1] + dts[mid]) / 2) : null;
          if (medianDt && medianDt > 0) normalized.sampleRate = 1 / medianDt;
        }

        // Don't forward helper-only options to the processor
        delete normalized.settings;

        const fusionData = this.processor.process({
          ...normalized,
          algorithm: this.currentSettings.algorithm,
          beta: this.currentSettings.beta
        });

        return fusionData;
      } catch (err) {
        console.error('Fusion processing failed:', err);
        throw err;
      }
    }
    
    updateDisplay(fusionData, timeSeconds) {
      this.ui.updateDisplay(fusionData, timeSeconds);
    }
    
    showPanel(show) {
      this.ui.showPanel(show);
    }
    
    getSettings() {
      return { ...this.currentSettings };
    }
  }
  
  // =============================================
  // Export singleton instance
  // =============================================
  
  window.FusionManager = new FusionManager();
  
})();
