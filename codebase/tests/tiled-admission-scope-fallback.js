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
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 120000 });
    await page.waitForFunction(() => !state.gpuDraftInFlight
      && !state.scopeRequestInFlight && !state.gpuScopeRequestInFlight, null, { timeout: 120000 });

    const result = await page.evaluate(async () => {
      const renderer = state.gpuPreview;
      const originalBudget = state.gpuMemoryBudget;
      const fakeKeys = [];
      // The built-in pattern is intentionally small. Represent a warm proxy
      // cache so the real planner rejects Direct at the minimum custom budget,
      // without allocating hundreds of megabytes merely to exercise routing.
      for (let index = 0; index < 64; index += 1) {
        const key = `tiled-admission-budget-fixture-${index}`;
        fakeKeys.push(key);
        renderer.proxies.set(key, { byteSize: els.previewCanvas.width * els.previewCanvas.height * 8 });
      }

      const originalAnalyzeScope = renderer.analyzeScope.bind(renderer);
      let gpuScopeCalls = 0;
      renderer.analyzeScope = async (...args) => {
        gpuScopeCalls += 1;
        return originalAnalyzeScope(...args);
      };

      try {
        applyGpuMemoryBudget(0.25);
        const rendered = await renderGpuDraft("hdr", {
          longEdge: previewTargetLongEdge(),
          tier: "settled",
        });
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
        renderer.analyzeScope = originalAnalyzeScope;
        fakeKeys.forEach((key) => renderer.proxies.delete(key));
        applyGpuMemoryBudget(originalBudget);
      }
    });

    assert(result.rendered === true, `Budget-rejected Direct render did not complete through Tiled: ${JSON.stringify(result)}`);
    assert(result.planMode === "tiled" && result.violations.includes("budget"),
      `The low budget did not force the real admission planner to Tiled: ${JSON.stringify(result)}`);
    assert(result.accepted?.execution === "tiled" && result.accepted?.transport === "WebGPU",
      `The accepted presentation does not identify tiled execution: ${JSON.stringify(result)}`);
    assert(result.tiledMetrics?.submissions === 1,
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
