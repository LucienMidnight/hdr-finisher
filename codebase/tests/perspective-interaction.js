const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) console.error("Renderer:", message.text()); });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.acceptedPresentation?.exact, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => Boolean(state.gpuPreview?.available)), true, "This driver must exercise WebGPU");
    const group = page.locator('[data-group="perspective"]');
    const toggle = group.locator(".group-toggle");
    const phase = () => page.evaluate(() => state.perspectivePhase);
    const open = async () => {
      if (await group.evaluate((element) => element.classList.contains("collapsed"))) await toggle.click();
    };
    const slider = async (id, value) => page.locator(id).evaluate((control, next) => {
      control.value = String(next);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    const draftReady = async () => page.waitForFunction(() => state.perspectiveMode && state.perspectiveGpuDraft
      && state.perspectiveDraftFrame?.signature === geometrySignature(), null, { timeout: 60000 }).catch(async (error) => { throw new Error(error.message + JSON.stringify(await page.evaluate(() => ({ mode: state.perspectiveMode, phase: state.perspectivePhase, failed: state.perspectiveGpuDraftFailed, detail: els.perspectiveStatus.textContent, refusal: state.gpuPreview.lastRenderRefusal, signature: geometrySignature(), draft: state.perspectiveDraftFrame })))); });
    const ready = async () => page.waitForFunction(() => !state.perspectiveMode && !state.globalEditDirty
      && !state.gpuDraftInFlight
      && !state.geometryPresentationPending && state.acceptedPresentation?.exact
      && state.acceptedPresentation.geometrySignature === geometrySignature()
      && state.acceptedPresentation.generation === state.previewGeneration[state.currentView], null, { timeout: 60000 });
    const backend = () => page.evaluate(async () => {
      const response = await fetch(`/api/session/${state.session.session_id}/edit-state`);
      return (await response.json()).document.global_adjustments;
    });
    await open();

    // A neutral guide selection must never strand grading behind a hidden tool.
    await page.locator("#perspective-vertical-tool").click();
    await toggle.click();
    assert.equal(await page.evaluate(() => state.perspectiveMode), false);
    await slider("#hdr-exposure", 0.2);
    await ready();
    assert.equal((await backend()).hdr.exposure, 0.2);
    await open();

    // Non-neutral crop/rotate values must survive every Perspective action.
    await page.evaluate(async () => {
      Object.assign(state.adjustments.shared.geometry, { rotation: 90, flip_horizontal: true,
        straighten_angle: 3, crop: { x: 0.1, y: 0.05, width: 0.8, height: 0.85 } });
      invalidatePreview("hdr"); invalidatePreview("sdr");
      debouncePreview(state.currentView);
    });
    await ready();
    const initial = await page.evaluate(() => ({ revision: state.editRevision,
      geometry: structuredClone(state.adjustments.shared.geometry) }));
    const committedImage = await page.locator("#preview-canvas").screenshot();
    const transientRequests = [];
    const sourceRequests = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/preview\/(hdr|sdr)$/.test(request.url())
        && request.postDataJSON()?.transient_adjustments) transientRequests.push(request.url());
      if (/\/(proxy|proxy-stream|source-tile)\//.test(request.url())) sourceRequests.push(request.url());
    });
    await slider("#perspective-horizontal", 24);
    await draftReady();
    const draftSize = await page.evaluate(async () => {
      const response = await fetch(`/api/session/${state.session.session_id}/geometry-map`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adjustments: state.adjustments,
          edit_revision: state.editRevision, long_edge: perspectiveDraftLongEdge() }) });
      const map = await response.json();
      return { expected: [map.output_width, map.output_height], actual: [els.previewCanvas.width, els.previewCanvas.height] };
    });
    assert.deepEqual(draftSize.actual, draftSize.expected, "GPU draft safe crop differs from the backend geometry");
    const firstImage = await page.locator("#preview-canvas").screenshot();
    const warmRequests = sourceRequests.length;
    await page.evaluate(() => { window.perspectiveBaseUnderTest = state.perspectiveGpuDraft; });
    await slider("#perspective-horizontal", -24);
    await draftReady();
    const secondImage = await page.locator("#preview-canvas").screenshot();
    assert.notDeepEqual(firstImage, secondImage, "Perspective slider did not change displayed pixels");
    for (const value of [12, 18, 31]) {
      await slider("#perspective-horizontal", value);
      await draftReady();
    }
    assert.equal(transientRequests.length, 0, "GPU slider preview rebuilt CPU grading frames");
    assert.equal(sourceRequests.length, warmRequests, "Warm slider preview requested a new source proxy");
    assert.equal(await page.evaluate(() => state.perspectiveGpuDraft === window.perspectiveBaseUnderTest), true,
      "Warm sliders did not reuse their GPU base");
    assert.equal(await page.evaluate(() => state.editRevision), initial.revision, "Draft was saved without Apply");
    assert.equal((await backend()).shared.geometry.perspective_horizontal, initial.geometry.perspective_horizontal);
    assert.equal(await phase(), "unapplied");
    assert.match(await page.locator("#preview-quality-status").textContent(), /Perspective draft/);

    await toggle.click();
    assert.equal(await page.evaluate(() => state.perspectiveMode), false, "Collapse retained preview ownership");
    assert.equal(await page.evaluate(() => state.perspectiveGpuDraft), null, "Collapse retained GPU draft resources");
    assert.equal(await page.evaluate(() => state.adjustments.shared.geometry.perspective_horizontal), initial.geometry.perspective_horizontal);
    await ready();
    assert.equal((await page.locator("#preview-canvas").screenshot()).equals(committedImage), true, "Collapse did not restore the displayed committed picture");
    await slider("#hdr-exposure", 0.4);
    await ready();
    assert.equal((await backend()).hdr.exposure, 0.4, "Grading after collapse did not save or present");

    // Already-expanded controls also release Perspective, without needing a collapse.
    await open();
    await slider("#perspective-vertical", -18);
    await draftReady();
    await slider("#hdr-exposure", 0.5);
    await ready();
    assert.equal((await backend()).hdr.exposure, 0.5);
    assert.equal((await backend()).shared.geometry.perspective_vertical, 0);

    // Hold a real save response: collapsing during Apply keeps visible feedback,
    // and Applied appears only after the matching authoritative frame is accepted.
    await slider("#perspective-horizontal", 20);
    await draftReady();
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (String(args[0]).endsWith("/edit-commands")) {
          window.fetch = original;
          await new Promise((resolve) => { window.releasePerspectiveSave = resolve; });
        }
        return response;
      };
    });
    await page.locator("#perspective-apply").click();
    await page.waitForFunction(() => Boolean(window.releasePerspectiveSave));
    await toggle.click();
    assert.equal(await phase(), "applying");
    await page.evaluate(() => window.releasePerspectiveSave());
    await ready();
    assert.equal(await phase(), "applied", JSON.stringify(await page.evaluate(() => ({ detail: els.perspectiveStatus.textContent, operation: state.perspectiveApplyOperation, accepted: state.acceptedPresentation, refusal: state.lastGpuDraftRefusal, unavailable: state.previewUnavailableReason, geometry: geometrySignature() }))));
    assert.equal((await backend()).shared.geometry.perspective_horizontal, 20);

    // Reset is committed without Apply, does not affect Crop & Rotate, and is undoable.
    const cropGeometry = await page.evaluate(() => structuredClone(state.adjustments.shared.geometry));
    await page.locator('[data-reset-group="perspective"]').click();
    assert.equal(await page.evaluate(() => state.perspectiveMode), false, "Reset opened another Apply transaction");
    await ready();
    const reset = (await backend()).shared.geometry;
    assert.equal(reset.perspective_horizontal, 0);
    assert.equal(reset.perspective_vertical, 0);
    assert.equal(reset.perspective_rotate, 0);
    for (const key of ["rotation", "flip_horizontal", "flip_vertical", "straighten_angle", "crop"]) {
      assert.deepEqual(reset[key], cropGeometry[key], `Perspective Reset changed ${key}`);
    }
    await page.evaluate(() => queueEditCommand("undo"));
    await ready();
    assert.equal((await backend()).shared.geometry.perspective_horizontal, 20);
    await page.evaluate(() => queueEditCommand("redo"));
    await ready();
    assert.equal((await backend()).shared.geometry.perspective_horizontal, 0);

    // A failed save after collapse cannot leave a hidden blocking transaction.
    // Reopening recovers the exact values for retry.
    await open();
    await slider("#perspective-vertical", -17);
    await draftReady();
    let releaseFailure;
    const failureGate = new Promise((resolve) => { releaseFailure = resolve; });
    const failSave = async (route) => {
      await failureGate;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Injected save failure" }) });
    };
    await page.route("**/edit-commands", failSave);
    const failedRequest = page.waitForRequest("**/edit-commands");
    await page.locator("#perspective-apply").click();
    await failedRequest;
    await toggle.click();
    releaseFailure();
    await page.waitForFunction(() => state.perspectivePhase === "failed" && !state.perspectiveMode);
    assert.equal(await phase(), "failed");
    assert.equal((await backend()).shared.geometry.perspective_vertical, 0);
    await page.unroute("**/edit-commands", failSave);
    await slider("#hdr-exposure", 0.6);
    await ready();
    await open();
    assert.equal(await page.evaluate(() => state.adjustments.shared.geometry.perspective_vertical), -17);
    await page.locator("#perspective-apply").click();
    await ready();
    assert.equal((await backend()).shared.geometry.perspective_vertical, -17);

    // A failed Reset can be retried even though its sliders already show zero.
    const failReset = (route) => route.fulfill({ status: 500, contentType: "application/json",
      body: JSON.stringify({ detail: "Injected Reset save failure" }) });
    await page.route("**/edit-commands", failReset);
    await page.locator('[data-reset-group="perspective"]').click();
    await page.waitForFunction(() => state.perspectivePhase === "failed" && state.globalEditDirty, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => state.perspectiveMode), false);
    assert.equal((await backend()).shared.geometry.perspective_vertical, -17);
    await page.unroute("**/edit-commands", failReset);
    await page.locator('[data-reset-group="perspective"]').click();
    await ready();
    assert.equal((await backend()).shared.geometry.perspective_vertical, 0);
    assert.equal(await phase(), "applied");
    await page.evaluate(() => queueEditCommand("undo"));
    await ready();
    assert.equal((await backend()).shared.geometry.perspective_vertical, -17);

    // Saving geometry and rendering its picture are separate successes.
    // A failed final preview stays visible even with the module collapsed.
    await slider("#perspective-horizontal", 9);
    await draftReady();
    const renderingMode = await page.evaluate(() => { const previous = state.renderingMode; state.renderingMode = "cpu"; return previous; });
    const failPreview = (route) => route.fulfill({ status: 500, contentType: "application/json",
      body: JSON.stringify({ detail: "Injected final preview failure" }) });
    await page.route("**/preview/hdr", failPreview);
    await page.locator("#perspective-apply").click();
    await toggle.click();
    await page.waitForFunction(() => !state.perspectiveMode && state.perspectivePhase === "previewFailed", null, { timeout: 60000 });
    assert.equal(await phase(), "previewFailed");
    assert.equal((await backend()).shared.geometry.perspective_horizontal, 9, "Successful save was lost after preview failure");
    await page.unroute("**/preview/hdr", failPreview);
    await page.evaluate((mode) => { state.renderingMode = mode; debouncePreview(state.currentView); }, renderingMode);
    await ready();
    assert.equal(await phase(), "applied");
    await open();

    // Guides retain keyboard focus and solve only when explicitly requested.
    await page.locator("#perspective-vertical-tool").click();
    const handle = page.locator(".perspective-guide-handle").first();
    await handle.waitFor({ state: "visible" });
    await handle.press("Shift+ArrowRight");
    assert.equal(await handle.evaluate((element) => element === document.activeElement), true);
    assert.equal(await page.evaluate(() => state.perspectiveGuidesDirty), true);
    await page.locator("#perspective-guide-apply").click();
    await page.waitForFunction(() => !state.perspectiveGuidesDirty, null, { timeout: 30000 });
    await page.locator("#perspective-cancel").click();
    await ready();
    assert.equal((await backend()).shared.geometry.perspective_vertical, -17);
    await page.locator("#view-sdr").click();
    await ready();
    assert.equal(await page.evaluate(() => state.currentView), "sdr");
    assert.equal((await backend()).shared.geometry.perspective_vertical, -17);
    await page.locator("#view-hdr").click();
    await ready();
    await require("./perspective-preview-ownership").checkPerspectiveOwnership(page);
    assert.deepEqual(errors, [], "Renderer raised an uncaught error");
    console.log("Perspective GPU pixels/base reuse, collapse, cross-module grading, acknowledged Apply, Reset/history, failure/retry, guides and lane switch passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
