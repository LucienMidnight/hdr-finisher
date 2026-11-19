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
  return readings.length ? Math.max(...readings.map(sample => sample.bytes)) : null;
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
        diskBytes: event.disk_bytes });
    }
  }
  return { preparation, peakAppBytes };
}

async function measurePicture(page, button, method, { pan = false, switchMethod = false,
  drag = false, release = false, trace = false } = {}) {
  return page.evaluate(async ({ button, method, pan, switchMethod, drag, release, trace }) => {
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
        final = {
          accepted, width: accepted.width, height: accepted.height, edge: detail.longEdge,
          execution: detail.execution, samePreparation: samePreparation(),
          serial: detail.serial, submittedAt: detail.submittedAt,
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
          && (liveDrag ? !state.denoiseInputQueue?.busy && !state.gpuDraftInFlight : previewIdleNow());
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
  }, { button, method, pan, switchMethod, drag, release, trace });
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

  await page.evaluate(() => {
    activateWorkflowTab("proof");
    state.proofFormat = "jpeg_ultrahdr";
    state.proofSize = "reduced";
    state.proofTarget = "custom";
    state.proofCustomNits = 1000;
  });
  const proofStart = await page.evaluate(() => {
    const start = performance.timeOrigin + performance.now();
    els.chromeProofRefresh.click();
    return start;
  });
  await page.waitForFunction(() => els.chromeProofStatus.dataset.state === "error"
    || (state.proofArtifact && !state.proofDirty && els.chromeProofImage.complete
      && els.chromeProofImage.naturalWidth > 0 && els.chromeProofImage.style.display !== "none"),
  null, { timeout: 120000 });
  const proof = await page.evaluate(async start => {
    if (els.chromeProofStatus.dataset.state === "error") throw Error(els.chromeProofStatus.textContent);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const end = performance.timeOrigin + performance.now();
    return { pictureMs: end - start, timeStart: start, timeEnd: end,
      status: els.chromeProofStatus.textContent,
      renderer: state.proofArtifact.renderer, width: state.proofArtifact.width, height: state.proofArtifact.height };
  }, proofStart);
  await record("reduced JPEG Ultra HDR Proof", proof);
  await page.evaluate(async () => {
    activateWorkflowTab("grade");
    state.denoise.sdr.enabled = false;
    await persistDenoiseSettings();
  });
}

async function measureBaseline(page, harness, name, record, setZoom) {
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
    }
    await page.evaluate(() => setDenoiseEnabled(false));
  }
  if (name === "DSC01212.ARW" || process.argv.includes("--baseline-110-only")) return;
  const resumeAfterStandard = process.argv.includes("--baseline-after-standard-export");
  const resumeFineDelivery = process.argv.includes("--baseline-fine-delivery-only");
  const deliveryRecord = method => async (action, result) => {
    const backend = backendLog(harness, result.timeStart, result.timeEnd, method);
    const samples = await page.evaluate(() => window.denoiseBaselineMemory);
    backend.peakAppBytes = peakBetween(samples, result.timeStart, result.timeEnd) ?? backend.peakAppBytes;
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
        await record(method, "Recalculate at Fit", "recalculate", { trace: true });
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
        await record(method, "100% to Fit", "#zoom-fit", { trace: true });
        await record(method, "Fit to 100%", "#zoom-actual", { trace: true });
        await record(method, "pan at 100%", null, { pan: true, trace: true });
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
    await page.evaluate(baseline => {
      performance.setResourceTimingBufferSize(2000);
      if (!baseline) return;
      window.denoiseBaselineMemory = [];
      window.addEventListener("message", event => {
        if (event.origin !== location.origin || event.data?.type !== "hdr-memory-pressure") return;
        const bytes = event.data.value?.totalBytes;
        if (Number.isFinite(bytes)) window.denoiseBaselineMemory.push({ at: Date.now(), bytes });
      });
    }, baseline);
    const names = process.argv.includes("--atrium-only") ? ["DSC01212.ARW"]
      : process.argv.includes("--42-only") ? ["_DSC7970.ARW"]
      : process.argv.includes("--18-only") ? ["IMG_0790.CR2"] : ["IMG_0790.CR2", "_DSC7970.ARW"];
    for (const name of names) {
      const file = reusePhoto(name, path.resolve(__dirname, "../../output/gpu-raw", name));
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
          const backend = backendLog(harness, result.timeStart, result.timeEnd, method);
          if (options?.trace) {
            const samples = await page.evaluate(() => window.denoiseBaselineMemory);
            backend.peakAppBytes = peakBetween(samples, result.timeStart, result.timeEnd) ?? backend.peakAppBytes;
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
