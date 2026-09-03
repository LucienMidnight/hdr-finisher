const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function pathState(page) {
  return page.evaluate(() => {
    const local = selectedLocal();
    const leaf = firstMaskLeaf(local?.mask, "path");
    return {
      locals: localAdjustments().length,
      draft: Boolean(state.localPathDraft),
      editMode: state.localPathEditMode,
      selected: state.selectedPathNode,
      leaf: leaf ? JSON.parse(JSON.stringify(leaf)) : null,
    };
  });
}

async function clickNormalized(page, box, x, y, options = {}) {
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y, options);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const outputDirectory = path.resolve(__dirname, "../output/path-mask");
  fs.mkdirSync(outputDirectory, { recursive: true });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#grade-mode-local").click();
    await page.locator('[data-local-tool="path"]').click();
    await page.locator("#local-add-adjustment").click();
    const overlay = page.locator("#local-mask-overlay");
    const box = await page.locator("#preview-canvas").boundingBox();
    assert(box, "Path overlay is unavailable.");

    await clickNormalized(page, box, .25, .25);
    await page.mouse.move(box.x + box.width * .67, box.y + box.height * .25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .74, box.y + box.height * .18, { steps: 5 });
    await page.mouse.up();
    await clickNormalized(page, box, .72, .70);
    await clickNormalized(page, box, .26, .72);
    let current = await pathState(page);
    assert(current.draft && current.leaf.nodes.length === 4, "Path clicks did not remain in a provisional four-node draft.");
    assert(current.leaf.nodes[0].node_type === "sharp", "Click-created node was not sharp by default.");
    assert(current.leaf.nodes[1].node_type === "smooth" && current.leaf.nodes[1].in_x !== null && current.leaf.nodes[1].out_x !== null, "Click-drag did not create a smooth node with handles.");

    let response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await clickNormalized(page, box, .25, .25);
    assert((await response).ok(), "Clicking the first node did not close and create the mask.");
    current = await pathState(page);
    assert(!current.draft && current.leaf.feather_mode === "outer_boundary", "Closed path did not enter outer-boundary editing.");

    // The visible editor geometry and the applied grade must consume the same
    // committed Path mask. Compare-without provides a direct rendered parity
    // check without relying on the red mask overlay.
    const exposure = page.locator("#local-exposure");
    if (await page.locator("#local-show-mask").getAttribute("aria-pressed") !== "true") await page.locator("#local-show-mask").click();
    assert(await page.locator("#local-show-mask").getAttribute("aria-pressed") === "true", "Path mask overlay did not enable for the grade-preview test.");
    let previewPresented = page.evaluate(() => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for the Path exposure preview.")), 8000);
      window.addEventListener("hdrfinisher:preview-presented", (event) => { clearTimeout(timeout); resolve(event.detail); }, { once: true });
    }));
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await exposure.evaluate((input) => {
      input.value = "2";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert((await response).ok(), "Path exposure did not commit.");
    await previewPresented;
    assert(await page.locator("#local-show-mask").getAttribute("aria-pressed") === "false", "Local grade input did not dismiss the obscuring mask fill.");
    assert(Math.abs((await page.evaluate(() => selectedLocal().hdr_grade.exposure)) - 2) < 1e-8, "Committed Path exposure was not retained.");
    const appliedPixels = await page.locator("#preview-primary-pane").screenshot();
    previewPresented = page.evaluate(() => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for Compare without.")), 8000);
      window.addEventListener("hdrfinisher:preview-presented", (event) => { clearTimeout(timeout); resolve(event.detail); }, { once: true });
    }));
    await page.locator("#local-compare").click();
    await previewPresented;
    const bypassedPixels = await page.locator("#preview-primary-pane").screenshot();
    assert(!appliedPixels.equals(bypassedPixels), "Path exposure produced no visible difference from Compare without.");
    previewPresented = page.evaluate(() => new Promise((resolve) => window.addEventListener("hdrfinisher:preview-presented", resolve, { once: true })));
    await page.locator("#local-compare").click();
    await previewPresented;

    // Segment insertion preserves the bottom straight segment, then right-click removal restores it.
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await clickNormalized(page, box, .49, .71);
    assert((await response).ok(), "Left-clicking the curve did not add a node.");
    assert((await pathState(page)).leaf.nodes.length === 5, "Curve insertion did not add exactly one node.");
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await clickNormalized(page, box, .49, .71, { button: "right" });
    assert((await response).ok(), "Right-clicking the inserted node did not remove it.");
    assert((await pathState(page)).leaf.nodes.length === 4, "Right-click removal did not restore four nodes.");

    // Native node-profile controls create and retract usable handles.
    await clickNormalized(page, box, .25, .25);
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await page.locator(".path-node-mode-smooth").click();
    assert((await response).ok(), "Smooth control did not commit.");
    current = await pathState(page);
    assert(current.leaf.nodes[0].node_type === "smooth" && current.leaf.nodes[0].in_x !== null, "Smooth control did not generate handles.");
    const smoothBefore = JSON.parse(JSON.stringify(current.leaf.nodes[0]));
    await page.mouse.move(box.x + box.width * smoothBefore.out_x, box.y + box.height * smoothBefore.out_y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * (smoothBefore.out_x + .035), box.y + box.height * (smoothBefore.out_y + .015), { steps: 4 });
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await page.mouse.up();
    assert((await response).ok(), "Smooth handle drag did not commit.");
    current = await pathState(page);
    const smoothAfter = current.leaf.nodes[0];
    const incoming = [smoothAfter.in_x - smoothAfter.x, smoothAfter.in_y - smoothAfter.y];
    const outgoing = [smoothAfter.out_x - smoothAfter.x, smoothAfter.out_y - smoothAfter.y];
    assert(Math.hypot(smoothAfter.out_x - smoothBefore.out_x, smoothAfter.out_y - smoothBefore.out_y) > .01, "Selected smooth handle did not move.");
    assert(Math.abs(incoming[0] * outgoing[1] - incoming[1] * outgoing[0]) < 1e-6, "Smooth handle drag did not keep both handles collinear.");
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await page.locator(".path-node-mode-sharp").click();
    assert((await response).ok(), "Sharp control did not commit.");
    current = await pathState(page);
    assert(current.leaf.nodes[0].node_type === "sharp" && current.leaf.nodes[0].in_x === null && current.leaf.nodes[0].out_x === null, "Sharp control did not retract handles.");

    // Feather mode materializes an independent boundary and its selected nodes.
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await page.locator('.path-mode-button', { hasText: "Feather" }).click();
    const featherModeResponse = await response;
    assert(featherModeResponse.ok(), `Feather edit mode did not materialize its boundary (${featherModeResponse.status()}): ${await featherModeResponse.text()}`);
    current = await pathState(page);
    assert(current.editMode === "feather" && current.leaf.feather_nodes.length === 4, `Feather mode did not expose an independent four-node boundary: ${JSON.stringify(current)}`);

    const featherBefore = JSON.parse(JSON.stringify(current.leaf.feather_nodes));
    const baselineValidity = await page.evaluate(() => {
      const leaf = firstMaskLeaf(selectedLocal().mask, "path");
      const inner = flattenPathNodes(leaf.nodes);
      const outer = flattenPathNodes(leaf.feather_nodes);
      return { valid: validFeatherGeometry(leaf.nodes, leaf.feather_nodes), innerSimple: simplePathPolygon(inner), outerSimple: simplePathPolygon(outer), outside: inner.map((point, index) => pointInsidePathPolygon(point, outer) ? -1 : index).filter((index) => index >= 0) };
    });
    assert(baselineValidity.valid, `Materialized feather boundary is invalid: ${JSON.stringify(baselineValidity)}`);
    const firstFeather = featherBefore[0];
    await page.mouse.move(box.x + box.width * firstFeather.x, box.y + box.height * firstFeather.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * (firstFeather.x - .035), box.y + box.height * (firstFeather.y - .03), { steps: 4 });
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await page.mouse.up();
    assert((await response).ok(), "Independent feather-node drag did not commit.");
    current = await pathState(page);
    assert(Math.hypot(current.leaf.feather_nodes[0].x - firstFeather.x, current.leaf.feather_nodes[0].y - firstFeather.y) > .01, "Feather node did not move independently.");

    const customized = JSON.parse(JSON.stringify(current.leaf.feather_nodes));
    const slider = page.locator('.path-node-status').locator('xpath=following-sibling::label[1]').locator('input[type="range"]');
    const previousSlider = Number(await slider.inputValue());
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await slider.evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, Math.min(100, previousSlider + 6));
    assert((await response).ok(), "Global Feather delta did not commit.");
    current = await pathState(page);
    assert(current.leaf.feather_nodes.some((node, index) => Math.hypot(node.x - customized[index].x, node.y - customized[index].y) > .001), "Feather slider did not offset the customized boundary.");

    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await page.getByRole("button", { name: "Reset feather shape" }).click();
    assert((await response).ok(), "Reset feather shape did not commit.");
    const resetMatches = await page.evaluate(() => {
      const leaf = firstMaskLeaf(selectedLocal().mask, "path");
      const uniform = uniformFeatherNodes(leaf.nodes, Number(leaf.feather));
      return leaf.feather_nodes.every((node, index) => Math.hypot(node.x - uniform[index].x, node.y - uniform[index].y) < 1e-7);
    });
    assert(resetMatches, "Reset did not rebuild an equal-offset feather boundary.");

    // Rapid slider input must converge on the last geometry and presented mask.
    if (await page.locator("#local-show-mask").getAttribute("aria-pressed") !== "true") {
      await page.locator("#local-show-mask").click();
    }
    let draftRequestCount = 0;
    const delayedDraft = async (route) => {
      draftRequestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 550));
      await route.continue();
    };
    await page.route("**/local-mask/*/preview", delayedDraft);
    await slider.evaluate((input) => {
      for (const value of [18, 7, 10]) {
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const liveFillAlpha = await page.evaluate(() => {
      const canvas = document.querySelector("#local-mask-overlay");
      const canvasRect = canvas.getBoundingClientRect();
      const imageRect = activePreviewElement().getBoundingClientRect();
      const clientX = imageRect.left + imageRect.width * .5;
      const clientY = imageRect.top + imageRect.height * .5;
      const pixelX = Math.max(0, Math.min(canvas.width - 1, Math.round((clientX - canvasRect.left) * canvas.width / canvasRect.width)));
      const pixelY = Math.max(0, Math.min(canvas.height - 1, Math.round((clientY - canvasRect.top) * canvas.height / canvasRect.height)));
      return canvas.getContext("2d").getImageData(pixelX, pixelY, 1, 1).data[3];
    });
    assert(liveFillAlpha > 0, "Path overlay disappeared while a newer Feather mask was pending.");
    await page.locator("#path-mask-progress").waitFor({ state: "visible", timeout: 1500 });
    assert((await page.locator("#path-mask-progress-copy").textContent()).includes("Updating feather"), "Slow Path work did not explain its loading state.");
    const latestPreviewPresented = page.evaluate(() => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for the latest path preview.")), 15000);
      window.addEventListener("hdrfinisher:preview-presented", (event) => {
        clearTimeout(timeout);
        resolve(event.detail);
      }, { once: true });
    }));
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await slider.evaluate((input) => input.dispatchEvent(new Event("change", { bubbles: true })));
    assert((await response).ok(), "Rapid Feather inputs did not commit.");
    await latestPreviewPresented;
    await page.locator("#path-mask-progress").waitFor({ state: "hidden", timeout: 5000 });
    await page.unroute("**/local-mask/*/preview", delayedDraft);
    assert(draftRequestCount <= 1, `Rapid Feather input launched ${draftRequestCount} draft mask jobs instead of only the latest value.`);
    current = await pathState(page);
    assert(Math.abs(current.leaf.feather - .05) < 1e-8 && Number(await slider.inputValue()) === 10, "Rapid Feather inputs did not converge on the final value.");

    const softness = page.locator('[data-local-mask-param="feather_softness"]');
    assert(await softness.count() === 1, "Path Softness control was not rendered below Feather.");
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await softness.evaluate((input) => {
      input.value = "80";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert((await response).ok(), "Path Softness did not commit.");
    assert(Math.abs((await pathState(page)).leaf.feather_softness - .8) < 1e-8, "Path Softness did not persist on the mask leaf.");

    const opacity = page.locator('[data-local-mask-param="mask_opacity"]');
    assert(await opacity.count() === 1, "Path Opacity control was not rendered below Feather.");
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await opacity.evaluate((input) => {
      input.value = "40";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert((await response).ok(), "Path Opacity did not commit.");
    assert(Math.abs((await pathState(page)).leaf.mask_opacity - .4) < 1e-8, "Path Opacity did not persist on the mask leaf.");

    const overlayResolution = await page.evaluate(() => {
      setCustomZoom(800);
      renderLocalMaskOverlay();
      const canvas = document.querySelector("#local-mask-overlay");
      const rect = canvas.getBoundingClientRect();
      return { bitmapWidth: canvas.width, cssWidth: rect.width, deviceRatio: window.devicePixelRatio };
    });
    assert(overlayResolution.bitmapWidth >= overlayResolution.cssWidth * overlayResolution.deviceRatio - 2,
      `Zoomed Path overlay bitmap was undersampled: ${JSON.stringify(overlayResolution)}`);
    await page.locator("#zoom-fit").click();

    // Keyboard equivalents: select, smooth, target-cycle, nudge, split, and remove.
    await overlay.focus();
    await page.keyboard.press("]");
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await page.keyboard.press("m");
    await response;
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await page.keyboard.press("Enter");
    await response;
    assert((await pathState(page)).leaf.feather_nodes.length === 5, "Keyboard Enter did not split the following feather segment.");
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await page.keyboard.press("Delete");
    await response;
    assert((await pathState(page)).leaf.feather_nodes.length === 4, "Keyboard Delete did not remove the selected feather node.");

    await page.locator(".grade-rail").screenshot({ path: path.join(outputDirectory, "path-controls.png") });
    await page.locator("#preview-primary-pane").screenshot({ path: path.join(outputDirectory, "path-and-feather-overlay.png") });

    const completedLocals = (await pathState(page)).locals;
    await page.locator('[data-local-tool="path"]').click();
    await page.locator("#local-add-adjustment").click();
    await clickNormalized(page, box, .2, .2);
    await clickNormalized(page, box, .6, .2);
    await overlay.focus();
    await page.keyboard.press("Escape");
    assert((await pathState(page)).locals === completedLocals && !(await pathState(page)).draft, "Esc did not cancel an unfinished Path draft.");

    await page.locator('[data-local-tool="path"]').click();
    await page.locator("#local-add-adjustment").click();
    await clickNormalized(page, box, .25, .25);
    await clickNormalized(page, box, .65, .25);
    await page.locator("#local-show-mask").click();
    assert((await pathState(page)).locals === completedLocals && !(await pathState(page)).draft, "External interaction did not cancel an invalid two-node draft.");

    await page.locator('[data-local-tool="path"]').click();
    await page.locator("#local-add-adjustment").click();
    await clickNormalized(page, box, .2, .2);
    await clickNormalized(page, box, .65, .2);
    await clickNormalized(page, box, .45, .65);
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await overlay.focus();
    await page.keyboard.press("Enter");
    assert((await response).ok(), "Enter did not close a valid Path draft.");
    assert((await pathState(page)).locals === completedLocals + 1, "Enter-closed Path was not retained.");

    await page.locator('[data-local-tool="path"]').click();
    await page.locator("#local-add-adjustment").click();
    await clickNormalized(page, box, .3, .25);
    await clickNormalized(page, box, .7, .3);
    await clickNormalized(page, box, .5, .7);
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await page.locator("#local-show-mask").click();
    assert((await response).ok(), "Clicking elsewhere did not close a valid Path draft.");
    assert((await pathState(page)).locals === completedLocals + 2, "Externally closed Path was not retained.");

    // A Path handle may extend beyond the image while remaining inside the
    // overlay pane. It must still be hit-testable and draggable from there.
    const beforeEdgePathLocals = (await pathState(page)).locals;
    await page.locator('[data-local-tool="path"]').click();
    await page.locator("#local-add-adjustment").click();
    await page.mouse.move(box.x + box.width * .03, box.y + box.height * .38);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .14, box.y + box.height * .32, { steps: 4 });
    await page.mouse.up();
    await clickNormalized(page, box, .72, .20);
    await clickNormalized(page, box, .74, .72);
    await clickNormalized(page, box, .12, .76);
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await clickNormalized(page, box, .03, .38);
    assert((await response).ok(), "Edge-handle Path did not close.");
    current = await pathState(page);
    assert(current.locals === beforeEdgePathLocals + 1 && current.leaf.nodes[0].in_x < 0, "Test Path did not create an out-of-image handle.");
    const edgeHandleBefore = { x: current.leaf.nodes[0].in_x, y: current.leaf.nodes[0].in_y };
    // Create a contained-image/letterbox layout like portrait photos in the
    // desktop viewer so the outside handle remains inside the overlay pane.
    await page.evaluate(() => {
      const preview = activePreviewElement();
      const rect = preview.getBoundingClientRect();
      preview.style.width = `${rect.width * .72}px`;
      preview.style.height = `${rect.height * .72}px`;
      renderLocalMaskOverlay();
    });
    await page.waitForTimeout(50);
    const edgeBox = await page.locator("#preview-canvas").boundingBox();
    assert(edgeBox, "Letterboxed preview is unavailable.");
    const edgeHandleScreen = { x: edgeBox.x + edgeBox.width * edgeHandleBefore.x, y: edgeBox.y + edgeBox.height * edgeHandleBefore.y };
    const hitElement = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, edgeHandleScreen);
    assert(hitElement === "local-mask-overlay", `Outside handle is not covered by the interaction overlay (${hitElement || "none"}).`);
    await page.mouse.move(edgeHandleScreen.x, edgeHandleScreen.y);
    await page.mouse.down();
    await page.mouse.move(edgeBox.x + edgeBox.width * (edgeHandleBefore.x - .035), edgeBox.y + edgeBox.height * (edgeHandleBefore.y + .015), { steps: 4 });
    response = page.waitForResponse((item) => item.url().includes("/edit-commands") && item.request().method() === "POST");
    await page.mouse.up();
    assert((await response).ok(), "Out-of-image Path handle did not commit.");
    current = await pathState(page);
    assert(Math.hypot(current.leaf.nodes[0].in_x - edgeHandleBefore.x, current.leaf.nodes[0].in_y - edgeHandleBefore.y) > .01, "Out-of-image Path handle could not be selected and dragged.");
    await page.evaluate(() => {
      const preview = activePreviewElement();
      const rect = preview.getBoundingClientRect();
      preview.style.width = `${rect.width * .72}px`;
      preview.style.height = `${rect.height * .72}px`;
      renderLocalMaskOverlay();
    });
    await page.waitForTimeout(50);
    const evidenceBox = await page.locator("#preview-canvas").boundingBox();
    assert(evidenceBox, "Out-of-image handle evidence preview is unavailable.");
    await page.mouse.move(
      evidenceBox.x + evidenceBox.width * current.leaf.nodes[0].in_x,
      evidenceBox.y + evidenceBox.height * current.leaf.nodes[0].in_y,
    );
    await page.waitForTimeout(50);
    assert(await page.evaluate(() => state.hoveredPathTarget?.type === "handle"), "Out-of-image handle did not expose its hover target.");
    await page.locator("#preview-primary-pane").screenshot({ path: path.join(outputDirectory, "out-of-image-handle.png") });

    assert(pageErrors.length === 0, `Browser errors occurred: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ nodes: current.leaf.nodes.length, featherNodes: (await pathState(page)).leaf.feather_nodes.length, outputDirectory }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
