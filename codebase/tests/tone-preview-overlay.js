const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const python = require("../tools/lib/platform.cjs").pythonExecutable();
const photograph = process.argv.includes("--photo");
const review = path.resolve(__dirname, `../output/review/clipping-view${photograph ? "/photo" : ""}`);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "n3b-clipping-"));
fs.mkdirSync(review, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["warning", "error"].includes(message.type())) console.log(message.type(), message.text()); });
  const base = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
  const result = { lanes: {}, errors };
  let exportsWritten = 0;
  async function exportedBytes() {
    const delivery = await page.request.get(new URL("/api/delivery/gpu/permit", base).href);
    assert.ok(delivery.ok(), "Establish the GPU delivery connection before byte-invariance comparisons");
    const file = path.join(temporary, `overlay-invariance-${exportsWritten++}.jpg`);
    await global.HDRFinisherElectronTestHarness.selectExportPath(file);
    const grant = await page.evaluate(() => window.hdrFinisherDesktop.chooseExportPath({ extension: "jpg", suggestedName: "overlay-invariance.jpg" }));
    const sessionId = await page.evaluate(() => state.session.session_id);
    const response = await page.request.post(new URL(`/api/session/${sessionId}/export`, base).href, { data: {
      format: "jpeg_ultrahdr", quality: 95, jpeg_chroma_subsampling: "444", jpeg_gain_map_quality: 95,
      jpeg_gain_map_scale: "full", dithering: "off", guarantee_hdr_peak: true,
      output_finishing: { resize_mode: "long_edge", long_edge: 128, sharpening: "standard" },
      output_path: file, path_grant: grant.grant,
    }, timeout: 120000 });
    assert.ok(response.ok(), await response.text());
    const exported = await response.json();
    assert.equal(exported.accepted, true);
    assert.equal(exported.renderer, "gpu", exported.fallback_reason || "Invariance comparisons use the same GPU delivery renderer");
    return fs.readFileSync(file);
  }
  try {
    execFileSync(python, ["-c", `import sys,numpy as np,tifffile
height,width=256,512
signal=np.exp2(np.linspace(-14,5,width,dtype=np.float32))[None,:,None]*.18
hues=np.array([[1,.4,.2],[.2,1,.4],[.4,.2,1],[1,1,1]],np.float32)
rgb=np.tile(signal,(height,1,3))*hues[np.arange(height)//64,None,:]
for band in range(8):
    rgb[band*32:(band+1)*32,:128]=[0 if band & bit else .02 for bit in (1,2,4)]
tifffile.imwrite(sys.argv[1],rgb,photometric='rgb')`, path.join(temporary, "tone.tiff")]);
    await page.goto(base);
    await page.waitForFunction(() => state.gpuPreview?.available && window.HDRTonePreview, null, { timeout: 30000 });
    const inputFile = photograph ? path.join(require("./helpers/photos-root.cjs").photosRoot(), "HDR Test Images", "DSC_3931_01.jpg") : path.join(temporary, "tone.tiff");
    const upload = await page.request.post(new URL("/api/session", base).href, { multipart: {
      file: { name: path.basename(inputFile), mimeType: photograph ? "image/jpeg" : "image/tiff", buffer: fs.readFileSync(inputFile) },
    } });
    assert.ok(upload.ok(), await upload.text());
    const { session } = await upload.json();
    result.source = session.source;
    await page.evaluate(session => activateDesktopSession(session, ""), session);
    await page.evaluate(async () => {
      for (const lane of ["hdr", "sdr"]) {
        Object.assign(state.adjustments[lane], { highlight_section_enabled: true, highlight_compression_mode: "clip", blacks: 0, whites: 0 });
        Object.assign(state.adjustments[lane].film_look, { film_stock: "none", grain_enabled: false, halation_enabled: false });
      }
      state.globalEditDirty = true;
      await syncGlobalEditState();
    });
    result.diagnostics = await page.evaluate(async () => {
      state.previewScheduler?.cancel();
      while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
      await renderGpuDraft("hdr", { longEdge: 512 });
      const renderer = state.gpuPreview;
      const device = renderer.device;
      const source = { ...renderer.scopeSources.get(els.previewCanvas), width: 64, height: 24 };
      source.params = new Float32Array(source.params);
      const indices = HDRGpuParamLayout.indices;
      source.params[indices.HIGHLIGHT_MODE] = 3;
      source.params[indices.PROJECT_REFERENCE_WHITE_NITS] = 203;
      source.params[indices.HIGHLIGHT_TARGET_NITS] = 1000;
      const texture = device.createTexture({ size: [64, 24], format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      source.filmTexture = texture;
      const canvas = document.createElement("canvas");
      const engine = new HDRTonePreviewGpu(renderer, canvas);
      await engine.ready;
      engine.context.configure({ device, format: "bgra8unorm", alphaMode: "opaque", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const results = [];
      try {
        for (const lane of ["hdr", "sdr"]) for (const black of [false, true]) {
          const peak = lane === "hdr" ? 1000 * 0.18 / 203 : 1;
          source.lane = lane;
          source.params[indices.HDR_LANE] = Number(lane === "hdr");
          source.params[indices.HIGHLIGHT_TARGET] = peak;
          source.params[indices.TONE_PEAK] = peak;
          const pixels = new Float32Array(64 * 24 * 4);
          for (let vertical = 0; vertical < 24; vertical++) for (let horizontal = 0; horizontal < 64; horizontal++) {
            const mask = Math.floor(horizontal / 8);
            const row = Math.floor(vertical / 8);
            const contact = black ? [0, -0.1, 0.0001][row] : peak * [1, 1.2, 0.99][row];
            const rgb = [1, 2, 4].map(bit => mask & bit ? contact : peak * 0.25);
            const stored = lane === "hdr" ? [
              0.9746957086 * rgb[0] + 0.0216339017 * rgb[1] + 0.0036703891 * rgb[2],
              0.0016784991 * rgb[0] + 0.9977360501 * rgb[1] + 0.0005854508 * rgb[2],
              0.0048862547 * rgb[0] + 0.0211319326 * rgb[1] + 0.9739818130 * rgb[2],
            ] : rgb;
            pixels.set([...stored, 1], (vertical * 64 + horizontal) * 4);
          }
          device.queue.writeTexture({ texture }, pixels, { bytesPerRow: 1024 }, [64, 24]);
          const originalParams = Array.from(source.params);
          const resources = engine.draw(source, { black });
          if (JSON.stringify(originalParams) !== JSON.stringify(Array.from(source.params))) throw Error("Diagnostic mutated accepted parameters");
          const buffer = device.createBuffer({ size: 256 * 24, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          try {
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToBuffer({ texture: engine.context.getCurrentTexture() }, { buffer, bytesPerRow: 256 }, [64, 24]);
            device.queue.submit([encoder.finish()]);
            await buffer.mapAsync(GPUMapMode.READ);
            const bytes = new Uint8Array(buffer.getMappedRange());
            for (let vertical = 0; vertical < 24; vertical++) for (let horizontal = 0; horizontal < 64; horizontal++) {
              const mask = Math.floor(horizontal / 8);
              const marked = vertical < 16 && mask !== 0;
              const expected = !marked ? [black ? 255 : 0, black ? 255 : 0, black ? 255 : 0]
                : black && mask === 7 ? [0, 0, 0] : [1, 2, 4].map(bit => mask & bit ? 255 : 0);
              const offset = (vertical * 64 + horizontal) * 4;
              const actual = [bytes[offset + 2], bytes[offset + 1], bytes[offset]];
              if (actual.some((channel, index) => channel !== expected[index])) throw Error(lane + "/" + black + " pixel " + horizontal + "," + vertical + ": " + actual + " expected " + expected);
            }
            buffer.unmap();
            results.push({ lane, black, pixelsChecked: 64 * 24, resources });
          } finally { buffer.destroy(); }
        }
      } finally { engine.destroy(); texture.destroy(); }
      return results;
    });
    result.frameMatching = await page.evaluate(async () => {
      state.previewScheduler?.cancel();
      while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
      const group = document.querySelector('[data-group="hdr-tone"]');
      if (group.classList.contains("collapsed")) group.querySelector(".group-toggle").click();
      const renderer = state.gpuPreview;
      const OriginalEngine = window.HDRTonePreviewGpu;
      const originalSources = renderer.scopeSources;
      const originalProxy = renderer.renderScopeProxy;
      const originalAccepted = state.acceptedPresentation;
      const source = originalSources.get(els.previewCanvas);
      const input = document.getElementById("hdr-whites");
      const diagnosticGesture = event => { if (!event.isTrusted) event.stopImmediatePropagation(); };
      input.addEventListener("pointerdown", diagnosticGesture, true);
      const results = [];
      const overlay = () => document.getElementById("tone-clipping-overlay");
      const wait = async predicate => {
        const deadline = performance.now() + 10000;
        while (!predicate()) {
          if (performance.now() > deadline) throw Error("Clipping frame matching timed out");
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      };
      const hidden = () => overlay()?.classList.contains("hidden");
      try {
        for (const execution of ["direct", "tiled"]) for (const cold of [false, true]) {
          HDRTonePreview.end();
          input.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
          await new Promise(resolve => requestAnimationFrame(resolve));
          let release;
          let prepared;
          const draws = [];
          window.HDRTonePreviewGpu = class extends OriginalEngine {
            constructor(...args) {
              super(...args);
              prepared = this.ready;
              if (cold) this.ready = this.ready.then(() => {
                const pipeline = this.clippingPipeline;
                this.clippingPipeline = null;
                return new Promise(resolve => { release = () => { this.clippingPipeline = pipeline; resolve(); }; });
              });
            }
            draw(frameSource, options) {
              draws.push(frameSource.serial);
              return super.draw(frameSource, options);
            }
          };
          const current = { ...source, serial: 700, applicationGeneration: 500 };
          const changed = { ...source, serial: 701, applicationGeneration: 501 };
          renderer.scopeSources = new Map([[els.previewCanvas, current], [renderer.scopeAnalysisCanvas, current]]);
          renderer.renderScopeProxy = async () => null;
          state.acceptedPresentation = { ...originalAccepted, transport: "WebGPU", execution, sourceSerial: 700, generation: 500 };
          input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, altKey: true }));
          await wait(() => Boolean(prepared));
          await prepared;
          state.acceptedPresentation = { ...state.acceptedPresentation, sourceSerial: 701, generation: 501 };
          if (release) release();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          if (!hidden()) throw Error(`Stale diagnostic remained visible: ${execution}/${cold}, generation ${overlay().dataset.generation}, draws ${draws}`);
          renderer.scopeSources.set(els.previewCanvas, changed);
          renderer.scopeSources.set(renderer.scopeAnalysisCanvas, changed);
          await wait(() => !hidden() && overlay().dataset.sourceSerial === "701");
          if (overlay().dataset.generation !== "501" || draws.some(serial => serial !== 700 && serial !== 701)) throw Error("Wrong accepted frame");
          document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
          if (!hidden()) throw Error("Option/Alt release did not hide immediately");
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }));
          await wait(() => !hidden());
          document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
          if (!hidden()) throw Error("Drag end did not hide immediately");
          results.push({ execution, cold, sourceSerial: 701, generation: 501 });
        }
        let finishProxy;
        let proxyStarted = false;
        const draws = [];
        window.HDRTonePreviewGpu = class extends OriginalEngine {
          draw(frameSource, options) { draws.push(frameSource.serial); return super.draw(frameSource, options); }
        };
        renderer.scopeSources = new Map();
        renderer.renderScopeProxy = async () => {
          proxyStarted = true;
          await new Promise(resolve => { finishProxy = resolve; });
        };
        state.acceptedPresentation = { ...originalAccepted, transport: "WebGPU", execution: "tiled", sourceSerial: 800, generation: 800 };
        input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, altKey: true }));
        await wait(() => proxyStarted);
        state.acceptedPresentation = { ...state.acceptedPresentation, sourceSerial: 801, generation: 801 };
        renderer.scopeSources.set(renderer.scopeAnalysisCanvas, { ...source, serial: 801, applicationGeneration: 801 });
        finishProxy();
        await wait(() => !hidden() && overlay().dataset.generation === "801");
        if (draws.some(serial => serial !== 801)) throw Error("Late proxy overwrote the current diagnostic");
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
        proxyStarted = false;
        state.acceptedPresentation = { ...state.acceptedPresentation, sourceSerial: 802, generation: 802 };
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }));
        await wait(() => proxyStarted);
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
        if (!hidden()) throw Error("Release during proxy preparation did not hide immediately");
        finishProxy();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (!hidden() || draws.includes(802)) throw Error("Late proxy resurrected a released diagnostic");
        results.push({ delayedProxy: "Current frame wins; release stays hidden" });
      } finally {
        HDRTonePreview.end();
        input.removeEventListener("pointerdown", diagnosticGesture, true);
        input.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
        await new Promise(resolve => requestAnimationFrame(resolve));
        window.HDRTonePreviewGpu = OriginalEngine;
        renderer.scopeSources = originalSources;
        renderer.renderScopeProxy = originalProxy;
        state.acceptedPresentation = originalAccepted;
      }
      return results;
    });
    for (const lane of ["hdr", "sdr"]) {
      await page.evaluate(async lane => {
        await switchLane(lane);
        const group = document.querySelector(`[data-group="${lane}-tone"]`);
        if (group.classList.contains("collapsed")) group.querySelector(".group-toggle").click();
        state.previewScheduler?.cancel();
        while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
        const assertGpu = await renderGpuDraft(lane, { longEdge: 512 });
        if (!assertGpu) throw Error("GPU fixture preview refused");
      }, lane);
      const original = await page.evaluate(async () => {
        return JSON.stringify(state.adjustments);
      });
      const originalExport = await exportedBytes();
      for (const name of ["blacks", "whites", "shadows", "midtones", "highlights", "midtones-center", "midtones-width"]) {
        await page.locator(`#${lane}-${name}`).hover();
        await page.waitForFunction(() => !document.getElementById("tone-preview-key").classList.contains("hidden"));
        assert.match(await page.locator("#tone-preview-key").innerText(), /Pre-look neutral-ray range.*limiter/);
      }
      for (const name of ["whites", "blacks"]) {
        const slider = page.locator(`#${lane}-${name}`);
        const gesture = await page.evaluate(() => HDRShortcuts.isMac() ? "Option" : "Alt");
        assert.ok((await slider.evaluate(input => input.closest(".control-row").querySelector("label").dataset.tooltip)).includes(`${gesture}-drag`));
        await slider.hover();
        await page.waitForTimeout(250);
        const box = await slider.boundingBox();
        await page.keyboard.down("Alt");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForFunction(() => !document.getElementById("tone-clipping-overlay").classList.contains("hidden"), null, { timeout: 15000 });
        await page.waitForFunction(() => document.getElementById("tone-preview-key").textContent.includes("Finished, post-cap"));
        assert.match(await page.locator("#tone-preview-key").innerText(), /Finished, post-cap/);
        await page.waitForTimeout(250);
        const unchanged = await page.evaluate(async () => {
          const analysis = await state.gpuPreview.analyzeScope(els.previewCanvas, { width: 64, height: 32, tier: "picture", raw: true });
          return { pixels: Array.from(analysis.halves), adjustments: JSON.stringify(state.adjustments), serial: state.acceptedPresentation.sourceSerial };
        });
        assert.equal(unchanged.adjustments, original, "Diagnostic does not change the recipe");
        await page.keyboard.up("Alt");
        await page.waitForFunction(() => document.getElementById("tone-clipping-overlay").classList.contains("hidden"));
        const without = await page.evaluate(async () => {
          const analysis = await state.gpuPreview.analyzeScope(els.previewCanvas, { width: 64, height: 32, tier: "picture", raw: true });
          return { pixels: Array.from(analysis.halves), adjustments: JSON.stringify(state.adjustments), serial: state.acceptedPresentation.sourceSerial };
        });
        assert.deepEqual(unchanged, without, "Overlay on/off preserves the exact same accepted finished frame and recipe");
        await page.keyboard.down("Alt");
        await page.waitForFunction(() => !document.getElementById("tone-clipping-overlay").classList.contains("hidden"));
        const activeExport = await exportedBytes();
        const difference = originalExport.findIndex((value, index) => value !== activeExport[index]);
        assert.ok(originalExport.equals(activeExport), `An active ${lane}/${name} overlay does not change the actual Ultra HDR export bytes: lengths ${originalExport.length}/${activeExport.length}, first difference ${difference}, ${originalExport.subarray(difference, difference + 48).toString("hex")}/${activeExport.subarray(difference, difference + 48).toString("hex")}`);
        const pane = await page.locator("#preview-primary-pane").boundingBox();
        const screenshot = path.join(review, `${lane}-${name}.png`);
        await page.screenshot({ path: screenshot, clip: pane });
        execFileSync(python, ["-c", "from PIL import Image;import sys;im=Image.open(sys.argv[1]);im.thumbnail((1000,650));im.save(sys.argv[1])", screenshot]);
        await page.mouse.up();
        await page.keyboard.up("Alt");
        await page.waitForFunction(() => document.getElementById("tone-clipping-overlay").classList.contains("hidden"));
      }
      const liveSlider = page.locator(`#${lane}-whites`);
      await liveSlider.hover();
      const liveBox = await liveSlider.boundingBox();
      await page.mouse.move(liveBox.x + liveBox.width / 2, liveBox.y + liveBox.height / 2);
      await page.mouse.down();
      await page.keyboard.down("Alt");
      for (const value of [10, 30, 60, 90, 25, 0]) {
        const previous = await page.evaluate(() => state.acceptedPresentation?.sourceSerial);
        await page.evaluate(({ lane, value }) => {
          const input = document.getElementById(`${lane}-whites`);
          input.value = String(value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }, { lane, value });
        await page.waitForFunction(previous => {
          const current = state.acceptedPresentation;
          const overlay = document.getElementById("tone-clipping-overlay");
          return current?.sourceSerial !== previous && overlay.dataset.sourceSerial === String(current.sourceSerial)
            && overlay.dataset.generation === String(current.generation) && !overlay.classList.contains("hidden");
        }, previous);
      }
      await page.keyboard.up("Alt");
      await page.mouse.up();
      result.lanes[lane] = "Live accepted-frame matching passed";
      await page.mouse.move(10, 10);
      await page.waitForFunction(() => document.getElementById("tone-preview-key").classList.contains("hidden"));
    }
    await page.evaluate(async () => {
      setGradeMode("local"); await assignToolToPending("luminance_range");
      selectedMaskLeaf().full_start_ev = -7;
      if (!await commitSelectedLocal({ maskContent: true })) throw Error("Local fixture commit refused");
      state.localShowMask = false;
    });
    for (const lane of ["hdr", "sdr"]) for (const name of ["blacks", "whites"]) {
      await page.evaluate(async lane => { await switchLane(lane); await renderGpuDraft(lane, { longEdge: 512 }); }, lane);
      const slider = page.locator(`#local-${name}`);
      await slider.scrollIntoViewIfNeeded(); await slider.hover();
      await page.waitForFunction(() => document.getElementById("tone-preview-key").textContent.includes("before spatial mask"));
      await page.waitForTimeout(250);
      const box = await slider.boundingBox();
      const localRecipe = await page.evaluate(() => JSON.stringify(state.adjustments));
      await page.keyboard.down("Alt");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.waitForFunction(() => !document.getElementById("tone-clipping-overlay").classList.contains("hidden"));
      await page.keyboard.up("Alt");
      await page.waitForFunction(() => document.getElementById("tone-clipping-overlay").classList.contains("hidden"));
      await page.mouse.up();
      assert.equal(await page.evaluate(() => JSON.stringify(state.adjustments)), localRecipe, "Local clipping gesture does not change the recipe");
    }
    await page.evaluate(() => { setGradeMode("global"); activateWorkflowTab("proof"); });
    await page.waitForFunction(() => document.getElementById("tone-preview-key").classList.contains("hidden"));
    result.local = "Blacks/Whites gestures, Alt release and workflow cleanup passed";
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(review, "result.json"), JSON.stringify(result, null, 2));
    console.log("N3B_RESULT", JSON.stringify(result));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
