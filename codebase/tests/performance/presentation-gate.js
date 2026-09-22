// Phase 1.4 -- concurrent generations must not resize the presentation target
// another generation is encoding against.
//
//   node tests/performance/presentation-gate.js --url http://127.0.0.1:8765
//
// Recorded repro from the mask-transport checkpoint: forcing tiled and then
// issuing a second tiled render at a different resolution produced
//
//   validation: Scissor rect (x: 512, y: 512, width: 512, height: 208) is not
//   contained in the render area dimensions {width: 1024, height: 576}
//
// because one generation resized the drawing buffer while the other was
// encoding against the previous size. The presentation gate makes resize and
// submission a per-canvas critical section and refuses a superseded generation
// before it touches the frame.
//
// Negative controls:
//   - no refusal may be a device validation error
//   - the presented canvas must match the winning generation's proxy size
//   - a superseded same-size generation must never blank the accepted frame
//   - a superseded generation must not change the canvas size

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BLANK_LEVEL = 4;
const SAMPLE_INTERVAL_MS = 40;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function compositorPeak(page) {
  const box = await page.locator("#preview-canvas").boundingBox();
  if (!box || !(box.width > 0 && box.height > 0)) return 0;
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    let value = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      value = Math.max(value, pixels[index], pixels[index + 1], pixels[index + 2]);
    }
    return value;
  }, `data:image/png;base64,${png.toString("base64")}`);
}

async function runConcurrent(page, longEdges) {
  await page.evaluate((edges) => {
    window.__presentationGateOutcome = null;
    const calls = edges.map((edge) => window.HDRFinisherPerformance.renderTiledTier(edge));
    Promise.allSettled(calls).then((settled) => {
      const canvas = document.getElementById("preview-canvas");
      window.__presentationGateOutcome = {
        results: settled.map((entry) => (entry.status === "fulfilled"
          ? entry.value
          : { rendered: false, refusals: [String(entry.reason)] })),
        canvas: { width: canvas.width, height: canvas.height },
        refusal: state.gpuPreview?.lastRenderRefusal || null,
        viewer: viewerState(),
      };
    });
  }, longEdges);
  const samples = [];
  for (let index = 0; index < 80; index += 1) {
    samples.push(await compositorPeak(page));
    const done = await page.evaluate(() => Boolean(window.__presentationGateOutcome));
    if (done) break;
    await page.waitForTimeout(SAMPLE_INTERVAL_MS);
  }
  const outcome = await page.evaluate(() => window.__presentationGateOutcome);
  assert(outcome, "The concurrent generation pair never settled.");
  return { outcome, samples };
}

function refusalsOf(outcome) {
  return outcome.results.flatMap((result) => result?.refusals || []);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const output = argument("--output", path.join("output", "performance", "presentation-gate.json"));
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
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 120000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 120000 });
    await page.evaluate(() => applyExecutionOverride("tiled"));
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });

    // Settle at 512 so both later pairs start from a known, different size.
    const settled = await page.evaluate(async () => {
      const result = await window.HDRFinisherPerformance.renderTiledTier(512);
      const canvas = document.getElementById("preview-canvas");
      return {
        rendered: Boolean(result && result.rendered),
        refusals: (result && result.refusals) || [],
        canvas: { width: canvas.width, height: canvas.height },
      };
    });
    assert(settled.rendered, `The settling render failed: ${JSON.stringify(settled.refusals)}`);

    // Same-size pair: the winner needs no resize, so the accepted frame must
    // stay painted for the whole overlap even though the first call is
    // superseded. Both calls register their render serial synchronously, so
    // the first is always the stale one.
    const sameSize = await runConcurrent(page, [512, 512]);
    assert(
      sameSize.samples.every((peak) => peak > BLANK_LEVEL),
      `A same-size superseded generation blanked the accepted frame: ${JSON.stringify(sameSize.samples)}`,
    );
    assert(
      sameSize.outcome.results[0]?.rendered === false,
      `The superseded same-size generation still presented: ${JSON.stringify(sameSize.outcome.results[0])}`,
    );
    assert(
      sameSize.outcome.results[1]?.rendered === true,
      `The newest same-size generation did not present: ${JSON.stringify(sameSize.outcome.results[1])}`,
    );
    assert(
      !refusalsOf(sameSize.outcome).some((reason) => String(reason).includes("validation")),
      `A device validation error was refused instead of prevented: ${JSON.stringify(refusalsOf(sameSize.outcome))}`,
    );
    assert(
      sameSize.outcome.canvas.width === 512 && sameSize.outcome.canvas.height === 288,
      `The same-size pair left the canvas at ${JSON.stringify(sameSize.outcome.canvas)}`,
    );

    // Different-size pair from a 512 canvas: the winner resizes, the superseded
    // generation must refuse before it can. This is the recorded repro.
    const differentSize = await runConcurrent(page, [1024, 1280]);
    const validationRefusals = refusalsOf(differentSize.outcome)
      .filter((reason) => String(reason).includes("validation"));
    assert(
      validationRefusals.length === 0,
      `A generation encoded against another generation's canvas size: ${JSON.stringify(validationRefusals)}`,
    );
    assert(
      String(refusalsOf(differentSize.outcome).join(",")).includes("superseded-before-presentation"),
      `The superseded generation was not refused by the gate: ${JSON.stringify(refusalsOf(differentSize.outcome))}`,
    );
    assert(
      differentSize.outcome.results[1]?.rendered === true,
      `The newest different-size generation did not present: ${JSON.stringify(differentSize.outcome.results[1])}`,
    );
    assert(
      differentSize.outcome.canvas.width === 1280 && differentSize.outcome.canvas.height === 720,
      `The different-size pair left the canvas at ${JSON.stringify(differentSize.outcome.canvas)}`,
    );
    const finalPeak = await compositorPeak(page);
    assert(finalPeak > BLANK_LEVEL, `The canvas was blank after the concurrent pair: ${finalPeak}`);

    const summary = {
      url,
      settled,
      sameSize: {
        results: sameSize.outcome.results,
        canvas: sameSize.outcome.canvas,
        minSampledPeak: Math.min(...sameSize.samples),
        samples: sameSize.samples.length,
      },
      differentSize: {
        results: differentSize.outcome.results,
        canvas: differentSize.outcome.canvas,
        refusals: refusalsOf(differentSize.outcome),
        finalPeak,
      },
      pageErrors,
    };
    assert(pageErrors.length === 0, `Page errors were raised: ${JSON.stringify(pageErrors)}`);
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
