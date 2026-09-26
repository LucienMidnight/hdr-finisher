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
  ? path.join(ROOT, ".venv", "Scripts", "python.exe")
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

    assert(await page.evaluate(() => state.denoise[state.currentView].analysis.algorithm_version) === "adaptive-atrous-v1",
      "New denoise does not default to the adaptive method.");
    await page.evaluate(() => {
      const group = document.querySelector(".denoise-group .group-toggle");
      if (group.getAttribute("aria-expanded") !== "true") group.click();
    });
    assert(await page.evaluate(() => document.getElementById("denoise-legacy-method-row").hidden),
      "The wavelet presets are showing while Adaptive is selected.");
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
    for (const [id, value] of [["denoise-fine", 0.3], ["denoise-medium", 0.8], ["denoise-coarse", 0.95], ["denoise-amount", 0.6], ["denoise-detail", 0.7]]) {
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

    const context = await page.evaluate(async () => {
      const selector = state.gpuPreview.denoiseSourceSelector;
      const region = await state.gpuPreview.readDenoiseResolvedRegion(selector.original.width, selector.original.height, 0, 0);
      return {
        sessionId: state.session.session_id,
        lane: state.currentView,
        editRevision: state.editRevision,
        geometry: JSON.stringify(state.adjustments.shared?.geometry || {}),
        width: selector.original.width,
        height: selector.original.height,
        algorithm: selector.cache.algorithmVersion,
        model: selector.cache.model,
        controls: selector.controls,
        gpu: region ? Array.from(region.values) : null,
      };
    });
    assert(context.algorithm === "adaptive-atrous-v1", `The GPU ran ${context.algorithm}.`);
    assert(context.gpu && context.gpu.length === context.width * context.height * 4, "The GPU result could not be read back.");

    // The exact proxy the GPU denoised, as the half floats it loaded.
    const proxy = await page.evaluate(async (c) => {
      const longEdge = Math.max(c.width, c.height);
      const response = await fetch(`/api/session/${c.sessionId}/proxy/${c.lane}?long_edge=${longEdge}&format=rgba16f`
        + `&edit_revision=${c.editRevision}&geometry_signature=${encodeURIComponent(c.geometry)}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        width: Number(response.headers.get("X-Image-Width")),
        height: Number(response.headers.get("X-Image-Height")),
        bytesPerRow: Number(response.headers.get("X-Bytes-Per-Row")),
        format: response.headers.get("X-Pixel-Format"),
        bytes: Array.from(bytes),
      };
    }, context);
    assert(proxy.width === context.width && proxy.height === context.height,
      `The fetched proxy is ${proxy.width}x${proxy.height}, the GPU denoised ${context.width}x${context.height}.`);
    assert(proxy.format === "rgba16float", `Expected a half-float proxy, got ${proxy.format}.`);

    const raw = Buffer.from(proxy.bytes);
    const pixels = new Float32Array(context.width * context.height * 4);
    for (let y = 0; y < context.height; y += 1) {
      for (let x = 0; x < context.width * 4; x += 1) {
        pixels[y * context.width * 4 + x] = halfToFloat(raw.readUInt16LE(y * proxy.bytesPerRow + x * 2));
      }
    }
    const inputPath = path.join(scratch, "proxy.f32");
    const outputPath = path.join(scratch, "reference.f32");
    fs.writeFileSync(inputPath, Buffer.from(pixels.buffer));
    fs.writeFileSync(path.join(scratch, "model.json"), JSON.stringify({ ...context.model, controls: context.controls }));
    execFileSync(PYTHON, ["-c", `
import json, sys
import numpy as np
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "backend"))})
from hdr_finisher import denoise_adaptive as da
spec = json.load(open(${JSON.stringify(path.join(scratch, "model.json"))}))
image = np.fromfile(${JSON.stringify(inputPath)}, dtype=np.float32).reshape(${context.height}, ${context.width}, 4)
model = da.AdaptiveNoiseModel(a=spec["a"], b=spec["b"], c=spec["c"], band_sigmas=tuple(tuple(row) for row in spec["band_sigmas"]))
c = spec["controls"]
controls = da.AdaptiveControls(amount=c["amount"], luminance=c["luminance"], color_noise=c["colorNoise"], detail_recovery=c["detailRecovery"], fine_noise=c["fineNoise"], medium_noise=c["mediumNoise"], coarse_noise=c["coarseNoise"])
da.resolve_adaptive(image, model, controls).astype(np.float32).tofile(${JSON.stringify(outputPath)})
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
        const produced = context.gpu[index + channel];
        const error = Math.abs(produced - expected);
        // Half precision rounds at about 1e-3 of the value.
        const allowance = 2e-3 * Math.abs(expected) + 1e-4;
        worst = Math.max(worst, error / allowance);
        if (error > allowance) beyond += 1;
        const removed = pixels[index + channel] - expected;
        removedEnergy += removed * removed;
        count += 1;
      }
    }
    const fraction = beyond / count;
    console.log(`GPU vs Python on ${context.width}x${context.height}: worst ${worst.toFixed(2)}x the half-float allowance, `
      + `${(fraction * 100).toFixed(4)}% of samples beyond it; removed RMS ${Math.sqrt(removedEnergy / count).toExponential(3)}`);
    assert(Math.sqrt(removedEnergy / count) > 1e-5, "The reference removed nothing, so parity would prove nothing.");
    assert(fraction < 1e-4 && worst < 8,
      `The GPU adaptive denoise disagrees with the Python reference beyond half-float precision.`);
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
