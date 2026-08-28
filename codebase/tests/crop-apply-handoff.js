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
    const beforeNeutralRotate = await page.evaluate(() => {
      const preview = activePreviewElement();
      const rect = preview.getBoundingClientRect();
      return { width: rect.width, height: rect.height, zoom: state.zoomPercent };
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
    await page.locator("#rotate-cancel").click();
    await page.locator("#crop-tool-toggle").click();
    await page.locator("#crop-ratio").selectOption("4:3");
    const before = await page.evaluate(() => {
      const rect = activePreviewElement().getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });

    delayGeometryPreview = true;
    await page.locator("#crop-done").click();
    const during = await page.evaluate(() => {
      const rect = activePreviewElement().getBoundingClientRect();
      return { pending: state.geometryPresentationPending, width: rect.width, height: rect.height };
    });
    assert(during.pending, "Crop handoff completed before the delayed geometry preview was presented.");
    assert(
      Math.abs(during.width - before.width) < 0.5 && Math.abs(during.height - before.height) < 0.5,
      `Crop apply changed viewer zoom during preview handoff: ${JSON.stringify({ before, during })}`,
    );

    await page.waitForFunction(() => !state.geometryPresentationPending, null, { timeout: 30000 });
    const after = await page.evaluate(() => {
      const preview = activePreviewElement();
      const rect = preview.getBoundingClientRect();
      const width = preview instanceof HTMLCanvasElement ? preview.width : preview.naturalWidth;
      const height = preview instanceof HTMLCanvasElement ? preview.height : preview.naturalHeight;
      return { displayedAspect: rect.width / rect.height, bitmapAspect: width / height };
    });
    assert(Math.abs(after.displayedAspect - after.bitmapAspect) < 0.01, `Final crop preview aspect is incorrect: ${JSON.stringify(after)}`);
    console.log("Crop apply preview handoff passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
