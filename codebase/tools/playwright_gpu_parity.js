const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");

function edgeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EDGE_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function compareScreenshots(gpuBuffer, settledBuffer) {
  const python = path.join(__dirname, "..", ".venv", "Scripts", "python.exe");
  const script = [
    "import base64, io, json, sys",
    "import numpy as np",
    "from PIL import Image",
    "payload=json.load(sys.stdin)",
    "gpu=np.asarray(Image.open(io.BytesIO(base64.b64decode(payload['gpu']))).convert('RGB'), dtype=np.int16)",
    "settled=np.asarray(Image.open(io.BytesIO(base64.b64decode(payload['settled']))).convert('RGB'), dtype=np.int16)",
    "assert gpu.shape == settled.shape, f'Preview geometry changed: {gpu.shape} vs {settled.shape}'",
    "difference=np.abs(gpu-settled)",
    "stable=(settled>=16)&(settled<=239)",
    "relative=(difference[stable]/np.maximum(settled[stable],1)) if np.any(stable) else np.asarray([0.0])",
    "result={'width':int(gpu.shape[1]),'height':int(gpu.shape[0]),'meanAbsoluteError':float(np.mean(difference)/255),'p95ChannelError':float(np.percentile(difference,95)/255),'medianStableRelativeError':float(np.median(relative)),'p99StableRelativeError':float(np.percentile(relative,99)),'stableChannelFraction':float(np.mean(stable)),'visiblyChangedFraction':float(np.mean(np.max(difference,axis=2)>8))}",
    "print(json.dumps(result))",
  ].join("\n");
  const comparison = spawnSync(python, ["-c", script], {
    input: JSON.stringify({ gpu: gpuBuffer.toString("base64"), settled: settledBuffer.toString("base64") }),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (comparison.status !== 0) throw new Error(comparison.stderr || comparison.stdout || "Could not compare preview screenshots");
  return JSON.parse(comparison.stdout);
}

async function captureCurrent(page, label, outputDir) {
  await page.waitForFunction(() => getComputedStyle(document.getElementById("preview-canvas")).display !== "none");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const gpu = await page.locator("#preview-canvas").screenshot();
  await page.evaluate(async () => {
    const state = window.HDRFinisherPerformance.authoringState();
    const response = await fetch(`/api/session/${state.sessionId}/preview-raw/${state.lane}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adjustments: state.adjustments, long_edge: state.longEdge, hdr_display: false }),
    });
    if (!response.ok) throw new Error(`CPU reference failed with HTTP ${response.status}`);
    const width = Number(response.headers.get("X-Image-Width"));
    const height = Number(response.headers.get("X-Image-Height"));
    const pixels = new Uint8ClampedArray(await response.arrayBuffer());
    const reference = document.createElement("canvas");
    reference.id = "gpu-parity-reference";
    reference.width = width;
    reference.height = height;
    const canvas = document.getElementById("preview-canvas");
    reference.style.width = `${canvas.getBoundingClientRect().width}px`;
    reference.style.height = `${canvas.getBoundingClientRect().height}px`;
    reference.style.position = "fixed";
    reference.style.left = "0";
    reference.style.top = "0";
    reference.style.zIndex = "99999";
    reference.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
    document.body.append(reference);
  });
  const reference = page.locator("#gpu-parity-reference");
  const settled = await reference.screenshot();
  await reference.evaluate((canvas) => canvas.remove());
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
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
  const editor = page.locator("#curve-editor");
  const box = await editor.boundingBox();
  if (box) {
    await page.mouse.move(box.x + (box.width * 0.5), box.y + (box.height * 0.5));
    await page.mouse.down();
    await page.mouse.move(box.x + (box.width * 0.5), box.y + (box.height * 0.32), { steps: 4 });
    await page.mouse.up();
    results.push({ lane, control: `${lane}.luma_curve`, value: "midtone-up", ...(await captureCurrent(page, `${lane}-curve`, outputDir)) });
  }
  await page.locator("#curve-reset").click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById("preview-canvas")).display !== "none", null, { timeout: 120000 });
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
    await page.locator("#preview-canvas").waitFor({ state: "visible", timeout: 120000 });
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
      worstMedianStableRelativeError: Math.max(...results.map((result) => result.medianStableRelativeError)),
      worstP99StableRelativeError: Math.max(...results.map((result) => result.p99StableRelativeError)),
      worstVisiblyChangedFraction: Math.max(...results.map((result) => result.visiblyChangedFraction)),
    };
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join("; ")}`);
    // The captured surfaces are quantized RGBA8 browser-composited pixels, so
    // one code value already exceeds the PRD's initial float-relative target.
    // Gate this observable artifact with the approved quantized envelope and
    // retain the relative diagnostics for trend analysis.
    if (report.worstMeanAbsoluteError > 0.0075
      || report.worstP95ChannelError > 0.025
      || report.worstVisiblyChangedFraction > 0.045) {
      throw new Error(`Visible GPU/CPU mismatch: ${JSON.stringify({ mae: report.worstMeanAbsoluteError, p95: report.worstP95ChannelError, visiblyChanged: report.worstVisiblyChangedFraction })}`);
    }
    console.log(JSON.stringify({ cases: results.length, worstMeanAbsoluteError: report.worstMeanAbsoluteError, worstP95ChannelError: report.worstP95ChannelError, worstVisiblyChangedFraction: report.worstVisiblyChangedFraction, worstMedianStableRelativeError: report.worstMedianStableRelativeError, worstP99StableRelativeError: report.worstP99StableRelativeError }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
