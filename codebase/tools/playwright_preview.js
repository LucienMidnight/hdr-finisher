const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function edgeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EDGE_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function main() {
  const url = argValue("--url", "http://127.0.0.1:8000");
  const screenshot = argValue("--screenshot", path.join("output", "playwright", "hdr-finisher-ui.png"));
  const resultPath = argValue("--result", path.join("output", "playwright", "preview-result.json"));
  const inputPath = argValue("--input");
  const sourceReportPath = argValue("--source-report");
  const sourceScreenshot = argValue("--source-screenshot", path.join("output", "design-qa", "source-wireframe.png"));
  const comparisonScreenshot = argValue("--comparison-screenshot", path.join("output", "design-qa", "comparison.png"));
  const exportScreenshot = argValue("--export-screenshot", path.join("output", "design-qa", "export-sheet.png"));
  const viewportWidth = Number(argValue("--viewport-width", "1440"));
  const viewportHeight = Number(argValue("--viewport-height", "1000"));
  const headed = hasFlag("--headed");
  const executablePath = edgeExecutable();
  const consoleErrors = [];
  const pageErrors = [];
  let wheelZoomCheck = null;
  let nativeDragCheck = null;
  let gpuPreviewCheck = null;
  let toneEqualizerInteractionCheck = null;

  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  if (sourceReportPath) {
    fs.mkdirSync(path.dirname(sourceScreenshot), { recursive: true });
    fs.mkdirSync(path.dirname(comparisonScreenshot), { recursive: true });
  }
  if (inputPath) fs.mkdirSync(path.dirname(exportScreenshot), { recursive: true });

  const browser = await chromium.launch({
    headless: !headed,
    executablePath: executablePath || undefined,
  });

  try {
    const page = await browser.newPage({
      viewport: { width: viewportWidth, height: viewportHeight },
      deviceScaleFactor: 1,
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.locator(".app-shell").waitFor({ timeout: 10000 });

    const expectedSteps = {
      "hdr.exposure": 0.05,
      "hdr.highlight_rolloff": 0.01,
      "hdr.shadow_lift": 0.005,
      "hdr.tone_equalizer_smoothing": 0.01,
      "hdr.lift": 0.005,
      "hdr.gamma": 0.005,
      "hdr.gain": 0.005,
      "hdr.contrast": 0.001,
      "hdr.contrast_pivot": 0.0005,
      "hdr.white_balance_kelvin": 50,
      "hdr.tint": 0.01,
      "sdr.exposure": 0.05,
      "sdr.highlight_recovery": 0.01,
      "sdr.tone_contrast": 0.01,
      "sdr.tone_skew": 0.01,
      "sdr.shadow": 0.01,
      "sdr.lift": 0.002,
      "sdr.gamma": 0.005,
      "sdr.gain": 0.005,
      "sdr.contrast": 0.001,
      "sdr.contrast_pivot": 0.005,
      "shared.overlay_opacity": 0.01,
      "shared.overlay_threshold": 0.05,
    };
    const controlChecks = await page.locator('input[type="range"][data-path]').evaluateAll((controls, expected) => {
      return controls.map((control) => {
        const path = control.dataset.path;
        const actualStep = Number(control.step);
        const min = Number(control.min);
        const value = Number(control.value);
        const step = Number(control.step);
        const aligned = Math.abs(((value - min) / step) - Math.round((value - min) / step)) < 1e-6;
        return {
          path,
          expectedStep: expected[path],
          actualStep,
          aligned,
          ok: expected[path] === actualStep && aligned,
        };
      });
    }, expectedSteps);
    const failedControls = controlChecks.filter((control) => !control.ok);
    if (failedControls.length) {
      throw new Error(`Range control audit failed: ${JSON.stringify(failedControls)}`);
    }

    const resetChecks = await page.locator('input[type="range"]:not([data-no-double-reset])').evaluateAll((controls) => {
      return controls.map((control) => {
        const defaultValue = control.defaultValue;
        control.value = control.value === control.max ? control.min : control.max;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        return {
          path: control.dataset.path || control.id,
          defaultValue,
          resetValue: control.value,
          ok: control.value === defaultValue,
        };
      });
    });
    const failedResets = resetChecks.filter((control) => !control.ok);
    if (failedResets.length) {
      throw new Error(`Range reset audit failed: ${JSON.stringify(failedResets)}`);
    }

    if (inputPath) {
      await page.locator("#file-input").setInputFiles(inputPath);
      await page.locator("#session-name").waitFor({ state: "visible", timeout: 30000 });
      await page.waitForFunction(() => {
        const sessionName = document.getElementById("session-name");
        return sessionName && sessionName.textContent && sessionName.textContent !== "No active image";
      }, { timeout: 30000 });
      const gate = page.locator("#interpretation-gate");
      if (await gate.isVisible()) {
        await page.locator("#accept-interpretation").click();
      }
      await page.locator("#preview-image").waitFor({ state: "visible", timeout: 120000 });
      gpuPreviewCheck = await page.evaluate(() => {
        const entries = [...document.querySelectorAll("#display-info-list dt")];
        const gpuLabel = entries.find((entry) => entry.textContent === "GPU Preview");
        return {
          navigatorGpu: Boolean(navigator.gpu),
          status: gpuLabel?.nextElementSibling?.textContent || "not reported",
        };
      });
      await page.locator("#tone-equalizer-band-value").evaluate((control) => {
        control.value = "0.5";
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(120);
      const adjustedToneEqualizer = await page.evaluate(() => ({
        enabled: document.getElementById("tone-equalizer-enabled")?.checked,
        output: document.getElementById("tone-equalizer-band-output")?.textContent,
        groupState: document.querySelector('[data-modified-count="hdr-equalizer"]')?.textContent,
        gpuCanvasVisible: getComputedStyle(document.getElementById("preview-canvas")).display !== "none",
      }));
      await page.locator('[data-reset-group="hdr-equalizer"]').click();
      await page.waitForTimeout(120);
      const resetToneEqualizer = await page.evaluate(() => ({
        enabled: document.getElementById("tone-equalizer-enabled")?.checked,
        output: document.getElementById("tone-equalizer-band-output")?.textContent,
        groupState: document.querySelector('[data-modified-count="hdr-equalizer"]')?.textContent,
      }));
      toneEqualizerInteractionCheck = {
        adjusted: adjustedToneEqualizer,
        reset: resetToneEqualizer,
        ok: adjustedToneEqualizer.enabled === true
          && adjustedToneEqualizer.output === "+0.50 EV"
          && /modified/.test(adjustedToneEqualizer.groupState || "")
          && adjustedToneEqualizer.gpuCanvasVisible === true
          && resetToneEqualizer.enabled === false
          && resetToneEqualizer.output === "+0.00 EV"
          && resetToneEqualizer.groupState === "Default",
      };
      if (!toneEqualizerInteractionCheck.ok) {
        throw new Error(`Tone equalizer interaction audit failed: ${JSON.stringify(toneEqualizerInteractionCheck)}`);
      }
      nativeDragCheck = await page.locator("#preview-image").evaluate((image) => {
        const event = new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: new DataTransfer(),
        });
        const dispatchResult = image.dispatchEvent(event);
        return {
          draggable: image.draggable,
          defaultPrevented: event.defaultPrevented,
          dispatchResult,
          ok: image.draggable === false && event.defaultPrevented && dispatchResult === false,
        };
      });
      if (!nativeDragCheck.ok) throw new Error(`Preview drag audit failed: ${JSON.stringify(nativeDragCheck)}`);
      await page.locator("#view-sdr").click();
      await page.waitForFunction(() => document.body.dataset.activeLane === "sdr");
      await page.locator("#view-hdr").click();
      await page.waitForFunction(() => document.body.dataset.activeLane === "hdr");
      await page.locator('[data-dock-tab="technical"]').click();
      await page.locator('[data-dock-tab="waveform"]').click();
      await page.waitForFunction(() => document.getElementById("scope-title")?.textContent?.includes("Waveform"), { timeout: 120000 });
      await page.locator("#overlay-toggle").click();
      await page.locator("#overlay-close").click();
      await page.locator("#zoom-actual").click();
      await page.locator("#zoom-fit").click();
      const zoomBefore = await page.locator("#preview-image").evaluate((image) => {
        const rect = image.getBoundingClientRect();
        return {
          width: rect.width,
          anchorX: rect.left + rect.width * 0.72,
          anchorY: rect.top + rect.height * 0.38,
        };
      });
      await page.mouse.move(zoomBefore.anchorX, zoomBefore.anchorY);
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(100);
      const zoomAfter = await page.locator("#preview-image").evaluate((image, before) => {
        const rect = image.getBoundingClientRect();
        const frame = document.getElementById("dropzone").getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          frameWidth: frame.width,
          frameHeight: frame.height,
          normalizedX: (before.anchorX - rect.left) / rect.width,
          normalizedY: (before.anchorY - rect.top) / rect.height,
          readout: document.getElementById("zoom-readout")?.value,
        };
      }, zoomBefore);
      wheelZoomCheck = {
        beforeWidth: zoomBefore.width,
        afterWidth: zoomAfter.width,
        anchorDriftX: Math.abs(zoomAfter.normalizedX - 0.72),
        anchorDriftY: Math.abs(zoomAfter.normalizedY - 0.38),
        readout: zoomAfter.readout,
      };
      const horizontalAnchorOk = zoomAfter.width <= zoomAfter.frameWidth || wheelZoomCheck.anchorDriftX < 0.02;
      const verticalAnchorOk = zoomAfter.height <= zoomAfter.frameHeight || wheelZoomCheck.anchorDriftY < 0.02;
      wheelZoomCheck.ok = wheelZoomCheck.afterWidth > wheelZoomCheck.beforeWidth
        && horizontalAnchorOk
        && verticalAnchorOk
        && !/^Fit/.test(wheelZoomCheck.readout || "");
      if (!wheelZoomCheck.ok) throw new Error(`Wheel zoom audit failed: ${JSON.stringify(wheelZoomCheck)}`);
      await page.locator("#zoom-fit").click();
      if (await page.locator("#source-rail-expand").isVisible()) {
        await page.locator("#source-rail-expand").click();
        await page.waitForFunction(() => document.querySelector(".source-rail")?.classList.contains("pinned-open"));
        await page.locator("#source-rail-expand").click();
        await page.waitForFunction(() => !document.querySelector(".source-rail")?.classList.contains("pinned-open"));
      }
      await page.locator("#export-button").click();
      await page.locator("#export-sheet").waitFor({ state: "visible" });
      await page.screenshot({ path: exportScreenshot, fullPage: true });
      await page.locator("#export-close").click();
      await page.waitForTimeout(500);
    } else {
      await page.locator('[data-path="hdr.contrast"]').evaluate((control) => {
        control.value = String(Number(control.value) + Number(control.step));
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: screenshot, fullPage: true });

    let sourceEvidence = null;
    if (sourceReportPath) {
      const sourcePage = await browser.newPage({
        viewport: { width: viewportWidth, height: viewportHeight },
        deviceScaleFactor: 1,
      });
      const reportHtml = fs.readFileSync(sourceReportPath, "utf8");
      const componentMatch = reportHtml.match(/<x-dc>([\s\S]*?)<\/x-dc>/i);
      const componentHtml = (componentMatch ? componentMatch[1] : reportHtml)
        .replaceAll("{{ accent }}", "#6E9FB5")
        .replace(/<sc-if[^>]*>/gi, "<div>")
        .replace(/<\/sc-if>/gi, "</div>")
        .replace(/<\/?helmet>/gi, "");
      await sourcePage.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${componentHtml}</body></html>`, {
        waitUntil: "load",
        timeout: 30000,
      });
      const sourceFrame = sourcePage.locator('[style*="height:520px"]').first();
      await sourceFrame.waitFor({ state: "visible", timeout: 10000 });
      await sourceFrame.screenshot({ path: sourceScreenshot });
      const sourceBox = await sourceFrame.boundingBox();
      const implementationSize = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      }));
      const sourceImageUrl = `data:image/png;base64,${fs.readFileSync(sourceScreenshot).toString("base64")}`;
      const implementationImageUrl = `data:image/png;base64,${fs.readFileSync(screenshot).toString("base64")}`;
      const comparisonPage = await browser.newPage({
        viewport: { width: 1800, height: 1050 },
        deviceScaleFactor: 1,
      });
      await comparisonPage.setContent(`
        <!doctype html>
        <html>
          <head>
            <style>
              * { box-sizing: border-box; }
              body { margin: 0; padding: 24px; background: #0b0c0d; color: #dde1e3; font: 14px system-ui, sans-serif; }
              main { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
              figure { margin: 0; min-width: 0; }
              figcaption { margin-bottom: 8px; color: #a9b1b6; letter-spacing: .08em; text-transform: uppercase; }
              img { display: block; width: 100%; height: auto; border: 1px solid #2a2e32; }
            </style>
          </head>
          <body>
            <main>
              <figure><figcaption>Source wireframe</figcaption><img src="${sourceImageUrl}"></figure>
              <figure><figcaption>Edge implementation · ${viewportWidth}×${viewportHeight}</figcaption><img src="${implementationImageUrl}"></figure>
            </main>
          </body>
        </html>
      `, { waitUntil: "load" });
      await comparisonPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await comparisonPage.screenshot({ path: comparisonScreenshot, fullPage: true });
      sourceEvidence = {
        report: sourceReportPath,
        screenshot: sourceScreenshot,
        sourceBox,
        implementationSize,
        comparisonScreenshot,
      };
      await comparisonPage.close();
      await sourcePage.close();
    }

    const result = {
      ok: true,
      url: page.url(),
      title: await page.title(),
      browser: executablePath ? "installed Edge executable" : "Playwright cached Chromium",
      executablePath,
      screenshot,
      inputPath,
      exportScreenshot: inputPath ? exportScreenshot : null,
      viewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1 },
      sourceEvidence,
      controlChecks,
      resetChecks,
      wheelZoomCheck,
      nativeDragCheck,
      gpuPreviewCheck,
      toneEqualizerInteractionCheck,
      consoleErrors,
      pageErrors,
    };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
