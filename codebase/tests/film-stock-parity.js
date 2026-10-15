// Film stock: the WebGPU preview matches the CPU export.
//
// A generated picture with every hue across it and brightness from deep
// shadow to HDR highlights down it, rendered through both renderers in each
// rendition. As in bw-parity.js, the measure is what the film stock adds to
// their disagreement: the difference with the stock on, less the difference
// with it off (the rest of the graph's own GPU/CPU gap).
//
//   node tests/run-in-electron.js tests/film-stock-parity.js [--input photo.heic]
//
// --input runs the same cases on a real file instead, and reports rather than
// fails.

const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const LONG_EDGE = 1200;
const MAX_MEAN_DIFFERENCE = 0.1 / 255;
const MAX_P999_DIFFERENCE = 2 / 255;

const NEUTRAL = {
  film_stock: "none", stock_color: 100, stock_tone: 100, stock_exposure: 0, stock_separation: 0,
  stock_print_warmth: 0, stock_print_tint: 0, stock_preflash: 0,
};
const EFFECTS = { grain_amount: 60, grain_size: 80, grain_film_format: "super16", grain_chroma: 40,
  halation_amount: 45, halation_radius: 0.7, bloom_amount: 35, bloom_radius: 1.2,
  bloom_highlight_detail: 30, film_resolution: 50 };
const CASES = [
  { label: "Portra density grain", stock: { film_stock: "kodak_portra_400", grain_amount: 80, grain_film_format: "super8" } },
  { label: "Portra lens", stock: { film_stock: "kodak_portra_400", bloom_amount: 55, bloom_highlight_detail: 0 } },
  { label: "Portra scatter", stock: { film_stock: "kodak_portra_400", film_resolution: 0 } },
  { label: "Portra halation", stock: { film_stock: "kodak_portra_400", halation_amount: 70 } },
  { label: "Portra physical chain", stock: { film_stock: "kodak_portra_400", ...EFFECTS } },
  { label: "Velvia physical chain", stock: { film_stock: "fujifilm_velvia_100", ...EFFECTS } },
  { label: "Portra half chain", stock: { film_stock: "kodak_portra_400", ...EFFECTS }, look_strength: 50 },
  { label: "C200 full", stock: { film_stock: "fujifilm_c200" } },
  { label: "Vision3 500T full", stock: { film_stock: "kodak_vision3_500t" } },
  { label: "Velvia 100 full", stock: { film_stock: "fujifilm_velvia_100" } },
  { label: "Velvia sliders", stock: { film_stock: "fujifilm_velvia_100", stock_exposure: 0.7, stock_separation: 40 } },
  { label: "Portra 400 full", stock: { film_stock: "kodak_portra_400" } },
  { label: "Portra 400 color", stock: { film_stock: "kodak_portra_400", stock_tone: 0 } },
  { label: "Portra 400 tone", stock: { film_stock: "kodak_portra_400", stock_color: 0 } },
  {
    label: "Portra 400 sliders",
    stock: { film_stock: "kodak_portra_400", stock_exposure: 0.7, stock_separation: 40, stock_print_warmth: 50, stock_print_tint: -30, stock_preflash: 30 },
  },
  { label: "Pro 400H half look", stock: { film_stock: "fujifilm_pro_400h", stock_exposure: -0.5 }, look_strength: 50 },
];

function writeFixture() {
  const python = path.resolve(__dirname, "..", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "film-stock-parity-")), "stock_hues.tiff");
  const script = `
import numpy as np, tifffile, sys, colorsys
h, w = 800, 1200
x = np.arange(w) / w
hue = np.array([colorsys.hsv_to_rgb(v, 0.7, 1.0) for v in x], np.float32)
y = np.arange(h)[:, None, None] / h
level = np.float32(2.0) ** (4.0 - 12.0 * y)
rgb = (hue[None, :, :] * level).astype(np.float32)
rgb[:, :80] = level[:, :, :] * np.float32(0.8)
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
    const loaded = await page.evaluate(async (ids) => {
      await Promise.all(ids.map((id) => window.HDRFilmStocks.request(id)));
      return window.HDRFilmStocks.loadedIds();
    }, [...new Set(CASES.map((item) => item.stock.film_stock))]);
    console.log(`Stocks on the GPU: ${loaded.join(", ")}`);

    const compare = async (...args) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await compareOnce(...args);
        if (!String(result.error || "").includes(" vs CPU ")) return result;
      }
      return compareOnce(...args);
    };
    const compareOnce = async (lane, stock, lookStrength) => page.evaluate(async ({ lane, stock, lookStrength, longEdge }) => {
      if (state.currentView !== lane) await switchLane(lane);
      state.previewScheduler?.cancel();
      while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
      const branch = state.adjustments[lane];
      Object.assign(branch.film_look, { grain_amount: 0, halation_amount: 0, bloom_amount: 0, film_resolution: 100,
        grain_size: 50, grain_film_format: "35mm", grain_chroma: 40, halation_radius: 1.2,
        bloom_radius: 3, bloom_highlight_detail: 100, look_strength: lookStrength }, stock);
      state.globalEditDirty = true;
      if (!await syncGlobalEditState()) throw Error("Recipe sync failed");
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
      let raw = 0;
      for (let index = 0; index < cpu.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          const difference = Math.abs(gpu[index + channel] - cpu[index + channel]);
          differences.push(difference);
          raw = Math.max(raw, difference);
        }
      }
      return { size, differences, raw, slot: state.gpuPreview && window.HDRFilmStocks.slot(stock.film_stock) };
    }, { lane, stock, lookStrength, longEdge: LONG_EDGE });

    const failures = [];
    for (const lane of ["hdr", "sdr"]) {
      const off = await compare(lane, NEUTRAL, 100);
      if (off.error) throw new Error(`${lane} off: ${off.error}`);
      for (const { label, stock, look_strength: lookStrength = 100 } of CASES) {
        const on = await compare(lane, { ...NEUTRAL, ...stock }, lookStrength);
        if (on.error) throw new Error(`${lane} ${label}: ${on.error}`);
        if (!on.slot) throw new Error(`${lane} ${label}: the stock never reached the GPU`);
        const added = on.differences.map((value, index) => Math.max(0, value - off.differences[index]) / 255);
        const mean = added.reduce((sum, value) => sum + value, 0) / added.length;
        const sorted = [...added].sort((left, right) => left - right);
        const p999 = sorted[Math.floor(sorted.length * 0.999)];
        const maximum = sorted[sorted.length - 1];
        const passed = mean <= MAX_MEAN_DIFFERENCE && p999 <= MAX_P999_DIFFERENCE;
        if (!passed) failures.push({ lane, label, mean: mean * 255, p999: p999 * 255 });
        console.log(
          `${lane} ${label.padEnd(20)} ${on.size[0]}x${on.size[1]}  `
          + `added GPU/CPU difference: mean ${(mean * 255).toFixed(3)} levels, p99.9 ${(p999 * 255).toFixed(1)}, max ${(maximum * 255).toFixed(0)}  `
          + `(raw max ${on.raw}, off max ${off.raw})  ${passed ? "PASS" : "FAIL"}`,
        );
      }
    }
    if (failures.length && inputPath) {
      console.log(`Report only for --input: ${failures.length} case(s) above the synthetic-fixture tolerance.`);
      return;
    }
    if (failures.length) throw new Error(`Film stock preview and export disagree: ${JSON.stringify(failures)}`);
    console.log("Film stock matches between the WebGPU preview and the CPU export.");
  } finally {
    await browser.close();
    if (!inputPath) fs.rmSync(path.dirname(fixturePath), { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
