const { chromium } = require("playwright");
const path = require("path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function overlayColors(overlay) {
  return overlay.evaluate((canvas) => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let white = 0;
    let visible = 0;
    let maxAlpha = 0;
    let alphaSum = 0;
    let minX = canvas.width;
    let maxX = -1;
    let minY = canvas.height;
    let maxY = -1;
    for (let index = 0; index < pixels.length; index += 4) {
      const [r, g, b, a] = pixels.slice(index, index + 4);
      if (a > 8) {
        visible += 1;
        const pixel = index / 4;
        const pixelX = pixel % canvas.width;
        const pixelY = Math.floor(pixel / canvas.width);
        minX = Math.min(minX, pixelX);
        maxX = Math.max(maxX, pixelX);
        minY = Math.min(minY, pixelY);
        maxY = Math.max(maxY, pixelY);
      }
      maxAlpha = Math.max(maxAlpha, a);
      alphaSum += a;
      if (a > 8 && r > 150 && r > g * 1.5 && r > b * 1.2) red += 1;
      if (a > 8 && r > 180 && g > 180 && b > 180) white += 1;
    }
    return { red, white, visible, maxAlpha, alphaSum, bounds: visible ? [minX, minY, maxX, maxY] : null, size: [canvas.width, canvas.height] };
  });
}

async function authoritativeMaskAlphaQuality(page) {
  return page.evaluate(() => {
    const local = selectedLocal();
    const leaf = local?.mask?.leaf;
    const details = leaf ? {
      shift: leaf.mask_shift_edge,
      feather: leaf.mask_feather,
      strokes: leaf.strokes?.length || 0,
      points: leaf.strokes?.reduce((sum, stroke) => sum + (stroke.points?.length || 0), 0) || 0,
      erases: leaf.strokes?.map((stroke) => Boolean(stroke.erase)),
      flows: leaf.strokes?.map((stroke) => stroke.flow),
      opacities: leaf.strokes?.map((stroke) => stroke.opacity),
      radii: leaf.strokes?.map((stroke) => stroke.radius),
    } : null;
    const canvas = local ? localAuthoritativeMaskCache.get(local.id)?.canvas : null;
    if (!canvas) return { visiblePixels: 0, alphaLevels: 0, largestPlateau: 0, details };
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const levels = new Set();
    const histogram = new Map();
    let visiblePixels = 0;
    let alphaSum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      alphaSum += alpha;
      if (alpha <= 1) continue;
      visiblePixels += 1;
      levels.add(alpha);
      histogram.set(alpha, (histogram.get(alpha) || 0) + 1);
    }
    return {
      visiblePixels,
      alphaSum,
      alphaLevels: levels.size,
      largestPlateau: Math.max(0, ...histogram.values()),
      details,
    };
  });
}

async function authoritativeMaskAlphaAt(page, x, y) {
  return page.evaluate(([normalizedX, normalizedY]) => {
    const local = selectedLocal();
    const canvas = local ? localAuthoritativeMaskCache.get(local.id)?.canvas : null;
    if (!canvas) return 0;
    const pixelX = Math.min(canvas.width - 1, Math.max(0, Math.round(normalizedX * (canvas.width - 1))));
    const pixelY = Math.min(canvas.height - 1, Math.max(0, Math.round(normalizedY * (canvas.height - 1))));
    return canvas.getContext("2d").getImageData(pixelX, pixelY, 1, 1).data[3];
  }, [x, y]);
}

async function overlayMaskAlphaAt(page, x, y) {
  return page.evaluate(([normalizedX, normalizedY]) => {
    const overlay = document.querySelector("#local-mask-overlay");
    const preview = document.querySelector("#preview-canvas");
    const overlayRect = overlay.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const pixelX = Math.min(
      overlay.width - 1,
      Math.max(0, Math.round((previewRect.left + normalizedX * previewRect.width - overlayRect.left) * overlay.width / overlayRect.width)),
    );
    const pixelY = Math.min(
      overlay.height - 1,
      Math.max(0, Math.round((previewRect.top + normalizedY * previewRect.height - overlayRect.top) * overlay.height / overlayRect.height)),
    );
    return overlay.getContext("2d").getImageData(pixelX, pixelY, 1, 1).data[3];
  }, [x, y]);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);
    await page.locator("#grade-mode-local").click();

    const createResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.locator('[data-local-tool="brush"]').click();
    assert((await createResponse).ok(), "Creating the brush mask failed.");

    const panels = page.locator(".local-mask-subpanel");
    assert(await panels.count() === 2, "Brush tip and painted mask controls were not split into two panels.");
    const gradientGlyph = await page.locator(".local-tool-gradient .local-tool-icon").evaluate((node) => getComputedStyle(node, "::before").content.replaceAll('"', "").codePointAt(0));
    assert(gradientGlyph === 0xe76f, `Gradient tool is not using the graduated-band Fluent glyph (${gradientGlyph}).`);
    const lumaGlyph = await page.locator(".local-tool-luma .local-tool-icon").evaluate((node) => getComputedStyle(node, "::before").content.replaceAll('"', "").codePointAt(0));
    assert(lumaGlyph === 0xe9e9, `Luma tool is not using the temporary equalizer placeholder (${lumaGlyph}).`);
    const brushLabels = await panels.nth(0).locator(".local-brush-control > .instrument-control-label").allTextContents();
    const maskLabels = await panels.nth(1).locator(".local-brush-control > .instrument-control-label").allTextContents();
    assert(brushLabels.join("|").replace(/\d+(?:\.\d+)?%/g, "") === "Size|Feather|Flow|Density", `Unexpected brush controls: ${brushLabels.join(", ")}`);
    assert(maskLabels.join("|").replace(/[+\-]?\d+(?:\.\d+)?%/g, "") === "Opacity|Shift Edge|Feather", `Unexpected mask controls: ${maskLabels.join(", ")}`);
    assert(await panels.nth(1).locator('input[type="range"]').first().isDisabled(), "Painted-mask controls should be disabled before the first stroke.");
    assert(await page.locator("#local-invert").isDisabled(), "Painted-mask invert should be disabled before the first stroke.");
    assert(await page.locator("#local-show-mask").getAttribute("aria-pressed") === "true", "A new brush should show its overlay by default.");
    assert(await page.locator(".local-mask-expression-row").count() === 0, "The redundant mask-expression strip is still visible.");
    const adjustmentMenuButton = page.getByRole("button", { name: "More actions for Local Adjustment 1" });
    assert(await adjustmentMenuButton.getAttribute("aria-haspopup") === "menu", "The adjustment ellipsis is not an accessible menu button.");
    await adjustmentMenuButton.click();
    const addSubMaskMenuItem = page.getByRole("menuitem", { name: "Add sub-mask" });
    assert(await addSubMaskMenuItem.isVisible(), "Add sub-mask was not moved into the adjustment menu.");
    await page.screenshot({
      path: path.resolve(__dirname, "../output/brush-qa/adjustment-menu.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    assert(!(await addSubMaskMenuItem.isVisible()), "Escape did not close the adjustment menu.");
    await adjustmentMenuButton.click();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("menuitem", { name: "Add sub-mask" }).click();
    assert(await page.getByRole("menuitem", { name: "Add sub-mask" }).count() === 0, "Canceling Add sub-mask left the adjustment menu open.");

    const lowDensityFeather = await page.evaluate(() => {
      const size = 257;
      const source = document.createElement("canvas");
      source.width = size;
      source.height = size;
      const context = source.getContext("2d");
      context.fillStyle = "rgba(255, 38, 61, 0.25)";
      context.beginPath();
      context.arc(size / 2, size / 2, 30, 0, Math.PI * 2);
      context.fill();
      return [0, 0.25, 0.5, 1].map((amount) => {
        const output = postProcessBrushMaskPreview(source, { mask_shift_edge: 0, mask_feather: amount * 0.05 }, size, size);
        const alpha = output.getContext("2d").getImageData(0, 0, size, size).data.filter((_, index) => index % 4 === 3);
        const peak = Math.max(...alpha);
        return {
          center: alpha[Math.floor(size / 2) * size + Math.floor(size / 2)],
          softPixels: alpha.filter((value) => value > 2 && value < peak - 2).length,
          outside: alpha[Math.floor(size / 2) * size + Math.floor(size / 2) + 55],
        };
      });
    });
    assert(lowDensityFeather.slice(1).every((sample) => Math.abs(sample.center - lowDensityFeather[0].center) <= 2), `Mask Feather changed the painted density: ${JSON.stringify(lowDensityFeather)}`);
    assert(lowDensityFeather[3].softPixels > lowDensityFeather[1].softPixels * 2, `Maximum Mask Feather did not create a materially broader soft edge: ${JSON.stringify(lowDensityFeather)}`);
    assert(lowDensityFeather[3].outside > 2, `Maximum Mask Feather did not reach beyond the original mask edge: ${JSON.stringify(lowDensityFeather)}`);

    const overlay = page.locator("#local-mask-overlay");
    const box = await overlay.boundingBox();
    assert(box && box.width > 100 && box.height > 100, "The mask overlay is not drawable.");
    const empty = await overlayColors(overlay);
    assert(empty.red === 0, `A new brush mask was not empty (${empty.red} red pixels).`);

    const controls = panels.nth(0).locator(".local-brush-control input");
    for (const [index, value] of [[0, "0.045"], [1, "70"], [2, "35"], [3, "70"]]) {
      await controls.nth(index).evaluate((input, next) => {
        input.value = next;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    }
    await page.waitForTimeout(100);
    const tipPreview = await overlayColors(overlay);
    const tipRects = await page.evaluate(() => {
      const rects = Object.fromEntries([
        ["overlay", document.querySelector("#local-mask-overlay")],
        ["preview", document.querySelector("#preview-canvas")],
        ["pane", document.querySelector("#preview-primary-pane")],
        ["rail", document.querySelector(".grade-rail")],
        ["splitter", document.querySelector("#grade-splitter")],
      ].map(([name, element]) => {
        const rect = element.getBoundingClientRect();
        return [name, [rect.left, rect.top, rect.right, rect.bottom]];
      }));
      return { ...rects, dpr: window.devicePixelRatio };
    });
    const visibleRightPixel = (tipRects.splitter[0] - tipRects.overlay[0]) * tipRects.dpr;
    assert(tipPreview.bounds[2] <= Math.ceil(visibleRightPixel), "The pinned brush preview was hidden underneath the control rail.");
    assert(tipPreview.red === 0 && tipPreview.visible > 50, "Adjusting brush options did not pin the neutral brush/feather cursor to the image edge.");
    await page.screenshot({
      path: path.resolve(__dirname, "../output/brush-qa/brush-controls.png"),
      fullPage: true,
    });

    const editResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.mouse.move(box.x + box.width * 0.30, box.y + box.height * 0.46);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55, { steps: 18 });
    await page.mouse.up();
    assert((await editResponse).ok(), "Painting a brush stroke failed.");
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    });

    const painted = await overlayColors(overlay);
    await page.screenshot({
      path: path.resolve(__dirname, "../output/brush-qa/after.png"),
      fullPage: true,
    });
    assert(painted.red > 500, `The painted mask did not produce a red overlay (${painted.red} pixels).`);
    assert(painted.white < painted.red * 0.2, `The saved stroke still looks like a white blob (${painted.white} white vs ${painted.red} red pixels).`);
    assert(!(await page.getByRole("button", { name: "Undo stroke" }).isDisabled()), "Undo stroke did not enable after painting.");
    assert(!(await panels.nth(1).locator('input[type="range"]').first().isDisabled()), "Painted-mask controls did not enable after painting.");
    assert(!(await page.locator("#local-invert").isDisabled()), "Painted-mask invert did not enable after painting.");

    const maskShiftEdge = panels.nth(1).locator(".local-brush-control", { hasText: "Shift Edge" }).locator('input[type="range"]');
    const maskFeather = panels.nth(1).locator(".local-brush-control", { hasText: "Feather" }).locator('input[type="range"]');
    const shiftedDraftResponse = page.waitForResponse((response) =>
      response.url().includes("/local-mask/") && response.url().endsWith("/preview") && response.request().method() === "POST",
    );
    await maskShiftEdge.evaluate((input) => {
      input.value = "35";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert((await shiftedDraftResponse).ok(), "Compiling the live Shift Edge draft failed.");
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    });
    const expanded = await overlayColors(overlay);
    // Focusing a mask control hides the neutral brush cursor, so compare the
    // red mask itself rather than total visible overlay pixels.
    assert(expanded.red > painted.red, `Positive Shift Edge did not expand the mask (${painted.red} to ${expanded.red} red pixels).`);
    await maskShiftEdge.evaluate((input) => {
      input.value = "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const featherDraftResponse = page.waitForResponse((response) =>
      response.url().includes("/local-mask/") && response.url().endsWith("/preview") && response.request().method() === "POST",
    );
    let featherDraftCount = 0;
    const countFeatherDraft = (response) => {
      if (response.url().includes("/local-mask/") && response.url().endsWith("/preview")) featherDraftCount += 1;
    };
    page.on("response", countFeatherDraft);
    for (const value of [20, 40, 60, 80]) {
      await maskFeather.evaluate((input, next) => {
        input.value = String(next);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
      await page.waitForTimeout(28);
    }
    assert((await featherDraftResponse).ok(), "Compiling the live Feather draft failed.");
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    });
    page.off("response", countFeatherDraft);
    assert(
      featherDraftCount >= 1 && featherDraftCount < 4,
      `A continuous Feather drag did not collapse to a bounded latest-state preview (${featherDraftCount} exact frame(s)).`,
    );
    const feathered = await overlayColors(overlay);
    await page.screenshot({
      path: path.resolve(__dirname, "../output/brush-qa/feathered.png"),
      fullPage: true,
    });
    assert(feathered.red > painted.red, `Mask feather did not spread the existing mask (${painted.red} to ${feathered.red} red pixels).`);
    assert(feathered.red > feathered.visible * 0.9, `Mask feather introduced non-red overlay pixels (${feathered.red} red of ${feathered.visible} visible).`);

    const featherResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await maskFeather.evaluate((input) => input.dispatchEvent(new Event("change", { bubbles: true })));
    assert((await featherResponse).ok(), "Committing painted-mask feather failed.");
    await page.waitForFunction(() => {
      const localId = document.querySelector("#local-adjustment-list button[data-local-id]")?.dataset.localId;
      const entry = localId ? localAuthoritativeMaskCache.get(localId) : null;
      return Boolean(entry && entry.signature === JSON.stringify(selectedLocal()?.mask));
    }, null, { timeout: 5000 });
    assert(await page.locator("#preview-status").isHidden(), "The UI remained stuck on Updating after mask feather committed.");
    const authoritativeMask = await overlayColors(overlay);
    assert(authoritativeMask.red > painted.red * 2, `The server mask driving the adjustment is not visibly feathered: ${JSON.stringify({ painted, authoritativeMask })}`);
    assert(
      authoritativeMask.alphaSum === feathered.alphaSum
      && authoritativeMask.red === feathered.red
      && JSON.stringify(authoritativeMask.bounds) === JSON.stringify(feathered.bounds),
      `The live Feather preview differs from the settled server mask: ${JSON.stringify({ feathered, authoritativeMask })}`,
    );

    const maskMatrix = [];
    for (const shift of [-66, 0, 66]) {
      for (const feather of [0, 50, 100]) {
        await maskShiftEdge.evaluate((input, next) => {
          input.value = String(next);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }, shift);
        await maskFeather.evaluate((input, next) => {
          input.value = String(next);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }, feather);
        await page.waitForFunction(() => {
          const local = selectedLocal();
          return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
        });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const quality = await authoritativeMaskAlphaQuality(page);
        maskMatrix.push({ shift, feather, ...quality });
        await page.screenshot({
          path: path.resolve(__dirname, `../output/brush-qa/matrix-shift-${shift}-feather-${feather}.png`),
          fullPage: true,
        });
        if (feather === 100) {
          assert(
            quality.alphaLevels >= 80,
            `Maximum Feather is visibly banded at Shift Edge ${shift}%: ${JSON.stringify(quality)}`,
          );
          assert(
            quality.largestPlateau < quality.visiblePixels * 0.2,
            `Maximum Feather contains a giant alpha plateau at Shift Edge ${shift}%: ${JSON.stringify(quality)}`,
          );
        }
      }
    }

    await maskShiftEdge.evaluate((input) => {
      input.value = "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await maskFeather.evaluate((input) => {
      input.value = "80";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    });
    const matrixCommitResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await maskFeather.evaluate((input) => input.dispatchEvent(new Event("change", { bubbles: true })));
    assert((await matrixCommitResponse).ok(), "Restoring the post-matrix mask configuration failed.");

    const brushSettingsResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    for (const [index, value] of [[0, "0.025"], [1, "50"], [2, "100"], [3, "100"]]) {
      await controls.nth(index).evaluate((input, next) => {
        input.value = next;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    }
    await controls.nth(3).evaluate((input) => input.dispatchEvent(new Event("change", { bubbles: true })));
    assert((await brushSettingsResponse).ok(), "Committing the reproduction brush settings failed.");

    const reproductionMaskResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await maskShiftEdge.evaluate((input) => {
      input.value = "50";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await maskFeather.evaluate((input) => {
      input.value = "50";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert((await reproductionMaskResponse).ok(), "Committing the reproduction mask settings failed.");

    const previewBox = await page.locator("#preview-canvas").boundingBox();
    assert(previewBox, "The preview canvas is unavailable for the circle erase regression.");
    const circlePaintResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.mouse.move(previewBox.x + previewBox.width * 0.75, previewBox.y + previewBox.height * 0.30);
    await page.mouse.down();
    await page.mouse.up();
    assert((await circlePaintResponse).ok(), "Painting the circle erase regression mask failed.");
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    });

    await page.locator("#local-eraser").click();
    const beforeErase = await authoritativeMaskAlphaQuality(page);
    const beforeEraseCenter = await authoritativeMaskAlphaAt(page, 0.84, 0.30);
    const revisionBeforeErase = await page.evaluate(() => state.editRevision);
    const staleMaskRequests = [];
    const recordMaskRequest = (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "GET"
        && url.pathname.includes("/local-mask/")
        && Number(url.searchParams.get("edit_revision")) === revisionBeforeErase
      ) {
        staleMaskRequests.push(request.url());
      }
    };
    page.on("request", recordMaskRequest);
    const eraseResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    const eraseStarted = Date.now();
    await page.mouse.move(previewBox.x + previewBox.width * 0.81, previewBox.y + previewBox.height * 0.30);
    await page.mouse.down();
    await page.mouse.move(previewBox.x + previewBox.width * 0.87, previewBox.y + previewBox.height * 0.30, { steps: 16 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const duringEraseCenterOverlay = await overlayMaskAlphaAt(page, 0.84, 0.30);
    await page.evaluate(() => {
      window.__eraseReleaseAlphaSamples = new Promise((resolve) => {
        const samples = [];
        const deadline = performance.now() + 1000;
        const sample = () => {
          const overlay = document.querySelector("#local-mask-overlay");
          const preview = document.querySelector("#preview-canvas");
          const overlayRect = overlay.getBoundingClientRect();
          const previewRect = preview.getBoundingClientRect();
          const pixelX = Math.round((previewRect.left + 0.84 * previewRect.width - overlayRect.left) * overlay.width / overlayRect.width);
          const pixelY = Math.round((previewRect.top + 0.30 * previewRect.height - overlayRect.top) * overlay.height / overlayRect.height);
          samples.push(overlay.getContext("2d").getImageData(pixelX, pixelY, 1, 1).data[3]);
          if (performance.now() < deadline) requestAnimationFrame(sample);
          else resolve(samples);
        };
        requestAnimationFrame(sample);
      });
    });
    await page.mouse.up();
    assert((await eraseResponse).ok(), "Erasing the painted mask failed.");
    const eraseDuration = Date.now() - eraseStarted;
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    });
    const settledErase = await authoritativeMaskAlphaQuality(page);
    const settledEraseCenter = await authoritativeMaskAlphaAt(page, 0.84, 0.30);
    const eraseReleaseAlphaSamples = await page.evaluate(() => window.__eraseReleaseAlphaSamples);
    page.off("request", recordMaskRequest);
    assert(
      settledErase.alphaSum < beforeErase.alphaSum,
      `The erase stroke reverted after pointer release: ${JSON.stringify({ beforeErase, settledErase })}`,
    );
    assert(
      settledErase.details?.strokes === beforeErase.details?.strokes + 1,
      `The committed erase stroke was not retained: ${JSON.stringify({ beforeErase, settledErase })}`,
    );
    assert(
      beforeEraseCenter > 5,
      `Shift Edge/Feather did not create coverage outside the original paint dab (${beforeEraseCenter}).`,
    );
    assert(
      settledEraseCenter < beforeEraseCenter * 0.8,
      `The eraser could not remove coverage outside the original paint bounds: ${JSON.stringify({ beforeEraseCenter, settledEraseCenter })}`,
    );
    assert(
      staleMaskRequests.length === 0,
      `Pointer release requested the pre-erase mask revision: ${JSON.stringify(staleMaskRequests)}`,
    );
    assert(
      Math.max(...eraseReleaseAlphaSamples) <= duringEraseCenterOverlay + 2,
      `The erased preview flashed back after pointer release: ${JSON.stringify({ duringEraseCenterOverlay, eraseReleaseAlphaSamples })}`,
    );
    assert(eraseDuration < 2500, `The incremental eraser gesture is still too slow (${eraseDuration} ms).`);

    // Force each preceding commit to finish while the next erase gesture is
    // active. An older response must not detach the leaf receiving the newer
    // stroke, and adjusted previews must wait for the final queued document.
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);
    const rapidEraseBefore = await authoritativeMaskAlphaQuality(page);
    let rapidCommitResponses = 0;
    const prematureAdjustedPreviews = [];
    const countRapidResponses = (response) => {
      if (response.url().includes("/edit-commands") && response.request().method() === "POST") rapidCommitResponses += 1;
    };
    const recordPrematurePreview = (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/\/preview\/(?:hdr|sdr)$/.test(pathname) && rapidCommitResponses < 3) {
        prematureAdjustedPreviews.push({ url: request.url(), committedResponses: rapidCommitResponses });
      }
    };
    page.on("response", countRapidResponses);
    page.on("request", recordPrematurePreview);

    const firstRapidResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.mouse.move(previewBox.x + previewBox.width * 0.39, previewBox.y + previewBox.height * 0.48);
    await page.mouse.down();
    await page.mouse.move(previewBox.x + previewBox.width * 0.44, previewBox.y + previewBox.height * 0.49, { steps: 8 });
    await page.mouse.up();

    await page.mouse.move(previewBox.x + previewBox.width * 0.48, previewBox.y + previewBox.height * 0.50);
    await page.mouse.down();
    assert((await firstRapidResponse).ok(), "The first overlapping erase commit failed.");
    const secondRapidResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.mouse.move(previewBox.x + previewBox.width * 0.53, previewBox.y + previewBox.height * 0.52, { steps: 8 });
    await page.mouse.up();

    await page.mouse.move(previewBox.x + previewBox.width * 0.57, previewBox.y + previewBox.height * 0.53);
    await page.mouse.down();
    assert((await secondRapidResponse).ok(), "The second overlapping erase commit failed.");
    const thirdRapidResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.mouse.move(previewBox.x + previewBox.width * 0.62, previewBox.y + previewBox.height * 0.54, { steps: 8 });
    await page.mouse.up();
    assert((await thirdRapidResponse).ok(), "The third overlapping erase commit failed.");
    await page.waitForFunction(() => state.localMaskCommitDepth === 0 && !state.localPointerGesture);
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    });
    page.off("response", countRapidResponses);
    page.off("request", recordPrematurePreview);

    const rapidEraseAfter = await authoritativeMaskAlphaQuality(page);
    const rapidEraseState = await page.evaluate(async () => {
      const local = selectedLocal();
      const response = await fetch(`/api/session/${state.session.session_id}/edit-state`);
      const server = await response.json();
      const serverLocal = server.document.local_adjustments.find((item) => item.id === local.id);
      return {
        frontendStrokes: local.mask.leaf.strokes.length,
        serverStrokes: serverLocal.mask.leaf.strokes.length,
        finalErases: local.mask.leaf.strokes.slice(-3).map((stroke) => Boolean(stroke.erase)),
      };
    });
    assert(
      rapidEraseAfter.details.strokes === rapidEraseBefore.details.strokes + 3,
      `Overlapping erase responses dropped a stroke: ${JSON.stringify({ rapidEraseBefore, rapidEraseAfter })}`,
    );
    assert(
      rapidEraseState.frontendStrokes === rapidEraseState.serverStrokes && rapidEraseState.finalErases.every(Boolean),
      `The optimistic mask and committed mask diverged: ${JSON.stringify(rapidEraseState)}`,
    );
    assert(
      rapidEraseAfter.alphaSum < rapidEraseBefore.alphaSum,
      `Consecutive eraser strokes did not reduce the mask: ${JSON.stringify({ rapidEraseBefore, rapidEraseAfter })}`,
    );
    assert(
      prematureAdjustedPreviews.length === 0,
      `An intermediate mask revision reached the adjusted preview: ${JSON.stringify(prematureAdjustedPreviews)}`,
    );

    const bypassResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    const localBypass = page.locator("[data-local-bypass-id]").first();
    await localBypass.click();
    assert((await bypassResponse).ok(), "Bypassing the complete local adjustment failed.");
    const bypassState = await page.evaluate(async () => {
      const local = selectedLocal();
      const response = await fetch(`/api/session/${state.session.session_id}/edit-state`);
      const server = await response.json();
      return {
        frontendEnabled: local.enabled,
        serverEnabled: server.document.local_adjustments.find((item) => item.id === local.id)?.enabled,
        bypassedClass: document.querySelector("[data-local-bypass-id]")?.classList.contains("bypassed"),
        pressed: document.querySelector("[data-local-bypass-id]")?.getAttribute("aria-pressed"),
        color: getComputedStyle(document.querySelector("[data-local-bypass-id]")).color,
        bypassColor: (() => {
          const probe = document.createElement("span");
          probe.style.color = "var(--bypass-icon-hidden)";
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        })(),
      };
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bypassedOverlay = await overlayColors(overlay);
    assert(
      bypassState.frontendEnabled === false
      && bypassState.serverEnabled === false
      && bypassState.bypassedClass === true
      && bypassState.pressed === "true"
      && bypassState.color === bypassState.bypassColor,
      `Bypass did not gate the full persisted local adjustment: ${JSON.stringify(bypassState)}`,
    );
    assert(bypassedOverlay.visible === 0, `Bypassing a local adjustment left its mask overlay visible: ${JSON.stringify(bypassedOverlay)}`);
    const enableResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await localBypass.click();
    assert((await enableResponse).ok(), "Re-enabling the complete local adjustment failed.");
    assert(await page.evaluate(() => selectedLocal()?.enabled) === true, "Re-enabling the local adjustment did not persist in the UI.");
    await page.locator("#local-eraser").click();

    const invertResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.locator("#local-invert").click();
    assert((await invertResponse).ok(), "Inverting the painted mask failed.");
    assert(await page.locator("#local-invert").getAttribute("aria-pressed") === "true", "Painted-mask invert did not remain active.");
    const inverted = await overlayColors(overlay);
    assert(inverted.red > painted.red * 2, `Invert did not flip the composed mask (${painted.red} to ${inverted.red} red pixels).`);

    await page.locator("#local-show-mask").click();
    const hidden = await overlayColors(overlay);
    assert(hidden.red === 0, "Show overlay did not hide the red mask.");

    assert(await page.locator("#local-add-adjustment").textContent() === "+", "The stack add control is not a plus button.");
    assert(await page.locator("#local-delete").textContent() === "−", "The stack remove control is not a minus button.");
    const addResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.locator("#local-add-adjustment").click();
    assert((await addResponse).ok(), "Adding a local adjustment with the plus button failed.");
    await page.locator("#local-adjustment-list li").nth(1).waitFor({ state: "attached" });
    assert(await page.locator("#local-adjustment-list li").count() === 2, "The plus button did not add an adjustment.");
    const removeResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.locator("#local-delete").click();
    assert((await removeResponse).ok(), "Removing a local adjustment with the minus button failed.");
    await page.locator("#local-adjustment-list li").nth(1).waitFor({ state: "detached" });
    assert(await page.locator("#local-adjustment-list li").count() === 1, "The minus button did not remove the selected adjustment.");

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ brushLabels, maskLabels, empty, tipPreview, tipRects, painted, expanded, feathered, authoritativeMask, maskMatrix, beforeErase, beforeEraseCenter, duringEraseCenterOverlay, eraseReleaseAlphaSamples, settledErase, settledEraseCenter, eraseDuration, rapidEraseBefore, rapidEraseAfter, rapidEraseState, prematureAdjustedPreviews, bypassState, bypassedOverlay, inverted, hidden }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
