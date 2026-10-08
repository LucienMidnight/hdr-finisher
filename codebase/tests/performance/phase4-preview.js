const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const index = process.argv.indexOf("--url");
const url = index >= 0 ? process.argv[index + 1] : "http://127.0.0.1:8799";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge",
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    const start = await page.evaluate(() => ({ preferences: window.HDRApplicationShell.preferences(),
      normalTierSelector: Boolean(document.querySelector("#preview-resolution")),
      diagnosticTierSelector: Boolean(document.querySelector("#settings-preview-resolution")) }));
    assert.equal(start.preferences.fasterDragging, false);
    assert.equal(start.preferences.previewResolution, "auto");
    assert.equal(start.normalTierSelector, false);
    assert.equal(start.diagnosticTierSelector, true);
    await page.evaluate(() => {
      const faster = document.querySelector("#preview-faster-dragging");
      faster.checked = true;
      faster.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => window.HDRApplicationShell.preferences().fasterDragging === true);
    await page.reload({ waitUntil: "networkidle" });
    const roundTrip = await page.evaluate(() => ({ faster: state.fasterDragging }));
    assert.equal(roundTrip.faster, true);
    await page.evaluate(() => {
      const override = document.querySelector("#settings-preview-resolution");
      override.value = "4096";
      override.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => state.previewResolutionOverride && state.previewResolution === "4096");
    await page.evaluate(() => {
      const override = document.querySelector("#settings-preview-resolution");
      override.value = "auto";
      override.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => !state.previewResolutionOverride);
    await page.setInputFiles("#file-input", ensureLargeNoisySource(2400, 1600));
    await page.waitForFunction(() => state.gpuPreview?.available && viewerState().status === "ready", null,
      { timeout: 120000 });
    const fit = await page.evaluate(() => ({ processed: state.acceptedPresentation.processedLongEdge,
      native: Math.max(state.session.source.width, state.session.source.height),
      status: viewerStatusLabel(), output: state.acceptedPresentation.requestedTier }));
    assert.equal(fit.output, "display");
    assert.ok(fit.processed < fit.native, JSON.stringify(fit));

    const gestureSetup = await page.evaluate(async () => {
      // Finish automatic import/anchor work before injecting a slow graph sample.
      // Its real timings must not overwrite the sample before this gesture runs.
      const deadline = performance.now() + 120000;
      while (state.gpuDraftInFlight || state.previewScheduler?.frameInFlight
        || state.scopeRequestInFlight || state.gpuScopeRequestInFlight
        || state.pendingScopeRequest || state.pendingGpuScopeRequest
        || pendingHighlightAnchors.size || exactHighlightAnchorInflight.size) {
        if (performance.now() > deadline) throw new Error("Automatic setup work did not settle");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      state.previewScheduler.cancel();
      window.clearTimeout(state.refreshTimer);
      state.renderCoordinator.cancelCatchUp(state.currentView);
      state.renderCoordinator.cancelPan(state.currentView);
      state.previewScheduler.timings.settleMs = 2500;
      // Faster Dragging now uses Balanced timing: exercise its learned slow
      // graph path explicitly instead of assuming the old Responsive cold start.
      state.previewScheduler.beginInteraction();
      state.previewLatencyController.samples.set(previewGraphTimingKey(), { msPerPixel: 0.001, count: 1 });
      const decision = interactiveScaleDecision(state.currentView, { interacting: true });
      const control = document.querySelector("#hdr-exposure");
      control.value = "0.5";
      control.dispatchEvent(new Event("input", { bubbles: true }));
      return { fasterDragging: state.fasterDragging, decision };
    });
    assert.equal(gestureSetup.fasterDragging, true);
    assert.equal(gestureSetup.decision.coarse, true, JSON.stringify(gestureSetup));
    await page.waitForFunction(() => viewerStatusLabel().startsWith("Coarse —"), null, { timeout: 30000 });
    const coarse = await page.evaluate(() => ({ edge: state.acceptedPresentation.processedLongEdge,
      exact: state.acceptedPresentation.exact, label: viewerStatusLabel(),
      generation: state.acceptedPresentation.generation }));
    assert.equal(coarse.exact, false);
    await page.evaluate(() => state.previewScheduler.endInteraction());
    await page.waitForFunction(() => viewerState().status === "ready" && state.acceptedPresentation.exact,
      null, { timeout: 120000 });
    const responsive = await page.evaluate(() => ({
      edge: state.acceptedPresentation.processedLongEdge,
      generation: state.acceptedPresentation.generation,
    }));
    const responsivePixels = await page.locator("#preview-canvas").screenshot();
    assert.ok(responsive.edge > coarse.edge);
    assert.ok(responsive.generation >= coarse.generation, JSON.stringify({ coarse, responsive }));

    await page.evaluate(() => {
      const faster = document.querySelector("#preview-faster-dragging");
      faster.checked = false;
      faster.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.evaluate(() => renderGpuDraft(state.currentView,
      { tier: "refinement", longEdge: refinementProxyLongEdge(), reason: "phase4-no-coarse-control" }));
    const precisePixels = await page.locator("#preview-canvas").screenshot();
    assert.ok(precisePixels.equals(responsivePixels), "refinement differs from the exact no-coarse control");

    const reversal = await page.evaluate(() => {
      window.__phase4Events = [];
      window.addEventListener("hdrfinisher:preview-presented", (event) =>
        window.__phase4Events.push({ generation: event.detail.generation,
          coarse: Boolean(state.acceptedPresentation?.coarse) }));
      const control = document.querySelector("#hdr-exposure");
      for (const value of ["1", "-1", "0.5"]) {
        control.value = value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return { currentAtInput: state.previewGeneration.hdr };
    });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 120000 });
    const finalState = await page.evaluate(() => ({ accepted: state.acceptedPresentation.generation,
      current: state.previewGeneration.hdr, presented: window.__phase4Events }));
    assert.equal(finalState.accepted, finalState.current);
    assert.ok(finalState.presented.every((record) => record.generation === finalState.current && !record.coarse),
      JSON.stringify(finalState));
    await page.evaluate(() => setZoomMode("actual"));
    await page.waitForFunction(() => viewerState().status === "ready"
      && state.acceptedPresentation.processedLongEdge === Math.max(state.session.source.width, state.session.source.height),
    null, { timeout: 120000 });
    const native = await page.evaluate(() => ({ processed: state.acceptedPresentation.processedLongEdge,
      backing: els.previewCanvas.width, css: els.previewCanvas.getBoundingClientRect().width,
      dpr: window.devicePixelRatio, status: viewerStatusLabel() }));
    assert.ok(Math.abs(native.backing - native.css * native.dpr) <= 1, JSON.stringify(native));
    assert.equal(errors.length, 0, errors.join(" | "));
    const result = { roundTrip, fit, coarse, responsive: { edge: responsive.edge,
      generation: responsive.generation }, parity: "byte-equal", reversal, finalState, native, errors };
    const output = path.join(__dirname, "../../output/performance/phase4-preview.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
