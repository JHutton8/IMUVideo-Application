"use strict";

/**
 * MoveNet overlay renderer.
 *
 * Expects globals set by pose-overlay.js:
 *   - window.video, window.canvas, window.ctx
 *   - window.syncVideoAndCanvasSize(), window.setStatus(), window.setButtonsRunning(), window.formatTime()
 */

const MIN_PART_CONFIDENCE = Number.isFinite(window.MIN_PART_CONFIDENCE) ? window.MIN_PART_CONFIDENCE : 0.2;
const UPLOAD_FRAME_SKIP = Number.isFinite(window.UPLOAD_FRAME_SKIP) ? window.UPLOAD_FRAME_SKIP : 2;
const FLIP_HORIZONTAL_UPLOAD = typeof window.FLIP_HORIZONTAL_UPLOAD === "boolean" ? window.FLIP_HORIZONTAL_UPLOAD : false;

const MOVENET_CONNECTED_KEYPOINTS = [
  ["nose", "left_eye"],
  ["nose", "right_eye"],
  ["left_eye", "left_ear"], 
  ["right_eye", "right_ear"],
  ["nose", "left_shoulder"], 
  ["nose", "right_shoulder"],
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"], 
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"], 
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"], 
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"], 
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"], 
  ["right_knee", "right_ankle"],
];

// Detector (shared)
let detector = null;

// Tracking state
let isRunning = false;
let animationId = null;

// Joint selection and angle measurement
let selectedJoints = [];
let measuredAngles = [];

// Performance
let frameIndex = 0;
let lastPose = null;

function getContainedRect(videoEl) {
  const vw = videoEl.videoWidth || 1;
  const vh = videoEl.videoHeight || 1;
  const dw = videoEl.clientWidth || 1;
  const dh = videoEl.clientHeight || 1;

  const scale = Math.min(dw / vw, dh / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const offX = (dw - dispW) / 2;
  const offY = (dh - dispH) / 2;

  return { scale, offX, offY };
}

function mapKeypointsToDisplay(keypoints, videoEl) {
  const { scale, offX, offY } = getContainedRect(videoEl);
  return (keypoints || []).map((kp) => ({
    ...kp,
    x: kp.x * scale + offX,
    y: kp.y * scale + offY,
  }));
}

function drawKeypoints(keypoints) {
  keypoints.forEach((kp) => {
    const score = kp.score ?? 0;
    if (score < 0.02) return;

    const isSelected = selectedJoints.includes(kp.name);
    const baseSize = 5;
    const size = isSelected ? baseSize * 2 : baseSize;

    ctx.beginPath();
    ctx.arc(kp.x, kp.y, size, 0, 2 * Math.PI);

    if (isSelected) {
      ctx.fillStyle = "#FFD700";
      ctx.fill();
      ctx.strokeStyle = "#FF4500";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = score >= MIN_PART_CONFIDENCE ? "#2196F3" : "rgba(33, 150, 243, 0.3)";
      ctx.fill();
    }
  });
}

function drawSkeleton(keypoints) {
  const byName = {};
  for (const kp of keypoints) if (kp.name) byName[kp.name] = kp;

  for (const [a, b] of MOVENET_CONNECTED_KEYPOINTS) {
    const kp1 = byName[a];
    const kp2 = byName[b];
    if (!kp1 || !kp2) continue;

    const s1 = kp1.score ?? 0;
    const s2 = kp2.score ?? 0;
    if (s1 < MIN_PART_CONFIDENCE || s2 < MIN_PART_CONFIDENCE) continue;

    ctx.beginPath();
    ctx.moveTo(kp1.x, kp1.y);
    ctx.lineTo(kp2.x, kp2.y);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#FF4081";
    ctx.stroke();
  }
}

function calculateAngle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };

  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  if (mag1 === 0 || mag2 === 0) return 0;

  const cos = dot / (mag1 * mag2);
  const clamped = Math.max(-1, Math.min(1, cos));
  return (Math.acos(clamped) * 180) / Math.PI;
}

function drawAngles(keypoints) {
  if (measuredAngles.length === 0) return;

  const byName = {};
  for (const kp of keypoints) if (kp.name) byName[kp.name] = kp;

  measuredAngles.forEach(({ joints }) => {
    const [j1Name, j2Name, j3Name] = joints;
    const kp1 = byName[j1Name];
    const kp2 = byName[j2Name];
    const kp3 = byName[j3Name];
    if (!kp1 || !kp2 || !kp3) return;

    if ((kp1.score ?? 0) < MIN_PART_CONFIDENCE || (kp2.score ?? 0) < MIN_PART_CONFIDENCE || (kp3.score ?? 0) < MIN_PART_CONFIDENCE) {
      return;
    }

    const angle = calculateAngle(kp1, kp2, kp3);

    ctx.strokeStyle = "#00FF00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(kp1.x, kp1.y);
    ctx.lineTo(kp2.x, kp2.y);
    ctx.lineTo(kp3.x, kp3.y);
    ctx.stroke();

    const radius = 30;
    const v1 = { x: kp1.x - kp2.x, y: kp1.y - kp2.y };
    const v2 = { x: kp3.x - kp2.x, y: kp3.y - kp2.y };

    const angle1 = Math.atan2(v1.y, v1.x);
    const angle2 = Math.atan2(v2.y, v2.x);

    ctx.beginPath();
    ctx.arc(kp2.x, kp2.y, radius, angle1, angle2, false);
    ctx.stroke();

    const midAngle = (angle1 + angle2) / 2;
    const textX = kp2.x + Math.cos(midAngle) * (radius + 25);
    const textY = kp2.y + Math.sin(midAngle) * (radius + 25);

    ctx.font = "bold 18px Arial";
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;

    const angleText = `${angle.toFixed(1)}°`;
    ctx.strokeText(angleText, textX, textY);
    ctx.fillText(angleText, textX, textY);
  });
}

async function renderFrame() {
  if (!isRunning) return;

  if (!video || video.readyState < 2) {
    animationId = requestAnimationFrame(renderFrame);
    return;
  }

  // keep canvas matched to display size (pose-overlay sets DPR transform)
  syncVideoAndCanvasSize?.();

  frameIndex++;
  const shouldUpdatePose = frameIndex % UPLOAD_FRAME_SKIP === 0 || !lastPose;

  if (shouldUpdatePose && detector) {
    try {
      const poses = await detector.estimatePoses(video, { maxPoses: 1, flipHorizontal: FLIP_HORIZONTAL_UPLOAD });
      lastPose = poses[0] || null;
    } catch (e) {
      console.error("MoveNet pose estimation failed:", e);
      setStatus?.("Pose estimation failed. See console.");
      // Keep lastPose so overlay can continue rendering if this was transient
    }
  }

  if (!lastPose || !canvas || !ctx) {
    animationId = requestAnimationFrame(renderFrame);
    return;
  }

  const keypoints = mapKeypointsToDisplay(lastPose.keypoints || [], video);

  // Clear in CSS pixels (pose-overlay already setTransform(dpr,...))
  ctx.clearRect(0, 0, video.clientWidth || canvas.width, video.clientHeight || canvas.height);
  drawKeypoints(keypoints);
  drawSkeleton(keypoints);
  drawAngles(keypoints);

  animationId = requestAnimationFrame(renderFrame);
}

async function ensureDetector() {
  // Global promise so we init exactly once
  window.__MoveNetDetectorPromise ??= (async () => {
    if (!window.tf || !window.poseDetection) {
      throw new Error("TFJS / poseDetection not available. ensureMoveNetDeps() must run first.");
    }

    await tf.ready();

    const model = poseDetection.SupportedModels.MoveNet;
    return poseDetection.createDetector(model, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
      enableSmoothing: true,
    });
  })();

  detector = await window.__MoveNetDetectorPromise;
  return detector;
}

/** Public: start tracking. Called by pose-overlay.js via window.handleStart(). */
async function handleStart() {
  if (isRunning) return;

  try {
    await ensureDetector();
  } catch (err) {
    console.error("❌ MoveNet init failed:", err);
    setStatus?.("MoveNet init failed. See console.");
    return;
  }

  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    setStatus?.("Video not ready yet. Press Start again after it loads.");
    return;
  }

  try { if (video.paused) await video.play(); } catch {}

  frameIndex = 0;
  lastPose = null;

  isRunning = true;
  setButtonsRunning?.(true);
  setStatus?.("Tracking with MoveNet…");
  animationId = requestAnimationFrame(renderFrame);
}

/** Public: stop tracking + pause video. */
function stopTracking() {
  if (!isRunning) return;

  isRunning = false;
  setButtonsRunning?.(false);

  if (animationId != null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  video?.pause?.();
  setStatus?.("Tracking stopped.");
}

// Expose to window for pose-overlay.js
window.handleStart = handleStart;
window.handleStop = stopTracking;
window.stopTracking = stopTracking;

// ===== Joint Selection & Angle Measurement API =====
window.addSelectedJoint = function (jointName) {
  if (!jointName || selectedJoints.includes(jointName)) return selectedJoints.slice();
  selectedJoints.push(jointName);
  if (selectedJoints.length > 3) selectedJoints = selectedJoints.slice(-3);
  return selectedJoints.slice();
};

window.getSelectedJoints = function () {
  return selectedJoints.slice();
};

window.measureAngle = function () {
  if (selectedJoints.length < 3) return null;
  if (!lastPose || !lastPose.keypoints) return null;

  const joints = selectedJoints.slice(-3);
  const byName = {};
  for (const kp of lastPose.keypoints) if (kp.name) byName[kp.name] = kp;

  const kp1 = byName[joints[0]];
  const kp2 = byName[joints[1]];
  const kp3 = byName[joints[2]];
  if (!kp1 || !kp2 || !kp3) return null;

  if ((kp1.score ?? 0) < MIN_PART_CONFIDENCE || (kp2.score ?? 0) < MIN_PART_CONFIDENCE || (kp3.score ?? 0) < MIN_PART_CONFIDENCE) {
    return null;
  }

  measuredAngles.push({ joints });
  return calculateAngle(kp1, kp2, kp3);
};

window.resetJointAnalysis = function () {
  selectedJoints = [];
  measuredAngles = [];
};

window.getMeasuredAngles = function () {
  return measuredAngles.slice();
};