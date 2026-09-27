// Film grain: the WebGPU preview matches the CPU export.
//
// The shader gathers the grains around each pixel; film_grain.py splats each
// grain onto its pixels. Both hash the same cells in u32, draw the same grain
// counts, positions, radii and sensitivities, and normalise by the same
// closed-form statistics, so they should differ only by float rounding. This
// renders one picture through both and asks how much grain adds to their
// disagreement: the difference with grain on, less the difference with grain
// off, which is the rest of the graph's own GPU/CPU gap. The grain view map
// isolates the field on a grey card, where nothing else can hide a drift.
//
// Cases cover both film types, both lanes, sub-pixel grain (clamped to one
// pixel) and grain several pixels across.
//
//   node tests/run-in-electron.js tests/grain-parity.js
//   HDR_FINISHER_URL=http://127.0.0.1:8000 node tests/grain-parity.js

const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const LONG_EDGE = 1200;
// In 0..1 of an 8-bit channel. Grain at Amount 100 moves pixels by tens of
// levels. Measured 2026-09-26: 0.02-0.07 levels mean and at most 1 level
// anywhere, across both film types and lanes.
const MAX_GRAIN_MEAN_DIFFERENCE = 0.1 / 255;
const MAX_GRAIN_P999_DIFFERENCE = 2 / 255;

const CASES = [
  { lane: "sdr", film_type: "color_negative", format: "35mm", size: 50, chroma: 40, map: false },
  { lane: "sdr", film_type: "color_negative", format: "super8", size: 60, chroma: 40, map: false },
  { lane: "sdr", film_type: "color_negative", format: "super16", size: 100, chroma: 0, map: true },
  { lane: "hdr", film_type: "color_negative", format: "super8", size: 60, chroma: 40, map: false },
  { lane: "sdr", film_type: "black_and_white", format: "super8", size: 60, chroma: 40, map: false },
  { lane: "hdr", film_type: "black_and_white", format: "super16", size: 100, chroma: 0, map: true },
];

function writeFixture() {
  const python = path.resolve(__dirname, "..", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "grain-parity-")), "grain_tones.tiff");
  // Every tone from deep shadow to highlight, with a band of saturated colour
  // so each dye layer develops differently.
  const script = `
import numpy as np, tifffile, sys
h, w = 800, 1200
y, x = np.mgrid[:h, :w].astype(np.float32)
luma = 0.002 * np.power(1500.0, x / w)
rgb = np.stack([luma, luma, luma], axis=-1)
band = (y > 0.5 * h) & (y < 0.75 * h)
rgb[band] *= np.array([1.6, 0.7, 0.35], dtype=np.float32)
tifffile.imwrite(sys.argv[1], rgb.astype(np.float32), photometric="rgb")
`;
  execFileSync(python, ["-c", script, target]);
  return target;
}

(async () => {
  const fixturePath = writeFixture();
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
    if (!await page.evaluate(() => state.gpuPreview?.available)) throw new Error("WebGPU is unavailable");
    const sessionResponse = await page.request.post(`${baseUrl}/api/session`, {
      multipart: {
        file: { name: "grain_tones.tiff", mimeType: "image/tiff", buffer: fs.readFileSync(fixturePath) },
      },
    });
    if (!sessionResponse.ok()) throw new Error(`Fixture session failed with HTTP ${sessionResponse.status()}.`);
    const { session } = await sessionResponse.json();
    await page.evaluate((loadedSession) => activateDesktopSession(loadedSession, ""), session);

    // The app's own startup and settle passes can repaint the canvas at its
    // own preview size between this render and the capture; they are stood
    // down first, and a size mismatch is taken again rather than failed.
    const compare = async (...args) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await compareOnce(...args);
        if (!String(result.error || "").includes(" vs CPU ")) return result;
      }
      return compareOnce(...args);
    };
    const compareOnce = async (testCase, amount) => page.evaluate(async ({ testCase, amount, longEdge }) => {
      state.previewScheduler?.cancel();
      while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
      const lane = testCase.lane;
      state.adjustments[lane].film_look_section_enabled = true;
      Object.assign(state.adjustments[lane].film_look, {
        grain_enabled: true,
        grain_amount: amount,
        grain_size: testCase.size,
        grain_chroma: testCase.chroma,
        grain_film_format: testCase.format,
        grain_film_type: testCase.film_type,
        grain_view_map: testCase.map && amount > 0,
      });
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
      for (let index = 0; index < cpu.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) differences.push(Math.abs(gpu[index + channel] - cpu[index + channel]));
      }
      return { size, differences };
    }, { testCase, amount, longEdge: LONG_EDGE });

    const failures = [];
    for (const testCase of CASES) {
      await page.evaluate((lane) => switchLane(lane), testCase.lane);
      const neutral = await compare(testCase, 0);
      if (neutral.error) throw new Error(neutral.error);
      const grained = await compare(testCase, 100);
      if (grained.error) throw new Error(`${JSON.stringify(testCase)}: ${grained.error}`);
      // A map replaces the picture, so the neutral picture is no baseline for it.
      const added = grained.differences.map((value, index) => (
        testCase.map ? value : Math.max(0, value - neutral.differences[index])
      ) / 255);
      const mean = added.reduce((sum, value) => sum + value, 0) / added.length;
      const sorted = [...added].sort((left, right) => left - right);
      const p999 = sorted[Math.floor(sorted.length * 0.999)];
      const max = sorted[sorted.length - 1];
      const passed = mean <= MAX_GRAIN_MEAN_DIFFERENCE && p999 <= MAX_GRAIN_P999_DIFFERENCE;
      if (!passed) failures.push({ ...testCase, mean, p999 });
      const label = `${testCase.lane} ${testCase.film_type} ${testCase.format} size ${testCase.size}${testCase.map ? " map" : ""}`;
      console.log(
        `${label.padEnd(48)} ${grained.size[0]}x${grained.size[1]}  `
        + `added GPU/CPU difference: mean ${(mean * 255).toFixed(3)} levels, p99.9 ${(p999 * 255).toFixed(1)}, max ${(max * 255).toFixed(0)}  `
        + `${passed ? "PASS" : "FAIL"}`,
      );
    }
    if (failures.length) throw new Error(`Grain preview and export disagree: ${JSON.stringify(failures)}`);
    console.log("Film grain matches between the WebGPU preview and the CPU export.");
  } finally {
    await browser.close();
    fs.rmSync(path.dirname(fixturePath), { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
