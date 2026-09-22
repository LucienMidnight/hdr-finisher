// Phase 1.5 -- Section 5.8 failure policy: a recoverable failure must not
// disable WebGPU for the session, and the accepted frame must survive it.
//
//   node tests/performance/failure-taxonomy.js --url http://127.0.0.1:8765
//
// Negative controls:
//   - a synthetic transport failure leaves `available` true and records the
//     failure as recoverable
//   - the viewer returns to a WebGPU presentation once the failure is removed
//   - only repeated unrecoverable validation failure disables WebGPU

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BLANK_LEVEL = 4;

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

async function injectFailure(page, message) {
  await page.evaluate((text) => {
    if (!window.__originalGpuRender) window.__originalGpuRender = state.gpuPreview.render;
    state.gpuPreview.render = async () => { throw new TypeError(text); };
  }, message);
}

async function clearFailure(page) {
  await page.evaluate(() => {
    if (window.__originalGpuRender) state.gpuPreview.render = window.__originalGpuRender;
  });
}

async function settleAndWait(page, timeout = 120000) {
  await page.evaluate(() => settlePreview(state.currentView).catch(() => null));
  await page.waitForFunction(() => viewerState().status === "ready", null, { timeout });
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const output = argument("--output", path.join("output", "performance", "failure-taxonomy.json"));
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
    const paintedBefore = await compositorPeak(page);
    assert(paintedBefore > BLANK_LEVEL, `The baseline frame was blank: ${paintedBefore}`);

    // A synthetic transport failure must be recorded as recoverable and must
    // leave the device enabled.
    await injectFailure(page, "Failed to fetch");
    await settleAndWait(page);
    const afterTransport = await page.evaluate(() => ({
      available: state.gpuPreview.available,
      viewer: viewerState(),
      policy: state.gpuFailurePolicy?.snapshot() || null,
    }));
    assert(
      afterTransport.available === true,
      "A transport failure disabled WebGPU for the session",
    );
    assert(
      (afterTransport.policy?.records || []).some((record) => record.kind === "transport"),
      `The transport failure was not classified: ${JSON.stringify(afterTransport.policy)}`,
    );
    assert(
      afterTransport.policy?.disabled === false,
      `A recoverable failure disabled the policy: ${JSON.stringify(afterTransport.policy)}`,
    );

    // Removing the failure must return the viewer to a WebGPU presentation.
    await clearFailure(page);
    await settleAndWait(page);
    const recovered = await page.evaluate(() => ({
      available: state.gpuPreview.available,
      transport: state.acceptedPresentation?.transport || null,
      policy: state.gpuFailurePolicy?.snapshot() || null,
    }));
    assert(recovered.available === true, "WebGPU did not recover after the failure was removed");
    assert(recovered.transport === "WebGPU", `Recovery presented ${recovered.transport}`);
    assert(
      recovered.policy?.consecutiveValidation === 0,
      `A successful render did not reset the validation chain: ${JSON.stringify(recovered.policy)}`,
    );
    const paintedAfter = await compositorPeak(page);
    assert(paintedAfter > BLANK_LEVEL, `The recovered frame was blank: ${paintedAfter}`);

    // The one permitted sticky path: repeated validation failure.
    await injectFailure(page, "validation error: invalid value in setPipeline");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.evaluate(() => settlePreview(state.currentView).catch(() => null));
      await page.waitForTimeout(400);
      const available = await page.evaluate(() => state.gpuPreview.available);
      if (!available) break;
    }
    const afterValidation = await page.evaluate(() => ({
      available: state.gpuPreview.available,
      policy: state.gpuFailurePolicy?.snapshot() || null,
    }));
    assert(
      afterValidation.available === false,
      `Repeated validation failure did not disable WebGPU: ${JSON.stringify(afterValidation.policy)}`,
    );
    assert(
      afterValidation.policy?.disabled === true
        && afterValidation.policy.consecutiveValidation >= afterValidation.policy.validationThreshold,
      `The disable decision was not recorded: ${JSON.stringify(afterValidation.policy)}`,
    );

    const summary = {
      url,
      paintedBefore,
      afterTransport,
      recovered,
      paintedAfter,
      afterValidation,
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
