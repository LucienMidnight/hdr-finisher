// PERF-05 -- a tiled render at Full must survive GPU instrumentation.
//
// Reported from manual testing: with `enableGpuInstrumentation(true)` a tiled
// render at Full failed device validation with
//
//     [Buffer (unlabeled)] used in submit while mapped.
//      - While calling [Queue].Submit([[CommandBuffer]])
//
// which refuses the whole tiled generation. It did not reproduce with
// instrumentation off. This matters more than its rarity suggests: the
// performance suite runs under instrumentation, so any tiled measurement taken
// at Full has been measuring a path that refused.
//
//   node tests/performance/full-tier-instrumented-tiling.js --url http://127.0.0.1:8765
//
// Acceptance, from PRD section 11b:
//   - a tiled render at Full completes with instrumentation enabled, with no
//     validation error raised on the device
//   - the timing readback is unmapped before any submit that could reference it
//   - a performance run at Full reports tiled renders rather than refusals

const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const WIDTH = 7968;
const HEIGHT = 5320;

// One render is not evidence. The failure needs a buffer to be handed back out
// while an earlier readback is still pending, so it takes repeats.
const RENDERS = 8;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const source = ensureLargeNoisySource(WIDTH, HEIGHT);

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", source);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

    const sourceSize = await page.evaluate(() => [state.session.source.width, state.session.source.height]);
    assert(sourceSize[0] === WIDTH, "The fixture did not import at its own size: " + JSON.stringify(sourceSize));

    const timestampQuery = await page.evaluate(
      () => Boolean(state.gpuPreview?.device?.features?.has?.("timestamp-query")),
    );

    await page.evaluate(() => {
      const select = document.querySelector("#settings-preview-resolution");
      select.value = "full";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(
      () => viewerState().status === "ready" && state.acceptedPresentation?.exact === true,
      null, { timeout: 900000 },
    );

    // Pin the tiled route. Full renders Direct on a roomy GPU, which would
    // skip the encoder this is about.
    await page.evaluate(() => applyExecutionOverride("tiled"));
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

    const result = await page.evaluate(async (renders) => {
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);

      // Every uncaptured device error, not just the one that refuses a render.
      // A validation error that no error scope happens to cover still says the
      // path is wrong.
      const deviceErrors = [];
      state.gpuPreview.device.addEventListener("uncapturederror", (event) => {
        deviceErrors.push(String(event.error?.message || event.error));
      });

      const outcomes = [];
      for (let index = 0; index < renders; index += 1) {
        // A different exposure each time, so no render is served from a cache
        // and each one really encodes. Drive it through the state directly
        // rather than through an input event: an event also wakes the
        // scheduler, whose own draft then supersedes the render being measured
        // and reports a refusal that has nothing to do with instrumentation.
        state.adjustments.hdr.exposure = -0.4 + index * 0.1;
        state.previewGeneration.hdr += 1;
        await new Promise((resolve) => setTimeout(resolve, 60));

        const rendered = await window.HDRFinisherPerformance.renderGpuTier(
          Math.max(state.session.source.width, state.session.source.height),
        );
        outcomes.push({
          rendered: Boolean(rendered),
          refusal: rendered ? null : (state.gpuPreview.lastRenderRefusal?.reason || null),
          execution: state.acceptedPresentation?.execution || null,
        });
      }

      // The shared readback. `ensureScopePeakTarget()` hands out one buffer
      // with no busy flag, and `encodeTiledGeneration` copies into it, submits,
      // and then maps it. Two tiled generations overlapping would therefore
      // have one submit reference the buffer while the other holds it mapped,
      // which is exactly the reported error and exactly an unlabeled buffer.
      // Drive that overlap through the public entry points and see.
      const overlap = [];
      for (let round = 0; round < 3; round += 1) {
        const longEdge = Math.max(state.session.source.width, state.session.source.height);
        state.adjustments.hdr.exposure = 0.2 + round * 0.05;
        const settled = await Promise.allSettled([
          window.HDRFinisherPerformance.renderTiledTier(longEdge),
          window.HDRFinisherPerformance.measureExactPeak({}),
          window.HDRFinisherPerformance.renderTiledTier(longEdge),
        ]);
        // Record what each call actually did, not merely that its promise
        // resolved. `renderTiledTier` resolves with `{rendered:false,refusals}`
        // when it declines, and counting that as "ok" would let a run where
        // nothing overlapped look like a run where overlap was survived.
        overlap.push(settled.map((entry) => {
          if (entry.status === "rejected") {
            return "rejected: " + String(entry.reason?.message || entry.reason);
          }
          const value = entry.value;
          if (value && typeof value === "object" && "rendered" in value) {
            return value.rendered ? "rendered" : "declined: " + JSON.stringify(value.refusals || []);
          }
          return value === null || value === undefined ? "null" : "value";
        }));
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Timing readbacks are fire-and-forget; give them a chance to land so a
      // late validation error is not missed.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      window.HDRFinisherPerformance.enableGpuInstrumentation(false);

      const metrics = window.HDRFinisherPerformance.gpuSnapshot?.() || null;
      return {
        outcomes,
        overlap,
        deviceErrors,
        tiledMetrics: window.HDRFinisherPerformance.tiledExecutionMetrics?.() || null,
        renderMetricCount: metrics?.performanceMetrics?.renders?.length ?? null,
      };
    }, RENDERS);

    const refused = result.outcomes.filter((entry) => !entry.rendered);
    const tiled = result.outcomes.filter((entry) => entry.execution === "tiled");
    const mappedErrors = result.deviceErrors.filter((message) => /while mapped/i.test(message));

    console.log("timestamp-query available: " + timestampQuery);
    for (const [index, entry] of result.outcomes.entries()) {
      console.log(
        "  render " + String(index + 1).padStart(2),
        entry.rendered ? "ok " : "REFUSED",
        "exec " + String(entry.execution).padEnd(6),
        entry.refusal ? "(" + entry.refusal + ")" : "",
      );
    }
    console.log("overlapped tiled generations: " + JSON.stringify(result.overlap));
    if (result.deviceErrors.length) {
      console.log("device errors:");
      for (const message of result.deviceErrors) console.log("  " + message);
    }

    assert(pageErrors.length === 0, "Page errors: " + JSON.stringify(pageErrors));

    // Without timestamp-query there are no timing buffers, so the path that
    // failed is not present and a green result would mean nothing.
    assert(timestampQuery,
      "This adapter has no timestamp-query, so the instrumented path under test does not exist here.");

    assert(tiled.length > 0,
      "No render took the tiled route, so the path under test was not exercised: "
      + JSON.stringify(result.outcomes));

    assert(mappedErrors.length === 0,
      "A buffer was used in submit while mapped under instrumentation: "
      + JSON.stringify(mappedErrors));

    assert(result.deviceErrors.length === 0,
      "The device raised errors under instrumentation: " + JSON.stringify(result.deviceErrors));

    assert(refused.length === 0,
      "A tiled render at Full was refused under instrumentation: " + JSON.stringify(refused));

    // The overlap phase only proves something if the generations really did
    // overlap and really did render. If they all declined, the shared peak
    // readback was never contended and this run says nothing about it.
    const overlapRendered = result.overlap.flat().filter((entry) => entry === "rendered").length;
    assert(overlapRendered >= result.overlap.length,
      "The overlap phase never got two tiled generations running together, so "
      + "the shared peak readback was not contended: " + JSON.stringify(result.overlap));

    console.log(
      "Tiled Full renders survive instrumentation: " + tiled.length + "/" + RENDERS
      + " tiled, no device errors.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
