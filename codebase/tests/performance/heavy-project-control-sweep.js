/**
 * Measurement-only representative control sweep for the real heavy project.
 *
 * The sweep uses one control for every static module/processing-family pair,
 * and runs `current.*` controls in both HDR and SDR.  It never saves the
 * project. Automatic highlight anchoring is measured separately; the ordinary
 * module sweep pins both lanes to Manual so unrelated 7362 px mask compiles do
 * not contaminate every row.
 *
 *   node tests/run-in-electron.js tests/performance/heavy-project-control-sweep.js \
 *     --project "...\\DSC00950.hdrfinisher" --samples 10 --batch pointwise
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const projectPath = path.resolve(option("--project"));
const outputPath = path.resolve(option("--output", "output/performance/review/control-sweep.json"));
const sampleCount = Math.max(1, Number(option("--samples", "10")));
const batch = option("--batch", "all");
const edgeFallback = args.includes("--edge");
const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799";

const representatives = [
  { batch: "pointwise", module: "Tone", family: "pointwise scalar", path: "current.exposure" },
  { batch: "pointwise", module: "Tone", family: "parameter-dependent pointwise", path: "current.contrast_pivot" },
  { batch: "pointwise", module: "Lift, Gamma, Gain", family: "pointwise scalar", path: "current.lift" },
  { batch: "pointwise", module: "Lift, Gamma, Gain", family: "parameter-dependent pointwise", path: "current.lift_range" },
  { batch: "pointwise", module: "Color / Primaries", family: "pointwise scalar", path: "current.saturation" },
  { batch: "pointwise", module: "Color / Primaries", family: "parameter-dependent pointwise", path: "current.white_balance_kelvin" },
  { batch: "pointwise", module: "Color Grading", family: "pointwise scalar number", path: "current.color_grading.highlights.hue" },
  { batch: "pointwise", module: "Color Grading", family: "parameter-dependent pointwise", path: "current.color_grading.blending" },
  { batch: "pointwise", module: "Black & White", family: "pointwise scalar", path: "current.black_and_white.reds" },
  { batch: "pointwise", module: "Vignette", family: "pointwise scalar", path: "current.vignette.amount" },
  { batch: "pointwise", module: "Vignette", family: "parameter-dependent pointwise", path: "current.vignette.feather" },
  { batch: "pointwise", module: "Film Look: base/print", family: "pointwise scalar", path: "current.film_look.look_strength" },
  { batch: "pointwise", module: "Film Look: base/print", family: "parameter-dependent pointwise", path: "current.film_look.red_response" },
  { batch: "spatial", module: "Detail", family: "neighborhood/spatial", path: "current.detail.clarity_amount" },
  { batch: "spatial", module: "Detail", family: "multiscale/band", path: "current.detail.microcontrast" },
  { batch: "spatial", module: "Film Look: halation", family: "optical blur/composite range", path: "current.film_look.halation_radius" },
  { batch: "spatial", module: "Film Look: halation", family: "optical blur/composite checkbox", path: "current.film_look.halation_enabled" },
  { batch: "spatial", module: "Film Look: bloom/diffusion", family: "optical blur/composite range", path: "current.film_look.bloom_radius" },
  { batch: "spatial", module: "Film Look: bloom/diffusion", family: "optical blur/composite checkbox", path: "current.film_look.bloom_enabled" },
  { batch: "spatial", module: "Film Look: grain/resolution", family: "procedural field range", path: "current.film_look.grain_amount" },
  { batch: "spatial", module: "Film Look: grain/resolution", family: "procedural field checkbox", path: "current.film_look.grain_enabled" },
  { batch: "spatial", module: "Film Look: grain/resolution", family: "procedural field select", path: "current.film_look.grain_film_type" },
  { batch: "structure", module: "Exposure Bands", family: "LUT/curve rebuild", path: "hdr.tone_equalizer_smoothing", lanes: ["hdr"] },
  { batch: "structure", module: "Highlight Compression", family: "parameter-dependent pointwise", path: "current.highlight_compression_softness" },
  { batch: "structure", module: "Highlight Compression", family: "neighborhood/spatial", path: "current.highlight_compression_peak_detail" },
  { batch: "structure", module: "Viewer overlays", family: "pointwise scalar", path: "shared.overlay_opacity", lanes: ["hdr"], scopeOnly: true },
  { batch: "structure", module: "Viewer overlays", family: "structural/discrete select", path: "shared.overlay_mode", lanes: ["hdr"], scopeOnly: true },
  { batch: "structure", module: "Crop, Rotate & Perspective", family: "geometry/resampling range", path: "shared.geometry.straighten_angle", lanes: ["hdr"] },
  { batch: "structure", module: "Crop, Rotate & Perspective", family: "geometry/resampling select", path: "shared.geometry.ratio_mode", lanes: ["hdr"] },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function summary(values) {
  return {
    samples: values.length,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maximumMs: values.length ? Math.max(...values) : null,
  };
}

function alternativeNumber(value, control) {
  const current = Number(value);
  const minimum = Number(control.min);
  const maximum = Number(control.max);
  const step = Number(control.step);
  const delta = Number.isFinite(step) && step > 0
    ? step
    : Number.isFinite(minimum) && Number.isFinite(maximum) ? (maximum - minimum) / 100 : 0.01;
  const up = current + delta;
  if (!Number.isFinite(maximum) || up <= maximum) return up;
  return Math.max(Number.isFinite(minimum) ? minimum : -Infinity, current - delta);
}

async function installProbe(page) {
  await page.evaluate(() => {
    window.__controlSweep = { previews: [], scopes: [] };
    window.addEventListener("hdrfinisher:preview-presented", (event) => {
      window.__controlSweep.previews.push({ observedAt: performance.now(), ...structuredClone(event.detail || {}) });
    });
    window.addEventListener("hdrfinisher:scope-presented", (event) => {
      window.__controlSweep.scopes.push({ observedAt: performance.now(), ...structuredClone(event.detail || {}) });
    });
  });
}

async function waitForStable(page, timeout = 600_000) {
  try {
    await page.waitForFunction(() => {
    const lane = state.currentView;
    const exact = state.acceptedPresentation?.lane === lane
      && state.acceptedPresentation?.generation === state.previewGeneration[lane]
      && state.acceptedPresentation?.exact === true;
    const anchorIdle = typeof exactHighlightAnchorInflight === "undefined"
      || exactHighlightAnchorInflight.size === 0;
      return viewerState().status === "ready" && exact && anchorIdle && !state.gpuDraftInFlight;
    }, null, { timeout });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      lane: state.currentView,
      viewer: viewerState(),
      generation: state.previewGeneration[state.currentView],
      accepted: state.acceptedPresentation,
      anchorInflight: typeof exactHighlightAnchorInflight === "undefined" ? null : exactHighlightAnchorInflight.size,
      gpuDraftInFlight: Boolean(state.gpuDraftInFlight),
      globalEditDirty: state.globalEditDirty,
      globalEditSyncPending: Boolean(state.globalEditSyncPending),
      refusal: state.lastGpuDraftRefusal,
    }));
    throw new Error(`Stable wait timed out: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
  await page.waitForTimeout(100);
}

async function setLane(page, lane) {
  if (await page.evaluate(() => state.currentView) !== lane) {
    await page.evaluate((nextLane) => switchLane(nextLane), lane);
    await waitForStable(page);
  }
}

async function pinHighlightAnchors(page) {
  for (const lane of ["hdr", "sdr"]) {
    await setLane(page, lane);
    const pathText = `${lane}.highlight_compression_peak_measurement`;
    const current = await page.evaluate((p) => getValueByPath(state.adjustments, p), pathText);
    if (current !== "manual") {
      await page.evaluate((p) => commitAdjustmentValue(p, "manual", { manual: true }), pathText);
      await page.evaluate((activeLane) => settlePreview(activeLane, {}), lane);
      await waitForStable(page);
    }
  }
}

async function controlPlan(page, pathText) {
  return page.evaluate((requestedPath) => {
    const resolved = resolveAdjustmentPath(requestedPath);
    const control = [...document.querySelectorAll("[data-path]")]
      .find((item) => resolveAdjustmentPath(item.dataset.path) === resolved);
    if (!control) throw new Error(`No control for ${requestedPath} (${resolved})`);
    const value = getValueByPath(state.adjustments, requestedPath);
    let alternative;
    if (control.type === "checkbox" || control.tagName === "BUTTON") alternative = !Boolean(value);
    else if (control.tagName === "SELECT") {
      alternative = [...control.options].map((item) => item.value).find((item) => item !== String(value));
    } else {
      const current = Number(value);
      const minimum = Number(control.min);
      const maximum = Number(control.max);
      const step = Number(control.step);
      const delta = Number.isFinite(step) && step > 0
        ? step
        : Number.isFinite(minimum) && Number.isFinite(maximum) ? (maximum - minimum) / 100 : 0.01;
      alternative = !Number.isFinite(maximum) || current + delta <= maximum
        ? current + delta
        : Math.max(Number.isFinite(minimum) ? minimum : -Infinity, current - delta);
    }
    return {
      requestedPath,
      resolvedPath: resolved,
      original: structuredClone(value),
      alternative: structuredClone(alternative),
      element: control.tagName.toLowerCase(),
      type: control.type || control.tagName.toLowerCase(),
    };
  }, pathText);
}

async function measureChange(page, row, value, network, sampleIndex) {
  const started = await page.evaluate(({ valuePath, nextValue }) => {
    const lane = state.currentView;
    return {
      at: performance.now(),
      lane,
      generation: state.previewGeneration[lane],
      previewIndex: window.__controlSweep.previews.length,
      scopeIndex: window.__controlSweep.scopes.length,
      from: structuredClone(getValueByPath(state.adjustments, valuePath)),
      nextValue,
    };
  }, { valuePath: row.path, nextValue: value });
  const networkIndex = network.length;
  await page.evaluate(({ valuePath, nextValue }) => {
    commitAdjustmentValue(valuePath, nextValue, { manual: true });
  }, { valuePath: row.path, nextValue: value });
  if (row.scopeOnly) await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(({ begin, scopeOnly, valuePath }) => {
    const lane = state.currentView;
    const generation = state.previewGeneration[lane];
    const scopes = window.__controlSweep.scopes.slice(begin.scopeIndex);
    // Scope generations are owned by the scope scheduler, not the image
    // preview generation. Event ordering plus lane identity is the correlation
    // available until PERF-02 adds one shared operation ID.
    const scopeReady = scopes.some((event) => event.lane === lane);
    if (scopeOnly) {
      if (valuePath === "shared.overlay_opacity" || state.adjustments.shared.overlay_mode === "off") return true;
      const overlay = state.overlayPresented;
      return overlay?.lane === lane && overlay.generation === generation
        && overlay.revision === state.editRevision && !overlay.interim;
    }
    const previews = window.__controlSweep.previews.slice(begin.previewIndex);
    const previewReady = previews.some((event) => event.lane === lane && event.generation === generation);
    return previewReady && scopeReady
      && state.acceptedPresentation?.lane === lane
      && state.acceptedPresentation?.generation === generation
      && state.acceptedPresentation?.exact === true
      && viewerState().status === "ready";
  }, { begin: started, scopeOnly: Boolean(row.scopeOnly), valuePath: row.path }, { timeout: 120_000 });
  const result = await page.evaluate(({ begin, valuePath }) => {
    const endedAt = performance.now();
    const previews = window.__controlSweep.previews.slice(begin.previewIndex);
    const scopes = window.__controlSweep.scopes.slice(begin.scopeIndex);
    const gpu = window.HDRFinisherPerformance.gpuSnapshot();
    return {
      pageMs: endedAt - begin.at,
      to: structuredClone(getValueByPath(state.adjustments, valuePath)),
      previewLatenciesMs: previews.map((event) => event.observedAt - begin.at),
      scopeLatenciesMs: scopes.map((event) => event.observedAt - begin.at),
      acceptedPresentation: structuredClone(state.acceptedPresentation),
      refusal: structuredClone(state.lastGpuDraftRefusal || null),
      cpuFallbacks: Object.fromEntries(Object.entries(state.cpuFallbacks || {}).map(([key, values]) => [
        key, Array.isArray(values) ? values.slice(-4) : values,
      ])),
      gpuTail: {
        renders: (gpu.renders || []).slice(-4),
        stages: (gpu.stages || []).slice(-12),
        allocator: gpu.resources?.memory?.allocator || null,
      },
    };
  }, { begin: started, valuePath: row.path });
  result.index = sampleIndex;
  result.network = network.slice(networkIndex);
  return result;
}

async function main() {
  assert(projectPath && fs.existsSync(projectPath), `Project does not exist: ${projectPath}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const browser = await chromium.launch(edgeFallback ? {
    headless: false,
    channel: "msedge",
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  } : { headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const network = [];
  const pending = new Map();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(baseUrl).origin || !url.pathname.startsWith("/api/")) return;
    const item = { method: request.method(), path: url.pathname, query: url.search, startedAt: Date.now() };
    network.push(item);
    pending.set(request, item);
  });
  page.on("response", (response) => {
    const item = pending.get(response.request());
    if (!item) return;
    const headers = response.headers();
    item.status = response.status();
    item.durationMs = Date.now() - item.startedAt;
    item.response = Object.fromEntries([
      "x-cpu-mask-ms", "x-mask-batch-bytes", "x-mask-batch-compiles", "x-mask-batch-entries",
      "x-image-width", "x-image-height", "x-source-level-state",
    ].filter((key) => headers[key] !== undefined).map((key) => [key, headers[key]]));
    pending.delete(response.request());
  });
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForFunction(() => window.HDRFinisherPerformance?.gpuSnapshot?.()?.available === true, null, { timeout: 180_000 });
    await installProbe(page);
    await page.evaluate(() => window.HDRFinisherPerformance.enableGpuInstrumentation(true));
    await page.evaluate(async (targetPath) => {
      if (typeof desktop !== "undefined" && desktop?.grantProjectPath) {
        const selection = await desktop.grantProjectPath(targetPath, "project-open");
        await openProjectFromPath(selection);
        return;
      }
      const { response, payload } = await projectIo.openPathProject(fetch, { path: targetPath });
      if (!response.ok || !payload?.session) throw new Error(payload?.detail || "Project open failed");
      await activateDesktopSession(payload.session, targetPath);
    }, projectPath);
    await waitForStable(page);
    process.stdout.write("project-open stable\n");
    const initial = await page.evaluate(() => ({
      sessionId: state.session.session_id,
      image: { width: state.session.source.width, height: state.session.source.height },
      adjustments: structuredClone(state.adjustments),
      locals: structuredClone(state.editDocument.local_adjustments),
      snapshot: window.HDRFinisherPerformance.gpuSnapshot(),
    }));
    await pinHighlightAnchors(page);
    process.stdout.write("highlight anchors pinned\n");

    const selected = representatives.filter((row) => batch === "all" || row.batch === batch);
    const rows = [];
    for (const representative of selected) {
      const lanes = representative.lanes || (representative.path.startsWith("current.") ? ["hdr", "sdr"] : [
        representative.path.startsWith("sdr.") ? "sdr" : "hdr",
      ]);
      for (const lane of lanes) {
        await setLane(page, lane);
        const plan = await controlPlan(page, representative.path);
        const row = { ...representative, lane, plan, samples: [] };
        let next = plan.alternative;
        for (let index = 0; index < sampleCount; index += 1) {
          const sample = await measureChange(page, row, next, network, index + 1);
          row.samples.push(sample);
          next = JSON.stringify(sample.to) === JSON.stringify(plan.original) ? plan.alternative : plan.original;
        }
        row.summary = {
          exactAndScopes: summary(row.samples.map((sample) => sample.pageMs)),
          firstPreview: summary(row.samples.map((sample) => sample.previewLatenciesMs[0]).filter(Number.isFinite)),
          finalScope: summary(row.samples.map((sample) => sample.scopeLatenciesMs.at(-1)).filter(Number.isFinite)),
          routes: [...new Set(row.samples.map((sample) => sample.acceptedPresentation?.execution || "unknown"))],
          processedEdges: [...new Set(row.samples.map((sample) => sample.acceptedPresentation?.processedLongEdge).filter(Number.isFinite))],
        };
        rows.push(row);
        // Preserve completed rows even when a later control times out.
        fs.writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: 1, projectPath, host: edgeFallback ? "Microsoft Edge diagnostic fallback" : "Electron", batch, sampleCount, initial, rows, partial: true }, null, 2)}\n`);
        process.stdout.write(`${representative.module} / ${representative.family} / ${lane}: ${JSON.stringify(row.summary.exactAndScopes)}\n`);
      }
    }
    const report = {
      schemaVersion: 1,
      purpose: "Heavy-project representative module and slider-family sweep",
      createdAt: new Date().toISOString(),
      projectPath,
      host: edgeFallback ? "Microsoft Edge diagnostic fallback" : "Electron",
      batch,
      sampleCount,
      isolation: "Automatic highlight anchors pinned to Manual for ordinary rows; anchor path measured separately.",
      initial,
      rows,
      final: await page.evaluate(() => ({
        snapshot: window.HDRFinisherPerformance.gpuSnapshot(),
        scheduler: window.HDRFinisherPerformance.snapshot(),
      })),
    };
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ outputPath, rows: rows.length }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
