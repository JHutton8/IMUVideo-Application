// ============================
// Compare Sessions controller
// File: js/pages/compare-sessions.js
// ============================

(() => {
  const PAGE_NAME = "Compare Sessions";

  const SESSIONS_KEY = "movesync:sessions";
  const ACTIVE_SESSION_KEY = "movesync:active-session-id";
  const COMPARE_KEY = "movesync:compare";

  const $ = (id) => document.getElementById(id);

  function safeParse(json, fallback) {
    try { return JSON.parse(json); } catch { return fallback; }
  }

  function loadSessions() {
    const raw = localStorage.getItem(SESSIONS_KEY);
    const sessions = raw ? safeParse(raw, []) : [];
    return Array.isArray(sessions) ? sessions : [];
  }

  function formatDate(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setDisabled(id, disabled) {
    const el = $(id);
    if (el) el.disabled = disabled;
  }

  function getCompareState() {
    const stored = safeParse(localStorage.getItem(COMPARE_KEY) || "{}", {});
    return {
      aId: stored.aId || "",
      bId: stored.bId || "",
    };
  }

  function setCompareState(next) {
    localStorage.setItem(COMPARE_KEY, JSON.stringify(next));
    localStorage.setItem("movesync:last-activity", new Date().toISOString());
  }

  function renderSelectOptions(selectEl, sessions) {
    if (!selectEl) return;
    const opts = [
      `<option value="" selected>Select a session…</option>`,
      ...sessions.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name || "Untitled")} · ${escapeHtml(s.id)}</option>`),
    ];
    selectEl.innerHTML = opts.join("");
  }

  function sessionById(sessions, id) {
    return sessions.find((s) => s.id === id) || null;
  }

  function renderMini(which, session) {
    if (which === "A") {
      setText("cmpAChip", session ? (session.name || "Untitled") : "—");
      setText("cmpACreated", session ? formatDate(session.createdAt) : "—");
      setText("cmpAUpdated", session ? formatDate(session.updatedAt || session.createdAt) : "—");
      setText("cmpATags", session ? ((session.tags || []).slice(0, 4).join(", ") || "—") : "—");
    } else {
      setText("cmpBChip", session ? (session.name || "Untitled") : "—");
      setText("cmpBCreated", session ? formatDate(session.createdAt) : "—");
      setText("cmpBUpdated", session ? formatDate(session.updatedAt || session.createdAt) : "—");
      setText("cmpBTags", session ? ((session.tags || []).slice(0, 4).join(", ") || "—") : "—");
    }
  }

  function metricCard(label, aVal, bVal, sub) {
    return `
      <div class="cmp-metric">
        <div class="cmp-metricLabel">${escapeHtml(label)}</div>
        <div class="cmp-metricRow">
          <div>
            <div class="cmp-metricValue">${escapeHtml(aVal)}</div>
            <div class="cmp-metricSub">A</div>
          </div>
          <div>
            <div class="cmp-metricValue">${escapeHtml(bVal)}</div>
            <div class="cmp-metricSub">B</div>
          </div>
        </div>
        ${sub ? `<div class="cmp-metricSub" style="margin-top:10px;">${escapeHtml(sub)}</div>` : ""}
      </div>
    `;
  }

  function computeStats(session) {
    const samples = session?.data?.samples ?? session?.samples ?? null;
    const duration = session?.data?.durationSec ?? session?.durationSec ?? null;
    const channels = session?.data?.channels ?? session?.channels ?? null;

    return {
      samples: samples != null ? Number(samples) : null,
      durationSec: duration != null ? Number(duration) : null,
      channels: Array.isArray(channels) ? channels.length : (typeof channels === "number" ? channels : null),
      tagCount: (session?.tags || []).length,
      noteLength: (session?.notes || "").length,
    };
  }

  function diffText(a, b, unit = "") {
    if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return "";
    const d = b - a;
    const sign = d > 0 ? "+" : "";
    return `Δ ${sign}${d}${unit}`;
  }

  function renderComparison(a, b) {
    const grid = $("cmpGrid");
    const hint = $("cmpSummaryHint");
    if (!grid || !hint) return;

    if (!a || !b) {
      grid.innerHTML = "";
      hint.textContent = "Select A and B to compare.";
      return;
    }

    const aS = computeStats(a);
    const bS = computeStats(b);

    const cards = [
      metricCard("Samples", aS.samples != null ? String(aS.samples) : "—", bS.samples != null ? String(bS.samples) : "—", diffText(aS.samples, bS.samples)),
      metricCard("Duration (sec)", aS.durationSec != null ? String(aS.durationSec) : "—", bS.durationSec != null ? String(bS.durationSec) : "—", diffText(aS.durationSec, bS.durationSec, "s")),
      metricCard("Channels", aS.channels != null ? String(aS.channels) : "—", bS.channels != null ? String(bS.channels) : "—", diffText(aS.channels, bS.channels)),
      metricCard("Tags", String(aS.tagCount), String(bS.tagCount), diffText(aS.tagCount, bS.tagCount)),
      metricCard("Notes length", String(aS.noteLength), String(bS.noteLength), diffText(aS.noteLength, bS.noteLength, " chars")),
      metricCard("Updated", formatDate(a.updatedAt || a.createdAt), formatDate(b.updatedAt || b.createdAt), "Not a numeric diff"),
    ];

    grid.innerHTML = cards.join("");
    hint.textContent = `Comparing “${a.name || "Untitled"}” vs “${b.name || "Untitled"}”.`;
  }

  function updateActionButtons(aId, bId) {
    const ready = Boolean(aId && bId && aId !== bId);
    setDisabled("cmpRun", !ready);
    setDisabled("cmpSwap", !ready);
    setDisabled("cmpOpenA", !aId);
    setDisabled("cmpOpenB", !bId);
  }

  function openInViewer(sessionId) {
    if (!sessionId) return;
    localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    localStorage.setItem("movesync:last-activity", new Date().toISOString());
    window.MoveSync?.goToPage?.("Session Viewer");
  }

  function initPage() {
    const sessions = loadSessions();
    const state = getCompareState();

    const selA = $("cmpSelectA");
    const selB = $("cmpSelectB");

    renderSelectOptions(selA, sessions);
    renderSelectOptions(selB, sessions);

    // If compare state is empty but there's an active session, prefill A
    if (!state.aId) {
      const active = localStorage.getItem(ACTIVE_SESSION_KEY);
      if (active && sessions.some((s) => s.id === active)) state.aId = active;
    }

    if (selA) selA.value = state.aId || "";
    if (selB) selB.value = state.bId || "";

    const a = sessionById(sessions, state.aId);
    const b = sessionById(sessions, state.bId);
    renderMini("A", a);
    renderMini("B", b);
    updateActionButtons(state.aId, state.bId);
    renderComparison(a, b);

    return { sessions, state };
  }

  function wireEvents(ctx, controller) {
    const selA = $("cmpSelectA");
    const selB = $("cmpSelectB");

    function refresh() {
      const aId = selA?.value || "";
      const bId = selB?.value || "";

      ctx.state = { aId, bId };
      setCompareState(ctx.state);

      const a = sessionById(ctx.sessions, aId);
      const b = sessionById(ctx.sessions, bId);
      renderMini("A", a);
      renderMini("B", b);
      updateActionButtons(aId, bId);
      renderComparison(a, b);
    }

    selA?.addEventListener("change", refresh, { signal: controller.signal });
    selB?.addEventListener("change", refresh, { signal: controller.signal });

    $("cmpGoLibrary")?.addEventListener("click", () => {
      window.MoveSync?.goToPage?.("Session Library");
    }, { signal: controller.signal });

    $("cmpRun")?.addEventListener("click", refresh, { signal: controller.signal });

    $("cmpSwap")?.addEventListener("click", () => {
      const a = selA?.value || "";
      const b = selB?.value || "";
      if (selA) selA.value = b;
      if (selB) selB.value = a;
      refresh();
    }, { signal: controller.signal });

    $("cmpOpenA")?.addEventListener("click", () => openInViewer(selA?.value || ""), { signal: controller.signal });
    $("cmpOpenB")?.addEventListener("click", () => openInViewer(selB?.value || ""), { signal: controller.signal });

    $("cmpClear")?.addEventListener("click", () => {
      if (selA) selA.value = "";
      if (selB) selB.value = "";
      refresh();
    }, { signal: controller.signal });
  }

  window.MoveSyncPages = window.MoveSyncPages || {};
  window.MoveSyncPages[PAGE_NAME] = {
    _controller: null,
    _ctx: null,

    init() {
      this._controller?.abort?.();
      this._controller = new AbortController();

      this._ctx = initPage();
      wireEvents(this._ctx, this._controller);
    },

    destroy() {
      this._controller?.abort?.();
      this._controller = null;
      this._ctx = null;
    },
  };
})();