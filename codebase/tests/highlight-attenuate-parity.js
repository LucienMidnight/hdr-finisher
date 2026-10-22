// Highlight Compression "Attenuate (AgX-style)" prototype: the WebGPU preview
// matches the CPU export.
//
// A generated picture with every hue across it and brightness from deep
// shadow to strong HDR highlights down it, rendered by both renderers in each
// rendition with Peak Fit on. As in lens-filter-parity.js, the measure is what
// Attenuate adds to their disagreement: the difference with Attenuate, less
// the difference with Smooth color rolloff (the graph's own GPU/CPU gap).
//
//   node tests/run-in-electron.js tests/highlight-attenuate-parity.js

const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const LONG_EDGE = 1520;
const MAX_MEAN_DIFFERENCE = 0.1 / 255;
const MAX_P999_DIFFERENCE = 2 / 255;
const CASES = [[0, 35], [20, 35], [40, 35], [90, 35], [20, 100], [90, 100]]
  .map(([attenuation, detail]) => ({ label: `attenuation ${attenuation}% detail ${detail}%`, attenuation, detail }));

function writeFixture() {
  const python = path.resolve(__dirname, "..", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "attenuate-parity-")), "attenuate_hues.tiff");
  const script = `
import numpy as np, tifffile, sys, colorsys
h, w = 1600, 2400
x = np.arange(w) / w
hue = np.array([colorsys.hsv_to_rgb(v, 0.75, 1.0) for v in x], np.float32)
y = np.arange(h)[:, None, None] / h
level = np.float32(2.0) ** (6.0 - 12.0 * y)
rgb = (hue[None, :, :] * level).astype(np.float32)
rgb[:, :160] = level[:, :, :] * np.float32(0.8)
tifffile.imwrite(sys.argv[1], rgb, photometric="rgb")
`;
  execFileSync(python, ["-c", script, target]);
  return target;
}

(async () => {
  const fixturePath = writeFixture();
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // preview-raw is an SDR byte surface; pin the canvas to standard range.
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

    const compare = (lane, colorHandling, attenuation, detail = 35) => page.evaluate(async ({ lane, colorHandling, attenuation, detail, longEdge }) => {
      if (state.currentView !== lane) await switchLane(lane);
      state.previewScheduler?.cancel();
      while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
      const branch = state.adjustments[lane];
      Object.assign(branch, {
        highlight_section_enabled: true, highlight_compression_mode: "peak_fit",
        highlight_compression_peak_measurement: "maximum",
        highlight_compression_color_handling: colorHandling,
        highlight_compression_attenuation: attenuation,
        highlight_compression_peak_detail: detail,
        film_look_section_enabled: false,
      });
      if (lane === "hdr") Object.assign(branch, { highlight_compression_start_nits: 400, highlight_compression_target_nits: 1000 });
      state.globalEditDirty = true;
      if (!await syncGlobalEditState()) throw Error("Recipe sync failed");
      invalidatePreview(lane);
      await settlePreview(lane, {});
      while (pendingHighlightAnchors.size || exactHighlightAnchorInflight.size)
        await new Promise((resolve) => setTimeout(resolve, 20));
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
      const isBaseline = colorHandling === "smooth_rolloff";
      const count = cpu.length / 4 * 3;
      const baseline = isBaseline ? new Uint8Array(count) : window.__attenuateBaseline;
      if (!baseline || baseline.length !== count) throw Error("Missing matching baseline");
      const histogram = new Uint32Array(256);
      let sum = 0, raw = 0, maximum = 0, sample = 0;
      for (let pixel = 0; pixel < cpu.length; pixel += 4) {
        for (let channel = 0; channel < 3; channel++, sample++) {
          const difference = Math.abs(gpu[pixel + channel] - cpu[pixel + channel]);
          if (isBaseline) baseline[sample] = difference;
          const added = isBaseline ? 0 : Math.max(0, difference - baseline[sample]);
          histogram[added]++; sum += added; maximum = Math.max(maximum, added); raw = Math.max(raw, difference);
        }
      }
      if (isBaseline) window.__attenuateBaseline = baseline;
      let cumulative = 0, p999 = 0;
      for (let level = 0; level < 256; level++) { cumulative += histogram[level]; if (cumulative > Math.floor(count * 0.999)) { p999 = level; break; } }
      return { size, mean: sum / count, p999, maximum, raw };
    }, { lane, colorHandling, attenuation, detail, longEdge: LONG_EDGE });

    const failures = [];
    for (const lane of ["hdr", "sdr"]) {
      for (const { label, attenuation, detail } of CASES) {
        // Baseline at the same Detail, so the measure is what Attenuate adds.
        const off = await compare(lane, "smooth_rolloff", 20, detail);
        if (off.error) throw new Error(`${lane} baseline: ${off.error}`);
        const on = await compare(lane, "agx_attenuate", attenuation, detail);
        if (on.error) throw new Error(`${lane} ${label}: ${on.error}`);
        const passed = on.mean / 255 <= MAX_MEAN_DIFFERENCE && on.p999 / 255 <= MAX_P999_DIFFERENCE;
        if (!passed) failures.push({ lane, label, mean: on.mean, p999: on.p999 });
        console.log(`${lane} ${label.padEnd(30)} ${on.size[0]}x${on.size[1]}  added GPU/CPU difference: mean ${on.mean.toFixed(3)} levels, `
          + `p99.9 ${on.p999}, max ${on.maximum}  (raw max ${on.raw}, smooth max ${off.raw})  ${passed ? "PASS" : "FAIL"}`);
      }
    }
    if (failures.length) throw new Error(`Attenuate preview and export disagree: ${JSON.stringify(failures)}`);
    console.log("Attenuate matches between the WebGPU preview and the CPU export.");
  } finally {
    await browser.close();
    fs.rmSync(path.dirname(fixturePath), { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
