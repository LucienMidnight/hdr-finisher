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
    await context.addInitScript(() => {
      const key = "hdr-finisher:application-preferences:v1";
      if (!localStorage.getItem(key)) localStorage.setItem(key,
        JSON.stringify({ schemaVersion: 2, previewResolution: "2048" }));
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    const migration = await page.evaluate(() => ({ preferences: window.HDRApplicationShell.preferences(),
      normalTierSelector: Boolean(document.querySelector("#preview-resolution")),
      diagnosticTierSelector: Boolean(document.querySelector("#settings-preview-resolution")),
      notice: !document.querySelector("#preview-migration-notice").classList.contains("hidden") }));
    // P5: the 2K tier migrated to Balanced, which is now the default (off).
    assert.equal(migration.preferences.fasterDragging, false);
    assert.equal(migration.preferences.previewResolution, "auto");
    assert.equal(migration.preferences.previewMigration.previousTier, "2048");
    assert.equal(migration.normalTierSelector, false);
    assert.equal(migration.diagnosticTierSelector, true);
    assert.equal(migration.notice, true);
    await page.evaluate(() => document.querySelector("#preview-migration-dismiss").click());
    await page.evaluate(() => {
      const faster = document.querySelector("#preview-faster-dragging");
      faster.checked = true;
      faster.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => window.HDRApplicationShell.preferences().fasterDragging === true);
    await page.reload({ waitUntil: "networkidle" });
    const roundTrip = await page.evaluate(() => ({ faster: state.fasterDragging,
      migration: window.HDRApplicationShell.preferences().previewMigration }));
    assert.equal(roundTrip.faster, true);
    assert.equal(roundTrip.migration.noticeShown, true);
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

    await page.evaluate(() => {
      state.previewScheduler.timings.settleMs = 2500;
      state.previewLatencyController.samples.set(previewGraphTimingKey(), { msPerPixel: 0.001, count: 1 });
    });
    await page.evaluate(() => {
      // P5: a softer frame is only for an active gesture.
      state.previewScheduler.beginInteraction();
      const control = document.querySelector("#hdr-exposure");
      control.value = "0.5";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
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
    const result = { migration, roundTrip, fit, coarse, responsive: { edge: responsive.edge,
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
