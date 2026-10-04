// Denoise zoomed in: a grade edit reuses the tiles Denoise already reconstructed.
//
//   node tests/run-in-electron.js tests/denoise-tile-cache.js
//
// Adaptive Denoise reconstructs each tile from ungraded source pixels, so an
// Exposure edit changes nothing it reads. It used to reconstruct every tile on
// screen again for every such edit. This proves, at 100% on a 42 MP frame:
//
//   - an Exposure edit reconstructs no tile and draws from the kept ones;
//   - the picture drawn from kept tiles is the picture a fresh reconstruction
//     draws, to the pixel;
//   - a Denoise control, a pan to a new place and a geometry change each
//     reconstruct, so a kept tile never stands in for a stale one, and a
//     changed Denoise state keeps nothing until a second pass draws it;
//   - a new session keeps nothing, and the kept bytes are reported.

const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("./large-noisy-tiff.js");

const WIDTH = 7968;
const HEIGHT = 5320;

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
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", source);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

    const settle = async () => {
      await page.waitForTimeout(100);
      await page.waitForFunction(() => {
        const coordinator = state.renderCoordinator?.state(state.currentView);
        const accepted = state.acceptedPresentation;
        return viewerState().status === "ready" && !state.gpuDraftInFlight
          && !state.zoomRefinementTimer && !coordinator?.panTimerPending && !coordinator?.inFlight && !coordinator?.pending
          && accepted?.processedLongEdge === requiredProcessingLongEdge()
          && ["ready", "error", "off"].includes(state.denoiseRuntime[state.currentView].status);
      }, null, { timeout: 900000 });
      await page.evaluate(async () => state.gpuPreview.waitForSubmittedWork());
      await page.waitForTimeout(700);
    };
    const capture = async () => {
      const frame = await page.locator("#dropzone").boundingBox();
      const clip = { x: Math.round(frame.x) + 60, y: Math.round(frame.y) + 110, width: 400, height: 170 };
      return (await page.screenshot({ clip })).toString("base64");
    };
    const difference = (left, right) => page.evaluate(async ([a, b]) => {
      const pixels = async (encoded) => {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [x, y] = [await pixels(a), await pixels(b)];
      let max = 0;
      let differing = 0;
      for (let index = 0; index < x.length; index += 4) {
        const delta = Math.max(
          Math.abs(x[index] - y[index]), Math.abs(x[index + 1] - y[index + 1]), Math.abs(x[index + 2] - y[index + 2]),
        );
        if (delta > 0) differing += 1;
        if (delta > max) max = delta;
      }
      return { max, fraction: differing / (x.length / 4) };
    }, [left, right]);
    await page.evaluate(() => window.HDRFinisherPerformance.enableGpuInstrumentation(true));
    const stageCount = () => page.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot().stages?.length || 0);
    // The tiled passes after `since` that had Denoise in them, summed.
    const passes = (since) => page.evaluate((from) => {
      const drawn = (window.HDRFinisherPerformance.gpuSnapshot().stages || []).slice(from)
        .filter((stage) => stage.stage === "tiled-render" && (stage.denoiseTileResolves > 0 || stage.denoiseTileHits > 0));
      return {
        passes: drawn.length,
        resolves: drawn.reduce((sum, stage) => sum + stage.denoiseTileResolves, 0),
        hits: drawn.reduce((sum, stage) => sum + stage.denoiseTileHits, 0),
        durations: drawn.map((stage) => Math.round(stage.durationMs)),
        kept: state.gpuPreview.denoiseTiles.size,
        keptBytes: state.gpuPreview.resourceMemorySnapshot().resident.categories.denoiseTileBytes,
      };
    }, since);
    const redraw = async () => {
      await page.evaluate(() => {
        invalidatePreview(state.currentView, { markDirty: false });
        debouncePreview(state.currentView);
      });
      await settle();
    };
    const commit = async (path, value) => {
      await page.evaluate(([controlPath, next]) => commitAdjustmentValue(controlPath, next, { manual: true }), [path, value]);
      await settle();
    };

    await page.evaluate(() => {
      const group = document.querySelector(".denoise-group .group-toggle");
      if (group.getAttribute("aria-expanded") !== "true") group.click();
      const amount = document.querySelector("#denoise-amount");
      amount.value = "1";
      amount.dispatchEvent(new Event("input", { bubbles: true }));
      amount.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector("#denoise-bypass").click();
    });
    await settle();
    assert(await page.evaluate(() => state.denoiseRuntime[state.currentView].status) === "ready",
      "Denoise did not become ready at Fit.");
    // Held off so every pass below is the view's own region and nothing else.
    await page.evaluate(() => { state.renderCoordinator.canCatchUp = () => false; });

    let mark = await stageCount();
    await page.click("#zoom-actual");
    await settle();
    await page.evaluate(() => {
      els.dropzone.scrollLeft = 300;
      els.dropzone.scrollTop = 200;
      els.dropzone.dispatchEvent(new Event("scroll"));
    });
    await settle();
    const first = await passes(mark);
    assert(first.resolves > 0, `Denoise reconstructed nothing on the first zoom: ${JSON.stringify(first)}`);
    assert(first.kept > 0 && first.keptBytes > 0, `No denoised tile was kept: ${JSON.stringify(first)}`);

    // Exposure: nothing Denoise reads has changed.
    mark = await stageCount();
    await commit("hdr.exposure", 0.35);
    const graded = await passes(mark);
    assert(graded.passes > 0 && graded.hits > 0 && graded.resolves === 0,
      `An Exposure edit reconstructed Denoise again: ${JSON.stringify(graded)}`);
    const fromKept = await capture();

    // The same picture with every kept tile thrown away first.
    await page.evaluate(() => state.gpuPreview.dropDenoiseTiles());
    mark = await stageCount();
    await redraw();
    const fresh = await passes(mark);
    assert(fresh.resolves > 0 && fresh.hits === 0, `The fresh pass did not reconstruct: ${JSON.stringify(fresh)}`);
    const parity = await difference(fromKept, await capture());
    assert(parity.max === 0,
      `Kept tiles differ from a fresh reconstruction: max delta ${parity.max}, ${(parity.fraction * 100).toFixed(3)}%.`);

    // A Denoise control is part of what a tile is. Nearly off, because the
    // fixture's noise sits so far under the filter that 40% removes all of it
    // just as 100% does.
    mark = await stageCount();
    await page.evaluate(() => {
      const amount = document.querySelector("#denoise-amount");
      amount.value = "0.02";
      amount.dispatchEvent(new Event("input", { bubbles: true }));
      amount.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    const controlled = await passes(mark);
    assert(controlled.resolves > 0 && controlled.hits === 0,
      `A Denoise Amount change drew stale tiles: ${JSON.stringify(controlled)}`);
    assert(controlled.kept === 0, `A Denoise Amount change kept tiles for a state drawn once: ${JSON.stringify(controlled)}`);
    const weaker = await difference(fromKept, await capture());
    assert(weaker.max > 0, "A Denoise Amount change did not change the picture.");

    // A pan to a part of the picture not seen before.
    mark = await stageCount();
    await page.evaluate(() => {
      els.dropzone.scrollLeft = 3600;
      els.dropzone.scrollTop = 2400;
      els.dropzone.dispatchEvent(new Event("scroll"));
    });
    await settle();
    const panned = await passes(mark);
    assert(panned.resolves > 0, `A pan to a new place reconstructed nothing: ${JSON.stringify(panned)}`);
    // And an Exposure edit there is answered from what the pan kept.
    mark = await stageCount();
    await commit("hdr.exposure", 0.1);
    const regraded = await passes(mark);
    assert(regraded.hits > 0 && regraded.resolves === 0,
      `An Exposure edit after a pan reconstructed Denoise again: ${JSON.stringify(regraded)}`);

    // Geometry moves every pixel a tile holds.
    await page.click("#zoom-fit");
    await settle();
    await commit("shared.geometry.straighten_angle", 2);
    mark = await stageCount();
    await page.click("#zoom-actual");
    await settle();
    const straightened = await passes(mark);
    assert(straightened.resolves > 0 && straightened.hits === 0,
      `A straighten was drawn from tiles kept before it: ${JSON.stringify(straightened)}`);

    await page.evaluate(() => state.gpuPreview.resetSession(state.session.session_id));
    assert(await page.evaluate(() => state.gpuPreview.denoiseTiles.size) === 0, "A session reset kept denoised tiles.");

    assert(!pageErrors.length, "Page errors: " + pageErrors.join("; "));
    console.log(JSON.stringify({ first, graded, fresh, controlled, panned, regraded, straightened }));
    console.log(`Denoise tile cache: an Exposure edit reused ${graded.hits} tile(s) and reconstructed none, `
      + `identical to a fresh reconstruction; ${(first.keptBytes / 1048576).toFixed(0)} MiB kept.`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
