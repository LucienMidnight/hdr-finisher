// BW-01 Black & White: the WebGPU preview matches the CPU export.
//
// A generated picture with every hue across it, brightness from deep shadow
// to HDR highlights down it, and a noisy dark band, rendered through both
// renderers in each rendition. As in clarity-map-parity.js, the measure is
// what B&W adds to their disagreement: the difference with B&W on, less the
// difference with it off (the rest of the graph's own GPU/CPU gap). It also
// checks the GPU picture really is grey.
//
//   node tests/run-in-electron.js tests/bw-parity.js [--input photo.heic]
//
// --input runs the same cases on a real file instead, and reports rather than
// fails. An Apple HDR HEIC exercises the SDR authored-reference path, where
// B&W runs before the highlight stage although Color runs after it. There the
// two renderers start from slightly different authored-SDR pixels (the gap is
// already larger with B&W off), and strong hue-selective sliders magnify that
// at colour edges. Measured 2026-09-27 on iphone-12-pro-HDR.heic: grey
// everywhere; Red filter 0.08 levels mean, p99.9 1 level; the extreme
// alternating/all +100 cases with Film Look up to 0.19 mean, p99.9 6 levels.

const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const LONG_EDGE = 1200;
const MAX_MEAN_DIFFERENCE = 0.06 / 255;
const MAX_P999_DIFFERENCE = 2 / 255;
// Grey on the GPU: all three channels within one 8-bit level.
const MAX_CHANNEL_SPREAD = 1;

const CASES = [
  { label: "neutral", sliders: {} },
  { label: "red filter", sliders: { reds: 55, oranges: 45, yellows: 15, greens: -30, aquas: -60, blues: -85, purples: -50, magentas: 25 } },
  { label: "alternating 100", sliders: { reds: -100, oranges: 100, yellows: -100, greens: 100, aquas: -100, blues: 100, purples: -100, magentas: 100 } },
  { label: "all +100", sliders: { reds: 100, oranges: 100, yellows: 100, greens: 100, aquas: 100, blues: 100, purples: 100, magentas: 100 } },
];

function writeFixture() {
  const python = path.resolve(__dirname, "..", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bw-parity-")), "bw_hues.tiff");
  const script = `
import numpy as np, tifffile, sys, colorsys
h, w = 800, 1200
x = np.arange(w) / w
hue = np.array([colorsys.hsv_to_rgb(v, 0.85, 1.0) for v in x], np.float32)
y = np.arange(h)[:, None, None] / h
level = np.float32(2.0) ** (5.0 - 14.0 * y)
rgb = (hue[None, :, :] * level).astype(np.float32)
rng = np.random.default_rng(4)
band = slice(int(0.86 * h), int(0.94 * h))
rgb[band] = np.clip(0.004 + rng.normal(0, 0.002, rgb[band].shape), 0, None)
tifffile.imwrite(sys.argv[1], rgb, photometric="rgb")
`;
  execFileSync(python, ["-c", script, target]);
  return target;
}

const inputIndex = process.argv.indexOf("--input");
const inputPath = inputIndex >= 0 ? path.resolve(process.argv[inputIndex + 1]) : null;

(async () => {
  const fixturePath = inputPath || writeFixture();
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // preview-raw is an SDR byte surface; pin the canvas to standard range so
  // the comparison is between two encodings of the same thing.
  await page.addInitScript(() => {
    const inherited = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = inherited(query);
      if (query !== "(dynamic-range: high)") return result;
      return new Proxy(result, {
        get(target, property) {
          if (property === "matches") return false;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
  });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => state.gpuPreview?.detail !== "WebGPU has not been initialized");
    if (!await page.evaluate(() => state.gpuPreview?.available)) throw new Error(`WebGPU is unavailable: ${await page.evaluate(() => state.gpuPreview?.detail)}`);
    const sessionResponse = await page.request.post(`${baseUrl}/api/session`, {
      multipart: { file: { name: path.basename(fixturePath), mimeType: "application/octet-stream", buffer: fs.readFileSync(fixturePath) } },
    });
    if (!sessionResponse.ok()) throw new Error(`Fixture session failed with HTTP ${sessionResponse.status()}.`);
    const { session } = await sessionResponse.json();
    await page.evaluate((loadedSession) => activateDesktopSession(loadedSession, ""), session);

    // A settle or refinement pass left from the previous case can repaint the
    // canvas at its bootstrap size between the render and the capture; the
    // size check catches that, and the case is taken again.
    const compare = async (...args) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await compareOnce(...args);
        if (!String(result.error || "").includes(" vs CPU ")) return result;
      }
      return compareOnce(...args);
    };
    const compareOnce = async (lane, on, sliders, film) => page.evaluate(async ({ lane, on, sliders, film, longEdge }) => {
      if (state.currentView !== lane) await switchLane(lane);
      state.previewScheduler?.cancel();
      while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
      const branch = state.adjustments[lane];
      branch.black_and_white_section_enabled = on;
      branch.black_and_white = { reds: 0, oranges: 0, yellows: 0, greens: 0, aquas: 0, blues: 0, purples: 0, magentas: 0, ...sliders };
      Object.assign(branch.film_look, film
        ? { halation_amount: 60, halation_saturation: 100, red_response: 50, blue_response: -50 }
        : { halation_amount: 0, red_response: 0, blue_response: 0 });
      branch.film_look.grain_amount = 0;
      // Direct recipe mutations still need the ordinary save and automatic
      // anchor settlement; otherwise SDR is captured under the previous recipe.
      state.globalEditDirty = true;
      if (!await syncGlobalEditState()) throw Error('Recipe sync failed');
      invalidatePreview(lane);
      await settlePreview(lane, {});
      while (pendingHighlightAnchors.size || exactHighlightAnchorInflight.size)
        await new Promise(resolve => setTimeout(resolve, 20));
      state.previewScheduler?.cancel();
      while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
      if (!await renderGpuDraft(lane, { longEdge })) return { error: "GPU render failed" };
      await state.gpuPreview.device.queue.onSubmittedWorkDone();
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = reject;
        element.src = els.previewCanvas.toDataURL("image/png");
      });
      const surface = document.createElement("canvas");
      surface.width = els.previewCanvas.width;
      surface.height = els.previewCanvas.height;
      surface.getContext("2d").drawImage(image, 0, 0);
      const gpu = surface.getContext("2d").getImageData(0, 0, surface.width, surface.height).data;
      const response = await fetch(`/api/session/${state.session.session_id}/preview-raw/${lane}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustments: state.adjustments, local_adjustments: [], long_edge: longEdge, hdr_display: false }),
      });
      if (!response.ok) return { error: `CPU reference failed with HTTP ${response.status}` };
      const cpu = new Uint8ClampedArray(await response.arrayBuffer());
      const size = [surface.width, surface.height, Number(response.headers.get("X-Image-Width")), Number(response.headers.get("X-Image-Height"))];
      if (size[0] !== size[2] || size[1] !== size[3]) return { error: `GPU ${size[0]}x${size[1]} vs CPU ${size[2]}x${size[3]}` };
      const differences = [];
      let spread = 0;
      for (let index = 0; index < cpu.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) differences.push(Math.abs(gpu[index + channel] - cpu[index + channel]));
        spread = Math.max(spread, Math.max(gpu[index], gpu[index + 1], gpu[index + 2]) - Math.min(gpu[index], gpu[index + 1], gpu[index + 2]));
      }
      return { size, differences, spread };
    }, { lane, on, sliders, film, longEdge: LONG_EDGE });

    const failures = [];
    const authored = await page.evaluate(() => Boolean(state.adjustments.sdr.use_authored_base));
    console.log(`SDR path: ${authored ? "authored reference" : "scene-linear"}`);
    for (const lane of ["hdr", "sdr"]) {
      for (const film of [false, true]) {
        const off = await compare(lane, false, {}, film);
        if (off.error) throw new Error(`${lane} off: ${off.error}`);
        for (const { label, sliders } of CASES) {
          const on = await compare(lane, true, sliders, film);
          if (on.error) throw new Error(`${lane} ${label}: ${on.error}`);
          const added = on.differences.map((value, index) => Math.max(0, value - off.differences[index]) / 255);
          const mean = added.reduce((sum, value) => sum + value, 0) / added.length;
          const sorted = [...added].sort((left, right) => left - right);
          const p999 = sorted[Math.floor(sorted.length * 0.999)];
          const passed = mean <= MAX_MEAN_DIFFERENCE && p999 <= MAX_P999_DIFFERENCE && on.spread <= MAX_CHANNEL_SPREAD;
          if (!passed) failures.push({ lane, film, label, mean: mean * 255, p999: p999 * 255, spread: on.spread });
          console.log(
            `${lane} ${film ? "+film" : "     "} ${label.padEnd(16)} ${on.size[0]}x${on.size[1]}  `
            + `added GPU/CPU difference: mean ${(mean * 255).toFixed(3)} levels, p99.9 ${(p999 * 255).toFixed(1)}  `
            + `grey spread ${on.spread}  ${passed ? "PASS" : "FAIL"}`,
          );
        }
      }
    }
    if (failures.length && inputPath) {
      console.log(`Report only for --input: ${failures.length} case(s) above the synthetic-fixture tolerance.`);
      return;
    }
    if (failures.length) throw new Error(`Black & White preview and export disagree: ${JSON.stringify(failures)}`);
    console.log("Black & White matches between the WebGPU preview and the CPU export, and is grey.");
  } finally {
    await browser.close();
    if (!inputPath) fs.rmSync(path.dirname(fixturePath), { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
