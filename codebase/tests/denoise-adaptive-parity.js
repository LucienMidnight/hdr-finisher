// Adaptive denoise: the WebGPU preview against the Python the export runs.
//
//   node tests/run-in-electron.js tests/denoise-adaptive-parity.js
//
// The page denoises its source proxy on the GPU; this test then fetches that
// same proxy (rgba16f, the format the GPU loaded) and the noise model the
// backend measured for it, runs backend/hdr_finisher/denoise_adaptive.py on
// exactly those pixels in a Python subprocess, and compares pixel by pixel.
// The GPU stores its result in half floats, so agreement is to half-float
// precision, not bitwise. A mismatch in edge handling, band order, the control
// mapping or the tile margin would show as errors far larger than that.
// Experimental methods use the native source before the Fit resize. Compare
// that result with both native Python and the editor's own 100% resolution.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("./large-noisy-tiff.js");

const WIDTH = 1500;
const HEIGHT = 1000;
const ROOT = path.resolve(__dirname, "..");
const PYTHON = process.platform === "win32"
  ? require('../tools/lib/platform.cjs').pythonExecutable()
  : path.join(ROOT, ".venv", "bin", "python");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function halfToFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const source = ensureLargeNoisySource(WIDTH, HEIGHT);
  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-finisher-adaptive-parity-"));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", source);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 300000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    await page.waitForTimeout(900);

    await page.evaluate(() => {
      // Fine and Clean originally used CPU preparation in this check. Keep
      // that route so zero-evenness and CPU preparation reuse are exercised.
      state.gpuPreview.enableGradeCleanGrainGpu = false;
      const group = document.querySelector(".denoise-group .group-toggle");
      if (group.getAttribute("aria-expanded") !== "true") group.click();
    });
    assert(await page.evaluate(() => !document.getElementById("denoise-specks")
      && document.getElementById("denoise-splotch-size").value === "small"),
    "Clean Grain should start at Small with no Dark Specks control.");
    assert(await page.evaluate(() => !document.getElementById("denoise-legacy-method-row")),
      "The removed wavelet presets are still in the panel.");
    // New edits start on Clean Grain. The first parity case measures Standard.
    await page.selectOption("#denoise-method", "standard");
    await page.waitForFunction(() => state.denoise[state.currentView].controls.method === "standard");
    await page.evaluate(() => document.querySelector("#denoise-bypass").click());
    await page.waitForFunction(
      () => ["ready", "error"].includes(state.denoiseRuntime[state.currentView].status),
      null, { timeout: 300000 },
    );
    const status = await page.evaluate(() => state.denoiseRuntime[state.currentView]);
    assert(status.status === "ready", "Adaptive denoise did not become ready: " + JSON.stringify(status));
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });

    // Uneven size and detail settings, so the per-size mapping has to agree on
    // both sides rather than only at the neutral defaults.
    await page.evaluate(() => document.getElementById("denoise-advanced-toggle").click());
    for (const [id, value] of [["denoise-finest", 0.65], ["denoise-fine", 0.3], ["denoise-medium", 0.8], ["denoise-coarse", 0.95], ["denoise-amount", 0.6], ["denoise-detail", 0.7]]) {
      await page.evaluate(([target, next]) => {
        const input = document.getElementById(target);
        input.value = String(next);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, [id, value]);
    }
    await page.waitForFunction(
      () => state.gpuPreview.denoiseSourceSelector?.controls?.coarseNoise === 0.95
        && state.gpuPreview.denoiseSourceSelector?.controls?.detailRecovery === 0.7,
      null, { timeout: 120000 },
    );
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    assert(await page.evaluate(() => !document.getElementById("denoise-size-controls").hidden
      && document.getElementById("denoise-coarse-value").textContent === "95%"),
    "The noise size controls are not showing their values under Adaptive.");

    const readResult = () => page.evaluate(async () => {
      await state.editCommandQueue;
      const renderer = state.gpuPreview;
      const selector = state.gpuPreview.denoiseSourceSelector;
      const { session_id: sessionId } = state.session;
      const { currentView: lane, editRevision } = state;
      const geometry = JSON.stringify(state.adjustments.shared?.geometry || {});
      const edge = refinementProxyLongEdge();
      const original = await renderer.loadProxy(sessionId, lane, edge, geometry, editRevision, "source");
      // The regular screen draw can supersede this diagnostic resolve while
      // the first Clean Grain region is still uploading. Let that draw
      // finish and read the same prepared controls after it settles.
      for (let attempt = 0; attempt < 5; attempt++) {
        if (await renderer.resolveDenoiseProxy(selector.controls, { source: original })) break;
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      const region = await renderer.readDenoiseResolvedRegion(original.width, original.height, 0, 0);
      let gpu=null;
      if(region){
        // readDenoiseResolvedRegion returns plain numbers; pack them as float32 for transport.
        const floats=region.values instanceof Float32Array?region.values:Float32Array.from(region.values);
        const bytes=new Uint8Array(floats.buffer,floats.byteOffset,floats.byteLength);
        let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
        gpu=btoa(binary);
      }
      return {
        sessionId,
        lane,
        editRevision,
        geometry,
        width: original.width,
        height: original.height,
        algorithm: selector.cache.algorithmVersion,
        model: selector.cache.model,
        controls: selector.controls,
        preparation: selector.cache.grain?.token,
        gpu,
      };
    });
    const context = await readResult();
    assert(context.algorithm === "adaptive-atrous-v1", `The GPU ran ${context.algorithm}.`);
    assert(context.gpu, "The GPU result could not be read back.");
    const gpuBytes=Buffer.from(context.gpu,'base64');delete context.gpu;
    const gpuPixels=new Float32Array(gpuBytes.buffer,gpuBytes.byteOffset,gpuBytes.byteLength/4);
    assert(gpuPixels.length===context.width*context.height*4,"The GPU result has the wrong size.");

    // The exact proxy the GPU denoised, as the half floats it loaded.
    const proxyUrl=new URL(`/api/session/${context.sessionId}/proxy/${context.lane}?long_edge=${Math.max(context.width,context.height)}&format=rgba16f`
      +`&edit_revision=${context.editRevision}&geometry_signature=${encodeURIComponent(context.geometry)}`,url);
    const response=await page.request.get(proxyUrl.href);
    assert(response.ok(),`Proxy fetch failed: ${response.status()}`);
    const headers=response.headers();
    const proxy={width:Number(headers['x-image-width']),height:Number(headers['x-image-height']),
      bytesPerRow:Number(headers['x-bytes-per-row']),format:headers['x-pixel-format']};
    const raw=await response.body();
    assert(proxy.width === context.width && proxy.height === context.height,
      `The fetched proxy is ${proxy.width}x${proxy.height}, the GPU denoised ${context.width}x${context.height}.`);
    assert(proxy.format === "rgba16float", `Expected a half-float proxy, got ${proxy.format}.`);

    const pixels = new Float32Array(context.width * context.height * 4);
    for (let y = 0; y < context.height; y += 1) {
      for (let x = 0; x < context.width * 4; x += 1) {
        pixels[y * context.width * 4 + x] = halfToFloat(raw.readUInt16LE(y * proxy.bytesPerRow + x * 2));
      }
    }
    const inputPath = path.join(scratch, "proxy.f32");
    const outputPath = path.join(scratch, "reference.f32");
    fs.writeFileSync(inputPath, Buffer.from(pixels.buffer));
    const nativePath = path.join(scratch, "native.f32");
    const nativeUrl = new URL(`/api/session/${context.sessionId}/proxy/${context.lane}?long_edge=${WIDTH}&format=rgba32f`
      + `&edit_revision=${context.editRevision}&geometry_signature=${encodeURIComponent(context.geometry)}`, url);
    const nativeResponse = await page.request.get(nativeUrl.href);
    assert(nativeResponse.ok(), `Native proxy fetch failed: ${nativeResponse.status()}`);
    const nativeRaw = await nativeResponse.body();
    const nativeRowBytes = Number(nativeResponse.headers()["x-bytes-per-row"]);
    assert(Number(nativeResponse.headers()["x-image-width"]) === WIDTH
      && Number(nativeResponse.headers()["x-image-height"]) === HEIGHT
      && nativeResponse.headers()["x-pixel-format"] === "rgba32float", "Expected the whole float32 native source.");
    fs.writeFileSync(nativePath, Buffer.concat(Array.from({ length: HEIGHT }, (_, row) => (
      nativeRaw.subarray(row * nativeRowBytes, row * nativeRowBytes + WIDTH * 16)
    ))));
    const nativePixels = new Float32Array(fs.readFileSync(nativePath).buffer.slice(0));
    function compare(method, context, gpuPixels, native = false) {
      fs.writeFileSync(path.join(scratch, "model.json"), JSON.stringify({ ...context.model, controls: context.controls }));
      execFileSync(PYTHON, ["-c", `
import json, sys
import numpy as np
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "backend"))})
from hdr_finisher import denoise_adaptive as da
from hdr_finisher.preview import downsample_image
spec = json.load(open(${JSON.stringify(path.join(scratch, "model.json"))}))
image = np.fromfile(${JSON.stringify(native ? nativePath : inputPath)}, dtype=np.float32).reshape(${native ? HEIGHT : context.height}, ${native ? WIDTH : context.width}, 4)
model = da.AdaptiveNoiseModel(a=spec["a"], b=spec["b"], c=spec["c"], band_sigmas=tuple(tuple(row) for row in spec["band_sigmas"]))
c = spec["controls"]
controls = da.AdaptiveControls(amount=c["amount"], luminance=c["luminance"], color_noise=c["colorNoise"], detail_recovery=c["detailRecovery"], finest_noise=c["finestNoise"], fine_noise=c["fineNoise"], medium_noise=c["mediumNoise"], coarse_noise=c["coarseNoise"],
  method=c.get("method","standard"), grain_evenness=c.get("grainEvenness",1),
  color_splotches=c.get("colorSplotches",1), splotch_size=c.get("splotchSize","small"))
result = da.resolve_adaptive(image, model, controls)
downsample_image(result, ${Math.max(context.width, context.height)}).astype(np.float32).tofile(${JSON.stringify(outputPath)})
  `], { stdio: "inherit" });
      const reference = new Float32Array(fs.readFileSync(outputPath).buffer.slice(0));

      // Compare RGB only; the GPU writes an opaque alpha.
      let worst = 0;
      let beyond = 0;
      let removedEnergy = 0;
      let count = 0;
      for (let index = 0; index < reference.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          const expected = reference[index + channel];
          const produced = gpuPixels[index + channel];
          const error = Math.abs(produced - expected);
          // Half precision rounds at about 1e-3 of the value.
          const allowance = 2e-3 * Math.abs(expected) + 1e-4;
          worst = Math.max(worst, error / allowance);
          if (error > allowance) beyond += 1;
          const removed = (native ? nativePixels : pixels)[index + channel] - expected;
          removedEnergy += removed * removed;
          count += 1;
        }
      }
      const fraction = beyond / count;
      console.log(`${method}: GPU vs Python on ${context.width}x${context.height}: worst ${worst.toFixed(2)}x the half-float allowance, `
        + `${(fraction * 100).toFixed(4)}% of samples beyond it; removed RMS ${Math.sqrt(removedEnergy / count).toExponential(3)}`);
      assert(Math.sqrt(removedEnergy / count) > 1e-5, "The reference removed nothing, so parity would prove nothing.");
      assert(fraction < 1e-4 && worst < 8,
        `The GPU adaptive denoise disagrees with the Python reference beyond half-float precision.`);
    }
    compare("Standard", context, gpuPixels);

    const waitReady = () => page.waitForFunction(() => {
      const runtime = state.denoiseRuntime[state.currentView];
      if (runtime.status === "error") throw Error(runtime.error);
      return runtime.status === "ready" && viewerState().status === "ready"
        && state.acceptedPresentation?.processedLongEdge === requiredProcessingLongEdge()
        && previewIdleNow();
    }, null, { timeout: 90000 });
    const change = (id, value, release = true) => page.evaluate(([id, value, release]) => {
      const control = document.getElementById(id);
      control.value = value;
      control.dispatchEvent(new Event(release ? "change" : "input", { bubbles: true }));
    }, [id, value, release]);
    const nextPixels = result => {
      assert(result.width === proxy.width && result.height === proxy.height, "Denoise changed the proxy resolution.");
      assert(result.gpu, "The prepared GPU result could not be read.");
      const bytes = Buffer.from(result.gpu, "base64");
      return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    };

    async function compareZoom(method, fit, fitPixels) {
      await page.evaluate(() => document.getElementById("zoom-actual").click());
      await waitReady();
      const actual = await readResult();
      assert(actual.width === WIDTH && actual.height === HEIGHT && actual.gpu, "Expected native Grain pixels.");
      assert(fit.preparation && fit.preparation === actual.preparation,
        `${method} replaced the native preparation on zoom.`);
      const actualBytes = Buffer.from(actual.gpu, "base64");
      compare(`${method} at 100%`, actual,
        new Float32Array(actualBytes.buffer, actualBytes.byteOffset, actualBytes.byteLength / 4), true);
      const fitPath = path.join(scratch, "fit.f32");
      const actualPath = path.join(scratch, "actual.f32");
      fs.writeFileSync(fitPath, Buffer.from(fitPixels.buffer, fitPixels.byteOffset, fitPixels.byteLength));
      fs.writeFileSync(actualPath, actualBytes);
      execFileSync(PYTHON, ["-c", `
import sys
import numpy as np
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "backend"))})
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.preview import _hdr_to_sdr_display, downsample_image
fit = np.fromfile(${JSON.stringify(fitPath)}, np.float32).reshape(${fit.height}, ${fit.width}, 4)[..., :3]
full = np.fromfile(${JSON.stringify(actualPath)}, np.float32).reshape(${HEIGHT}, ${WIDTH}, 4)[..., :3]
actual = downsample_image(full, ${Math.max(fit.width, fit.height)})
for lane, pair in (("sdr", [_hdr_to_sdr_display(rgb) for rgb in (fit, actual)]), ("hdr", (fit, actual))):
    difference = compare_finished_pixels(*pair, lane)
    print(f"${method}: Fit vs downscaled 100% {lane.upper()} {difference.metric}, "
          f"mean {difference.mean:.4f}, p99.9 {difference.p999:.4f}")
    assert difference.passed
`], { stdio: "inherit" });
      await page.evaluate(() => document.getElementById("zoom-fit").click());
      await waitReady();
      assert(fit.preparation === await page.evaluate(() => state.gpuPreview.denoiseSourceSelector.cache.grain.token),
        `${method} replaced the native preparation on return to Fit.`);
    }

    // Standard doesn't apply live Evenness input. Save the value before
    // selecting Clean Grain with colour cleaning off.
    await page.evaluate(() => commitDenoiseControl("grain_evenness", 0));
    await page.evaluate(async () => { await commitDenoiseControl("clean_splotches", false); await commitDenoiseControl("clean_fringes", false); });
    await change("denoise-method", "clean_grain");
    await waitReady();
    const zero = nextPixels(await readResult());
    assert(Buffer.from(zero.buffer, zero.byteOffset, zero.byteLength).equals(gpuBytes),
      "Clean Grain with colour cleaning off and zero evenness differs from Standard.");

    const fineStart = performance.now();
    await change("denoise-evenness", 1, false);
    await change("denoise-evenness", 1);
    await waitReady();
    const fine = await readResult();
    console.log("Clean Grain without colour cleaning preparation and readback ms", Math.round(performance.now() - fineStart));
    const finePixels = nextPixels(fine);
    await compareZoom("Clean Grain without colour cleaning", fine, finePixels);

    const cleanStart = performance.now();
    await page.evaluate(async () => { await commitDenoiseControl("clean_splotches", true); await commitDenoiseControl("clean_fringes", true); });
    await waitReady();
    const clean = await readResult();
    console.log("Clean Grain preview preparation and readback ms", Math.round(performance.now() - cleanStart));
    const cleanPixels = nextPixels(clean);
    await compareZoom("Clean Grain", clean, cleanPixels);
    const prepToken = await page.evaluate(() => state.gpuPreview.denoiseSourceSelector.cache.grain.token);
    const dragStart = performance.now();
    await change("denoise-splotches", 0, false);
    await page.waitForFunction(() => {
      const controls = state.gpuPreview.denoiseSourceSelector?.controls;
      return controls?.colorSplotches === 0;
    }, null, { timeout: 30000 });
    const off = nextPixels(await readResult());
    console.log("Clean Grain blend preview and readback ms", Math.round(performance.now() - dragStart));
    assert(Buffer.from(off.buffer, off.byteOffset, off.byteLength).equals(
      Buffer.from(finePixels.buffer, finePixels.byteOffset, finePixels.byteLength)), "Color Splotches at zero differs from turning colour cleaning off.");
    assert(prepToken === await page.evaluate(() => state.gpuPreview.denoiseSourceSelector.cache.grain.token),
      "A live blend rebuilt the preparation.");
    await page.evaluate(() => document.querySelector("#denoise-show-noise").click());
    await page.waitForFunction(() => !document.querySelector("#noise-view-badge").classList.contains("hidden"));
    await page.evaluate(() => document.querySelector("#denoise-recalculate").click());
    await waitReady();
    assert(prepToken !== await page.evaluate(() => state.gpuPreview.denoiseSourceSelector.cache.grain.token),
      "Recalculate did not replace the grain preparation.");
    assert(pageErrors.length === 0, "Page errors: " + JSON.stringify(pageErrors));
    console.log("Adaptive denoise: the GPU preview matches the export's Python to half-float precision.");
  } finally {
    await browser.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
