const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function gradientZoomAlignment(page) {
  return page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const local = selectedLocal();
    const leaf = local.mask.leaf;
    const canvas = document.querySelector("#local-mask-overlay");
    const preview = activePreviewElement();
    const pane = document.querySelector("#preview-primary-pane");
    const canvasRect = canvas.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(canvasRect.width, 1);
    const scaleY = canvas.height / Math.max(canvasRect.height, 1);
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const lightHandleAt = (point) => {
      const centerX = Math.round((previewRect.left + point.x * previewRect.width - canvasRect.left) * scaleX);
      const centerY = Math.round((previewRect.top + point.y * previewRect.height - canvasRect.top) * scaleY);
      // At high zoom, a source-anchored handle can be correctly positioned
      // outside the clipped overlay viewport. Only inspect handles whose
      // expected centers are actually present in the bounded backing store.
      if (centerX < 0 || centerY < 0 || centerX >= canvas.width || centerY >= canvas.height) return true;
      const radius = Math.max(3, Math.ceil(3 * Math.max(scaleX, scaleY)));
      for (let y = centerY - radius; y <= centerY + radius; y += 1) {
        for (let x = centerX - radius; x <= centerX + radius; x += 1) {
          if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
          const index = (y * canvas.width + x) * 4;
          if (pixels[index] > 190 && pixels[index + 1] > 190 && pixels[index + 2] > 190 && pixels[index + 3] > 100) return true;
        }
      }
      return false;
    };
    return {
      zoom: state.zoomPercent,
      mask: JSON.stringify(local.mask),
      cacheSettled: !state.localMaskDraftDirty && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask),
      backingIsBounded: canvas.width > 0 && canvas.height > 0
        && canvas.width <= paneRect.width * devicePixelRatio + 1
        && canvas.height <= paneRect.height * devicePixelRatio + 1
        && Math.max(canvas.width, canvas.height) <= 1600,
      startVisible: previewRect.left + leaf.start.x * previewRect.width >= canvasRect.left
        && previewRect.left + leaf.start.x * previewRect.width < canvasRect.right,
      endVisible: previewRect.left + leaf.end.x * previewRect.width >= canvasRect.left
        && previewRect.left + leaf.end.x * previewRect.width < canvasRect.right,
      startAligned: lightHandleAt(leaf.start),
      endAligned: lightHandleAt(leaf.end),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const requestFailures = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText;
    const pathname = new URL(request.url()).pathname;
    const expectedLatestStateAbort = failure === "net::ERR_ABORTED"
      && (/\/scopes$/.test(pathname) || /\/local-mask\/[^/]+\/preview$/.test(pathname));
    if (!expectedLatestStateAbort) requestFailures.push(`${request.method()} ${request.url()}: ${failure}`);
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#grade-mode-local").click();

    let editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.locator('[data-local-tool="linear_gradient"]').click();
    await page.locator("#local-add-adjustment").click();
    assert((await editResponse).ok(), "Creating the gradient failed.");
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    });

    const panel = page.locator("#local-gradient-controls .local-mask-subpanel");
    assert(await panel.isVisible(), "Gradient Controls are not visible.");
    assert(await panel.getByText("Gradient Controls", { exact: true }).isVisible(), "Gradient Controls heading is missing.");
    const labels = await panel.locator(".local-brush-control > .instrument-control-label").allTextContents();
    assert(labels.join("|").replace(/[+\-]?\d+(?:\.\d+)?%/g, "") === "Opacity|Fan", `Unexpected gradient controls: ${labels.join(", ")}`);
    assert(await panel.locator(".gradient-luma-ramp input").count() === 4, "Luminance range is not a four-handle ramp.");
    assert(await page.evaluate(() => {
      const grades = document.querySelector(".local-grade-controls");
      const gradients = document.querySelector("#local-gradient-controls");
      return Boolean(gradients.compareDocumentPosition(grades) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), "Gradient Controls are not above the local adjustment controls.");
    assert(await page.locator("#local-show-mask").getAttribute("aria-pressed") === "true", "A new gradient does not show its mask overlay by default.");
    const overlayToggleBox = await page.locator("#local-show-mask").boundingBox();
    const colorButton = page.getByRole("button", { name: "Choose overlay color" });
    const colorButtonBox = await colorButton.boundingBox();
    const colorInputBox = await page.locator("#local-overlay-color").boundingBox();
    assert(colorButtonBox && overlayToggleBox && colorButtonBox.x > overlayToggleBox.x, "Overlay color is not a button to the right of the overlay toggle.");
    assert(colorInputBox && Math.abs(colorInputBox.x - colorButtonBox.x) < 1 && Math.abs(colorInputBox.y - colorButtonBox.y) < 1, "Native color picker anchor is not colocated with its visible button.");
    assert(Math.abs(colorInputBox.width - colorButtonBox.width) < 1 && Math.abs(colorInputBox.height - colorButtonBox.height) < 1, "Native color picker anchor does not match its visible button.");
    assert((await colorButton.textContent()).trim() === "Overlay color", "Overlay color button has the wrong title.");

    const overlayLevels = await page.locator("#local-mask-overlay").evaluate((canvas) => {
      const canvasRect = canvas.getBoundingClientRect();
      const previewRect = document.querySelector("#preview-canvas").getBoundingClientRect();
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const sample = (nx, ny) => {
        const x = Math.round((previewRect.left - canvasRect.left + previewRect.width * nx) * canvas.width / canvasRect.width);
        const y = Math.round((previewRect.top - canvasRect.top + previewRect.height * ny) * canvas.height / canvasRect.height);
        return pixels[(y * canvas.width + x) * 4 + 3];
      };
      return { startSide: sample(0.1, 0.92), endSide: sample(0.9, 0.92) };
    });
    assert(overlayLevels.startSide > 80, `The first-point side is not full mask density (${JSON.stringify(overlayLevels)}).`);
    assert(overlayLevels.endSide < 12, `The second-point side did not fade to zero (${JSON.stringify(overlayLevels)}).`);

    await page.locator("#local-overlay-color").evaluate((input) => {
      input.value = "#2864ff";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => state.localOverlayColor === "#2864ff");
    await page.waitForTimeout(50);
    const pickedColor = await page.locator("#local-mask-overlay").evaluate((canvas) => {
      const canvasRect = canvas.getBoundingClientRect();
      const previewRect = document.querySelector("#preview-canvas").getBoundingClientRect();
      const x = Math.round((previewRect.left - canvasRect.left + previewRect.width * 0.1) * canvas.width / canvasRect.width);
      const y = Math.round((previewRect.top - canvasRect.top + previewRect.height * 0.92) * canvas.height / canvasRect.height);
      const pixels = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
      return [...pixels];
    });
    assert(pickedColor[2] > pickedColor[0] * 3, `The overlay did not adopt the selected blue color (${pickedColor}).`);

    const maskBeforeZoom = await page.evaluate(() => JSON.stringify(selectedLocal().mask));
    await page.locator("#zoom-actual").click();
    const actualAlignment = await gradientZoomAlignment(page);
    assert(actualAlignment.backingIsBounded && actualAlignment.startAligned && actualAlignment.endAligned, `Gradient drifted at actual-size zoom: ${JSON.stringify(actualAlignment)}`);
    assert(actualAlignment.cacheSettled, `Gradient overlay did not settle at actual-size zoom: ${JSON.stringify(actualAlignment)}`);
    await page.locator("#zoom-in").click();
    const steppedAlignment = await gradientZoomAlignment(page);
    assert(steppedAlignment.backingIsBounded && steppedAlignment.startAligned && steppedAlignment.endAligned, `Gradient drifted after zooming in: ${JSON.stringify(steppedAlignment)}`);
    assert(steppedAlignment.cacheSettled, `Gradient overlay did not settle after zooming in: ${JSON.stringify(steppedAlignment)}`);
    await page.locator("#zoom-fit").click();
    const fitAlignment = await gradientZoomAlignment(page);
    assert(fitAlignment.backingIsBounded && fitAlignment.startAligned && fitAlignment.endAligned, `Gradient drifted after returning to Fit: ${JSON.stringify(fitAlignment)}`);
    assert(fitAlignment.cacheSettled, `Gradient overlay did not settle after returning to Fit: ${JSON.stringify(fitAlignment)}`);
    assert(actualAlignment.mask === maskBeforeZoom && steppedAlignment.mask === maskBeforeZoom && fitAlignment.mask === maskBeforeZoom, "Zooming changed the persisted gradient coordinates.");

    const overlay = page.locator("#local-mask-overlay");
    const previewBox = await page.locator("#preview-canvas").boundingBox();
    assert(previewBox, "Preview geometry is unavailable.");
    await page.evaluate(() => {
      window.__gradientHandoffSamples = [];
      window.__sampleGradientHandoff = true;
      const sampleFrame = () => {
        const canvas = document.querySelector("#local-mask-overlay");
        const canvasRect = canvas.getBoundingClientRect();
        const previewRect = activePreviewElement().getBoundingClientRect();
        const x = Math.round((previewRect.left - canvasRect.left + previewRect.width * 0.1) * canvas.width / canvasRect.width);
        const y = Math.round((previewRect.top - canvasRect.top + previewRect.height * 0.5) * canvas.height / canvasRect.height);
        window.__gradientHandoffSamples.push(canvas.getContext("2d").getImageData(x, y, 1, 1).data[3]);
        if (window.__sampleGradientHandoff) requestAnimationFrame(sampleFrame);
      };
      requestAnimationFrame(sampleFrame);
    });
    editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(previewBox.x + previewBox.width * 0.2, previewBox.y + previewBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(previewBox.x + previewBox.width * 0.8, previewBox.y + previewBox.height * 0.5, { steps: 8 });
    await page.mouse.up();
    assert((await editResponse).ok(), "Drawing a replacement gradient failed.");
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && !state.localMaskDraftDirty
        && localAuthoritativeMaskCache.get(local.id)?.signature === localMaskSpatialSignature(local.mask);
    });
    const gradientHandoffSamples = await page.evaluate(async () => {
      window.__sampleGradientHandoff = false;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return window.__gradientHandoffSamples;
    });
    assert(gradientHandoffSamples.length > 2, "The gradient handoff was not sampled across multiple frames.");
    assert(Math.min(...gradientHandoffSamples) > 40, `The gradient overlay flashed off during commit: ${JSON.stringify(gradientHandoffSamples)}`);

    const firstFalloff = await page.evaluate(() => gradientControlPoints(selectedLocal().mask.leaf).midpoint_1);
    editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(previewBox.x + previewBox.width * firstFalloff.x, previewBox.y + previewBox.height * firstFalloff.y);
    await page.mouse.down();
    await page.mouse.move(previewBox.x + previewBox.width * 0.32, previewBox.y + previewBox.height * 0.5, { steps: 5 });
    await page.mouse.up();
    assert((await editResponse).ok(), "Dragging the first falloff control failed.");
    const midpoint = await page.evaluate(() => selectedLocal().mask.leaf.gradient_midpoint_1);
    assert(midpoint < 0.25, `The first falloff control did not move (${midpoint}).`);

    const fan = panel.locator(".local-brush-control", { hasText: "Fan" }).locator("input");
    editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await fan.fill("55");
    assert((await editResponse).ok(), "Changing gradient fan failed.");
    assert(await page.evaluate(() => selectedLocal().mask.leaf.gradient_fan === 0.55), "Gradient fan did not persist.");

    const darkFull = panel.locator('.gradient-luma-ramp input[data-range-handle="1"]');
    const lumaRampBox = await panel.locator(".gradient-luma-ramp").boundingBox();
    assert(lumaRampBox, "Luminance range ramp has no interactive bounds.");
    const lumaValueX = (value) => lumaRampBox.x + 4.5 + (lumaRampBox.width - 9) * ((value + 24) / 48);
    editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(lumaValueX(-8), lumaRampBox.y + lumaRampBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(lumaValueX(-5), lumaRampBox.y + lumaRampBox.height / 2, { steps: 6 });
    await page.mouse.up();
    assert((await editResponse).ok(), "Dragging a luminance range handle failed.");
    const draggedDarkFull = Number(await darkFull.inputValue());
    assert(Math.abs(draggedDarkFull - (-5)) < .35, `The visible luminance handle did not follow the drag (${draggedDarkFull}).`);
    assert(Math.abs((await page.evaluate(() => selectedLocal().mask.leaf.full_start_ev)) - draggedDarkFull) < .011,
      "The dragged luminance handle and mask state diverged.");
    const rampVisual = await panel.locator(".gradient-luma-ramp").evaluate((ramp) => ({
      fullStart: Number.parseFloat(ramp.style.getPropertyValue("--gradient-luma-full-start")),
      enabled: ramp.classList.contains("enabled"),
      readouts: [...ramp.nextElementSibling.querySelectorAll("output")].map((output) => output.textContent),
    }));
    const expectedFullStartPosition = (draggedDarkFull + 24) / 48 * 100;
    assert(Math.abs(rampVisual.fullStart - expectedFullStartPosition) < .05,
      `The luminance gizmo did not redraw from its mask value: ${JSON.stringify(rampVisual)}`);
    assert(rampVisual.enabled && rampVisual.readouts[1] === draggedDarkFull.toFixed(1),
      `The luminance gizmo did not expose the dragged value: ${JSON.stringify(rampVisual)}`);
    assert(await page.evaluate(() => selectedLocal().mask.leaf.gradient_luma_enabled), "Moving a luminance dot did not enable luminance refinement.");

    for (const gesture of [
      { index: 0, from: -12, to: -14, field: "fade_in_start_ev" },
      { index: 2, from: 6, to: 4, field: "full_end_ev" },
      { index: 3, from: 10, to: 12, field: "fade_out_end_ev" },
    ]) {
      editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
      await page.mouse.move(lumaValueX(gesture.from), lumaRampBox.y + lumaRampBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(lumaValueX(gesture.to), lumaRampBox.y + lumaRampBox.height / 2, { steps: 5 });
      await page.mouse.up();
      assert((await editResponse).ok(), `Dragging luminance handle ${gesture.index} failed.`);
      const visible = Number(await panel.locator(`.gradient-luma-ramp input[data-range-handle="${gesture.index}"]`).inputValue());
      const stored = await page.evaluate((field) => Number(selectedLocal().mask.leaf[field]), gesture.field);
      assert(Math.abs(visible - gesture.to) < .35 && Math.abs(stored - visible) < .011,
        `Luminance handle ${gesture.index} did not stay synchronized: ${JSON.stringify({ visible, stored, gesture })}`);
    }

    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    });
    fs.mkdirSync(path.resolve(__dirname, "../output/gradient-qa"), { recursive: true });
    await page.screenshot({ path: path.resolve(__dirname, "../output/gradient-qa/gradient-controls-and-overlay.png"), fullPage: true });
    assert(await overlay.isVisible(), "Gradient overlay canvas disappeared.");
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    if (requestFailures.length) throw new Error(`Request failures: ${requestFailures.join(" | ")}`);
    console.log(JSON.stringify({ midpoint, overlayLevels, gradientHandoffSamples, controls: labels.length, lumaHandles: 4 }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
