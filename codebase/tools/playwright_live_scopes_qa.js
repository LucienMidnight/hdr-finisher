const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function edgeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EDGE_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function waitForSettledScope(page) {
  await page.waitForFunction(() => ["Settled", "Refined"].includes(document.getElementById("scope-freshness")?.textContent), null, {
    timeout: 15000,
  });
}

async function selectScopeZoom(page, maxNits) {
  const responsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.status() === 200
      && requestUrl.pathname.endsWith("/scopes")
      && requestUrl.searchParams.get("max_nits") === String(maxNits)
      && response.request().method() === "POST";
  }, { timeout: 15000 });
  await page.locator("#scope-zoom").selectOption(String(maxNits));
  const response = await responsePromise;
  const payload = await response.json();
  await waitForSettledScope(page);
  return {
    selectedValue: await page.locator("#scope-zoom").inputValue(),
    lastBinEdge: payload.bin_edges.at(-1),
    hasCeilingGuide: payload.guides.some((guide) => Number(guide.value) === maxNits),
  };
}

async function auditSustainedDrag(page, mode) {
  const observations = [];
  let holdingHandle = true;
  const responseTasks = [];
  const onResponse = (response) => {
    if (!holdingHandle || response.status() !== 200 || !/\/scopes\?/.test(response.url())) return;
    const request = response.request();
    if (request.method() !== "POST") return;
    const body = request.postDataJSON();
    if (body?.tier !== "interactive") return;
    responseTasks.push((async () => {
      await response.finished();
      const payload = await response.json();
      await page.waitForTimeout(35);
      if (!holdingHandle) return;
      observations.push({
        generation: body.generation,
        adjustments: body.adjustments.hdr.tone_equalizer_nodes.map((node) => Number(node.adjustment_ev)),
        payload: JSON.stringify(payload.channels.map((channel) => channel.bins.length ? channel.bins : channel.grid)),
        peakValue: payload.peak_value,
        canvas: await page.locator("#histogram").evaluate((element) => element.toDataURL()),
        freshness: await page.locator("#scope-freshness").textContent(),
      });
    })());
  };
  page.on("response", onResponse);

  const control = page.locator("#tone-equalizer-band-value");
  await control.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "mouse", buttons: 1 });
  for (const value of [0.15, 0.35, 0.55, 0.75, 0.45, 0.05, -0.3, -0.55]) {
    await control.evaluate((element, nextValue) => {
      element.value = String(nextValue);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    await page.waitForTimeout(125);
  }
  await page.waitForTimeout(250);
  holdingHandle = false;
  await control.dispatchEvent("pointerup", { pointerId: 1, pointerType: "mouse" });
  page.off("response", onResponse);
  await Promise.all(responseTasks);
  await waitForSettledScope(page);

  const adjustmentStates = new Set(observations.map((entry) => JSON.stringify(entry.adjustments)));
  const canvasStates = new Set(observations.map((entry) => entry.canvas));
  const payloadStates = new Set(observations.map((entry) => entry.payload));
  return {
    mode,
    responsesWhileHeld: observations.length,
    distinctAdjustmentStates: adjustmentStates.size,
    distinctCanvasStates: canvasStates.size,
    distinctPayloadStates: payloadStates.size,
    peakValues: observations.map((entry) => entry.peakValue),
    generations: observations.map((entry) => entry.generation),
    freshness: observations.map((entry) => entry.freshness),
    ok: observations.length >= 2 && adjustmentStates.size >= 2 && canvasStates.size >= 2,
  };
}

async function auditSustainedCurveDrag(page, mode, screenshotPath) {
  const observations = [];
  const startedAt = Date.now();
  let holdingHandle = true;
  const responseTasks = [];
  const onResponse = (response) => {
    if (!holdingHandle || response.status() !== 200 || !/\/scopes\?/.test(response.url())) return;
    const request = response.request();
    if (request.method() !== "POST") return;
    const body = request.postDataJSON();
    if (body?.tier !== "interactive") return;
    responseTasks.push((async () => {
      await response.finished();
      const payload = await response.json();
      await page.waitForTimeout(35);
      if (!holdingHandle) return;
      observations.push({
        elapsedMs: Date.now() - startedAt,
        generation: body.generation,
        curve: body.adjustments.hdr.luma_curve,
        payload: JSON.stringify(payload.channels.map((channel) => channel.bins.length ? channel.bins : channel.grid)),
        canvas: await page.locator("#histogram").evaluate((element) => element.toDataURL()),
        freshness: await page.locator("#scope-freshness").textContent(),
      });
    })());
  };
  page.on("response", onResponse);

  const curveGroup = page.locator('[data-group="curves"]');
  if (await curveGroup.evaluate((group) => group.classList.contains("collapsed"))) {
    await curveGroup.locator(".group-toggle").click();
  }
  const editor = page.locator("#curve-editor");
  await editor.scrollIntoViewIfNeeded();
  const box = await editor.boundingBox();
  if (!box) throw new Error("Curve editor has no visible bounds");
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Match a real continuous pointer stream instead of pausing long enough for
  // every backend request to settle between synthetic drag steps.
  for (let frame = 1; frame <= 90; frame += 1) {
    await page.mouse.move(x, y - 18 * (frame / 90));
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(250);
  holdingHandle = false;
  await page.mouse.up();
  page.off("response", onResponse);
  await Promise.all(responseTasks);
  await waitForSettledScope(page);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const curveStates = new Set(observations.map((entry) => JSON.stringify(entry.curve)));
  const canvasStates = new Set(observations.map((entry) => entry.canvas));
  const payloadStates = new Set(observations.map((entry) => entry.payload));
  return {
    mode,
    responsesWhileHeld: observations.length,
    distinctCurveStates: curveStates.size,
    distinctCanvasStates: canvasStates.size,
    distinctPayloadStates: payloadStates.size,
    generations: observations.map((entry) => entry.generation),
    visibleScopeMs: observations.map((entry) => entry.elapsedMs),
    freshness: observations.map((entry) => entry.freshness),
    screenshotPath,
    ok: observations.length >= 2 && curveStates.size >= 2 && canvasStates.size >= 2 && payloadStates.size >= 2,
  };
}

async function main() {
  const url = process.argv[2] || "http://127.0.0.1:8000";
  const input = path.resolve(process.argv[3] || path.join("tests", "fixtures", "hdr_headroom.tiff"));
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgeExecutable() || undefined,
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const errors = [];
  try {
    const outputDir = path.resolve("output", "live-scopes");
    fs.mkdirSync(outputDir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.locator("#file-input").setInputFiles(input);
    await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", null, { timeout: 30000 });
    if (await page.locator("#interpretation-gate").isVisible()) await page.locator("#accept-interpretation").click();
    await waitForSettledScope(page);
    const scopeZoom = await selectScopeZoom(page, 10000);

    const histogram = await auditSustainedDrag(page, "histogram");
    await page.locator('[data-reset-group="hdr-equalizer"]').click();
    await waitForSettledScope(page);
    const histogramCurve = await auditSustainedCurveDrag(page, "histogram", path.join(outputDir, "curve-histogram.png"));
    await page.locator("#curve-reset").evaluate((button) => button.click());
    await waitForSettledScope(page);
    await page.locator('[data-dock-tab="waveform"]').click();
    await page.waitForFunction(() => document.getElementById("scope-title")?.textContent?.includes("Waveform"), null, { timeout: 15000 });
    await waitForSettledScope(page);
    const waveform = await auditSustainedDrag(page, "waveform");
    await page.locator('[data-reset-group="hdr-equalizer"]').click();
    await waitForSettledScope(page);
    const waveformCurve = await auditSustainedCurveDrag(page, "waveform", path.join(outputDir, "curve-waveform.png"));
    const zoomOk = scopeZoom.selectedValue === "10000"
      && Math.abs(scopeZoom.lastBinEdge - 10000) < 1
      && scopeZoom.hasCeilingGuide;
    const result = {
      scopeZoom,
      histogram,
      histogramCurve,
      waveform,
      waveformCurve,
      errors,
      ok: zoomOk && histogram.ok && histogramCurve.ok && waveform.ok && waveformCurve.ok && errors.length === 0,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
