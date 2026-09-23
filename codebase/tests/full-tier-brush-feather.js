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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", source);
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available, null, { timeout: 300000 });

    await page.evaluate(async () => {
      state.adjustments.hdr.film_look_section_enabled = true;
      state.adjustments.hdr.film_look.bloom_enabled = true;
      state.adjustments.hdr.film_look.bloom_amount = 12;
      state.adjustments.hdr.film_look.bloom_radius = 0.6;
      await queueEditCommand("set_global_adjustments", {
        adjustments: JSON.parse(JSON.stringify(state.adjustments)),
      });
      const select = document.querySelector("#settings-preview-resolution");
      select.value = "full";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => viewerState().status === "ready"
      && state.acceptedPresentation?.requestedTier === "full", null, { timeout: 600000 });

    await page.locator("#grade-mode-local").click();
    const createResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.locator('[data-local-tool="brush"]').click();
    await page.locator("#local-add-adjustment").click();
    assert((await createResponse).ok(), "Creating the brush adjustment failed.");

    const overlay = page.locator("#local-mask-overlay");
    const box = await overlay.boundingBox();
    assert(box, "The brush overlay has no bounds.");
    const paintResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.55, { steps: 12 });
    await page.mouse.up();
    assert((await paintResponse).ok(), "Painting the brush stroke failed.");
    await page.waitForFunction(() => !state.localMaskDraftDirty && viewerState().status === "ready", null, { timeout: 600000 });

    // Reproduce the latest-wins race from the report deterministically. The
    // first settled generation loses ownership while loading the changed
    // mask. Full must keep the last valid GPU presentation and let refinement
    // retry; asking bounded CPU to take this graph produces the false
    // "local adjustments, spatial film effects" Unavailable message.
    await page.evaluate(() => {
      const render = state.gpuPreview.render.bind(state.gpuPreview);
      let injected = false;
      state.gpuPreview.render = async (...args) => {
        const sourceOptions = args.at(-1);
        if (!injected && sourceOptions?.tier === "settled") {
          injected = true;
          state.gpuPreview.lastRenderRefusal = { reason: "superseded-after-masks", at: performance.now() };
          return false;
        }
        return render(...args);
      };
      const unavailable = markPreviewUnavailable;
      window.__fullFeatherUnavailableEvents = [];
      markPreviewUnavailable = (reason) => {
        window.__fullFeatherUnavailableEvents.push(String(reason));
        return unavailable(reason);
      };
    });

    const feather = page.locator(".local-mask-subpanel").nth(1)
      .locator(".local-brush-control", { hasText: "Feather" }).locator('input[type="range"]');
    await feather.evaluate((input) => {
      input.value = "60";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    }, null, { timeout: 120000 });
    const commitResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST");
    await feather.evaluate((input) => input.dispatchEvent(new Event("change", { bubbles: true })));
    assert((await commitResponse).ok(), "Committing feather failed.");
    await page.waitForFunction(() => !state.localMaskDraftDirty, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 600000 });

    const result = await page.evaluate(() => ({
      viewer: viewerState(),
      accepted: state.acceptedPresentation,
      gpuAvailable: state.gpuPreview?.available,
      gpuDetail: state.gpuPreview?.detail,
      lastGpuRefusal: state.lastGpuDraftRefusal,
      rendererRefusal: state.gpuPreview?.lastRenderRefusal,
      renderPlan: state.gpuPreview?.lastRenderPlan,
      feather: selectedLocal()?.mask?.leaf?.mask_feather,
      unavailableEvents: window.__fullFeatherUnavailableEvents,
    }));
    console.log(JSON.stringify(result, null, 2));
    assert(pageErrors.length === 0, `Page errors: ${JSON.stringify(pageErrors)}`);
    assert(result.viewer.status !== "unavailable", `Full became unavailable after brush feather: ${JSON.stringify(result)}`);
    assert(result.viewer.status === "ready", `Full did not settle after brush feather: ${JSON.stringify(result)}`);
    assert(result.unavailableEvents.length === 0,
      `A superseded GPU generation was incorrectly sent to bounded CPU: ${JSON.stringify(result.unavailableEvents)}`);
    assert(Math.abs(result.feather - 0.03) < 1e-9, `Feather did not persist: ${result.feather}`);

    // The reported follow-up: after the brush exists, changing its grade must
    // survive the edit-revision handoff while Full is forced through Tiled.
    await page.evaluate(() => applyExecutionOverride("tiled"));
    await page.waitForFunction(() => state.acceptedPresentation?.execution === "tiled"
      && viewerState().status === "ready", null, { timeout: 600000 });
    const exposure = page.locator('[data-local-grade="exposure"]');
    await exposure.evaluate((input) => {
      input.value = "1";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const exposureCommit = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST");
    await exposure.evaluate((input) => input.dispatchEvent(new Event("change", { bubbles: true })));
    assert((await exposureCommit).ok(), "Committing local exposure failed.");
    await page.waitForFunction(() => viewerState().status === "ready"
      && selectedLocal()?.hdr_grade?.exposure === 1, null, { timeout: 600000 });
    const exposureResult = await page.evaluate(() => ({
      viewer: viewerState(),
      accepted: state.acceptedPresentation,
      refusal: state.lastGpuDraftRefusal,
      rendererRefusal: state.gpuPreview?.lastRenderRefusal,
      unavailableEvents: window.__fullFeatherUnavailableEvents,
    }));
    console.log(JSON.stringify({ exposureResult }, null, 2));
    assert(exposureResult.viewer.status !== "unavailable",
      `Full became unavailable after local exposure: ${JSON.stringify(exposureResult)}`);
    assert(exposureResult.unavailableEvents.length === 0,
      `Local exposure incorrectly fell back to bounded CPU: ${JSON.stringify(exposureResult)}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
