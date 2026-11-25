const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { defaultAppMemoryBytes } = require("../../desktop/lib/application-preferences");
const reusePhoto = require("../helpers/reuse-test-photo.cjs");

const output = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-finish-denoise-grain-"));
const baselineMethods = ["standard", "clean_grain_off", "clean_grain"];
const fullProofMethod = process.argv.find(arg => arg.startsWith("--full-proof-method="))?.split("=")[1];
const fullDeliveryFormat = process.argv.includes("--full-delivery-avif") ? "avif_gain_map" : "jpeg_ultrahdr";
const fullDeliveryRoute = process.argv.find(arg => arg.startsWith("--full-delivery-route="))?.split("=")[1];
const coldProofOnly = process.argv.includes("--cold-proof-only");
const phaseTwo = process.argv.find(arg => arg.startsWith("--phase2="))?.split("=")[1];
const phaseOne = phaseTwo || process.argv.find(arg => arg.startsWith("--phase1="))?.split("=")[1];
const ceilingOnly = process.argv.includes("--ceiling-only");
const cleanGrade = process.argv.find(arg => arg.startsWith("--clean-grade="))?.split("=")[1];
const phaseOneMemoryFailures = [];
const sliders = {
  amount: "amount", detail: "detail_recovery", luminance: "luminance", color: "color_noise",
  finest: "finest_noise", fine: "fine_noise", medium: "medium_noise", coarse: "coarse_noise",
  splotches: "color_splotches", evenness: "grain_evenness",
};

function peakBetween(samples, start, end) {
  const readings = samples.filter(sample => sample.at >= start - 500 && sample.at <= end);
  return readings.reduce((peak, sample) => !peak || sample.bytes > peak.bytes ? sample : peak, null);
}

async function seedGrainCachePressure(harness) {
  const route = "/api/library/cache-settings";
  const limit = 1024 ** 3;
  const reply = await harness.fetch(route, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_size_limit_gb: 1 }) });
  assert.ok(reply.ok);
  const initial = await reply.json();
  const directory = path.join(initial.location, "library-full-pictures");
  fs.mkdirSync(directory, { recursive: true });
  const old = path.join(directory, "grain-test-old.npz");
  const newer = path.join(directory, "grain-test-recent.npz");
  for (const [file, bytes, age] of [[old, limit - initial.full_size_used_bytes - 208 * 1024 ** 2, 1],
    [newer, 64 * 1024 ** 2, 2]]) {
    const handle = fs.openSync(file, "wx");
    try { fs.ftruncateSync(handle, bytes); } finally { fs.closeSync(handle); }
    fs.utimesSync(file, age, age);
  }
  const usage = await (await harness.fetch(route)).json();
  assert.equal(limit - usage.full_size_used_bytes, 144 * 1024 ** 2);
  return { old, newer };
}

async function checkPanCoverage(page, name, method) {
  const start = Date.now();
  await page.evaluate(() => {
    const samples = [];
    window.denoisePanSamples = samples;
    function sample() {
      if (window.denoisePanSamples !== samples) return;
      const soft = els.previewCanvas;
      const patch = soft.hdrFrameRegion;
      if (!previewIsVisible()) samples.push({ underlayer: false });
      if (patch) {
        const visible = visibleOutputRect(patch.frameWidth, patch.frameHeight, { includeWhole: true });
        const frame = soft.parentElement.getBoundingClientRect();
        const layer = soft.getBoundingClientRect();
        samples.push({
          scroll: [els.dropzone.scrollLeft, els.dropzone.scrollTop],
          covered: HDRViewportRequest.covers(patch, visible),
          underlayer: soft.style.display === "block" && layer.width > 0 && layer.height > 0
            && Math.abs(frame.left - layer.left) < 1 && Math.abs(frame.top - layer.top) < 1
            && Math.abs(frame.width - layer.width) < 1 && Math.abs(frame.height - layer.height) < 1,
          backing: [soft.width, soft.height],
          native: [patch.frameWidth, patch.frameHeight],
        });
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  const waitForSharp = previous => page.waitForFunction(previous => {
    const region = els.previewCanvas.hdrFrameRegion;
    return region && previewIdleNow() && state.acceptedPresentation?.exact
      && (els.dropzone.scrollLeft !== previous[0] || els.dropzone.scrollTop !== previous[1])
      && HDRViewportRequest.covers(region, visibleOutputRect(region.frameWidth, region.frameHeight, { includeWhole: true }));
  }, previous, { timeout: 90000 });
  const position = () => page.evaluate(() => [els.dropzone.scrollLeft, els.dropzone.scrollTop]);
  for (const distance of [80, 540]) {
    const previous = await position();
    const direction = previous[0] >= distance ? 1 : -1;
    // Grade pans through the scroll container and Navigate. Dragging the
    // photo itself does not move the scroll container.
    await page.evaluate(delta => { els.dropzone.scrollLeft -= delta; }, direction * distance);
    assert.notDeepEqual(await position(), previous, "Scrolling did not pan the Grade viewport.");
    await waitForSharp(previous);
  }
  const previous = await position();
  const navigation = page.locator("#navigation-thumb-image");
  await navigation.waitFor({ state: "visible", timeout: 15000 });
  const box = await navigation.boundingBox();
  const { nearLeft, nearTop } = await page.evaluate(() => ({
    nearLeft: els.dropzone.scrollLeft < (els.dropzone.scrollWidth - els.dropzone.clientWidth) / 2,
    nearTop: els.dropzone.scrollTop < (els.dropzone.scrollHeight - els.dropzone.clientHeight) / 2,
  }));
  await page.mouse.click(box.x + box.width * (nearLeft ? .93 : .07), box.y + box.height * (nearTop ? .93 : .07));
  await waitForSharp(previous);
  const samples = await page.evaluate(() => {
    const values = window.denoisePanSamples;
    window.denoisePanSamples = null;
    return values;
  });
  assert.ok(samples.length > 0);
  assert.ok(samples.every(sample => sample.underlayer), "A pan frame did not have a whole-photo underlayer.");
  assert.ok(samples.some(sample => !sample.covered), "No pan escaped the sharp patch.");
  assert.ok(samples.every(sample => sample.backing[0] < sample.native[0] && sample.backing[1] < sample.native[1]),
    "The soft picture used a native-sized surface.");
  const peak = peakBetween(await page.evaluate(() => window.denoiseBaselineMemory), start, Date.now());
  console.log(JSON.stringify({ name, method, action: "pan coverage at 100%", frames: samples.length,
    softFrames: samples.filter(sample => !sample.covered).length, memory: peak?.bytes ?? null }));
}

async function checkStillPicture(page, method, action, { changeExposure = false, reportOnly = false } = {}) {
  const counts = { sourceTile: 0, grainTile: 0, proxy: 0, grainPreparation: 0 };
  const count = request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/denoise-grain\/hdr$/.test(pathname)) counts.grainPreparation++;
    if (request.method() !== "GET") return;
    if (/\/source-tile\/hdr$/.test(pathname)) counts.sourceTile++;
    if (/\/denoise-grain\/hdr\/[^/]+$/.test(pathname)) counts.grainTile++;
    if (/\/proxy(?:-stream)?\/hdr$/.test(pathname)) counts.proxy++;
  };
  page.on("request", count);
  let picture;
  try {
    picture = await page.evaluate(async changeExposure => {
      const start = performance.now();
      const original = state.acceptedPresentation;
      let frames = 0, blanks = 0, softSwaps = 0, lastSharp = true;
      const errors = new Set();
      const needsPatch = state.zoomMode === "custom";
      if (changeExposure) commitAdjustmentValue("hdr.exposure", state.adjustments.hdr.exposure + 0.25, { manual: true });
      await new Promise(resolve => {
        const sample = () => {
          frames++;
          const canvas = els.previewCanvas;
          const patch = canvas.hdrFrameRegion;
          const sharp = !needsPatch || (patch && HDRViewportRequest.covers(patch,
            visibleOutputRect(patch.frameWidth, patch.frameHeight, { includeWhole: true })));
          if (!sharp && lastSharp) softSwaps++;
          lastSharp = sharp;
          if (!previewIsVisible()) blanks++;
          const error = state.previewUnavailableReason || state.denoiseRuntime.hdr.error;
          if (error) errors.add(error);
          if (performance.now() - start >= (changeExposure ? 10000 : 31000)) resolve();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      return { frames, blanks, softSwaps, sharp: Boolean(lastSharp), errors: [...errors],
        replaced: state.acceptedPresentation !== original, ready: viewerState().status === "ready" };
    }, changeExposure);
  } finally {
    page.off("request", count);
  }
  console.log(JSON.stringify({ method, action, ...counts, ...picture }));
  if (reportOnly) return;
  assert.ok(picture.frames > 0 && picture.sharp && picture.ready, action);
  assert.deepEqual(picture.errors, [], action);
  assert.equal(picture.blanks, 0, action);
  assert.equal(picture.softSwaps, 0, action);
  if (changeExposure) {
    assert.ok(picture.replaced, "The exposure change never presented.");
  } else {
    assert.equal(picture.replaced, false, action);
    assert.deepEqual(counts, { sourceTile: 0, grainTile: 0, proxy: 0, grainPreparation: 0 }, action);
  }
}

function backendLog(harness, start, end, method) {
  const log = fs.readFileSync(path.join(harness.userDataDirectory, "logs/backend.log"), "utf8");
  const preparation = [];
  const deliveryTurns = [];
  let peakAppBytes = null;
  for (const line of log.split(/\r?\n/)) {
    const match = line.match(/\[library\] (denoise_grain_prepared|app_memory|gpu_delivery_turn) (\{.*\})/);
    if (!match) continue;
    const event = JSON.parse(match[2]);
    if (event.time * 1000 < start || event.time * 1000 > end) continue;
    if (match[1] === "app_memory") {
      peakAppBytes = Math.max(peakAppBytes ?? 0, event.totalBytes);
    } else if (match[1] === "gpu_delivery_turn") {
      deliveryTurns.push(event);
    } else if (event.method === (method === "clean_grain_off" ? "clean_grain" : method)) {
      preparation.push({ usage: event.usage, edge: event.edge, width: event.width, height: event.height, ms: event.duration_ms,
        fitMs: event.fit_ms, filterMs: event.filter_ms, tileWorkerMs: event.tile_worker_ms,
        diskBytes: event.disk_bytes });
    }
  }
  return { preparation, peakAppBytes, ...(deliveryTurns.length ? { deliveryTurns } : {}) };
}

async function measurePicture(page, button, method, { pan = false, switchMethod = false,
  drag = false, release = false, trace = false, reportOnly = false, splotchSize } = {}) {
  return page.evaluate(async ({ button, method, pan, switchMethod, drag, release, trace, reportOnly, splotchSize }) => {
    const gpu = state.gpuPreview;
    const startingGrain = gpu.denoiseSourceSelector?.cache?.grain;
    const samePreparation = () => {
      const current = gpu.denoiseSourceSelector?.cache?.grain;
      if (startingGrain?.gpu) return startingGrain.fitKey === current?.fitKey;
      return startingGrain?.token ? startingGrain.token === current?.token : startingGrain === current;
    };
    performance.clearResourceTimings();
    const start = performance.now();
    const statuses = [];
    const sampleStatus = () => {
      const label = state.denoiseRuntime[state.currentView].status;
      if (label && label !== statuses.at(-1)?.label) {
        statuses.push({ label, ms: performance.now() - start, message: els.denoiseStatus.textContent });
      }
    };
    const observer = new MutationObserver(sampleStatus);
    if (trace) {
      sampleStatus();
      observer.observe(els.denoiseStatus, { childList: true, subtree: true, characterData: true });
    }
    let first;
    let dragFinished = !drag;
    let releasedAt;
    const liveDrag = drag && !release;
    const done = await new Promise((resolve, reject) => {
      let finished = false;
      const finish = (callback, value) => {
        finished = true;
        observer.disconnect();
        clearTimeout(timer);
        window.removeEventListener("hdrfinisher:preview-presented", presented);
        callback(value);
      };
      let final;
      const presented = ({ detail }) => {
        if (detail.sessionId !== state.session?.session_id || detail.lane !== state.currentView
            || detail.submittedAt < start) return;
        first ??= detail.presentedAt;
        const accepted = state.acceptedPresentation;
        const selector = gpu.denoiseSourceSelector;
        if (!dragFinished || (!liveDrag && (detail.coarse || detail.longEdge !== requiredProcessingLongEdge() || !accepted?.exact))
            || (method && (state.denoiseRuntime[state.currentView].status !== "ready"
              || selector?.selected !== "resolved" || (selector.controls?.method || "standard") !== method))) {
          final = undefined;
          return;
        }
        const region = els.previewCanvas.hdrFrameRegion || null;
        const visible = region && visibleOutputRect(region.frameWidth, region.frameHeight);
        final = {
          accepted, width: accepted.width, height: accepted.height, edge: detail.longEdge,
          execution: detail.execution, samePreparation: samePreparation(),
          serial: detail.serial, submittedAt: detail.submittedAt,
          backingWidth: (region ? els.previewDenoiseDetail : els.previewCanvas).width,
          backingHeight: (region ? els.previewDenoiseDetail : els.previewCanvas).height,
          region, visible,
        };
      };
      const timer = setTimeout(() => finish(reject, Error(JSON.stringify({
        button, method, accepted: state.acceptedPresentation, refusal: state.lastGpuDraftRefusal,
        status: state.denoiseRuntime[state.currentView].status,
        error: state.denoiseRuntime[state.currentView].error,
      }))), 120000);
      window.addEventListener("hdrfinisher:preview-presented", presented);
      if (pan) {
        const viewer = document.querySelector("#dropzone");
        const previous = viewer.scrollLeft;
        const distance = pan === "outside" ? 550 : 180;
        viewer.scrollLeft += previous >= distance ? -distance : distance;
        if (viewer.scrollLeft === previous) return finish(reject, Error("The test pan did not move the picture."));
        if (pan === "outside" && els.previewCanvas.hdrFrameRegion) {
          const region = els.previewCanvas.hdrFrameRegion;
          const visible = visibleOutputRect(region.frameWidth, region.frameHeight, { includeWhole: true });
          if (window.HDRViewportRequest.covers(region, visible)) {
            return finish(reject, Error("The longer test pan did not leave the sharp patch."));
          }
        }
      } else if (switchMethod) {
        const cleanColor = method !== "clean_grain_off";
        if (state.denoise[state.currentView].controls.method === "clean_grain") {
          state.denoise[state.currentView].controls.clean_splotches = cleanColor;
          els.denoiseCleanFringes.checked = cleanColor;
          els.denoiseCleanFringes.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          state.denoise[state.currentView].controls.clean_splotches = cleanColor;
          state.denoise[state.currentView].controls.clean_fringes = cleanColor;
          els.denoiseMethod.value = "clean_grain";
          els.denoiseMethod.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else if (splotchSize) {
        els.denoiseSplotchSize.value = splotchSize;
        els.denoiseSplotchSize.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (drag) {
        const control = document.querySelector(button);
        const value = Number(control.value);
        const target = value + (value > .5 ? -.15 : .15);
        state.previewScheduler?.beginInteraction();
        for (let step = 1; step <= 3; step++) {
          window.setTimeout(() => {
            if (step === 3) dragFinished = true;
            control.value = String(value + (target - value) * step / 3);
            control.dispatchEvent(new Event("input", { bubbles: true }));
            if (step === 3 && release) {
              releasedAt = performance.now();
              control.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }, 40 * (step - 1));
        }
      } else if (button === "recalculate") {
        void recalculateDenoise(state.currentView, { force: true });
      } else if (button === "110%") {
        els.zoomReadout.value = button;
        commitZoomReadout();
      } else {
        document.querySelector(button).click();
      }
      let frames = 0;
      const settle = () => {
        if (finished) return;
        // Time the painted frame. Confirm after queued refinements have
        // drained so a later replacement can never be scored as the final one.
        if (final && final.at === undefined) final.at = performance.now();
        const idle = ++frames >= 3 && !state.zoomRefinementTimer
          && (reportOnly || (liveDrag ? !state.denoiseInputQueue?.busy && !state.gpuDraftInFlight : previewIdleNow()));
        if (idle && final && final.accepted === state.acceptedPresentation) {
          finish(resolve, { ...final, presented: true, observedAt: performance.now() });
        } else if (idle && pan && first === undefined) {
          // The compositor can reposition a complete canvas without a draw.
          const region = els.previewCanvas.hdrFrameRegion || null;
          const visible = region && visibleOutputRect(region.frameWidth, region.frameHeight, { includeWhole: true });
          if (region && !window.HDRViewportRequest.covers(region, visible)) {
            requestAnimationFrame(settle);
            return;
          }
          finish(resolve, { edge: state.acceptedPresentation.processedLongEdge, region, visible,
            samePreparation: samePreparation(), observedAt: performance.now() });
        } else {
          requestAnimationFrame(settle);
        }
      };
      requestAnimationFrame(settle);
    });
    const requests = performance.getEntriesByType("resource").flatMap(entry => {
      const url = new URL(entry.name);
      if (entry.startTime < start || entry.startTime > done.observedAt) return [];
      const preparation = url.pathname.match(/\/denoise-grain\/[^/]+(\/[^/]+)?$/);
      const source = /\/denoise-(?:model|measurement)\//.test(url.pathname);
      if (!preparation && !source) return [];
      return [{
        kind: preparation ? (preparation[1] ? "correction region" : "grain preparation") : "noise model",
        edge: Number(url.searchParams.get("long_edge")) || null,
        startMs: entry.startTime - start,
        ms: entry.duration,
        bytes: entry.decodedBodySize,
        responseStatus: entry.responseStatus || null,
      }];
    });
    return {
      timeStart: performance.timeOrigin + start,
      timeEnd: performance.timeOrigin + done.observedAt,
      firstMs: first === undefined ? null : first - start,
      pictureMs: (done.presented ? done.at : done.observedAt) - start,
      releaseToPictureMs: releasedAt === undefined ? null : done.at - releasedAt,
      submitToPaintMs: done.submittedAt === undefined ? null : done.at - done.submittedAt,
      edge: done.edge, width: done.width, height: done.height, execution: done.execution,
      backingWidth: done.backingWidth, backingHeight: done.backingHeight, region: done.region,
      viewportCovered: !done.region || Boolean(done.visible && done.region.x <= done.visible.x
        && done.region.y <= done.visible.y && done.region.x + done.region.width >= done.visible.x + done.visible.width
        && done.region.y + done.region.height >= done.visible.y + done.visible.height),
      samePreparation: done.samePreparation,
      requests,
      ...(trace ? {
        zoom: state.zoomPercent, statuses,
        stages: gpu.performanceMetrics.stages.filter(event => event.at >= start
          && (event.stage.startsWith("fine-grain-") || ["denoise-analysis", "denoise-cancel", "denoise-resolve",
            "tiled-render", "denoise-tile-upload", "tiled-cancelled", "grading", "proxy-request"].includes(event.stage))),
        renders: gpu.performanceMetrics.renders.filter(event => event.serial === done.serial),
      } : {}),
    };
  }, { button, method, pan, switchMethod, drag, release, trace, reportOnly, splotchSize });
}

async function captureFinishedGrade(page, destination) {
  const metadata = await page.evaluate(() => {
    const target = window.fineGrainCapture;
    if (!target || target.lane !== state.currentView || target.longEdge !== requiredProcessingLongEdge()) {
      throw Error("Missing matching finished presentation texture.");
    }
    const { width, height, format } = target.texture;
    return { width, height, region: target.region, format };
  });
  assert.equal(metadata.format === "rgba16float", destination.includes("-hdr-"), "Wrong presentation colour format.");
  const descriptor = fs.openSync(`${destination}.rgba`, "w");
  try {
    for (let row = 0; row < metadata.height; row += 96) {
      const data = await page.evaluate(async ({ row, metadata }) => {
        const gpu = state.gpuPreview;
        const target = window.fineGrainCapture;
        const { width, height: fullHeight, format } = target.texture;
        if (width !== metadata.width || fullHeight !== metadata.height
            || format !== metadata.format || JSON.stringify(target.region) !== JSON.stringify(metadata.region)) {
          throw Error("The finished presentation changed during capture.");
        }
        const height = Math.min(96, fullHeight - row);
        const rowBytes = width * (format === "rgba16float" ? 8 : 4);
        const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
        const buffer = gpu.device.createBuffer({ size: bytesPerRow * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
          const encoder = gpu.device.createCommandEncoder();
          encoder.copyTextureToBuffer({ texture: target.texture, origin: { y: row } }, { buffer, bytesPerRow },
            { width, height });
          gpu.device.queue.submit([encoder.finish()]);
          await buffer.mapAsync(GPUMapMode.READ);
          const bytes = new Uint8Array(buffer.getMappedRange());
          const tight = new Uint8Array(rowBytes * height);
          for (let index = 0; index < height; index++) {
            tight.set(bytes.subarray(index * bytesPerRow, index * bytesPerRow + rowBytes), index * rowBytes);
          }
          return tight.toBase64();
        } finally {
          buffer.destroy();
        }
      }, { row, metadata });
      fs.writeSync(descriptor, Buffer.from(data, "base64"));
    }
    fs.writeFileSync(`${destination}.json`, JSON.stringify(metadata));
  } finally {
    fs.closeSync(descriptor);
  }
}

async function measurePhaseOne(page, name, record, setZoom) {
  const captures = path.resolve(process.env.HDR_FINISHER_GRAIN_CAPTURES || (phaseTwo ? "output/denoise-grain-phase2" : "output/denoise-grain-phase1"));
  fs.mkdirSync(captures, { recursive: true });
  const gpuRoute = phaseOne === "gpu";
  const method = cleanGrade ? "clean_grain" : "clean_grain_off";
  await page.evaluate(({ enableGpu, capturePixels }) => {
    const gpu = state.gpuPreview;
    if (!enableGpu) gpu.enableGradeCleanGrainGpu = false;
    gpu.setInstrumentationEnabled(true);
    if (!capturePixels || gpu.captureFineGrainGradeInstalled) return;
    gpu.captureFineGrainGradeInstalled = true;
    const render = gpu.renderTo;
    gpu.renderTo = function (canvas, session, lane, adjustments, sampler, longEdge, locals, revision, overlay, white, size, options) {
      if (options?.applicationGeneration === undefined || options.fineGrainUnderlayer || options.measureOnly) {
        return render.apply(this, arguments);
      }
      return render.call(this, canvas, session, lane, adjustments, sampler, longEdge, locals, revision, overlay, white, size, {
        ...options,
        onFrameSubmitted: (region, hdr) => {
          options.onFrameSubmitted?.(region, hdr);
          if (lane !== state.currentView || (!state.denoise[lane].enabled && !window.captureGrainOriginal)
            || longEdge !== requiredProcessingLongEdge()) return;
          const source = canvas.getContext("webgpu").getCurrentTexture();
          const prior = window.fineGrainCapture?.texture;
          const { width, height, format } = source;
          const texture = prior?.width === width && prior.height === height && prior.format === format ? prior
            : this.device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
          if (texture !== prior) prior?.destroy();
          const encoder = this.device.createCommandEncoder();
          encoder.copyTextureToTexture({ texture: source }, { texture }, { width, height });
          this.device.queue.submit([encoder.finish()]);
          window.fineGrainCapture = { texture, region, lane, longEdge };
        },
      });
    };
  }, { enableGpu: gpuRoute, capturePixels: process.env.HDR_FINISHER_GRAIN_NO_CAPTURE !== "1" });
  const selectMethod = () => page.evaluate(async ({ method, cleanGrade }) => {
    if (cleanGrade) await commitDenoiseControl("splotch_size", cleanGrade);
    await commitDenoiseControl("method", "clean_grain");
    await commitDenoiseControl("clean_splotches", method !== "clean_grain_off");
    await commitDenoiseControl("clean_fringes", method !== "clean_grain_off");
  }, { method, cleanGrade });
  const check = async (action, button, options = {}, fallback = false) => {
    const result = await record(method, `${phaseOne}: ${action}`, button, { trace: true, ...options });
    assert.ok(result.peakAppBytes > 0, `${action}: missing app memory sample`);
    if (gpuRoute && result.peakAppBytes >= defaultAppMemoryBytes()) {
      phaseOneMemoryFailures.push(`${name}, ${action}: ${result.peakAppBytes} app bytes`);
    }
    const grain = await page.evaluate(() => {
      const grain = state.gpuPreview.denoiseSourceSelector.cache.grain;
      return { gpu: Boolean(grain?.gpu), token: grain?.token };
    });
    assert.equal(grain.gpu, gpuRoute && !fallback, action);
    const preparations = result.preparationRequests.filter(request => request.route.startsWith("denoise-grain/"));
    if (gpuRoute && !fallback) assert.deepEqual(preparations, [], action);
    else assert.ok(grain.token, `${action}: missing CPU Fine Grain correction`);
    if (fallback) {
      assert.equal(result.stages.filter(event => event.stage === "fine-grain-fallback").length, 1);
      assert.equal(preparations.length, 1);
    }
    return result;
  };
  if (ceilingOnly) {
    await page.evaluate(async () => {
      Object.assign(state.adjustments.hdr, {
        highlight_section_enabled: true,
        highlight_compression_mode: "clip",
        highlight_compression_start_nits: 300,
        highlight_compression_target_nits: 600,
        exposure: 3,
      });
      markGlobalEditDirty();
      if (!await syncGlobalEditState()) throw Error("Could not save the HDR ceiling test settings.");
      const gpu = state.gpuPreview;
      const indices = window.HDRGpuParamLayout.indices;
      const output = "return vec4f(encoded, 1.0);";
      const shader = window.HDRWebGPUShaders.SHADER_SOURCE;
      if (shader.split(output).length !== 2) throw Error("Could not identify the Grade output boundary.");
      const module = gpu.device.createShaderModule({ code: shader.replace(output, `
        let transport = acescgToBt2020(filmOutput);
        let peak = max(max(transport.r, transport.g), transport.b) / 0.18 * p[${indices.PROJECT_REFERENCE_WHITE_NITS}];
        let bits = bitcast<u32>(peak);
        return vec4f(f32(bits & 2047u), f32((bits >> 11u) & 2047u), f32(bits >> 22u), 1.0);`) });
      const pipelines = gpu.pipelineFor("rgba16float");
      pipelines.composite = await gpu.device.createRenderPipelineAsync({
        layout: gpu.pipelineLayout,
        vertex: { module, entryPoint: "vertexMain" },
        fragment: { module, entryPoint: "fragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
    });
    await selectMethod();
    for (const zoom of ["110%", "Fit"]) {
      await setZoom(zoom === "Fit" ? "#zoom-fit" : zoom);
      await check(`ceiling at ${zoom}`, "#denoise-bypass");
      await captureFinishedGrade(page, path.join(captures, `${name}-hdr-${zoom}-ceiling`));
      await page.evaluate(() => setDenoiseEnabled(false));
      await page.waitForFunction(() => previewIdleNow());
    }
    return;
  }
  for (const lane of ["hdr", "sdr"]) {
    if (await page.evaluate(() => state.currentView) !== lane) {
      await page.locator(`#view-${lane}`).click();
      await page.waitForFunction(lane => state.currentView === lane && previewIdleNow(), lane);
    }
    if (phaseTwo && lane === "sdr") await page.evaluate(() => {
      state.denoise.sdr.controls = structuredClone(state.denoise.hdr.controls);
    });
    await selectMethod();
    const capture = zoom => captureFinishedGrade(page, path.join(captures, `${name}-${lane}-${zoom}-${phaseOne}`));
    for (const zoom of ["110%", "Fit"]) {
      await setZoom(zoom === "Fit" ? "#zoom-fit" : zoom);
      if (!phaseTwo) await page.evaluate(() => {
        state.gpuPreview.fineGrainFits.clear();
        if (state.denoiseGrainRefresh) state.denoiseGrainRefresh.scene++;
      });
      const result = await check(`first preparation at ${zoom}`, "#denoise-bypass");
      if (zoom === "110%") assert.ok(result.region && result.zoom === 110, "Expected a bounded 110% picture.");
      if (process.env.HDR_FINISHER_GRAIN_NO_CAPTURE !== "1") await capture(zoom);
      if (zoom === "110%" && lane === "hdr") {
        const originalEvenness = await page.evaluate(() => state.denoise.hdr.controls.grain_evenness);
        const drag = await check("Evenness drag at 110%", "#denoise-evenness", { drag: true, release: true });
        if (gpuRoute) assert.ok(drag.samePreparation, "Evenness replaced the whole-photo measurement.");
        const evenness = await page.evaluate(() => ({ value: state.denoise.hdr.controls.grain_evenness,
          rendered: state.gpuPreview.denoiseSourceSelector.controls.grainEvenness,
          pending: state.denoiseInputQueue?.busy }));
        assert.equal(evenness.rendered, evenness.value);
        assert.equal(Boolean(evenness.pending), false);
        if (gpuRoute && process.env.HDR_FINISHER_GRAIN_NO_CAPTURE !== "1") await capture("post-drag");
        await check("pan at 110%", null, { pan: true });
        if (process.env.HDR_FINISHER_GRAIN_NO_CAPTURE !== "1") await capture("pan");
        if (phaseTwo) {
          await check("pan outside the sharp patch at 110%", null, { pan: "outside" });
          if (gpuRoute && process.env.HDR_FINISHER_GRAIN_NO_CAPTURE !== "1") await capture("pan-wide");
          if (process.argv.includes("--wide-pan-only")) return;
          if (cleanGrade) {
            const strength = await page.evaluate(() => state.denoise.hdr.controls.color_splotches);
            const blend = await check("Color Splotches drag at 110%", "#denoise-splotches", { drag: true, release: true });
            assert.ok(blend.samePreparation, "Color Splotches replaced preparation.");
            const otherSize = cleanGrade === "small" ? "large" : "small";
            const size = await check(`Splotch Size to ${otherSize} at 110%`, null, { splotchSize: otherSize });
            if (gpuRoute) assert.ok(size.samePreparation, "Splotch Size replaced the whole-photo measurement.");
            await page.evaluate(async strength => {
              await updateLiveDenoiseControl("color_splotches", strength);
              await commitDenoiseControl("color_splotches");
            }, strength);
          }
          await page.evaluate(async evenness => {
            await setDenoiseEnabled(false);
            await commitDenoiseControl("grain_evenness", evenness);
          }, originalEvenness);
          await page.waitForFunction(() => previewIdleNow());
          if (cleanGrade) await selectMethod();
          continue;
        }
      }
      if (cleanGrade && lane === "hdr" && zoom === "Fit") {
        const strength = await page.evaluate(() => state.denoise.hdr.controls.color_splotches);
        const blend = await check("Color Splotches drag at Fit", "#denoise-splotches", { drag: true, release: true });
        assert.ok(blend.samePreparation, "Fit blend replaced preparation.");
        if (gpuRoute) assert.ok(!blend.stages.some(event => event.stage === "fine-grain-reduced"),
          "Fit blend reduced the native photo again.");
        await page.evaluate(async strength => {
          await updateLiveDenoiseControl("color_splotches", strength);
          await commitDenoiseControl("color_splotches");
        }, strength);
        await page.waitForFunction(() => previewIdleNow() && !state.denoiseInputQueue?.busy);
        if (gpuRoute && cleanGrade === "small" && name === "IMG_0790.CR2") {
          const size = await check("Splotch Size to large at Fit", null, { splotchSize: "large" });
          assert.ok(size.samePreparation, "Fit size replaced the whole-photo measurement.");
          await page.evaluate(() => commitDenoiseControl("splotch_size", "small"));
          await page.waitForFunction(() => previewIdleNow() && !state.denoiseInputQueue?.busy);
        }
      }
      if (phaseTwo && zoom === "Fit" && gpuRoute) {
        assert.ok(!result.stages.some(event => event.stage === "fine-grain-fit"), "Fit repeated the zoom measurement.");
        if (lane === "sdr") assert.ok(result.stages.some(event => event.stage === "fine-grain-reduced-hit"),
          "Generated SDR did not reuse the matching HDR Fit result.");
      }
      await page.evaluate(() => setDenoiseEnabled(false));
      await page.waitForFunction(() => previewIdleNow());
    }
    if (cleanGrade && lane === "hdr") {
      const originalEvenness = await page.evaluate(() => state.denoise.hdr.controls.grain_evenness);
      await page.evaluate(async () => {
        // Use a fresh Evenness so the measurement times a first Clean
        // reconstruction with colour cleaning, with no matching old tile.
        await commitDenoiseControl("grain_evenness", 0.92);
        await commitDenoiseControl("method", "clean_grain");
        await commitDenoiseControl("clean_splotches", false);
        await commitDenoiseControl("clean_fringes", false);
      });
      await setZoom("110%");
      await page.evaluate(() => setDenoiseEnabled(true));
      await page.waitForFunction(() => previewIdleNow() && !state.denoiseInputQueue?.busy
        && state.denoiseRuntime.hdr.status === "ready" && !state.denoiseRuntime.hdr.analysisInFlight);
      const switched = await check("Turn colour cleaning on at 110%", null, { switchMethod: true });
      if (gpuRoute) {
        assert.ok(switched.samePreparation, "Toggling colour cleaning replaced the whole-photo measurement.");
        assert.ok(switched.stages.some(event => event.stage === "tiled-render" && event.denoiseTileResolves > 0),
          "The first colour-cleaning toggle reused older corrected tiles.");
      }
      await page.evaluate(async evenness => {
        await setDenoiseEnabled(false);
        await commitDenoiseControl("grain_evenness", evenness);
      }, originalEvenness);
      await setZoom("#zoom-fit");
    }
    if (phaseTwo && lane === "hdr" && gpuRoute && name === "IMG_0790.CR2"
        && process.env.HDR_FINISHER_GRAIN_NO_CAPTURE !== "1") {
      const before = path.join(captures, `${name}-hdr-bypass-before`);
      const after = path.join(captures, `${name}-hdr-bypass-after`);
      const draw = () => page.evaluate(async () => {
        window.captureGrainOriginal = true;
        invalidatePreview("hdr", { markDirty: false });
        if (!await renderGpuDraft("hdr", { longEdge: refinementProxyLongEdge() })) {
          throw Error("The original picture did not draw.");
        }
        window.captureGrainOriginal = false;
      });
      await draw();
      await captureFinishedGrade(page, before);
      const original = fs.readFileSync(`${before}.rgba`);
      assert.ok(!fs.readFileSync(`${path.join(captures, name)}-hdr-Fit-gpu.rgba`).equals(original),
        `${method} must change the finished pixels for this photo.`);
      await page.evaluate(async () => {
        await setDenoiseEnabled(true);
        if (!gradeGrainGpuEnabled("hdr") || !state.gpuPreview.denoiseSourceSelector.cache.grain?.gpu) {
          throw Error("Missing default GPU Grain result.");
        }
        state.denoiseRuntime.hdr.showOriginal = true;
        if (gradeGrainGpuEnabled("hdr")) throw Error("Show original did not switch off GPU Grain.");
      });
      await page.waitForFunction(() => previewIdleNow());
      await draw();
      await captureFinishedGrade(page, after);
      assert.ok(fs.readFileSync(`${after}.rgba`).equals(original),
        "Show original must restore the original Grade pixels with a cached GPU correction");
      await page.evaluate(async () => {
        await setDenoiseEnabled(false);
        if (gradeGrainGpuEnabled("hdr")) throw Error("Denoise off did not switch off GPU Grain.");
      });
      await page.waitForFunction(() => previewIdleNow());
      await draw();
      await captureFinishedGrade(page, after);
      assert.ok(fs.readFileSync(`${after}.rgba`).equals(original),
        "Bypassing GPU Grain must restore the original Grade pixels");
      console.log(`${method}: Show original and bypass matched the finished undenoised Grade pixels.`);
      for (const base of [before, after]) {
        fs.rmSync(`${base}.rgba`);
        fs.rmSync(`${base}.json`);
      }
    }
    if (lane === "sdr" && gpuRoute && name === "IMG_0790.CR2") {
      await page.evaluate(() => {
        const renderer = state.gpuPreview;
        renderer.releaseFineGrainReduced();
        const original = renderer.resizeNativeFineGrain;
        renderer.resizeNativeFineGrain = function (...args) {
          this.resizeNativeFineGrain = original;
          throw Error("Injected Fine Grain resize failure");
        };
        state.denoiseGrainRefresh.scene++;
      });
      await check("injected failure at Fit", "#denoise-bypass", {}, true);
      if (cleanGrade && process.env.HDR_FINISHER_GRAIN_NO_CAPTURE !== "1") {
        await captureFinishedGrade(page, path.join(captures, `${name}-sdr-Fit-fallback`));
      }
      await page.evaluate(() => setDenoiseEnabled(false));
      await page.waitForFunction(() => previewIdleNow());
    }
  }
}

async function measureDelivery(page, harness, name, method, record, proofOnly = false) {
  const format = fullDeliveryFormat;
  const extension = format === "avif_gain_map" ? "avif" : "jpg";
  const formatName = extension === "avif" ? "AVIF Gain Map" : "JPEG Ultra HDR";
  const target = path.join(output, `${name}-${method}.${extension}`);
  let exportSha256;
  if (!proofOnly) await harness.selectExportPath(target);
  await page.evaluate(async ({ measureFullProof, format }) => {
    if (measureFullProof) activateWorkflowTab("export");
    state.denoise.sdr = structuredClone(state.denoise.hdr);
    if (!await persistDenoiseSettings()) throw Error("Could not save the SDR Denoise method.");
    if (!measureFullProof) activateWorkflowTab("export");
    els.exportFormat.value = format;
    els.exportQuality.value = "90";
    els.exportResizeMode.value = "original";
    els.exportGuaranteePeak.checked = true;
    if (measureFullProof) els.exportMetadataPolicy.value = "none";
  }, { measureFullProof: Boolean(fullProofMethod), format });
  if (!proofOnly) {
    const deliveryResponse = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/export"), { timeout: 180000 });
    const [result, response] = await Promise.all([page.evaluate(async () => {
      const start = performance.now();
      await exportCurrentSession();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { pictureMs: performance.now() - start, timeStart: performance.timeOrigin + start,
        timeEnd: performance.timeOrigin + performance.now(), status: window.HDRStatus.get("export"),
        savedPath: state.lastExportPath };
    }), deliveryResponse]);
    const delivery = await response.json();
    const accepted = response.ok() && delivery.accepted && fs.existsSync(target) && result.savedPath
      && fs.realpathSync(result.savedPath) === fs.realpathSync(target) && fs.statSync(target).size > 0;
    await record(`full-size ${formatName} export`, {
      ...result, accepted, renderer: delivery.renderer, timingsMs: delivery.timings_ms,
      fallback: delivery.fallback_reason,
    });
    assert.ok(accepted, JSON.stringify(result));
    if (fullProofMethod) exportSha256 = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
    fs.rmSync(target);
  }

  const fullProof = Boolean(fullProofMethod) || method === "standard" && process.argv.includes("--speed-memory-full-proof");
  await page.evaluate(({ fullSize, format }) => {
    activateWorkflowTab("proof");
    state.proofFormat = format;
    state.proofSize = fullSize ? "full" : "reduced";
    state.proofTarget = "custom";
    state.proofCustomNits = 1000;
  }, { fullSize: fullProof, format });
  const proofStart = await page.evaluate(() => {
    const start = performance.timeOrigin + performance.now();
    els.chromeProofRefresh.click();
    return start;
  });
  await page.waitForFunction(fullSize => els.chromeProofStatus.dataset.state === "error"
    || (state.proofArtifact?.full_size === fullSize && !state.proofDirty && els.chromeProofImage.complete
      && els.chromeProofImage.naturalWidth > 0 && els.chromeProofImage.style.display !== "none"),
  fullProof, { timeout: fullProofMethod ? 240000 : 120000 });
  const proof = await page.evaluate(async start => {
    if (els.chromeProofStatus.dataset.state === "error") throw Error(els.chromeProofStatus.textContent);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const end = performance.timeOrigin + performance.now();
    return { pictureMs: end - start, timeStart: start, timeEnd: end,
      status: els.chromeProofStatus.textContent,
      renderer: state.proofArtifact.renderer, width: state.proofArtifact.width, height: state.proofArtifact.height,
      artifactSha256: state.proofArtifact.sha256,
      hdrTile: state.proofReconstruction?.tile, sdrTile: state.proofSdrReconstruction?.tile };
  }, proofStart);
  if (fullProofMethod) proof.exportSha256 = exportSha256;
  if (fullProofMethod && format === "jpeg_ultrahdr") {
    for (const [key, tile] of [["hdrTileSha256", proof.hdrTile], ["sdrTileSha256", proof.sdrTile]]) {
      const response = await harness.fetch(tile.url);
      assert.ok(response.ok, tile.url);
      proof[key] = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
    }
  }
  await record(`${fullProof ? "full-size" : "reduced"} ${formatName} Proof`, proof);
  if (fullProofMethod && !proofOnly) assert.equal(proof.artifactSha256, exportSha256, "Full-size Proof differs from export");
  await page.evaluate(async () => {
    activateWorkflowTab("grade");
    state.denoise.sdr.enabled = false;
    await persistDenoiseSettings();
  });
}

function deliveryRecorder(page, harness, name, method) {
  return async (action, result) => {
    const backend = backendLog(harness, result.timeStart, result.timeEnd, method);
    const samples = await page.evaluate(() => window.denoiseBaselineMemory);
    const peak = peakBetween(samples, result.timeStart, result.timeEnd);
    const during = samples.filter(sample => sample.at >= result.timeStart && sample.at <= result.timeEnd);
    const peakBackend = during.reduce((largest, sample) => {
      const bytes = sample.processes?.find(row => row.pid === sample.backendPid)?.chargedBytes || 0;
      return bytes > (largest?.bytes || 0)
        ? { at: sample.at, bytes, heap: sample.backendHeap, gradeBytes: sample.gradeBytes, caches: sample.caches }
        : largest;
    }, null);
    console.log(JSON.stringify({ name, method, action, ...result, ...backend,
      peakAppBytes: peak?.bytes ?? backend.peakAppBytes, peakProcesses: peak?.processes, peakBackend }));
  };
}

async function measureBaseline(page, harness, name, record, setZoom) {
  const memoryRun = process.argv.includes("--speed-memory");
  const warmOnly = process.argv.includes("--speed-memory-warm-only");
  await page.evaluate(() => {
    state.gpuPreview?.setInstrumentationEnabled(true);
    els.denoiseBypass.closest(".control-group").querySelector(".group-toggle")
      ?.setAttribute("aria-expanded", "true");
  });
  if (!process.argv.includes("--baseline-fit-native-only")) {
    await setZoom("110%");
    for (const method of baselineMethods) {
      const standard = method === "standard";
      await record(method, standard ? "enable at 110%" : "switch at 110%",
        standard ? "#denoise-bypass" : null, { switchMethod: !standard, trace: true });
      if (warmOnly) {
        await record(method, "110% to Fit", "#zoom-fit", { trace: true });
        await record(method, "Fit to 100%", "#zoom-actual", { trace: true });
        await record(method, "100% to 110%", "110%", { trace: true });
      }
    }
    if (warmOnly) await setZoom("#zoom-fit");
    await page.evaluate(() => setDenoiseEnabled(false));
  }
  if (name === "DSC01212.ARW" || process.argv.includes("--baseline-110-only")) return;
  const resumeAfterStandard = process.argv.includes("--baseline-after-standard-export");
  const resumeFineDelivery = process.argv.includes("--baseline-fine-delivery-only");
  const runDelivery = async (method, proofOnly) => {
    try {
      await measureDelivery(page, harness, name, method, deliveryRecorder(page, harness, name, method), proofOnly);
    } catch (error) {
      console.log(JSON.stringify({ name, method, action: "delivery", error: error.message }));
      process.exitCode = 1;
      await page.evaluate(async () => {
        activateWorkflowTab("grade");
        state.denoise.sdr.enabled = false;
        await persistDenoiseSettings();
      });
    }
  };
  const methods = resumeFineDelivery ? ["standard", "clean_grain", "clean_grain_off"] : baselineMethods;
  for (const method of methods) {
    if (warmOnly) {
      if (process.argv.includes("--baseline-delivery")) {
        await setZoom("#zoom-fit");
        await page.evaluate(async method => {
          if (state.denoise.hdr.enabled) await setDenoiseEnabled(false);
          await commitDenoiseControl("method", method === "clean_grain_off" ? "clean_grain" : method);
          await commitDenoiseControl("clean_splotches", method !== "clean_grain_off");
          await commitDenoiseControl("clean_fringes", method !== "clean_grain_off");
          // Delivery reads the authored settings from both lanes. Grade is
          // already covered by the zoom sequence above.
          state.denoise.hdr.enabled = true;
          await persistDenoiseSettings();
        }, method);
        await runDelivery(method, false);
      }
      continue;
    }
    if (resumeAfterStandard && method === "standard") {
      await page.evaluate(() => setDenoiseEnabled(true));
      await runDelivery(method, true);
      continue;
    }
    if (method === "clean_grain_off" && resumeFineDelivery) {
      await page.evaluate(async () => {
        if (state.denoise.hdr.enabled) await setDenoiseEnabled(false);
        await commitDenoiseControl("method", "clean_grain");
        await commitDenoiseControl("clean_splotches", false);
        await commitDenoiseControl("clean_fringes", false);
        await setDenoiseEnabled(true);
      });
      await runDelivery(method, false);
      continue;
    }
    for (const zoom of resumeFineDelivery ? ["100%", "Fit"] : ["Fit", "100%"]) {
      await page.evaluate(async method => {
        if (state.denoise.hdr.enabled) await setDenoiseEnabled(false);
        await commitDenoiseControl("method", method === "clean_grain_off" ? "clean_grain" : method);
        await commitDenoiseControl("clean_splotches", method !== "clean_grain_off");
        await commitDenoiseControl("clean_fringes", method !== "clean_grain_off");
        const runtime = state.denoiseRuntime.hdr;
        runtime.refresh = (runtime.refresh || 0) + 1;
        runtime.dirty = true;
      }, method);
      await setZoom(zoom === "Fit" ? "#zoom-fit" : "#zoom-actual");
      await record(method, `first preparation at ${zoom}`, "#denoise-bypass", { trace: true });
      if (zoom === "Fit") {
        if (!memoryRun) await record(method, "Recalculate at Fit", "recalculate", { trace: true });
        if (memoryRun) {
          const value = await page.locator("#denoise-detail").evaluate(el => Number(el.value));
          await record(method, "detail_recovery drag", "#denoise-detail",
            { drag: true, release: method === "standard", trace: true });
          await page.evaluate(async value => {
            state.previewScheduler?.endInteraction();
            state.denoiseWholeFrameStale = null;
            await updateLiveDenoiseControl("detail_recovery", value);
            if (state.denoise.hdr.controls.method === "standard") await persistDenoiseSettings();
          }, value);
        }
        if (process.argv.includes("--baseline-drags")) {
          for (const [id, key] of Object.entries(sliders)) {
            if (id === "evenness" && method === "standard" || id === "splotches" && method !== "clean_grain") continue;
            const release = method === "standard" || id === "evenness" || id === "splotches";
            const button = `#denoise-${id}`;
            const value = await page.locator(button).evaluate(el => Number(el.value));
            await record(method, `${key} drag`, button, { drag: true, release, trace: true });
            if (id === "evenness") {
              // This is the last drag. Reset on the way to the next cold
              // preparation, so the reset does not rebuild the Fit picture.
              await page.evaluate(async value => {
                await setDenoiseEnabled(false);
                await commitDenoiseControl("grain_evenness", value);
              }, value);
            } else {
              await page.evaluate(async ({ key, value }) => {
                state.previewScheduler?.endInteraction();
                state.denoiseWholeFrameStale = null;
                await updateLiveDenoiseControl(key, value);
                if (key === "color_splotches" || state.denoise.hdr.controls.method === "standard") {
                  await persistDenoiseSettings();
                }
              }, { key, value });
            }
          }
        }
      } else {
        if (memoryRun) {
          await record(method, "100% to 110%", "110%", { trace: true });
          await record(method, "110% to Fit", "#zoom-fit", { trace: true });
          await record(method, "Fit to 100%", "#zoom-actual", { trace: true });
        }
        await record(method, "100% to Fit", "#zoom-fit", { trace: true });
        await record(method, "Fit to 100%", "#zoom-actual", { trace: true });
        if (!memoryRun) await record(method, "pan at 100%", null, { pan: true, trace: true });
      }
    }
    if (process.argv.includes("--baseline-delivery")) {
      await setZoom("#zoom-fit");
      await runDelivery(method, false);
    }
  }
}

async function measureMicroLensMemory(page, harness) {
  const name = "_DSC7970.ARW";
  const file = reusePhoto(name, path.resolve(__dirname, "../../output/gpu-raw", name));
  const settings = {
    white_balance: "as_shot", demosaic: "ahd",
    pixel_cleanup: { remove_hot_pixels: false, even_out_specks: true, speck_threshold: 2.5 },
    highlight_reconstruction: { enabled: true, method: "opposed_color_v1", clipping_threshold: 1,
      edge_colour_expand_percent: 0.5 },
    lens: { mode: "off", distortion: true, chromatic_aberration: true, vignetting: true },
  };
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    const previewBlobs = window.microLensPreviewBlobs = new Map();
    URL.createObjectURL = blob => {
      const url = create(blob);
      if (blob.type === "image/avif" || blob.type === "image/png") previewBlobs.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = url => {
      previewBlobs.delete(url);
      revoke(url);
    };
  });
  const logPath = path.join(harness.userDataDirectory, "logs/backend.log");
  const samples = [];
  const { spawn } = require("node:child_process");
  const { createInterface } = require("node:readline");
  const sampler = spawn(require("../../tools/lib/platform.cjs").pythonExecutable(),
    ["-u", "-c", `
import json, sys, time
sys.path.insert(0, 'backend')
from hdr_finisher.app_memory import process_tree
while True:
    captured = time.time() * 1000
    try:
        rows = process_tree(int(sys.argv[1]))
        print(json.dumps(dict(at=captured, processes=rows,
                              bytes=sum(row['chargedBytes'] for row in rows))))
    except OSError as error:
        print(error, file=sys.stderr)
    time.sleep(.1)
`, process.env.HDR_FINISHER_ELECTRON_MAIN_PID], { cwd: path.resolve(__dirname, "../.."),
      stdio: ["ignore", "pipe", "inherit"] });
  const census = createInterface({ input: sampler.stdout });
  census.on("line", line => samples.push(JSON.parse(line)));
  const firstSample = require("node:events").once(census, "line", { signal: AbortSignal.timeout(10000) });
  const ready = ({ lane, reduced, zoom, generation }) => {
    const picture = state.acceptedPresentation;
    return state.currentView === lane && state.session && !state.importInProgress
      && picture?.lane === lane && picture.generation === state.previewGeneration[lane]
      && picture.generation !== generation && previewIdleNow()
      && (reduced ? picture.grainRoute?.reduced && picture.processedLongEdge === 4096 : picture.exact)
      && (zoom === undefined || (zoom === "fit" ? state.zoomMode === "fit" : state.zoomPercent === zoom));
  };
  const run = async (action, operation, { lane = "hdr", reduced = false, zoom, update = false, hash = false } = {}) => {
    console.log(JSON.stringify({ start: action }));
    const offset = fs.statSync(logPath).size;
    const generation = update ? await page.evaluate(() => state.acceptedPresentation?.generation) : undefined;
    const start = Date.now();
    const preceding = samples.at(-1);
    await operation();
    await page.waitForFunction(ready, { lane, reduced, zoom, generation }, { polling: "raf", timeout: 180000 });
    const acceptedAt = Date.now();
    const view = await page.evaluate(() => ({
      id: state.session.session_id, zoom: state.zoomMode === "fit" ? "fit" : state.zoomPercent,
      lane: state.currentView, settings: state.editDocument.source.raw_import_settings,
      lens: state.session.metadata.extra?.lens_correction, transport: state.acceptedPresentation.transport,
      edge: state.acceptedPresentation.processedLongEdge, route: state.acceptedPresentation.grainRoute,
      linked: state.adjustments.sdr.linked_to_hdr,
    }));
    const [memory, cache] = await Promise.all([
      harness.fetch("/api/library/memory").then(response => response.json()),
      harness.fetch(`/api/session/${view.id}/diagnostics`).then(response => response.json()),
    ]);
    const readings = samples.filter(sample => sample.at >= start && sample.at <= acceptedAt);
    // Zoom and cached lane switches may complete between census samples.
    if (!readings.length && preceding) readings.push(preceding);
    assert.ok(readings.length, "No whole-app census sample was collected");
    const peak = readings.reduce((left, right) => right.bytes > left.bytes ? right : left);
    const footprint = (sample, pid) => sample.processes.find(row => row.pid === pid)?.chargedBytes ?? 0;
    const roles = (await harness.memory()).roles;
    const gpuPid = roles.find(role => role.type === "GPU")?.pid;
    const events = fs.readFileSync(logPath).subarray(offset).toString().split(/\r?\n/)
      .filter(line => line.startsWith("{") && line.includes('"event":"micro_cpu_source"')).map(JSON.parse);
    const hashValue = hash ? await page.evaluate(async lane => {
      const cached = state.previewCache[lane];
      const blob = window.microLensPreviewBlobs.get(cached?.url);
      const bytes = cached?.raw ?? await blob?.arrayBuffer();
      if (!cached?.reducedEdge || !bytes) throw Error("Missing reduced preview bytes");
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return { bytes: bytes.byteLength, sha256: new Uint8Array(digest).toHex() };
    }, lane) : undefined;
    console.log(JSON.stringify({ action, ms: acceptedAt - start, startedAt: start, acceptedAt, ...view, id: undefined,
      appPeakBytes: peak.bytes, backendPeakBytes: Math.max(...readings.map(sample => footprint(sample, memory.backendPid))),
      gpuPeakBytes: Math.max(...readings.map(sample => footprint(sample, gpuPid))),
      peakProcesses: peak.processes.sort((a, b) => b.chargedBytes - a.chargedBytes).slice(0, 4)
        .map(row => ({ ...row, role: roles.find(role => role.pid === row.pid)?.type
          || (row.pid === memory.backendPid ? "Backend" : undefined) })),
      sampleCount: readings.length, precedingSample: !readings.some(sample => sample.at >= start),
      microCacheBytes: cache.render_cache.micro_source_bytes,
      previewKept: reduced && cache.render_cache.micro_source_bytes >= 4096 * 2735 * 12,
      cacheEvents: events.map(event => ({ reason: event.reason, outcome: event.outcome, ms: event.duration_ms,
        previewKept: event.preview_kept, beforeRefreshBytes: event.before_refresh_bytes,
        afterRefreshBytes: event.after_refresh_bytes, edge: event.edge_px,
        prepareMs: event.micro_prepare_ms, renderMs: event.micro_render_ms, lensMs: event.micro_lens_ms,
        finishMs: event.micro_source_finish_ms, resizeMs: event.micro_resize_ms })),
      hash: hashValue,
    }));
  };
  const zoom78 = () => page.evaluate(() => {
    els.zoomReadout.value = "78%";
    commitZoomReadout();
  });

  try {
    await firstSample;
    await run("Open at Fit", () => page.evaluate(async ({ file, settings }) => {
      const selection = await desktop.grantSourcePath(file);
      await openStagedDesktopSource({ ...selection, rawImportSettings: settings });
      await commitDenoiseControl("method", "micro_grain");
    }, { file, settings }), { zoom: "fit" });
    await run("Micro Grain at Fit, lens off", () => page.evaluate(() => {
      state.denoise.sdr = { enabled: true, controls: structuredClone(state.denoise.hdr.controls) };
      state.denoiseRuntime.sdr.showOriginal = false;
      return setDenoiseEnabled(true);
    }), { zoom: "fit", update: true });
    await run("Zoom to 78%, lens off", zoom78, { zoom: 78 });
    await run("Lensfun Auto at 78%", () => page.evaluate(async () => {
      const { scrollLeft, scrollTop } = els.dropzone;
      els.lensMode.value = "auto";
      await applyRawImportSettings();
      const lens = state.session.metadata.extra?.lens_correction;
      if (!(lens?.applied || String(lens).includes("'applied': True"))) {
        throw Error(`Lensfun Auto was not applied: ${JSON.stringify(lens)}`);
      }
      if (state.zoomMode !== "custom" || state.zoomPercent !== 78
        || Math.abs(els.dropzone.scrollLeft - scrollLeft) > 1
        || Math.abs(els.dropzone.scrollTop - scrollTop) > 1) {
        throw Error(`Lensfun moved the viewport from ${scrollLeft},${scrollTop} to ${els.dropzone.scrollLeft},${els.dropzone.scrollTop}`);
      }
      if (!state.denoise.hdr.enabled) throw Error("Lensfun disabled Micro Grain");
    }), { reduced: true, zoom: 78, update: true, hash: true });
    await run("Exposure +0.25 EV", () => page.evaluate(() =>
      commitAdjustmentValue("hdr.exposure", state.adjustments.hdr.exposure + 0.25, { manual: true })),
    { reduced: true, zoom: 78, update: true, hash: true });
    await run("HDR to generated SDR", () => page.locator("#view-sdr").click(),
      { lane: "sdr", reduced: true, zoom: 78, hash: true });
    await run("Generated SDR to HDR", () => page.locator("#view-hdr").click(),
      { reduced: true, zoom: 78, hash: true });
    await run("Return to Fit", () => page.evaluate(() => setZoomMode("fit")), { reduced: true, zoom: "fit" });
    await run("Return to 78%", zoom78, { reduced: true, zoom: 78 });
  } finally {
    sampler.kill();
    const prefix = process.argv.find(arg => arg.startsWith("--memory-log="))?.slice("--memory-log=".length);
    if (prefix) {
      fs.copyFileSync(logPath, `${prefix}-backend.log`);
      fs.writeFileSync(`${prefix}-census.json`, JSON.stringify(samples));
    }
  }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const harness = global.HDRFinisherElectronTestHarness;
  let tracedRequests = null;
  const requests = new WeakMap();
  page.on("request", request => {
    const url = new URL(request.url());
    if (!tracedRequests || request.method() !== "POST"
        || !/\/denoise-(?:grain|measurement)\//.test(url.pathname)) return;
    const entry = { route: url.pathname.split("/").slice(-2).join("/"),
      edge: Number(url.searchParams.get("long_edge")), startedAt: Date.now() };
    tracedRequests.push(entry);
    requests.set(request, entry);
  });
  page.on("response", response => {
    const entry = requests.get(response.request());
    if (entry) entry.status = response.status();
  });
  page.on("requestfailed", request => {
    const entry = requests.get(request);
    if (entry) entry.failure = request.failure()?.errorText;
  });
  const api = async (route, data) => {
    const response = await harness.fetch(route, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw Error(JSON.stringify(result));
    return result;
  };
  try {
    if (phaseOne) {
      assert.ok(["cpu", "gpu"].includes(phaseOne));
      assert.ok(!cleanGrade || ["small", "large"].includes(cleanGrade));
      await page.addInitScript(() => {
        const match = window.matchMedia.bind(window);
        window.matchMedia = query => query === "(dynamic-range: high)" ? { matches: true } : match(query);
      });
    }
    await page.goto(process.env.HDR_FINISHER_URL);
    if (process.argv.includes("--micro-lens-memory")) {
      await measureMicroLensMemory(page, harness);
      return;
    }
    assert.ok(!fullProofMethod || baselineMethods.includes(fullProofMethod), "Unknown Denoise method");
    assert.ok(!fullDeliveryRoute || fullProofMethod && ["cpu", "gpu"].includes(fullDeliveryRoute), "Unknown full delivery route");
    assert.ok(!coldProofOnly || fullProofMethod, "Cold Proof needs a full Proof method");
    if (fullProofMethod) await api("/api/delivery/preferences", { force_cpu: fullDeliveryRoute !== "gpu" });
    const baseline = Boolean(fullProofMethod) || process.argv.includes("--speed-baseline");
    const panCoverage = process.argv.includes("--pan-coverage");
    const cachePressure = process.argv.includes("--grain-cache-pressure");
    const nativeGrainSwitch = process.argv.includes("--native-grain-switch");
    const stillPicture = process.argv.includes("--native-grain-still");
    const reportOnly = process.argv.includes("--report-only");
    await page.evaluate(baseline => {
      performance.setResourceTimingBufferSize(2000);
      if (!baseline) return;
      window.denoiseBaselineMemory = [];
      window.addEventListener("message", event => {
        if (event.origin !== location.origin || event.data?.type !== "hdr-memory-pressure") return;
        const { totalBytes: bytes, processes, backendPid, backendHeap, gradeBytes, caches } = event.data.value ?? {};
        if (Number.isFinite(bytes)) window.denoiseBaselineMemory.push({ at: Date.now(), bytes,
          processes, backendPid, backendHeap, gradeBytes, caches });
      });
    }, baseline || panCoverage || nativeGrainSwitch || stillPicture || Boolean(phaseOne));
    const names = process.argv.includes("--atrium-only") ? ["DSC01212.ARW"]
      : process.argv.includes("--42-only") ? ["_DSC7970.ARW"]
      : process.argv.includes("--18-only") ? ["IMG_0790.CR2"] : ["IMG_0790.CR2", "_DSC7970.ARW"];
    for (const name of names) {
      // The native switch check can run in an isolated worktree whose shared
      // test-photo folder points into another checkout. Keep its autosaves local.
      const file = nativeGrainSwitch || stillPicture ? path.join(output, name)
        : reusePhoto(name, path.resolve(__dirname, "../../output/gpu-raw", name));
      if (nativeGrainSwitch || stillPicture) fs.copyFileSync(reusePhoto.source(name), file);
      await page.evaluate(async ({ file, baseline }) => {
        const selection = await desktop.grantSourcePath(file);
        await openStagedDesktopSource({ ...selection, rawImportSettings: {
          pixel_cleanup: { even_out_specks: true, speck_threshold: 2.5 },
          ...(baseline ? { lens: { mode: "off" } } : {}),
        } });
      }, { file, baseline: baseline || Boolean(phaseOne) });
      await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 90000 });
      const photo = await page.evaluate(() => ({
        id: state.session?.session_id, width: state.session?.source.width, height: state.session?.source.height,
        edge: refinementProxyLongEdge(), cleanup: state.editDocument?.source.raw_import_settings?.pixel_cleanup,
      }));
      assert.ok(photo.width * photo.height > (name === "IMG_0790.CR2" ? 17e6 : 40e6), JSON.stringify(photo));
      assert.equal(photo.cleanup.even_out_specks, true);
      const record = async (method, action, button, options) => {
        tracedRequests = options?.trace ? [] : null;
        try {
        const result = await measurePicture(page, button, method, options);
          assert.ok(result.viewportCovered, "The native drawing surface did not cover the viewer.");
          const backend = backendLog(harness, result.timeStart, result.timeEnd, method);
          if (options?.trace) {
            const samples = await page.evaluate(() => window.denoiseBaselineMemory);
            const peak = peakBetween(samples, result.timeStart, result.timeEnd);
            backend.peakAppBytes = peak?.bytes ?? backend.peakAppBytes;
            backend.peakProcesses = peak?.processes;
            backend.peakSampleOffsetMs = peak ? peak.at - result.timeStart : null;
          }
          const lane = options?.trace ? await page.evaluate(() => state.currentView) : undefined;
          console.log(JSON.stringify({ name, method, action, lane, ...result, ...backend,
            ...(tracedRequests ? { preparationRequests: tracedRequests } : {}) }));
          return { ...result, ...backend, preparationRequests: tracedRequests };
        } catch (error) {
          console.log(JSON.stringify({ name, method, action, error: error.message,
            preparationRequests: tracedRequests }));
          throw error;
        } finally {
          tracedRequests = null;
        }
      };
      const setZoom = async target => {
        if (target === "110%") {
          await page.evaluate(() => {
            els.zoomReadout.value = "110%";
            commitZoomReadout();
          });
        } else {
          if (await page.locator(target).evaluate(el => el.classList.contains("active"))) return;
          await page.locator(target).click();
        }
        await page.waitForFunction(() => state.acceptedPresentation?.exact
          && state.acceptedPresentation.processedLongEdge === requiredProcessingLongEdge()
          && previewIdleNow(), null, { timeout: 90000 });
      };
      if (phaseOne) {
        await measurePhaseOne(page, name, record, setZoom);
        continue;
      }
      if (stillPicture) {
        const denied = [];
        const checkAdmission = response => { if (response.status() === 507) denied.push(new URL(response.url()).pathname); };
        page.on("response", checkAdmission);
        await page.evaluate(() => commitAdjustmentValue("hdr.highlight_section_enabled", true));
        await page.waitForFunction(() => viewerState().status === "ready" && previewIdleNow());
        const waitForStill = async () => {
          // Allow the initial highlight measurement and overview to finish.
          // The baseline may be unable to settle, so observe it after 5 s.
          await page.waitForTimeout(5000);
          if (!reportOnly) await page.waitForFunction(() => previewIdleNow()
            && !pendingHighlightAnchors.size && !exactHighlightAnchorInflight.size
            && !state.previewScheduler.frameInFlight
            && !state.gpuScopeRequestInFlight && !state.scopeRequestInFlight
            && !navigationThumbnail.inflightKey, null, { timeout: 20000 });
        };
        for (const method of baselineMethods) {
          if (method === "standard") {
            await record(method, "enable at Fit", "#denoise-bypass", { reportOnly });
          } else {
            await record(method, "switch at 100%", null, { switchMethod: true, reportOnly });
            await record(method, "100% to Fit", "#zoom-fit", { reportOnly });
          }
          await waitForStill();
          await checkStillPicture(page, method, "Fit still", { reportOnly });
          await record(method, "Fit to 100%", "#zoom-actual", { reportOnly });
          await waitForStill();
          await checkStillPicture(page, method, "100% still", { reportOnly });
          await checkStillPicture(page, method, "100% after one exposure change", { changeExposure: true, reportOnly });
          if (!reportOnly) await checkPanCoverage(page, name, method);
        }
        page.off("response", checkAdmission);
        const memory = await page.evaluate(() => Math.max(0, ...window.denoiseBaselineMemory.map(sample => sample.bytes)));
        console.log(JSON.stringify({ name, stillPicture: { denied, peakAppBytes: memory } }));
        if (!reportOnly) assert.deepEqual(denied, [], "The app refused memory admission.");
        continue;
      }
      if (nativeGrainSwitch) {
        await page.evaluate(() => {
          const check = window.nativeGrainCheck = { frames: 0, blank: 0, errors: [] };
          const sample = () => {
            if (window.nativeGrainCheck !== check) return;
            check.frames++;
            const pictureVisible = [els.previewCanvas, els.previewImage].some(picture =>
              getComputedStyle(picture).display !== "none" && picture.getBoundingClientRect().width > 0);
            if (!pictureVisible) check.blank++;
            const error = state.previewUnavailableReason || state.denoiseRuntime.hdr.error;
            if (error && !check.errors.includes(error)) check.errors.push(error);
            requestAnimationFrame(sample);
          };
          sample();
        });
        await page.evaluate(async () => {
          await commitDenoiseControl("method", "clean_grain");
          await commitDenoiseControl("clean_splotches", false);
          await commitDenoiseControl("clean_fringes", false);
        });
        await record("clean_grain_off", "enable at Fit", "#denoise-bypass", { trace: true });
        await record("clean_grain_off", "Fit to 100%", "#zoom-actual", { trace: true });
        await checkPanCoverage(page, name, "clean_grain_off");
        await record("clean_grain", "Turn colour cleaning on at 100%", null, { switchMethod: true, trace: true });
        await checkPanCoverage(page, name, "clean_grain");
        await record("clean_grain", "100% to Fit", "#zoom-fit", { trace: true });
        const check = await page.evaluate(() => {
          const result = window.nativeGrainCheck;
          window.nativeGrainCheck = null;
          return result;
        });
        assert.ok(check.frames > 0);
        assert.equal(check.blank, 0);
        assert.deepEqual(check.errors, []);
        console.log(JSON.stringify({ name, nativeGrainSwitch: check }));
        continue;
      }
      if (panCoverage || cachePressure) {
        const files = cachePressure ? await seedGrainCachePressure(harness) : null;
        const methods = panCoverage ? baselineMethods : baselineMethods.slice(1);
        await setZoom("#zoom-fit");
        await page.evaluate(() => {
          state.gpuPreview.setInstrumentationEnabled(true);
          els.denoiseBypass.closest(".control-group").querySelector(".group-toggle")
            ?.setAttribute("aria-expanded", "true");
        });
        for (const [index, method] of methods.entries()) {
          if (!index) await page.evaluate(async method => {
            await commitDenoiseControl("method", method === "clean_grain_off" ? "clean_grain" : method);
            await commitDenoiseControl("clean_splotches", method !== "clean_grain_off");
            await commitDenoiseControl("clean_fringes", method !== "clean_grain_off");
          }, method);
          await record(method, "prepare at Fit", index ? null : "#denoise-bypass",
            { switchMethod: index > 0, trace: panCoverage });
          await record(method, "Fit to 100%", "#zoom-actual", { trace: panCoverage });
          if (panCoverage) await checkPanCoverage(page, name, method);
          await record(method, "100% to Fit", "#zoom-fit", { trace: panCoverage });
        }
        if (panCoverage) {
          // Apply the normal Grade geometry tools before checking the layers
          // again, then switch to an independently denoised SDR rendition.
          const geometryGroup = page.locator('[data-group="geometry"]');
          if (await geometryGroup.evaluate(element => element.classList.contains("collapsed"))) {
            await geometryGroup.locator(".group-toggle").click();
          }
          await page.locator("#rotate-tool-toggle").click();
          await page.locator("#rotate-right").click();
          await page.evaluate(() => closeRotateMode(true));
          await page.waitForFunction(() => previewIdleNow() && !state.geometryPresentationPending);
          await page.locator("#crop-tool-toggle").click();
          await page.locator("#crop-ratio").selectOption("1:1");
          await page.locator("#crop-done").click();
          await page.waitForFunction(() => previewIdleNow() && !state.geometryPresentationPending);
          await page.locator("#view-sdr").click();
          await page.waitForFunction(() => state.currentView === "sdr" && previewIdleNow());
          await record("standard", "prepare cropped and rotated SDR at Fit", "#denoise-bypass", { trace: true });
          await record("standard", "cropped and rotated SDR at 100%", "#zoom-actual", { trace: true });
          await checkPanCoverage(page, name, "standard cropped and rotated SDR");
          await record("standard", "cropped and rotated SDR to Fit", "#zoom-fit", { trace: true });
          await page.evaluate(() => setDenoiseEnabled(false));
          await page.locator("#view-hdr").click();
          await page.waitForFunction(() => state.currentView === "hdr" && previewIdleNow());
        }
        if (files) {
          assert.equal(fs.existsSync(files.old), false);
          assert.equal(fs.existsSync(files.newer), true);
          const log = fs.readFileSync(path.join(harness.userDataDirectory, "logs/backend.log"), "utf8");
          const reservation = log.split(/\r?\n/).find(line => line.includes("denoise_grain_scratch")
            && line.includes('"outcome": "reserved"') && !line.includes('"evicted_bytes": 0'));
          assert.ok(reservation, "The backend did not log the eviction.");
          console.log(reservation);
        }
        await page.evaluate(async () => {
          await setDenoiseEnabled(false);
          await commitDenoiseControl("method", "standard");
        });
        continue;
      }
      if (fullProofMethod) {
        await setZoom("#zoom-fit");
        if (process.argv.includes("--full-proof-highlights")) {
          await page.evaluate(() => commitAdjustmentValue("hdr.highlight_section_enabled", true));
        }
        await page.waitForFunction(() => state.acceptedPresentation?.exact && previewIdleNow());
        await page.evaluate(method => {
          activateWorkflowTab("export");
          state.denoiseRuntime.hdr.showOriginal = true;
          state.denoiseRuntime.sdr.showOriginal = true;
          state.denoise.hdr.controls.method = method === "clean_grain_off" ? "clean_grain" : method;
          state.denoise.hdr.controls.clean_splotches = method !== "clean_grain_off";
          state.denoise.hdr.controls.clean_fringes = method !== "clean_grain_off";
          state.denoise.hdr.enabled = true;
        }, fullProofMethod);
        await measureDelivery(page, harness, name, fullProofMethod,
          deliveryRecorder(page, harness, name, fullProofMethod), coldProofOnly);
        continue;
      }
      if (baseline) {
        await measureBaseline(page, harness, name, record, setZoom);
        continue;
      }
      const onlyExport = process.argv.includes("--export-only");
      const nativeOnly = process.argv.includes("--native-only");
      const methods = process.argv.includes("--clean-only") ? ["clean_grain"] : ["clean_grain_off", "clean_grain"];
      for (const method of methods) {
        const zooms = onlyExport ? [] : (nativeOnly ? ["100%"] : ["Fit", "100%"]);
        for (const zoom of zooms) {
          await page.evaluate(async method => {
            if (state.denoise[state.currentView].enabled) await setDenoiseEnabled(false);
            await commitDenoiseControl("method", method === "clean_grain_off" ? "clean_grain" : method);
            await commitDenoiseControl("clean_splotches", method !== "clean_grain_off");
            await commitDenoiseControl("clean_fringes", method !== "clean_grain_off");
            // Force a fresh preparation for this sample. Keep the loaded
            // photo and any already measured noise model, as in the editor.
            const runtime = state.denoiseRuntime[state.currentView];
            runtime.refresh = (runtime.refresh || 0) + 1;
            runtime.dirty = true;
          }, method);
          await setZoom(zoom === "Fit" ? "#zoom-fit" : "#zoom-actual");
          await record(method, `first preparation at ${zoom}`, "#denoise-bypass");
          if (zoom === "Fit") await record(method, "Recalculate at Fit", "recalculate");
          if (zoom === "100%") {
            await record(method, "100% to Fit", "#zoom-fit");
            await record(method, "Fit to 100%", "#zoom-actual");
            await record(method, "pan at 100%", null, { pan: true });
          }
        }
        if (!(onlyExport || process.argv.includes("--export"))) continue;
        await page.evaluate(async method => {
          if (state.denoise[state.currentView].enabled) await setDenoiseEnabled(false);
          await commitDenoiseControl("method", method === "clean_grain_off" ? "clean_grain" : method);
          await commitDenoiseControl("clean_splotches", method !== "clean_grain_off");
          await commitDenoiseControl("clean_fringes", method !== "clean_grain_off");
        }, method);
        await setZoom("#zoom-fit");
        await measurePicture(page, "#denoise-bypass", method);
        const target = path.join(output, `${name}-${method}.jpg`);
        await harness.selectExportPath(target);
        const grant = await page.evaluate(() => desktop.chooseExportPath({ extension: "jpg", suggestedName: "timing.jpg" }));
        const start = performance.now();
        const exported = await api(`/api/session/${photo.id}/export`, {
          format: "jpeg_ultrahdr", quality: 90, guarantee_hdr_peak: true, output_path: target, path_grant: grant.grant,
        });
        console.log(JSON.stringify({ name, method, exportMs: performance.now() - start, ...exported }));
        assert.ok(exported.accepted, JSON.stringify(exported));
        fs.rmSync(target, { force: true });
      }
      await page.evaluate(async () => {
        await setDenoiseEnabled(false);
        await commitDenoiseControl("method", "standard");
      });
    }
    assert.deepEqual(phaseOneMemoryFailures, [], "Fine Grain exceeded the default whole-app ceiling.");
  } finally {
    await browser.close();
    fs.rmSync(output, { recursive: true, force: true });
    reusePhoto.cleanup();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(output, { recursive: true, force: true });
  reusePhoto.cleanup();
});
