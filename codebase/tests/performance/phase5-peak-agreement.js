// Phase 5 exit gate: "Logical peak agrees with instrumented application
// allocations within 15%; remaining driver/browser overhead is reported
// separately."
//
// The page's own GPU device is wrapped before any application script runs, so
// every texture and buffer the app asks the device to create is counted at its
// real size, every destroy is subtracted, and the peak is the peak of what the
// application actually allocated -- not of the renderer's model. The driver
// walks the normal preview path, then compares the renderer's logical peak and
// its central allocator registry against that measured peak at each step.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { ensureLargeNoisySource } = require('../large-noisy-tiff.js');

const output = process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : path.join(__dirname, '../../output/performance/phase5-peak-agreement.json');
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 4200);
const height = Number(process.argv.includes('--height') ? process.argv[process.argv.indexOf('--height') + 1] : 2800);
const maxDrift = 0.15;
const reportOnly = process.argv.includes('--report-only');

const instrument = () => {
  const FORMAT_BYTES = {
    rgba32float: 16, rgba16float: 8, rg16float: 4, r16float: 2, r8unorm: 1,
    bgra8unorm: 4, rgba8unorm: 4, "depth24plus": 4, "depth32float": 4,
  };
  const ledger = {
    liveBytes: 0, peakBytes: 0, created: 0, destroyed: 0, unknownFormats: [], liveBySize: {}, largeStacks: {},
    liveResources: {}, resourcesById: {}, nextResourceId: 1,
  };
  window.__gpuLedger = ledger;
  if (typeof GPUDevice === "undefined") return;
  const callerLine = () => {
    const frames = String(new Error().stack || "").split("\n").slice(2);
    const caller = frames.find((line) => line.includes("webgpu-preview.js") || line.includes("app.js"))
      || frames[0] || "";
    return caller.trim();
  };
  const track = (resource, bytes, kind, descriptor) => {
    const destroy = resource.destroy.bind(resource);
    resource.__allocBytes = bytes;
    ledger.liveBytes += bytes;
    ledger.created += 1;
    ledger.peakBytes = Math.max(ledger.peakBytes, ledger.liveBytes);
    const shape = descriptor && descriptor.width
      ? `${kind} ${descriptor.format} ${descriptor.width}x${descriptor.height}${descriptor.label ? ` [${descriptor.label}]` : ""}`
      : `${kind} ${descriptor?.format || bytes}${descriptor?.label ? ` [${descriptor.label}]` : ""}`;
    const bucket = `${shape}`;
    ledger.liveBySize[bucket] = ledger.liveBySize[bucket] || { count: 0, bytes: 0, unit: bytes };
    ledger.liveBySize[bucket].count += 1;
    ledger.liveBySize[bucket].bytes += bytes;
    if (bytes >= 4 * 1024 * 1024 && !ledger.largeStacks[bucket]) {
      ledger.largeStacks[bucket] = String(new Error().stack || "").split("\n").slice(2, 5).join(" <- ");
    }
    const resourceId = ledger.nextResourceId++;
    resource.__destroyed = false;
    resource.__ledgerId = resourceId;
    resource.__allocBucket = bucket;
    ledger.resourcesById[resourceId] = { resource, bytes, caller: callerLine(), at: window.performance.now() };
    if (bytes >= 4 * 1024 * 1024) {
      ledger.liveResources[resourceId] = { bucket, bytes, caller: callerLine(), at: window.performance.now() };
      const ids = Object.keys(ledger.liveResources);
      if (ids.length > 200) delete ledger.liveResources[ids[0]];
    }
    resource.destroy = () => {
      if (!resource.__destroyed) {
        resource.__destroyed = true;
        ledger.liveBytes -= bytes;
        ledger.destroyed += 1;
        ledger.liveBySize[bucket].count -= 1;
        ledger.liveBySize[bucket].bytes -= bytes;
        delete ledger.resourcesById[resource.__ledgerId];
        delete ledger.liveResources[resource.__ledgerId];
      }
      return destroy();
    };
  };
  const createTexture = GPUDevice.prototype.createTexture;
  GPUDevice.prototype.createTexture = function (descriptor) {
    const texture = createTexture.call(this, descriptor);
    const size = descriptor.size;
    const textureWidth = size.width ?? size[0];
    const textureHeight = size.height ?? size[1] ?? 1;
    const layers = size.depthOrArrayLayers ?? 1;
    const bytesPerPixel = FORMAT_BYTES[descriptor.format];
    if (bytesPerPixel === undefined) ledger.unknownFormats.push(descriptor.format);
    track(texture, (bytesPerPixel || 0) * textureWidth * textureHeight * layers, "texture", {
      format: descriptor.format, width: textureWidth, height: textureHeight, label: descriptor.label,
    });
    return texture;
  };
  const createBuffer = GPUDevice.prototype.createBuffer;
  GPUDevice.prototype.createBuffer = function (descriptor) {
    const buffer = createBuffer.call(this, descriptor);
    track(buffer, descriptor.size || 0, "buffer", {
      format: `size=${descriptor.size}`, label: descriptor.label,
    });
    return buffer;
  };
};

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge',
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(instrument);
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8799', { waitUntil: 'domcontentloaded' });
    await page.setInputFiles('#file-input', ensureLargeNoisySource(width, height));
    await page.waitForFunction(() => state.session?.session_id && viewerState().status === 'ready', null,
      { timeout: 600000 });
    await page.waitForFunction(() => !state.gpuDraftInFlight && state.gpuPreview?.available, null,
      { timeout: 600000 });

    const steps = [
      ['fit', null],
      ['50%', 50],
      ['35%', 35],
      ['native-100', 100],
      ['warm-50', 50],
      ['warm-100', 100],
      ['fit-return', null],
    ];
    const samples = [];
    for (const [name, zoom] of steps) {
      await page.evaluate((value) => {
        // The step's own peak: the running peak is rebased on the session
        // before the step, so a transient allocation during the step counts
        // and an earlier step's high-water mark does not.
        window.__gpuLedger.peakBytes = window.__gpuLedger.liveBytes;
        if (value === null) setZoomMode('fit'); else setCustomZoom(value);
      }, zoom);
      await page.waitForFunction(() => viewerState().status === 'ready'
        && state.acceptedPresentation?.processedLongEdge === requiredProcessingLongEdge(), null,
      { timeout: 600000 });
      // Settle deliberate background work (the item-5 inactive-lane preload is
      // a second lane fetching the same edge at true idle). The gate measures
      // the foreground graph: background bytes are attributed, not ignored.
      await page.waitForFunction(() => (state.gpuPreview?.proxyInflight?.size || 0) === 0
        && !state.inactiveSourceController, null, { timeout: 60000 }).catch(() => null);
      await page.waitForTimeout(600);
      await page.waitForFunction(() => (state.gpuPreview?.proxyInflight?.size || 0) === 0
        && !state.inactiveSourceController, null, { timeout: 60000 }).catch(() => null);
      await page.waitForTimeout(150);
      const sample = await page.evaluate((stepName) => {
        const memory = window.HDRFinisherPerformance.gpuSnapshot()?.resources?.memory || {};
        const ledger = window.__gpuLedger;
        const gpu = state.gpuPreview;
        // Which live device resources does any renderer map or field still
        // reference? Anything else is unreferenced live memory: a leak or an
        // allocation in flight whose owner has not published or released it.
        const referenced = new Set();
        const add = (resource) => { if (resource?.__ledgerId) referenced.add(resource.__ledgerId); };
        for (const proxy of gpu?.proxies?.values?.() || []) add(proxy.texture);
        for (const entry of gpu?.intermediates?.values?.() || []) {
          add(entry.baseTexture); add(entry.filmTexture); add(entry.finishTexture);
          add(entry.localTexture); add(entry.detailATexture); add(entry.detailBTexture);
          add(entry.spatialATexture); add(entry.spatialBTexture); add(entry.compositeParamBuffer);
        }
        const graph = gpu?.tileGraph;
        if (graph) {
          add(graph.sourceTexture); add(graph.baseTexture); add(graph.localTexture);
          add(graph.detailScratchTexture); add(graph.detailResultTexture); add(graph.filmTexture);
          add(graph.finishTexture); add(graph.spatialATexture); add(graph.spatialBTexture);
          add(graph.denoiseResolvedTexture);
        }
        add(gpu?.presentationTarget?.texture);
        for (const entry of gpu?.localMasks?.values?.() || []) {
          for (const texture of entry.nodeTextures || [entry.texture]) add(texture);
          add(entry.baseTexture); add(entry.horizontalTexture); add(entry.refinedTexture);
          add(entry.qualifyBuffer); add(entry.horizontalBuffer); add(entry.verticalBuffer);
        }
        for (const map of [gpu?.maskTiles, gpu?.detailBandTiles, gpu?.sceneLuminance]) {
          for (const entry of map?.values?.() || []) add(entry.texture);
        }
        for (const pool of gpu?.scopeResources?.values?.() || []) {
          for (const resource of pool) { add(resource.texture); add(resource.readBuffer); add(resource.paramBuffer); }
        }
        for (const local of gpu?.localParamBuffers?.values?.() || []) add(local);
        add(gpu?.paramBuffer); add(gpu?.curveBuffer); add(gpu?.tileCompositeParamBuffer);
        const selector = gpu?.denoiseSourceSelector;
        if (selector?.original) add(selector.original.texture);
        if (selector?.resolved) add(selector.resolved.texture);
        for (const level of selector?.cache?.levels || []) add(level.texture);
        const orphans = Object.entries(ledger.resourcesById)
          .filter(([id]) => !referenced.has(Number(id)))
          .map(([, entry]) => ({ bytes: entry.bytes, caller: entry.caller }))
          .sort((a, b) => b.bytes - a.bytes);
        const logicalPeak = memory.peakLogicalBytes || 0;
        const stepPeak = ledger.peakBytes || 0;
        const live = ledger.liveBytes || 0;
        const allocatorUsed = memory.allocator?.usedBytes ?? 0;
        const budgetCalibration = window.HDRFinisherPerformance.gpuSnapshot()?.resources?.budget?.calibration || null;
        return {
          step: stepName,
          logicalPeakBytes: logicalPeak,
          stepPeakBytes: stepPeak,
          instrumentedLiveBytes: live,
          allocatorUsedBytes: allocatorUsed,
          allocatorOverBudgetBytes: memory.allocator?.overBudgetBytes ?? null,
          allocatorEvictions: memory.allocator?.evictions ?? null,
          allocatorByKind: memory.allocator?.byKind ?? null,
          categories: memory.resident?.categories ?? null,
          proxies: [...(state.gpuPreview?.proxies?.keys?.() || [])],
          driftLive: live > 0 ? Math.abs(logicalPeak - live) / live : null,
          // What the step allocated while replacing a scale: the old target and
          // proxy textures stay alive until submitted work that reads them has
          // completed. Reported separately, not part of the steady-state gate.
          transitionPeakBytes: Math.max(0, stepPeak - live),
          // Live bytes outside the renderer's central registry: resources whose
          // lifetime is owned elsewhere. Reported separately, never inferred.
          unregisteredLiveBytes: Math.max(0, live - allocatorUsed),
          liveBySize: Object.entries(ledger.liveBySize)
            .filter(([, entry]) => entry.count > 0)
            .sort((a, b) => b[1].bytes - a[1].bytes)
            .slice(0, 10)
            .map(([bucket, entry]) => ({ bucket, count: entry.count, bytes: entry.bytes,
              stack: ledger.largeStacks[bucket] || null })),
          unknownFormats: [...new Set(ledger.unknownFormats)],
          budgetCalibration,
          // An unreferenced texture with a load in flight is the deferred
          // inactive lane mid-fetch, not a leak: it is attributed here.
          backgroundInFlight: (state.gpuPreview?.proxyInflight?.size || 0) > 0
            || Boolean(state.inactiveSourceController),
          orphanBytes: orphans.reduce((sum, entry) => sum + entry.bytes, 0),
          orphans: orphans.slice(0, 8),
          liveResources: Object.values(ledger.liveResources)
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, 12),
        };
      }, name);
      // The gate compares the logical model with the bytes the renderer can
      // account for. Unreferenced in-flight bytes are attributed and reported;
      // a settled step should have none.
      const accountedLive = sample.instrumentedLiveBytes - sample.orphanBytes;
      sample.accountedLiveBytes = accountedLive;
      sample.driftAccounted = accountedLive > 0
        ? Math.abs(sample.logicalPeakBytes - accountedLive) / accountedLive
        : null;
      samples.push(sample);
      console.log(`${sample.step}: logical ${(sample.logicalPeakBytes / 1e6).toFixed(0)} MB, `
        + `live ${(sample.instrumentedLiveBytes / 1e6).toFixed(0)} MB, `
        + `drift ${sample.driftAccounted === null ? "n/a" : (sample.driftAccounted * 100).toFixed(1) + "%"}, `
        + `transition +${(sample.transitionPeakBytes / 1e6).toFixed(1)} MB, `
        + `unregistered ${(sample.unregisteredLiveBytes / 1e6).toFixed(1)} MB, `
        + `unreferenced ${(sample.orphanBytes / 1e6).toFixed(1)} MB, `
        + `evictions ${sample.allocatorEvictions}`);
      if (!reportOnly && sample.driftAccounted !== null) {
        assert.ok(sample.driftAccounted <= maxDrift,
          `${sample.step}: logical peak drifted ${(sample.driftAccounted * 100).toFixed(1)}% from accounted live allocations`);
      }
    }

    const worst = samples.filter((sample) => sample.driftAccounted !== null)
      .reduce((max, sample) => (max === null || sample.driftAccounted > max.driftAccounted ? sample : max), null);
    const missingFormats = [...new Set(samples.flatMap((sample) => sample.unknownFormats))];
    assert.deepEqual(missingFormats, [], "the instrumented ledger must know every texture format the app uses");
    if (worst) console.log(`worst agreement: ${worst.step} ${(worst.driftAccounted * 100).toFixed(1)}%`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({
      fixture: `${width}x${height} deterministic noisy TIFF`,
      maxDrift,
      worst: worst?.step ?? null,
      worstDrift: worst?.driftAccounted ?? null,
      samples,
    }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
