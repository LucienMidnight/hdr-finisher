// Phase 1.6 -- live Denoise input is coalesced to one in-flight
// reconstruction plus one latest pending state.
//
//   node tests/performance/denoise-input-coalescing.js --url http://127.0.0.1:8765
//
// Dragging a Denoise control used to start a reconstruction per input event.
// Section 5.6 requires one in flight plus one latest pending, so a rapid drag
// costs runs rather than events and the last value is the one that lands.
//
// Negative controls:
//   - twelve rapid input events start at most three runs
//   - every superseded event is counted as coalesced, not dropped silently
//   - the last payload is the one that ran
//   - the coalesced run still moves pixels

const crypto = require("node:crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

// Small enough to import quickly, noisy enough that denoise has work to do.
const WIDTH = 2400;
const HEIGHT = 1600;
const EVENTS = 12;
const MAX_RUNS = 3;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const output = argument("--output", path.join("output", "performance", "denoise-input-coalescing.json"));
  const source = ensureLargeNoisySource(WIDTH, HEIGHT);
  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", source);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 300000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });

    await page.evaluate(() => {
      const group = document.querySelector(".denoise-group .group-toggle");
      if (group.getAttribute("aria-expanded") !== "true") group.click();
      const bypass = document.querySelector("#denoise-bypass");
      if (bypass.getAttribute("aria-pressed") !== "true") bypass.click();
    });
    await page.waitForFunction(
      () => ["ready", "error"].includes(state.denoiseRuntime[state.currentView].status),
      null, { timeout: 300000 },
    );
    const denoiseStatus = await page.evaluate(() => state.denoiseRuntime[state.currentView].status);
    assert(denoiseStatus === "ready", `Denoise did not reach ready: ${denoiseStatus}`);
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    await page.waitForTimeout(1200);

    const digest = async () => crypto.createHash("sha256")
      .update(await page.locator("#preview-canvas").screenshot({ clip: { x: 0, y: 0, width: 384, height: 384 } }))
      .digest("hex");
    const before = await digest();

    // Start a fresh queue so the counters describe this drag alone.
    await page.evaluate(() => { state.denoiseInputQueue = null; });
    await page.evaluate((events) => {
      const input = document.querySelector("#denoise-luminance");
      for (let step = 1; step <= events; step += 1) {
        input.value = String(step / events);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, EVENTS);

    await page.waitForFunction(() => {
      const stats = window.HDRFinisherPerformance.denoiseInputStats();
      return Boolean(stats) && state.denoiseInputQueue?.busy === false;
    }, null, { timeout: 300000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    await page.waitForTimeout(1200);

    const outcome = await page.evaluate(() => ({
      stats: window.HDRFinisherPerformance.denoiseInputStats(),
      storedLuminance: state.denoise[state.currentView].controls.luminance,
      viewer: viewerState(),
      transport: state.acceptedPresentation?.transport || null,
    }));
    const after = await digest();
    const stats = outcome.stats || {};

    assert(
      stats.started >= 1 && stats.started <= MAX_RUNS,
      `Twelve rapid inputs started ${stats.started} reconstructions`,
    );
    // Every event after the first replaced the single pending payload; the
    // only other run is the drain of that latest payload.
    assert(
      stats.coalesced === EVENTS - 1,
      `Coalescing accounting is wrong: ${JSON.stringify(stats)}`,
    );
    assert(
      stats.lastPayload?.controls?.luminance === 1,
      `The last run did not carry the last value: ${JSON.stringify(stats.lastPayload)}`,
    );
    assert(
      outcome.storedLuminance === 1,
      `The last input did not reach the document: ${outcome.storedLuminance}`,
    );
    assert(outcome.transport === "WebGPU", `The coalesced run presented ${outcome.transport}`);
    assert(before !== after, "The coalesced reconstruction did not move any pixels");
    assert(pageErrors.length === 0, `Page errors were raised: ${JSON.stringify(pageErrors)}`);

    const summary = {
      url,
      events: EVENTS,
      stats,
      maxRuns: MAX_RUNS,
      storedLuminance: outcome.storedLuminance,
      viewer: outcome.viewer,
      transport: outcome.transport,
      pixelsMoved: before !== after,
      pageErrors,
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
