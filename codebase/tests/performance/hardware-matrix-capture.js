// Phase 5 item 7: capture one machine's row of the supported hardware matrix.
//
// The capture reports only what was observed on this machine -- adapter
// identity and limits, the calibrated Auto budget and its probe, timings for
// the 42 MP-class workflow, the peak-agreement numbers, and whether the CPU
// fallback path works when WebGPU is absent. It never classifies the hardware
// itself: the operator passes the class they are testing (`--class
// discrete|integrated|unified|cpu-only`) and it is recorded verbatim. A row
// with no measurement says so; unknown configurations are disclosed as
// untested rather than inferred.
//
//   node tests/performance/hardware-matrix-capture.js --machine "studio-4090" --class discrete
//   node tests/performance/hardware-matrix-summary.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { ensureLargeNoisySource } = require('../large-noisy-tiff.js');

const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const machine = argOf('machine', os.hostname());
const hardwareClass = argOf('class', 'unclassified');
const width = Number(argOf('width', 4200));
const height = Number(argOf('height', 2800));
const channel = argOf('channel', 'msedge');
const outputDirectory = argOf('dir', path.join(__dirname, '../../output/performance/hardware'));
const output = path.join(outputDirectory, `${machine.replace(/[^a-z0-9._-]+/gi, '_')}.json`);

const instrument = () => {
  const FORMAT_BYTES = {
    rgba32float: 16, rgba16float: 8, rg16float: 4, r16float: 2, r8unorm: 1,
    bgra8unorm: 4, rgba8unorm: 4, "depth24plus": 4, "depth32float": 4,
  };
  const ledger = {
    liveBytes: 0, peakBytes: 0, created: 0, destroyed: 0, unknownFormats: [],
    resourcesById: {}, nextResourceId: 1,
  };
  window.__gpuLedger = ledger;
  if (typeof GPUDevice === "undefined") return;
  const track = (resource, bytes) => {
    const destroy = resource.destroy.bind(resource);
    const id = ledger.nextResourceId++;
    resource.__ledgerId = id;
    resource.__destroyed = false;
    ledger.liveBytes += bytes;
    ledger.peakBytes = Math.max(ledger.peakBytes, ledger.liveBytes);
    ledger.resourcesById[id] = { resource, bytes };
    resource.destroy = () => {
      if (!resource.__destroyed) {
        resource.__destroyed = true;
        ledger.liveBytes -= bytes;
        ledger.destroyed += 1;
        delete ledger.resourcesById[id];
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
    track(texture, (bytesPerPixel || 0) * textureWidth * textureHeight * layers);
    return texture;
  };
  const createBuffer = GPUDevice.prototype.createBuffer;
  GPUDevice.prototype.createBuffer = function (descriptor) {
    const buffer = createBuffer.call(this, descriptor);
    track(buffer, descriptor.size || 0);
    return buffer;
  };
};

async function sampleStep(page, name) {
  return page.evaluate((stepName) => {
    const api = window.HDRFinisherPerformance;
    const gpu = api.gpuSnapshot();
    const memory = gpu?.resources?.memory || {};
    const ledger = window.__gpuLedger;
    const referenced = new Set();
    const add = (resource) => { if (resource?.__ledgerId) referenced.add(resource.__ledgerId); };
    const gpuPreview = state.gpuPreview;
    for (const proxy of gpuPreview?.proxies?.values?.() || []) add(proxy.texture);
    for (const entry of gpuPreview?.intermediates?.values?.() || []) {
      add(entry.baseTexture); add(entry.filmTexture); add(entry.finishTexture); add(entry.localTexture);
      add(entry.detailATexture); add(entry.detailBTexture); add(entry.spatialATexture);
      add(entry.spatialBTexture); add(entry.compositeParamBuffer);
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
    }
    for (const map of [gpuPreview?.maskTiles, gpuPreview?.detailBandTiles, gpuPreview?.sceneLuminance]) {
      for (const entry of map?.values?.() || []) add(entry.texture);
    }
    for (const pool of gpuPreview?.scopeResources?.values?.() || []) {
      for (const resource of pool) { add(resource.texture); add(resource.readBuffer); add(resource.paramBuffer); }
    }
    for (const local of gpuPreview?.localParamBuffers?.values?.() || []) add(local);
    add(gpuPreview?.paramBuffer); add(gpuPreview?.curveBuffer); add(gpuPreview?.tileCompositeParamBuffer);
    const orphanBytes = Object.entries(ledger.resourcesById)
      .filter(([id]) => !referenced.has(Number(id)))
      .reduce((sum, [, entry]) => sum + entry.bytes, 0);
    const accountedLive = ledger.liveBytes - orphanBytes;
    return {
      step: stepName,
      logicalPeakBytes: memory.peakLogicalBytes || 0,
      liveBytes: ledger.liveBytes,
      orphanBytes,
      drift: accountedLive > 0 ? Math.abs((memory.peakLogicalBytes || 0) - accountedLive) / accountedLive : null,
      adapter: gpu?.adapter || null,
      calibration: gpu?.resources?.budget?.calibration || null,
      accepted: state.acceptedPresentation
        ? { edge: state.acceptedPresentation.processedLongEdge, execution: state.acceptedPresentation.execution,
          transport: state.acceptedPresentation.transport, exact: state.acceptedPresentation.exact }
        : null,
      allocationBackoff: gpu?.resources?.allocationBackoff || null,
      unknownFormats: [...new Set(ledger.unknownFormats)],
    };
  }, name);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer'] });
  const record = {
    machine,
    class: hardwareClass,
    capturedAt: new Date().toISOString(),
    platform: { os: os.platform(), release: os.release(), arch: os.arch(), browser: channel,
      browserVersion: browser.version() },
    fixture: `${width}x${height} deterministic noisy TIFF`,
    status: 'captured',
    steps: [],
    checks: {},
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(instrument);
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8799', { waitUntil: 'domcontentloaded' });
    await page.setInputFiles('#file-input', ensureLargeNoisySource(width, height));
    await page.waitForFunction(() => state.session?.session_id && viewerState().status === 'ready', null,
      { timeout: 600000 });
    await page.waitForFunction(() => !state.gpuDraftInFlight, null, { timeout: 600000 });
    const available = await page.evaluate(() => Boolean(state.gpuPreview?.available));
    record.webgpuAvailable = available;

    if (!available) {
      // A machine without WebGPU is supported through the authoritative CPU
      // preview; the capture records that path instead of failing.
      record.status = 'captured-cpu-only';
      const responses = [];
      page.on('response', (response) => {
        if (response.url().includes('/preview-raw/')) responses.push(response.status());
      });
      await page.evaluate(() => {
        const control = document.querySelector('[data-path="hdr.exposure"]');
        control.value = "0.4";
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForFunction(() => state.previewInfo?.transport === "Raw RGBA8", null, { timeout: 60000 });
      await page.waitForTimeout(800);
      record.checks.cpuFallback = {
        transport: await page.evaluate(() => state.previewInfo?.transport),
        previewRawResponses: responses.length,
        canvasVisible: await page.locator('#preview-canvas').isVisible(),
      };
      assert.ok(responses.length > 0, 'the CPU-only capture did not observe an authoritative preview');
    } else {
      for (const [name, zoom] of [['fit', null], ['out-50', 50], ['native-100', 100],
        ['warm-50', 50], ['warm-100', 100], ['fit-return', null]]) {
        const started = Date.now();
        await page.evaluate((value) => {
          if (value === null) setZoomMode('fit'); else setCustomZoom(value);
        }, zoom);
        await page.waitForFunction(() => viewerState().status === 'ready'
          && state.acceptedPresentation?.processedLongEdge === requiredProcessingLongEdge(), null,
        { timeout: 600000 });
        await page.waitForFunction(() => (state.gpuPreview?.proxyInflight?.size || 0) === 0
          && !state.inactiveSourceController, null, { timeout: 60000 }).catch(() => null);
        const sample = await sampleStep(page, name);
        sample.exactMs = Date.now() - started;
        assert.ok(sample.drift === null || sample.drift <= 0.15,
          `${name}: logical peak drifted ${((sample.drift || 0) * 100).toFixed(1)}% from live memory`);
        record.steps.push(sample);
        console.log(`${name}: edge ${sample.accepted?.edge} ${sample.accepted?.execution}, `
          + `${sample.exactMs} ms, drift ${sample.drift === null ? 'n/a' : (sample.drift * 100).toFixed(1) + '%'}`);
      }
      // One painted pan at the native zoom the previous step left the viewer in.
      const pan = await page.evaluate(async () => {
        const before = els.dropzone.scrollTop;
        els.dropzone.scrollTop = before + 400;
        const at = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 350));
        const region = await state.gpuPreview?.readPresentationRegion?.(8, 8, 4, 4);
        const values = region?.values || [];
        let luma = 0;
        for (let index = 0; index + 3 < values.length; index += 4) {
          luma += (values[index] + values[index + 1] + values[index + 2]) / 3;
        }
        return { settleMs: performance.now() - at, luma, ready: viewerState().status };
      });
      record.checks.pan = pan;
      assert.ok(pan.luma > 0.02, `pan left an unpainted frame (luma ${pan.luma})`);
      record.checks.pan = pan;
      record.checks.failures = await page.evaluate(() => ({
        cpuFallbacks: JSON.parse(JSON.stringify(state.cpuFallbacks || {})),
        refusals: state.gpuDraftRefusals || 0,
      }));
    }
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(output, JSON.stringify(record, null, 2));
    console.log(`captured ${record.machine} (${record.class}) as ${record.status} -> ${output}`);
  } catch (error) {
    record.status = 'capture-failed';
    record.error = error?.message || String(error);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(output, JSON.stringify(record, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
