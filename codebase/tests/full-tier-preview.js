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
    // Full is a shipped tier now, offered in the markup beside 1K/2K/4K
    // rather than installed by a query flag. Both selectors must carry it,
    // because the Settings copy and the viewer popover are the same choice.
    const fullOptions = await page.evaluate(() => ({
      preview: document.querySelector('#preview-resolution option[value="full"]')?.textContent,
      settings: document.querySelector('#settings-preview-resolution option[value="full"]')?.textContent,
    }));
    assert(fullOptions.preview === "Full" && fullOptions.settings === "Full",
      `Full was not offered coherently in both selectors: ${JSON.stringify(fullOptions)}`);

    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.session?.session_id && viewerState().status === "ready", null, { timeout: 120000 });
    await page.locator("#preview-resolution").evaluate((select) => {
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

    assert(stripPeaks.length > 0 && Number.isFinite(stripPeaks.at(-1)),
      `CPU Full response did not carry its exact scope peak: ${JSON.stringify(stripPeaks)}`);
    await page.evaluate(() => refreshScopes(scopeLongEdge("settled"), { tier: "settled" }));
    try {
      await page.waitForFunction(() => state.lastScope?.peak_exact === true
        && state.lastScope?.peak_value === state.acceptedPresentation?.scopePeak,
      null, { timeout: 120000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        accepted: state.acceptedPresentation,
        lastScope: state.lastScope,
        scopeGeneration: state.scopeGeneration,
        previewGeneration: state.previewGeneration,
        currentView: state.currentView,
        scopeExactPeak: state.scopeExactPeak,
        inFlight: state.scopeRequestInFlight && {
          lane: state.scopeRequestInFlight.lane,
          tier: state.scopeRequestInFlight.tier,
          generation: state.scopeRequestInFlight.generation,
        },
      }));
      throw new Error(`CPU Full exact peak never became current: ${JSON.stringify(diagnostics)} (${error.message})`);
    }
    const cpuScope = await page.evaluate(() => ({ scope: state.lastScope }));
    assert(cpuScope.scope?.peak_exact === true
      && cpuScope.scope?.peak_value === stripPeaks.at(-1)
      && cpuScope.scope?.stats?.[0]?.label === "Peak",
    `CPU Full scope did not use the accepted presentation peak: ${JSON.stringify({ cpuScope, stripPeaks })}`);

    console.log(JSON.stringify({
      fullOptions,
      gpuFull,
      cpuFull,
      cpuScope: {
        peakValue: cpuScope.scope.peak_value,
        peakExact: cpuScope.scope.peak_exact,
        peakMeasuredLongEdge: cpuScope.scope.peak_measured_long_edge,
        peakStat: cpuScope.scope.stats?.[0],
      },
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
