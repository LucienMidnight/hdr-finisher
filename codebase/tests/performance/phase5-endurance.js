// Phase 5 item 6: endurance. Repeated scale changes and edits must not leak
// device memory, drift the peak-agreement gate, exceed the admitted budget
// without a classified recovery, or push the backend's source-mip caches past
// their byte budgets. The page's GPUDevice prototypes are wrapped before any
// application script runs, so every texture and buffer the app creates is
// counted at its real size and every destroy is subtracted.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { ensureLargeNoisySource } = require('../large-noisy-tiff.js');

const output = process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : path.join(__dirname, '../../output/performance/phase5-endurance-4200.json');
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 4200);
const height = Number(process.argv.includes('--height') ? process.argv[process.argv.indexOf('--height') + 1] : 2800);
const cycles = Number(process.argv.includes('--cycles') ? process.argv[process.argv.indexOf('--cycles') + 1] : 6);
const maxDrift = 0.15;
const maxGrowth = 1.12;

const instrument = () => {
  const FORMAT_BYTES = {
    rgba32float: 16, rgba16float: 8, rg16float: 4, r16float: 2, r8unorm: 1,
    bgra8unorm: 4, rgba8unorm: 4, "depth24plus": 4, "depth32float": 4,
  };
  const ledger = {
    liveBytes: 0, peakBytes: 0, created: 0, destroyed: 0, unknownFormats: [],
    liveBySize: {}, resourcesById: {}, liveResources: {}, nextResourceId: 1,
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
      ? `${kind} ${descriptor.format} ${descriptor.width}x${descriptor.height}`
      : `${kind} ${descriptor?.format || bytes}`;
    const bucket = `${shape}`;
    ledger.liveBySize[bucket] = ledger.liveBySize[bucket] || { count: 0, bytes: 0 };
    ledger.liveBySize[bucket].count += 1;
    ledger.liveBySize[bucket].bytes += bytes;
    const resourceId = ledger.nextResourceId++;
    resource.__destroyed = false;
    resource.__ledgerId = resourceId;
    ledger.resourcesById[resourceId] = { resource, bytes, caller: callerLine() };
    if (bytes >= 4 * 1024 * 1024 && !ledger.liveResources[resourceId]) {
      ledger.liveResources[resourceId] = { bucket, bytes, caller: callerLine() };
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
    track(texture, (bytesPerPixel || 0) * textureWidth * textureHeight * layers, "texture",
      { format: descriptor.format, width: textureWidth, height: textureHeight });
    return texture;
  };
  const createBuffer = GPUDevice.prototype.createBuffer;
  GPUDevice.prototype.createBuffer = function (descriptor) {
    const buffer = createBuffer.call(this, descriptor);
    track(buffer, descriptor.size || 0, "buffer", { format: `size=${descriptor.size}` });
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

    const samples = [];
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      for (const zoom of [null, 50, 100, 35]) {
        await page.evaluate((value) => {
          if (value === null) setZoomMode('fit'); else setCustomZoom(value);
        }, zoom);
        await page.waitForFunction(() => viewerState().status === 'ready'
          && state.acceptedPresentation?.processedLongEdge === requiredProcessingLongEdge(), null,
        { timeout: 600000 });
      }
      await page.evaluate((value) => {
        const control = document.querySelector('[data-path="hdr.exposure"]');
        control.value = String(value);
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
      }, (cycle % 5) * 0.1);
      await page.waitForFunction(() => viewerState().status === 'ready'
        && state.acceptedPresentation?.processedLongEdge === requiredProcessingLongEdge(), null,
      { timeout: 600000 });
      await page.waitForFunction(() => (state.gpuPreview?.proxyInflight?.size || 0) === 0
        && !state.inactiveSourceController, null, { timeout: 60000 }).catch(() => null);
      await page.waitForTimeout(200);

      const sample = await page.evaluate(async (cycleNumber) => {
        const api = window.HDRFinisherPerformance;
        const gpu = api.gpuSnapshot();
        const memory = gpu?.resources?.memory || {};
        const ledger = window.__gpuLedger;
        const gpuPreview = state.gpuPreview;
        const referenced = new Set();
        const add = (resource) => { if (resource?.__ledgerId) referenced.add(resource.__ledgerId); };
        for (const proxy of gpuPreview?.proxies?.values?.() || []) add(proxy.texture);
        for (const entry of gpuPreview?.intermediates?.values?.() || []) {
          add(entry.baseTexture); add(entry.filmTexture); add(entry.finishTexture);
          add(entry.localTexture); add(entry.detailATexture); add(entry.detailBTexture);
          add(entry.spatialATexture); add(entry.spatialBTexture); add(entry.compositeParamBuffer);
        }
        const graph = gpuPreview?.tileGraph;
        if (graph) {
          add(graph.sourceTexture); add(graph.baseTexture); add(graph.localTexture);
          add(graph.detailScratchTexture); add(graph.detailResultTexture); add(graph.filmTexture);
          add(graph.finishTexture); add(graph.spatialATexture); add(graph.spatialBTexture);
        }
        add(gpuPreview?.presentationTarget?.texture);
        for (const entry of gpuPreview?.localMasks?.values?.() || []) {
          for (const texture of entry.nodeTextures || [entry.texture]) add(texture);
          add(entry.baseTexture); add(entry.horizontalTexture); add(entry.refinedTexture);
          add(entry.qualifyBuffer); add(entry.horizontalBuffer); add(entry.verticalBuffer);
        }
        for (const map of [gpuPreview?.maskTiles, gpuPreview?.detailBandTiles, gpuPreview?.sceneLuminance]) {
          for (const entry of map?.values?.() || []) add(entry.texture);
        }
        for (const pool of gpuPreview?.scopeResources?.values?.() || []) {
          for (const resource of pool) { add(resource.texture); add(resource.readBuffer); add(resource.paramBuffer); }
        }
        for (const local of gpuPreview?.localParamBuffers?.values?.() || []) add(local);
        add(gpuPreview?.paramBuffer); add(gpuPreview?.curveBuffer); add(gpuPreview?.tileCompositeParamBuffer);
        const selector = gpuPreview?.denoiseSourceSelector;
        if (selector?.original) add(selector.original.texture);
        if (selector?.resolved) add(selector.resolved.texture);
        for (const level of selector?.cache?.levels || []) add(level.texture);
        const orphanBytes = Object.entries(ledger.resourcesById)
          .filter(([id]) => !referenced.has(Number(id)))
          .reduce((sum, [, entry]) => sum + entry.bytes, 0);
        const diagnostics = await (await fetch(`/api/session/${state.session.session_id}/diagnostics`)).json();
        const cpuFallbacks = state.cpuFallbacks || {};
        const cpuFallbackCount = Array.isArray(cpuFallbacks)
          ? cpuFallbacks.length
          : Object.values(cpuFallbacks).reduce((sum, list) => sum
            + (Array.isArray(list) ? list.length : (list ? 1 : 0)), 0);
        const refusals = state.gpuDraftRefusals;
        const refusalCount = Array.isArray(refusals) ? refusals.length
          : (typeof refusals === "number" ? refusals : 0);
        return {
          cycle: cycleNumber,
          logicalPeakBytes: memory.peakLogicalBytes || 0,
          liveBytes: ledger.liveBytes,
          created: ledger.created,
          destroyed: ledger.destroyed,
          orphanBytes,
          allocatorUsedBytes: memory.allocator?.usedBytes ?? null,
          allocatorOverBudgetBytes: memory.allocator?.overBudgetBytes ?? null,
          allocatorEvictions: memory.allocator?.evictions ?? null,
          budgetBytes: gpu?.resources?.budget?.bytes ?? null,
          allocationBackoff: gpu?.resources?.allocationBackoff ?? null,
          allocationFailures: (gpu?.stages || []).filter((stage) => String(stage.kind || stage.name || "")
            .includes("allocation-failure")).length,
          cpuFallbacks: cpuFallbackCount,
          lastCpuFallback: Array.isArray(cpuFallbacks)
            ? (cpuFallbacks.at(-1) || null)
            : (Object.values(cpuFallbacks).flat().at(-1) || null),
          refusals: refusalCount,
          lastRefusal: state.lastGpuDraftRefusal || null,
          unknownFormats: [...new Set(ledger.unknownFormats)],
          sourceMip: diagnostics.render_cache?.source_mip || null,
        };
      }, cycle);
      const accountedLive = sample.liveBytes - sample.orphanBytes;
      sample.drift = accountedLive > 0
        ? Math.abs(sample.logicalPeakBytes - accountedLive) / accountedLive
        : null;
      assert.ok(sample.drift !== null && sample.drift <= maxDrift,
        `Cycle ${cycle}: logical peak drifted ${(sample.drift * 100).toFixed(1)}% from accounted live memory`);
      assert.ok(sample.orphanBytes <= Math.max(4 * 1024 * 1024, sample.liveBytes * 0.01),
        `Cycle ${cycle}: ${(sample.orphanBytes / 1e6).toFixed(1)} MB of live memory is unreferenced`);
      assert.equal(sample.allocatorOverBudgetBytes ?? 0, 0, `Cycle ${cycle}: allocator reported an unfunded overage`);
      assert.ok(sample.budgetBytes === null || sample.logicalPeakBytes <= sample.budgetBytes
        || sample.allocationBackoff !== null,
      `Cycle ${cycle}: peak ${sample.logicalPeakBytes} exceeded the admitted budget without a classified recovery`);
      assert.equal(sample.allocationBackoff, null, `Cycle ${cycle}: an allocation failure was recorded`);
      assert.equal(sample.allocationFailures, 0, `Cycle ${cycle}: allocation-failure stages were recorded`);
      assert.equal(sample.cpuFallbacks, 0,
        `Cycle ${cycle}: the session fell back to the CPU preview (${JSON.stringify(sample.lastCpuFallback)})`);
      assert.equal(sample.unknownFormats.length, 0, `Cycle ${cycle}: the ledger met an unknown texture format`);
      const mip = sample.sourceMip || {};
      assert.ok(!mip.memory_budget_bytes || mip.memory_bytes <= mip.memory_budget_bytes,
        `Cycle ${cycle}: source mip memory ${mip.memory_bytes} exceeded its budget ${mip.memory_budget_bytes}`);
      assert.ok(!mip.disk_budget_bytes || mip.disk_bytes <= mip.disk_budget_bytes,
        `Cycle ${cycle}: source mip disk ${mip.disk_bytes} exceeded its budget ${mip.disk_budget_bytes}`);
      assert.equal(mip.corrupt_discards ?? 0, 0, `Cycle ${cycle}: a cache level was discarded as corrupt`);
      assert.equal(mip.write_failures ?? 0, 0, `Cycle ${cycle}: a cache write failed`);
      samples.push(sample);
      console.log(`cycle ${cycle}: logical ${(sample.logicalPeakBytes / 1e6).toFixed(0)} MB, `
        + `live ${(sample.liveBytes / 1e6).toFixed(0)} MB, drift ${(sample.drift * 100).toFixed(1)}%, `
        + `orphans ${(sample.orphanBytes / 1e6).toFixed(1)} MB, `
        + `allocator ${(sample.allocatorUsedBytes / 1e6).toFixed(0)} MB, `
        + `evictions ${sample.allocatorEvictions}, created ${sample.created}, destroyed ${sample.destroyed}`);
    }

    const third = samples[Math.min(2, samples.length - 1)];
    const last = samples[samples.length - 1];
    const growth = third.liveBytes > 0 ? last.liveBytes / third.liveBytes : 1;
    assert.ok(growth <= maxGrowth,
      `Live memory grew ${((growth - 1) * 100).toFixed(1)}% from cycle 3 to cycle ${cycles}`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({
      fixture: `${width}x${height} deterministic noisy TIFF`,
      cycles,
      maxDrift,
      maxGrowth,
      growthCycle3ToLast: growth,
      samples,
    }, null, 2));
    console.log(`stable: cycle ${cycles} live ${(last.liveBytes / 1e6).toFixed(0)} MB vs cycle 3 `
      + `${(third.liveBytes / 1e6).toFixed(0)} MB (${((growth - 1) * 100).toFixed(1)}%)`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
