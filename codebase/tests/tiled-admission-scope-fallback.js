const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: "msedge",
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready"
      && state.acceptedPresentation?.exact === true
      && state.acceptedPresentation?.generation === state.previewGeneration[state.currentView],
    null, { timeout: 120000 });
    await page.waitForFunction(() => !state.gpuDraftInFlight
      && !state.scopeRequestInFlight && !state.gpuScopeRequestInFlight, null, { timeout: 120000 });

    const result = await page.evaluate(async () => {
      // Drain automatic work from setup before this driver's explicit request.
      // Otherwise a queued anchor/overlay/scheduler scope advances the same
      // generation while the measured call is awaiting its CPU response.
      const drainSetup = async () => {
        const deadline = performance.now() + 120000;
        while (state.gpuDraftInFlight || state.previewScheduler?.frameInFlight
          || state.scopeRequestInFlight || state.gpuScopeRequestInFlight
          || state.pendingScopeRequest || state.pendingGpuScopeRequest
          || pendingHighlightAnchors.size || exactHighlightAnchorInflight.size) {
          if (performance.now() > deadline) throw new Error("Automatic setup work did not settle");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        state.previewScheduler?.cancel();
        window.clearTimeout(state.refreshTimer);
        state.renderCoordinator?.cancelCatchUp(state.currentView);
        state.renderCoordinator?.cancelPan(state.currentView);
      };
      await drainSetup();
      const scopeRefreshes = [];
      const originalRefreshScopes = refreshScopes;
      refreshScopes = (...args) => {
        scopeRefreshes.push({ generationBefore: state.scopeGeneration, stack: new Error().stack });
        return originalRefreshScopes(...args);
      };
      const renderer = state.gpuPreview;
      const originalBudget = state.gpuMemoryBudget;
      const originalPlanRender=renderer.planRender;
      const originalScopeProxy=renderer.renderScopeProxy;

      const originalAnalyzeScope = renderer.analyzeScope.bind(renderer);
      let gpuScopeCalls = 0;
      renderer.analyzeScope = async (...args) => {
        gpuScopeCalls += 1;
        return originalAnalyzeScope(...args);
      };

      try {
        renderer.setMemoryBudget(0.25);
        // The allocator now evicts the old synthetic unpinned cache pressure.
        // Give the real planner a small test budget instead. A separately
        // refused auxiliary allocation exercises the intended CPU fallback.
        renderer.planRender=function(width,height,options={}) {
          return originalPlanRender.call(this,width,height,{...options,scopeBytes:280*1024*1024});
        };
        renderer.renderScopeProxy=async()=>null;
        const rendered = await renderGpuDraft("hdr", {
          longEdge: refinementProxyLongEdge(),
          tier: "settled",
        });
        await drainSetup();
        const accepted = state.acceptedPresentation ? { ...state.acceptedPresentation } : null;
        const plan = renderer.lastRenderPlan;
        const scopeSourcePresent = renderer.scopeSources.has(els.previewCanvas);
        const gpuCallsBeforeRefresh = gpuScopeCalls;
        const scopeEvent = new Promise((resolve) => {
          const timeout = setTimeout(() => resolve({ timeout: true }), 30000);
          const onScope = (event) => {
            if (event.detail?.source !== "cpu") return;
            clearTimeout(timeout);
            window.removeEventListener("hdrfinisher:scope-presented", onScope);
            resolve(event.detail);
          };
          window.addEventListener("hdrfinisher:scope-presented", onScope);
        });
        const scopeApplied = await refreshScopes(scopeLongEdge("settled"), {
          tier: "settled",
          lane: "hdr",
        });
        const scope = await scopeEvent;
        return {
          rendered,
          scopeRefreshes,
          accepted,
          planMode: plan?.decision?.mode,
          violations: plan?.decision?.violations?.map((violation) => violation.rule) || [],
          budgetBytes: plan?.budgetBytes,
          tiledMetrics: renderer.tiledExecutionMetrics,
          scopeSourcePresent,
          scopeApplied,
          scope,
          gpuScopeCallsDuringRefresh: gpuScopeCalls - gpuCallsBeforeRefresh,
          freshness: els.scopeFreshness.textContent,
          freshnessUpdating: els.scopeFreshness.classList.contains("updating"),
        };
      } finally {
        refreshScopes = originalRefreshScopes;
        renderer.analyzeScope = originalAnalyzeScope;
        renderer.planRender=originalPlanRender;
        renderer.renderScopeProxy=originalScopeProxy;
        renderer.setMemoryBudget(originalBudget);
      }
    });

    assert(result.rendered === true, `Budget-rejected Direct render did not complete through Tiled: ${JSON.stringify(result)}`);
    assert(result.planMode === "tiled" && result.violations.includes("budget"),
      `The low budget did not force the real admission planner to Tiled: ${JSON.stringify(result)}`);
    assert(result.accepted?.execution === "tiled" && result.accepted?.transport === "WebGPU",
      `The accepted presentation does not identify tiled execution: ${JSON.stringify(result)}`);
    assert(result.tiledMetrics?.submissions === 2
      && result.tiledMetrics?.presentableGeneration === result.accepted?.generation,
      `The admitted tiled generation was not atomic: ${JSON.stringify(result)}`);
    assert(result.scopeSourcePresent === false,
      `A tiled presentation retained the stale Direct scope texture: ${JSON.stringify(result)}`);
    assert(result.scopeApplied === true && result.scope?.source === "cpu" && !result.scope?.timeout,
      `The tiled presentation did not settle through the CPU scope route: ${JSON.stringify(result)}`);
    assert(result.gpuScopeCallsDuringRefresh === 0,
      `The tiled presentation attempted to analyze a missing GPU scope source: ${JSON.stringify(result)}`);
    assert(result.freshness === "Settled" && result.freshnessUpdating === false,
      `The CPU scope did not become truthfully fresh: ${JSON.stringify(result)}`);
    assert(pageErrors.length === 0, `Browser errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
