// =======================================
// MoveSync: Upload (single-page save)
// File: app/navigation/upload/upload.js
// =======================================

(() => {
  "use strict";

  window.MoveSyncPages = window.MoveSyncPages || {};
  const PAGE_NAME = "Upload";

  let state = {
    video: null,
    videoObjectUrl: null,
    imus: [],
    nextImuId: 1,
  };

  // -------------------------
  // DOM helpers
  // -------------------------
  const qs = (id) => document.getElementById(id);

  const setText = (id, text) => {
    const el = qs(id);
    if (el) el.textContent = text || "";
  };

  const setMsg = (text) => {
    setText("msgMain", text);
    setText("msgSide", text);
  };

  const clearMsg = () => setMsg("");

  const setHint = (text) => {
    setText("hintMain", text);
    setText("hintSide", text);
  };

  const escapeHtml = (str) =>
    String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  // -------------------------
  // Validation rules
  // -------------------------
  function imusValid() {
    if (state.imus.length === 0) return true;
    return state.imus.every((imu) => !!imu.file);
  }

  // Save-ready rule:
  // - video only OR IMU-only (>=1 and all valid) OR both
  function hasSomethingToSave() {
    const hasVideo = !!state.video;
    const hasImu = state.imus.length > 0;
    const imuOk = imusValid();
    return hasVideo || (hasImu && imuOk);
  }

  function readyMessage() {
    const hasVideo = !!state.video;
    const hasImu = state.imus.length > 0;
    const imuOk = imusValid();

    if (!hasVideo && !hasImu) return "Upload a video or add at least one IMU CSV to save.";
    if (hasImu && !imuOk) return "All added IMU sensors must have a CSV file.";
    if (hasVideo && !hasImu) return "Ready: video-only session.";
    if (!hasVideo && hasImu && imuOk) return "Ready: IMU-only session.";
    return "Ready: video + IMU session.";
  }

  // -------------------------
  // Summary sync (right card)
  // -------------------------
  function syncSummary() {
    setText("sumVideo", state.video ? state.video.name : "None");
    setText("sumImu", String(state.imus.length));
    setText("readyCheckLine", readyMessage());
  }

  // -------------------------
  // Buttons + hint
  // -------------------------
  function syncButtons() {
    const saveBtn = qs("saveSessionBtn");
    if (saveBtn) saveBtn.disabled = !hasSomethingToSave();
    setHint(readyMessage());
  }

  // =========================================
  // Video
  // =========================================
  function setVideoEmpty(isEmpty) {
    const empty = qs("videoPreviewEmpty");
    if (!empty) return;
    empty.style.display = isEmpty ? "grid" : "none";
  }

  function clearVideoPreview() {
    const input = qs("uploadVideoInput");
    if (input) input.value = "";

    const video = qs("videoPreview");
    if (video) {
      video.src = "";
      if (typeof video.load === "function") video.load();
    }

    if (state.videoObjectUrl) {
      URL.revokeObjectURL(state.videoObjectUrl);
      state.videoObjectUrl = null;
    }

    state.video = null;
    setText("pickedVideoName", "");
    setVideoEmpty(true);

    syncSummary();
    syncButtons();
  }

  function showVideoPreview(file) {
    const video = qs("videoPreview");
    if (!video) return;

    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);

    state.videoObjectUrl = URL.createObjectURL(file);
    video.src = state.videoObjectUrl;
    if (typeof video.load === "function") video.load();
    setVideoEmpty(false);
  }

  function wireVideo() {
    const dropzone = qs("videoDropzone");
    const input = qs("uploadVideoInput");
    const pickBtn = qs("pickVideoBtn");

    if (!dropzone || !input) return;

    pickBtn?.addEventListener("click", () => input.click());

    dropzone.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      input.click();
    });

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("video/")) {
        setMsg("That file doesn't look like a video.");
        input.value = "";
        return;
      }

      state.video = file;
      setText("pickedVideoName", file.name);
      showVideoPreview(file);

      clearMsg();
      syncSummary();
      syncButtons();
    });

    let depth = 0;

    dropzone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      depth++;
      dropzone.classList.add("is-dragover");
    });

    dropzone.addEventListener("dragover", (e) => e.preventDefault());

    dropzone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) dropzone.classList.remove("is-dragover");
    });

    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      depth = 0;
      dropzone.classList.remove("is-dragover");

      const file = e.dataTransfer.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("video/")) {
        setMsg("Drop a valid video file here.");
        return;
      }

      state.video = file;
      setText("pickedVideoName", file.name);
      showVideoPreview(file);

      clearMsg();
      syncSummary();
      syncButtons();
    });

    qs("clearVideoBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      clearVideoPreview();
    });

    setVideoEmpty(true);
  }

  // =========================================
  // IMU
  // =========================================
  const generateImuId = () => `imu_${state.nextImuId++}`;

  function updateImuCount() {
    const count = state.imus.length;
    setText("imuCount", `${count} sensor${count === 1 ? "" : "s"}`);
  }

  function addImu() {
    state.imus.push({
      id: generateImuId(),
      label: `IMU ${state.imus.length + 1}`,
      file: null,
      csvText: "",
      skeletonNode: "",
    });

    renderImus();
    syncSummary();
    syncButtons();
  }

  function removeImu(id) {
    const idx = state.imus.findIndex((x) => x.id === id);
    if (idx === -1) return;
    state.imus.splice(idx, 1);

    state.imus.forEach((imu, i) => {
      if (!imu.file && (!imu.label || imu.label.startsWith("IMU "))) imu.label = `IMU ${i + 1}`;
    });

    renderImus();
    syncSummary();
    syncButtons();
  }

  function updateImu(id, patch) {
    const imu = state.imus.find((x) => x.id === id);
    if (!imu) return;
    Object.assign(imu, patch);
    renderImuCard(id);
    syncSummary();
    syncButtons();
  }

  function renderImus() {
    const container = qs("imuSlotsContainer");
    const empty = qs("imuEmptyState");
    if (!container) return;

    updateImuCount();

    if (state.imus.length === 0) {
      if (empty) empty.hidden = false;
      container.querySelectorAll(".uw-sensor").forEach((n) => n.remove());
      return;
    }

    if (empty) empty.hidden = true;

    const ids = new Set(state.imus.map((x) => x.id));
    container.querySelectorAll(".uw-sensor").forEach((node) => {
      if (!ids.has(node.dataset.imuId)) node.remove();
    });

    state.imus.forEach((imu) => {
      let node = container.querySelector(`.uw-sensor[data-imu-id="${imu.id}"]`);
      if (!node) {
        node = document.createElement("div");
        node.className = "uw-sensor";
        node.dataset.imuId = imu.id;
        container.appendChild(node);
      }
      updateImuCardContent(node, imu);
    });
  }

  function renderImuCard(id) {
    const container = qs("imuSlotsContainer");
    if (!container) return;

    const imu = state.imus.find((x) => x.id === id);
    if (!imu) return;

    const node = container.querySelector(`.uw-sensor[data-imu-id="${id}"]`);
    if (!node) return;

    updateImuCardContent(node, imu);
  }

  function updateImuCardContent(node, imu) {
    const hasFile = !!imu.file;

    node.innerHTML = `
      <div class="uw-sensor-head">
        <div class="uw-sensor-top">
          <div class="uw-sensor-title">${escapeHtml(imu.label || "IMU")}</div>
          <button class="uw-sensor-remove" type="button" title="Remove sensor" data-action="remove">
            <i class="bx bx-x"></i>
          </button>
        </div>

        <div class="uw-sensor-fields">
          <label class="uw-field">
            <span class="uw-label">Label</span>
            <input class="uw-input" type="text" value="${escapeHtml(imu.label)}" placeholder="e.g., Left Ankle" data-action="label"/>
          </label>

          <label class="uw-field">
            <span class="uw-label">Skeleton node</span>
            <select class="uw-input" data-action="node">
              <option value="">Node selection</option>
              <optgroup label="Head">
                <option value="nose" ${imu.skeletonNode === "nose" ? "selected" : ""}>Nose</option>
                <option value="left_eye" ${imu.skeletonNode === "left_eye" ? "selected" : ""}>Left Eye</option>
                <option value="right_eye" ${imu.skeletonNode === "right_eye" ? "selected" : ""}>Right Eye</option>
                <option value="left_ear" ${imu.skeletonNode === "left_ear" ? "selected" : ""}>Left Ear</option>
                <option value="right_ear" ${imu.skeletonNode === "right_ear" ? "selected" : ""}>Right Ear</option>
              </optgroup>
              <optgroup label="Upper Body">
                <option value="left_shoulder" ${imu.skeletonNode === "left_shoulder" ? "selected" : ""}>Left Shoulder</option>
                <option value="right_shoulder" ${imu.skeletonNode === "right_shoulder" ? "selected" : ""}>Right Shoulder</option>
                <option value="left_elbow" ${imu.skeletonNode === "left_elbow" ? "selected" : ""}>Left Elbow</option>
                <option value="right_elbow" ${imu.skeletonNode === "right_elbow" ? "selected" : ""}>Right Elbow</option>
                <option value="left_wrist" ${imu.skeletonNode === "left_wrist" ? "selected" : ""}>Left Wrist</option>
                <option value="right_wrist" ${imu.skeletonNode === "right_wrist" ? "selected" : ""}>Right Wrist</option>
              </optgroup>
              <optgroup label="Lower Body">
                <option value="left_hip" ${imu.skeletonNode === "left_hip" ? "selected" : ""}>Left Hip</option>
                <option value="right_hip" ${imu.skeletonNode === "right_hip" ? "selected" : ""}>Right Hip</option>
                <option value="left_knee" ${imu.skeletonNode === "left_knee" ? "selected" : ""}>Left Knee</option>
                <option value="right_knee" ${imu.skeletonNode === "right_knee" ? "selected" : ""}>Right Knee</option>
                <option value="left_ankle" ${imu.skeletonNode === "left_ankle" ? "selected" : ""}>Left Ankle</option>
                <option value="right_ankle" ${imu.skeletonNode === "right_ankle" ? "selected" : ""}>Right Ankle</option>
              </optgroup>
            </select>
          </label>
        </div>
      </div>

      <div class="uw-sensor-body">
        <input type="file" accept=".csv,text/csv" hidden data-action="file"/>

        <div class="uw-sensor-drop" data-action="drop">
          ${
            hasFile
              ? `<strong>${escapeHtml(imu.file.name)}</strong><span>Click to change</span>`
              : `<strong>Drop CSV here</strong><span>or click to browse</span>`
          }
        </div>

        <div class="uw-sensor-file">
          ${hasFile ? `Selected: ${escapeHtml(imu.file.name)}` : `No CSV selected.`}
        </div>

        ${
          hasFile
            ? `
          <div class="uw-sensor-preview">
            <div class="uw-sensor-preview-title">Preview (first 6 lines)</div>
            <pre>${escapeHtml(imu.csvText.split("\n").slice(0, 6).join("\n"))}</pre>
          </div>`
            : ``
        }
      </div>
    `;

    wireImuCard(node, imu.id);
  }

  function wireImuCard(node, imuId) {
    const imu = state.imus.find((x) => x.id === imuId);
    if (!imu) return;

    const labelInput = node.querySelector('[data-action="label"]');
    const nodeSelect = node.querySelector('[data-action="node"]');
    const removeBtn = node.querySelector('[data-action="remove"]');
    const fileInput = node.querySelector('[data-action="file"]');
    const drop = node.querySelector('[data-action="drop"]');

    labelInput?.addEventListener("input", (e) => {
      const target = state.imus.find((x) => x.id === imuId);
      if (!target) return;
      const fallback = `IMU ${state.imus.indexOf(target) + 1}`;
      target.label = e.target.value || fallback;

      const title = node.querySelector(".uw-sensor-title");
      if (title) title.textContent = target.label;
    });

    nodeSelect?.addEventListener("change", (e) => {
      const target = state.imus.find((x) => x.id === imuId);
      if (!target) return;
      target.skeletonNode = e.target.value;
    });

    removeBtn?.addEventListener("click", () => {
      if (state.imus.length === 1 || confirm(`Remove "${imu.label}"?`)) removeImu(imuId);
    });

    const openPicker = () => fileInput?.click();
    drop?.addEventListener("click", () => openPicker());

    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".csv")) {
        alert("Please select a CSV file.");
        fileInput.value = "";
        return;
      }

      try {
        const csvText = await file.text();
        updateImu(imuId, { file, csvText });
      } catch {
        alert("Failed to read CSV file.");
        fileInput.value = "";
      }
    });

    let depth = 0;

    drop?.addEventListener("dragenter", (e) => {
      e.preventDefault();
      depth++;
      drop.classList.add("is-dragover");
    });

    drop?.addEventListener("dragover", (e) => e.preventDefault());

    drop?.addEventListener("dragleave", (e) => {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) drop.classList.remove("is-dragover");
    });

    drop?.addEventListener("drop", async (e) => {
      e.preventDefault();
      depth = 0;
      drop.classList.remove("is-dragover");

      const file = e.dataTransfer.files?.[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".csv")) {
        alert("Please drop a CSV file.");
        return;
      }

      try {
        const csvText = await file.text();
        updateImu(imuId, { file, csvText });
      } catch {
        alert("Failed to read CSV file.");
      }
    });
  }

  // =========================================
  // Reset
  // =========================================
  function resetAll() {
    const nameEl = qs("sessionName");
    const notesEl = qs("sessionNotes");
    if (nameEl) nameEl.value = "";
    if (notesEl) notesEl.value = "";

    clearVideoPreview();

    state.imus = [];
    state.nextImuId = 1;
    renderImus();

    clearMsg();

    syncSummary();
    syncButtons();
  }

  // =========================================
  // Save session
  // =========================================
  async function saveSession() {
    if (!hasSomethingToSave()) {
      setMsg(readyMessage());
      return;
    }

    window.MoveSync = window.MoveSync || {};
    window.MoveSync.runtime = window.MoveSync.runtime || {};
    window.MoveSync.runtime.sessionViewer = window.MoveSync.runtime.sessionViewer || {};

    const runtime = window.MoveSync.runtime.sessionViewer;
    runtime.sessions = runtime.sessions || [];
    runtime.nextSessionId = runtime.nextSessionId || 1;

    const id = runtime.nextSessionId++;
    const name = (qs("sessionName")?.value || "").trim() || "Untitled session";
    const notes = (qs("sessionNotes")?.value || "").trim();

    const session = {
      id,
      name,
      notes,
      createdAt: new Date().toISOString(),
      videoFile: state.video || null,
      imus: state.imus.map((imu) => ({ ...imu })),

      // Viewer compatibility (first IMU)
      csvName: state.imus[0]?.file?.name || "",
      csvText: state.imus[0]?.csvText || "",
      imuFile: state.imus[0]?.file || null,
      imuText: state.imus[0]?.csvText || "",
    };

    if (window.MoveSyncSessionStore?.saveRuntimeSession) {
      try {
        await window.MoveSyncSessionStore.saveRuntimeSession(session);
      } catch (e) {
        console.warn("[session-store] save failed:", e);
      }
    }

    runtime.sessions.push(session);
    document.dispatchEvent(new CustomEvent("movesync:sessions-changed", { detail: { at: Date.now() } }));

    runtime.activeSession = session;
    document.dispatchEvent(
      new CustomEvent("movesync:active-session-changed", { detail: { session, at: Date.now() } })
    );

    setMsg(`Saved session #${id}.`);

    resetAll();
  }

  // =========================================
  // Init / destroy
  // =========================================
  function init() {
    qs("resetBtn")?.addEventListener("click", resetAll);
    qs("addImuBtn")?.addEventListener("click", addImu);

    qs("sessionName")?.addEventListener("input", () => {
      syncSummary();
      syncButtons();
    });
    qs("sessionNotes")?.addEventListener("input", () => {
      syncSummary();
      syncButtons();
    });

    wireVideo();
    qs("saveSessionBtn")?.addEventListener("click", saveSession);

    renderImus();
    syncSummary();
    syncButtons();
    clearMsg();
  }

  function destroy() {
    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
    state = {
      video: null,
      videoObjectUrl: null,
      imus: [],
      nextImuId: 1,
    };
  }

  window.MoveSyncPages[PAGE_NAME] = { init, destroy };
})();