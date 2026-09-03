const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let delayGlobalCommit = false;
  const localMaskStatuses = [];
  await page.route("**/api/session/**", async (route) => {
    const request = route.request();
    if (
      delayGlobalCommit
      && request.method() === "POST"
      && new URL(request.url()).pathname.endsWith("/edit-commands")
      && request.postData()?.includes('"command_type":"set_global_adjustments"')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    await route.continue();
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.request().method() === "GET" && /\/local-mask\/[^/]+$/.test(url.pathname)) {
      localMaskStatuses.push(response.status());
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);

    await page.locator("#grade-mode-local").click();
    await page.locator('[data-local-tool="brush"]').click();
    await page.locator("#local-add-adjustment").click();
    await page.waitForFunction(() => Boolean(selectedLocal()));

    const previewRect = await page.evaluate(() => {
      const rect = activePreviewElement().getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    const paintPoint = { x: 0.65, y: 0.5 };
    await page.mouse.click(
      previewRect.left + previewRect.width * paintPoint.x,
      previewRect.top + previewRect.height * paintPoint.y,
    );
    await page.waitForFunction(() => {
      const local = selectedLocal();
      const cached = local && localAuthoritativeMaskCache.get(local.id);
      return Boolean(
        local?.mask?.leaf?.strokes?.length
        && cached?.geometrySignature === geometrySignature()
        && cached.signature === localMaskSpatialSignature(local.mask)
      );
    }, null, { timeout: 30000 });

    const before = await page.evaluate(() => {
      const local = selectedLocal();
      return {
        point: { ...local.mask.leaf.strokes[0].points[0] },
        geometrySignature: geometrySignature(),
      };
    });

    const geometryGroup = page.locator('[data-group="geometry"]');
    if (await geometryGroup.evaluate((element) => element.classList.contains("collapsed"))) {
      await geometryGroup.locator(".group-toggle").click();
    }
    await page.locator("#crop-tool-toggle").click();
    delayGlobalCommit = true;
    await page.evaluate(() => {
      state.cropDraftGeometry.crop = { x: 0.2, y: 0.1, width: 0.7, height: 0.8 };
      closeCropMode(true);
      renderLocalMaskOverlay();
    });

    const handoff = await page.evaluate((previousGeometry) => {
      const local = selectedLocal();
      const cached = localAuthoritativeMaskCache.get(local.id);
      return {
        previousGeometry,
        currentGeometry: geometrySignature(),
        cachedGeometry: cached?.geometrySignature,
      };
    }, before.geometrySignature);
    assert(
      handoff.currentGeometry !== handoff.previousGeometry
        && handoff.cachedGeometry === handoff.previousGeometry,
      `The crop handoff did not retain a clearly stale pre-crop mask for the regression check: ${JSON.stringify(handoff)}`,
    );

    await page.waitForFunction(() => (
      !state.globalEditDirty
      && !state.globalEditSyncPending
      && !state.geometryPresentationPending
      && state.acceptedPresentation?.geometrySignature === geometrySignature()
    ), null, { timeout: 30000 });
    await page.waitForFunction(() => {
      const local = selectedLocal();
      const cached = local && localAuthoritativeMaskCache.get(local.id);
      return cached?.geometrySignature === geometrySignature();
    }, null, { timeout: 30000 });

    const after = await page.evaluate(() => {
      const local = selectedLocal();
      const sourcePoint = local.mask.leaf.strokes[0].points[0];
      const expected = sourcePointToDisplay(sourcePoint);
      const cached = localAuthoritativeMaskCache.get(local.id);
      const pixels = cached.canvas.getContext("2d").getImageData(0, 0, cached.canvas.width, cached.canvas.height).data;
      let weightedX = 0;
      let weightedY = 0;
      let weight = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3];
        if (!alpha) continue;
        const pixel = index / 4;
        weightedX += ((pixel % cached.canvas.width) + 0.5) * alpha;
        weightedY += (Math.floor(pixel / cached.canvas.width) + 0.5) * alpha;
        weight += alpha;
      }
      return {
        sourcePoint: { ...sourcePoint },
        expected,
        centroid: {
          x: weightedX / weight / cached.canvas.width,
          y: weightedY / weight / cached.canvas.height,
        },
        cachedGeometry: cached.geometrySignature,
        currentGeometry: geometrySignature(),
      };
    });

    assert(
      Math.abs(after.sourcePoint.x - before.point.x) < 1e-6
        && Math.abs(after.sourcePoint.y - before.point.y) < 1e-6,
      `Crop rewrote the source-anchored brush coordinates: ${JSON.stringify({ before, after })}`,
    );
    assert(
      Math.abs(after.centroid.x - after.expected.x) < 0.02
        && Math.abs(after.centroid.y - after.expected.y) < 0.02,
      `The settled local mask moved away from its source point after crop: ${JSON.stringify(after)}`,
    );
    assert(
      after.cachedGeometry === after.currentGeometry,
      `The authoritative mask cache retained pre-crop geometry: ${JSON.stringify(after)}`,
    );
    assert(
      localMaskStatuses.includes(409) && localMaskStatuses.at(-1) === 200,
      `The stale crop-race mask was not rejected and replaced (${localMaskStatuses.join(", ")}).`,
    );
    console.log("Local adjustment crop anchoring passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
