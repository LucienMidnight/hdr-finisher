// §8.1 headline latency under the §8 measurement rule.
//
//   node tests/performance/headline-latency.js --url http://127.0.0.1:8799
//   node tests/run-in-electron.js tests/performance/headline-latency.js --packaged
//
// Section 8 requires every latency number to run from the input event's own
// timestamp to the first compositor-observable pixel of the current
// generation, with median, p95, worst, sample count, cold/warm state, graph,
// viewport, source, hardware, driver, OS, Electron/Chromium version, and power
// mode alongside it. Earlier drivers time `performance.now()` around a render
// call, which is handler/submission time, so this driver observes instead:
//
//   - a capture-phase listener records the timestamp of the trusted input that
//     starts the interaction (slider drag, pan, or view-change click);
//   - a requestAnimationFrame loop reads the presented canvas back through a
//     16x16 downscale and records the frame signature, the live preview
//     generation, and the accepted presentation at that vsync;
//   - the app's own `hdrfinisher:preview-presented` event is recorded in the
//     same loop, so a presentation is attributed to the generation that owns
//     it rather than to "the test finished".
//
// "First current-generation pixel" is the first sampled frame whose pixels
// differ from the armed baseline and whose status is ready; "refined" is the
// first such frame the accepted presentation reports as exact. The sample
// point is the vsync at which the frame is observable, so every number carries
// at most one display interval of observation quantization; that bound is
// reported with the evidence rather than hidden in it.
//
// This is a baseline and a gate, not a budget: rows with a §8.1 target are
// compared against it and the comparison is written into the report.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799");
const outputPath = path.resolve(option("--output", "output/performance/headline-latency.json"));
const sampleCount = Math.max(1, Number(option("--samples", "10")));
// P5: "all" runs every row; "release" runs only the release -> settled rows.
const suite = option("--suite", "all");
// P5: "off" (the default after P5), "on" (the opt-in escape hatch), or
// "app-default" (whatever a fresh profile does). On a build that still has
// the three-way preference, off maps to Precise and on to Balanced.
const fasterDragging = option("--faster-dragging", "app-default");
const inputPath = option("--input", "");
// The §8 reference viewport. The Electron runner turns this into the real
// window size, and the size that actually measured is written into the report.
const viewportParts = option("--viewport", "2560x1440").split("x").map(Number);
const viewport = Number.isFinite(viewportParts[0]) && Number.isFinite(viewportParts[1])
  ? { width: viewportParts[0], height: viewportParts[1] }
  : { width: 2560, height: 1440 };

// A 0.3 EV change moves a mid-grey 16x16 RGB sum by thousands of units out of
// 195840; this floor separates a new generation from compositor noise.
const CHANGE_EPSILON = 1500;
const BLANK_LEVEL = 4;
const SAMPLE_SOURCE = inputPath
  ? path.resolve(inputPath)
  : ensureLargeNoisySource(7968, 5320);

function percentile(values, amount) {
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))];
}

function summarize(values) {
  const clean = values.filter(Number.isFinite);
  return {
    samples: clean.length,
    medianMs: percentile(clean, 0.5),
    p95Ms: percentile(clean, 0.95),
    worstMs: clean.length ? Math.max(...clean) : null,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function installProbe(page) {
  await page.evaluate(() => {
    if (window.__headlineProbe) {
      window.__headlineProbe.uninstall();
    }
    const probe = {
      armed: false,
      inputs: [],
      frames: [],
      events: [],
      baseline: null,
      framesAfterStop: 300,
      maxFrames: 900,
      listeners: [],
      scratch: null,
      raf: null,
      signature() {
        const canvas = document.getElementById("preview-canvas");
        if (!canvas || !canvas.width || canvas.style.display === "none") return null;
        const scratch = this.scratch || (this.scratch = document.createElement("canvas"));
        scratch.width = 16;
        scratch.height = 16;
        const context = scratch.getContext("2d", { willReadFrequently: true });
        context.drawImage(canvas, 0, 0, 16, 16);
        const data = context.getImageData(0, 0, 16, 16).data;
        let sum = 0;
        for (let index = 0; index < data.length; index += 4) {
          sum += data[index] + data[index + 1] + data[index + 2];
        }
        return sum;
      },
      on(target, type, listener) {
        target.addEventListener(type, listener, true);
        this.listeners.push([target, type, listener]);
      },
      arm() {
        this.inputs = [];
        this.frames = [];
        this.events = [];
        const settled = [this.signature(), this.signature(), this.signature()].filter(Number.isFinite);
        this.baseline = settled.length
          ? settled.sort((left, right) => left - right)[Math.floor(settled.length / 2)]
          : null;
        // The generation that exists at arm time belongs to whatever came
        // before (the driver's own reset included); the measured interaction
        // has to produce a strictly newer one.
        this.baseGeneration = state.previewGeneration?.[state.currentView] ?? null;
        this.baseAccepted = state.acceptedPresentation?.generation ?? null;
        this.armed = true;
        this.stopRequested = false;
        const tick = (timestamp) => {
          if (!this.armed || this.frames.length >= this.maxFrames) return;
          const accepted = state.acceptedPresentation;
          this.frames.push({
            t: timestamp,
            signature: this.signature(),
            generation: state.previewGeneration?.[state.currentView] ?? null,
            accepted: accepted?.generation ?? null,
            exact: accepted?.exact === true,
            coarse: accepted?.coarse === true,
            status: viewerState().status,
            // P5: completed settle passes (settle render check + settled
            // scopes), so the settle wait after release is observable.
            settles: state.previewScheduler?.__settleCount ?? null,
            zoom: state.zoomMode === "fit" ? "fit" : state.zoomPercent,
            // A pan moves the viewport over a canvas that is larger than the
            // window, so the pan is observable as the scroll offset, not as a
            // change in the canvas's own pixels.
            scrollTop: els.dropzone?.scrollTop ?? null,
            scrollLeft: els.dropzone?.scrollLeft ?? null,
          });
          this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
      },
      disarm() {
        this.armed = false;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = null;
      },
      uninstall() {
        this.disarm();
        for (const [target, type, listener] of this.listeners) {
          target.removeEventListener(type, listener, true);
        }
        this.listeners = [];
      },
      collect() {
        return {
          baseline: this.baseline,
          baseGeneration: this.baseGeneration,
          baseAccepted: this.baseAccepted,
          inputs: this.inputs.slice(),
          frames: this.frames.slice(),
          events: this.events.slice(),
        };
      },
    };
    probe.on(window, "input", (event) => {
      if (!probe.armed) return;
      probe.inputs.push({
        type: event.type, t: event.timeStamp, now: performance.now(),
        target: event.target?.getAttribute?.("data-path")
          || event.target?.getAttribute?.("data-local-mask-param")
          || event.target?.id || event.target?.tagName || null,
      });
    });
    probe.on(window, "pointerdown", (event) => {
      if (!probe.armed) return;
      probe.inputs.push({
        type: "pointerdown", t: event.timeStamp, now: performance.now(),
        target: event.target?.id || event.target?.tagName || null,
      });
    });
    // The scheduler keeps only its last 240 timings, so completed settle
    // passes are counted here rather than read from the array's length.
    const scheduler = state.previewScheduler;
    if (scheduler && !scheduler.__settleCounted) {
      const record = scheduler.recordMetric.bind(scheduler);
      scheduler.__settleCount = 0;
      scheduler.recordMetric = (bucket, value) => {
        if (bucket === "settleMs") scheduler.__settleCount += 1;
        return record(bucket, value);
      };
      scheduler.__settleCounted = true;
    }
    probe.on(window, "pointerup", (event) => {
      if (!probe.armed) return;
      probe.inputs.push({
        type: "pointerup", t: event.timeStamp, now: performance.now(), trusted: event.isTrusted,
        target: event.target?.getAttribute?.("data-path") || event.target?.id || event.target?.tagName || null,
      });
    });
    probe.on(window, "wheel", (event) => {
      if (!probe.armed) return;
      probe.inputs.push({
        type: "wheel", t: event.timeStamp, now: performance.now(),
        target: event.target?.id || event.target?.tagName || null,
      });
    });
    probe.on(window, "click", (event) => {
      if (!probe.armed) return;
      probe.inputs.push({
        type: "click", t: event.timeStamp, now: performance.now(),
        target: event.target?.id || event.target?.tagName || null,
      });
    });
    probe.on(window, "hdrfinisher:preview-presented", (event) => {
      if (!probe.armed) return;
      probe.events.push({
        t: event.detail?.presentedAt ?? performance.now(),
        generation: event.detail?.generation ?? null,
        lane: event.detail?.lane ?? null,
        longEdge: event.detail?.longEdge ?? null,
      });
    });
    window.__headlineProbe = probe;
  });
}

async function waitForIdle(page, timeout = 300000) {
  await page.waitForFunction(() => viewerState().status === "ready", null, { timeout }).catch(() => null);
}

async function arm(page) {
  await page.evaluate(() => window.__headlineProbe.arm());
}

async function disarm(page) {
  await page.evaluate(() => {
    window.__headlineProbe.stopRequested = true;
    window.__headlineProbe.disarm();
  });
}

async function collect(page) {
  return page.evaluate(() => window.__headlineProbe.collect());
}

function firstInput(inputs) {
  return inputs.length ? inputs.reduce((earliest, entry) => (entry.t < earliest.t ? entry : earliest)) : null;
}

// Some interactions do not advance the edit generation (a view change keeps
// the graph and only changes scale), so they are observed as the first painted
// frame whose pixels differ from the armed baseline.
function firstPixelChangeFrame(collection, predicate = () => true) {
  if (!Number.isFinite(collection.baseline)) return null;
  return collection.frames.find((frame) => Number.isFinite(frame.signature)
    && Math.abs(frame.signature - collection.baseline) > 1
    && predicate(frame)) || null;
}

// A warm pan presents no new generation when every visible tile is already
// resident; what has to be observable is that the viewport moved and the frame
// that moved into place is painted.
function firstScrollFrame(collection, baseScrollTop, predicate = () => true) {
  return collection.frames.find((frame) => Number.isFinite(frame.scrollTop)
    && Number.isFinite(baseScrollTop)
    && Math.abs(frame.scrollTop - baseScrollTop) > 1
    && Number.isFinite(frame.signature)
    && predicate(frame)) || null;
}
// The first sampled frame that belongs to a presentation strictly newer than
// the generation that existed when the probe was armed: the first frame the
// compositor can show of the interaction's own generation. The canvas must be
// painted, so "newer" is also "pixels exist".
function firstChangedFrame(collection, predicate = () => true) {
  const base = collection.baseGeneration;
  return collection.frames.find((frame) => {
    if (!predicate(frame)) return false;
    if (frame.signature === null || !Number.isFinite(frame.signature)) return false;
    if (Number.isFinite(base)) {
      if (!(frame.accepted > base)) return false;
    } else if (!(Number.isFinite(collection.baseline)
      && Math.abs(frame.signature - collection.baseline) > CHANGE_EPSILON)) {
      return false;
    }
    return true;
  }) || null;
}

function firstPresentedEvent(collection, afterTime, minimumGeneration = null) {
  return collection.events.find((event) => event.t >= afterTime
    && (minimumGeneration === null || (event.generation ?? -1) >= minimumGeneration)) || null;
}

async function stroke(page, selector, deltaX) {
  const control = page.locator(selector).first();
  await control.waitFor({ state: "visible", timeout: 60000 });
  const box = await control.boundingBox();
  assert(box && box.width > 0, `No box for ${selector}`);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + deltaX, box.y + box.height * 0.5, { steps: 3 });
  await page.mouse.up();
}

async function setExposure(page, value) {
  await page.evaluate((next) => {
    const control = document.querySelector('[data-path="hdr.exposure"]');
    control.value = String(next);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await waitForIdle(page);
}

async function measureSliderStroke(page, label, { zoom = null, deltaX = 8 } = {}) {
  if (zoom !== null) {
    await page.evaluate((percent) => setCustomZoom(percent), zoom);
    await waitForIdle(page);
  }
  await setExposure(page, 0);
  const before = await page.evaluate(() => ({
    generation: state.previewGeneration[state.currentView],
    viewport: { width: innerWidth, height: innerHeight },
  }));
  await arm(page);
  await stroke(page, '[data-path="hdr.exposure"]', deltaX);
  await page.waitForTimeout(2000);
  const collection = await collect(page);
  await disarm(page);
  const input = firstInput(collection.inputs);
  // A frame sampled before the stroke's own input cannot be its response. With
  // fast presentation the reset's last frame can land after arming, which used
  // to be counted and produced negative latencies.
  const afterInput = (frame) => Boolean(input) && frame.t >= input.t;
  const currentFrame = firstChangedFrame(collection, afterInput);
  const refinedFrame = firstChangedFrame(collection, (frame) => afterInput(frame) && frame.exact === true);
  // P3 (Preview Responsiveness Tuning Sprint): how much of the image the
  // settled pass processed, against what is visible. Direct processes its
  // whole frame; Tiled reports the tiles it ran.
  const work = await page.evaluate(() => {
    const accepted = state.acceptedPresentation;
    const plan = state.gpuPreview?.lastRenderPlan || null;
    const tiled = accepted?.execution === "tiled" ? state.gpuPreview?.tiledExecutionMetrics || null : null;
    const canvas = els.previewCanvas;
    const visible = visibleOutputRect(canvas.width, canvas.height);
    return {
      execution: accepted?.execution ?? null,
      processedPixels: tiled ? tiled.processedPixels ?? null : (plan ? plan.width * plan.height : null),
      frameSourcePixels: canvas.width * canvas.height,
      visibleSourcePixels: visible ? visible.width * visible.height : canvas.width * canvas.height,
      halo: tiled?.halo ?? null,
    };
  });
  return {
    label,
    zoom: zoom ?? "fit",
    ...work,
    deltaEv: null,
    input: input ? { type: input.type, target: input.target } : null,
    baselineGeneration: before.generation,
    viewport: before.viewport,
    currentMs: input && currentFrame ? currentFrame.t - input.t : null,
    refinedMs: input && refinedFrame ? refinedFrame.t - input.t : null,
    observedFrames: collection.frames.length,
    coldWarm: "warm",
  };
}

// P5 (Preview Responsiveness Tuning Sprint): release -> settled, the primary
// metric. A real drag with several frames, a short hold, then a trusted
// pointer-up. "Settled" is the first sampled frame at or after the pointer-up
// that the renderer reports exact at the current (final) generation, with the
// viewer Ready (which also requires the current geometry and scale). When the
// last drag frame was already exact, that is the first vsync after release.
// The same stroke also reports what the settle pass still did afterwards:
// frames presented after release (a duplicate render shows up here), the
// settled scope pass, and any coarse frame during or after the drag.
async function dragAndRelease(page, selector, deltaX) {
  const control = page.locator(selector).first();
  await control.waitFor({ state: "visible", timeout: 60000 });
  const box = await control.boundingBox();
  assert(box && box.width > 0, `No box for ${selector}`);
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(x + (deltaX * step) / 6, y);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(30);
  await page.mouse.up();
}

function analyseRelease(collection) {
  const up = collection.inputs.find((entry) => entry.type === "pointerup") || null;
  const start = firstInput(collection.inputs);
  const last = collection.frames[collection.frames.length - 1] || null;
  const finalGeneration = last?.generation ?? null;
  if (!up || !last) return { up: null };
  const afterUp = collection.frames.filter((frame) => frame.t >= up.t);
  const duringDrag = collection.frames.filter((frame) => start && frame.t >= start.t && frame.t < up.t);
  const settled = afterUp.find((frame) => frame.accepted === finalGeneration && frame.exact
    && frame.status === "ready" && Number.isFinite(frame.signature)) || null;
  const settlesAtUp = [...collection.frames].reverse().find((frame) => frame.t < up.t)?.settles ?? afterUp[0]?.settles ?? null;
  const scopes = Number.isFinite(settlesAtUp)
    ? afterUp.find((frame) => Number.isFinite(frame.settles) && frame.settles > settlesAtUp) || null
    : null;
  const lastDragFrame = [...duringDrag].reverse().find((frame) => Number.isFinite(frame.accepted)) || null;
  // No input follows the release, so a generation that starts after it is a
  // render of values that were already on screen.
  const generationAtUp = [...collection.frames].reverse().find((frame) => frame.t < up.t)?.generation ?? null;
  const distinct = (frames, predicate) => new Set(frames.filter(predicate).map((frame) => frame.accepted)).size;
  return {
    up,
    trusted: up.trusted === true,
    finalGeneration,
    releaseToSettledMs: settled ? settled.t - up.t : null,
    releaseToSettleScopesMs: scopes ? scopes.t - up.t : null,
    lastDragFrameExactAtFinal: Boolean(lastDragFrame && lastDragFrame.exact && lastDragFrame.accepted === finalGeneration),
    presentedAfterRelease: collection.events.filter((event) => event.t >= up.t).length,
    generationsAfterRelease: Number.isFinite(generationAtUp) && Number.isFinite(finalGeneration)
      ? finalGeneration - generationAtUp : null,
    dragFramesPresented: distinct(duringDrag, (frame) => Number.isFinite(frame.accepted) && frame.accepted > (collection.baseAccepted ?? -1)),
    coarseFramesDuringDrag: distinct(duringDrag, (frame) => frame.coarse),
    coarseFramesAfterRelease: distinct(afterUp, (frame) => frame.coarse),
  };
}

async function measureRelease(page, label, { zoom = null, deltaX = 8, coldAfterZoom = false } = {}) {
  await page.evaluate(() => setZoomMode("fit"));
  await waitForIdle(page);
  if (coldAfterZoom) {
    // The measured drag is the first edit after the zoom change.
    await setExposure(page, 0);
    await page.evaluate((percent) => setCustomZoom(percent), zoom);
    await waitForIdle(page);
  } else {
    if (zoom !== null) {
      await page.evaluate((percent) => setCustomZoom(percent), zoom);
      await waitForIdle(page);
    }
    await setExposure(page, 0);
  }
  await page.waitForTimeout(300);
  await arm(page);
  await dragAndRelease(page, '[data-path="hdr.exposure"]', deltaX);
  await page.waitForTimeout(1500);
  const collection = await collect(page);
  await disarm(page);
  const result = analyseRelease(collection);
  const execution = await page.evaluate(() => state.acceptedPresentation?.execution ?? null);
  return {
    label, zoom: zoom ?? "fit", execution, ...result,
    up: result.up ? { t: result.up.t, target: result.up.target } : null,
    coldWarm: coldAfterZoom ? "cold" : "warm",
  };
}

// P5: a warm zoom change to the first sampled frame the viewer reports Ready
// at the new zoom (exact, current generation, current processing scale).
async function measureZoomSharp(page, cold) {
  await page.evaluate(() => setZoomMode("fit"));
  await waitForIdle(page);
  await page.waitForTimeout(300);
  await arm(page);
  await page.locator("#zoom-actual").click();
  await page.waitForTimeout(2000);
  const collection = await collect(page);
  await disarm(page);
  const click = collection.inputs.find((entry) => entry.type === "click") || firstInput(collection.inputs);
  const sharp = click ? collection.frames.find((frame) => frame.t >= click.t && frame.zoom === 100
    && frame.status === "ready" && Number.isFinite(frame.signature)) : null;
  return {
    label: "zoom-sharp-100", zoom: 100,
    zoomToSharpMs: click && sharp ? sharp.t - click.t : null,
    coarseFrames: new Set(collection.frames.filter((frame) => click && frame.t >= click.t && frame.coarse)
      .map((frame) => frame.accepted)).size,
    coldWarm: cold ? "cold" : "warm",
  };
}

async function measurePan(page) {
  await page.evaluate(() => setCustomZoom(200));
  await waitForIdle(page);
  const before = await page.evaluate(() => ({ generation: state.previewGeneration[state.currentView] }));
  await arm(page);
  const baseScrollTop = await page.evaluate(() => els.dropzone?.scrollTop ?? null);
  const canvas = page.locator("#preview-canvas");
  const box = await canvas.boundingBox();
  assert(box && box.width > 0, "No preview canvas box for the pan");
  // A wheel scroll is the viewer's pan input; a left-drag on the canvas is not
  // read as a pan by the application, so the wheel is what the metric uses.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.wheel(0, 480);
  await page.waitForTimeout(1500);
  const collection = await collect(page);
  await disarm(page);
  const input = collection.inputs.find((entry) => entry.type === "wheel") || firstInput(collection.inputs);
  const event = input ? firstPresentedEvent(collection, input.t, before.generation + 1) : null;
  const frame = firstScrollFrame(collection, baseScrollTop);
  return {
    label: "pan",
    zoom: 200,
    input: input ? { type: input.type, target: input.target } : null,
    baselineGeneration: before.generation,
    panMs: input && frame ? frame.t - input.t : null,
    presentedMs: input && event ? event.t - input.t : null,
    observedFrames: collection.frames.length,
    coldWarm: "warm",
  };
}

async function measureViewChange(page, button, label, coldWhen) {
  await page.evaluate(() => setZoomMode("fit"));
  await waitForIdle(page);
  const before = await page.evaluate(() => ({ generation: state.previewGeneration[state.currentView] }));
  const cold = coldWhen();
  await arm(page);
  await page.locator(button).click();
  await page.waitForTimeout(2000);
  const collection = await collect(page);
  await disarm(page);
  const input = firstInput(collection.inputs);
  // The first painted frame whose pixels differ is the first visible frame of
  // the view change; its status may still read "updating" because the exact
  // tier is not in yet, which is exactly what "first visible ROI" means.
  const frame = firstPixelChangeFrame(collection);
  return {
    label,
    zoom: label.includes("actual") ? 100 : "fit",
    input: input ? { type: input.type, target: input.target } : null,
    baselineGeneration: before.generation,
    currentMs: input && frame ? frame.t - input.t : null,
    observedFrames: collection.frames.length,
    coldWarm: cold ? "cold" : "warm",
  };
}

async function measureLocalGrade(page) {
  await page.evaluate(() => setCustomZoom(100));
  await waitForIdle(page);
  // A full-frame local, added once; the measured edit is its grade only, so
  // the mask geometry is unchanged and warm.
  await page.locator("#grade-mode-local").click();
  await page.locator("#local-add-adjustment").click();
  await waitForIdle(page);
  const control = page.locator('[data-local-grade="exposure"]').first();
  const visible = await control.waitFor({ state: "visible", timeout: 20000 })
    .then(() => true).catch(() => false);
  if (!visible) return null;
  const before = await page.evaluate(() => ({ generation: state.previewGeneration[state.currentView] }));
  await arm(page);
  await stroke(page, '[data-local-grade="exposure"]', 10);
  await page.waitForTimeout(2000);
  const collection = await collect(page);
  await disarm(page);
  const input = firstInput(collection.inputs);
  const currentFrame = firstChangedFrame(collection, (frame) => Boolean(input) && frame.t >= input.t);
  return {
    label: "local-grade",
    zoom: 100,
    input: input ? { type: input.type, target: input.target } : null,
    baselineGeneration: before.generation,
    currentMs: input && currentFrame ? currentFrame.t - input.t : null,
    observedFrames: collection.frames.length,
    coldWarm: "warm",
  };
}

async function measureInputHandler(page) {
  await page.evaluate(() => {
    if (window.__handlerTimings) return;
    window.__handlerTimings = [];
    let enteredAt = null;
    window.addEventListener("input", () => {
      enteredAt = performance.now();
      queueMicrotask(() => {
        setTimeout(() => {
          if (enteredAt === null) return;
          window.__handlerTimings.push(performance.now() - enteredAt);
          enteredAt = null;
        }, 0);
      });
    }, true);
  });
  await setExposure(page, 0.2);
  await setExposure(page, -0.2);
  await page.evaluate(() => { window.__handlerTimings.length = 0; });
  for (let index = 0; index < 12; index += 1) {
    await page.evaluate((value) => {
      const control = document.querySelector('[data-path="hdr.exposure"]');
      control.value = String(value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }, index % 2 === 0 ? 0.25 : -0.25);
    await page.waitForTimeout(30);
  }
  const timings = await page.evaluate(() => window.__handlerTimings.slice());
  return {
    label: "input-handler",
    zoom: 100,
    handler: summarize(timings),
    coldWarm: "warm",
  };
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: option("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", SAMPLE_SOURCE);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 300000 });
    await waitForIdle(page, 900000);
    // The drag setting under test. A fresh profile starts at the app default;
    // an existing one may not, so every mode is set explicitly.
    const dragSetting = await page.evaluate((mode) => {
      const box = document.getElementById("preview-faster-dragging");
      if (box) {
        if (mode !== "app-default" && box.checked !== (mode === "on")) {
          box.checked = mode === "on";
          box.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return { control: "faster-dragging", on: box.checked };
      }
      const select = document.getElementById("preview-latency");
      const value = mode === "on" ? "balanced" : mode === "off" ? "precise" : "balanced";
      if (select && select.value !== value) {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return { control: "preview-response", value: select?.value ?? null };
    }, fasterDragging);
    await waitForIdle(page);
    // Every §8.1 interaction is real input on the grade rail; the rail is
    // shown through the application's own workflow switch.
    await page.evaluate(() => activateWorkflowTab("grade"));
    // Exposure lives in the collapsed Tone group; expand it through the same
    // toggle a user would press so the slider has real geometry to drag.
    await page.evaluate(() => {
      const toggle = document.querySelector('section[data-group="hdr-tone"] .group-toggle');
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
    });
    await page.waitForTimeout(400);
    await installProbe(page);

    const environment = await page.evaluate(async () => {
      let adapter = null;
      try {
        const hardware = await navigator.gpu.requestAdapter();
        adapter = hardware?.info ? {
          vendor: hardware.info.vendor ?? null,
          architecture: hardware.info.architecture ?? null,
          device: hardware.info.device ?? null,
          description: hardware.info.description ?? null,
        } : null;
      } catch { /* reported as null */ }
      let battery = null;
      try {
        const manager = await navigator.getBattery?.();
        battery = manager ? { charging: manager.charging, level: manager.level } : null;
      } catch { /* reported as null */ }
      return {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio,
        hardwareConcurrency: navigator.hardwareConcurrency,
        adapter,
        battery,
        source: state.session?.source
          ? { width: state.session.source.width, height: state.session.source.height }
          : null,
        preference: document.getElementById("preview-latency")?.value ?? null,
      };
    });
    environment.dragSetting = dragSetting;
    environment.fasterDraggingRequested = fasterDragging;

    if (suite === "release") {
      const releaseRows = [];
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const direction = sample % 2 === 0 ? 8 : -8;
        const warm = sample === 0 ? "cold" : "warm";
        for (const zoom of [null, 100, 200, 400]) {
          const row = await measureRelease(page, `release-settled-${zoom ?? "fit"}`, { zoom, deltaX: direction });
          releaseRows.push({ ...row, coldWarm: warm });
        }
        // The first edit after a zoom change (Fit -> 100%, which changes the
        // processing scale); always cold by construction.
        releaseRows.push(await measureRelease(page, "release-settled-cold-after-zoom",
          { zoom: 100, deltaX: direction, coldAfterZoom: true }));
        releaseRows.push(await measureZoomSharp(page, sample === 0));
      }
      assert(pageErrors.length === 0, `Page errors occurred: ${pageErrors.join(" | ")}`);
      const groups = {};
      for (const row of releaseRows) {
        const key = `${row.label}:${row.coldWarm}`;
        (groups[key] = groups[key] || []).push(row);
      }
      const stat = (entries, field) => {
        const values = entries.map((entry) => entry[field]).filter(Number.isFinite);
        return { medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95),
          worstMs: values.length ? Math.max(...values) : null, samples: values.length };
      };
      const releaseSummary = Object.entries(groups).map(([key, entries]) => {
        const [label, coldWarm] = key.split(":");
        if (label === "zoom-sharp-100") {
          return { label, coldWarm, zoomToSharp: stat(entries, "zoomToSharpMs"),
            coarseFramesMax: Math.max(...entries.map((entry) => entry.coarseFrames || 0)) };
        }
        return {
          label, coldWarm,
          executions: [...new Set(entries.map((entry) => entry.execution))],
          releaseToSettled: stat(entries, "releaseToSettledMs"),
          releaseToSettleScopes: stat(entries, "releaseToSettleScopesMs"),
          lastDragFrameExactAtFinal: entries.filter((entry) => entry.lastDragFrameExactAtFinal).length,
          presentedAfterReleaseMax: Math.max(...entries.map((entry) => entry.presentedAfterRelease || 0)),
          presentedAfterReleaseTotal: entries.reduce((sum, entry) => sum + (entry.presentedAfterRelease || 0), 0),
          strokesWithNewGenerationAfterRelease: entries.filter((entry) => entry.generationsAfterRelease > 0).length,
          dragFramesPresentedMin: Math.min(...entries.map((entry) => entry.dragFramesPresented || 0)),
          coarseDuringDragTotal: entries.reduce((sum, entry) => sum + (entry.coarseFramesDuringDrag || 0), 0),
          coarseAfterReleaseTotal: entries.reduce((sum, entry) => sum + (entry.coarseFramesAfterRelease || 0), 0),
          untrustedReleases: entries.filter((entry) => entry.trusted === false).length,
          samples: entries.length,
        };
      });
      // P5 gates (PRD P5 tests), warm p95 unless stated.
      const failures = [];
      const find = (label, coldWarm) => releaseSummary.find((row) => row.label === label && row.coldWarm === coldWarm);
      const gate = (row, field, targetMs, name) => {
        const value = row?.[field]?.p95Ms;
        if (!Number.isFinite(value)) failures.push(`${name}: no samples`);
        else if (value > targetMs) failures.push(`${name}: p95 ${value.toFixed(1)} ms > ${targetMs} ms`);
      };
      gate(find("release-settled-fit", "warm"), "releaseToSettled", 150, "release -> settled, Fit");
      for (const zoom of [100, 200, 400]) gate(find(`release-settled-${zoom}`, "warm"), "releaseToSettled", 200, `release -> settled, ${zoom}%`);
      gate(find("release-settled-cold-after-zoom", "cold"), "releaseToSettled", 400, "release -> settled, cold first edit after zoom");
      gate(find("zoom-sharp-100", "warm"), "zoomToSharp", 300, "zoom change -> sharp, warm");
      const strokes = releaseSummary.filter((row) => row.label.startsWith("release-settled-"));
      const total = (field) => strokes.reduce((sum, row) => sum + (row[field] || 0), 0);
      if (total("coarseAfterReleaseTotal") > 0) failures.push(`${total("coarseAfterReleaseTotal")} coarse frame(s) shown after release`);
      if (total("untrustedReleases") > 0) failures.push("a release was not a trusted pointer-up");
      if (!dragSetting.on && dragSetting.control === "faster-dragging") {
        if (total("coarseDuringDragTotal") > 0) failures.push(`${total("coarseDuringDragTotal")} coarse frame(s) while dragging with Faster dragging off`);
      }
      if (total("strokesWithNewGenerationAfterRelease") > 0) {
        failures.push(`${total("strokesWithNewGenerationAfterRelease")} stroke(s) started a new render after release with no new input`);
      }
      const report = {
        failures,
        recordedAt: new Date().toISOString(),
        measurementRule: "trusted pointer-up timeStamp -> first rAF at or after it whose accepted presentation is exact at the final generation with the viewer Ready (at most one display interval of observation quantization)",
        environment: {
          ...environment,
          os: `${process.platform} ${os.release()}`,
          node: process.versions.node,
          powerMode: process.env.HDR_FINISHER_POWER_MODE || "unknown",
          requestedWindowSize: process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE || null,
        },
        summary: releaseSummary,
        rows: releaseRows,
      };
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ environment: report.environment, summary: releaseSummary, failures }, null, 2));
      if (failures.length) throw new Error(`P5 release gates failed: ${failures.join("; ")}`);
      return;
    }

    const rows = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const direction = sample % 2 === 0 ? 8 : -8;
      const sampleState = sample === 0 ? "cold" : "warm";
      const sampleRows = [];
      const fit = await measureSliderStroke(page, "slider-fit", { deltaX: direction });
      sampleRows.push({ ...fit, label: "slider-current-fit" });
      sampleRows.push({ ...fit, label: "slider-refined-fit", currentMs: null });
      sampleRows.push(await measureSliderStroke(page, "slider-refined-100", { zoom: 100, deltaX: direction }));
      sampleRows.push(await measureSliderStroke(page, "slider-current-200", { zoom: 200, deltaX: direction }));
      // P3: settled latency and processed pixels at 200%, 400% and 800%.
      for (const zoom of [200, 400, 800]) {
        sampleRows.push(await measureSliderStroke(page, `slider-refined-${zoom}`, { zoom, deltaX: direction }));
      }
      sampleRows.push(await measurePan(page));
      sampleRows.push(await measureViewChange(page, "#zoom-actual", "view-change-actual", () => sample === 0));
      sampleRows.push(await measureViewChange(page, "#zoom-fit", "view-change-fit", () => false));
      const local = await measureLocalGrade(page).catch(() => null);
      if (local) sampleRows.push(local);
      for (const row of sampleRows) {
        if (row.label !== "view-change-actual" && row.label !== "view-change-fit") {
          row.coldWarm = sampleState;
        }
        rows.push(row);
      }
    }
    const handler = await measureInputHandler(page);
    assert(pageErrors.length === 0, `Page errors occurred: ${pageErrors.join(" | ")}`);

    const byMetric = {};
    for (const row of rows) {
      const metric = row.label;
      const key = `${row.label}:${row.coldWarm}`;
      byMetric[key] = byMetric[key] || {
        label: metric, zoom: row.zoom, coldWarm: row.coldWarm,
        targets: {}, current: [], refined: [], pan: [],
      };
      if (Number.isFinite(row.currentMs)) byMetric[key].current.push(row.currentMs);
      if (Number.isFinite(row.refinedMs)) byMetric[key].refined.push(row.refinedMs);
      if (Number.isFinite(row.panMs)) byMetric[key].pan.push(row.panMs);
    }
    const targets = {
      "slider-current-fit": { metric: "current", targetMs: 50, gate: "Slider-to-current-pixel, Fit, Balanced" },
      "slider-refined-fit": { metric: "refined", targetMs: 100, gate: "Slider-to-refined, Fit, Balanced" },
      "slider-refined-100": { metric: "refined", targetMs: 100, gate: "Slider-to-refined, 100% zoom" },
      "slider-current-200": { metric: "current", targetMs: 50, gate: "Slider-to-current-pixel, 200% zoom" },
      // P3: zoomed settled latency is gated against Fit's p95 + 50 ms below.
      "slider-refined-200": { metric: "refined", targetMs: null, gate: "P3 slider-to-settled, 200% (<= Fit p95 + 50 ms)" },
      "slider-refined-400": { metric: "refined", targetMs: null, gate: "P3 slider-to-settled, 400% (<= Fit p95 + 50 ms)" },
      "slider-refined-800": { metric: "refined", targetMs: null, gate: "P3 slider-to-settled, 800% (<= Fit p95 + 50 ms)" },
      pan: { metric: "pan", targetMs: 33, gate: "Warm pan to current pixels" },
      "view-change-actual": { metric: "current", targetMs: 150, gate: "First visible ROI after cold zoom/view change" },
      "local-grade": { metric: "current", targetMs: 100, gate: "Warm local-grade edit with unchanged mask geometry" },
    };
    const summary = Object.values(byMetric).map((entry) => {
      const target = targets[entry.label] || null;
      const values = entry[target?.metric || "current"];
      return {
        label: entry.label,
        zoom: entry.zoom,
        coldWarm: entry.coldWarm,
        metric: target?.metric ?? null,
        targetMs: target?.targetMs ?? null,
        gate: target?.gate ?? null,
        medianMs: percentile(values, 0.5),
        p95Ms: percentile(values, 0.95),
        worstMs: values.length ? Math.max(...values) : null,
        sampleCount: values.length,
        verdict: target && values.length ? (percentile(values, 0.95) <= target.targetMs ? "pass" : "fail") : "no-target",
      };
    });
    // P3 gates. Zoomed settled p95 is compared with the warm Fit refined p95;
    // processed pixels are bounded by the visible region only on the Tiled
    // route, since Direct processes its whole frame by construction.
    const fitRefined = summary.find((row) => row.label === "slider-refined-fit" && row.coldWarm === "warm");
    for (const row of summary) {
      if (!/^slider-refined-(200|400|800)$/.test(row.label) || row.coldWarm !== "warm") continue;
      row.targetMs = fitRefined?.p95Ms !== null && fitRefined?.p95Ms !== undefined ? fitRefined.p95Ms + 50 : null;
      row.verdict = row.targetMs !== null && row.p95Ms !== null ? (row.p95Ms <= row.targetMs ? "pass" : "fail") : "no-target";
      const zoomRows = rows.filter((entry) => entry.label === row.label && entry.coldWarm === "warm");
      row.executions = [...new Set(zoomRows.map((entry) => entry.execution))];
      const tiledRows = zoomRows.filter((entry) => entry.execution === "tiled");
      row.processedPixelsMax = zoomRows.length ? Math.max(...zoomRows.map((entry) => entry.processedPixels || 0)) : null;
      row.visibleSourcePixels = zoomRows[0]?.visibleSourcePixels ?? null;
      row.processedPixelVerdict = tiledRows.length
        ? (tiledRows.every((entry) => entry.processedPixels <= 2 * entry.visibleSourcePixels
          + 4 * (entry.halo || 0) * Math.sqrt(entry.visibleSourcePixels)) ? "pass" : "fail")
        : "direct-whole-frame";
    }
    summary.push({
      label: "input-handler",
      zoom: handler.zoom,
      coldWarm: "warm",
      metric: "handler",
      targetMs: 16.7,
      gate: "UI input handler duration",
      medianMs: handler.handler.medianMs,
      p95Ms: handler.handler.p95Ms,
      worstMs: handler.handler.worstMs,
      sampleCount: handler.handler.samples,
      verdict: handler.handler.p95Ms !== null && handler.handler.p95Ms <= 16.7 ? "pass" : "fail",
    });

    const report = {
      recordedAt: new Date().toISOString(),
      measurementRule: "input-event timeStamp -> first rAF at which a changed current-generation frame is readable from the presented canvas (at most one display interval of observation quantization)",
      environment: {
        ...environment,
        os: `${process.platform} ${os.release()}`,
        node: process.versions.node,
        powerMode: process.env.HDR_FINISHER_POWER_MODE || "unknown",
        requestedWindowSize: process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE || null,
      },
      summary,
      rows,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ environment: report.environment, summary }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
