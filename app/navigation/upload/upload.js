// =======================================
// MoveSync: Upload (Projects + Sessions)
// File: app/navigation/upload/upload.js
// =======================================

(() => {
  "use strict";

  window.MoveSyncPages = window.MoveSyncPages || {};
  const PAGE_NAME = "Upload";

  // -------------------------
  // State
  // -------------------------
  let state = {
    // current session draft
    video: null,
    videoObjectUrl: null,
    imus: [],
    nextImuId: 1,
    activeImuId: null,

    // project draft
    project: {
      name: "",
      notes: "",
      sessions: [],
      nextSessionId: 1,
      createdAt: null,
      updatedAt: null,
    },
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

  function store() {
    return window.MoveSyncSessionStore || null;
  }

  // -------------------------
  // Validation
  // -------------------------
  function imusValid() {
    if (state.imus.length === 0) return true;
    return state.imus.every((imu) => !!imu.file);
  }

  function sessionHasSomethingToSave() {
    const hasVideo = !!state.video;
    const hasImu = state.imus.length > 0;
    const imuOk = imusValid();
    return hasVideo || (hasImu && imuOk);
  }

  function sessionReadyMessage() {
    const hasVideo = !!state.video;
    const hasImu = state.imus.length > 0;
    const imuOk = imusValid();

    if (!hasVideo && !hasImu) return "Upload a video or add at least one IMU CSV to add a session.";
    if (hasImu && !imuOk) return "All added IMU sensors must have a CSV file.";
    if (hasVideo && !hasImu) return "Ready: video-only session draft.";
    if (!hasVideo && hasImu && imuOk) return "Ready: IMU-only session draft.";
    return "Ready: video + IMU session draft.";
  }

  function projectReadyMessage() {
    const n = state.project.sessions.length;
    if (n <= 0) return "Add at least 1 session to save the project.";
    return `Ready to save project with ${n} session${n === 1 ? "" : "s"}.`;
  }

  // -------------------------
  // Summary sync (right card)
  // -------------------------
  function syncProjectSummary() {
    setText("sumSessions", String(state.project.sessions.length));

    const last = state.project.sessions[state.project.sessions.length - 1] || null;
    setText("sumDraft", last ? last.name : "—");

    setText("projectReadyLine", projectReadyMessage());
  }

  function syncButtons() {
    const addSessionBtn = qs("addSessionBtn");
    if (addSessionBtn) addSessionBtn.disabled = !sessionHasSomethingToSave();

    const saveProjectBtn = qs("saveProjectBtn");
    if (saveProjectBtn) saveProjectBtn.disabled = state.project.sessions.length === 0;

    setHint(sessionReadyMessage());
  }

  // -------------------------
  // Project sessions list render
  // -------------------------
  function renderProjectSessions() {
    const list = qs("projectSessionsList");
    const empty = qs("projectSessionsEmpty");
    if (!list || !empty) return;

    const sessions = state.project.sessions;

    if (!sessions.length) {
      list.innerHTML = "";
      empty.style.display = "block";
      return;
    }

    empty.style.display = "none";

    list.innerHTML = sessions
      .map((s) => {
        const v = s.videoFile?.name ? escapeHtml(s.videoFile.name) : "—";
        const imuCount = Array.isArray(s.imuFiles) ? s.imuFiles.length : 0;

        return `
          <div class="uw-proj-session" data-session-id="${escapeHtml(String(s.id))}">
            <div class="uw-proj-session-top">
              <div class="uw-proj-session-title">#${escapeHtml(String(s.id))} — ${escapeHtml(s.name || "Untitled session")}</div>
              <button class="uw-mini-btn uw-mini-btn-danger" type="button" data-action="remove-session" title="Remove session">
                <i class="bx bx-trash" aria-hidden="true"></i>
              </button>
            </div>

            <div class="uw-proj-session-meta">
              <span class="uw-proj-pill"><i class="bx bx-video" aria-hidden="true"></i> ${v}</span>
              <span class="uw-proj-pill"><i class="bx bx-chip" aria-hidden="true"></i> IMUs: ${escapeHtml(String(imuCount))}</span>
            </div>
            ${s.notes ? `<div class="uw-proj-session-notes">${escapeHtml(s.notes)}</div>` : ``}
          </div>
        `;
      })
      .join("");

    // delegate remove
    list.querySelectorAll('[data-action="remove-session"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const card = e.target.closest(".uw-proj-session");
        const id = card?.getAttribute("data-session-id");
        if (!id) return;

        state.project.sessions = state.project.sessions.filter((x) => String(x.id) !== String(id));
        syncProjectSummary();
        renderProjectSessions();
        syncButtons();
      });
    });
  }

  // -------------------------
  // Video
  // -------------------------
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
      syncButtons();
    });

    qs("clearVideoBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      clearVideoPreview();
    });

    setVideoEmpty(true);
  }

  // -------------------------
  // IMU (Tabbed)
  // -------------------------
  const generateImuId = () => `imu_${state.nextImuId++}`;

  function updateImuCount() {
    const count = state.imus.length;
    setText("imuCount", `${count} sensor${count === 1 ? "" : "s"}`);
  }

  function setActiveImu(id) {
    if (!id) return;
    if (!state.imus.some((x) => x.id === id)) return;
    state.activeImuId = id;
    renderImus();
    syncButtons();
  }

  function ensureActiveImu() {
    if (state.imus.length === 0) {
      state.activeImuId = null;
      return;
    }

    if (state.activeImuId && state.imus.some((x) => x.id === state.activeImuId)) return;
    state.activeImuId = state.imus[0].id;
  }

  function addImu() {
    const id = generateImuId();
    state.imus.push({
      id,
      label: `IMU ${state.imus.length + 1}`,
      file: null,
      csvText: "",
      skeletonNode: "",
    });

    state.activeImuId = id;

    renderImus();
    syncButtons();
  }

  function removeImu(id) {
    const idx = state.imus.findIndex((x) => x.id === id);
    if (idx === -1) return;

    const wasActive = state.activeImuId === id;
    state.imus.splice(idx, 1);

    state.imus.forEach((imu, i) => {
      if (!imu.file && (!imu.label || imu.label.startsWith("IMU "))) imu.label = `IMU ${i + 1}`;
    });

    if (state.imus.length === 0) {
      state.activeImuId = null;
    } else if (wasActive) {
      const newIdx = Math.min(idx, state.imus.length - 1);
      state.activeImuId = state.imus[newIdx].id;
    }

    renderImus();
    syncButtons();
  }

  function updateImu(id, patch) {
    const imu = state.imus.find((x) => x.id === id);
    if (!imu) return;
    Object.assign(imu, patch);

    renderImus();
    syncButtons();
  }

  function renderImus() {
    const container = qs("imuSlotsContainer");
    const empty = qs("imuEmptyState");
    const tabs = qs("imuTabs");
    const panel = qs("imuActivePanel");
    if (!container || !tabs || !panel) return;

    updateImuCount();

    if (state.imus.length === 0) {
      if (empty) empty.hidden = false;
      tabs.hidden = true;
      panel.hidden = true;
      tabs.innerHTML = "";
      panel.innerHTML = "";
      return;
    }

    if (empty) empty.hidden = true;

    ensureActiveImu();

    tabs.hidden = false;
    panel.hidden = false;

    tabs.innerHTML = state.imus
      .map((imu, i) => {
        const active = imu.id === state.activeImuId;
        const hasFile = !!imu.file;
        const label = imu.label || `IMU ${i + 1}`;
        return `
          <button
            class="uw-imu-tab"
            type="button"
            role="tab"
            aria-selected="${active ? "true" : "false"}"
            aria-controls="imuPanel_${escapeHtml(imu.id)}"
            id="imuTab_${escapeHtml(imu.id)}"
            data-imu-tab="${escapeHtml(imu.id)}"
            title="${escapeHtml(label)}"
          >
            <span>${escapeHtml(label)}</span>
            <span class="uw-imu-tab-badge ${hasFile ? "" : "is-missing"}" title="${
              hasFile ? "CSV selected" : "CSV missing"
            }">
              ${hasFile ? "CSV" : "Missing"}
            </span>
          </button>
        `;
      })
      .join("");

    tabs.querySelectorAll("[data-imu-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-imu-tab");
        setActiveImu(id);
      });
    });

    const activeImu = state.imus.find((x) => x.id === state.activeImuId) || state.imus[0];
    panel.innerHTML = `<div class="uw-sensor" data-imu-id="${escapeHtml(activeImu.id)}"></div>`;
    const card = panel.querySelector(".uw-sensor");
    updateImuCardContent(card, activeImu);
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

      renderImus();
    });

    nodeSelect?.addEventListener("change", (e) => {
      const target = state.imus.find((x) => x.id === imuId);
      if (!target) return;
      target.skeletonNode = e.target.value;
    });

    removeBtn?.addEventListener("click", () => {
      removeImu(imuId);
    });

    const openPicker = () => fileInput?.click();
    drop?.addEventListener("click", () => openPicker());

    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".csv")) {
        setMsg("Please select a CSV file.");
        fileInput.value = "";
        return;
      }

      try {
        const csvText = await file.text();
        updateImu(imuId, { file, csvText });
      } catch {
        setMsg("Failed to read CSV file.");
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
        setMsg("Please drop a CSV file.");
        return;
      }

      try {
        const csvText = await file.text();
        updateImu(imuId, { file, csvText });
      } catch {
        setMsg("Failed to read CSV file.");
      }
    });
  }

  // -------------------------
  // Reset helpers
  // -------------------------
  function resetSessionDraft() {
    clearVideoPreview();

    // session metadata
    const sn = qs("sessionName");
    if (sn) sn.value = "";
    const snotes = qs("sessionNotes");
    if (snotes) snotes.value = "";

    // reset preset picker
    const psel = qs("sessionPresetSelect");
    if (psel) psel.value = "";
    updatePresetPreview();

    state.imus = [];
    state.nextImuId = 1;
    state.activeImuId = null;
    renderImus();

    clearMsg();
    syncButtons();
  }

  function resetProjectDraft() {
    qs("projectName").value = "";
    qs("projectNotes").value = "";

    state.project = {
      name: "",
      notes: "",
      sessions: [],
      nextSessionId: 1,
      createdAt: null,
      updatedAt: null,
    };

    resetSessionDraft();
    syncProjectSummary();
    renderProjectSessions();
    syncButtons();
  }

  // -------------------------
  // Build session object (for project)
  // -------------------------
  function buildSessionFromDraft() {
  const id = state.project.nextSessionId++;

  const nameInput = (qs("sessionName")?.value || "").trim();
  const notesInput = (qs("sessionNotes")?.value || "").trim();

  const name = nameInput || `Session ${id}`;
  const notes = notesInput || "";

  const imuFiles = state.imus.map((imu) => imu.file).filter(Boolean);

  // Resolve selected preset
  const presetId = qs("sessionPresetSelect")?.value || "";
  const preset = getPresetById(presetId);

  return {
    id,
    name,
    notes,
    createdAt: new Date().toISOString(),
    videoFile: state.video || null,
    imus: state.imus.map((imu) => ({ ...imu })),
    imuFiles,

    // Preset / metrics
    presetId: preset?.id || null,
    presetName: preset?.name || null,
    keyMetrics: Array.isArray(preset?.metrics) ? preset.metrics.slice() : [],

    // Viewer compatibility (first IMU)
    csvName: state.imus[0]?.file?.name || "",
    csvText: state.imus[0]?.csvText || "",
    imuFile: state.imus[0]?.file || null,
    imuText: state.imus[0]?.csvText || "",
  };
}


  // -------------------------
  // Add session to project
  // -------------------------
  function addSessionToProject() {
    if (!sessionHasSomethingToSave()) {
      setMsg(sessionReadyMessage());
      return;
    }

    const sess = buildSessionFromDraft();
    state.project.sessions.push(sess);

    setMsg(`Added ${sess.name} to project.`);
    resetSessionDraft();

    syncProjectSummary();
    renderProjectSessions();
    syncButtons();
  }

  // -------------------------
  // Save project to library
  // -------------------------
  async function saveProject() {
    const s = store();
    if (!s?.saveRuntimeProject) {
      setMsg("Project store not available.");
      return;
    }

    // pull latest inputs
    state.project.name = (qs("projectName")?.value || "").trim() || "Untitled project";
    state.project.notes = (qs("projectNotes")?.value || "").trim();

    if (state.project.sessions.length === 0) {
      setMsg("Add at least one session before saving.");
      return;
    }

    const now = new Date().toISOString();
    state.project.createdAt = state.project.createdAt || now;
    state.project.updatedAt = now;

    // store will assign id
    const projectToSave = {
      name: state.project.name,
      notes: state.project.notes,
      createdAt: state.project.createdAt,
      updatedAt: state.project.updatedAt,
      sessions: state.project.sessions,
    };

    try {
      const saved = await s.saveRuntimeProject(projectToSave);

      // select last added session as active (optional)
      const last = saved?.sessions?.[saved.sessions.length - 1] || null;
      if (last) s.setActiveSession?.(saved.id, last.id);

      setMsg(`Saved project "${state.project.name}".`);
      resetProjectDraft();
      document.dispatchEvent(new CustomEvent("movesync:projects-changed", { detail: { at: Date.now() } }));
    } catch (e) {
      console.warn("[Upload] save project failed:", e);
      setMsg("Failed to save project.");
    }
  }

  // -------------------------
  // Import / Export (draft structure)
  // Note: Files cannot be preserved in JSON.
  // This is meant for importing project structure (session names/notes).
  // -------------------------
  function exportDraft() {
    const name = (qs("projectName")?.value || "").trim() || state.project.name || "Untitled project";
    const notes = (qs("projectNotes")?.value || "").trim() || state.project.notes || "";

    const draft = {
      format: "movesync-project-draft-v1",
      name,
      notes,
      sessions: state.project.sessions.map((sess) => ({
        id: sess.id,
        name: sess.name,
        notes: sess.notes || "",
        createdAt: sess.createdAt,
        // only filenames (not binaries)
        videoName: sess.videoFile?.name || "",
        imuNames: (sess.imuFiles || []).map((f) => f?.name || "").filter(Boolean),
      })),
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `movesync-project-draft-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setMsg("Exported draft (structure only).");
  }

  async function importDraftFromFile(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON");
      if (parsed.format !== "movesync-project-draft-v1") {
        setMsg("Import failed: unsupported file format.");
        return;
      }

      const importedName = String(parsed.name || "Imported project");
      const importedNotes = String(parsed.notes || "");

      // wipe current draft
      state.project = {
        name: importedName,
        notes: importedNotes,
        sessions: [],
        nextSessionId: 1,
        createdAt: null,
        updatedAt: null,
      };

      qs("projectName").value = importedName;
      qs("projectNotes").value = importedNotes;

      const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      sessions.forEach((s) => {
        const id = state.project.nextSessionId++;
        state.project.sessions.push({
          id,
          name: String(s?.name || `Session ${id}`),
          notes: String(s?.notes || ""),
          createdAt: s?.createdAt || new Date().toISOString(),
          videoFile: null,
          imus: [],
          imuFiles: [],

          // viewer compatibility
          csvName: "",
          csvText: "",
          imuFile: null,
          imuText: "",
        });
      });

      resetSessionDraft();
      syncProjectSummary();
      renderProjectSessions();
      syncButtons();

      setMsg("Imported draft structure. Re-attach files in the session draft, then add sessions again (or keep imported placeholders).");
    } catch (e) {
      console.warn("[Upload] import failed:", e);
      setMsg("Import failed: invalid JSON.");
    }
  }

  // -------------------------
  // Preset helpers
  // -------------------------
  const PRESETS_STORAGE_KEY = "movesync-sport-presets-v1";

  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function getPresetById(id) {
    if (!id) return null;
    return loadPresets().find((p) => String(p.id) === String(id)) || null;
  }

  function populatePresetDropdown() {
    const sel = qs("sessionPresetSelect");
    if (!sel) return;

    const presets = loadPresets();
    const currentVal = sel.value;

    // Rebuild options
    sel.innerHTML = `<option value="">None — no key metrics</option>`;
    for (const p of presets) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name + (p.metrics?.length ? ` (${p.metrics.length} metrics)` : "");
      sel.appendChild(opt);
    }

    // Restore previous value if still valid
    if (currentVal && presets.some((p) => String(p.id) === currentVal)) {
      sel.value = currentVal;
    }
  }

  function updatePresetPreview() {
    const sel = qs("sessionPresetSelect");
    const preview = qs("sessionPresetPreview");
    const pills = qs("sessionPresetPills");
    if (!sel || !preview || !pills) return;

    const preset = getPresetById(sel.value);
    const metrics = window.MoveSyncMetrics || [];

    if (!preset || !preset.metrics?.length) {
      preview.hidden = true;
      pills.innerHTML = "";
      return;
    }

    preview.hidden = false;
    pills.innerHTML = preset.metrics.map((id) => {
      const meta = metrics.find((m) => m.id === id);
      const label = meta?.label || id;
      return `<span class="uw-metric-pill">${label}</span>`;
    }).join("");
  }

  // -------------------------
  // Init / destroy
  // -------------------------
  function init() {
    // project inputs
    qs("projectName")?.addEventListener("input", () => {
      state.project.name = (qs("projectName")?.value || "").trim();
      syncProjectSummary();
    });

    qs("projectNotes")?.addEventListener("input", () => {
      state.project.notes = (qs("projectNotes")?.value || "").trim();
    });

    // buttons
    qs("resetSessionBtn")?.addEventListener("click", resetSessionDraft);

    // Preset dropdown
    populatePresetDropdown();
    qs("sessionPresetSelect")?.addEventListener("change", updatePresetPreview);
    qs("addSessionBtn")?.addEventListener("click", addSessionToProject);
    qs("resetProjectBtn")?.addEventListener("click", resetProjectDraft);
    qs("saveProjectBtn")?.addEventListener("click", saveProject);

    // import/export
    qs("exportDraftBtn")?.addEventListener("click", exportDraft);

    const importInput = qs("importProjectInput");
    qs("importProjectBtn")?.addEventListener("click", () => importInput?.click());
    importInput?.addEventListener("change", async () => {
      const f = importInput.files?.[0];
      importInput.value = "";
      await importDraftFromFile(f);
    });

    // session draft
    qs("addImuBtn")?.addEventListener("click", addImu);
    wireVideo();
    renderImus();

    // initial
    clearMsg();
    syncProjectSummary();
    renderProjectSessions();
    syncButtons();
    setHint(sessionReadyMessage());
  }

  function destroy() {
    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);

    state = {
      video: null,
      videoObjectUrl: null,
      imus: [],
      nextImuId: 1,
      activeImuId: null,
      project: { name: "", notes: "", sessions: [], nextSessionId: 1, createdAt: null, updatedAt: null },
    };
  }

  window.MoveSyncPages[PAGE_NAME] = { init, destroy };
})();