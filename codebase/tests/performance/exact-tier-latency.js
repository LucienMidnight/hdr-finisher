// Measure the section 11.1 acceptance targets on a real WebGPU adapter.
//
// Phases 1-3 were verified for behavior but not for timing, because the in-app
// browser has no WebGPU adapter. Playwright can reach one with the same flags
// the existing GPU suites use, so this harness records what exact-tier
// interaction actually costs now that the interaction proxy is gone.
//
//   node tests/performance/exact-tier-latency.js \
//     --url http://127.0.0.1:8000 \
//     --input local-test-media/inputs/<file> \
//     --repetitions 24 --out output/performance/exact-tier-latency.json
//
// Targets, from PRD section 11.1:
//   - UI input handling            <= 16.7 ms p95
//   - Updating/Preparing feedback  <= 100 ms
//   - 1K/2K cached and pointwise   <= 16.7 ms p95
//   - 4K cached and pointwise      <= 33 ms p95
//   - stale presentations          == 0

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function percentile(values, amount) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))];
}

function summarize(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  return {
    samples: clean.length,
    medianMs: round(percentile(clean, 0.5)),
    p95Ms: round(percentile(clean, 0.95)),
    maxMs: clean.length ? round(Math.max(...clean)) : null,
  };
}

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 100) / 100;
}

const TIERS = [
  { value: "1024", label: "1K", inputTargetMs: 16.7, renderTargetMs: 16.7 },
  { value: "2048", label: "2K", inputTargetMs: 16.7, renderTargetMs: 16.7 },
  { value: "4096", label: "4K", inputTargetMs: 16.7, renderTargetMs: 33 },
];

async function selectTier(page, tier) {
  await page.evaluate((value) => {
    const selector = document.getElementById("preview-resolution");
    selector.value = value;
    selector.dispatchEvent(new Event("change", { bubbles: true }));
  }, tier);
  await page.waitForFunction(
    () => viewerState().status === "ready",
    null,
    { timeout: 180000 },
  );
}

async function measureTier(page, tier, repetitions) {
  await selectTier(page, tier.value);

  const before = await page.evaluate(() => {
    const snapshot = window.HDRFinisherPerformance.snapshot();
    const gpu = window.HDRFinisherPerformance.gpuSnapshot?.();
    return {
      renderCount: snapshot.renderMs.length,
      queueCount: snapshot.queueDelayMs.length,
      settleCount: snapshot.settleMs.length,
      staleResults: snapshot.staleResults,
      presentationCount: gpu?.presentations?.length || 0,
    };
  });

  const interaction = await page.evaluate(async (count) => {
    const control = document.getElementById("hdr-exposure")
      || document.querySelector('input[type="range"][data-path*="exposure"]')
      || document.querySelector('input[type="range"]');
    if (!control) return { error: "no range control found" };

    const inputHandlingMs = [];
    const feedbackMs = [];
    const presentedTiers = new Set();
    let nonExactPresentations = 0;
    const original = Number(control.value);

    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

    state.previewScheduler?.beginInteraction?.();
    for (let index = 0; index < count; index += 1) {
      const value = original + ((index % 8) - 4) * Number(control.step || 0.01) * 4;
      control.value = String(value);

      // The synchronous cost of handling one input event is what the UI
      // responsiveness target is about.
      const dispatchedAt = performance.now();
      control.dispatchEvent(new Event("input", { bubbles: true }));
      inputHandlingMs.push(performance.now() - dispatchedAt);

      // How long until the viewer admits it is working.
      const feedbackStart = performance.now();
      let waited = 0;
      while (viewerState().status === "ready" && waited < 60) {
        await nextFrame();
        waited += 1;
      }
      feedbackMs.push(performance.now() - feedbackStart);

      const accepted = state.acceptedPresentation;
      if (accepted) {
        presentedTiers.add(accepted.tier || "placeholder");
        if (accepted.exact !== true) nonExactPresentations += 1;
      }
      await nextFrame();
    }
    state.previewScheduler?.endInteraction?.();
    control.value = String(original);
    control.dispatchEvent(new Event("input", { bubbles: true }));

    return {
      inputHandlingMs,
      feedbackMs,
      presentedTiers: [...presentedTiers],
      nonExactPresentations,
      controlId: control.id || control.getAttribute("data-path") || "range",
    };
  }, repetitions);

  await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 180000 });

  const after = await page.evaluate((counts) => {
    const snapshot = window.HDRFinisherPerformance.snapshot();
    const gpu = window.HDRFinisherPerformance.gpuSnapshot?.() || null;
    const authoring = window.HDRFinisherPerformance.authoringState();
    return {
      renderMs: snapshot.renderMs.slice(counts.renderCount),
      // submitToPresentMs is the honest end-to-end figure: GPU submit through
      // the animation frame that actually showed the result. renderMs below is
      // only the main-thread submit cost.
      submitToPresentMs: (gpu?.presentations || [])
        .slice(counts.presentationCount)
        .map((entry) => entry.submitToPresentMs)
        .filter((value) => Number.isFinite(value)),
      queueDelayMs: snapshot.queueDelayMs.slice(counts.queueCount),
      settleMs: snapshot.settleMs.slice(counts.settleCount),
      staleResults: snapshot.staleResults - counts.staleResults,
      coalescedFrames: snapshot.coalescedFrames,
      requestedTier: authoring.requestedTier,
      presentedTier: authoring.presentedTier,
      executionMode: authoring.executionMode,
      previewMaxDimension: authoring.previewMaxDimension,
      previewDimensions: authoring.previewDimensions,
      accepted: state.acceptedPresentation && {
        tier: state.acceptedPresentation.tier,
        exact: state.acceptedPresentation.exact,
        longEdge: state.acceptedPresentation.longEdge,
        transport: state.acceptedPresentation.transport,
      },
      plan: gpu?.resources?.plan && {
        width: gpu.resources.plan.width,
        height: gpu.resources.plan.height,
        mode: gpu.resources.plan.decision.mode,
        violations: gpu.resources.plan.decision.violations.map((entry) => entry.rule),
        peakLogicalBytes: gpu.resources.plan.totals.peakLogicalBytes,
        budgetBytes: gpu.resources.plan.budgetBytes,
      },
      sourceTransport: gpu?.resources?.sourceTransport || null,
      residentBytes: gpu?.resources?.memory?.resident?.totalBytes ?? null,
      peakLogicalBytes: gpu?.resources?.memory?.peakLogicalBytes ?? null,
    };
  }, before);

  const inputHandling = summarize(interaction.inputHandlingMs || []);
  const render = summarize(after.renderMs);
  const present = summarize(after.submitToPresentMs);
  const feedback = summarize(interaction.feedbackMs || []);

  return {
    tier: tier.value,
    label: tier.label,
    control: interaction.controlId,
    error: interaction.error || null,
    targets: { inputTargetMs: tier.inputTargetMs, renderTargetMs: tier.renderTargetMs, feedbackTargetMs: 100 },
    inputHandling,
    renderSubmit: render,
    submitToPresent: present,
    feedback,
    queueDelay: summarize(after.queueDelayMs),
    settle: summarize(after.settleMs),
    staleResults: after.staleResults,
    coalescedFrames: after.coalescedFrames,
    nonExactPresentations: interaction.nonExactPresentations,
    presentedTiers: interaction.presentedTiers,
    requestedTier: after.requestedTier,
    presentedTier: after.presentedTier,
    executionMode: after.executionMode,
    previewMaxDimension: after.previewMaxDimension,
    previewDimensions: after.previewDimensions,
    accepted: after.accepted,
    plan: after.plan,
    sourceTransport: after.sourceTransport,
    residentBytes: after.residentBytes,
    peakLogicalBytes: after.peakLogicalBytes,
    verdict: {
      // A tier only passes if it also never dropped below its own resolution.
      inputWithinTarget: inputHandling.p95Ms !== null && inputHandling.p95Ms <= tier.inputTargetMs,
      // The tier target is judged on the end-to-end figure when it exists.
      renderWithinTarget: present.p95Ms !== null
        ? present.p95Ms <= tier.renderTargetMs
        : render.p95Ms !== null && render.p95Ms <= tier.renderTargetMs,
      submitWithinTarget: render.p95Ms !== null && render.p95Ms <= tier.renderTargetMs,
      feedbackWithinTarget: feedback.p95Ms !== null && feedback.p95Ms <= 100,
      noStaleResults: after.staleResults === 0,
      heldTheTier: interaction.nonExactPresentations === 0,
    },
  };
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
  const input = argument("--input", null);
  const repetitions = Number(argument("--repetitions", "24"));
  const out = argument("--out", null);

  const browser = await chromium.launch({
    headless: !flag("--headed"),
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });

    if (input) {
      const resolved = path.resolve(input);
      if (!fs.existsSync(resolved)) throw new Error(`Input does not exist: ${resolved}`);
      await page.setInputFiles("#file-input", resolved);
    } else {
      await page.getByRole("button", { name: "Load test pattern" }).click();
    }
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 600000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });

    const environment = await page.evaluate(() => ({
      adapter: state.gpuPreview?.adapterInfo && {
        vendor: state.gpuPreview.adapterInfo.vendor,
        architecture: state.gpuPreview.adapterInfo.architecture,
        fallback: state.gpuPreview.adapterInfo.fallback,
        maxTextureDimension2D: state.gpuPreview.adapterInfo.limits?.maxTextureDimension2D,
        maxBufferSize: state.gpuPreview.adapterInfo.limits?.maxBufferSize,
      },
      source: state.session?.source && {
        width: state.session.source.width,
        height: state.session.source.height,
        filename: state.session.source.filename,
        megapixels: Math.round((state.session.source.width * state.session.source.height) / 100000) / 10,
      },
      budget: state.gpuMemoryBudget,
      maxSourceChunkBytes: state.gpuPreview?.maxSourceChunkBytes,
    }));

    await page.evaluate(() => window.HDRFinisherPerformance.enableGpuInstrumentation(true));

    const results = [];
    for (const tier of TIERS) {
      results.push(await measureTier(page, tier, repetitions));
    }

    const report = {
      recordedAt: new Date().toISOString(),
      url,
      input: input || "test-pattern",
      repetitions,
      environment,
      tiers: results,
      pageErrors,
    };

    const failures = results.flatMap((entry) => Object.entries(entry.verdict)
      .filter(([, passed]) => !passed)
      .map(([name]) => `${entry.label}: ${name}`));
    report.failures = failures;

    if (out) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(path.resolve(out), JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify(report, null, 2));
    if (pageErrors.length) {
      console.error(`Browser errors: ${pageErrors.join(" | ")}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
})();
