const { chromium } = require("playwright");
const path = require("path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function overlayPixelCount(page) {
  return page.locator("#local-mask-overlay").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) visible += 1;
    }
    return visible;
  });
}

async function canvasVariationCount(locator) {
  return locator.evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const base = [pixels[0], pixels[1], pixels[2], pixels[3]];
    let varied = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (
        Math.abs(pixels[index] - base[0])
        + Math.abs(pixels[index + 1] - base[1])
        + Math.abs(pixels[index + 2] - base[2])
        + Math.abs(pixels[index + 3] - base[3]) > 20
      ) varied += 1;
    }
    return varied;
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const requestFailures = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "unknown failure";
    if (failure === "net::ERR_ABORTED" && /\/(preview|scopes)(\/|\?)/.test(request.url())) return;
    if (failure === "net::ERR_ABORTED" && /\/local-mask\/[^/]+\/preview$/.test(new URL(request.url()).pathname)) return;
    requestFailures.push(`${request.method()} ${request.url()}: ${failure}`);
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    assert(await page.locator(".local-stack-surface").count() === 1, "The persistent local-adjustment list surface is missing.");
    assert(await page.locator("[data-local-tool]:disabled").count() === 0, "Local creation tools should remain clickable before a source is loaded.");
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);

    const localToggle = page.locator("#grade-mode-local");
    await localToggle.click();
    assert(await localToggle.getAttribute("aria-expanded") === "true", "Local Adjustments did not expand.");
    assert(await page.locator("#local-adjustments-group").evaluate((node) => !node.classList.contains("collapsed")), "Local group remained collapsed.");
    assert(await page.locator('[data-group="hdr-tone"]').isVisible(), "Tone disappeared when Local Adjustments expanded.");
    const localGroupBox = await page.locator("#local-adjustments-group").boundingBox();
    const cropGroupBox = await page.locator('[data-group="geometry"]').boundingBox();
    assert(
      localGroupBox && cropGroupBox && cropGroupBox.y >= localGroupBox.y + localGroupBox.height - 1,
      "Crop & Rotate and the grading groups should remain in flow below the expanded Local Adjustments group.",
    );

    const expectedTools = ["brush", "linear_gradient", "luminance_range", "path"];
    for (let index = 0; index < expectedTools.length; index += 1) {
      const tool = expectedTools[index];
      const button = page.locator(`[data-local-tool="${tool}"]`);
      await button.click();
      assert(await button.getAttribute("aria-pressed") === "true", `${tool} did not expose immediate active state.`);
      await page.waitForFunction((count) => document.querySelectorAll("#local-adjustment-list > li").length === count, index + 1);
      let gpuLuma = false;
      if (tool === "luminance_range") {
        gpuLuma = await page.evaluate(() => Boolean(state.gpuPreview?.available));
        if (gpuLuma) {
          await page.waitForFunction(() => {
            const resources = window.HDRFinisherPerformance.gpuSnapshot().resources;
            return resources.sceneLuminanceTextures > 0 && resources.localMasks > 0;
          });
        } else {
          await page.waitForFunction(() => {
            const local = selectedLocal();
            const cached = local ? localAuthoritativeMaskCache.get(local.id) : null;
            return Boolean(cached && cached.signature === localMaskSpatialSignature(local.mask));
          });
        }
      }
      const visiblePixels = await overlayPixelCount(page);
      if (tool === "brush") {
        assert(visiblePixels === 0, "A new brush mask should start empty instead of painting a default blob.");
      } else if (tool === "luminance_range" && gpuLuma) {
        assert(await page.locator("#preview-canvas").isVisible(), "The GPU-resident Luma overlay did not remain on the preview canvas.");
      } else {
        assert(visiblePixels > 100, `${tool} did not render a visible preview gizmo.`);
      }
      await page.locator("#preview-primary-pane").screenshot({
        path: path.resolve(__dirname, `../../docs/testing/local-adjustments-${tool.replaceAll("_", "-")}-overlay-qa.png`),
      });
    }
    const featherSamples = await page.evaluate(() => [0, 0.08, 0.25, 0.5, 0.75, 1].map((amount) => {
      const settings = brushStrokeSettings({
        brush_radius: 0.05,
        brush_hardness: 1 - amount,
        brush_flow: 1,
        brush_opacity: 1,
        brush_smoothing: 0.35,
        strokes: [],
      });
      return { radius: settings.radius, innerRadius: settings.radius * settings.hardness };
    }));
    assert(featherSamples.every((sample, index) => index === 0 || sample.radius > featherSamples[index - 1].radius), "Brush Feather response is not strictly monotonic.");
    assert(featherSamples.every((sample) => Math.abs(sample.innerRadius - 0.05) < 1e-8), "Brush Feather changed the solid brush core.");
    const maskFeatherSmoothing = await page.evaluate(() => {
      const size = 129;
      const source = document.createElement("canvas");
      source.width = size;
      source.height = size;
      const context = source.getContext("2d");
      context.fillStyle = "rgb(255, 38, 61)";
      context.beginPath();
      context.arc(size / 2, size / 2, 10, 0, Math.PI * 2);
      context.fill();
      return [0, 0.25, 0.5, 0.75, 1].map((amount) => {
        const output = postProcessBrushMaskPreview(source, { mask_shift_edge: 0, mask_feather: amount * 0.05 }, size, size);
        const alpha = output.getContext("2d").getImageData(0, 0, size, size).data.filter((_, index) => index % 4 === 3);
        const peak = Math.max(...alpha);
        return {
          peak,
          softPixels: alpha.filter((value) => value > 2 && value < peak - 2).length,
          outside: alpha[Math.floor(size / 2) * size + Math.floor(size / 2) + 25],
        };
      });
    });
    assert(maskFeatherSmoothing.slice(1).every((sample) => Math.abs(sample.peak - maskFeatherSmoothing[0].peak) <= 2), `Mask Feather changed peak density: ${JSON.stringify(maskFeatherSmoothing)}`);
    assert(maskFeatherSmoothing.every((sample, index) => index === 0 || sample.softPixels > maskFeatherSmoothing[index - 1].softPixels), `Mask Feather did not progressively smooth the edge: ${JSON.stringify(maskFeatherSmoothing)}`);
    assert(maskFeatherSmoothing.at(-1).outside > 2, `Maximum Mask Feather is still too narrow: ${JSON.stringify(maskFeatherSmoothing)}`);
    await page.screenshot({ path: path.resolve(__dirname, "../../docs/testing/local-adjustments-overlay-qa.png"), fullPage: false });

    const brushRow = page.locator("#local-adjustment-list button[data-local-id]").first();
    await brushRow.click();
    const brushSize = page.locator(".local-mask-subpanel").first().locator('input[type="range"]').first();
    await brushSize.fill("0.1");
    await brushSize.dblclick();
    assert(await brushSize.inputValue() === "0.025", "Double-click did not reset the dynamic Brush Size slider to its declared default.");
    const eraser = page.locator("#local-eraser");
    assert(!(await eraser.isDisabled()), "Erase should be available for a selected brush mask.");

    const overlay = page.locator("#local-mask-overlay");
    const overlayBox = await overlay.boundingBox();
    assert(overlayBox && overlayBox.width > 40 && overlayBox.height > 40, "Local mask overlay is not drawable.");
    let editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.30, overlayBox.y + overlayBox.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.60, overlayBox.y + overlayBox.height * 0.52, { steps: 8 });
    await page.mouse.up();
    assert((await editResponse).ok(), "Brush paint stroke edit command failed.");

    await eraser.click();
    assert(await eraser.getAttribute("aria-pressed") === "true", "Erase did not activate for the brush mask.");
    editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.35, overlayBox.y + overlayBox.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.55, overlayBox.y + overlayBox.height * 0.55, { steps: 5 });
    await page.mouse.up();
    assert((await editResponse).ok(), "Brush/Erase stroke edit command failed.");

    await page.locator("#local-adjustment-list button[data-local-id]").nth(1).click();
    assert(await eraser.isDisabled(), "Erase should be disabled for a non-brush mask.");
    assert(await eraser.getAttribute("aria-pressed") === "false", "Erase remained active after selecting a non-brush mask.");
    editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.25, overlayBox.y + overlayBox.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.75, overlayBox.y + overlayBox.height * 0.65, { steps: 4 });
    await page.mouse.up();
    assert((await editResponse).ok(), "Gradient gesture edit command failed.");

    await page.locator("#local-adjustment-list button[data-local-id]").nth(2).click();
    const previewBox = await page.locator("#preview-canvas").boundingBox();
    assert(previewBox && previewBox.width > 40 && previewBox.height > 40, "The active preview surface is unavailable for Luma editing.");
    editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(previewBox.x + previewBox.width * .373, previewBox.y + previewBox.height * .14);
    await page.mouse.down();
    await page.mouse.move(previewBox.x + previewBox.width * .41, previewBox.y + previewBox.height * .14, { steps: 3 });
    await page.mouse.up();
    assert((await editResponse).ok(), "Luminance-range handle gesture edit command failed.");
    assert(Number(await page.locator("#local-mask-tree-summary input").nth(1).inputValue()) > -8, "Luminance-range handle did not update its EV value.");

    await page.locator("#local-adjustment-list button[data-local-id]").nth(3).click();
    editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.32, overlayBox.y + overlayBox.height * 0.32);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.38, overlayBox.y + overlayBox.height * 0.38, { steps: 3 });
    await page.mouse.up();
    const pathResponse = await editResponse;
    if (!pathResponse.ok()) {
      throw new Error(`Path-node gesture edit command failed (${pathResponse.status()}): ${await pathResponse.text()}`);
    }
    await page.locator("#local-adjustment-list button[data-local-id]").nth(1).click();

    const histogram = page.locator("#histogram");
    let scopeResponse = page.evaluate(() => new Promise((resolve) => {
      const handler = (event) => {
        if (event.detail?.mode !== "waveform") return;
        window.removeEventListener("hdrfinisher:scope-presented", handler);
        resolve(event.detail);
      };
      window.addEventListener("hdrfinisher:scope-presented", handler);
    }));
    await page.locator('[data-dock-tab="waveform"]').click();
    await scopeResponse;
    await page.waitForFunction(() => document.querySelector("#scope-title")?.textContent?.toLowerCase().includes("waveform"));
    assert(await canvasVariationCount(histogram) > 100, "Waveform canvas remained visually blank after local edits.");
    await page.locator("#analysis-dock").screenshot({ path: path.resolve(__dirname, "../../docs/testing/local-adjustments-waveform-qa.png") });

    scopeResponse = page.evaluate(() => new Promise((resolve) => {
      const handler = (event) => {
        if (event.detail?.mode !== "histogram") return;
        window.removeEventListener("hdrfinisher:scope-presented", handler);
        resolve(event.detail);
      };
      window.addEventListener("hdrfinisher:scope-presented", handler);
    }));
    await page.locator('[data-dock-tab="histogram"]').click();
    await scopeResponse;
    await page.waitForFunction(() => document.querySelector("#scope-title")?.textContent?.toLowerCase().includes("histogram"));
    assert(await canvasVariationCount(histogram) > 100, "Histogram canvas remained visually blank after local edits.");
    await page.locator("#analysis-dock").screenshot({ path: path.resolve(__dirname, "../../docs/testing/local-adjustments-histogram-qa.png") });

    scopeResponse = page.evaluate(() => new Promise((resolve) => {
      const handler = (event) => {
        if (event.detail?.mode !== "vectorscope") return;
        window.removeEventListener("hdrfinisher:scope-presented", handler);
        resolve(event.detail);
      };
      window.addEventListener("hdrfinisher:scope-presented", handler);
    }));
    await page.locator('[data-dock-tab="vectorscope"]').click();
    await scopeResponse;
    await page.waitForFunction(() => document.querySelector("#scope-title")?.textContent?.toLowerCase().includes("vectorscope"));
    assert(await canvasVariationCount(histogram) > 100, "Vectorscope canvas remained visually blank after local edits.");

    const localRailShot = path.resolve(__dirname, "../../docs/testing/local-adjustments-local-qa.png");
    await page.locator(".grade-rail").screenshot({ path: localRailShot });

    await localToggle.click();
    assert(await localToggle.getAttribute("aria-expanded") === "false", "Local Adjustments did not collapse back to global grading.");
    const tabs = page.locator(".lane-folder-shell > .lane-switch [role='tab']");
    assert(await tabs.count() === 2, "HDR and SDR folder tabs were not rendered.");
    assert(await tabs.first().getAttribute("aria-selected") === "true", "HDR folder tab was not selected.");
    await tabs.nth(1).click();
    assert(await tabs.nth(1).getAttribute("aria-selected") === "true", "SDR folder tab did not select.");

    const cropOrder = await page.locator('[data-group="geometry"] .control-group-header').evaluate((header) =>
      [...header.children].map((child) => ({ id: child.id, order: getComputedStyle(child).order })),
    );
    assert(cropOrder.find((item) => item.id === "crop-open")?.order === "2", `Crop Edit action has the wrong order: ${JSON.stringify(cropOrder)}`);
    await page.locator("#crop-open").click();
    assert(await page.locator(".crop-editor-panel").isVisible(), "Crop modal did not open over the viewer.");
    assert(await page.locator("#crop-ratio option").count() >= 12, "Crop aspect-ratio presets are missing.");
    const geometryBeforeCropDraft = await page.evaluate(() => JSON.stringify(state.adjustments.shared.geometry));
    const previewRectBeforeCropDraft = await page.evaluate(() => {
      const rect = activePreviewElement().getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    await page.locator("#crop-ratio").selectOption("16:9");
    await page.waitForTimeout(100);
    const cropDraftState = await page.evaluate(() => ({
      committed: JSON.stringify(state.adjustments.shared.geometry),
      draft: JSON.parse(JSON.stringify(state.cropDraftGeometry)),
      preview: (() => { const rect = activePreviewElement().getBoundingClientRect(); return { width: rect.width, height: rect.height }; })(),
    }));
    assert(cropDraftState.committed === geometryBeforeCropDraft, "Selecting a crop ratio changed committed preview geometry before Apply.");
    assert(cropDraftState.draft.ratio_mode === "16:9", "Crop ratio was not stored in the modal draft.");
    assert(Math.abs(cropDraftState.preview.width - previewRectBeforeCropDraft.width) < 0.5 && Math.abs(cropDraftState.preview.height - previewRectBeforeCropDraft.height) < 0.5, "Selecting a crop ratio resized the preview image before Apply.");
    await page.locator("#crop-guide").selectOption("x");
    await page.waitForTimeout(50);
    assert(await canvasVariationCount(page.locator("#crop-guide-canvas")) > 2, "X-pattern crop guide did not render.");
    await page.locator("#crop-guide").selectOption("golden");
    await page.waitForTimeout(50);
    assert(await canvasVariationCount(page.locator("#crop-guide-canvas")) > 2, "Golden-ratio crop guide did not render.");
    await page.locator("#crop-cancel").click();
    assert(await page.locator(".crop-editor-panel").isHidden(), "Crop modal did not close on Cancel.");
    assert(await page.evaluate(() => JSON.stringify(state.adjustments.shared.geometry)) === geometryBeforeCropDraft, "Cancel did not discard the crop draft.");

    await page.locator("#crop-open").click();
    await page.locator("#crop-ratio").selectOption("4:3");
    await page.locator("#crop-done").click();
    assert(await page.evaluate(() => state.adjustments.shared.geometry.ratio_mode) === "4:3", "Apply crop did not commit the selected aspect ratio.");
    await page.waitForFunction(() => {
      const preview = activePreviewElement();
      const bitmapWidth = preview instanceof HTMLCanvasElement ? preview.width : preview.naturalWidth;
      const bitmapHeight = preview instanceof HTMLCanvasElement ? preview.height : preview.naturalHeight;
      return bitmapHeight > 0 && Math.abs(bitmapWidth / bitmapHeight - 4 / 3) < 0.01;
    }, null, { timeout: 30000 });
    const appliedCropRatios = await page.evaluate(() => {
      const preview = activePreviewElement();
      const rect = preview.getBoundingClientRect();
      const bitmapWidth = preview instanceof HTMLCanvasElement ? preview.width : preview.naturalWidth;
      const bitmapHeight = preview instanceof HTMLCanvasElement ? preview.height : preview.naturalHeight;
      return { bitmap: bitmapWidth / bitmapHeight, displayed: rect.width / rect.height };
    });
    assert(Math.abs(appliedCropRatios.displayed - appliedCropRatios.bitmap) < 0.01, `Applied crop was stretched in the viewer: ${JSON.stringify(appliedCropRatios)}`);

    const vignetteGroup = page.locator(".vignette-group");
    if (await vignetteGroup.evaluate((element) => element.classList.contains("collapsed"))) {
      await vignetteGroup.locator(".group-toggle").click();
    }
    await page.locator("#vignette-center-handle").waitFor({ state: "visible" });
    const vignettePlacement = await page.evaluate(() => {
      const frame = activePreviewElement().getBoundingClientRect();
      const handle = els.vignetteCenterHandle.getBoundingClientRect();
      return {
        frameCenterX: frame.left + frame.width / 2,
        frameCenterY: frame.top + frame.height / 2,
        handleCenterX: handle.left + handle.width / 2,
        handleCenterY: handle.top + handle.height / 2,
      };
    });
    assert(Math.abs(vignettePlacement.frameCenterX - vignettePlacement.handleCenterX) < 2 && Math.abs(vignettePlacement.frameCenterY - vignettePlacement.handleCenterY) < 2, `Vignette center was not placed in cropped output space: ${JSON.stringify(vignettePlacement)}`);

    const globalRailShot = path.resolve(__dirname, "../../docs/testing/local-adjustments-global-qa.png");
    await page.locator(".grade-rail").screenshot({ path: globalRailShot });

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    if (requestFailures.length) throw new Error(`Request failures: ${requestFailures.join(" | ")}`);
    console.log(JSON.stringify({ locals: expectedTools.length, localRailShot, globalRailShot }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
