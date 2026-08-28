const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const source = {
  button: "C:/Users/Steve/AppData/Local/Temp/codex-clipboard-eaf60e8c-f3c9-4591-81e4-c39aca81abcf.png",
  crop: "C:/Users/Steve/AppData/Local/Temp/codex-clipboard-f7ad5b28-cfdf-4b6b-a0ba-d3224c965d63.png",
  switches: "C:/Users/Steve/AppData/Local/Temp/codex-clipboard-1e24bf55-c0e7-40c3-8b5f-cff5731e48b4.png",
};
const outputDir = path.resolve(__dirname, "../output/ui-refinement-detail-qa");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1408, height: 882 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const logoPath = path.join(outputDir, "logo-implementation.png");
    await page.locator(".product-mark").screenshot({ path: logoPath });
    const logoSurface = await page.locator(".product-mark").evaluate((logo) => {
      const style = getComputedStyle(logo);
      return { borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle, borderColor: style.borderTopColor };
    });
    assert(logoSurface.borderWidth === "1px" && logoSurface.borderStyle === "solid" && logoSurface.borderColor === "rgb(255, 255, 255)", `Product mark border is incorrect: ${JSON.stringify(logoSurface)}`);
    const buttonPath = path.join(outputDir, "button-implementation.png");
    await page.locator("#import-button").screenshot({ path: buttonPath });
    const buttonSurface = await page.locator("#import-button").evaluate((button) => {
      const style = getComputedStyle(button);
      return { background: style.backgroundImage, borderWidth: style.borderTopWidth, appearance: style.appearance, shadow: style.boxShadow };
    });
    assert(buttonSurface.background.includes("linear-gradient") && buttonSurface.borderWidth === "0px" && buttonSurface.appearance === "none" && !buttonSurface.shadow.includes("inset"), `Primary button material is incorrect: ${JSON.stringify(buttonSurface)}`);

    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);
    const rawGroup = page.locator(".raw-development-group");
    await rawGroup.evaluate((group) => {
      group.hidden = false;
      group.classList.remove("hidden");
      group.querySelector(".disclosure-content").classList.remove("hidden");
      group.querySelector(".disclosure-trigger").setAttribute("aria-expanded", "true");
    });
    const switchPath = path.join(outputDir, "switches-implementation.png");
    await rawGroup.locator(".checkbox-stack").screenshot({ path: switchPath });
    const switchSurface = await page.locator("#lens-distortion").evaluate((control) => {
      const style = getComputedStyle(control);
      const knob = getComputedStyle(control, "::before");
      return {
        width: style.width,
        height: style.height,
        image: style.backgroundImage,
        size: style.backgroundSize,
        radius: style.borderRadius,
        shadow: style.boxShadow,
        knob: { width: knob.width, height: knob.height, image: knob.backgroundImage, transform: knob.transform, zIndex: knob.zIndex, shadow: knob.boxShadow },
      };
    });
    assert(switchSurface.width === "46px" && switchSurface.height === "24px" && switchSurface.radius === "999px" && !switchSurface.image.includes("radial-gradient") && switchSurface.image.includes("rgba(255, 255, 255, 0.16)") && switchSurface.shadow.includes("2.5px 3px") && switchSurface.knob.width === "24px" && switchSurface.knob.height === "24px" && switchSurface.knob.image.includes("radial-gradient") && switchSurface.knob.transform.includes("22"), `Shared switch material is incorrect: ${JSON.stringify(switchSurface)}`);

    const colorGroup = page.locator('[data-group="hdr-color"]');
    if (await colorGroup.locator(".group-toggle").getAttribute("aria-expanded") === "false") await colorGroup.locator(".group-toggle").click();
    const colorPath = path.join(outputDir, "color-rails-implementation.png");
    await colorGroup.screenshot({ path: colorPath });
    const directions = await page.evaluate(() => {
      const spectrum = (selector) => getComputedStyle(document.querySelector(selector).closest(".control-row")).getPropertyValue("--color-rail-spectrum");
      return { temperature: spectrum("#hdr-wb"), tint: spectrum("#hdr-tint") };
    });
    assert(directions.temperature.indexOf("#526fbd") < directions.temperature.indexOf("#cf7133"), `Temperature direction is reversed: ${JSON.stringify(directions)}`);
    assert(directions.tint.indexOf("#c56398") < directions.tint.indexOf("#3f8f62"), `Tint direction is reversed: ${JSON.stringify(directions)}`);

    const geometryGroup = page.locator('[data-group="geometry"]');
    if (await geometryGroup.locator(".group-toggle").getAttribute("aria-expanded") === "false") await geometryGroup.locator(".group-toggle").click();
    const beforeRotate = await page.evaluate(() => {
      const rect = activePreviewElement().getBoundingClientRect();
      return { width: rect.width, height: rect.height, zoom: state.zoomPercent };
    });
    await page.locator("#rotate-tool-toggle").click();
    const afterRotate = await page.evaluate(() => {
      const preview = activePreviewElement();
      const rect = preview.getBoundingClientRect();
      return { width: rect.width, height: rect.height, zoom: state.zoomPercent, transform: preview.style.getPropertyValue("--interactive-rotate-angle") };
    });
    assert(afterRotate.transform === "" && Math.abs(afterRotate.width - beforeRotate.width) < 0.5 && Math.abs(afterRotate.height - beforeRotate.height) < 0.5 && Math.abs(afterRotate.zoom - beforeRotate.zoom) < 0.01, `Opening Rotate changed fit zoom: ${JSON.stringify({ beforeRotate, afterRotate })}`);
    const cropPath = path.join(outputDir, "crop-open-implementation.png");
    await page.screenshot({ path: cropPath, fullPage: false });

    const comparison = await browser.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 1 });
    const pairs = [
      ["Button issue capture", source.button, "Button implementation", buttonPath],
      ["Switch issue capture", source.switches, "Switch implementation", switchPath],
      ["Crop zoom issue capture", source.crop, "Crop implementation", cropPath],
    ];
    await comparison.setContent(`
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; color: #dce5e7; background: #0a0f11; font: 14px system-ui; }
        main { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
        figure { margin: 0; padding: 12px; border: 1px solid #344044; background: #111719; }
        figcaption { margin-bottom: 10px; color: #b49cff; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
        img { display: block; max-width: 100%; height: auto; }
      </style>
      <main>${pairs.map(([leftLabel, leftPath, rightLabel, rightPath]) => `
        <figure><figcaption>${leftLabel}</figcaption><img src="data:image/png;base64,${fs.readFileSync(leftPath).toString("base64")}"></figure>
        <figure><figcaption>${rightLabel}</figcaption><img src="data:image/png;base64,${fs.readFileSync(rightPath).toString("base64")}"></figure>
      `).join("")}</main>
    `, { waitUntil: "load" });
    const comparisonPath = path.join(outputDir, "comparison.png");
    await comparison.screenshot({ path: comparisonPath, fullPage: true });
    await comparison.close();
    assert(errors.length === 0, `Page errors: ${errors.join(" | ")}`);
    process.stdout.write(JSON.stringify({ logoPath, buttonPath, switchPath, colorPath, cropPath, comparisonPath }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
