const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let delayGeometryPreview = false;
  await page.route("**/api/session/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (delayGeometryPreview && (pathname.includes("/proxy/") || pathname.includes("/preview/"))) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    await route.continue();
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);

    const geometryGroup = page.locator('[data-group="geometry"]');
    if (await geometryGroup.evaluate((element) => element.classList.contains("collapsed"))) {
      await geometryGroup.locator(".group-toggle").click();
    }
    // A normal editing session leaves the most recent task resident in the
    // scheduler. Releasing Straighten must not re-arm that old task against
    // the unapplied rotate geometry.
    await page.evaluate(() => state.previewScheduler.schedule(state.currentView, state.previewGeneration[state.currentView]));
    await page.waitForTimeout(300);
    const beforeNeutralRotate = await page.evaluate(() => {
      const preview = activePreviewElement();
      const style = getComputedStyle(preview);
      return { width: parseFloat(style.width), height: parseFloat(style.height), zoom: state.zoomPercent };
    });
    await page.locator("#rotate-tool-toggle").click();
    const afterNeutralRotate = await page.evaluate(() => {
      const preview = activePreviewElement();
      const rect = preview.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        zoom: state.zoomPercent,
        transform: preview.style.getPropertyValue("--interactive-rotate-angle"),
      };
    });
    assert(afterNeutralRotate.transform === "", `Opening Rotate installed a neutral transform: ${JSON.stringify(afterNeutralRotate)}`);
    assert(
      Math.abs(afterNeutralRotate.width - beforeNeutralRotate.width) < 0.5
        && Math.abs(afterNeutralRotate.height - beforeNeutralRotate.height) < 0.5
        && Math.abs(afterNeutralRotate.zoom - beforeNeutralRotate.zoom) < 0.01,
      `Opening Rotate changed viewer zoom: ${JSON.stringify({ beforeNeutralRotate, afterNeutralRotate })}`,
    );
    const straightenBefore = await page.evaluate(() => {
      const preview = activePreviewElement();
      const style = getComputedStyle(preview);
      return {
        width: parseFloat(style.width),
        height: parseFloat(style.height),
        zoom: state.zoomPercent,
        generation: state.previewGeneration[state.currentView],
      };
    });
    const straightenSlider = page.locator("#crop-straighten");
    const straightenBox = await straightenSlider.boundingBox();
    assert(straightenBox, "Straighten slider has no interactive bounds");
    await page.mouse.move(straightenBox.x + straightenBox.width / 2, straightenBox.y + straightenBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(straightenBox.x + straightenBox.width * 0.54, straightenBox.y + straightenBox.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const straightenAfter = await page.evaluate(() => {
      const preview = activePreviewElement();
      const style = getComputedStyle(preview);
      return {
        width: parseFloat(style.width),
        height: parseFloat(style.height),
        zoom: state.zoomPercent,
        generation: state.previewGeneration[state.currentView],
        transform: preview.style.getPropertyValue("--interactive-straighten-angle"),
        angle: state.adjustments.shared.geometry.straighten_angle,
      };
    });
    assert(
      Math.abs(straightenAfter.width - straightenBefore.width) < 0.5
        && Math.abs(straightenAfter.height - straightenBefore.height) < 0.5
        && Math.abs(straightenAfter.zoom - straightenBefore.zoom) < 0.01,
      `Releasing Straighten changed the fitted viewer scale: ${JSON.stringify({ straightenBefore, straightenAfter })}`,
    );
    assert(
      straightenAfter.generation === straightenBefore.generation,
      `Straighten release scheduled an authoritative preview inside the rotate transaction: ${JSON.stringify({ straightenBefore, straightenAfter })}`,
    );
    assert(straightenAfter.angle !== 0 && straightenAfter.transform, `Straighten release lost its draft transform: ${JSON.stringify(straightenAfter)}`);
    await page.locator("#rotate-cancel").click();

    // Reproduce Rotate Apply -> Crop Apply while the authoritative rotation
    // proxy is still in flight. The old frame must remain transformed until a
    // proxy for the combined geometry is ready, and the stale rotation-only
    // render must never resize or paint the shared canvas.
    await page.locator("#rotate-tool-toggle").click();
    await page.locator("#rotate-right").click();
    delayGeometryPreview = true;
    await page.locator("#rotate-apply").click();
    const rotationHandoff = await page.evaluate(() => {
      const preview = activePreviewElement();
      const rect = preview.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        transform: preview.style.getPropertyValue("--interactive-rotate-angle"),
        handoff: state.geometryTransformHandoffSignature,
      };
    });
    assert(rotationHandoff.transform === "90deg" && rotationHandoff.handoff, `Rotation did not enter its atomic preview handoff: ${JSON.stringify(rotationHandoff)}`);

    await page.locator("#crop-tool-toggle").click();
    await page.locator("#crop-ratio").selectOption("4:3");
    const before = await page.evaluate(() => {
      const rect = activePreviewElement().getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    await page.locator("#crop-done").click();
    const during = await page.evaluate(() => {
      const preview = activePreviewElement();
      const rect = preview.getBoundingClientRect();
      return {
        pending: state.geometryPresentationPending,
        width: rect.width,
        height: rect.height,
        transform: preview.style.getPropertyValue("--interactive-rotate-angle"),
        handoffMatchesGeometry: state.geometryTransformHandoffSignature === geometrySignature(),
      };
    });
    assert(during.pending, "Crop handoff completed before the delayed geometry preview was presented.");
    assert(during.transform === "90deg" && during.handoffMatchesGeometry, `Crop discarded or detached the preceding rotation handoff: ${JSON.stringify(during)}`);
    assert(
      Math.abs(during.width - before.width) < 0.5 && Math.abs(during.height - before.height) < 0.5,
      `Crop apply changed viewer zoom during preview handoff: ${JSON.stringify({ before, during })}`,
    );

    await page.waitForFunction(() => !state.geometryPresentationPending && state.geometryTransformHandoffSignature === null, null, { timeout: 30000 });
    const after = await page.evaluate(() => {
      const preview = activePreviewElement();
      const rect = preview.getBoundingClientRect();
      const width = preview instanceof HTMLCanvasElement ? preview.width : preview.naturalWidth;
      const height = preview instanceof HTMLCanvasElement ? preview.height : preview.naturalHeight;
      return {
        displayedAspect: rect.width / rect.height,
        bitmapAspect: width / height,
        transform: preview.style.getPropertyValue("--interactive-rotate-angle"),
        acceptedGeometry: state.acceptedPresentation?.geometrySignature,
        currentGeometry: geometrySignature(),
      };
    });
    assert(Math.abs(after.displayedAspect - after.bitmapAspect) < 0.01, `Final crop preview aspect is incorrect: ${JSON.stringify(after)}`);
    assert(after.transform === "" && after.acceptedGeometry === after.currentGeometry, `Combined rotation and crop did not settle atomically: ${JSON.stringify(after)}`);
    console.log("Crop apply preview handoff passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
