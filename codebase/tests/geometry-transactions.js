const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.acceptedPresentation, null, { timeout: 60000 });
    await page.waitForLoadState("networkidle");
    const initial = await page.evaluate(() => state.editRevision);

    const clippedGuides = await page.evaluate(() => {
      const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      return [
        transformPerspectiveGuide({ start: { x: -0.5, y: 0 }, end: { x: 1.5, y: 1 } }, identity),
        transformPerspectiveGuide({ start: { x: -1, y: 0.1 }, end: { x: -1, y: 0.9 } }, identity),
        transformPerspectiveGuide({ start: { x: 0, y: 0 }, end: { x: 0.01, y: 0.01 } }, identity),
      ];
    });
    assert.deepEqual(clippedGuides, [{ start: { x: 0, y: 0.25 }, end: { x: 1, y: 0.75 } }, null, null],
      "Guides crossing a safe crop must keep their slope; invisible/degenerate guides must be retired");

    // Real HTTP responses can finish after Cancel, Reset, new slider input,
    // or even after an entirely new draft has opened.
    for (const action of ["cancel", "reset", "slider", "reopen", "failure"]) {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const handler = async (route) => {
        await gate;
        await route.fulfill({ status: action === "failure" ? 422 : 200,
          contentType: "application/json", body: JSON.stringify(action === "failure"
            ? { detail: "Guides do not define a supported correction." }
            : { perspective_horizontal: 20, perspective_vertical: -10, perspective_rotate: 3, residual_degrees: 0.1 }) });
      };
      await page.route("**/perspective-solve", handler);
      const request = page.waitForRequest("**/perspective-solve");
      await page.evaluate(() => {
        openPerspectiveMode();
        state.perspectiveGuidesTouched.vertical = true;
        state.perspectiveGuidesDirty = true;
        window.pendingGuideCommit = commitPerspectiveMode();
      });
      await request;
      await page.evaluate((action) => {
        if (action === "cancel" || action === "reopen") closePerspectiveMode(false);
        if (action === "reset") resetControlGroup("perspective");
        if (action === "reopen") openPerspectiveMode();
        if (action === "slider" || action === "reopen") {
          state.adjustments.shared.geometry.perspective_horizontal = 31;
        }
      }, action);
      release();
      assert.equal(await page.evaluate(() => window.pendingGuideCommit), false, `${action}: stale/failed Apply succeeded`);
      const result = await page.evaluate(() => ({ mode: state.perspectiveMode,
        horizontal: state.adjustments.shared.geometry.perspective_horizontal, revision: state.editRevision }));
      assert.equal(result.mode, action !== "cancel", `${action}: draft lifetime changed`);
      assert.equal(result.horizontal, ["slider", "reopen"].includes(action) ? 31 : 0, `${action}: stale solve overwrote geometry`);
      assert.equal(result.revision, initial, `${action}: committed a rejected draft`);
      await page.unroute("**/perspective-solve", handler);
      await page.evaluate(() => closePerspectiveMode(false));
    }

    // A response to a grading command sent before opening a tool must not
    // replace the newer, uncommitted geometry in either tool.
    for (const tool of ["perspective", "rotate"]) {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const handler = async (route) => {
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
      };
      await page.route("**/edit-commands", handler);
      const request = page.waitForRequest("**/edit-commands");
      await page.evaluate(() => {
        state.adjustments.hdr.exposure += 0.1;
        markGlobalEditDirty();
        window.pendingGlobalCommit = syncGlobalEditState();
      });
      await request;
      await page.evaluate((tool) => {
        if (tool === "perspective") {
          openPerspectiveMode();
          state.adjustments.shared.geometry.perspective_horizontal = 27;
        } else {
          openRotateMode();
          rotateGeometry(90);
        }
      }, tool);
      release();
      await page.evaluate(() => window.pendingGlobalCommit);
      assert.equal(await page.evaluate((tool) => tool === "perspective"
        ? state.adjustments.shared.geometry.perspective_horizontal
        : state.adjustments.shared.geometry.rotation, tool), tool === "perspective" ? 27 : 90);
      await page.unroute("**/edit-commands", handler);
      await page.evaluate((tool) => tool === "perspective" ? closePerspectiveMode(false) : closeRotateMode(false), tool);
    }

    // Dirty grading followed by Rotate must not save the rotation through
    // scopes or lane-switch sync before the user presses Apply.
    const revision = await page.evaluate(() => state.editRevision);
    await page.evaluate(async () => {
      openRotateMode(); rotateGeometry(90);
      state.adjustments.hdr.exposure += 0.1; markGlobalEditDirty();
      await syncGlobalEditState(); await refreshScopes(); await refinePreview("hdr");
    });
    assert.equal(await page.evaluate(() => state.editRevision), revision);
    await page.evaluate(() => switchLane("sdr"));
    const backend = await page.evaluate(async () => (await (await fetch(`/api/session/${state.session.session_id}/edit-state`)).json()).document);
    assert.equal(backend.global_adjustments.shared.geometry.rotation, 0, "Lane switch committed cancelled Rotate geometry");

    // Encoded previews omit dimension headers. The decoded dimensions must
    // release the geometry handoff and enable zoom after Apply.
    await page.evaluate(async () => {
      state.previewScheduler.cancel();
      state.previewCache.sdr = null;
      state.renderingMode = "cpu";
      state.geometryPresentationPending = true;
      await renderPreviewForLane("sdr", true, 768, { raw: false, showProgress: false });
    });
    assert.equal(await page.evaluate(() => state.geometryPresentationPending), false);
    assert.ok(await page.evaluate(() => state.acceptedPresentation.width > 0 && state.acceptedPresentation.height > 0));
    await page.evaluate(() => setCustomZoom(100));
    assert.equal(await page.evaluate(() => state.zoomPercent), 100);

    // Crop ratios use the actual perspective/roll output, including a prior
    // crop, rather than the original source aspect or a rotation-only estimate.
    const square = await page.evaluate(async () => {
      Object.assign(state.adjustments.shared.geometry, {
        rotation: 90, flip_horizontal: true, straighten_angle: 11,
        perspective_horizontal: 25, perspective_vertical: -18, perspective_rotate: 7,
        crop: { x: 0.1, y: 0.05, width: 0.8, height: 0.9 },
      });
      markGlobalEditDirty();
      await syncGlobalEditState();
      await ensureGeometryCoordinateMap();
      openCropMode();
      state.cropDraftGeometry.ratio_mode = "1:1";
      constrainCropToRatio();
      closeCropMode(true);
      await syncGlobalEditState();
      const map = await ensureGeometryCoordinateMap();
      return { width: map.fullOutputWidth, height: map.fullOutputHeight };
    });
    assert.ok(Math.abs(square.width - square.height) <= 1, `Perspective crop is not square: ${JSON.stringify(square)}`);

    await page.evaluate(() => resetControlGroup("perspective"));
    const perspectiveReset = await page.evaluate(() => state.adjustments.shared.geometry);
    assert.equal(perspectiveReset.straighten_angle, 11, "Perspective Reset erased manual Straighten");
    assert.equal(perspectiveReset.rotation, 90, "Perspective Reset erased a quarter turn");
    assert.equal(perspectiveReset.flip_horizontal, true);
    assert.equal(perspectiveReset.perspective_rotate, 0);
    assert.equal(perspectiveReset.ratio_mode, "1:1");
    await page.evaluate(() => closePerspectiveMode(false));
    page.once("dialog", (dialog) => dialog.accept());
    await page.evaluate(() => resetControlGroup("geometry"));
    const cropReset = await page.evaluate(() => state.adjustments.shared.geometry);
    assert.equal(cropReset.straighten_angle, 0);
    assert.equal(cropReset.rotation, 0);
    assert.equal(cropReset.crop.width, 1);
    assert.equal(cropReset.perspective_horizontal, 25, "Crop Reset erased Perspective");
    assert.equal(cropReset.perspective_rotate, 7);
    await page.evaluate(() => syncGlobalEditState());

    // A source replacement must retire every old tool and reject a grading
    // response that arrives after the new source has been installed.
    for (const tool of ["perspective", "rotate", "crop"]) {
      await page.waitForLoadState("networkidle");
      const oldSession = await page.evaluate(() => state.session.session_id);
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const handler = async (route) => {
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
      };
      await page.route("**/edit-commands", handler);
      const request = page.waitForRequest("**/edit-commands");
      await page.evaluate(() => {
        state.adjustments.hdr.exposure = 2;
        markGlobalEditDirty();
        window.oldSessionCommit = syncGlobalEditState();
      });
      await request;
      await page.evaluate(async (tool) => {
        if (tool === "perspective") { openPerspectiveMode(); state.adjustments.shared.geometry.perspective_horizontal = 35; }
        if (tool === "rotate") { openRotateMode(); rotateGeometry(90); }
        if (tool === "crop") { openCropMode(); state.cropDraftGeometry.crop.width = 0.5; }
        const pattern = await (await fetch("/api/proof/test-pattern")).blob();
        window.replacementUpload = uploadFile(new File([pattern], "replacement.tiff", { type: "image/tiff" }));
      }, tool);
      await page.waitForFunction((old) => state.session.session_id !== old, oldSession);
      release();
      assert.equal(await page.evaluate(() => window.oldSessionCommit), false);
      assert.equal(await page.evaluate(() => window.replacementUpload), true);
      await page.unroute("**/edit-commands", handler);
      const replacement = await page.evaluate(() => ({
        geometry: state.adjustments.shared.geometry,
        cleanTools: !state.perspectiveMode && !state.rotateDraftGeometry && !state.cropMode,
        exposure: state.adjustments.hdr.exposure,
      }));
      assert.equal(replacement.cleanTools, true, `${tool}: old tool survived source replacement`);
      assert.equal(replacement.geometry.rotation, 0);
      assert.equal(replacement.geometry.perspective_horizontal, 0);
      assert.equal(replacement.geometry.crop.width, 1);
      assert.equal(replacement.exposure, 0, `${tool}: delayed response overwrote the new source`);
    }
    console.log("Delayed guide solves, failed Apply, draft preservation, Rotate sync/lane isolation, encoded-preview zoom, and source replacement passed.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
