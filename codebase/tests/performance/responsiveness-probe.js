// Preview Responsiveness Tuning Sprint: route and work probe.
//
//   node tests/run-in-electron.js tests/performance/responsiveness-probe.js [--packaged]
//        [--zooms fit,100,200,400,800] [--samples 3] [--budget auto] [--output path]
//
// For each zoom, performs real Exposure slider strokes on the 42.4 MP fixture
// and records every render the app issued for that stroke: tier, requested
// edge, whether a viewport was requested, the renderer's admission decision
// (mode, admitted, violations, peak versus budget, the source-proxy charge),
// the tiled processed-pixel count, refusals, and wall time; plus the stroke's
// release -> exact-current-generation time. This is the "before" instrument
// for P2/P3 and the diagnosis check the sprint requires before any fix: it
// says which route ran and how much of the image it processed, measured.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799");
const outputPath = path.resolve(option("--output", "output/performance/responsiveness-probe.json"));
const zooms = option("--zooms", "fit,100,200,400,800").split(",");
const samples = Math.max(1, Number(option("--samples", "3")));
const budget = option("--budget", "auto");
const preference = option("--preference", "");
// Diagnosis-only experiments, applied in the page without touching the code:
//   direct-at-zoom  drops the forced-Tiled override on viewport requests and
//                   charges one source level, so an admitted region request
//                   runs Direct over the whole frame.
const experiment = option("--experiment", "");
const viewportParts = option("--viewport", "2560x1440").split("x").map(Number);
const viewport = { width: viewportParts[0] || 2560, height: viewportParts[1] || 1440 };
const SOURCE = option("--input", "") ? path.resolve(option("--input", "")) : ensureLargeNoisySource(7968, 5320);

function percentile(values, amount) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))];
}

async function installRecorder(page) {
  await page.evaluate(() => {
    if (window.__probe) return;
    const probe = { renders: [], releases: [] };
    const preview = state.gpuPreview;
    const inner = preview.render.bind(preview);
    const innerPlan = preview.planRender.bind(preview);
    let activeEntry = null;
    preview.planRender = (...planArguments) => {
      if (window.__probeExperiment === "direct-at-zoom" && planArguments[2]) {
        const options = { ...planArguments[2], cachedProxyLevels: 1 };
        if (options.executionOverride === "tiled") delete options.executionOverride;
        planArguments[2] = options;
      }
      const plan = innerPlan(...planArguments);
      if (activeEntry && !activeEntry.plan) activeEntry.plan = plan;
      return plan;
    };
    preview.render = async (...parameters) => {
      const sourceOptions = parameters[10] || {};
      const startedAt = performance.now();
      const entry = {
        startedAt,
        tier: sourceOptions.tier || null,
        longEdge: parameters[4],
        viewport: Boolean(sourceOptions.viewport),
        generation: sourceOptions.applicationGeneration ?? null,
      };
      probe.renders.push(entry);
      activeEntry = entry;
      const metricsBefore = preview.tiledExecutionMetrics;
      let result = null;
      try {
        result = await inner(...parameters);
      } finally {
        entry.ms = performance.now() - startedAt;
        entry.endedAt = performance.now();
        if (activeEntry === entry) activeEntry = null;
        const plan = entry.plan;
        delete entry.plan;
        entry.decision = plan ? {
          mode: plan.decision.mode,
          admitted: plan.decision.admitted,
          overridden: plan.decision.overridden,
          violations: plan.decision.violations.map((violation) => violation.rule),
          peakMiB: Math.round(plan.totals.peakLogicalBytes / 1048576),
          budgetMiB: Math.round(plan.budgetBytes / 1048576),
          sourceChargeMiB: Math.round((plan.entries.find((item) => item.id === "source-proxy")?.bytes || 0) / 1048576),
          proxyLevels: plan.entries.find((item) => item.id === "source-proxy")?.levels ?? null,
          width: plan.width,
          height: plan.height,
        } : null;
        entry.rendered = Boolean(result);
        entry.refusal = result ? null : (preview.lastRenderRefusal?.reason || null);
        entry.execution = result?.execution || (result ? (result.tiles ? "tiled" : "direct") : null);
        const metrics = preview.tiledExecutionMetrics;
        const fresh = metrics && metrics !== metricsBefore;
        entry.tiled = fresh ? {
          processedPixels: metrics.processedPixels ?? null,
          foregroundTiles: metrics.foregroundTiles ?? null,
          tileCount: metrics.tileCount ?? null,
          retainedFrame: metrics.retainedFrame ?? null,
          viewportRequested: metrics.viewportRequested ?? null,
          sourceRoute: metrics.sourceRoute ?? null,
        } : null;
        entry.processedPixels = result && entry.decision?.mode === "tiled" ? (fresh ? metrics.processedPixels ?? null : null)
          : (result ? (entry.decision?.width || 0) * (entry.decision?.height || 0) : null);
      }
      return result;
    };
    window.addEventListener("pointerup", (event) => {
      probe.releases.push({ t: event.timeStamp, now: performance.now() });
    }, true);
    window.__probe = probe;
  });
}

async function waitForIdle(page, timeout = 300000) {
  await page.waitForFunction(() => viewerState().status === "ready", null, { timeout }).catch(() => null);
  await page.waitForTimeout(900);
  await page.waitForFunction(() => viewerState().status === "ready", null, { timeout }).catch(() => null);
}

async function stroke(page, deltaX) {
  const control = page.locator('[data-path="hdr.exposure"]').first();
  const box = await control.boundingBox();
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(x + (deltaX * step) / 12, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

async function measureStroke(page, deltaX) {
  await page.evaluate(() => { window.__probe.renders = []; window.__probe.releases = []; });
  const startedAt = await page.evaluate(() => performance.now());
  await stroke(page, deltaX);
  const settled = await page.evaluate(async () => {
    const release = window.__probe.releases.at(-1);
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      const accepted = state.acceptedPresentation;
      if (accepted && accepted.exact === true
        && accepted.generation === state.previewGeneration[state.currentView]
        && viewerState().status === "ready") {
        return { releaseToSettledMs: performance.now() - release.now, acceptedTier: accepted.tier };
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return { releaseToSettledMs: null };
  });
  await waitForIdle(page);
  const gpu = await page.evaluate((since) => (state.gpuPreview.performanceMetrics?.renders || [])
    .filter((metric) => metric.gpuMs !== null || metric.queueCompleteMs !== null)
    .slice(-40)
    .map((metric) => ({ longEdge: metric.longEdge, gpuMs: metric.gpuMs, queueCompleteMs: metric.queueCompleteMs, submissionMs: metric.submissionMs })), startedAt);
  await page.evaluate(() => { if (state.gpuPreview.performanceMetrics) state.gpuPreview.performanceMetrics.renders = []; });
  const renders = await page.evaluate((since) => window.__probe.renders
    .map((entry) => ({ ...entry, startedAt: entry.startedAt - since, endedAt: entry.endedAt - since })), startedAt);
  return { ...settled, renders, gpu };
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", SOURCE);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 300000 });
    await waitForIdle(page, 900000);
    if (preference) {
      await page.evaluate((value) => {
        const select = document.getElementById("preview-latency");
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, preference);
    }
    await page.evaluate((value) => {
      window.__probeExperiment = value || null;
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
    }, experiment);
    if (budget !== "auto") {
      await page.evaluate((value) => applyGpuMemoryBudget(value), budget);
    }
    await page.evaluate(() => activateWorkflowTab("grade"));
    await page.evaluate(() => {
      const toggle = document.querySelector('section[data-group="hdr-tone"] .group-toggle');
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
    });
    await page.waitForTimeout(400);
    await installRecorder(page);
    const environment = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      preference: document.getElementById("preview-latency")?.value ?? null,
      roiPreviewMode: state.roiPreviewMode,
      budget: state.gpuPreview?.diagnosticsSnapshot?.()?.budget || null,
      gpuMemoryBudgetSetting: state.gpuMemoryBudget,
      source: state.session?.source ? { width: state.session.source.width, height: state.session.source.height } : null,
    }));

    const rows = [];
    for (const zoom of zooms) {
      await page.evaluate((value) => (value === "fit" ? setZoomMode("fit") : setCustomZoom(Number(value))), zoom);
      await waitForIdle(page);
      const strokes = [];
      for (let sample = 0; sample < samples; sample += 1) {
        strokes.push(await measureStroke(page, sample % 2 === 0 ? 40 : -40));
      }
      const visible = await page.evaluate(() => {
        const rect = visibleOutputRect(els.previewCanvas.width, els.previewCanvas.height);
        return { canvas: [els.previewCanvas.width, els.previewCanvas.height], visible: rect };
      });
      const all = strokes.flatMap((entry) => entry.renders);
      const summary = {
        zoom,
        ...visible,
        releaseToSettledMs: strokes.map((entry) => entry.releaseToSettledMs),
        releaseToSettledMedianMs: percentile(strokes.map((entry) => entry.releaseToSettledMs), 0.5),
        rendersPerStroke: all.length / strokes.length,
        byTier: {},
      };
      for (const render of all) {
        const key = `${render.tier}:${render.rendered ? (render.decision?.mode || "?") : `refused(${render.refusal})`}`;
        const bucket = summary.byTier[key] || (summary.byTier[key] = { count: 0, ms: [], processedPixels: [], viewport: 0, violations: new Set(), decisions: [] });
        bucket.count += 1;
        bucket.ms.push(render.ms);
        if (Number.isFinite(render.processedPixels)) bucket.processedPixels.push(render.processedPixels);
        if (render.viewport) bucket.viewport += 1;
        (render.decision?.violations || []).forEach((rule) => bucket.violations.add(rule));
        if (bucket.decisions.length < 1) bucket.decisions.push(render.decision);
      }
      for (const bucket of Object.values(summary.byTier)) {
        bucket.medianMs = percentile(bucket.ms, 0.5);
        bucket.maxProcessedPixels = bucket.processedPixels.length ? Math.max(...bucket.processedPixels) : null;
        bucket.violations = [...bucket.violations];
        delete bucket.ms;
        delete bucket.processedPixels;
      }
      rows.push({ summary, strokes });
      console.log(JSON.stringify(summary, null, 1));
    }
    const report = { recordedAt: new Date().toISOString(), environment, budget, preference, experiment, rows, pageErrors };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ environment, pageErrors }, null, 1));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
