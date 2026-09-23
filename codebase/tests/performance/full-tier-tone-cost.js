// PERF-03 -- what one tone drag costs at the Full tier.
//
// Reported from manual testing: a tone drag at Full took about eight seconds
// against about half a second at 4K, with the CPU fan audible and the viewer
// black while it ran. The measured cause was the settle path answering a GPU
// draft that returned `superseded-during-render` with a whole-frame CPU render
// on the backend -- one `/preview/hdr` costing seven seconds, for a frame that
// a newer GPU draft was already about to replace.
//
// Being superseded is not a failure. It means a newer render is running. So
// the assertion here is about the backend, not about the clock alone: a tone
// drag at Full must issue no `/preview/hdr` while the GPU path is available.
// The clock is reported beside it because a fix that bought silence on the
// backend by hanging the viewer would pass the request assertion on its own --
// that is exactly how the first attempt at this failed.
//
//   node tests/performance/full-tier-tone-cost.js --url http://127.0.0.1:8765
//
// Acceptance, from PRD section 11b:
//   - no /preview/hdr request during a tone drag at Full
//   - time to Ready at Full within a small multiple of the 4K figure
//   - the viewer never presents an empty canvas during an interactive edit

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

// Big enough that Full is genuinely a different resolution from 4K and takes
// the tiled route on its own. 4200px renders Full on Direct on a roomy GPU and
// silently skips the path this measures.
const WIDTH = 7968;
const HEIGHT = 5320;

// A tone drag, shaped the way a hand actually moves a slider: short bursts at
// frame cadence with a hesitation between them.
//
// The shape matters more than the event count. The scheduler re-arms its
// settle timer on every input, so a drag whose events are closer together than
// `settleMs` (110 ms) never settles at all -- it renders once at the end,
// uninterrupted, and the race under test never happens. A pause longer than
// that starts the settle's multi-second tiled Full render, and the next burst
// then lands on top of it. That is the reported gesture.
const DRAG_BURSTS = 5;
const BURST_EVENTS = 6;
const DRAG_INTERVAL_MS = 16;
const BURST_PAUSE_MS = 260;

// "A small multiple", made a number. The reported gap was 14x (7916 / 565).
const READY_RATIO_LIMIT = 4;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 10) / 10;
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const outPath = argument("--out", null);
  const source = ensureLargeNoisySource(WIDTH, HEIGHT);

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // Every backend render, with what it cost. `/preview/hdr` is the whole-frame
  // CPU path; `/source-tile/*` and `/scopes` are recorded too so that a drop in
  // one is not mistaken for a drop in total machine cost (see PERF-04).
  const backend = [];
  const inFlight = new Map();
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (!/\/(preview(?:-raw)?\/(?:hdr|sdr)|source-tile\/\w+|scopes)$/.test(pathname)) return;
    inFlight.set(request, { pathname, startedAt: Date.now() });
  });
  page.on("requestfinished", (request) => {
    const entry = inFlight.get(request);
    if (!entry) return;
    inFlight.delete(request);
    backend.push({ ...entry, endedAt: Date.now(), ms: Date.now() - entry.startedAt });
  });

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", source);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

    const sourceSize = await page.evaluate(() => [state.session.source.width, state.session.source.height]);
    assert(sourceSize[0] === WIDTH,
      "The fixture did not import at its own size: " + JSON.stringify(sourceSize));
    assert(sourceSize[0] > 4096,
      "Full and 4K are the same tier for this source, so the comparison proves nothing: "
      + JSON.stringify(sourceSize));

    const measure = async (tier) => {
      await page.evaluate((value) => {
        const select = document.querySelector("#settings-preview-resolution");
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, tier);
      await page.waitForFunction(
        () => viewerState().status === "ready" && state.acceptedPresentation?.exact === true,
        null, { timeout: 900000 },
      );
      // Let the settle tail (inactive lane, scopes) drain, so its backend cost
      // is not charged to the drag that follows.
      await page.waitForTimeout(2500);

      const markStart = backend.length;
      await page.evaluate(() => {
        state.gpuDraftRefusals = {};
        state.cpuFallbacks = { settle: [], refine: [] };
      });

      // The drag itself, driven at frame cadence inside the page so the events
      // arrive the way a pointer delivers them.
      const drag = await page.evaluate(async ({ bursts, perBurst, interval, pause }) => {
        const control = document.getElementById("hdr-exposure")
          || document.querySelector('input[type="range"][data-path*="exposure"]');
        if (!control) return { error: "no exposure control found" };
        const original = Number(control.value);
        const step = Number(control.step || 0.01);

        // Whether the canvas is showing anything at all, sampled across the
        // gesture and the settle. A CPU fallback hides the canvas while it
        // runs, which is the reported black viewer.
        const blankSamples = [];
        const sampleBlank = () => {
          const canvas = document.getElementById("preview-canvas");
          const image = document.getElementById("preview-image");
          blankSamples.push(
            canvas.style.display === "none" && image.style.display === "none" ? 1 : 0,
          );
        };
        const blankTimer = setInterval(sampleBlank, 50);
        sampleBlank();

        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const startedAt = performance.now();
        // How many bursts actually landed on a running settled render. If this
        // is zero the gesture never reproduced the race, and a green result
        // below would mean nothing.
        let settleCaught = 0;
        state.previewScheduler?.beginInteraction?.();
        let index = 0;
        for (let burst = 0; burst < bursts; burst += 1) {
          for (let step_ = 0; step_ < perBurst; step_ += 1, index += 1) {
            control.value = String(original + ((index % 8) - 4) * step * 4);
            control.dispatchEvent(new Event("input", { bubbles: true }));
            await sleep(interval);
          }
          // The hesitation that lets a settle start, so the next burst can
          // land on top of a render that is already running.
          //
          // Waiting a fixed number of milliseconds here does not reproduce the
          // race reliably: the window runs from the settle timer firing until
          // the tiled render finishes, and how wide that is depends on the
          // machine and the picture. On a fast GPU and a cheap frame the whole
          // settle can complete inside a 260 ms pause, and the next burst then
          // lands on an idle device and supersedes nothing. So resume the
          // moment a settled draft is actually holding the device, and fall
          // back to the fixed pause if none appears.
          if (burst < bursts - 1) {
            const until = performance.now() + pause;
            let caught = false;
            while (performance.now() < until) {
              await sleep(4);
              // Any non-interactive draft: at Full the settle path labels its
              // render "refinement", because the settled proxy long edge has
              // already reached the refinement target. Interactive drafts are
              // refused instantly there and are not worth racing.
              if (state.gpuDraftInFlight && state.gpuDraftInFlightTier
                && state.gpuDraftInFlightTier !== "interactive") {
                caught = true;
                break;
              }
            }
            if (caught) settleCaught += 1;
          }
        }
        state.previewScheduler?.endInteraction?.();
        control.dispatchEvent(new Event("change", { bubbles: true }));

        // Time to Ready is measured from the release, which is the moment the
        // user stops moving and starts waiting.
        const releasedAt = performance.now();
        const deadline = releasedAt + 900000;
        while (viewerState().status !== "ready" && performance.now() < deadline) {
          await sleep(16);
        }
        const readyMs = performance.now() - releasedAt;
        clearInterval(blankTimer);
        sampleBlank();

        return {
          readyMs,
          settleCaught,
          // Release-to-Ready is zero whenever the viewer happened to be idle at
          // the moment of release, which makes it useless as a denominator.
          // Gesture-to-Ready is the whole wait the user actually sits through
          // and is defined at every tier.
          gestureMs: performance.now() - startedAt,
          timedOut: viewerState().status !== "ready",
          blankSamples: blankSamples.length,
          blankObserved: blankSamples.reduce((sum, value) => sum + value, 0),
          refusals: { ...state.gpuDraftRefusals },
          cpuFallbacks: JSON.parse(JSON.stringify(state.cpuFallbacks)),
          lastRenderRefusal: state.gpuPreview?.lastRenderRefusal?.reason || null,
          accepted: {
            tier: state.acceptedPresentation?.tier,
            requestedTier: state.acceptedPresentation?.requestedTier,
            exact: state.acceptedPresentation?.exact,
            transport: state.acceptedPresentation?.transport,
            execution: state.acceptedPresentation?.execution,
            processedLongEdge: state.acceptedPresentation?.processedLongEdge,
          },
        };
      }, {
        bursts: DRAG_BURSTS,
        perBurst: BURST_EVENTS,
        interval: DRAG_INTERVAL_MS,
        pause: BURST_PAUSE_MS,
      });

      assert(!drag.error, "Drag could not run: " + drag.error);

      const during = backend.slice(markStart);
      const group = (pattern) => {
        const rows = during.filter((entry) => pattern.test(entry.pathname));
        return { count: rows.length, ms: rows.reduce((sum, entry) => sum + entry.ms, 0) };
      };
      return {
        tier,
        readyMs: round(drag.readyMs),
        gestureMs: round(drag.gestureMs),
        settleCaught: drag.settleCaught,
        timedOut: drag.timedOut,
        blankObserved: drag.blankObserved,
        blankSamples: drag.blankSamples,
        accepted: drag.accepted,
        refusals: drag.refusals,
        cpuFallbacks: drag.cpuFallbacks,
        lastRenderRefusal: drag.lastRenderRefusal,
        previewHdr: group(/\/preview(?:-raw)?\/hdr$/),
        previewSdr: group(/\/preview(?:-raw)?\/sdr$/),
        sourceTiles: group(/\/source-tile\//),
        scopes: group(/\/scopes$/),
      };
    };

    const results = [];
    for (const tier of ["4096", "full"]) results.push(await measure(tier));

    for (const row of results) {
      console.log(
        row.tier.padEnd(5),
        "gesture " + String(row.gestureMs).padStart(8) + " ms",
        "| settle " + String(row.readyMs).padStart(8) + " ms",
        "| /preview/hdr " + String(row.previewHdr.count).padStart(2)
          + " (" + String(row.previewHdr.ms).padStart(5) + " ms)",
        "| source-tile " + String(row.sourceTiles.count).padStart(2)
          + " (" + String(row.sourceTiles.ms).padStart(5) + " ms)",
        "| scopes " + String(row.scopes.count).padStart(2)
          + " (" + String(row.scopes.ms).padStart(5) + " ms)",
        "| exec " + String(row.accepted.execution),
        "| blank " + row.blankObserved + "/" + row.blankSamples,
        "| caught " + row.settleCaught,
      );
      console.log("      refusals " + JSON.stringify(row.refusals));
      console.log("      cpu fallbacks " + JSON.stringify(row.cpuFallbacks)
        + "  last renderer refusal: " + row.lastRenderRefusal);
    }

    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify({ source: { width: WIDTH, height: HEIGHT }, results }, null, 2));
      console.log("Wrote " + outPath);
    }

    const four = results.find((row) => row.tier === "4096");
    const full = results.find((row) => row.tier === "full");

    assert(pageErrors.length === 0, "Page errors: " + JSON.stringify(pageErrors));

    // Liveness first. A fix that stops the backend request by never settling
    // would satisfy every other assertion here, and that is the failure mode
    // the first attempt at PERF-03 actually had.
    assert(!full.timedOut, "The viewer never reached Ready at Full after the drag.");
    assert(full.accepted.exact === true && full.accepted.requestedTier === "full",
      "Full did not settle on an exact Full frame: " + JSON.stringify(full.accepted));

    // The path under test. Full must tile; a Direct Full render never reaches
    // the settle race this is about.
    assert(full.accepted.execution === "tiled",
      "Full did not take the tiled route, so the path under test was not exercised: "
      + JSON.stringify(full.accepted));

    // The gesture has to have reproduced the race, or everything below is
    // green for the wrong reason.
    assert(full.settleCaught > 0,
      "No burst landed on a running settled render, so the race under test never "
      + "happened and this run proves nothing.");

    // A Full frame that cannot fit even the minimum Direct graph must be
    // refused before source preparation or renderer submission. Counting the
    // old renderer-returned-nothing refusal would mean the guard ran too late.
    assert((full.refusals["interactive:pre-dispatch-tiled"] || 0) > 0,
      "No guaranteed-tiled interactive draft was refused before dispatch: "
      + JSON.stringify(full.refusals));
    assert((full.refusals["interactive:renderer-returned-nothing"] || 0) === 0,
      "A guaranteed-tiled interactive draft still reached the renderer: "
      + JSON.stringify(full.refusals));

    // The settle path taking its CPU branch is the defect, and it is the
    // reliable observable. Whether that branch then reaches the network
    // depends on incidental preview-cache state, so asserting only on the
    // request would let the bug through on a machine that happened to have a
    // usable cached frame.
    assert(full.cpuFallbacks.settle.length === 0,
      "The settle path fell back to a whole-frame CPU render "
      + full.cpuFallbacks.settle.length + " time(s) at Full: "
      + JSON.stringify(full.cpuFallbacks.settle)
      + ". Refusals: " + JSON.stringify(full.refusals));

    assert(full.previewHdr.count === 0,
      "A tone drag at Full fell back to whole-frame CPU rendering: "
      + full.previewHdr.count + " /preview/hdr request(s) costing "
      + full.previewHdr.ms + " ms, while the GPU path was available. "
      + "Refusals: " + JSON.stringify(full.refusals));

    assert(full.blankObserved === 0,
      "The viewer presented an empty canvas during the edit: "
      + full.blankObserved + " of " + full.blankSamples
      + " samples showed neither canvas nor image.");

    assert(full.gestureMs <= four.gestureMs * READY_RATIO_LIMIT,
      "Time to Ready at Full is not within " + READY_RATIO_LIMIT + "x of 4K: "
      + full.gestureMs + " ms against " + four.gestureMs + " ms ("
      + round(full.gestureMs / four.gestureMs) + "x).");

    console.log(
      "A tone drag at Full stays on the GPU: " + full.gestureMs + " ms against "
      + four.gestureMs + " ms at 4K (" + round(full.gestureMs / four.gestureMs)
      + "x), no CPU frame.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
