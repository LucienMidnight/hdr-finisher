const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const reusePhoto = require("../helpers/reuse-test-photo.cjs");

const output = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-finish-denoise-grain-"));

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
        fitMs: event.fit_ms, filterMs: event.filter_ms, diskBytes: event.disk_bytes });
    }
  }
  return { preparation, peakAppBytes };
}

async function measurePicture(page, button, method, { pan = false } = {}) {
  return page.evaluate(async ({ button, method, pan }) => {
    const gpu = state.gpuPreview;
    const startingGrain = gpu.denoiseSourceSelector?.cache?.grain;
    const samePreparation = () => {
      const current = gpu.denoiseSourceSelector?.cache?.grain;
      return startingGrain?.token ? startingGrain.token === current?.token : startingGrain === current;
    };
    performance.clearResourceTimings();
    const start = performance.now();
    let first;
    const done = await new Promise((resolve, reject) => {
      let finished = false;
      const finish = (callback, value) => {
        finished = true;
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
        if (detail.coarse || detail.longEdge !== requiredProcessingLongEdge() || !accepted?.exact
            || (method && (state.denoiseRuntime[state.currentView].status !== "ready"
              || selector?.selected !== "resolved" || selector.controls?.method !== method))) {
          final = undefined;
          return;
        }
        final = {
          accepted, width: accepted.width, height: accepted.height, edge: detail.longEdge,
          execution: detail.execution, samePreparation: samePreparation(),
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
        const idle = ++frames >= 3 && !state.zoomRefinementTimer && previewIdleNow();
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
      }];
    });
    return {
      timeStart: performance.timeOrigin + start,
      timeEnd: performance.timeOrigin + done.observedAt,
      firstMs: first === undefined ? null : first - start,
      pictureMs: done.presented ? done.at - start : null,
      edge: done.edge, width: done.width, height: done.height, execution: done.execution,
      samePreparation: done.samePreparation,
      requests,
    };
  }, { button, method, pan });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const harness = global.HDRFinisherElectronTestHarness;
  const api = async (route, data) => {
    const response = await harness.fetch(route, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw Error(JSON.stringify(result));
    return result;
  };
  try {
    await page.goto(process.env.HDR_FINISHER_URL);
    await page.evaluate(() => performance.setResourceTimingBufferSize(2000));
    const names = process.argv.includes("--42-only") ? ["_DSC7970.ARW"]
      : process.argv.includes("--18-only") ? ["IMG_0790.CR2"] : ["IMG_0790.CR2", "_DSC7970.ARW"];
    for (const name of names) {
      const file = reusePhoto(name, path.resolve(__dirname, "../../output/gpu-raw", name));
      await page.evaluate(async file => {
        const selection = await desktop.grantSourcePath(file);
        await openStagedDesktopSource({ ...selection, rawImportSettings: {
          pixel_cleanup: { even_out_specks: true, speck_threshold: 2.5 },
        } });
      }, file);
      await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 90000 });
      const photo = await page.evaluate(() => ({
        id: state.session?.session_id, width: state.session?.source.width, height: state.session?.source.height,
        edge: refinementProxyLongEdge(), cleanup: state.editDocument?.source.raw_import_settings?.pixel_cleanup,
      }));
      assert.ok(photo.width * photo.height > (name === "IMG_0790.CR2" ? 17e6 : 40e6), JSON.stringify(photo));
      assert.equal(photo.cleanup.even_out_specks, true);
      const record = async (method, action, button, options) => {
        const result = await measurePicture(page, button, method, options);
        const backend = backendLog(harness, result.timeStart, result.timeEnd, method);
        console.log(JSON.stringify({ name, method, action, ...result, ...backend }));
      };
      const setZoom = async target => {
        if (await page.locator(target).evaluate(el => el.classList.contains("active"))) return;
        await page.locator(target).click();
        await page.waitForFunction(() => state.acceptedPresentation?.exact
          && state.acceptedPresentation.processedLongEdge === requiredProcessingLongEdge()
          && previewIdleNow(), null, { timeout: 90000 });
      };
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
