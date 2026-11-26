const { chromium } = require("playwright");
const { importTestPattern } = require("./helpers/import-test-pattern");

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
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const previewRequests = [];
    const stripResponses = [];
    const stripPeaks = [];
    page.on("request", (request) => {
      if (request.method() !== "POST" || !/\/preview(?:-raw)?\/(?:hdr|sdr)$/.test(new URL(request.url()).pathname)) return;
      try { previewRequests.push({ url: request.url(), body: request.postDataJSON() }); } catch {}
    });
    page.on("response", async (response) => {
      if (!/\/preview(?:-raw)?\/(?:hdr|sdr)$/.test(new URL(response.url()).pathname)) return;
      const headers = await response.allHeaders();
      if (headers["x-strip-execution"]) stripResponses.push(headers["x-strip-execution"]);
      if (headers["x-scope-peak"]) stripPeaks.push(Number(headers["x-scope-peak"]));
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    // Full remains available to diagnostics after the normal preview control
    // switches to response preferences.
    const fullOptions = await page.evaluate(() => ({
      preview: document.querySelector('#preview-resolution option[value="full"]')?.textContent,
      settings: document.querySelector('#settings-preview-resolution option[value="full"]')?.textContent,
    }));
    assert(fullOptions.preview === undefined && fullOptions.settings === "Full",
      `Full diagnostic override was not offered as expected: ${JSON.stringify(fullOptions)}`);

    await importTestPattern(page);
    await page.waitForFunction(() => state.session?.session_id && viewerState().status === "ready", null, { timeout: 120000 });
    await page.locator("#settings-preview-resolution").evaluate((select) => {
      select.value = "full";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => state.acceptedPresentation?.requestedTier === "full"
      && state.acceptedPresentation?.exact === true && viewerState().status === "ready", null, { timeout: 120000 });

    const gpuFull = await page.evaluate(() => {
      const authoring = window.HDRFinisherPerformance.authoringState();
      return {
        accepted: { ...state.acceptedPresentation },
        authoring: {
          previewResolution: authoring.previewResolution,
          previewDimensions: authoring.previewDimensions,
          executionMode: authoring.executionMode,
        },
        source: { width: state.session.source.width, height: state.session.source.height },
      };
    });
    assert(gpuFull.accepted.transport === "WebGPU" && gpuFull.accepted.execution === "direct",
      `Engineering Full did not render on the admitted GPU route: ${JSON.stringify(gpuFull)}`);
    assert(gpuFull.authoring.previewResolution === "full"
      && gpuFull.authoring.previewDimensions.width === gpuFull.source.width
      && gpuFull.authoring.previewDimensions.height === gpuFull.source.height,
    `Full did not retain source dimensions: ${JSON.stringify(gpuFull)}`);

    await page.evaluate(() => applyRenderingMode("cpu"));
    await page.waitForFunction(() => state.acceptedPresentation?.requestedTier === "full"
      && state.acceptedPresentation?.transport !== "WebGPU"
      && viewerState().status === "ready", null, { timeout: 120000 });
    const cpuFull = await page.evaluate(() => ({ ...state.acceptedPresentation }));
    const fullCpuRequests = previewRequests.filter((entry) => entry.body?.execution === "strips");
    assert(fullCpuRequests.length > 0,
      `CPU Full did not request bounded strip execution: ${JSON.stringify(previewRequests)}`);
    assert(stripResponses.length > 0,
      `CPU Full response did not prove strip execution: ${JSON.stringify({ previewRequests, stripResponses })}`);
    assert(cpuFull.exact === true && cpuFull.requestedTier === "full" && cpuFull.tier === "full",
      `CPU Full was not accepted truthfully: ${JSON.stringify(cpuFull)}`);

    assert(stripPeaks.length > 0 && Number.isFinite(stripPeaks.at(-1))
      && cpuFull.scopePeak === stripPeaks.at(-1),
    `CPU Full did not retain the peak measured by its strip render: ${JSON.stringify({ cpuFull, stripPeaks })}`);

    // A settled full-image scope automatically uses a separate bounded peak
    // estimate when WebGPU is available, even with CPU preview selected.
    const firstScopeGeneration = await page.evaluate(() => {
      const first = state.scopeGeneration + 1;
      void refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
      return first;
    });
    await page.waitForFunction((first) => state.lastScope?.tier === "settled"
      && state.lastScope.generation >= first && state.lastScope.generation === state.scopeGeneration,
    firstScopeGeneration, { timeout: 120000 });
    const cpuScope = await page.evaluate(() => {
      const scope = state.lastScope;
      const measurement = exactScopePeakCache.get(exactScopePeakKey("hdr"));
      return {
        tier: scope.tier,
        peakValue: scope.peak_value,
        peakExact: scope.peak_exact,
        peakMeasuredLongEdge: scope.peak_measured_long_edge,
        peakStat: scope.stats?.[0],
        boundedPeak: measurement?.peak / .18 * projectReferenceWhiteNits(),
      };
    });
    assert(cpuScope.peakExact === false && cpuScope.peakStat?.label === "Peak (estimate)"
      && Number.isFinite(cpuScope.boundedPeak) && cpuScope.peakValue === cpuScope.boundedPeak,
    `Settled CPU scope did not show the bounded estimate: ${JSON.stringify(cpuScope)}`);

    console.log(JSON.stringify({
      fullOptions,
      gpuFull,
      cpuFull,
      cpuScope,
      fullCpuRequests,
      stripResponses,
      stripPeaks,
    }, null, 2));
    await page.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
