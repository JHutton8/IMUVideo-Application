// =======================================
// Feature: Timestamps panel
// File: app/navigation/session-viewer/timestamps/timestamps.js
// =======================================

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function clamp(n, a, b) {
    const v = Number(n);
    if (!Number.isFinite(v)) return a;
    return Math.min(b, Math.max(a, v));
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Unified time format: "0.000 s"
  function fmtSec(t) {
    const v = Number(t);
    if (!Number.isFinite(v)) return "—";
    return `${v.toFixed(3)} s`;
  }

  function hashHue(str) {
    const s = String(str ?? "").trim().toLowerCase();
    if (!s) return 0;
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h % 360;
  }

  function getSessionTimestamps(session) {
    if (!session) return [];
    if (!Array.isArray(session.timestamps)) session.timestamps = [];
    return session.timestamps;
  }

  function buildPanelMarkup() {
    return `
      <div class="viewer-card-title">
        <i class="bx bx-bookmark" aria-hidden="true"></i>
        Timestamps
      </div>

      <div class="viewer-ts">
        <div class="viewer-tsHead">
          <div class="viewer-tsNow viewer-mono" id="viewerTsNow">—</div>
        </div>

        <div class="viewer-tsForm">
          <div class="viewer-tsAdd">
            <input
              id="viewerTsInput"
              class="viewer-tsInput"
              type="text"
              placeholder="Add timestamp label…"
              aria-label="Timestamp label"
            />
            <button class="btn" id="viewerTsAddBtn" type="button">
              <i class="bx bx-plus" aria-hidden="true"></i>
              Add
            </button>
            <button class="btn btn-ghost" id="viewerTsCancelBtn" type="button" style="display:none;">
              Cancel
            </button>
          </div>

          <div class="viewer-tsField">
            <label class="viewer-tsLabel" for="viewerTsNotes">Notes</label>
            <textarea
              id="viewerTsNotes"
              class="viewer-tsTextarea"
              placeholder="Write notes…"
              aria-label="Timestamp notes"
            ></textarea>
          </div>

          <div class="viewer-tsBtns" style="display:none;" id="viewerTsEditBtns">
            <button class="btn btn-ghost" id="viewerTsUseNowBtn" type="button">
              <i class="bx bx-time" aria-hidden="true"></i>
              Use current time
            </button>
          </div>
        </div>

        <div class="viewer-tsHint" id="viewerTsHint" aria-live="polite">
          Select a session to add timestamps.
        </div>

        <div class="viewer-tsList" id="viewerTsList"></div>
      </div>

      <div class="viewer-card-title" style="margin-top:8px;">
        <i class="bx bx-analyse" aria-hidden="true"></i>
        Range Analysis
      </div>

      <div class="viewer-tsRange">
        <div class="viewer-tsRangePoints">
          <div class="viewer-tsRangePoint">
            <span class="viewer-tsRangeLabel">A</span>
            <span class="viewer-tsRangeTime viewer-mono" id="viewerTsRangeA">—</span>
            <button class="btn btn-ghost viewer-tsRangeSetBtn" id="viewerTsSetA" type="button">Set</button>
          </div>
          <div class="viewer-tsRangeDivider"></div>
          <div class="viewer-tsRangePoint">
            <span class="viewer-tsRangeLabel">B</span>
            <span class="viewer-tsRangeTime viewer-mono" id="viewerTsRangeB">—</span>
            <button class="btn btn-ghost viewer-tsRangeSetBtn" id="viewerTsSetB" type="button">Set</button>
          </div>
          <button class="btn btn-ghost viewer-tsRangeClearBtn" id="viewerTsRangeClear" type="button" title="Clear range">
            <i class="bx bx-x" aria-hidden="true"></i>
          </button>
        </div>
        <div class="viewer-tsRangeMetrics" id="viewerTsRangeMetrics" style="display:none;">
          <div class="viewer-tsRangeMetric">
            <span class="viewer-tsRangeMetricLabel">Duration</span>
            <span class="viewer-tsRangeMetricVal" id="vrm-duration">—</span>
          </div>
          <div class="viewer-tsRangeMetric">
            <span class="viewer-tsRangeMetricLabel">Mean speed</span>
            <span class="viewer-tsRangeMetricVal" id="vrm-mean-speed">—</span>
          </div>
          <div class="viewer-tsRangeMetric">
            <span class="viewer-tsRangeMetricLabel">Peak speed</span>
            <span class="viewer-tsRangeMetricVal" id="vrm-peak-speed">—</span>
          </div>
          <div class="viewer-tsRangeMetric">
            <span class="viewer-tsRangeMetricLabel">Distance</span>
            <span class="viewer-tsRangeMetricVal" id="vrm-distance">—</span>
          </div>
          <div class="viewer-tsRangeMetric">
            <span class="viewer-tsRangeMetricLabel">Peak accel</span>
            <span class="viewer-tsRangeMetricVal" id="vrm-peak-accel">—</span>
          </div>
        </div>
        <div class="viewer-tsRangeHint" id="viewerTsRangeHint">
          Set A and B to analyse a time window.
        </div>
      </div>
    `.trim();
  }

  function ensureMounted() {
    const mount = $("viewerTimestampsPanelMount");
    if (!mount) return null;

    if (!mount.dataset.mounted) {
      mount.innerHTML = buildPanelMarkup();
      mount.dataset.mounted = "1";
    }
    return mount;
  }

  function create({ getActiveSession, getVideoEl, getTimeSyncOffset } = {}) {
    let editingId = null;
    let _processed = null;
    let _rangeA = null;
    let _rangeB = null;

    // ── Range analysis ───────────────────────────────────────────

    function videoToImu(videoTime) {
      const off = typeof getTimeSyncOffset === "function" ? getTimeSyncOffset() : null;
      if (off === null) return null;
      return Number(videoTime) - off;
    }

    function setRangePoint(which) {
      const v = typeof getVideoEl === "function" ? getVideoEl() : $("viewerVideo");
      if (!v || !Number.isFinite(v.currentTime)) {
        setRangeHint("Load a video first.");
        return;
      }
      const imuT = videoToImu(v.currentTime);
      if (imuT === null) {
        setRangeHint("Set time sync offset first.");
        return;
      }
      if (which === "A") {
        _rangeA = imuT;
        const el = $("viewerTsRangeA");
        if (el) el.textContent = fmtSec(v.currentTime) + " (video)";
        $("viewerTsSetA")?.classList.add("is-set");
      } else {
        _rangeB = imuT;
        const el = $("viewerTsRangeB");
        if (el) el.textContent = fmtSec(v.currentTime) + " (video)";
        $("viewerTsSetB")?.classList.add("is-set");
      }
      updateRangeMetrics();
    }

    function clearRange() {
      _rangeA = null;
      _rangeB = null;
      const elA = $("viewerTsRangeA");
      const elB = $("viewerTsRangeB");
      if (elA) elA.textContent = "—";
      if (elB) elB.textContent = "—";
      $("viewerTsSetA")?.classList.remove("is-set");
      $("viewerTsSetB")?.classList.remove("is-set");
      const metrics = $("viewerTsRangeMetrics");
      if (metrics) metrics.style.display = "none";
      setRangeHint("Set A and B to analyse a time window.");
    }

    function setRangeHint(msg) {
      const el = $("viewerTsRangeHint");
      if (el) el.textContent = msg || "";
    }

    function updateRangeMetrics() {
      if (_rangeA === null || _rangeB === null) {
        setRangeHint("Set A and B to analyse a time window.");
        return;
      }

      const tStart = Math.min(_rangeA, _rangeB);
      const tEnd   = Math.max(_rangeA, _rangeB);

      if (tEnd <= tStart) {
        setRangeHint("A and B must be different times.");
        return;
      }

      if (!_processed) {
        setRangeHint("IMU data not loaded yet.");
        return;
      }

      const fn = window.MoveSyncIMUProcessing?.getWindowMetrics;
      if (!fn) {
        setRangeHint("IMU processing not available.");
        return;
      }

      const m = fn(_processed, tStart, tEnd);
      if (!m) {
        setRangeHint("No IMU data in this range.");
        return;
      }

      const metrics = $("viewerTsRangeMetrics");
      if (metrics) metrics.style.display = "grid";
      setRangeHint("");

      function setVal(id, val, unit) {
        const el = $(id);
        if (!el) return;
        el.textContent = (val != null && Number.isFinite(val))
          ? `${Number(val).toFixed(2)} ${unit}`
          : "—";
      }

      setVal("vrm-duration",   m.duration,          "s");
      setVal("vrm-mean-speed", m.meanSpeed,         "m/s");
      setVal("vrm-peak-speed", m.peakSpeed,         "m/s");
      setVal("vrm-distance",   m.distanceTravelled, "m");
      setVal("vrm-peak-accel", m.peakAccel,         "g");
    }

    function setRangeFromTimestamp(id, which) {
      const session = typeof getActiveSession === "function" ? getActiveSession() : null;
      if (!session) return;
      const ts = getSessionTimestamps(session).find((x) => String(x.id) === String(id));
      if (!ts || !Number.isFinite(ts.t)) return;

      const imuT = videoToImu(ts.t);
      if (imuT === null) {
        setRangeHint("Set time sync offset first.");
        return;
      }
      if (which === "A") {
        _rangeA = imuT;
        const el = $("viewerTsRangeA");
        if (el) el.textContent = fmtSec(ts.t) + " (video)";
        $("viewerTsSetA")?.classList.add("is-set");
      } else {
        _rangeB = imuT;
        const el = $("viewerTsRangeB");
        if (el) el.textContent = fmtSec(ts.t) + " (video)";
        $("viewerTsSetB")?.classList.add("is-set");
      }
      updateRangeMetrics();
    }

    // ── Timestamp panel ──────────────────────────────────────────

    function setEditingMode(isEditing) {
      const addBtn    = $("viewerTsAddBtn");
      const cancelBtn = $("viewerTsCancelBtn");
      const editBtns  = $("viewerTsEditBtns");

      if (addBtn) {
        addBtn.innerHTML = isEditing
          ? `<i class="bx bx-save" aria-hidden="true"></i> Save`
          : `<i class="bx bx-plus" aria-hidden="true"></i> Add`;
      }
      if (cancelBtn) cancelBtn.style.display = isEditing ? "" : "none";
      if (editBtns)  editBtns.style.display  = isEditing ? "flex" : "none";
    }

    function clearForm() {
      const input = $("viewerTsInput");
      const notes = $("viewerTsNotes");
      if (input) input.value = "";
      if (notes) notes.value = "";
    }

    function fillFormFromTs(ts) {
      const input = $("viewerTsInput");
      const notes = $("viewerTsNotes");
      if (input) input.value = ts?.label || "";
      if (notes) notes.value = ts?.notes || "";
    }

    function setHint(msg) {
      const el = $("viewerTsHint");
      if (el) el.textContent = msg || "";
    }

    function updateNow() {
      const mount = ensureMounted();
      if (!mount) return;

      const v = typeof getVideoEl === "function" ? getVideoEl() : $("viewerVideo");
      const nowEl = $("viewerTsNow");
      if (!nowEl) return;

      if (!v || !Number.isFinite(v.currentTime)) {
        nowEl.textContent = "—";
        return;
      }
      nowEl.textContent = fmtSec(v.currentTime);
    }

    function onProcessed(processed) {
      _processed = processed || null;
      if (_rangeA !== null && _rangeB !== null) updateRangeMetrics();
    }

    function render(sessionArg) {
      const mount = ensureMounted();
      if (!mount) return;

      const session =
        sessionArg ?? (typeof getActiveSession === "function" ? getActiveSession() : null);

      const list = $("viewerTsList");
      if (!list) return;

      if (!session) {
        cancelEdit();
        list.innerHTML = "";
        setHint("Select a session to add timestamps.");
        return;
      }

      const items = getSessionTimestamps(session)
        .slice()
        .sort((a, b) => {
          const ta = Number(a?.t);
          const tb = Number(b?.t);
          const aOk = Number.isFinite(ta);
          const bOk = Number.isFinite(tb);
          if (aOk && bOk) { if (ta !== tb) return ta - tb; }
          else if (aOk && !bOk) return -1;
          else if (!aOk && bOk) return 1;
          const ca = a?.createdAt ? Date.parse(a.createdAt) : 0;
          const cb = b?.createdAt ? Date.parse(b.createdAt) : 0;
          if (ca !== cb) return cb - ca;
          return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
        });

      if (!items.length) {
        cancelEdit();
        list.innerHTML = "";
        setHint("No timestamps yet. Play/seek the video and click Add.");
        return;
      }

      setHint("");

      list.innerHTML = items
        .map((it) => {
          const id        = escapeHtml(it.id || "");
          const rawLabel  = it.label || "Unlabeled";
          const label     = escapeHtml(rawLabel);
          const hue       = hashHue(rawLabel);
          const notes     = escapeHtml(it.notes || "");
          const timeText  = fmtSec(it.t);
          const created   = it.createdAt ? new Date(it.createdAt) : null;
          const createdText = created
            ? `${created.toLocaleDateString()} ${created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "—";

          return `
            <div class="viewer-tsItem" data-ts-id="${id}" role="button" tabindex="0" aria-label="Go to ${timeText}">
              <div class="viewer-tsMain">
                <div class="viewer-tsTop">
                  <span class="viewer-tsTime viewer-mono">${timeText}</span>
                  <span class="viewer-tsCreated">${createdText}</span>
                  <span class="viewer-tsTag" style="--tag-h:${hue}">${label}</span>
                </div>
                ${notes ? `<div class="viewer-tsNotes">${notes}</div>` : ""}
              </div>
              <div class="viewer-tsActions">
                <button class="viewer-tsIconBtn viewer-tsABBtn" data-action="set-a" title="Set as range point A" type="button">A</button>
                <button class="viewer-tsIconBtn viewer-tsABBtn" data-action="set-b" title="Set as range point B" type="button">B</button>
                <button class="viewer-tsIconBtn" data-action="edit" title="Edit" type="button">
                  <i class="bx bx-pencil" aria-hidden="true"></i>
                </button>
                <button class="viewer-tsIconBtn" data-action="delete" title="Delete" type="button">
                  <i class="bx bx-trash" aria-hidden="true"></i>
                </button>
              </div>
            </div>`;
        })
        .join("");
    }

    function addFromVideo() {
      const session = typeof getActiveSession === "function" ? getActiveSession() : null;
      const v       = typeof getVideoEl === "function" ? getVideoEl() : $("viewerVideo");

      if (!session) return setHint("Select a session first.");

      const input   = $("viewerTsInput");
      const notesEl = $("viewerTsNotes");
      const label   = (input?.value || "").trim();
      const notes   = (notesEl?.value || "").trim();
      const arr     = getSessionTimestamps(session);

      if (editingId) {
        const ts = arr.find((x) => String(x.id) === String(editingId));
        if (!ts) {
          editingId = null;
          setEditingMode(false);
          return setHint("That timestamp no longer exists.");
        }
        ts.label     = label;
        ts.notes     = notes;
        ts.updatedAt = new Date().toISOString();
        document.dispatchEvent(new CustomEvent("movesync:session-timestamps-changed", { detail: { sessionId: session.id, at: Date.now() } }));
        editingId = null;
        setEditingMode(false);
        clearForm();
        render(session);
        updateNow();
        setHint("Saved changes.");
        return;
      }

      if (!v || !Number.isFinite(v.currentTime)) return setHint("Load a video first.");
      const t = Number(v.currentTime);

      arr.push({
        id: `ts_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        t, label, notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      clearForm();
      document.dispatchEvent(new CustomEvent("movesync:session-timestamps-changed", { detail: { sessionId: session.id, at: Date.now() } }));
      render(session);
      updateNow();

      const btn = $("viewerTsAddBtn");
      btn?.classList?.add("is-flash");
      window.setTimeout(() => btn?.classList?.remove("is-flash"), 220);
      setHint(`Saved timestamp at ${fmtSec(t)}.`);
    }

    function seekTo(t) {
      const v = typeof getVideoEl === "function" ? getVideoEl() : $("viewerVideo");
      if (!v) return;
      const dur = Number.isFinite(v.duration) ? v.duration : 0;
      if (!dur) return;
      v.currentTime = clamp(t, 0, dur);
      updateNow();
    }

    function deleteById(id) {
      const session = typeof getActiveSession === "function" ? getActiveSession() : null;
      if (!session) return;
      const arr = getSessionTimestamps(session);
      const idx = arr.findIndex((x) => String(x.id) === String(id));
      if (idx >= 0) arr.splice(idx, 1);
      document.dispatchEvent(new CustomEvent("movesync:session-timestamps-changed", { detail: { sessionId: session.id, at: Date.now() } }));
      render(session);
    }

    function beginEditById(id) {
      const session = typeof getActiveSession === "function" ? getActiveSession() : null;
      if (!session) return setHint("Select a session first.");
      const ts = getSessionTimestamps(session).find((x) => String(x.id) === String(id));
      if (!ts) return setHint("Timestamp not found.");
      editingId = ts.id;
      fillFormFromTs(ts);
      setEditingMode(true);
      setHint("Editing timestamp. Click Save when done.");
    }

    function cancelEdit() {
      editingId = null;
      setEditingMode(false);
      clearForm();
      setHint("");
    }

    function setEditingTimeToNow() {
      const session = typeof getActiveSession === "function" ? getActiveSession() : null;
      const v       = typeof getVideoEl === "function" ? getVideoEl() : $("viewerVideo");
      if (!session) return setHint("Select a session first.");
      if (!editingId) return;
      if (!v || !Number.isFinite(v.currentTime)) return setHint("Load a video first.");
      const ts = getSessionTimestamps(session).find((x) => String(x.id) === String(editingId));
      if (!ts) return;
      ts.t         = Number(v.currentTime);
      ts.updatedAt = new Date().toISOString();
      document.dispatchEvent(new CustomEvent("movesync:session-timestamps-changed", { detail: { sessionId: session.id, at: Date.now() } }));
      render(session);
      updateNow();
      setHint(`Updated time to ${fmtSec(ts.t)}. Click Save to keep your label/notes changes too.`);
    }

    function wire(signal) {
      ensureMounted();

      const v = typeof getVideoEl === "function" ? getVideoEl() : $("viewerVideo");

      $("viewerTsAddBtn")?.addEventListener("click",    () => addFromVideo(),    { signal });
      $("viewerTsCancelBtn")?.addEventListener("click", () => cancelEdit(),      { signal });
      $("viewerTsUseNowBtn")?.addEventListener("click", () => setEditingTimeToNow(), { signal });
      $("viewerTsSetA")?.addEventListener("click",      () => setRangePoint("A"), { signal });
      $("viewerTsSetB")?.addEventListener("click",      () => setRangePoint("B"), { signal });
      $("viewerTsRangeClear")?.addEventListener("click",() => clearRange(),      { signal });

      $("viewerTsInput")?.addEventListener("keydown",  (e) => { if (e.key === "Enter") addFromVideo(); }, { signal });
      $("viewerTsNotes")?.addEventListener("keydown",  (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") addFromVideo(); }, { signal });

      v?.addEventListener("timeupdate",    () => updateNow(), { signal });
      v?.addEventListener("loadedmetadata",() => updateNow(), { signal });
      v?.addEventListener("emptied",       () => updateNow(), { signal });

      $("viewerTsList")?.addEventListener("click", (e) => {
        const del  = e.target?.closest?.('[data-action="delete"]');
        const edit = e.target?.closest?.('[data-action="edit"]');
        const setA = e.target?.closest?.('[data-action="set-a"]');
        const setB = e.target?.closest?.('[data-action="set-b"]');
        const item = e.target?.closest?.(".viewer-tsItem");
        if (!item) return;

        const id      = item.getAttribute("data-ts-id");
        const session = typeof getActiveSession === "function" ? getActiveSession() : null;
        if (!session) return;

        if (del)  { e.preventDefault(); e.stopPropagation(); if (editingId && String(editingId) === String(id)) cancelEdit(); deleteById(id); return; }
        if (edit) { e.preventDefault(); e.stopPropagation(); beginEditById(id); return; }
        if (setA) { e.preventDefault(); e.stopPropagation(); setRangeFromTimestamp(id, "A"); return; }
        if (setB) { e.preventDefault(); e.stopPropagation(); setRangeFromTimestamp(id, "B"); return; }

        const ts = getSessionTimestamps(session).find((x) => String(x.id) === String(id));
        if (ts && Number.isFinite(ts.t)) seekTo(ts.t);
      }, { signal });

      $("viewerTsList")?.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const item = e.target?.closest?.(".viewer-tsItem");
        if (!item) return;
        e.preventDefault();
        const id      = item.getAttribute("data-ts-id");
        const session = typeof getActiveSession === "function" ? getActiveSession() : null;
        if (!session) return;
        const ts = getSessionTimestamps(session).find((x) => String(x.id) === String(id));
        if (ts && Number.isFinite(ts.t)) seekTo(ts.t);
      }, { signal });

      document.addEventListener("movesync:session-timestamps-changed", () => render(), { signal });

      document.addEventListener("movesync:active-session-changed", (e) => {
        cancelEdit();
        clearRange();
        render(e?.detail?.session || null);
        updateNow();
      }, { signal });

      render();
      updateNow();
      setEditingMode(false);
    }

    return { render, wire, updateNow, onProcessed };
  }

  window.MoveSyncViewerTimestamps = { create };
})();