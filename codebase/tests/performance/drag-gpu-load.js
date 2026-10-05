// P6 (Preview Responsiveness Tuning Sprint): GPU load while dragging.
//
//   node tests/run-in-electron.js tests/performance/drag-gpu-load.js [--seconds 5]
//        [--zooms fit,200] [--output path] [--no-assert] [--control exposure|denoise]
//
// --control denoise turns adaptive Denoise on and drags its Amount slider
// instead (NEXT-01 #4: Denoise drags heat the card). Rows then also report
// how many reconstructions ran per second.
//
// A scripted continuous Exposure drag on the 42.4 MP fixture (Precise, the
// full-detail default), at Fit and 200%. Measured independently of the code
// under test:
//   - display refresh rate (requestAnimationFrame interval),
//   - presented frames per second (the app's preview-presented events),
//   - viewer frames in flight: each outer viewer render is counted once for
//     its complete request lifetime; tiled and analysis submits are recorded
//     separately rather than being mistaken for additional whole frames,
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
const controlKind = option("--control", "exposure");
if (!["exposure", "denoise"].includes(controlKind)) throw new Error(`Unknown --control ${controlKind}`);
const CONTROL_SELECTOR = controlKind === "denoise" ? "#denoise-amount" : '[data-path="hdr.exposure"]';
const CAP_FPS = 60;

async function idle(page) {
  await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 300000 });
  await page.waitForTimeout(800);
}

async function measureDrag(page, zoom) {
  await page.evaluate((value) => (value === "fit" ? setZoomMode("fit") : setCustomZoom(Number(value))), zoom);
  await idle(page);
  const control = page.locator(CONTROL_SELECTOR).first();
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  const x0 = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.5;
  const idleSampler = startGpuSampler();
  await page.waitForTimeout(2000);
  const idleGpu = idleSampler.stop();
  await page.evaluate(() => window.__dragProbe.start());
  const denoiseRunsBefore = await page.evaluate(() => state.denoiseInputQueue?.stats?.started ?? 0);
  const sampler = startGpuSampler();
  await page.mouse.move(x0, y);
  await page.mouse.down();
  // A real mouse reports up to 1000 times a second; a Playwright move is a
  // round trip of several milliseconds, which would cap the drag at the
  // driver's own speed. So the pointer is moved from inside the page, on a
  // 1 ms timer, through the same pointer events the slider listens to.
  await page.evaluate(({ x0, y, width, seconds, selector, kind }) => new Promise((resolve) => {
    const control = document.querySelector(selector);
    if (kind === "denoise") control.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType: "mouse", buttons: 1, isPrimary: true }));
    const started = performance.now();
    const timer = setInterval(() => {
      const elapsed = performance.now() - started;
      if (elapsed >= seconds * 1000) {
        clearInterval(timer);
        resolve();
        return;
      }
      const offset = Math.sin((elapsed / 800) * Math.PI * 2) * width * 0.18;
      if (kind === "denoise") {
        // A native range input: the browser turns pointer moves into input
        // events, so the scripted drag sends those directly.
        const value = 0.5 + Math.sin((elapsed / 800) * Math.PI * 2) * 0.18;
        if (Math.abs(Number(control.value) - value) >= 0.005) {
          control.value = String(value);
          control.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      const init = { bubbles: true, cancelable: true, clientX: x0 + offset, clientY: y, pointerId: 1, pointerType: "mouse", buttons: 1, isPrimary: true };
      control.dispatchEvent(new PointerEvent("pointermove", init));
      window.dispatchEvent(new PointerEvent("pointermove", init));
    }, 1);
  }), { x0, y, width: box.width, seconds, selector: CONTROL_SELECTOR, kind: controlKind });
  await page.mouse.up();
  if (controlKind === "denoise") {
    await page.evaluate((selector) => {
      const control = document.querySelector(selector);
      control.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }, CONTROL_SELECTOR);
  }
  const gpu = sampler.stop();
  const releasedAt = Date.now();
  await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight && !state.denoiseInputQueue?.busy, null, { timeout: 300000 });
  const settleMs = Date.now() - releasedAt;
  const result = await page.evaluate(() => window.__dragProbe.stop());
  const denoiseRuns = (await page.evaluate(() => state.denoiseInputQueue?.stats?.started ?? 0)) - denoiseRunsBefore;
  await idle(page);
  return { zoom, control: controlKind, ...result, denoiseRunsPerS: Number((denoiseRuns / result.durationS).toFixed(1)), settleMs, card: gpu, cardIdle: idleGpu };
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
      // P5: full detail while dragging is the default; make sure the opt-in is off.
      const faster = document.getElementById("preview-faster-dragging");
      if (faster?.checked) {
        faster.checked = false;
        faster.dispatchEvent(new Event("change", { bubbles: true }));
      }
      activateWorkflowTab("grade");
      const toggle = document.querySelector('section[data-group="hdr-tone"] .group-toggle');
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);

      const preview = state.gpuPreview;
      const queue = preview.device.queue;
      const submit = queue.submit.bind(queue);
      const render = preview.render.bind(preview);
      const probe = {
        active: false, epoch: 0, inFlight: 0, maxInFlight: 0, frameStarts: 0,
        queueInFlight: 0, maxQueueInFlight: 0, submits: 0,
        presented: [], coarse: 0, rafIntervals: [], lastRaf: null, raf: null,
        start() {
          this.active = true; this.epoch += 1;
          this.inFlight = 0; this.maxInFlight = 0; this.frameStarts = 0;
          this.queueInFlight = 0; this.maxQueueInFlight = 0; this.submits = 0;
          this.presented = []; this.coarse = 0; this.rafIntervals = []; this.lastRaf = null;
          this.startedAt = performance.now();
          if (preview.performanceMetrics) {
            preview.performanceMetrics.renders = [];
            preview.performanceMetrics.stages = [];
          }
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
          // Where the drag's work went: count and mean duration per renderer
          // stage, and the kinds of render that ran.
          const stageSummary = {};
          for (const entry of preview.performanceMetrics?.stages || []) {
            if (entry.at > endedAt) continue;
            const key = [entry.stage, entry.state, entry.region === "whole" ? "whole" : entry.region ? "region" : null, entry.destination].filter(Boolean).join(":");
            const row = stageSummary[key] || (stageSummary[key] = { count: 0, durationMs: 0 });
            row.count += 1;
            row.durationMs += Number(entry.durationMs) || 0;
          }
          for (const row of Object.values(stageSummary)) row.durationMs = Number((row.durationMs / row.count).toFixed(1));
          const renderKinds = {};
          for (const entry of renders) {
            const key = [entry.execution, entry.tier, entry.longEdge].filter((value) => value !== undefined).join(":");
            renderKinds[key] = (renderKinds[key] || 0) + 1;
          }
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
            frameStarts: this.frameStarts,
            maxQueueSubmissionsInFlight: this.maxQueueInFlight,
            gpuBusyMsPerS: gpuMs.length ? Number((gpuMs.reduce((sum, value) => sum + value, 0) / duration).toFixed(1)) : null,
            gpuMsSamples: gpuMs.length,
            stageSummary,
            renderKinds,
          };
        },
      };
      // app renderGpuDraft calls this outer method once per viewer frame.
      // renderTo -> renderTiledTo nesting and auxiliary canvas work cannot
      // inflate this count. Return timing and renderer arguments are preserved.
      preview.render = (...args) => {
        const epoch = probe.epoch;
        const counted = probe.active;
        if (counted) {
          probe.frameStarts += 1;
          probe.inFlight += 1;
          probe.maxInFlight = Math.max(probe.maxInFlight, probe.inFlight);
        }
        const finish = () => {
          if (counted && epoch === probe.epoch) probe.inFlight -= 1;
        };
        // Observe the original promise, returning it unchanged. An async
        // wrapper would add continuation turns to the measured scheduling.
        try {
          const pending = render(...args);
          pending.then(finish, finish);
          return pending;
        } catch (error) { finish(); throw error; }
      };
      queue.submit = (buffers) => {
        const result = submit(buffers);
        if (probe.active) {
          const epoch = probe.epoch;
          probe.submits += 1;
          probe.queueInFlight += 1;
          probe.maxQueueInFlight = Math.max(probe.maxQueueInFlight, probe.queueInFlight);
          queue.onSubmittedWorkDone().then(() => {
            if (epoch === probe.epoch) probe.queueInFlight -= 1;
          }).catch(() => {});
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

    if (controlKind === "denoise") {
      await page.evaluate(() => {
        const group = document.querySelector(".denoise-group .group-toggle");
        if (group && group.getAttribute("aria-expanded") !== "true") group.click();
        document.querySelector("#denoise-bypass").click();
      });
      await page.waitForFunction(() => ["ready", "error"].includes(state.denoiseRuntime[state.currentView].status), null, { timeout: 600000 });
      const status = await page.evaluate(() => state.denoiseRuntime[state.currentView].status);
      if (status !== "ready") throw new Error(`Denoise did not become ready (${status})`);
      await idle(page);
    }
    const rows = [];
    for (const zoom of zooms) rows.push(await measureDrag(page, zoom));
    for (const row of rows) {
      console.log(`${row.control} ${String(row.zoom).padEnd(4)} runs ${row.denoiseRunsPerS}/s  settle ${row.settleMs} ms  refresh ${row.refreshHz} Hz  presented ${row.presentedFps} fps (worst second ${row.worstSecondFps})  in flight max ${row.maxFramesInFlight}  submits ${row.submits}  GPU busy ${row.gpuBusyMsPerS} ms/s  card ${row.card.utilizationPct}% ${row.card.powerW} W (idle ${row.cardIdle.utilizationPct}% ${row.cardIdle.powerW} W)  coarse ${row.coarseFrames}`);
      if (enforce) {
        if (row.presentedFps > CAP_FPS * 1.05) failures.push(`${row.zoom}: ${row.presentedFps} fps is above the ${CAP_FPS} fps cap`);
        if (row.frameStarts === 0) failures.push(`${row.zoom}: no viewer frame lifetime was observed`);
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
