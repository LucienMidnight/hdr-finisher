// P6 (Preview Responsiveness Tuning Sprint): GPU load while dragging.
//
//   node tests/run-in-electron.js tests/performance/drag-gpu-load.js [--seconds 5]
//        [--zooms fit,200] [--output path] [--no-assert]
//
// A scripted continuous Exposure drag on the 42.4 MP fixture (Precise, the
// full-detail default), at Fit and 200%. Measured independently of the code
// under test:
//   - display refresh rate (requestAnimationFrame interval),
//   - presented frames per second (the app's preview-presented events),
//   - GPU frames in flight: every queue submit is counted up and counted down
//     when onSubmittedWorkDone resolves; the maximum is sampled at each submit,
//   - GPU busy time per second: the renderer's own timestamp-query gpuMs for
//     the renders in the window (the adapter supports timestamp queries),
//   - coarse frames shown (must be 0 by default).
// Targets (PRD P6/P5): presented fps <= 60 x 1.05, frames in flight <= 1,
// and presented fps >= 30 (never below 20 in any one-second window).

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

// Whole-card utilisation and power while dragging, sampled by the driver
// (what the owner reads in Task Manager or nvidia-smi, and what drives fan
// noise). Absent on a machine without nvidia-smi; reported as null.
function startGpuSampler() {
  const samples = [];
  let child = null;
  try {
    child = spawn("nvidia-smi", ["--query-gpu=utilization.gpu,power.draw", "--format=csv,noheader,nounits", "-lms", "100"], { windowsHide: true });
    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const [utilization, power] = line.split(",").map((value) => Number(value.trim()));
        if (Number.isFinite(utilization)) samples.push({ utilization, power });
      }
    });
    child.on("error", () => {});
  } catch { child = null; }
  return {
    stop() {
      try { child?.kill(); } catch { /* gone */ }
      if (!samples.length) return { utilizationPct: null, powerW: null, samples: 0 };
      const mean = (key) => Number((samples.reduce((sum, entry) => sum + (entry[key] || 0), 0) / samples.length).toFixed(1));
      return { utilizationPct: mean("utilization"), powerW: mean("power"), samples: samples.length };
    },
  };
}
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799");
const outputPath = path.resolve(option("--output", "output/performance/drag-gpu-load.json"));
const seconds = Math.max(1, Number(option("--seconds", "5")));
const zooms = option("--zooms", "fit,200").split(",");
const enforce = !args.includes("--no-assert");
const CAP_FPS = 60;

async function idle(page) {
  await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 300000 });
  await page.waitForTimeout(800);
}

async function measureDrag(page, zoom) {
  await page.evaluate((value) => (value === "fit" ? setZoomMode("fit") : setCustomZoom(Number(value))), zoom);
  await idle(page);
  const control = page.locator('[data-path="hdr.exposure"]').first();
  const box = await control.boundingBox();
  const x0 = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.5;
  const idleSampler = startGpuSampler();
  await page.waitForTimeout(2000);
  const idleGpu = idleSampler.stop();
  await page.evaluate(() => window.__dragProbe.start());
  const sampler = startGpuSampler();
  await page.mouse.move(x0, y);
  await page.mouse.down();
  // A real mouse reports up to 1000 times a second; a Playwright move is a
  // round trip of several milliseconds, which would cap the drag at the
  // driver's own speed. So the pointer is moved from inside the page, on a
  // 1 ms timer, through the same pointer events the slider listens to.
  await page.evaluate(({ x0, y, width, seconds }) => new Promise((resolve) => {
    const control = document.querySelector('[data-path="hdr.exposure"]');
    const started = performance.now();
    const timer = setInterval(() => {
      const elapsed = performance.now() - started;
      if (elapsed >= seconds * 1000) {
        clearInterval(timer);
        resolve();
        return;
      }
      const offset = Math.sin((elapsed / 800) * Math.PI * 2) * width * 0.18;
      const init = { bubbles: true, cancelable: true, clientX: x0 + offset, clientY: y, pointerId: 1, pointerType: "mouse", buttons: 1, isPrimary: true };
      control.dispatchEvent(new PointerEvent("pointermove", init));
      window.dispatchEvent(new PointerEvent("pointermove", init));
    }, 1);
  }), { x0, y, width: box.width, seconds });
  await page.mouse.up();
  const gpu = sampler.stop();
  const result = await page.evaluate(() => window.__dragProbe.stop());
  await idle(page);
  return { zoom, ...result, card: gpu, cardIdle: idleGpu };
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const failures = [];
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", ensureLargeNoisySource(7968, 5320));
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available === true, null, { timeout: 900000 });
    await idle(page);
    await page.evaluate(() => {
      const select = document.getElementById("preview-latency");
      if (select) {
        select.value = "precise";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      activateWorkflowTab("grade");
      const toggle = document.querySelector('section[data-group="hdr-tone"] .group-toggle');
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);

      const preview = state.gpuPreview;
      const queue = preview.device.queue;
      const submit = queue.submit.bind(queue);
      const probe = {
        active: false, inFlight: 0, maxInFlight: 0, submits: 0,
        presented: [], coarse: 0, rafIntervals: [], lastRaf: null, raf: null,
        start() {
          this.active = true; this.inFlight = 0; this.maxInFlight = 0; this.submits = 0;
          this.presented = []; this.coarse = 0; this.rafIntervals = []; this.lastRaf = null;
          this.startedAt = performance.now();
          if (preview.performanceMetrics) preview.performanceMetrics.renders = [];
          const tick = (time) => {
            if (!this.active) return;
            if (this.lastRaf !== null) this.rafIntervals.push(time - this.lastRaf);
            this.lastRaf = time;
            this.raf = requestAnimationFrame(tick);
          };
          this.raf = requestAnimationFrame(tick);
        },
        async stop() {
          this.active = false;
          cancelAnimationFrame(this.raf);
          const endedAt = performance.now();
          await queue.onSubmittedWorkDone();
          await new Promise((resolve) => setTimeout(resolve, 200));
          const duration = (endedAt - this.startedAt) / 1000;
          const inWindow = this.presented.filter((t) => t <= endedAt);
          const perSecond = [];
          for (let second = 0; second < Math.floor(duration); second += 1) {
            const from = this.startedAt + second * 1000;
            perSecond.push(inWindow.filter((t) => t >= from && t < from + 1000).length);
          }
          const renders = (preview.performanceMetrics?.renders || []);
          const gpuMs = renders.map((entry) => entry.gpuMs).filter(Number.isFinite);
          const sortedRaf = [...this.rafIntervals].sort((a, b) => a - b);
          return {
            durationS: Number(duration.toFixed(2)),
            refreshHz: sortedRaf.length ? Number((1000 / sortedRaf[Math.floor(sortedRaf.length / 2)]).toFixed(1)) : null,
            presentedFps: Number((inWindow.length / duration).toFixed(1)),
            worstSecondFps: perSecond.length ? Math.min(...perSecond) : null,
            perSecondFps: perSecond,
            coarseFrames: this.coarse,
            submits: this.submits,
            maxFramesInFlight: this.maxInFlight,
            gpuBusyMsPerS: gpuMs.length ? Number((gpuMs.reduce((sum, value) => sum + value, 0) / duration).toFixed(1)) : null,
            gpuMsSamples: gpuMs.length,
          };
        },
      };
      queue.submit = (buffers) => {
        const result = submit(buffers);
        if (probe.active) {
          probe.submits += 1;
          probe.inFlight += 1;
          probe.maxInFlight = Math.max(probe.maxInFlight, probe.inFlight);
          queue.onSubmittedWorkDone().then(() => { probe.inFlight = Math.max(0, probe.inFlight - 1); });
        }
        return result;
      };
      window.addEventListener("hdrfinisher:preview-presented", () => {
        if (!probe.active) return;
        probe.presented.push(performance.now());
        if (state.acceptedPresentation?.coarse) probe.coarse += 1;
      });
      window.__dragProbe = probe;
    });

    const rows = [];
    for (const zoom of zooms) rows.push(await measureDrag(page, zoom));
    for (const row of rows) {
      console.log(`${String(row.zoom).padEnd(4)} refresh ${row.refreshHz} Hz  presented ${row.presentedFps} fps (worst second ${row.worstSecondFps})  in flight max ${row.maxFramesInFlight}  submits ${row.submits}  GPU busy ${row.gpuBusyMsPerS} ms/s  card ${row.card.utilizationPct}% ${row.card.powerW} W (idle ${row.cardIdle.utilizationPct}% ${row.cardIdle.powerW} W)  coarse ${row.coarseFrames}`);
      if (enforce) {
        if (row.presentedFps > CAP_FPS * 1.05) failures.push(`${row.zoom}: ${row.presentedFps} fps is above the ${CAP_FPS} fps cap`);
        if (row.maxFramesInFlight > 1) failures.push(`${row.zoom}: ${row.maxFramesInFlight} GPU frames in flight`);
        if (row.presentedFps < 30 || (row.worstSecondFps ?? 0) < 20) failures.push(`${row.zoom}: below the frame-rate floor (${row.presentedFps} fps, worst second ${row.worstSecondFps})`);
        if (row.coarseFrames > 0) failures.push(`${row.zoom}: ${row.coarseFrames} coarse frames shown`);
      }
    }
    const report = { recordedAt: new Date().toISOString(), seconds, capFps: CAP_FPS, rows, failures, pageErrors };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join("; ")}`);
    if (failures.length) throw new Error(`Drag GPU load failed:\n  ${failures.join("\n  ")}`);
    console.log("Drag GPU load test passed.");
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
