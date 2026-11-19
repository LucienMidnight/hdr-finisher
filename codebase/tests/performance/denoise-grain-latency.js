const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const reusePhoto = require("../helpers/reuse-test-photo.cjs");

const output = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-finish-denoise-grain-"));
const baselineMethods = ["standard", "fine_grain", "clean_grain"];
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

async function checkPanCoverage(page, name, method, { scroll = false } = {}) {
  const start = Date.now();
  const home = await page.locator("#dropzone").boundingBox();
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
    const x = home.x + home.width * .5;
    const y = home.y + home.height * .45;
    if (scroll) {
      await page.evaluate(delta => { els.dropzone.scrollLeft -= delta; }, direction * distance);
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + direction * distance, y, { steps: 6 });
      await page.mouse.up();
    }
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
  let peakAppBytes = null;
  for (const line of log.split(/\r?\n/)) {
    const match = line.match(/\[library\] (denoise_grain_prepared|app_memory) (\{.*\})/);
    if (!match) continue;
    const event = JSON.parse(match[2]);
    if (event.time * 1000 < start || event.time * 1000 > end) continue;
    if (match[1] === "app_memory") {
      peakAppBytes = Math.max(peakAppBytes ?? 0, event.totalBytes);
    } else if (event.method === method) {
      preparation.push({ edge: event.edge, width: event.width, height: event.height, ms: event.duration_ms,
        fitMs: event.fit_ms, filterMs: event.filter_ms, tileWorkerMs: event.tile_worker_ms,
        diskBytes: event.disk_bytes, reusedRgb: event.reused_rgb });
    }
  }
  return { preparation, peakAppBytes };
}

async function measurePicture(page, button, method, { pan = false, switchMethod = false,
  drag = false, release = false, trace = false, reportOnly = false } = {}) {
  return page.evaluate(async ({ button, method, pan, switchMethod, drag, release, trace, reportOnly }) => {
    const gpu = state.gpuPreview;
    const startingGrain = gpu.denoiseSourceSelector?.cache?.grain;
    const samePreparation = () => {
      const current = gpu.denoiseSourceSelector?.cache?.grain;
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
        viewer.scrollLeft += previous > 180 ? -180 : 180;
        if (viewer.scrollLeft === previous) return finish(reject, Error("The test pan did not move the picture."));
      } else if (switchMethod) {
        els.denoiseMethod.value = method;
        els.denoiseMethod.dispatchEvent(new Event("change", { bubbles: true }));
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
          finish(resolve, { edge: state.acceptedPresentation.processedLongEdge,
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
          && ["denoise-analysis", "denoise-cancel", "denoise-resolve", "tiled-render",
            "denoise-tile-upload", "tiled-cancelled", "grading"].includes(event.stage)),
        renders: gpu.performanceMetrics.renders.filter(event => event.serial === done.serial),
      } : {}),
    };
  }, { button, method, pan, switchMethod, drag, release, trace, reportOnly });
}

async function measureDelivery(page, harness, name, method, record, proofOnly = false) {
  const target = path.join(output, `${name}-${method}.jpg`);
  if (!proofOnly) await harness.selectExportPath(target);
  await page.evaluate(async () => {
    state.denoise.sdr = structuredClone(state.denoise.hdr);
    if (!await persistDenoiseSettings()) throw Error("Could not save the SDR Denoise method.");
    activateWorkflowTab("export");
    els.exportFormat.value = "jpeg_ultrahdr";
    els.exportQuality.value = "90";
    els.exportResizeMode.value = "original";
    els.exportGuaranteePeak.checked = true;
  });
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
    await record("full-size JPEG Ultra HDR export", {
      ...result, accepted, renderer: delivery.renderer, timingsMs: delivery.timings_ms,
      fallback: delivery.fallback_reason,
    });
    assert.ok(accepted, JSON.stringify(result));
    fs.rmSync(target);
  }

  const fullProof = method === "standard" && process.argv.includes("--speed-memory-full-proof");
  await page.evaluate(fullSize => {
    activateWorkflowTab("proof");
    state.proofFormat = "jpeg_ultrahdr";
    state.proofSize = fullSize ? "full" : "reduced";
    state.proofTarget = "custom";
    state.proofCustomNits = 1000;
  }, fullProof);
  const proofStart = await page.evaluate(() => {
    const start = performance.timeOrigin + performance.now();
    els.chromeProofRefresh.click();
    return start;
  });
  await page.waitForFunction(fullSize => els.chromeProofStatus.dataset.state === "error"
    || (state.proofArtifact?.full_size === fullSize && !state.proofDirty && els.chromeProofImage.complete
      && els.chromeProofImage.naturalWidth > 0 && els.chromeProofImage.style.display !== "none"),
  fullProof, { timeout: 120000 });
  const proof = await page.evaluate(async start => {
    if (els.chromeProofStatus.dataset.state === "error") throw Error(els.chromeProofStatus.textContent);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const end = performance.timeOrigin + performance.now();
    return { pictureMs: end - start, timeStart: start, timeEnd: end,
      status: els.chromeProofStatus.textContent,
      renderer: state.proofArtifact.renderer, width: state.proofArtifact.width, height: state.proofArtifact.height };
  }, proofStart);
  await record(`${fullProof ? "full-size" : "reduced"} JPEG Ultra HDR Proof`, proof);
  await page.evaluate(async () => {
    activateWorkflowTab("grade");
    state.denoise.sdr.enabled = false;
    await persistDenoiseSettings();
  });
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
  const deliveryRecord = method => async (action, result) => {
    const backend = backendLog(harness, result.timeStart, result.timeEnd, method);
    const samples = await page.evaluate(() => window.denoiseBaselineMemory);
    const peak = peakBetween(samples, result.timeStart, result.timeEnd);
    backend.peakAppBytes = peak?.bytes ?? backend.peakAppBytes;
    backend.peakProcesses = peak?.processes;
    console.log(JSON.stringify({ name, method, action, ...result, ...backend }));
  };
  const runDelivery = async (method, proofOnly) => {
    try {
      await measureDelivery(page, harness, name, method, deliveryRecord(method), proofOnly);
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
  const methods = resumeFineDelivery ? ["standard", "clean_grain", "fine_grain"] : baselineMethods;
  for (const method of methods) {
    if (warmOnly) {
      if (process.argv.includes("--baseline-delivery")) {
        await setZoom("#zoom-fit");
        await page.evaluate(async method => {
          if (state.denoise.hdr.enabled) await setDenoiseEnabled(false);
          await commitDenoiseControl("method", method);
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
    if (method === "fine_grain" && resumeFineDelivery) {
      await page.evaluate(async () => {
        if (state.denoise.hdr.enabled) await setDenoiseEnabled(false);
        await commitDenoiseControl("method", "fine_grain");
        await setDenoiseEnabled(true);
      });
      await runDelivery(method, false);
      continue;
    }
    for (const zoom of resumeFineDelivery ? ["100%", "Fit"] : ["Fit", "100%"]) {
      await page.evaluate(async method => {
        if (state.denoise.hdr.enabled) await setDenoiseEnabled(false);
        await commitDenoiseControl("method", method);
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
    await page.goto(process.env.HDR_FINISHER_URL);
    const baseline = process.argv.includes("--speed-baseline");
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
        const bytes = event.data.value?.totalBytes;
        if (Number.isFinite(bytes)) window.denoiseBaselineMemory.push({ at: Date.now(), bytes,
          processes: event.data.value.processes });
      });
    }, baseline || panCoverage || nativeGrainSwitch || stillPicture);
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
      }, { file, baseline });
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
          }
          console.log(JSON.stringify({ name, method, action, ...result, ...backend,
            ...(tracedRequests ? { preparationRequests: tracedRequests } : {}) }));
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
          if (!reportOnly) await checkPanCoverage(page, name, method, { scroll: true });
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
        await page.evaluate(() => commitDenoiseControl("method", "fine_grain"));
        await record("fine_grain", "enable at Fit", "#denoise-bypass", { trace: true });
        await record("fine_grain", "Fit to 100%", "#zoom-actual", { trace: true });
        await checkPanCoverage(page, name, "fine_grain", { scroll: true });
        await record("clean_grain", "Fine to Clean at 100%", null, { switchMethod: true, trace: true });
        await checkPanCoverage(page, name, "clean_grain", { scroll: true });
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
          if (!index) await page.evaluate(method => commitDenoiseControl("method", method), method);
          await record(method, "prepare at Fit", index ? null : "#denoise-bypass",
            { switchMethod: index > 0, trace: panCoverage });
          await record(method, "Fit to 100%", "#zoom-actual", { trace: panCoverage });
          if (panCoverage) await checkPanCoverage(page, name, method);
          await record(method, "100% to Fit", "#zoom-fit", { trace: panCoverage });
        }
        if (panCoverage) {
          // Apply the normal Grade geometry tools before checking the layers
          // again, then switch to an independently denoised SDR rendition.
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
      if (baseline) {
        await measureBaseline(page, harness, name, record, setZoom);
        continue;
      }
      const onlyExport = process.argv.includes("--export-only");
      const nativeOnly = process.argv.includes("--native-only");
      const methods = process.argv.includes("--clean-only") ? ["clean_grain"] : ["fine_grain", "clean_grain"];
      for (const method of methods) {
        const zooms = onlyExport ? [] : (nativeOnly ? ["100%"] : ["Fit", "100%"]);
        for (const zoom of zooms) {
          await page.evaluate(async method => {
            if (state.denoise[state.currentView].enabled) await setDenoiseEnabled(false);
            await commitDenoiseControl("method", method);
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
          await commitDenoiseControl("method", method);
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
