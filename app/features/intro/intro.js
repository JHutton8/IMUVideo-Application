// ============================================================================
// MoveSync — Intro / Splash controller
// File: app/features/intro/intro.js
//
// Guarantees:
// - Clicking "Start tracking" ALWAYS routes to Dashboard
// - After you've started once, ANY refresh/reload ALWAYS opens Dashboard
//
// Also includes the advanced flow-field motion transition.
// ============================================================================

(() => {
  const CONFIG = {
    THEME_KEY: "movesync-theme",
    DEFAULT_PAGE: "Dashboard",
    SPLASH_DELAY_MS: 2000,

    // "Always dashboard after start"
    FORCE_DASH_KEY: "movesync-force-dashboard",

    // Transition pacing
    OVERLAY_EXIT_FALLBACK_MS: 1100,

    // Motion field (canvas) tuning
    FIELD: {
      particleCount: Math.min(
        140,
        Math.max(70, Math.floor((window.innerWidth * window.innerHeight) / 18000))
      ),
      speed: 0.55,
      lineWidth: 1.05,
      fade: 0.08,
      noiseScale: 0.0016,
      noiseTime: 0.0009,
      pointerForce: 0.10,
      burstForce: 1.85,
    },
  };

  const byId = (id) => document.getElementById(id);

  const IDS = {
    overlay: "introScreen",
    overlayStartBtn: "introStartBtn",
    overlayHint: "introHint",
    overlayError: "introError",
    appShell: "appShell",
  };

  // -------------------------
  // Theme
  // -------------------------
  function applyThemeFromStorage() {
    const saved = localStorage.getItem(CONFIG.THEME_KEY);
    document.body.classList.toggle("dark", saved === "dark");
  }

  // -------------------------
  // Always Dashboard logic
  // -------------------------
  function setForceDashboardFlag() {
    localStorage.setItem(CONFIG.FORCE_DASH_KEY, "1");
  }

  function forceDashboardHash() {
    // Always force dashboard when starting tracking
    location.hash = encodeURIComponent(CONFIG.DEFAULT_PAGE);
  }

  function setOverlayError(message) {
    const el = byId(IDS.overlayError);
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || "";
  }

  function wireKeyboardShortcuts(startFn, isReadyFn = () => true) {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (!isReadyFn()) return;

      if (e.key === "Enter") {
        e.preventDefault();
        startFn();
      } else if (e.key.toLowerCase() === "s") {
        startFn();
      }
    };
    window.addEventListener("keydown", onKeyDown);
  }

  function revealOverlayControls() {
    const startRow =
      byId("introActions") || document.querySelector("#introScreen .intro-actions");
    const hint = byId(IDS.overlayHint);
    const btn = byId(IDS.overlayStartBtn);
    const stage = document.querySelector("#introScreen .intro-stage");

    if (startRow) startRow.classList.add("is-visible");
    if (hint) hint.classList.add("is-visible");
    if (stage) stage.classList.add("lift-up");

    if (btn) {
      btn.disabled = false;
      btn.focus?.();
    }
  }

  // ============================================================================
  // Advanced background: Flow-field particle trails (motion vectors)
  // ============================================================================
  function createMotionField(overlayEl) {
    if (!overlayEl) return null;

    const canvas = document.createElement("canvas");
    canvas.className = "intro-field";
    canvas.setAttribute("aria-hidden", "true");
    overlayEl.prepend(canvas);

    const scan = document.createElement("div");
    scan.className = "intro-scan";
    scan.setAttribute("aria-hidden", "true");
    overlayEl.prepend(scan);

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return null;

    const state = {
      w: 0,
      h: 0,
      dpr: Math.min(2, window.devicePixelRatio || 1),
      t: 0,
      running: true,
      burst: 0,
      pointer: { x: 0, y: 0, active: false },
      particles: [],
    };

    function resize() {
      state.w = overlayEl.clientWidth;
      state.h = overlayEl.clientHeight;
      canvas.width = Math.floor(state.w * state.dpr);
      canvas.height = Math.floor(state.h * state.dpr);
      canvas.style.width = `${state.w}px`;
      canvas.style.height = `${state.h}px`;
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      ctx.clearRect(0, 0, state.w, state.h);
    }

    function rand(min, max) {
      return min + Math.random() * (max - min);
    }

    function flowAngle(x, y, time) {
      const ns = CONFIG.FIELD.noiseScale;
      const nt = CONFIG.FIELD.noiseTime;

      const a =
        Math.sin(x * ns + (time * nt) * 1.2) +
        Math.cos(y * ns - (time * nt) * 1.4);

      const b =
        Math.cos(x * ns * 0.9 - (time * nt) * 1.1) +
        Math.sin(y * ns * 1.1 + (time * nt) * 1.3);

      const c = Math.sin(a * 1.7 + b * 1.3);
      return (a + b + c) * 1.15;
    }

    function makeParticles() {
      state.particles = [];
      const n = CONFIG.FIELD.particleCount;

      for (let i = 0; i < n; i++) {
        state.particles.push({
          x: rand(0, state.w),
          y: rand(0, state.h),
          vx: 0,
          vy: 0,
          life: rand(80, 220),
          hue: rand(150, 215),
          alpha: rand(0.20, 0.52),
        });
      }
    }

    function fadeFrame() {
      ctx.fillStyle = `rgba(7,11,16,${CONFIG.FIELD.fade})`;
      ctx.fillRect(0, 0, state.w, state.h);
    }

    function step() {
      if (!state.running) return;

      state.t += 1;
      fadeFrame();

      const baseSpeed = CONFIG.FIELD.speed;
      const burst = state.burst;

      for (const p of state.particles) {
        const ang = flowAngle(p.x, p.y, state.t);

        let ax = Math.cos(ang) * baseSpeed;
        let ay = Math.sin(ang) * baseSpeed;

        if (state.pointer.active) {
          const dx = state.pointer.x - p.x;
          const dy = state.pointer.y - p.y;
          const dist = Math.max(40, Math.hypot(dx, dy));
          const pull = CONFIG.FIELD.pointerForce * (220 / dist);
          ax += (dx / dist) * pull;
          ay += (dy / dist) * pull;
        }

        if (burst > 0) {
          const down = CONFIG.FIELD.burstForce * burst;
          ay += down;
          ax *= 1 - 0.25 * burst;
        }

        p.vx = (p.vx + ax) * 0.92;
        p.vy = (p.vy + ay) * 0.92;

        const x0 = p.x;
        const y0 = p.y;

        p.x += p.vx;
        p.y += p.vy;

        ctx.lineWidth = CONFIG.FIELD.lineWidth;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = `hsla(${p.hue}, 90%, 70%, ${
          p.alpha * (0.75 + 0.55 * burst)
        })`;
        ctx.stroke();

        p.life -= 1;
        const out =
          p.x < -30 ||
          p.x > state.w + 30 ||
          p.y < -30 ||
          p.y > state.h + 30;

        if (out || p.life <= 0) {
          p.x = rand(0, state.w);
          p.y = burst > 0 ? rand(-40, 0) : rand(0, state.h);
          p.vx = 0;
          p.vy = 0;
          p.life = rand(90, 240);
        }
      }

      requestAnimationFrame(step);
    }

    function onPointerMove(e) {
      const rect = canvas.getBoundingClientRect();
      state.pointer.x = e.clientX - rect.left;
      state.pointer.y = e.clientY - rect.top;
      state.pointer.active = true;
    }
    function onPointerLeave() {
      state.pointer.active = false;
    }

    window.addEventListener("resize", () => {
      resize();
      makeParticles();
    });

    overlayEl.addEventListener("pointermove", onPointerMove);
    overlayEl.addEventListener("pointerleave", onPointerLeave);

    resize();
    makeParticles();
    ctx.fillStyle = "rgba(7,11,16,1)";
    ctx.fillRect(0, 0, state.w, state.h);
    requestAnimationFrame(step);

    return {
      burstRamp(ms = 520) {
        const t0 = performance.now();
        const tick = (now) => {
          const k = Math.min(1, (now - t0) / ms);
          state.burst = k * k;
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      destroy() {
        state.running = false;
        overlayEl.removeEventListener("pointermove", onPointerMove);
        overlayEl.removeEventListener("pointerleave", onPointerLeave);
        canvas.remove();
        scan.remove();
      },
    };
  }

  // ============================================================================
  // Transition helpers
  // ============================================================================
  function animateAppIn() {
    const shell = byId(IDS.appShell);
    if (!shell) return;

    shell.hidden = false;
    document.body.classList.add("app-entering");

    requestAnimationFrame(() => {
      shell.classList.add("is-entering");
    });

    setTimeout(() => {
      document.body.classList.remove("app-entering");
    }, 1200);
  }

  function animateOverlayOut() {
    const overlay = byId(IDS.overlay);
    if (!overlay) return Promise.resolve();

    return new Promise((resolve) => {
      if (overlay.classList.contains("is-exiting")) return resolve();

      const done = () => {
        overlay.removeEventListener("transitionend", onEnd);
        resolve();
      };

      const onEnd = (e) => {
        if (e.propertyName === "opacity" || e.propertyName === "transform") done();
      };

      overlay.addEventListener("transitionend", onEnd);
      overlay.classList.add("is-exiting");

      setTimeout(done, CONFIG.OVERLAY_EXIT_FALLBACK_MS);
    });
  }

  // ============================================================================
  // Main start flow
  // ============================================================================
  async function startFromOverlay(motionField) {
    const btn = byId(IDS.overlayStartBtn);
    if (btn && btn.disabled) return;

    if (btn) btn.disabled = true;
    setOverlayError("");

    applyThemeFromStorage();

    // ✅ GUARANTEE dashboard now + on future refreshes
    setForceDashboardFlag();
    forceDashboardHash();

    // ramp up the “vector field”
    motionField?.burstRamp(520);

    // bring dashboard in with 3D rise
    animateAppIn();

    try {
      const app = window.MoveSyncApp;
      if (!app || typeof app.init !== "function") {
        throw new Error(
          "App core not ready. Check that app-shell.js loads before intro.js."
        );
      }

      // Start SPA router + initial page load
      app.init();
    } catch (e) {
      setOverlayError(String(e?.message || e));
      if (btn) btn.disabled = false;
      return;
    }

    await animateOverlayOut();

    const overlay = byId(IDS.overlay);
    if (overlay) overlay.remove();

    // Start the same motion background behind the whole app
    const appBg = document.querySelector(".app-bg");
    if (appBg) {
      createMotionField(appBg);
    }

    motionField?.destroy();

    if (btn) btn.disabled = false;
  }

  function initSplashOverlayIfPresent() {
    const overlay = byId(IDS.overlay);
    const overlayBtn = byId(IDS.overlayStartBtn);
    if (!overlay || !overlayBtn) return false;

    const shell = byId(IDS.appShell);
    if (shell) {
      shell.hidden = true;
      shell.classList.remove("is-entering");
    }

    overlayBtn.disabled = true;
    setOverlayError("");

    const motionField = createMotionField(overlay);

    overlayBtn.addEventListener("click", () => startFromOverlay(motionField));
    wireKeyboardShortcuts(() => startFromOverlay(motionField), () => !overlayBtn.disabled);

    setTimeout(revealOverlayControls, CONFIG.SPLASH_DELAY_MS);
    return true;
  }

  function init() {
    applyThemeFromStorage();
    initSplashOverlayIfPresent();
  }

  document.addEventListener("DOMContentLoaded", init);
})();