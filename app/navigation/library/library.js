// =======================================
// MoveSync: Library (Projects + Sessions)
// File: app/navigation/library/library.js
//
// Updated:
// - Removed empty-state "New project" button
// - Compact row-style cards (controls + notes on the right)
// - Import completes silently (no "Imported project..." popups)
// =======================================

(() => {
  const PAGE_NAME = "Library";
  const $ = (id) => document.getElementById(id);

  let controller = null;

  // ✅ Multi-select state
  const selectedProjectIds = new Set();

  // ===== Export limits =====
  const MAX_VIDEO_BYTES = 30 * 1024 * 1024; // 30 MB
  const MAX_IMU_CSV_BYTES = 5 * 1024 * 1024; // 5 MB per CSV

  function store() {
    return window.MoveSyncSessionStore || null;
  }

  function getProjects() {
    const s = store();
    return s?.getProjects?.() || [];
  }

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return "";
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderCount(n) {
    const el = $("libCount");
    if (el) el.textContent = `${n} project${n === 1 ? "" : "s"}`;
  }

  function updateSelectedUi() {
    const n = selectedProjectIds.size;

    const btn = $("libExportBtn");
    if (btn) {
      btn.disabled = n === 0;
      btn.innerHTML = `<i class="bx bx-export" aria-hidden="true"></i> Export selected (${n})`;
      btn.title = n ? `Export ${n} selected project${n === 1 ? "" : "s"} as ZIP` : "Export selected projects";
    }

    const pill = $("libSelectedCount");
    if (pill) {
      if (n === 0) {
        pill.hidden = true;
      } else {
        pill.hidden = false;
        pill.textContent = `${n} selected`;
      }
    }
  }

  function normalizeSortKey(v) {
    return String(v ?? "").toLowerCase();
  }

  function projectToSearchText(p) {
    const sessions = Array.isArray(p.sessions) ? p.sessions : [];
    const sessionBits = sessions.flatMap((s) => {
      const imuNames = (Array.isArray(s.imuFiles) ? s.imuFiles : [])
        .map((f) => f?.name || "")
        .filter(Boolean);
      const v = s.videoFile?.name || "";
      return [s.name || "", s.notes || "", v, ...imuNames];
    });

    return [
      p.name || "",
      p.notes || "",
      p.id ?? "",
      fmtDate(p.createdAt || ""),
      fmtDate(p.updatedAt || ""),
      ...sessionBits,
    ]
      .join(" ")
      .toLowerCase();
  }

  function sortProjects(projects) {
    const key = $("libSortSelect")?.value || "date_desc";
    const arr = projects.slice();

    const byDate = (a, b) => {
      const da = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const db = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return da - db;
    };

    const byName = (a, b) => normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
    const bySessions = (a, b) => (a.sessions?.length || 0) - (b.sessions?.length || 0);

    switch (key) {
      case "date_asc":
        return arr.sort(byDate);
      case "date_desc":
        return arr.sort((a, b) => byDate(b, a));
      case "name_desc":
        return arr.sort((a, b) => byName(b, a));
      case "name_asc":
        return arr.sort(byName);
      case "sessions_asc":
        return arr.sort(bySessions);
      case "sessions_desc":
        return arr.sort((a, b) => bySessions(b, a));
      default:
        return arr.sort((a, b) => byDate(b, a));
    }
  }

  // ✅ safe DOM id helper
  function safeDomId(prefix, raw) {
    const s = String(raw ?? "");
    const cleaned = s.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${prefix}${cleaned || "x"}`;
  }

  function isChecked(projectId) {
    return selectedProjectIds.has(String(projectId));
  }

  function setChecked(projectId, checked) {
    const id = String(projectId);
    if (checked) selectedProjectIds.add(id);
    else selectedProjectIds.delete(id);
    updateSelectedUi();
  }

  function toggleChecked(projectId) {
    const id = String(projectId);
    if (selectedProjectIds.has(id)) selectedProjectIds.delete(id);
    else selectedProjectIds.add(id);
    updateSelectedUi();
  }

  function renderList(projects) {
    const list = $("libList");
    const empty = $("libEmpty");
    if (!list || !empty) return;

    if (!projects.length) {
      list.innerHTML = "";
      empty.hidden = false;
      renderCount(0);
      updateSelectedUi();
      return;
    }

    empty.hidden = true;
    renderCount(projects.length);

    list.innerHTML = projects
      .map((p) => {
        const pidRaw = p.id;
        const pidText = escapeHtml(String(pidRaw ?? "—"));
        const title = escapeHtml(p.name || "Untitled project");
        const notes = escapeHtml(p.notes || "");
        const created = escapeHtml(fmtDate(p.updatedAt || p.createdAt) || "");

        const sessions = Array.isArray(p.sessions) ? p.sessions : [];
        const sessionCount = sessions.length;

        const toggleDisabled = sessionCount ? "" : "disabled";
        const panelId = safeDomId("sessList-", pidRaw);

        const checked = isChecked(pidRaw);
        const isSelectedClass = checked ? "is-selected" : "";
        const cbId = safeDomId("libCheck-", pidRaw);

        const sessListHtml = sessionCount
          ? sessions
              .map((s) => {
                const sid = escapeHtml(String(s.id ?? ""));
                const sname = escapeHtml(s.name || `Session ${sid}`);
                const v = escapeHtml(s.videoFile?.name || "—");
                const imuCount = Array.isArray(s.imuFiles) ? s.imuFiles.length : 0;
                const createdSess = escapeHtml(fmtDate(s.createdAt) || "");

                return `
              <div class="lib-session" data-session-id="${sid}">
                <div class="lib-session-top">
                  <div class="lib-session-title">#${sid} — ${sname}</div>
                  <div class="lib-mini-actions">
                    <button class="lib-mini-btn" type="button" data-action="view-session">
                      <i class="bx bx-video" aria-hidden="true"></i> View
                    </button>
                  </div>
                </div>

                <div class="lib-session-meta">
                  <span class="lib-chip"><i class="bx bx-calendar" aria-hidden="true"></i> ${createdSess}</span>
                  <span class="lib-chip"><i class="bx bx-video" aria-hidden="true"></i> ${v}</span>
                  <span class="lib-chip"><i class="bx bx-chip" aria-hidden="true"></i> IMUs: ${escapeHtml(
                    String(imuCount)
                  )}</span>
                </div>
              </div>
            `;
              })
              .join("")
          : `<div style="opacity:.75; font-size:13px; color:var(--text-color);">No sessions</div>`;

        const notesHtml = notes
          ? `<div class="lib-card-notesRight" title="${notes}">${notes}</div>`
          : `<div class="lib-card-notesRight" style="opacity:.55" title="No notes">No notes</div>`;

        const sessBtnLabel = sessionCount ? `Sessions (${sessionCount})` : `Sessions (0)`;

        return `
        <article class="lib-card ${isSelectedClass}" data-project-id="${String(pidRaw)}">
          <div class="lib-card-main">
            <label class="lib-check" title="Select project">
              <input
                id="${cbId}"
                class="lib-card-check"
                type="checkbox"
                data-action="select-project"
                ${checked ? "checked" : ""}
                aria-label="Select project ${pidText}"
              />
            </label>

            <div class="lib-card-titleWrap">
              <h3 class="lib-card-title">#${pidText} — ${title}</h3>
              <div class="lib-card-sub">${created}</div>
            </div>
          </div>

          <div class="lib-card-right">
            ${notesHtml}

            <div class="lib-card-actionsRow">
              <button class="lib-mini-btn" type="button" data-action="toggle-sessions" ${toggleDisabled}
                aria-expanded="false" aria-controls="${panelId}" title="Show/hide sessions">
                <i class="bx bx-collection" aria-hidden="true"></i> ${sessBtnLabel}
              </button>

              <button class="lib-mini-btn" type="button" data-action="export-project" title="Export project as JSON (includes files if possible)">
                <i class="bx bx-export" aria-hidden="true"></i> Export
              </button>

              <button class="lib-mini-btn lib-mini-danger" type="button" data-action="delete-project" title="Delete project">
                <i class="bx bx-trash" aria-hidden="true"></i> Delete
              </button>
            </div>
          </div>

          <div class="lib-panel" id="${panelId}" hidden>
            <div class="lib-sessions">
              ${sessListHtml}
            </div>
          </div>
        </article>
      `;
      })
      .join("");

    updateSelectedUi();
  }

  function applyFilterSortAndRender() {
    const q = ($("libSearchInput")?.value || "").trim().toLowerCase();
    const projects = getProjects();

    const filtered = !q ? projects : projects.filter((p) => projectToSearchText(p).includes(q));
    const sorted = sortProjects(filtered);

    // If some selected ids no longer exist (deleted), drop them
    const existingIds = new Set(getProjects().map((p) => String(p.id)));
    for (const id of [...selectedProjectIds]) {
      if (!existingIds.has(String(id))) selectedProjectIds.delete(String(id));
    }

    renderList(sorted);
  }

  async function deleteProject(projectId) {
    const s = store();
    if (!s?.deleteProject) return;

    await s.deleteProject(projectId);

    // ✅ clear selection if deleted
    selectedProjectIds.delete(String(projectId));
    updateSelectedUi();

    applyFilterSortAndRender();
  }

  async function clearAll() {
    const s = store();
    if (!s?.getProjects || !s?.deleteProject) return;

    const projects = s.getProjects();
    if (!projects.length) return;

    const ok = confirm("Delete all projects?");
    if (!ok) return;

    for (const p of [...projects]) {
      await s.deleteProject(p.id);
    }

    selectedProjectIds.clear();
    updateSelectedUi();
    applyFilterSortAndRender();
  }

  function setActiveSession(projectId, sessionId) {
    const s = store();
    s?.setActiveSession?.(projectId, sessionId);
  }

  function toggleSessionsPanel(card, btn) {
    const panel = card?.querySelector(".lib-panel");
    if (!panel) return;

    const isHidden = panel.hidden;
    panel.hidden = !isHidden;

    btn.setAttribute("aria-expanded", String(isHidden));
  }

  // ================================
  // File helpers for v2 export/import
  // ================================
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read blob"));
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const comma = dataUrl.indexOf(",");
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
      };
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(base64, mime) {
    const bin = atob(base64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || "application/octet-stream" });
  }

  // ================================
  // ✅ Build export payload (used by single export + zip export)
  // ================================
  async function buildProjectExportPayload(project) {
    const sessions = Array.isArray(project.sessions) ? project.sessions : [];

    const exportedSessions = [];
    let videoOmittedCount = 0;
    let imuOmittedCount = 0;

    for (const s of sessions) {
      // video
      let video = null;
      const vf = s.videoFile || null;

      if (vf && vf.size <= MAX_VIDEO_BYTES) {
        try {
          const base64 = await blobToBase64(vf);
          video = { name: vf.name, type: vf.type || "video/mp4", size: vf.size, base64 };
        } catch {
          video = null;
          videoOmittedCount++;
        }
      } else if (vf) {
        videoOmittedCount++;
      }

      // imus
      const imuFiles = Array.isArray(s.imuFiles) ? s.imuFiles : [];
      const imus = [];

      for (const f of imuFiles) {
        if (!f) continue;

        if (f.size > MAX_IMU_CSV_BYTES) {
          imuOmittedCount++;
          imus.push({
            name: f.name,
            type: f.type || "text/csv",
            size: f.size,
            omitted: true,
          });
          continue;
        }

        try {
          const text = await f.text();
          imus.push({
            name: f.name,
            type: f.type || "text/csv",
            size: f.size,
            text,
          });
        } catch {
          imuOmittedCount++;
          imus.push({
            name: f.name,
            type: f.type || "text/csv",
            size: f.size,
            omitted: true,
          });
        }
      }

      exportedSessions.push({
        id: s.id,
        name: s.name,
        notes: s.notes || "",
        createdAt: s.createdAt || "",
        assets: { video, imus },
      });
    }

    const payload = {
      format: "movesync-project-export-v2",
      limits: { MAX_VIDEO_BYTES, MAX_IMU_CSV_BYTES },
      project: {
        id: project.id,
        name: project.name,
        notes: project.notes,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        sessions: exportedSessions,
      },
      exportedAt: new Date().toISOString(),
      warnings: {
        videoOmittedCount,
        imuOmittedCount,
      },
    };

    return payload;
  }

  // ================================
  // Export (single project) - downloads one JSON file
  // ================================
  async function exportProject(project) {
    const payload = await buildProjectExportPayload(project);

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `movesync-project-${project.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const v = payload.warnings?.videoOmittedCount || 0;
    const i = payload.warnings?.imuOmittedCount || 0;
    if (v || i) {
      alert(
        `Export complete.\n\nNote:\n- Video omitted: ${v} (over size limit or read error)\n- IMU CSV omitted: ${i} (over size limit or read error)`
      );
    }
  }

  // ================================
  // ✅ Export selected projects into ONE ZIP
  // ================================
  function getJsZip() {
    // JSZip attaches itself to window.JSZip
    return window.JSZip || null;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function sanitizeFilename(name) {
    return String(name || "")
      .trim()
      .replace(/[\/\\:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .slice(0, 80);
  }

  async function exportSelectedProjectsZip() {
    const JSZip = getJsZip();
    if (!JSZip) {
      alert("ZIP export requires JSZip. Make sure the JSZip script is included on this page.");
      return;
    }

    const ids = [...selectedProjectIds].map(String);
    if (!ids.length) {
      alert("Select one or more projects first, then click Export.");
      return;
    }

    const projects = getProjects();
    const selected = ids
      .map((id) => projects.find((p) => String(p.id) === String(id)))
      .filter(Boolean);

    // Remove stale ids
    if (selected.length !== ids.length) {
      selectedProjectIds.clear();
      selected.forEach((p) => selectedProjectIds.add(String(p.id)));
      updateSelectedUi();
    }

    if (!selected.length) {
      alert("No selected projects were found (they may have been deleted).");
      return;
    }

    // Optional confirm for many downloads
    if (selected.length >= 5) {
      const ok = confirm(
        `Export ${selected.length} projects into a single ZIP?\n\nThis can be large if it includes videos.`
      );
      if (!ok) return;
    }

    const btn = $("libExportBtn");
    const prevLabel = btn?.innerHTML || "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="bx bx-loader-alt bx-spin" aria-hidden="true"></i> Exporting...`;
    }

    try {
      const zip = new JSZip();

      // Folder structure inside the zip (nice and clean)
      const root = zip.folder("movesync-projects");
      const metaFolder = root.folder("_meta");
      const projectsFolder = root.folder("projects");

      let totalVideoOmitted = 0;
      let totalImuOmitted = 0;

      // Add each project JSON
      for (const p of selected) {
        const payload = await buildProjectExportPayload(p);

        totalVideoOmitted += payload.warnings?.videoOmittedCount || 0;
        totalImuOmitted += payload.warnings?.imuOmittedCount || 0;

        const safeName = sanitizeFilename(p.name || `project-${p.id}`);
        const filename = `movesync-project-${p.id}__${safeName}.json`;

        projectsFolder.file(filename, JSON.stringify(payload, null, 2));
      }

      // Add a small manifest
      const manifest = {
        format: "movesync-projects-zip-v1",
        exportedAt: new Date().toISOString(),
        projectCount: selected.length,
        projects: selected.map((p) => ({ id: p.id, name: p.name || "", updatedAt: p.updatedAt || p.createdAt || "" })),
        warnings: {
          totalVideoOmitted,
          totalImuOmitted,
          note: "Omitted means the file was too large or failed to read and was not embedded in the JSON.",
        },
      };
      metaFolder.file("manifest.json", JSON.stringify(manifest, null, 2));

      // Generate zip blob
      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      const date = new Date();
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const zipName = `movesync-projects-${yyyy}-${mm}-${dd}.zip`;

      downloadBlob(zipBlob, zipName);

      if (totalVideoOmitted || totalImuOmitted) {
        alert(
          `ZIP export complete.\n\nNote:\n- Video omitted: ${totalVideoOmitted}\n- IMU CSV omitted: ${totalImuOmitted}\n\n(Those files were too large or couldn't be read and were not embedded.)`
        );
      }
    } catch (e) {
      console.warn("[Library] ZIP export failed:", e);
      alert("Export failed while generating ZIP.");
    } finally {
      if (btn) {
        btn.innerHTML =
          prevLabel || `<i class="bx bx-export" aria-hidden="true"></i> Export selected (${selectedProjectIds.size})`;
        btn.disabled = selectedProjectIds.size === 0;
        updateSelectedUi();
      }
    }
  }

  // ================================
  // Import - supports v2 (with files) + v1 + draft
  // ================================
  async function importProjectFile(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON");

      const s = store();
      if (!s?.saveRuntimeProject) return;

      const now = new Date().toISOString();

      const isV2 = parsed.format === "movesync-project-export-v2" && parsed.project;
      const isV1 = parsed.format === "movesync-project-export-v1" && parsed.project;
      const isDraft = parsed.format === "movesync-project-draft-v1";

      let incoming = null;
      let restoreFiles = false;
      let missingFiles = false;

      if (isV2) {
        incoming = parsed.project;
        restoreFiles = true;
      } else if (isV1) {
        incoming = parsed.project;
        restoreFiles = false;
        missingFiles = true;
      } else if (isDraft) {
        incoming = {
          name: parsed.name,
          notes: parsed.notes,
          createdAt: parsed.exportedAt || now,
          updatedAt: parsed.exportedAt || now,
          sessions: (parsed.sessions || []).map((ss, i) => ({
            id: ss.id ?? i + 1,
            name: ss.name || `Session ${i + 1}`,
            notes: ss.notes || "",
            createdAt: ss.createdAt || now,
          })),
        };
        restoreFiles = false;
        missingFiles = true;
      } else {
        const ok = confirm("This file is not a MoveSync export. Try importing anyway?");
        if (!ok) return;
        incoming = parsed.project || parsed;
        restoreFiles = false;
        missingFiles = true;
      }

      const sessionsIn = Array.isArray(incoming.sessions) ? incoming.sessions : [];

      const rebuiltSessions = sessionsIn.map((sess, idx) => {
        const sid = idx + 1;
        let videoFile = null;
        let imuFiles = [];
        let imus = [];

        if (restoreFiles && sess?.assets) {
          const v = sess.assets.video || null;
          if (v?.base64 && v?.name) {
            try {
              const blob = base64ToBlob(v.base64, v.type || "video/mp4");
              videoFile = new File([blob], v.name, { type: v.type || "video/mp4" });
            } catch {
              videoFile = null;
              missingFiles = true;
            }
          } else {
            if (sess.assets.video === null) missingFiles = true;
          }

          const imuAssets = Array.isArray(sess.assets.imus) ? sess.assets.imus : [];
          for (const ia of imuAssets) {
            if (ia?.text && ia?.name) {
              try {
                const blob = new Blob([ia.text], { type: ia.type || "text/csv" });
                const f = new File([blob], ia.name, { type: ia.type || "text/csv" });
                imuFiles.push(f);

                imus.push({
                  id: `imu_${imus.length + 1}`,
                  label: ia.name.replace(/\.csv$/i, "") || `IMU ${imus.length + 1}`,
                  file: f,
                  csvText: ia.text,
                  skeletonNode: "",
                });
              } catch {
                missingFiles = true;
              }
            } else {
              if (ia?.omitted) missingFiles = true;
            }
          }
        } else {
          missingFiles = true;
        }

        const firstImuText = imus[0]?.csvText || "";
        const firstImuFile = imus[0]?.file || null;

        return {
          id: sid,
          name: String(sess?.name || `Session ${sid}`),
          notes: String(sess?.notes || ""),
          createdAt: sess?.createdAt || now,

          videoFile: videoFile || null,
          imuFiles,
          imus,

          // viewer compatibility (first IMU)
          csvName: firstImuFile?.name || "",
          csvText: firstImuText,
          imuFile: firstImuFile,
          imuText: firstImuText,
        };
      });

      const projectToSave = {
        name: String(incoming.name || "Imported project"),
        notes: String(incoming.notes || ""),
        createdAt: incoming.createdAt || now,
        updatedAt: now,
        sessions: rebuiltSessions,
      };

      await s.saveRuntimeProject(projectToSave);

      document.dispatchEvent(new CustomEvent("movesync:projects-changed", { detail: { at: Date.now() } }));
      applyFilterSortAndRender();

      // ✅ NO success popups (silent import)
      // If you want an in-UI toast later, we can add a non-blocking status element.
      void missingFiles; // keep variable for potential future UI feedback
    } catch (e) {
      console.warn("[Library] import failed:", e);
      alert("Import failed: invalid JSON.");
    }
  }

  // ==========================================================
  // Card behavior + event wiring
  // ==========================================================
  function wireEvents() {
    $("libNewProjectBtn")?.addEventListener(
      "click",
      () => window.MoveSync?.goToPage?.("Upload"),
      { signal: controller.signal }
    );

    // ✅ Removed: libEmptyNewProject wiring (button no longer exists)

    $("libClearAll")?.addEventListener("click", clearAll, { signal: controller.signal });
    $("libSearchInput")?.addEventListener("input", applyFilterSortAndRender, { signal: controller.signal });
    $("libSortSelect")?.addEventListener("change", applyFilterSortAndRender, { signal: controller.signal });

    // ✅ Header export -> ZIP
    $("libExportBtn")?.addEventListener("click", exportSelectedProjectsZip, { signal: controller.signal });

    // Import
    const importInput = $("libImportInput");
    $("libImportBtn")?.addEventListener("click", () => importInput?.click(), { signal: controller.signal });
    importInput?.addEventListener(
      "change",
      async () => {
        const f = importInput.files?.[0];
        importInput.value = "";
        await importProjectFile(f);
      },
      { signal: controller.signal }
    );

    // Delegation on list
    $("libList")?.addEventListener(
      "click",
      async (e) => {
        const card = e.target.closest(".lib-card");
        const projectId = card?.dataset?.projectId;
        if (!card || !projectId) return;

        const actionBtn = e.target.closest("button[data-action], .btn[data-action]");
        if (actionBtn) {
          const action = actionBtn.dataset.action;

          if (action === "toggle-sessions") {
            if (actionBtn.disabled) return;
            toggleSessionsPanel(card, actionBtn);
            return;
          }

          if (action === "export-project") {
            const project = getProjects().find((p) => String(p.id) === String(projectId));
            if (project) await exportProject(project);
            return;
          }

          if (action === "delete-project") {
            const ok = confirm("Delete this project?");
            if (!ok) return;
            await deleteProject(projectId);
            return;
          }

          if (action === "view-session") {
            const sessionEl = e.target.closest(".lib-session");
            const sessionId = sessionEl?.dataset?.sessionId;
            if (!sessionId) return;

            setActiveSession(projectId, sessionId);
            window.MoveSync?.goToPage?.("Session Viewer");
            return;
          }

          return;
        }

        // Checkbox click
        const checkbox = e.target.closest("input[type='checkbox'][data-action='select-project']");
        if (checkbox) {
          setChecked(projectId, checkbox.checked);
          applyFilterSortAndRender();
          return;
        }

        // Click elsewhere on card toggles checkbox selection
        toggleChecked(projectId);
        applyFilterSortAndRender();
      },
      { signal: controller.signal }
    );

    $("libList")?.addEventListener(
      "change",
      (e) => {
        const checkbox = e.target.closest("input[type='checkbox'][data-action='select-project']");
        if (!checkbox) return;

        const card = checkbox.closest(".lib-card");
        const projectId = card?.dataset?.projectId;
        if (!projectId) return;

        setChecked(projectId, checkbox.checked);
        applyFilterSortAndRender();
      },
      { signal: controller.signal }
    );

    document.addEventListener("movesync:projects-changed", applyFilterSortAndRender, { signal: controller.signal });
  }

  async function init() {
    controller?.abort?.();
    controller = new AbortController();

    try {
      await store()?.hydrateRuntimeFromDb?.();
    } catch (e) {
      console.warn("[Library] hydrate failed:", e);
    }

    updateSelectedUi();

    wireEvents();
    applyFilterSortAndRender();
  }

  function destroy() {
    controller?.abort?.();
    controller = null;
  }

  window.MoveSyncPages = window.MoveSyncPages || {};
  window.MoveSyncPages[PAGE_NAME] = { init, destroy };
})();