const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    // Allows checking this regression against the original frontend as well.
    if (process.env.HDR_FINISHER_TEST_APP_JS) {
      await page.route("**/app.js*", (route) => route.fulfill({
        path: process.env.HDR_FINISHER_TEST_APP_JS,
        contentType: "application/javascript",
      }));
    }
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.waitForFunction(() => Boolean(state.acceptedPresentation), null, { timeout: 60000 });
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => {
      state.previewScheduler?.cancel();
      state.adjustments.shared.geometry.perspective_horizontal = 24;
      state.adjustments.shared.geometry.perspective_vertical = -7;
      state.adjustments.shared.geometry.rotation = 90;
      markGlobalEditDirty();
      await syncGlobalEditState();
      // Pause a real committed render after its body has arrived. Aborting its
      // request on tool entry is too late; presentation must also reject it.
      state.previewCache.hdr = null;
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const body = args[1]?.body && JSON.parse(args[1].body);
        if (String(args[0]).endsWith("/preview/hdr") && body && !body.transient_adjustments) {
          window.fetch = originalFetch;
          const blob = await response.blob();
          response.blob = async () => {
            await new Promise((resolve) => { window.releaseCommittedPreview = resolve; });
            return blob;
          };
        }
        return response;
      };
      window.pendingCommittedPreview = renderPreviewForLane("hdr", true, 768, { raw: false, showProgress: false });
    });
    await page.waitForFunction(() => Boolean(window.releaseCommittedPreview), null, { timeout: 60000 });
    const revision = await page.evaluate(() => state.editRevision);
    await page.evaluate(() => resetControlGroup("perspective"));
    await page.waitForFunction(() => state.perspectivePreviewUrl && els.previewImage.src === state.perspectivePreviewUrl,
      null, { timeout: 60000 });
    const draftUrl = await page.evaluate(() => els.previewImage.src);
    await page.evaluate(async () => {
      window.releaseCommittedPreview();
      await window.pendingCommittedPreview;
    });
    assert.equal(await page.evaluate(() => els.previewImage.src), draftUrl, "Late committed render replaced the reset draft");
    assert.equal(await page.evaluate(() => state.previewCache.hdr), null, "Late render contaminated the preview cache");

    // A newly scheduled refinement used to request the old backend geometry
    // and label it with the reset signature from the controls.
    const requests = [];
    page.on("request", (request) => {
      if (/\/preview(?:-raw)?\/hdr$/.test(request.url())) requests.push(request.postDataJSON());
    });
    await page.evaluate(async () => {
      await refinePreview("hdr");
      await renderPreviewForLane("hdr", true, 768, { raw: false, showProgress: false });
      await renderRawPreviewForLane("hdr", true, 768);
      await renderGpuDraft("hdr");
      await showCachedPreview("hdr");
    });
    assert.equal(requests.length, 0, "Ordinary preview work ran during a Perspective draft");
    assert.equal(await page.evaluate(() => els.previewImage.src), draftUrl);
    const beforeApply = await page.evaluate(async () => {
      const response = await fetch(`/api/session/${state.session.session_id}/edit-state`);
      const document = await response.json();
      return { revision: state.editRevision, backend: document.document.global_adjustments.shared.geometry,
        draft: state.adjustments.shared.geometry };
    });
    assert.equal(beforeApply.revision, revision, "Reset committed before Apply");
    assert.equal(beforeApply.backend.perspective_horizontal, 24);
    assert.equal(beforeApply.draft.perspective_horizontal, 0);

    // Reproduce the reported cross-module Reset while Perspective is open.
    // Scope refresh must yield to input even though global sync is deferred.
    page.once("dialog", (dialog) => dialog.accept());
    await page.evaluate(() => resetControlGroup("geometry"));
    const resetCropUrl = await page.evaluate(() => state.perspectivePreviewUrl);
    await page.waitForFunction((previous) => state.perspectivePreviewUrl !== previous
      && els.previewImage.src === state.perspectivePreviewUrl, resetCropUrl, { timeout: 60000 });
    assert.equal(await page.evaluate(() => refreshScopes()), false);
    const responsive = await page.evaluate(() => new Promise((resolve) => setTimeout(() => resolve({
      rotation: state.adjustments.shared.geometry.rotation,
      pending: state.globalEditDirty,
      perspective: state.perspectiveMode,
    }), 0)));
    assert.deepEqual(responsive, { rotation: 0, pending: true, perspective: true });

    await page.evaluate(async () => {
      await commitPerspectiveMode();
      await syncGlobalEditState();
    });
    await page.waitForFunction(() => !state.perspectiveMode && !state.geometryPresentationPending,
      null, { timeout: 60000 });
    const applied = await page.evaluate(async () => {
      const response = await fetch(`/api/session/${state.session.session_id}/edit-state`);
      return (await response.json()).document.global_adjustments.shared.geometry;
    });
    assert.equal(applied.perspective_horizontal, 0);
    assert.equal(applied.perspective_vertical, 0);
    assert.equal(applied.rotation, 0);
    console.log("Perspective reset retains its preview against late frames and refinement; Apply commits the reset.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
