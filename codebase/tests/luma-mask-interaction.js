const { chromium } = require("playwright");
const path = require("path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function redOverlayPixels(locator) {
  return locator.evaluate((canvas) => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 120 && pixels[index] > pixels[index + 1] * 1.5 && pixels[index + 3] > 8) count += 1;
    }
    return count;
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);
    await page.locator("#grade-mode-local").click();

    const brushCreateResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
    );
    await page.locator('[data-local-tool="brush"]').click();
    await brushCreateResponse;
    assert(await page.locator(".local-adjustment-item").count() === 1, "Brush setup adjustment was not created.");

    const createResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
    );
    const gpuResident = await page.evaluate(() => Boolean(state.gpuPreview?.available));
    const exactMaskResponse = gpuResident ? null : page.waitForResponse((response) =>
      /\/local-mask\/[^/]+\?/.test(response.url()) && response.request().method() === "GET" && response.status() === 200,
    );
    await page.locator('[data-local-tool="luminance_range"]').click();
    const lumaCreated = await createResponse;
    const createdLeaf = lumaCreated.request().postDataJSON().commands[0].payload.local.mask.leaf;
    assert(!("luma_sampling_initialized" in createdLeaf), "Luma creation leaked client-only sampling state into the API payload.");
    await page.waitForFunction(() => document.querySelectorAll(".local-adjustment-item").length === 2);
    assert(await page.locator(".local-adjustment-item").count() === 2, "Clicking Luma after another mask did not create a new adjustment.");
    if (process.env.HDR_FINISHER_CREATION_ONLY === "1") {
      console.log(JSON.stringify({ adjustmentCount: 2, lumaType: createdLeaf.type, backwardCompatiblePayload: true }));
      return;
    }
    await page.waitForFunction(() => document.querySelectorAll(".luma-nit-range").length === 2);

    assert(await page.locator(".local-mask-subpanel-heading strong").first().textContent() === "Luma Controls", "The standalone section is not titled Luma Controls.");
    assert(await page.locator(".luma-preset-button").count() === 7, "The false-color quick ranges are incomplete.");
    assert(await page.locator(".luma-reference-range input").count() === 2, "The reference-nit range does not expose two edge handles.");
    assert(await page.locator(".luma-refine-range input").count() === 2, "The refined range does not expose two inward handles.");
    assert(await page.locator(".local-brush-control .instrument-control-label", { hasText: "Feather" }).count() === 1, "Luma Feather is missing.");
    assert(await page.locator("#local-show-mask").getAttribute("aria-pressed") === "true", "A new luma mask did not enable its overlay.");

    if (exactMaskResponse) {
      const exactMask = await exactMaskResponse;
      assert((await exactMask.body()).length > 1000, "The authoritative luma overlay was empty.");
    }
    await page.waitForTimeout(100);
    const overlay = page.locator("#local-mask-overlay");
    if (gpuResident) {
      const resources = await page.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot().resources);
      assert(resources.sceneLuminanceTextures > 0 && resources.localMasks > 0, `The GPU-resident luma overlay was not retained: ${JSON.stringify(resources)}`);
    } else {
      assert(await redOverlayPixels(overlay) > 100, "The authoritative luma mask was not painted into the viewport overlay.");
    }

    const previewBox = await overlay.boundingBox();
    assert(previewBox && previewBox.width > 100 && previewBox.height > 100, "The preview is unavailable for luma sampling.");
    assert(await page.evaluate(() => !isLuminanceSamplingInitialized(firstMaskLeaf(selectedLocal().mask, "luminance_range"))), "A new luma mask was marked sampled before the first picker gesture.");
    const sampleResponse = page.waitForResponse((response) =>
      response.url().endsWith("/local-luminance-sample") && response.request().method() === "POST" && response.status() === 200,
    );
    const sampleCommit = page.waitForResponse((response) =>
      response.url().includes("/edit-commands")
        && response.request().method() === "POST"
        && response.request().postDataJSON()?.commands?.some((command) => command.payload?.local?.mask?.leaf?.full_end_ev < 0),
    );
    // The former large range gizmo occupied this upper strip. It must now be
    // ordinary picker space rather than intercepting the gesture as a handle.
    await overlay.click({ position: { x: previewBox.width * 0.28, y: previewBox.height * 0.14 } });
    const sampled = await (await sampleResponse).json();
    const sampleCommitResponse = await sampleCommit;
    assert(sampleCommitResponse.status() === 200, `Luma sample commit failed: ${await sampleCommitResponse.text()}`);
    const committedSampleLeaf = sampleCommitResponse.request().postDataJSON().commands[0].payload.local.mask.leaf;
    assert(committedSampleLeaf.full_end_ev < 0, `Luma sample did not narrow the serialized range: ${JSON.stringify(committedSampleLeaf)}`);
    await page.waitForFunction((sampleHigh) => {
      const inputs = document.querySelectorAll(".luma-reference-range input");
      return inputs.length === 2 && Number(inputs[1].value) <= sampleHigh + 0.02;
    }, sampled.high_ev);
    const innerAfterAdd = await page.locator(".luma-reference-range input").evaluateAll((inputs) => [Number(inputs[0].value), Number(inputs[1].value)]);
    const referenceWhite = await page.evaluate(() => state.editDocument.hdr_reference_white_nits);
    const expectedSampleLow = Math.max(sampled.low_ev, Math.log2(0.1 / referenceWhite));
    assert(
      Math.abs(innerAfterAdd[0] - expectedSampleLow) < 0.011 && Math.abs(innerAfterAdd[1] - sampled.high_ev) < 0.011,
      `First picker sample did not replace the initial bounds: ${JSON.stringify({ sampled, innerAfterAdd })}`,
    );

    const removeResponse = page.waitForResponse((response) =>
      response.url().endsWith("/local-luminance-sample") && response.request().method() === "POST" && response.status() === 200,
    );
    const removeCommit = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
    );
    await page.keyboard.down("Alt");
    await overlay.click({ position: { x: previewBox.width * 0.28, y: previewBox.height * 0.14 } });
    await page.keyboard.up("Alt");
    await removeResponse;
    await removeCommit;
    await page.waitForTimeout(150);
    const innerAfterRemove = await page.locator(".luma-reference-range input").evaluateAll((inputs) => [Number(inputs[0].value), Number(inputs[1].value)]);
    assert(
      innerAfterRemove[0] > innerAfterAdd[0] || innerAfterRemove[1] < innerAfterAdd[1],
      `Alt-sampling did not contract a range bound: ${JSON.stringify({ innerAfterAdd, innerAfterRemove })}`,
    );

    const presetCommit = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
    );
    const secondBand = page.locator(".luma-preset-button").nth(1);
    await secondBand.click();
    await presetCommit;
    await page.waitForTimeout(150);
    assert(await secondBand.getAttribute("aria-pressed") === "true", "Clicking a false-color band did not select it.");
    const presetBounds = await page.locator(".luma-reference-range input").evaluateAll((inputs) => [Number(inputs[0].value), Number(inputs[1].value)]);
    const presetBand = await page.evaluate(() => falseColorBands()[1]);
    assert(Math.abs(presetBounds[0] - Math.log2(presetBand.lower / referenceWhite)) < 0.02, `The preset lower bound is wrong: ${presetBounds[0]}`);
    assert(Math.abs(presetBounds[1] - Math.log2(presetBand.upper / referenceWhite)) < 0.02, `The preset upper bound is wrong: ${presetBounds[1]}`);
    const initialRefinement = await page.locator(".luma-refine-range input").evaluateAll((inputs) => [Number(inputs[0].value), Number(inputs[1].value)]);
    assert(initialRefinement[0] === 0 && initialRefinement[1] === 1, `A quick range did not reset refinement: ${JSON.stringify(initialRefinement)}`);

    const refineDraft = gpuResident
      ? page.evaluate(() => new Promise((resolve) => window.addEventListener("hdrfinisher:mask-presented", () => resolve(true), { once: true })))
      : page.waitForResponse((response) =>
        response.url().includes("/local-mask/") && response.url().endsWith("/preview") && response.request().method() === "POST" && response.status() === 200,
      );
    const refineLower = page.locator('.luma-refine-range input[aria-label="Lower refined edge"]');
    await refineLower.evaluate((input) => {
      input.value = "0.25";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await refineDraft;
    const refineCommit = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
    );
    await refineLower.dispatchEvent("change");
    const refinedCommand = (await refineCommit).request().postDataJSON().commands[0];
    const refinedLeaf = refinedCommand.payload.local.mask.leaf;
    assert(refinedLeaf.full_start_ev > refinedLeaf.reference_start_ev, "Moving the refine handle inward did not narrow the lower edge.");
    assert(refinedLeaf.full_end_ev === refinedLeaf.reference_end_ev, "Narrowing the lower edge unexpectedly changed the upper edge.");
    await page.waitForTimeout(150);

    const feather = page.locator('.local-brush-control:has-text("Feather") input[type="range"]');
    const draftResponse = gpuResident
      ? page.evaluate(() => new Promise((resolve) => window.addEventListener("hdrfinisher:mask-presented", () => resolve(true), { once: true })))
      : page.waitForResponse((response) =>
        response.url().includes("/local-mask/") && response.url().endsWith("/preview") && response.request().method() === "POST" && response.status() === 200,
      );
    await feather.evaluate((input) => {
      input.value = "50";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await draftResponse;
    const featherCommit = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
    );
    await feather.dispatchEvent("change");
    const committedFeather = await featherCommit;
    const featherCommand = committedFeather.request().postDataJSON().commands[0];
    assert(
      featherCommand.payload.local.mask.leaf.mask_feather === 0.025,
      `The Luma Feather value was not serialized into the edit command: ${JSON.stringify(featherCommand)}`,
    );
    await page.waitForFunction(() => Number(document.querySelector('.local-brush-control:has(.instrument-control-label) input[type="range"]')?.value) === 50).catch(() => null);
    await page.locator(".grade-rail").screenshot({ path: path.resolve(__dirname, "../output/playwright/luma-mask-ui.png") });
    await page.locator(".local-mask-subpanel", { hasText: "Luma Controls" }).screenshot({ path: path.resolve(__dirname, "../output/playwright/luma-controls-ui.png") });

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ sampled, innerAfterAdd, innerAfterRemove, gpuResident, overlayPixels: await redOverlayPixels(overlay) }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
