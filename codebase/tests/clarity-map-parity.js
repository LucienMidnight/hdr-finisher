// Clarity's brightness map: the WebGPU preview matches the CPU export.
//
// Clarity's blurred base is built on a brightness pyramid in both renderers
// (graph-scale.js `clarityMapPlan`, detail.py `clarity_base`). This renders
// one picture with the same grade through both and asks how much Clarity adds
// to their disagreement: the difference with Clarity at +100, less the
// difference with Clarity off, which is the rest of the graph's own GPU/CPU
// gap. It runs at the slider's minimum, default and maximum radius, so the
// full-resolution map, the base map and the averaged-up map are all covered.
//
// The picture is generated here: a smooth sky gradient crossed by a hard
// dark roof line, with fine texture below it -- the case where the old
// sparse sampling drew contour bands.
//
//   node tests/run-in-electron.js tests/clarity-map-parity.js

const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const LONG_EDGE = 1200;
const RADII = [0.2, 0.75, 3.0];
// In 0..1 of an 8-bit channel. Clarity at +100 moves edges by tens of levels;
// the renderers agree on it to a fraction of one. Measured 2026-09-26: 0.02-0.04
// levels mean and 1 level at p99.9. The sparse-tap preview against the old
// box-blur export measured 0.07-0.24 mean and 3-4 at p99.9, and fails here.
const MAX_CLARITY_MEAN_DIFFERENCE = 0.06 / 255;
const MAX_CLARITY_P999_DIFFERENCE = 2 / 255;

function writeFixture() {
  const python = path.resolve(__dirname, "..", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clarity-parity-")), "clarity_edges.tiff");
  const script = `
import numpy as np, tifffile, sys
h, w = 800, 1200
y, x = np.mgrid[:h, :w].astype(np.float32)
sky = 0.35 + 0.9 * (1 - y / h) + 0.15 * (x / w)
roof = (y > 0.55 * h + 0.35 * (x - 0.3 * w)) & (x > 0.2 * w)
texture = 1 + 0.12 * np.sin(x * 0.9) * np.cos(y * 0.7)
luma = np.where(roof, 0.03 * texture, sky)
rgb = np.stack([luma * 0.95, luma, luma * 1.08], axis=-1).astype(np.float32)
tifffile.imwrite(sys.argv[1], rgb, photometric="rgb")
`;
  execFileSync(python, ["-c", script, target]);
  return target;
}

(async () => {
  const fixturePath = writeFixture();
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // preview-raw is an SDR byte surface; pin the canvas to standard range so
  // the comparison is between two encodings of the same thing (see
  // webgpu-shader-compilation.js).
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
        file: { name: "clarity_edges.tiff", mimeType: "image/tiff", buffer: fs.readFileSync(fixturePath) },
      },
    });
    if (!sessionResponse.ok()) throw new Error(`Fixture session failed with HTTP ${sessionResponse.status()}.`);
    const { session } = await sessionResponse.json();
    await page.evaluate((loadedSession) => activateDesktopSession(loadedSession, ""), session);

    const compare = async (detail) => page.evaluate(async ({ detail, longEdge }) => {
      Object.assign(state.adjustments.hdr.detail, {
        texture_amount: 0, clarity_amount: 0, clarity_radius_percent: 0.75,
        sharpen_amount: 0, sharpen_radius_px: 0.8, sharpen_threshold: 10,
      }, detail);
      if (!await renderGpuDraft("hdr", { longEdge })) return { error: "GPU render failed" };
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
      const response = await fetch(`/api/session/${state.session.session_id}/preview-raw/hdr`, {
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
    }, { detail, longEdge: LONG_EDGE });

    const neutral = await compare({});
    if (neutral.error) throw new Error(neutral.error);
    const failures = [];
    for (const radius of RADII) {
      const clarity = await compare({ clarity_amount: 100, clarity_radius_percent: radius });
      if (clarity.error) throw new Error(`${radius}%: ${clarity.error}`);
      // What Clarity adds, pixel by pixel, over the graph's own GPU/CPU gap.
      const added = clarity.differences.map((value, index) => Math.max(0, value - neutral.differences[index]) / 255);
      const mean = added.reduce((sum, value) => sum + value, 0) / added.length;
      const sorted = [...added].sort((left, right) => left - right);
      const p999 = sorted[Math.floor(sorted.length * 0.999)];
      const passed = mean <= MAX_CLARITY_MEAN_DIFFERENCE && p999 <= MAX_CLARITY_P999_DIFFERENCE;
      if (!passed) failures.push({ radius, mean, p999 });
      console.log(
        `clarity +100 at ${String(radius).padEnd(4)}%  ${clarity.size[0]}x${clarity.size[1]}  `
        + `added GPU/CPU difference: mean ${(mean * 255).toFixed(3)} levels, p99.9 ${(p999 * 255).toFixed(1)} levels  `
        + `${passed ? "PASS" : "FAIL"}`,
      );
    }
    if (failures.length) throw new Error(`Clarity preview and export disagree: ${JSON.stringify(failures)}`);
    console.log("Clarity's brightness map matches between the WebGPU preview and the CPU export.");
  } finally {
    await browser.close();
    fs.rmSync(path.dirname(fixturePath), { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
