// Denoise must be switchable off at every tier, including Full.
//
// Reported from manual testing: at the Full tier the Denoise bypass control did
// nothing -- the picture stayed denoised however the toggle was set. Full is the
// tier whose renders go through the tiled path, and that path reconstructed
// denoise from the evidence cache whenever a cache existed, without consulting
// the selector's `selected` switch that the Direct path honours. A cache
// deliberately outlives the toggle so that re-enabling is free, so every tiled
// render came out denoised.
//
// This compares the presented pixels with denoise on against the same frame
// with it bypassed, at each tier, on a generated source big enough that Full
// and 4K are genuinely different resolutions. It asserts that the toggle moves
// pixels, and reports the magnitude so a weak effect is distinguishable from
// none.
//
//   node tests/full-tier-denoise.js --url http://127.0.0.1:8765

const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("./large-noisy-tiff.js");

// Big enough that the Full tier takes the tiled route on its own. A smaller
// source renders Full on the Direct path on a roomy GPU, which silently skips
// the path this test exists for.
const WIDTH = 7968;
const HEIGHT = 5320;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Denoising this gradient at full strength moves about 4% of the frame: the
// picture is mostly smooth, and only the noisy detail changes. A broken bypass
// produces an exact match -- zero differing pixels -- so the bar only has to
// sit clear of stray rounding, which it does by three orders of magnitude.
const MIN_DIFFERING_FRACTION = 0.005;

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
  page.on("pageerror", (error) => pageErrors.push(error.message));

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
      "Full and 4K are the same tier for this source, so the test proves nothing: " + JSON.stringify(sourceSize));

    // 1:1 pixels. A fitted view downsamples the canvas into the viewport, which
    // averages away exactly the fine noise being measured.
    await page.click("#zoom-actual");
    await page.waitForTimeout(500);

    const setTier = async (tier) => {
      await page.evaluate((value) => {
        const select = document.querySelector("#settings-preview-resolution");
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, tier);
      await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });
      await page.waitForTimeout(1200);
    };

    const setDenoise = async (enabled) => {
      await page.evaluate(async (want) => {
        const group = document.querySelector(".denoise-group .group-toggle");
        if (group.getAttribute("aria-expanded") !== "true") group.click();
        if (want) {
          // Set the strength while bypassed; the handler updates state without
          // launching a resolve, then enable performs one complete analysis
          // and render with that value.
          const amount = document.querySelector("#denoise-amount");
          amount.value = "1";
          amount.dispatchEvent(new Event("input", { bubbles: true }));
          amount.dispatchEvent(new Event("change", { bubbles: true }));
        }
        // The button's click listener delegates to this same async action but
        // DOM dispatch cannot expose its promise. Await the action directly so
        // a screenshot can never race the GPU render it starts.
        if (state.denoise[state.currentView].enabled !== want) {
          await setDenoiseEnabled(want);
        }
      }, enabled);
      if (enabled) {
        await page.waitForFunction(
          () => ["ready", "error"].includes(state.denoiseRuntime[state.currentView].status),
          null, { timeout: 900000 },
        );
      }
      await page.evaluate(async () => state.gpuPreview.waitForSubmittedWork());
      await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });
    };

    const capture = async () => page.locator("#preview-canvas").screenshot({
      clip: { x: 0, y: 0, width: 512, height: 512 },
    });

    const compare = async (a, b) => page.evaluate(async ({ first, second }) => {
      const decode = async (base64) => {
        const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + base64)).blob());
        const surface = document.createElement("canvas");
        surface.width = bitmap.width;
        surface.height = bitmap.height;
        const context = surface.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const one = await decode(first);
      const two = await decode(second);
      let differing = 0;
      let maxDelta = 0;
      let total = 0;
      for (let index = 0; index < one.data.length; index += 4) {
        let pixelDelta = 0;
        for (let channel = 0; channel < 3; channel += 1) {
          pixelDelta = Math.max(pixelDelta, Math.abs(one.data[index + channel] - two.data[index + channel]));
        }
        if (pixelDelta > 0) differing += 1;
        maxDelta = Math.max(maxDelta, pixelDelta);
        total += 1;
      }
      return { differing, total, maxDelta, fraction: differing / total };
    }, { first: a.toString("base64"), second: b.toString("base64") });

    // Which route a tier takes depends on the machine's memory budget -- this
    // fixture renders Full on the Direct route on a roomy GPU, which would
    // quietly skip the path that was broken. The Direct/Tiled switch pins it,
    // so both routes are exercised on every machine.
    const setExecution = async (mode) => {
      await page.evaluate((value) => applyExecutionOverride(value), mode);
      await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });
      await page.waitForTimeout(1200);
    };

    const results = [];
    // Both rows pin their route: since Auto uses half the detected video
    // memory (tuning sprint P2), Full can fit Direct and would skip the path.
    for (const [tier, execution] of [["4096", "direct"], ["full", "tiled"]]) {
      await setTier(tier);
      if (execution) await setExecution(execution);
      await setDenoise(true);
      const on = await capture();
      const diagnostics = await page.evaluate(() => {
        const denoise = state.gpuPreview.diagnosticsSnapshot().denoise;
        return {
          execution: state.acceptedPresentation?.execution,
          processed: state.acceptedPresentation?.processedLongEdge,
          selected: denoise.selectedSource,
          cacheReady: denoise.cacheReady,
          runtime: state.denoiseRuntime[state.currentView].status,
          runtimeError: state.denoiseRuntime[state.currentView].error,
        };
      });
      await setDenoise(false);
      const off = await capture();
      const bypassed = await page.evaluate(() => state.gpuPreview.diagnosticsSnapshot().denoise.selectedSource);
      const delta = await compare(on, off);
      const identical = crypto.createHash("sha256").update(on).digest("hex")
        === crypto.createHash("sha256").update(off).digest("hex");
      results.push({ tier, execution, identical, ...delta, diagnostics, bypassed });
      console.log(
        tier.padEnd(5),
        "exec " + String(diagnostics.execution).padEnd(6),
        "processed " + String(diagnostics.processed).padEnd(5),
        "selected " + String(diagnostics.selected) + "->" + String(bypassed),
        "maxDelta " + String(delta.maxDelta).padStart(3),
        "differing " + delta.differing + "/" + delta.total + " (" + (delta.fraction * 100).toFixed(2) + "%)",
        delta.fraction >= MIN_DIFFERING_FRACTION ? "PASS" : "*** BYPASS DOES NOTHING ***",
      );
    }

    assert(pageErrors.length === 0, "Page errors: " + JSON.stringify(pageErrors));
    // Each row must have run the route it claims, or a green result would mean
    // only that the broken path was never reached.
    const mismatched = results.filter((entry) => entry.execution && entry.diagnostics.execution !== entry.execution);
    assert(mismatched.length === 0,
      "A route was requested and not taken, so the path under test was not exercised: "
      + JSON.stringify(mismatched.map((entry) => ({ tier: entry.tier, wanted: entry.execution, got: entry.diagnostics.execution }))));

    // The Full row is the one that matters, and it only matters if it tiled.
    const full = results.find((entry) => entry.tier === "full");
    assert(full.diagnostics.execution === "tiled",
      "Full did not take the tiled route, so the path under test was not exercised: "
      + JSON.stringify(full.diagnostics));

    const dead = results.filter((entry) => entry.fraction < MIN_DIFFERING_FRACTION);
    assert(dead.length === 0,
      "Denoise could not be switched off at: " + JSON.stringify(dead, null, 2));
    console.log("Denoise switches off at every tier, including Full.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
