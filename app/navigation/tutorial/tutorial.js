(() => {
    "use strict";

    const PAGE = "Tutorial";

    window.MoveSyncPages = window.MoveSyncPages || {};
    window.MoveSyncPages[PAGE] = {
        mount() {
            const hubHero = document.querySelector("#tutHubHero");
            const grid = document.querySelector("#tutHubGrid");
            const runnerRoot = document.querySelector("#tutRunnerRoot");
            if (!hubHero || !grid || !runnerRoot) return;

            const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
            const behavior = prefersReduced ? "auto" : "smooth";

            const tutorials = Object.values(window.MoveSyncTutorials || {});
            tutorials.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

            function showHub() {
                // cleanup any runner listeners/observers before destroying DOM
                const root = runnerRoot.querySelector(".mstut");
                root?._msTutCleanup?.();

                runnerRoot.hidden = true;
                runnerRoot.innerHTML = "";
                hubHero.hidden = false;
                hubHero.scrollIntoView({ behavior, block: "start" });
            }

            function getScroller() {
            // Most reliable: the real scrolling element for the document
            // Fallbacks included for different browser/layout behaviors
            return document.scrollingElement || document.documentElement || document.body;
            }

            function scrollPageToTopThen(callback) {
                const scroller = getScroller();

                // If you're already near top, still run callback
                if ((scroller.scrollTop || 0) <= 2) {
                    callback?.();
                    return;
                }

                scroller.scrollTo({ top: 0, left: 0, behavior });

                // Wait for the scroll to *actually* reach the top (more reliable than 1 timeout)
                const start = performance.now();
                const maxWait = prefersReduced ? 0 : 1200;

                function check() {
                    const atTop = (scroller.scrollTop || 0) <= 2;
                    const timedOut = performance.now() - start > maxWait;

                    if (atTop || timedOut) {
                    callback?.();
                    return;
                    }
                    requestAnimationFrame(check);
                }

                requestAnimationFrame(check);
            }

            function renderHub() {
                grid.innerHTML = "";

                if (!tutorials.length) {
                grid.innerHTML = `<p style="opacity:.8">No tutorials registered yet.</p>`;
                return;
                }

            tutorials.forEach((tut) => {
            const stepCount = Array.isArray(tut.steps) ? tut.steps.length : 0;

            const card = document.createElement("button");
            card.type = "button";
            card.className = "tuthub-card";
            card.setAttribute("aria-label", `${tut.title} tutorial`);

            card.innerHTML = `
                <h3 class="tuthub-card-title">${tut.title}</h3>
                <p class="tuthub-card-desc">${tut.description || ""}</p>
                <div class="tuthub-card-meta">
                <span>${stepCount} steps</span>
                </div>
            `;

            card.addEventListener("click", () => launchTutorial(tut.id));
            grid.appendChild(card);
            });
        }

        function buildRunnerHTML(tut) {
            const total = tut.steps.length;

            const stepsHtml = tut.steps.map((s, idx) => {
                const stepNo = idx + 1;
                const isLast = stepNo === total;

                const finishLabel = s.finish?.label || "Finish";
                const finishPage = s.finish?.page || null;

                return `
                <div class="mstut-step" data-step="${stepNo}" tabindex="-1">
                    <div class="mstut-card" role="dialog" aria-label="Step ${stepNo}">
                    <div class="mstut-badge">Step ${stepNo} / ${total}</div>
                    <h3>${s.title || ""}</h3>
                    <p>${s.body || ""}</p>

                    <div class="mstut-actions">

                        <button class="mstut-secondary" data-tut-prev type="button">Back</button> ${ 
                            isLast 
                                ? `
                                    <button class="mstut-secondary" data-tut-top type="button">
                                        Back to top
                                    </button>

                                    <button class="mstut-primary" data-tut-finish type="button"
                                        ${finishPage ? `data-finish-page="${finishPage}"` : ""}>
                                        ${finishLabel}
                                    </button>
                                `
                            : `<button class="mstut-primary" data-tut-next type="button">Next</button>`
                        }
                    </div>
                    </div>
                </div>
                `;
            }).join("");

            const navItems = [
                `
                    <button class="mstut-nav-link" type="button" data-nav-step="0">
                    <span class="mstut-nav-step">Intro</span>
                    <span class="mstut-nav-desc">Start here</span>
                    </button>
                `,
                ...tut.steps.map((s, idx) => {
                    const stepNo = idx + 1;
                    const title = (s.title || `Step ${stepNo}`).trim();
                    return `
                    <button class="mstut-nav-link" type="button" data-nav-step="${stepNo}">
                        <span class="mstut-nav-step">Step ${stepNo}</span>
                        <span class="mstut-nav-desc">${title}</span>
                    </button>
                    `;
                })
            ].join("");

            return `
            <section class="mstut" aria-label="${tut.title} Tutorial">
                <div class="tuthub-backbar">
                    <button class="tuthub-backbtn" type="button" id="tutBackToHub">
                        ← Back to tutorials
                    </button>
                </div>

                <nav class="mstut-nav" aria-label="Tutorial progress">
                    ${navItems}
                </nav>

                <div class="mstut-hero" data-step="0">
                <div class="mstut-hero-inner">
                    <h2 class="mstut-title">${tut.title}</h2>
                    <p class="mstut-subtitle">${tut.description || ""}</p>

                    <button class="mstut-primary" id="msTutStart" type="button">
                    Start tutorial
                    </button>

                    <p class="mstut-hint">
                    Tip: <kbd>Enter</kbd> next, <kbd>Shift+Enter</kbd> back, <kbd>Esc</kbd> exit.
                    </p>
                </div>
                </div>

                ${stepsHtml}
            </section>
            `;
        }

        function launchTutorial(id) {
            const tut = (window.MoveSyncTutorials || {})[id];
            if (!tut || !Array.isArray(tut.steps) || !tut.steps.length) return;

            hubHero.hidden = true;
            runnerRoot.hidden = false;
            runnerRoot.innerHTML = buildRunnerHTML(tut);

            // runner behavior (auto-scroll)
            const root = runnerRoot.querySelector(".mstut");
            const cleanupFns = [];
            root._msTutCleanup = () => cleanupFns.splice(0).forEach((fn) => {
                try { fn(); } catch {}
            });
            const startBtn = runnerRoot.querySelector("#msTutStart");
            const backToHubBtn = runnerRoot.querySelector("#tutBackToHub");

            const stepNodes = Array.from(runnerRoot.querySelectorAll("[data-step]"))
            .map((el) => ({ el, n: Number(el.dataset.step) }))
            .sort((a, b) => a.n - b.n);

            const maxStep = Math.max(...stepNodes.map((s) => s.n));
            let currentStep = 0;

            const io = new IntersectionObserver(
                (entries) => {
                    const best = entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

                    if (!best) return;

                    const n = Number(best.target.dataset.step);
                    if (!Number.isNaN(n) && n !== currentStep) {
                    currentStep = n;
                    setNavActive(n);
                    }
                },
                { threshold: [0.45, 0.6, 0.75] }
            );

            stepNodes.forEach(({ el }) => io.observe(el));

            cleanupFns.push(() => io.disconnect());

            function stepEl(n) {
            return stepNodes.find((s) => s.n === n)?.el || null;
            }

            function scrollToStep(n) {
            const target = stepEl(n);
            if (!target) return;
            currentStep = n;
            setNavActive(n);

            target.scrollIntoView({ behavior, block: "center" });
            setTimeout(() => {
                target.focus?.({ preventScroll: true });
            }, prefersReduced ? 0 : 250);
            }

            function setNavActive(n) {
                runnerRoot.querySelectorAll(".mstut-nav-link").forEach((b) => {
                    b.classList.toggle("is-active", Number(b.dataset.navStep) === n);
                    b.setAttribute("aria-current", Number(b.dataset.navStep) === n ? "step" : "false");
                });
            }

            function next() {
            if (currentStep >= maxStep) return;
            scrollToStep(currentStep + 1);
            }

            function prev() {
            if (currentStep <= 0) return;
            scrollToStep(currentStep - 1);
            }

            startBtn?.addEventListener("click", () => scrollToStep(1));

            runnerRoot.querySelectorAll("[data-nav-step]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const n = Number(btn.getAttribute("data-nav-step"));
                    scrollToStep(n);
                });
            });
            runnerRoot.querySelectorAll("[data-tut-next]").forEach((btn) => btn.addEventListener("click", next));
            runnerRoot.querySelectorAll("[data-tut-prev]").forEach((btn) => btn.addEventListener("click", prev));
            runnerRoot.querySelectorAll("[data-tut-finish]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const page = btn.getAttribute("data-finish-page");
                if (page && window.MoveSync?.goToPage) window.MoveSync.goToPage(page);
                else showHub();
            });
            });
            runnerRoot.querySelectorAll("[data-tut-top]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    scrollToStep(0); // smooth back to tutorial intro (no blink)
                });
            });

            backToHubBtn?.addEventListener("click", showHub);

            function onKeyDown(e) {
            if (e.key === "Escape") {
                showHub();
                return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                next();
                return;
            }
            if (e.key === "Backspace" || (e.key === "Enter" && e.shiftKey)) {
                e.preventDefault();
                prev();
            }
            }

            document.addEventListener("keydown", onKeyDown);
            cleanupFns.push(() => document.removeEventListener("keydown", onKeyDown));

            // Start at the clean intro for this tutorial
            scrollToStep(0);
        }

        // initial render
        renderHub();
        showHub();
        },

        unmount() {
        // cleanup key handlers from runner if mounted
        const root = document.querySelector(".mstut");
        if (root?._msTutCleanup) root._msTutCleanup();
        },
    };
})();