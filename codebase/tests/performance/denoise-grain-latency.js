const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const reusePhoto = require("../helpers/reuse-test-photo.cjs");

const output = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-finish-denoise-grain-"));

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
      for (const method of ["fine_grain", "clean_grain"]) {
        const result = await page.evaluate(async method => {
          if (state.denoise[state.currentView].enabled) await setDenoiseEnabled(false);
          await commitDenoiseControl("method", method);
          const gpu = state.gpuPreview;
          const measure = async action => {
            const start = performance.now();
            await action();
            await gpu.waitForSubmittedWork();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const runtime = state.denoiseRuntime[state.currentView];
            if (runtime.status !== "ready") throw Error(JSON.stringify(runtime));
            return performance.now() - start;
          };
          const preparationMs = await measure(() => setDenoiseEnabled(true));
          const rangeKeys = method === "clean_grain" ? ["color_splotches", "dark_specks"] : ["amount"];
          const dragMs = {};
          for (const key of rangeKeys) {
            dragMs[key] = [];
            state.previewScheduler.beginInteraction();
            for (const value of (key === "amount" ? [.65, .8, .75] : [.25, .75, 1])) {
              dragMs[key].push(await measure(async () => {
                const before = state.previewGeneration[state.currentView];
                await updateLiveDenoiseControl(key, value);
                const limit = performance.now() + 15000;
                while ((state.acceptedPresentation?.generation ?? -1) <= before && performance.now() < limit) {
                  await new Promise(resolve => requestAnimationFrame(resolve));
                }
                if ((state.acceptedPresentation?.generation ?? -1) <= before) {
                  throw Error(`No interactive presentation for ${key}: ${JSON.stringify(state.lastGpuDraftRefusal)}`);
                }
              }));
            }
            state.previewScheduler.endInteraction();
            await commitDenoiseControl(key);
          }
          const recalculateMs = await measure(() => recalculateDenoise(state.currentView, { force: true }));
          return { preparationMs, dragMs, recalculateMs, previewWidth: state.acceptedPresentation?.width, previewHeight: state.acceptedPresentation?.height,
            execution: state.acceptedPresentation?.execution };
        }, method);
        console.log(JSON.stringify({ name, method, ...photo, ...result }));
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
