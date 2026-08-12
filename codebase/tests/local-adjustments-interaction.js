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
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const requestFailures = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "unknown failure";
    if (failure === "net::ERR_ABORTED" && /\/(preview|scopes)(\/|\?)/.test(request.url())) return;
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
      const visiblePixels = await overlayPixelCount(page);
      assert(visiblePixels > 100, `${tool} did not render a visible preview gizmo.`);
      await page.locator("#preview-primary-pane").screenshot({
        path: path.resolve(__dirname, `../../docs/testing/local-adjustments-${tool.replaceAll("_", "-")}-overlay-qa.png`),
      });
    }
    await page.screenshot({ path: path.resolve(__dirname, "../../docs/testing/local-adjustments-overlay-qa.png"), fullPage: false });

    const brushRow = page.locator("#local-adjustment-list button").first();
    await brushRow.click();
    const eraser = page.locator("#local-eraser");
    assert(!(await eraser.isDisabled()), "Erase should be available for a selected brush mask.");
    await eraser.click();
    assert(await eraser.getAttribute("aria-pressed") === "true", "Erase did not activate for the brush mask.");

    const overlay = page.locator("#local-mask-overlay");
    const overlayBox = await overlay.boundingBox();
    assert(overlayBox && overlayBox.width > 40 && overlayBox.height > 40, "Local mask overlay is not drawable.");
    let editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.35, overlayBox.y + overlayBox.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.55, overlayBox.y + overlayBox.height * 0.55, { steps: 5 });
    await page.mouse.up();
    assert((await editResponse).ok(), "Brush/Erase stroke edit command failed.");

    await page.locator("#local-adjustment-list button").nth(1).click();
    assert(await eraser.isDisabled(), "Erase should be disabled for a non-brush mask.");
    assert(await eraser.getAttribute("aria-pressed") === "false", "Erase remained active after selecting a non-brush mask.");
    editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.25, overlayBox.y + overlayBox.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.75, overlayBox.y + overlayBox.height * 0.65, { steps: 4 });
    await page.mouse.up();
    assert((await editResponse).ok(), "Gradient gesture edit command failed.");

    await page.locator("#local-adjustment-list button").nth(2).click();
    const previewBox = await page.locator("#preview-canvas").boundingBox();
    assert(previewBox && previewBox.width > 40 && previewBox.height > 40, "The active preview surface is unavailable for Luma editing.");
    editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(previewBox.x + previewBox.width * .373, previewBox.y + previewBox.height * .14);
    await page.mouse.down();
    await page.mouse.move(previewBox.x + previewBox.width * .41, previewBox.y + previewBox.height * .14, { steps: 3 });
    await page.mouse.up();
    assert((await editResponse).ok(), "Luminance-range handle gesture edit command failed.");
    assert(Number(await page.locator("#local-mask-tree-summary input").nth(1).inputValue()) > -8, "Luminance-range handle did not update its EV value.");

    await page.locator("#local-adjustment-list button").nth(3).click();
    editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.32, overlayBox.y + overlayBox.height * 0.32);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.38, overlayBox.y + overlayBox.height * 0.38, { steps: 3 });
    await page.mouse.up();
    const pathResponse = await editResponse;
    if (!pathResponse.ok()) {
      throw new Error(`Path-node gesture edit command failed (${pathResponse.status()}): ${await pathResponse.text()}`);
    }
    await page.locator("#local-adjustment-list button").nth(1).click();

    const histogram = page.locator("#histogram");
    let scopeResponse = page.waitForResponse((response) => response.url().includes("/scopes?") && response.url().includes("mode=waveform") && response.status() === 200);
    await page.locator('[data-dock-tab="waveform"]').click();
    await scopeResponse;
    await page.waitForFunction(() => document.querySelector("#scope-title")?.textContent?.toLowerCase().includes("waveform"));
    assert(await canvasVariationCount(histogram) > 100, "Waveform canvas remained visually blank after local edits.");
    await page.locator("#analysis-dock").screenshot({ path: path.resolve(__dirname, "../../docs/testing/local-adjustments-waveform-qa.png") });

    scopeResponse = page.waitForResponse((response) => response.url().includes("/scopes?") && response.url().includes("mode=histogram") && response.status() === 200);
    await page.locator('[data-dock-tab="histogram"]').click();
    await scopeResponse;
    await page.waitForFunction(() => document.querySelector("#scope-title")?.textContent?.toLowerCase().includes("histogram"));
    assert(await canvasVariationCount(histogram) > 100, "Histogram canvas remained visually blank after local edits.");
    await page.locator("#analysis-dock").screenshot({ path: path.resolve(__dirname, "../../docs/testing/local-adjustments-histogram-qa.png") });

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
