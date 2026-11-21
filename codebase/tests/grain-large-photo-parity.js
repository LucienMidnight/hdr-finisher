// Run with node tests/run-in-electron.js tests/grain-large-photo-parity.js.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { pythonExecutable } = require("../tools/lib/platform.cjs");

const ROOT = path.resolve(__dirname, "..");
const PHOTO = path.join(ROOT, "output/test-photos/DSC00636.ARW");
const methods = ["fine_grain", "clean_grain"];
const lanes = ["hdr", "sdr"];
const views = ["Fit", "110%"];
const cases = methods.flatMap(method => lanes.flatMap(lane => views.map(view => `${method}-${lane}-${view}`)));

async function openPhoto(page) {
  await page.addInitScript(() => {
    const match = window.matchMedia.bind(window);
    window.matchMedia = query => query === "(dynamic-range: high)" ? { matches: true } : match(query);
  });
  await page.goto(process.env.HDR_FINISHER_URL);
  await page.waitForFunction(() => state.gpuPreview?.available, null, { timeout: 25000 });
  await page.evaluate(async file => {
    state.gpuMemoryBudget = 2;
    state.gpuPreview.setMemoryBudget(2);
    // Use the reusable source without reading or modifying its saved grade.
    const saving = window.HDRGradeSaving;
    const { prepare, open } = saving;
    saving.prepare = async () => null;
    saving.open = async session => session;
    try {
      const selection = await desktop.grantSourcePath(file);
      await openStagedDesktopSource({ ...selection, rawImportSettings: {
        lens: { mode: "off" }, pixel_cleanup: { even_out_specks: true, speck_threshold: 2.5 },
      } });
    } finally {
      Object.assign(saving, { prepare, open });
    }
  }, PHOTO);
  await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 35000 });
  const source = await page.evaluate(() => ({ width: state.session.source.width, height: state.session.source.height }));
  assert.deepEqual(source, { width: 8660, height: 5784 });
}

async function installCapture(page) {
  await page.evaluate(() => {
    const renderer = state.gpuPreview;
    const render = renderer.renderTo;
    const active = { generation: 0, frame: null };
    window.largeGrainCapture = active;
    renderer.renderTo = function (canvas, session, lane, adjustments, sampler, longEdge, locals, revision, overlay, white, size, options) {
      if (options?.applicationGeneration === undefined || options.fineGrainUnderlayer || options.measureOnly) {
        return render.apply(this, arguments);
      }
      return render.call(this, canvas, session, lane, adjustments, sampler, longEdge, locals, revision, overlay, white, size, {
        ...options,
        onFrameSubmitted: (region, hdr) => {
          options.onFrameSubmitted?.(region, hdr);
          if (lane !== state.currentView || !state.denoise[lane].enabled
              || state.denoiseRuntime[lane].status !== "ready" || longEdge !== requiredProcessingLongEdge()) return;
          const source = canvas.getContext("webgpu").getCurrentTexture();
          const { width, height, format } = source;
          const old = active.frame?.texture;
          const texture = old?.width === width && old.height === height && old.format === format ? old
            : this.device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
          if (old !== texture) old?.destroy();
          const encoder = this.device.createCommandEncoder();
          encoder.copyTextureToTexture({ texture: source }, { texture }, { width, height });
          this.device.queue.submit([encoder.finish()]);
          active.frame = { lane, region, texture };
          active.generation++;
        },
      });
    };
  });
}

async function selectGrain(page, lane, method, useGpu) {
  await page.evaluate(async ({ lane, method, useGpu }) => {
    if (state.currentView !== lane) await switchLane(lane);
    if (state.denoise[lane].enabled) await setDenoiseEnabled(false);
    if (state.zoomMode !== "fit") document.querySelector("#zoom-fit").click();
    state.gpuPreview.enableGradeFineGrainGpu = useGpu;
    state.gpuPreview.enableGradeCleanGrainGpu = useGpu;
    await commitDenoiseControl("method", method);
    if (method !== "micro_grain") {
      await commitDenoiseControl("grain_evenness", 0.65);
      if (method === "clean_grain") await commitDenoiseControl("splotch_size", "small");
    }
    await setDenoiseEnabled(true);
  }, { lane, method, useGpu });
}

async function waitForFrame(page, lane, method, view, previous) {
  await page.waitForFunction(({ lane, method, view, previous }) => {
    const runtime = state.denoiseRuntime[lane];
    if (runtime.status === "error") throw Error(runtime.error);
    const capture = window.largeGrainCapture;
    const frame = capture.frame;
    return state.currentView === lane && state.acceptedPresentation?.exact && previewIdleNow()
      && state.acceptedPresentation.processedLongEdge === requiredProcessingLongEdge()
      && capture.generation > previous && frame?.lane === lane && Boolean(frame.region) === (view === "110%")
      && runtime.status === "ready" && state.gpuPreview.denoiseSourceSelector?.controls.method === method;
  }, { lane, method, view, previous }, { timeout: 40000 });
}

async function saveSamples(page, scratch, stem, lane, useGpu) {
  const sample = await page.evaluate(async () => {
    const { frame } = window.largeGrainCapture;
    const { texture, region } = frame;
    const { width, height, format } = texture;
    // Full-width strips span the horizontal chunk joins at Fit. Widely
    // spaced rows sample different detail and tones at each zoom.
    const rows = 24;
    const tops = [.15, .50, .85].map(fraction => Math.floor((height - rows) * fraction));
    const rowBytes = width * (format === "rgba16float" ? 8 : 4);
    const pitch = Math.ceil(rowBytes / 256) * 256;
    const device = state.gpuPreview.device;
    const buffer = device.createBuffer({ size: pitch * rows * tops.length, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = device.createCommandEncoder();
      tops.forEach((top, index) => encoder.copyTextureToBuffer({ texture, origin: { y: top } },
        { buffer, offset: index * pitch * rows, bytesPerRow: pitch, rowsPerImage: rows }, { width, height: rows }));
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(buffer.getMappedRange());
      const tight = new Uint8Array(rowBytes * rows * tops.length);
      for (let row = 0; row < rows * tops.length; row++) {
        tight.set(padded.subarray(row * pitch, row * pitch + rowBytes), row * rowBytes);
      }
      const grain = state.gpuPreview.denoiseSourceSelector.cache.grain;
      return { data: tight.toBase64(), meta: { width, height: rows * tops.length, format, region, tops },
        gpu: Boolean(grain?.gpu), cpu: Boolean(grain?.token), configuredBytes: state.gpuPreview.configuredGpuBudgetBytes() };
    } finally {
      buffer.destroy();
    }
  });
  assert.equal(sample.configuredBytes, 2 * 1024 ** 3, "Wrong graphics setting");
  assert.equal(sample.meta.format === "rgba16float", lane === "hdr", "Wrong finished presentation format");
  assert.equal(sample.gpu, useGpu, `${stem}: wrong Grain route`);
  assert.equal(sample.cpu, !useGpu, `${stem}: missing CPU prepared Grain token`);
  fs.writeFileSync(path.join(scratch, `${stem}.json`), JSON.stringify(sample.meta));
  fs.writeFileSync(path.join(scratch, `${stem}.rgba`), Buffer.from(sample.data, "base64"));
  console.log(JSON.stringify({ case: stem, route: useGpu ? "gpu" : "cpu", sampled_pixels: sample.meta.width * sample.meta.height }));
}

function compare(scratch) {
  execFileSync(pythonExecutable(), ["-c", `
import json
from pathlib import Path
import sys
import numpy as np
sys.path.insert(0, sys.argv[1])
from denoise_grade_comparison import capture, compare

def sampled_rows(meta):
    count = meta["height"] // len(meta["tops"])
    origin = meta["region"]["y"]
    return {origin + top + row: band * count + row
            for band, top in enumerate(meta["tops"]) for row in range(count)}


def shared_samples(first, cpu, second, gpu, case):
    assert first["format"] == second["format"], f"Capture format changed: {case}"
    a, b = first["region"], second["region"]
    if a is None or b is None:
        assert first == second, f"Fit capture geometry changed: {case}"
        return cpu, gpu
    assert all(a[key] == b[key] for key in ("frameWidth", "frameHeight")), case
    # Prepared CPU tiles and GPU tiles can cover different viewport padding.
    # Compare only sampled rows and columns with the same native coordinates.
    left = max(a["x"], b["x"])
    right = min(a["x"] + a["width"], b["x"] + b["width"])
    earlier, later = sampled_rows(first), sampled_rows(second)
    overlap = sorted(earlier.keys() & later.keys())
    assert len(overlap) >= 16 and right - left >= 512, f"Insufficient native sample overlap: {case}"
    return (cpu[[earlier[y] for y in overlap], left - a["x"]:right - a["x"]],
            gpu[[later[y] for y in overlap], left - b["x"]:right - b["x"]])


root = Path(sys.argv[2])
failures = []
for case in sys.argv[3:]:
    first, cpu = capture(root, case + "-cpu")
    second, gpu = capture(root, case + "-gpu")
    hdr = "-hdr-" in case
    cpu, gpu = shared_samples(first, cpu, second, gpu, case)
    assert np.isfinite(cpu).all() and np.isfinite(gpu).all(), f"Nonfinite finished pixels: {case}"
    alpha = 1 if hdr else 255
    assert np.all(cpu[..., 3] == alpha) and np.all(gpu[..., 3] == alpha), f"Missing finished pixels: {case}"
    result = compare(cpu, gpu, hdr, first["format"])
    passed = result["mean"] < 1 and result["p99"] < 3
    print(json.dumps({"case": case, "metric": "delta_e_itp" if hdr else "delta_e_2000", **result, "passed": passed}), flush=True)
    if not passed:
        failures.append(case)
assert not failures, "Finished Grain disagreement: " + ", ".join(failures)
`, path.join(__dirname, "helpers"), scratch, ...cases], { stdio: "inherit" });
}

async function checkMicroFit(page) {
  const marker = await page.evaluate(() => {
    const api = globalThis.HDRDiagnostics;
    const emit = api.event;
    window.largeGrainRefusals = [];
    api.event = function (area, event, fields, action) {
      if (event === "grain_gpu_refused" && fields?.route === "refused" && action?.id) {
        window.largeGrainRefusals.push({ reason: fields.reason, action: action.id });
      }
      return emit.apply(this, arguments);
    };
    return window.largeGrainCapture.generation;
  });
  await selectGrain(page, "hdr", "micro_grain", true);
  await page.waitForFunction(marker => {
    const grain = state.gpuPreview.denoiseSourceSelector?.cache?.grain;
    return (previewIdleNow() && state.acceptedPresentation?.exact && state.zoomMode === "fit"
      && window.largeGrainCapture.generation > marker && grain?.micro && grain.gpu)
      || window.largeGrainRefusals.length > 0;
  }, marker, { timeout: 40000 });
  const result = await page.evaluate(() => {
    const grain = state.gpuPreview.denoiseSourceSelector?.cache?.grain;
    return { gpu: Boolean(grain?.micro && grain.gpu && previewIdleNow() && state.acceptedPresentation?.exact),
      refusals: window.largeGrainRefusals };
  });
  const reasons = new Set(["source_too_large", "gpu_budget_exceeded", "gpu_request_too_large", "gpu_allocation_pressure",
    "gpu_validation_error", "transport_timeout", "device_lost", "unsupported_lens_correction", "unsupported_grain_source", "grain_gpu_error"]);
  assert.ok(result.gpu || result.refusals.some(({ reason }) => reasons.has(reason)), JSON.stringify(result));
  console.log(JSON.stringify({ case: "micro_grain-hdr-Fit", route: result.gpu ? "gpu" : "refused", ...result }));
}

(async () => {
  const start = Date.now();
  assert.ok(process.env.HDR_FINISHER_URL, "Run this driver through tests/run-in-electron.js");
  assert.ok(fs.existsSync(PHOTO), `Missing the reusable 50 MP Sony copy at ${PHOTO}`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-finisher-large-grain-"));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await openPhoto(page);
    await installCapture(page);
    for (const method of methods) {
      for (const useGpu of [true, false]) {
        for (const lane of lanes) {
          let marker = await page.evaluate(() => window.largeGrainCapture.generation);
          await selectGrain(page, lane, method, useGpu);
          for (const view of views) {
            if (view === "110%") {
              marker = await page.evaluate(() => {
                const generation = window.largeGrainCapture.generation;
                els.zoomReadout.value = "110%";
                commitZoomReadout();
                return generation;
              });
            }
            await waitForFrame(page, lane, method, view, marker);
            await saveSamples(page, scratch, `${method}-${lane}-${view}-${useGpu ? "gpu" : "cpu"}`, lane, useGpu);
          }
        }
      }
    }
    await checkMicroFit(page);
    compare(scratch);
  } finally {
    try {
      await browser?.close();
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      console.log(JSON.stringify({ duration_ms: Date.now() - start }));
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
