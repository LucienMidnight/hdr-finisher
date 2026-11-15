const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const python = require("../tools/lib/platform.cjs").pythonExecutable();
const photograph = process.argv.includes("--photo");
const review = path.resolve(__dirname, `../output/review/n3b-clipping${photograph ? "/photo" : ""}`);
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
    assert.equal((await response.json()).accepted, true);
    return fs.readFileSync(file);
  }
  try {
    execFileSync(python, ["-c", `import sys,numpy as np,tifffile
height,width=256,512
signal=np.exp2(np.linspace(-14,5,width,dtype=np.float32))[None,:,None]*.18
hues=np.array([[1,.4,.2],[.2,1,.4],[.4,.2,1],[1,1,1]],np.float32)
rgb=np.tile(signal,(height,1,3))*hues[np.arange(height)//64,None,:]
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
    const diagnostics = await page.evaluate(async () => {
      state.previewScheduler?.cancel();
      while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
      await renderGpuDraft("hdr", { longEdge: 512 });
      const renderer = state.gpuPreview;
      const device = renderer.device;
      const source = { ...renderer.scopeSources.get(els.previewCanvas), width: 64, height: 8, lane: "sdr" };
      source.params = new Float32Array(source.params);
      const indices = HDRGpuParamLayout.indices;
      source.params[indices.HDR_LANE] = 0;
      source.params[indices.HIGHLIGHT_MODE] = 3;
      source.params[indices.TONE_PEAK] = 1;
      const texture = device.createTexture({ size: [64, 8], format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      source.filmTexture = texture;
      const canvas = document.createElement("canvas");
      const engine = new HDRTonePreviewGpu(renderer, canvas);
      await engine.ready;
      engine.context.configure({ device, format: "bgra8unorm", alphaMode: "opaque", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const colors = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [.5, .5, .5], [.7, .4, .9], [1, .7, .1]];
      async function picture(rgb, black = false, baseline = false, displayPeak = 0) {
        const pixels = new Float32Array(64 * 8 * 4);
        for (let index = 0; index < 64 * 8; index++) pixels.set([...rgb, 1], index * 4);
        device.queue.writeTexture({ texture }, pixels, { bytesPerRow: 1024 }, [64, 8]);
        engine.draw(source, { black, baseline, colors, displayPeak });
        if (baseline) return null;
        const buffer = device.createBuffer({ size: 256 * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: engine.context.getCurrentTexture() }, { buffer, bytesPerRow: 256 }, [64, 8]);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(buffer.getMappedRange());
        const pixel = horizontal => Array.from(bytes.slice(horizontal * 4, horizontal * 4 + 3)).reverse();
        const result = [pixel(0), pixel(3), pixel(6), pixel(9), pixel(12), pixel(1)];
        buffer.unmap(); buffer.destroy();
        return result;
      }
      try {
        const touching = await picture([1, 1, 1]);
        const clippedRed = await picture([2, 0, 0]);
        const blackTouching = await picture([0, 0, 0], true);
        const clippedBlack = await picture([-.2, .2, .2], true);
        await picture([.5, .5, .5], false, true);
        const newly = await picture([1, 1, 1]);
        engine.hasBaseline = false;
        source.lane = "hdr";
        source.params[indices.HDR_LANE] = 1;
        source.params[indices.HIGHLIGHT_TARGET] = 1;
        const hdrSdrWhite = await picture([.12, .12, .12]);
        const hdrDisplay = await picture([.2, .2, .2], false, false, .15);
        const hdrTarget = await picture([1, 1, 1]);
        return { touching, clippedRed, blackTouching, clippedBlack, newly, hdrSdrWhite, hdrDisplay, hdrTarget };
      } finally { engine.destroy(); texture.destroy(); }
    });
    assert.deepEqual(diagnostics.touching[1], [0, 0, 0], "White endpoint contact is not labelled as lost channels");
    assert.deepEqual(diagnostics.clippedRed[1], [255, 0, 0], "Only the lost red channel is marked");
    assert.deepEqual(diagnostics.blackTouching[1], [255, 255, 255], "Black endpoint contact uses the white diagnostic background");
    assert.deepEqual(diagnostics.clippedBlack[1], [255, 0, 0], "Black cap loss identifies its channel");
    assert.deepEqual(diagnostics.newly[1], [0, 0, 0], "New endpoint transitions use dashes, not solid cap-loss marks");
    assert.deepEqual(diagnostics.newly[2], [0, 255, 0], "A newly touching green channel remains visible");
    assert.deepEqual(diagnostics.newly[4], [0, 0, 255], "A newly touching blue channel remains visible");
    for (const [actual, expected, message] of [
      [diagnostics.hdrSdrWhite[0], [179, 102, 230], "HDR crossing SDR white uses the accent, not clipping RGB"],
      [diagnostics.hdrDisplay[5], [255, 179, 26], "HDR display overrange has a separate warning"],
      [diagnostics.hdrTarget[1], [128, 128, 128], "HDR reaching the target gets a pale marker"],
    ]) assert.ok(actual.every((channel, index) => Math.abs(channel - expected[index]) <= 1), `${message}: ${actual}`);
    result.diagnostics = diagnostics;
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
        if (name === "whites") assert.ok(originalExport.equals(await exportedBytes()), "An active overlay does not change the actual Ultra HDR export bytes");
        const pane = await page.locator("#preview-primary-pane").boundingBox();
        const screenshot = path.join(review, `${lane}-${name}.png`);
        await page.screenshot({ path: screenshot, clip: pane });
        execFileSync(python, ["-c", "from PIL import Image;import sys;im=Image.open(sys.argv[1]);im.thumbnail((1000,650));im.save(sys.argv[1])", screenshot]);
        await page.mouse.up();
        await page.keyboard.up("Alt");
        await page.waitForFunction(() => document.getElementById("tone-clipping-overlay").classList.contains("hidden"));
      }
      const timingSlider = page.locator(`#${lane}-whites`);
      await timingSlider.hover();
      await page.waitForTimeout(250);
      const timingBox = await timingSlider.boundingBox();
      await page.keyboard.down("Alt");
      await page.mouse.move(timingBox.x + timingBox.width / 2, timingBox.y + timingBox.height / 2);
      await page.mouse.down();
      const timings = await page.evaluate(async lane => {
        const input = document.getElementById(`${lane}-whites`);
        const samples = [];
        for (const value of [10, 20, 30, 40, 50, 60, 70, 80, 90, 50, 25, 0]) {
          const start = performance.now();
          const previous = state.acceptedPresentation?.sourceSerial;
          input.value = String(value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise((resolve, reject) => {
            function check() {
              if (performance.now() - start > 5000) { reject(Error("Overlay did not follow the current preview")); return; }
              const current = state.acceptedPresentation;
              const overlay = document.getElementById("tone-clipping-overlay");
              if (current?.sourceSerial !== previous && overlay.dataset.sourceSerial === String(current.sourceSerial)
                && overlay.dataset.generation === String(current.generation) && !overlay.classList.contains("hidden")) {
                samples.push(performance.now() - start); resolve();
              } else requestAnimationFrame(check);
            }
            requestAnimationFrame(check);
          });
        }
        return { samples, gpu: structuredClone(HDRTonePreview.metrics) };
      }, lane);
      await page.mouse.up();
      await page.keyboard.up("Alt");
      result.lanes[lane] = timings;
      await page.mouse.move(10, 10);
      await page.waitForFunction(() => document.getElementById("tone-preview-key").classList.contains("hidden"));
    }
    await page.evaluate(async () => {
      setGradeMode("local"); await assignToolToPending("luminance_range");
      selectedMaskLeaf().full_start_ev = -7;
      if (!await commitSelectedLocal({ maskContent: true })) throw Error("Local fixture commit refused");
      state.localShowMask = false;
    });
    for (const name of ["blacks", "whites"]) {
      const slider = page.locator(`#local-${name}`);
      await slider.scrollIntoViewIfNeeded(); await slider.hover();
      await page.waitForFunction(() => document.getElementById("tone-preview-key").textContent.includes("before spatial mask"));
      await page.waitForTimeout(250);
      const box = await slider.boundingBox();
      await page.keyboard.down("Alt");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.waitForFunction(() => !document.getElementById("tone-clipping-overlay").classList.contains("hidden"));
      await page.keyboard.up("Alt");
      await page.waitForFunction(() => document.getElementById("tone-clipping-overlay").classList.contains("hidden"));
      await page.mouse.up();
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
