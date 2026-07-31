const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { PNG } = require("pngjs");

function edgeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EDGE_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function compareScreenshots(gpuBuffer, settledBuffer) {
  const gpu = PNG.sync.read(gpuBuffer);
  const settled = PNG.sync.read(settledBuffer);
  if (gpu.width !== settled.width || gpu.height !== settled.height) {
    throw new Error(`Preview geometry changed from ${gpu.width}x${gpu.height} to ${settled.width}x${settled.height}`);
  }
  const channelErrors = [];
  let sum = 0;
  let changedPixels = 0;
  for (let offset = 0; offset < gpu.data.length; offset += 4) {
    let pixelMax = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(gpu.data[offset + channel] - settled.data[offset + channel]);
      channelErrors.push(difference);
      sum += difference;
      pixelMax = Math.max(pixelMax, difference);
    }
    if (pixelMax > 8) changedPixels += 1;
  }
  channelErrors.sort((a, b) => a - b);
  const pixels = gpu.width * gpu.height;
  return {
    width: gpu.width,
    height: gpu.height,
    meanAbsoluteError: sum / channelErrors.length / 255,
    p95ChannelError: channelErrors[Math.floor(channelErrors.length * 0.95)] / 255,
    visiblyChangedFraction: changedPixels / pixels,
  };
}

async function captureCurrent(page, label, outputDir) {
  await page.waitForFunction(() => getComputedStyle(document.getElementById("preview-canvas")).display !== "none");
  const gpu = await page.locator("#preview-canvas").screenshot();
  await page.waitForFunction(() => getComputedStyle(document.getElementById("preview-image")).display !== "none", null, { timeout: 120000 });
  const settled = await page.locator("#preview-image").screenshot();
  const metrics = compareScreenshots(gpu, settled);
  if (metrics.meanAbsoluteError > 0.025 || metrics.p95ChannelError > 0.075) {
    fs.writeFileSync(path.join(outputDir, `${label}-gpu.png`), gpu);
    fs.writeFileSync(path.join(outputDir, `${label}-settled.png`), settled);
  }
  return metrics;
}

async function setControl(page, selector, value) {
  await page.locator(selector).evaluate((control, nextValue) => {
    control.value = String(nextValue);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function auditLane(page, lane, outputDir) {
  await page.locator(`#view-${lane}`).click();
  await page.waitForFunction((expected) => document.body.dataset.activeLane === expected, lane);
  const controls = await page.locator(`[data-path^="${lane}."]`).evaluateAll((nodes) => nodes.map((control) => ({
    path: control.dataset.path,
    type: control.tagName === "SELECT" ? "select" : control.type,
    min: Number(control.min),
    max: Number(control.max),
    value: Number(control.value),
    defaultValue: control.tagName === "SELECT" ? control.value : control.defaultValue,
    options: control.tagName === "SELECT" ? [...control.options].map((option) => option.value) : [],
  })));
  const results = [];
  let previous = null;

  for (const control of controls) {
    if (previous) await setControl(page, `[data-path="${previous.path}"]`, previous.defaultValue);
    if (control.type === "select") {
      for (const value of control.options.filter((option) => option !== control.defaultValue)) {
        await setControl(page, `[data-path="${control.path}"]`, value);
        results.push({ lane, control: control.path, value, ...(await captureCurrent(page, `${lane}-${control.path.replace(".", "-")}-${value}`, outputDir)) });
      }
      await setControl(page, `[data-path="${control.path}"]`, control.defaultValue);
    } else {
      const defaultNumber = Number(control.defaultValue);
      const values = [...new Set([
        defaultNumber + ((control.min - defaultNumber) * 0.65),
        defaultNumber + ((control.max - defaultNumber) * 0.65),
      ].map((value) => Math.max(control.min, Math.min(control.max, value)).toPrecision(8)))];
      for (const value of values) {
        await setControl(page, `[data-path="${control.path}"]`, value);
        results.push({ lane, control: control.path, value: Number(value), ...(await captureCurrent(page, `${lane}-${control.path.replace(".", "-")}-${value}`, outputDir)) });
      }
      await setControl(page, `[data-path="${control.path}"]`, control.defaultValue);
    }
    previous = null;
  }

  const curveGroup = page.locator('[data-group="curves"]');
  if (await curveGroup.evaluate((group) => group.classList.contains("collapsed"))) {
    await curveGroup.locator(".group-toggle").click();
  }
  const curveToggle = page.locator("#curves-enabled");
  if (!(await curveToggle.isChecked())) await curveToggle.check();
  const editor = page.locator("#curve-editor");
  const box = await editor.boundingBox();
  if (box) {
    await page.mouse.move(box.x + (box.width * 0.5), box.y + (box.height * 0.5));
    await page.mouse.down();
    await page.mouse.move(box.x + (box.width * 0.5), box.y + (box.height * 0.32), { steps: 4 });
    await page.mouse.up();
    results.push({ lane, control: `${lane}.luma_curve`, value: "midtone-up", ...(await captureCurrent(page, `${lane}-curve`, outputDir)) });
  }
  await curveToggle.uncheck();
  await page.waitForFunction(() => getComputedStyle(document.getElementById("preview-image")).display !== "none", null, { timeout: 120000 });
  return results;
}

async function auditHdrHandoff(browser, input) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (query !== "(dynamic-range: high)") return nativeMatchMedia(query);
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true; },
      };
    };
  });
  try {
    await page.goto("http://127.0.0.1:8000", { waitUntil: "networkidle" });
    await page.locator("#file-input").setInputFiles(input);
    await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", null, { timeout: 30000 });
    const gate = page.locator("#interpretation-gate");
    if (await gate.isVisible()) await page.locator("#accept-interpretation").click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById("preview-canvas")).display !== "none", null, { timeout: 120000 });
    const cases = [];
    for (const [control, value] of [["hdr.exposure", 2.6], ["hdr.shadow_lift", -0.16]]) {
      await setControl(page, `[data-path="${control}"]`, value);
      await page.waitForTimeout(1200);
      const visibility = await page.evaluate(() => ({
        canvas: getComputedStyle(document.getElementById("preview-canvas")).display,
        image: getComputedStyle(document.getElementById("preview-image")).display,
      }));
      cases.push({ control, value, ...visibility });
      if (visibility.canvas === "none" || visibility.image !== "none") {
        throw new Error(`HDR preview handed off after ${control}: ${JSON.stringify(visibility)}`);
      }
    }
    return cases;
  } finally {
    await page.close();
  }
}

async function main() {
  const input = process.argv[2];
  const outputDir = process.argv[3] || path.join("output", "gpu-parity");
  if (!input) throw new Error("Usage: node tools/playwright_gpu_parity.js INPUT [OUTPUT_DIR]");
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: edgeExecutable() });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const browserErrors = [];
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto("http://127.0.0.1:8000", { waitUntil: "networkidle" });
    await page.locator("#file-input").setInputFiles(input);
    await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", null, { timeout: 30000 });
    const gate = page.locator("#interpretation-gate");
    if (await gate.isVisible()) await page.locator("#accept-interpretation").click();
    await page.locator("#preview-image").waitFor({ state: "visible", timeout: 120000 });
    const hdr = await auditLane(page, "hdr", outputDir);
    const sdr = await auditLane(page, "sdr", outputDir);
    const results = [...hdr, ...sdr];
    const hdrHandoff = await auditHdrHandoff(browser, input);
    const report = {
      navigatorGpu: await page.evaluate(() => Boolean(navigator.gpu)),
      dynamicRangeHigh: await page.evaluate(() => matchMedia("(dynamic-range: high)").matches),
      browserErrors,
      cases: results,
      hdrHandoff,
      worstMeanAbsoluteError: Math.max(...results.map((result) => result.meanAbsoluteError)),
      worstP95ChannelError: Math.max(...results.map((result) => result.p95ChannelError)),
    };
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join("; ")}`);
    if (report.worstMeanAbsoluteError > 0.025 || report.worstP95ChannelError > 0.075) {
      throw new Error(`Visible GPU/settled mismatch: ${JSON.stringify({ mae: report.worstMeanAbsoluteError, p95: report.worstP95ChannelError })}`);
    }
    console.log(JSON.stringify({ cases: results.length, worstMeanAbsoluteError: report.worstMeanAbsoluteError, worstP95ChannelError: report.worstP95ChannelError }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
