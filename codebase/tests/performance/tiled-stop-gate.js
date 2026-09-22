// Phase 2 stop gate -- a new input must stop further obsolete submissions
// within 50 ms.
//
//   node tests/performance/tiled-stop-gate.js --url http://127.0.0.1:8765
//
// The mechanism is small-batch submission with a currency check before each
// batch is flushed. The check can only fire where the encoder yields, and a
// Denoise pass yields per tile while it reconstructs, so this driver runs the
// 42.4 MP tiled pass with Denoise enabled, supersedes it mid-encode, and reads
// the renderer's submission log to measure how long the superseded generation
// kept submitting after the newer one began.
//
// Negative controls:
//   - no stale submission may land more than the gate after supersession
//   - no stale submission may land after the newer generation's first submit
//   - the newer generation must still present

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const WIDTH = 7968;
const HEIGHT = 5320;
const STOP_GATE_MS = 50;
const SUPERSEDE_DELAY_MS = 200;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const output = argument("--output", path.join("output", "performance", "tiled-stop-gate.json"));
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

    // A local keeps the mask path in the generation, and tiled is forced so the
    // measured pass is the small-batch encoder.
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#grade-mode-local").click();
    const created = page.waitForResponse(
      (response) => response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.locator('[data-local-tool="brush"]').click();
    await page.locator("#local-add-adjustment").click();
    await created;
    await page.waitForFunction(() => state.localMaskCommitDepth === 0, null, { timeout: 30000 });
    // Denoise gives the encoder per-tile await points, which is where a
    // supersession can actually interrupt a pass in flight.
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
    await page.evaluate(() => applyExecutionOverride("tiled"));
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });

    const outcome = await page.evaluate(async ({ delayMs }) => {
      state.gpuPreview.instrumentationEnabled = true;
      const longEdge = Math.max(state.session.source.width, state.session.source.height);
      // Warm-up: proxy, masks and the denoise selector are cached, so the
      // measured pair reaches the encode loop where the per-tile awaits are.
      await window.HDRFinisherPerformance.renderTiledTier(longEdge);
      await new Promise((resolve) => setTimeout(resolve, 200));
      state.gpuPreview.submissionLog = [];

      const first = window.HDRFinisherPerformance.renderTiledTier(longEdge);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const supersededAt = performance.now();
      const second = window.HDRFinisherPerformance.renderTiledTier(longEdge);
      const [firstResult, secondResult] = await Promise.allSettled([first, second]);
      await new Promise((resolve) => setTimeout(resolve, 400));

      const summarize = (settled) => (settled.status === "fulfilled"
        ? { rendered: Boolean(settled.value && settled.value.rendered), refusals: (settled.value && settled.value.refusals) || [] }
        : { rendered: false, refusals: [String(settled.reason)] });
      return {
        supersededAt,
        first: summarize(firstResult),
        second: summarize(secondResult),
        log: state.gpuPreview.submissionLog.slice(),
        viewer: viewerState(),
        transport: state.acceptedPresentation?.transport || null,
      };
    }, { delayMs: SUPERSEDE_DELAY_MS });

    const log = outcome.log;
    assert(log.length >= 2, `The submission log is empty: ${JSON.stringify(log)}`);
    // The superseded generation is the one whose serial the newer render
    // replaced: the last distinct serial before the newest one.
    const serials = [...new Set(log.map((entry) => entry.serial))];
    const newSerial = serials[serials.length - 1];
    const staleSerials = new Set(serials.slice(0, -1));
    const newEntries = log.filter((entry) => entry.serial === newSerial);
    const newFirstAt = newEntries.length ? Math.min(...newEntries.map((entry) => entry.at)) : null;
    const staleEntries = log.filter((entry) => staleSerials.has(entry.serial));
    const staleAfterSupersession = staleEntries.filter((entry) => entry.at > outcome.supersededAt);
    const staleAfterNewSubmit = newFirstAt === null
      ? []
      : staleAfterSupersession.filter((entry) => entry.at > newFirstAt);
    const lastStaleAt = staleEntries.length ? Math.max(...staleEntries.map((entry) => entry.at)) : null;
    const stopLatencyMs = lastStaleAt === null ? null : lastStaleAt - outcome.supersededAt;
    // How long one generation's encode phase spans from its first submission to
    // its last. This is the window in which a stale pass could keep submitting,
    // and it is what the stop gate really bounds.
    const spans = serials.map((serial) => {
      const entries = log.filter((entry) => entry.serial === serial);
      return {
        serial,
        first: Math.min(...entries.map((entry) => entry.at)),
        last: Math.max(...entries.map((entry) => entry.at)),
        submissions: entries.length,
      };
    }).map((span) => ({ ...span, spanMs: span.last - span.first }));
    const longestSpanMs = Math.max(...spans.map((span) => span.spanMs));

    const summary = {
      url,
      source: { width: WIDTH, height: HEIGHT },
      supersedeDelayMs: SUPERSEDE_DELAY_MS,
      stopGateMs: STOP_GATE_MS,
      interrupted: staleAfterSupersession.length > 0,
      stopLatencyMs,
      longestEncodeSpanMs: longestSpanMs,
      spans,
      staleSubmissionsAfterSupersession: staleAfterSupersession.length,
      staleSubmissionsAfterNewGeneration: staleAfterNewSubmit.length,
      staleSubmissionCount: staleEntries.length,
      newSubmissionCount: newEntries.length,
      serials,
      first: outcome.first,
      second: outcome.second,
      viewer: outcome.viewer,
      transport: outcome.transport,
      pageErrors,
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));

    assert(pageErrors.length === 0, `Page errors were raised: ${JSON.stringify(pageErrors)}`);
    assert(
      staleAfterNewSubmit.length === 0,
      `A superseded generation submitted after the newer one: ${JSON.stringify(staleAfterNewSubmit)}`,
    );
    assert(
      stopLatencyMs === null || stopLatencyMs <= STOP_GATE_MS,
      `The superseded generation kept submitting for ${stopLatencyMs === null ? "no" : stopLatencyMs.toFixed(1)} ms after supersession`,
    );
    // The gate that matters in practice: one generation's encode phase is
    // shorter than the gate, so obsolete work cannot outlive a new input by
    // more than that span even when the new input arrives mid-pass.
    assert(
      longestSpanMs <= STOP_GATE_MS,
      `A generation's encode phase spanned ${longestSpanMs.toFixed(1)} ms, beyond the ${STOP_GATE_MS} ms stop gate`,
    );
    assert(outcome.second.rendered, `The newer generation did not present: ${JSON.stringify(outcome.second)}`);
    assert(outcome.transport === "WebGPU", `The newer generation presented ${outcome.transport}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
