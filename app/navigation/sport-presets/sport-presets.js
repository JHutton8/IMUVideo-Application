// =======================================
// MoveSync page module: Sport Presets
// File: app/navigation/sport-presets/sport-presets.js
//
// Functionality:
// - CRUD sport presets (create, edit, duplicate, delete)
// - Search/filter presets
// - Persist presets in localStorage (library of configurations)
// - Import/export JSON
// - Default presets seeded on first load
// =======================================

(() => {
  "use strict";

  window.MoveSyncPages = window.MoveSyncPages || {};
  const PAGE_NAME = "Sport Presets";

  // ---------------------------------------
  // Storage
  // ---------------------------------------
  const STORAGE_KEY = "movesync-sport-presets-v1";

  // Single-IMU computable metrics only.
  // Speed, distance, jump height and joint angles are excluded —
  // IMU double-integration drifts too badly for general motion,
  // and joint angles require a second sensor per joint.
  // Speed & distance use per-burst ZUPT integration — velocity resets to zero
  // at every confirmed-still window, so drift cannot compound across the session.
  const METRICS = [
    { id: "peak_accel",       label: "Peak acceleration",      unit: "G",    group: "Acceleration" },
    { id: "mean_accel",       label: "Mean acceleration",      unit: "G",    group: "Acceleration" },
    { id: "accel_rms",        label: "Acceleration RMS",       unit: "G",    group: "Acceleration" },
    { id: "peak_jerk",        label: "Peak jerk",              unit: "G/s",  group: "Acceleration" },
    { id: "peak_speed",       label: "Peak speed",             unit: "m/s",  group: "Speed & Distance" },
    { id: "mean_burst_speed", label: "Avg peak speed (per burst)",  unit: "m/s",  group: "Speed & Distance" },
    { id: "total_distance",   label: "Total distance",         unit: "m",    group: "Speed & Distance" },
    { id: "peak_gyro",        label: "Peak angular velocity",  unit: "°/s",  group: "Angular Velocity" },
    { id: "mean_gyro",        label: "Mean angular velocity",  unit: "°/s",  group: "Angular Velocity" },
    { id: "mean_pitch",       label: "Mean pitch",             unit: "°",    group: "Orientation" },
    { id: "mean_roll",        label: "Mean roll",              unit: "°",    group: "Orientation" },
    { id: "pitch_range",      label: "Pitch range",            unit: "°",    group: "Orientation" },
    { id: "roll_range",       label: "Roll range",             unit: "°",    group: "Orientation" },
    { id: "cadence",          label: "Cadence",                unit: "spm",  group: "Rhythm & Repetitions" },
    { id: "rep_count",        label: "Rep count",              unit: "",     group: "Rhythm & Repetitions" },
    { id: "mean_rep_time",    label: "Mean rep time",          unit: "s",    group: "Rhythm & Repetitions" },
    { id: "total_duration",   label: "Session duration",       unit: "s",    group: "Session" },
    { id: "active_time",      label: "Active time",            unit: "s",    group: "Session" },
    { id: "total_impulse",    label: "Total impulse",          unit: "G·s",  group: "Session" },
  ];

  // Expose globally so upload.js and metrics panels can read it
  window.MoveSyncMetrics = METRICS;

  const SENSOR_LABEL = {
    accel: "Accelerometer",
    gyro: "Gyroscope",
    mag: "Magnetometer",
  };

  // ---------------------------------------
  // State
  // ---------------------------------------
  let state = {
    presets: [],
    activeId: null,
    dirty: false,
    search: "",
  };

  // ---------------------------------------
  // DOM helpers
  // ---------------------------------------
  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text || "";
  }

  function setMsg(text) {
    setText("spMsg", text);
    if (text) window.clearTimeout(setMsg.__t);
    if (text) {
      setMsg.__t = window.setTimeout(() => setText("spMsg", ""), 2500);
    }
  }

  function setHint(text) {
    setText("spHint", text || "");
  }

  // ---------------------------------------
  // Preset shape
  // ---------------------------------------
  function makeId() {
    // Short collision-resistant id
    return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizePreset(p) {
    const o = (p && typeof p === "object") ? p : {};
    const metrics = Array.isArray(o.metrics) ? o.metrics.filter(Boolean) : [];
    const timestampTypes = Array.isArray(o.timestampTypes) ? o.timestampTypes.filter(Boolean) : [];

    const windowBefore = Number.isFinite(Number(o.windowBefore)) ? Number(o.windowBefore) : 5;
    const windowAfter = Number.isFinite(Number(o.windowAfter)) ? Number(o.windowAfter) : 3;

    return {
      id: String(o.id || makeId()),
      name: String(o.name || "Untitled preset"),
      defaultSensor: ["accel", "gyro", "mag"].includes(o.defaultSensor) ? o.defaultSensor : "accel",
      overlayMode: ["minimal", "analysis"].includes(o.overlayMode) ? o.overlayMode : "minimal",
      notes: String(o.notes || ""),
      metrics,
      timestampTypes,
      windowBefore: Math.max(0, Math.round(windowBefore)),
      windowAfter: Math.max(0, Math.round(windowAfter)),
      createdAt: o.createdAt || new Date().toISOString(),
      updatedAt: o.updatedAt || new Date().toISOString(),
    };
  }

  // ---------------------------------------
  // Defaults (seeded once)
  // ---------------------------------------
  function defaultPresets() {
    return [
      normalizePreset({
        id: makeId(),
        name: "Sprint / Running",
        defaultSensor: "accel",
        overlayMode: "minimal",
        metrics: ["peak_speed", "total_distance", "peak_accel", "cadence", "mean_burst_speed", "active_time"],
        timestampTypes: ["Start", "Acceleration phase", "Top speed", "Finish"],
        windowBefore: 5,
        windowAfter: 3,
        notes: "Speed and distance use ZUPT burst-corrected integration.",
      }),
      normalizePreset({
        id: makeId(),
        name: "Throw / Swing",
        defaultSensor: "gyro",
        overlayMode: "analysis",
        metrics: ["peak_gyro", "mean_gyro", "peak_accel", "peak_jerk", "pitch_range", "roll_range"],
        timestampTypes: ["Wind-up", "Release", "Follow-through"],
        windowBefore: 5,
        windowAfter: 3,
        notes: "Rotational velocity and segment orientation for arm/racket/club.",
      }),
      normalizePreset({
        id: makeId(),
        name: "Weightlifting / Gym",
        defaultSensor: "accel",
        overlayMode: "analysis",
        metrics: ["peak_accel", "mean_accel", "peak_speed", "total_distance", "rep_count", "mean_rep_time"],
        timestampTypes: ["Setup", "Initiation", "Peak effort", "Recovery"],
        windowBefore: 4,
        windowAfter: 4,
        notes: "Acceleration and rep cadence from bar or wrist IMU.",
      }),
      normalizePreset({
        id: makeId(),
        name: "General Motion",
        defaultSensor: "accel",
        overlayMode: "minimal",
        metrics: ["peak_speed", "total_distance", "peak_accel", "peak_gyro", "total_duration"],
        timestampTypes: ["Start", "Event", "End"],
        windowBefore: 5,
        windowAfter: 5,
        notes: "Generic preset for any single-IMU recording.",
      }),
    ];
  }

  // ---------------------------------------
  // Persistence
  // ---------------------------------------
  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed.map(normalizePreset);
    } catch {
      return null;
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.presets));
    } catch {
      // ignore
    }
  }

  function ensureSeeded() {
    const stored = loadFromStorage();
    if (stored && stored.length) {
      state.presets = stored;
      return;
    }
    state.presets = defaultPresets();
    saveToStorage();
  }

  // ---------------------------------------
  // Derived helpers
  // ---------------------------------------
  function getActive() {
    return state.presets.find((p) => p.id === state.activeId) || null;
  }

  function filteredPresets() {
    const q = (state.search || "").trim().toLowerCase();
    if (!q) return state.presets.slice();

    return state.presets.filter((p) => {
      const hay = [
        p.name,
        p.defaultSensor,
        p.overlayMode,
        p.notes,
        ...(p.metrics || []),
        ...(p.timestampTypes || []),
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }

  function markDirty(isDirty) {
    state.dirty = !!isDirty;
    syncButtons();
    setHint(state.dirty ? "Unsaved changes." : "");
  }

  // ---------------------------------------
  // Render: metrics grid
  // ---------------------------------------
  function renderMetricsGrid(active) {
    const grid = $("spMetricsGrid");
    if (!grid) return;

    const activeMetrics = new Set(active?.metrics || []);
    const groupOrder = [];
    const groupMap = {};
    for (const m of METRICS) {
      const g = m.group || "Other";
      if (!groupMap[g]) { groupMap[g] = []; groupOrder.push(g); }
      groupMap[g].push(m);
    }

    grid.innerHTML = groupOrder.map(g => {
      const items = groupMap[g].map(m => {
        const checked = activeMetrics.has(m.id) ? "checked" : "";
        const unit = m.unit ? `<span class="sp-metric-unit">${escapeHtml(m.unit)}</span>` : "";
        return `<label class="sp-check"><input type="checkbox" data-metric="${escapeHtml(m.id)}" ${checked} /><span>${escapeHtml(m.label)}</span>${unit}</label>`;
      }).join("");
      return `<div class="sp-metric-group"><div class="sp-metric-group-label">${escapeHtml(g)}</div><div class="sp-metric-group-items">${items}</div></div>`;
    }).join("");
  }

  // ---------------------------------------
  // Render: tags
  // ---------------------------------------
  function renderTags(active) {
    const wrap = $("spTags");
    if (!wrap) return;

    const tags = (active?.timestampTypes || []).slice();
    if (!tags.length) {
      wrap.innerHTML = `<div class="sp-help">No timestamp types added.</div>`;
      return;
    }

    wrap.innerHTML = tags
      .map((t, idx) => {
        return `
          <span class="sp-tag" data-tag-idx="${idx}">
            <span>${escapeHtml(t)}</span>
            <button type="button" aria-label="Remove ${escapeHtml(t)}" data-remove-tag="${idx}">
              <i class="bx bx-x" aria-hidden="true"></i>
            </button>
          </span>
        `;
      })
      .join("");
  }

  // ---------------------------------------
  // Render: list
  // ---------------------------------------
  function renderList() {
    const list = $("spList");
    const empty = $("spListEmpty");
    if (!list || !empty) return;

    const items = filteredPresets();

    empty.hidden = items.length > 0;

    list.innerHTML = items
      .map((p) => {
        const isActive = p.id === state.activeId;
        const metricCount = (p.metrics || []).length;
        const tagCount = (p.timestampTypes || []).length;

        return `
          <div class="sp-item ${isActive ? "is-active" : ""}" role="listitem" data-preset-id="${escapeHtml(p.id)}">
            <div class="sp-item-title">${escapeHtml(p.name)}</div>
            <div class="sp-item-meta">
              <span class="sp-pill">${escapeHtml(SENSOR_LABEL[p.defaultSensor] || p.defaultSensor)}</span>
              <span class="sp-pill">${escapeHtml(p.overlayMode)}</span>
              <span class="sp-pill">${metricCount} metrics</span>
              <span class="sp-pill">${tagCount} tags</span>
            </div>
          </div>
        `;
      })
      .join("");

    list.querySelectorAll("[data-preset-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-preset-id");
        if (!id) return;

        // If switching while dirty, confirm (simple safety)
        if (state.dirty && state.activeId && state.activeId !== id) {
          const ok = confirm("You have unsaved changes. Discard and switch preset?");
          if (!ok) return;
        }

        state.activeId = id;
        markDirty(false);
        renderAll();
      });
    });
  }

  // ---------------------------------------
  // Render: editor
  // ---------------------------------------
  function renderEditor() {
    const empty = $("spEditorEmpty");
    const form = $("spForm");
    if (!empty || !form) return;

    const active = getActive();
    if (!active) {
      empty.hidden = false;
      form.hidden = true;
      return;
    }

    empty.hidden = true;
    form.hidden = false;

    $("spName").value = active.name || "";
    $("spDefaultSensor").value = active.defaultSensor || "accel";
    $("spOverlayMode").value = active.overlayMode || "minimal";
    $("spNotes").value = active.notes || "";

    $("spWindowBefore").value = String(active.windowBefore ?? 5);
    $("spWindowAfter").value = String(active.windowAfter ?? 3);

    renderMetricsGrid(active);
    renderTags(active);
  }

  function renderAll() {
    renderList();
    renderEditor();
    syncButtons();
  }

  // ---------------------------------------
  // Button states
  // ---------------------------------------
  function syncButtons() {
    const active = !!getActive();
    const saveBtn = $("spSaveBtn");
    const delBtn = $("spDeleteBtn");
    const dupBtn = $("spDuplicateBtn");

    if (saveBtn) saveBtn.disabled = !active || !state.dirty;
    if (delBtn) delBtn.disabled = !active;
    if (dupBtn) dupBtn.disabled = !active;
  }

  // ---------------------------------------
  // Editor -> state helpers
  // ---------------------------------------
  function patchActive(patch) {
    const i = state.presets.findIndex((p) => p.id === state.activeId);
    if (i === -1) return;

    state.presets[i] = normalizePreset({
      ...state.presets[i],
      ...patch,
      updatedAt: new Date().toISOString(),
    });

    markDirty(true);
  }

  function wireEditor(signal) {
    // Inputs
    $("spName")?.addEventListener("input", (e) => patchActive({ name: e.target.value.trim() || "Untitled preset" }), { signal });
    $("spDefaultSensor")?.addEventListener("change", (e) => patchActive({ defaultSensor: e.target.value }), { signal });
    $("spOverlayMode")?.addEventListener("change", (e) => patchActive({ overlayMode: e.target.value }), { signal });
    $("spNotes")?.addEventListener("input", (e) => patchActive({ notes: e.target.value }), { signal });

    $("spWindowBefore")?.addEventListener("input", (e) => {
      const v = Math.max(0, Math.round(Number(e.target.value) || 0));
      patchActive({ windowBefore: v });
    }, { signal });

    $("spWindowAfter")?.addEventListener("input", (e) => {
      const v = Math.max(0, Math.round(Number(e.target.value) || 0));
      patchActive({ windowAfter: v });
    }, { signal });

    // Metrics grid (delegation)
    $("spMetricsGrid")?.addEventListener("change", (e) => {
      const cb = e.target;
      if (!(cb instanceof HTMLInputElement)) return;
      const id = cb.getAttribute("data-metric");
      if (!id) return;

      const active = getActive();
      if (!active) return;

      const set = new Set(active.metrics || []);
      if (cb.checked) set.add(id);
      else set.delete(id);

      patchActive({ metrics: Array.from(set) });
      // lightweight refresh of list pills
      renderList();
    }, { signal });

    // Metrics helpers
    $("spMetricsSelectAll")?.addEventListener("click", (e) => {
      e.preventDefault();
      patchActive({ metrics: METRICS.map((m) => m.id) });
      renderEditor();
      renderList();
    }, { signal });

    $("spMetricsClear")?.addEventListener("click", (e) => {
      e.preventDefault();
      patchActive({ metrics: [] });
      renderEditor();
      renderList();
    }, { signal });

    // Tags: add
    const addTag = () => {
      const input = $("spTagInput");
      const raw = (input?.value || "").trim();
      if (!raw) return;

      const active = getActive();
      if (!active) return;

      const normalized = raw.replace(/\s+/g, " ");
      const existing = new Set((active.timestampTypes || []).map((t) => t.toLowerCase()));
      if (existing.has(normalized.toLowerCase())) {
        setMsg("That timestamp type already exists.");
        input.value = "";
        return;
      }

      patchActive({ timestampTypes: [...(active.timestampTypes || []), normalized] });
      input.value = "";
      renderEditor();
      renderList();
    };

    $("spAddTagBtn")?.addEventListener("click", (e) => { e.preventDefault(); addTag(); }, { signal });
    $("spTagInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addTag(); }
    }, { signal });

    // Tags: remove (delegation)
    $("spTags")?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-remove-tag]");
      if (!btn) return;

      const idx = Number(btn.getAttribute("data-remove-tag"));
      const active = getActive();
      if (!active) return;

      const tags = (active.timestampTypes || []).slice();
      if (!Number.isFinite(idx) || idx < 0 || idx >= tags.length) return;

      tags.splice(idx, 1);
      patchActive({ timestampTypes: tags });

      renderEditor();
      renderList();
    }, { signal });
  }

  // ---------------------------------------
  // Actions: New, Save, Duplicate, Delete
  // ---------------------------------------
  function createNewPreset() {
    const p = normalizePreset({
      id: makeId(),
      name: "New preset",
      defaultSensor: "accel",
      overlayMode: "minimal",
      notes: "",
      metrics: [],
      timestampTypes: [],
      windowBefore: 5,
      windowAfter: 3,
    });

    state.presets.unshift(p);
    state.activeId = p.id;
    markDirty(true);

    renderAll();
    setMsg("New preset created.");
  }

  function saveActive() {
    const active = getActive();
    if (!active) return;

    // Ensure name is never empty
    if (!active.name || !active.name.trim()) {
      patchActive({ name: "Untitled preset" });
    }

    saveToStorage();
    markDirty(false);
    renderList();
    setMsg("Preset saved.");
  }

  function duplicateActive() {
    const active = getActive();
    if (!active) return;

    const copy = normalizePreset({
      ...active,
      id: makeId(),
      name: `${active.name} (copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    state.presets.unshift(copy);
    state.activeId = copy.id;
    markDirty(true);

    renderAll();
    setMsg("Preset duplicated.");
  }

  function deleteActive() {
    const active = getActive();
    if (!active) return;

    const ok = confirm(`Delete preset "${active.name}"? This cannot be undone.`);
    if (!ok) return;

    const idx = state.presets.findIndex((p) => p.id === active.id);
    state.presets = state.presets.filter((p) => p.id !== active.id);

    // Choose next active
    if (!state.presets.length) {
      state.activeId = null;
    } else {
      const nextIdx = Math.min(idx, state.presets.length - 1);
      state.activeId = state.presets[nextIdx]?.id || state.presets[0].id;
    }

    saveToStorage();
    markDirty(false);
    renderAll();
    setMsg("Preset deleted.");
  }

  // ---------------------------------------
  // Import / Export
  // ---------------------------------------
  function exportPresets() {
    const data = JSON.stringify(state.presets, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "movesync-sport-presets.json";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
    setMsg("Exported presets.");
  }

  async function importPresetsFromFile(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!Array.isArray(parsed)) {
        alert("Import failed: expected a JSON array of presets.");
        return;
      }

      const incoming = parsed.map(normalizePreset);

      // Merge strategy:
      // - If same id exists, overwrite it
      // - Else add it
      const map = new Map(state.presets.map((p) => [p.id, p]));
      for (const p of incoming) map.set(p.id, p);

      state.presets = Array.from(map.values())
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      saveToStorage();
      markDirty(false);

      // Select first preset after import (or keep if exists)
      if (!state.activeId || !state.presets.some((p) => p.id === state.activeId)) {
        state.activeId = state.presets[0]?.id || null;
      }

      renderAll();
      setMsg("Imported presets.");
    } catch (e) {
      console.warn("[sport-presets] import failed:", e);
      alert("Import failed: invalid JSON.");
    }
  }

  // ---------------------------------------
  // Wiring
  // ---------------------------------------
  let abort = null;

  function init() {
    abort?.abort?.();
    abort = new AbortController();
    const signal = abort.signal;

    ensureSeeded();

    // If no active, select first
    if (!state.activeId && state.presets.length) state.activeId = state.presets[0].id;

    // Search
    $("spSearchInput")?.addEventListener("input", (e) => {
      state.search = e.target.value || "";
      renderList();
    }, { signal });

    // Top actions
    $("spNewBtn")?.addEventListener("click", createNewPreset, { signal });
    $("spSaveBtn")?.addEventListener("click", saveActive, { signal });
    $("spDuplicateBtn")?.addEventListener("click", duplicateActive, { signal });
    $("spDeleteBtn")?.addEventListener("click", deleteActive, { signal });

    $("spExportBtn")?.addEventListener("click", exportPresets, { signal });

    const importInput = $("spImportFile");
    $("spImportBtn")?.addEventListener("click", () => importInput?.click(), { signal });
    importInput?.addEventListener("change", async () => {
      const f = importInput.files?.[0];
      importInput.value = "";
      await importPresetsFromFile(f);
    }, { signal });

    // Editor wiring
    wireEditor(signal);

    // Initial render
    markDirty(false);
    renderAll();
  }

  function destroy() {
    abort?.abort?.();
    abort = null;

    // Keep presets persisted; just reset transient state
    state.search = "";
    state.dirty = false;
  }

  window.MoveSyncPages[PAGE_NAME] = { init, destroy };
})();