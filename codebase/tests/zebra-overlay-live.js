// Regression driver: the exposure overlay (zebra / false colour) must follow
// exposure edits, during a drag and after release.
//
//   node tests/run-in-electron.js tests/zebra-overlay-live.js
//
// Drags the real HDR Exposure slider with the zebra overlay on, then records
// every overlay request (the edit revision it asked for) and every time the
// overlay image changes. It passes when the overlay on screen after the viewer
// settles was rendered for the final edit, and when the overlay changed while
// the drag was still in progress.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("./large-noisy-tiff.js");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799");
const outputPath = path.resolve(option("--output", "output/performance/zebra-overlay-live.json"));
const mode = option("--mode", "zebra");
const dragMs = Math.max(400, Number(option("--drag-ms", "2400")));
// The noisy fixture sits near reference white, so the default 100-nit zebra
// covers it even at the slider floor. A higher threshold puts the zebra edge
// inside the slider's range, which is what makes "does it recede" testable.
const thresholdNits = Number(option("--threshold-nits", "400"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const installProbe = () => {
  const probe = { requests: [], swaps: [] };
  window.__overlayProbe = probe;
  const originalFetch = window.fetch;
  window.fetch = function probedFetch(input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    if (/\/overlay\/(hdr|sdr)$/.test(url.replace(/\?.*$/, ""))) {
      let body = {};
      try { body = JSON.parse(init?.body || "{}"); } catch { /* not JSON */ }
      probe.requests.push({ at: performance.now(), editRevision: body.edit_revision, longEdge: body.long_edge });
    }
    return originalFetch.call(this, input, init);
  };
  const watch = () => {
    const overlay = document.getElementById("preview-overlay");
    if (!overlay) return setTimeout(watch, 100);
    // Coverage is what the overlay actually says: the fraction of its pixels
    // drawn (alpha > 0). A swap count alone would pass an overlay that is
    // re-sent unchanged.
    const coverageOf = (src) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const width = 160;
        const height = Math.max(1, Math.round(width * image.naturalHeight / Math.max(1, image.naturalWidth)));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;
        let drawn = 0;
        for (let index = 3; index < data.length; index += 4) if (data[index] > 0) drawn += 1;
        resolve(drawn / (width * height));
      };
      image.onerror = () => resolve(null);
      image.src = src;
    });
    let lastSrc = null;
    new MutationObserver(() => {
      const src = overlay.getAttribute("src");
      const visible = overlay.style.display !== "none" && Boolean(src);
      if (visible && src === lastSrc) return;
      lastSrc = src;
      const swap = {
        at: performance.now(),
        editRevision: window.state?.editRevision ?? null,
        exposure: window.state?.adjustments?.hdr?.exposure ?? null,
        visible,
        coverage: null,
      };
      probe.swaps.push(swap);
      if (visible) coverageOf(src).then((coverage) => { swap.coverage = coverage; });
    }).observe(overlay, { attributes: true, attributeFilter: ["src", "style"] });
    return null;
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", watch) : watch();
};

(async () => {
  const browser = await chromium.launch({ headless: false, channel: option("--channel", "msedge") });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.addInitScript(installProbe);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#file-input").setInputFiles(ensureLargeNoisySource(4000, 2667));
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 600000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 600000 });

    if (mode !== "off") await page.evaluate(({ overlayMode, threshold }) => {
      // The same entry point the Overlays menu uses for these settings.
      if (overlayMode === "zebra") commitAdjustmentValue("shared.overlay_threshold", threshold);
      commitAdjustmentValue("shared.overlay_mode", overlayMode);
    }, { overlayMode: mode, threshold: thresholdNits });
    const shown = mode === "off" || await page.waitForFunction(() => {
      const overlay = document.getElementById("preview-overlay");
      return overlay.style.display !== "none" && overlay.getAttribute("src");
    }, null, { timeout: 60000 }).then(() => true, () => false);
    if (!shown) {
      const debug = await page.evaluate(() => ({
        mode: state.adjustments.shared.overlay_mode,
        requests: window.__overlayProbe.requests,
        swaps: window.__overlayProbe.swaps,
        overlay: { src: document.getElementById("preview-overlay").getAttribute("src"),
          display: document.getElementById("preview-overlay").style.display },
        dirty: state.globalEditDirty,
        viewer: viewerState(),
      }));
      throw new Error(`The ${mode} overlay never appeared: ${JSON.stringify(debug)}`);
    }
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 120000 });
    await page.waitForTimeout(800);

    const slider = page.locator("#hdr-exposure");
    // Exposure lives in the HDR Tone group, which starts collapsed.
    if (!(await slider.isVisible())) await page.locator('[data-group="hdr-tone"] .group-toggle').click();
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    assert(box, "The HDR Exposure slider is not visible.");
    const y = box.y + box.height / 2;
    // Start at 0 EV (the middle) and pull exposure down: the fixture clips
    // there, so the zebra must recede as the drag goes.
    // Pointer-down jumps to the clicked value, then the drag is relative, so
    // each stroke starts on the thumb and runs to the left edge until the
    // slider's floor (set by the latitude preset) is reached.
    const endX = box.x + 2;
    const strokes = Math.max(1, Number(option("--strokes", "4")));
    const thumbX = async () => {
      const { value, min, max } = await slider.evaluate((input) => ({
        value: Number(input.value), min: Number(input.min), max: Number(input.max),
      }));
      return box.x + box.width * ((value - min) / (max - min));
    };
    const before = await page.evaluate(() => ({
      revision: state.editRevision, exposure: state.adjustments.hdr.exposure, now: performance.now(),
      frames: state.previewScheduler.snapshot().frameCount,
      renderSamples: state.previewScheduler.snapshot().renderMs.length,
    }));
    const dragStartedAt = await page.evaluate(() => performance.now());
    const steps = 24;
    for (let stroke = 0; stroke < strokes; stroke += 1) {
      const startX = await thumbX();
      await page.mouse.move(startX, y);
      await page.mouse.down();
      for (let index = 1; index <= steps; index += 1) {
        await page.mouse.move(startX + ((endX - startX) * index) / steps, y);
        await page.waitForTimeout(dragMs / strokes / steps);
      }
      if (stroke < strokes - 1) await page.mouse.up();
    }
    const dragMetrics = await page.evaluate(() => ({
      at: performance.now(),
      frames: state.previewScheduler.snapshot().frameCount,
      renderMs: state.previewScheduler.snapshot().renderMs,
    }));
    const releasedAt = dragMetrics.at;
    // Interactive frames presented during the drag and their render time: the
    // cost of the live overlay is read against a `--mode off` run.
    const framesDuringDrag = dragMetrics.frames - before.frames;
    const dragRenderMs = dragMetrics.renderMs.slice(-Math.max(1, framesDuringDrag)).sort((a, b) => a - b);
    const renderP50 = dragRenderMs.length ? Math.round(dragRenderMs[Math.floor(dragRenderMs.length / 2)]) : null;
    await page.mouse.up();

    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 120000 });
    // Give any post-settle overlay request time to land.
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => ({
      revision: state.editRevision,
      exposure: state.adjustments.hdr.exposure,
      generation: state.previewGeneration.hdr,
      accepted: state.acceptedPresentation
        ? { generation: state.acceptedPresentation.generation, exact: state.acceptedPresentation.exact }
        : null,
      overlayPresented: state.overlayPresented,
      probe: window.__overlayProbe,
      now: performance.now(),
    }));
    const requestsDuring = after.probe.requests.filter((r) => r.at >= dragStartedAt && r.at <= releasedAt);
    const requestsAfter = after.probe.requests.filter((r) => r.at > releasedAt);
    const swapsDuring = after.probe.swaps.filter((s) => s.at >= dragStartedAt && s.at <= releasedAt && s.visible);
    const swapsAfter = after.probe.swaps.filter((s) => s.at > releasedAt && s.visible);
    const finalRequest = after.probe.requests[after.probe.requests.length - 1] || null;
    const visibleSwaps = after.probe.swaps.filter((s) => s.visible && s.coverage !== null);
    const coverageBefore = visibleSwaps.filter((s) => s.at < dragStartedAt).pop()?.coverage ?? null;
    const coverageDuring = swapsDuring.map((s) => s.coverage).filter((c) => c !== null);
    const coverageFinal = visibleSwaps[visibleSwaps.length - 1]?.coverage ?? null;
    const round = (value) => (value === null ? null : Math.round(value * 1000) / 1000);
    const evidence = {
      recordedAt: new Date().toISOString(),
      mode,
      before,
      after: { ...after, probe: undefined },
      requestsDuring: requestsDuring.length,
      swapsDuring: swapsDuring.length,
      requestsAfter,
      swapsAfter,
      finalRequest,
      // What the overlay on screen was actually rendered for: the final edit,
      // the presented generation, and a settled (not interim) request. The
      // settle can land before pointer-up when the value stops changing first,
      // so this is judged on content, not on timing.
      finalOverlayCurrent: Boolean(after.overlayPresented
        && after.overlayPresented.revision === after.revision
        && after.overlayPresented.generation === after.generation
        && after.overlayPresented.interim === false),
      framesDuringDrag,
      dragRenderP50Ms: renderP50,
      coverageBefore,
      coverageDuring,
      coverageFinal,
      pageErrors,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({
      exposure: [before.exposure, after.exposure],
      revision: [before.revision, after.revision],
      requestsDuring: evidence.requestsDuring,
      swapsDuring: evidence.swapsDuring,
      requestsAfter: requestsAfter.map((r) => r.editRevision),
      swapsAfter: swapsAfter.length,
      finalOverlayCurrent: evidence.finalOverlayCurrent,
      framesDuringDrag,
      dragRenderP50Ms: renderP50,
      coverage: {
        before: round(coverageBefore),
        during: coverageDuring.filter((_, index) => index % 4 === 0).map(round),
        final: round(coverageFinal),
      },
      outputPath,
    }, null, 2));
    assert(after.exposure !== before.exposure, "The drag did not change exposure.");
    if (mode === "off") return;
    assert(evidence.finalOverlayCurrent,
      `After the viewer settled, the overlay on screen was not a settled render of the final edit `
      + `(revision ${after.revision}, generation ${after.generation}; presented ${JSON.stringify(after.overlayPresented)}).`);
    assert(swapsDuring.length > 0, "The overlay never changed during the exposure drag.");
    if (mode === "zebra") {
      assert(coverageBefore !== null && coverageBefore > 0.2,
        `The starting frame should be substantially zebra at 0 EV (coverage ${coverageBefore}); lower --threshold-nits.`);
      const lowestDuring = Math.min(...coverageDuring);
      assert(lowestDuring < coverageBefore * 0.8,
        `Zebra coverage did not fall during the drag (before ${round(coverageBefore)}, lowest during ${round(lowestDuring)}).`);
      const floor = await slider.evaluate((input) => Number(input.min));
      assert(after.exposure <= floor + 0.1, `The drag only reached ${after.exposure} EV (floor ${floor}).`);
      assert(coverageFinal !== null && coverageFinal < coverageBefore * 0.5,
        `After pulling exposure down the zebra did not recede (before ${round(coverageBefore)}, final ${round(coverageFinal)}).`);
    }
    assert(pageErrors.length === 0, `Page errors occurred: ${pageErrors.join(" | ")}`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
