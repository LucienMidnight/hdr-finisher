const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("../../desktop/node_modules/playwright");
const electronExecutable = require("../../desktop/node_modules/electron");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function percentile(values, amount) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))] ?? null;
}

function summarize(values) {
  return {
    samples: values.length,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null,
  };
}

function viewportState() {
  const canvas = document.getElementById("preview-canvas");
  const viewport = document.getElementById("dropzone");
  const rect = canvas.getBoundingClientRect();
  const pane = viewport.getBoundingClientRect();
  return {
    viewportLeft: pane.left,
    viewportWidth: pane.width,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    // Preserve pan relative to the pane centre, even when inspector/scope
    // layout changes the pane width. Absolute window coordinates are not fixed.
    left: rect.left - pane.left - (pane.width - rect.width) / 2,
    top: rect.top - pane.top - (pane.height - rect.height) / 2,
    width: rect.width,
    height: rect.height,
    scrollLeft: viewport.scrollLeft,
    scrollTop: viewport.scrollTop,
    zoomMode: state.zoomMode,
    zoomPercent: state.zoomPercent,
    lane: state.currentView,
    sessionId: state.session?.session_id || null,
  };
}

function assertStableViewport(before, after, label, { allowCanvasResize = false } = {}) {
  const numericKeys = ["left", "top", "width", "height", "scrollLeft", "scrollTop", "zoomPercent"];
  if (!allowCanvasResize) numericKeys.unshift("canvasWidth", "canvasHeight");
  for (const key of numericKeys) {
    // clientWidth rounds to integers while CSS boxes retain fractional widths;
    // centering can therefore move by less than half a pixel during reflow.
    const tolerance = key === "left" || key === "top" ? 0.5 : 0.01;
    assert.ok(Math.abs(before[key] - after[key]) <= tolerance, `${label}: ${key} changed (${before[key]} -> ${after[key]}): ${JSON.stringify({before,after})}`);
  }
  for (const key of ["zoomMode", "lane", "sessionId"]) assert.equal(after[key], before[key], `${label}: ${key} changed`);
}

async function settleViewport(window) {
  // Presentation is emitted before ResizeObserver places the canvas. Require
  // a quiet layout before comparing placement, outside the latency sample.
  await window.evaluate(async () => {
    let previous = null;
    let quietSince = performance.now();
    const started = quietSince;
    while (performance.now() - quietSince < 600) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const canvas = document.getElementById("preview-canvas").getBoundingClientRect();
      const key = JSON.stringify([canvas.left, canvas.top, canvas.width, canvas.height]);
      if (key !== previous || state.gpuDraftInFlight || state.zoomRefinementTimer
        || state.renderCoordinator?.state(state.currentView).inFlight
        || state.renderCoordinator?.state(state.currentView).pending
        || document.getElementById("scope-freshness")?.classList.contains("updating")) quietSince = performance.now();
      previous = key;
      if (performance.now() - started > 30000) throw new Error("Viewport did not settle");
    }
  });
}

async function waitForPresentation(window, action) {
  return window.evaluate(async (run) => {
    const presented = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for selector presentation")), 5000);
      window.addEventListener("hdrfinisher:preview-presented", (event) => {
        clearTimeout(timeout);
        resolve(event.detail);
      }, { once: true });
    });
    const startedAt = performance.now();
    const rendered = await window.HDRFinisherPerformance.selectDenoiseSelectorSeam(run.enabled, run.longEdge);
    if (!rendered) throw new Error("Selector seam render failed");
    const detail = await presented;
    return { elapsedMs: detail.presentedAt - startedAt, detail };
  }, action);
}

async function renderTier(window, longEdge) {
  return window.evaluate(async (edge) => {
    const presented = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for tier presentation")), 5000);
      window.addEventListener("hdrfinisher:preview-presented", (event) => {
        clearTimeout(timeout);
        resolve(event.detail);
      }, { once: true });
    });
    if (!await window.HDRFinisherPerformance.renderGpuTier(edge)) throw new Error("Tier render failed");
    const detail = await presented;
    // A diagnostic tier also starts normal scopes/refinement. Do not sample
    // placement in the middle of the resulting viewer reflow.
    while (state.gpuDraftInFlight || state.renderCoordinator?.state(state.currentView).inFlight
      || state.renderCoordinator?.state(state.currentView).pending || state.zoomRefinementTimer
      || document.getElementById("scope-freshness")?.classList.contains("updating")) {
      await new Promise(resolve => setTimeout(resolve, 25));
      if (performance.now() - detail.presentedAt > 30000) throw new Error("Tier layout did not settle");
    }
    // Source publication and scope layout can queue another ResizeObserver
    // cycle after the render promise. This baseline is outside latency timing.
    await new Promise(resolve => setTimeout(resolve, 500));
    // Presentation updates CSS; the viewer ResizeObserver applies its final
    // placement on the next animation frame, after layout has run.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return detail;
  }, longEdge);
}

async function measureExposure(window, value) {
  return window.evaluate((nextValue) => new Promise((resolve, reject) => {
    const control = document.querySelector('[data-path="hdr.exposure"]');
    if (!control) {
      reject(new Error("Missing HDR exposure control"));
      return;
    }
    const startedAt = performance.now();
    let previewMs = null;
    let firstScopeMs = null;
    let settledScopeMs = null;
    const timeout = setTimeout(() => finish(true), 3000);
    const onPreview = (event) => {
      previewMs ??= event.detail.presentedAt - startedAt;
      finish(false);
    };
    const onScope = (event) => {
      const elapsed = event.detail.presentedAt - startedAt;
      firstScopeMs ??= elapsed;
      if (["settled", "refinement"].includes(event.detail.tier)) settledScopeMs = elapsed;
      finish(false);
    };
    const finish = (timedOut) => {
      if (!timedOut && (previewMs === null || firstScopeMs === null || settledScopeMs === null)) return;
      clearTimeout(timeout);
      window.removeEventListener("hdrfinisher:preview-presented", onPreview);
      window.removeEventListener("hdrfinisher:scope-presented", onScope);
      resolve({ previewMs, firstScopeMs, settledScopeMs, timedOut });
    };
    window.addEventListener("hdrfinisher:preview-presented", onPreview);
    window.addEventListener("hdrfinisher:scope-presented", onScope);
    control.value = String(nextValue);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }), value);
}

async function main() {
  const packaged = process.argv.includes("--packaged");
  const desktopDirectory = path.resolve(__dirname, "..", "..", "desktop");
  const codebase = path.resolve(desktopDirectory, "..");
  const sourcePath = path.resolve(argument("--input", path.join(codebase, "tests", "fixtures", "hdr_headroom.tiff")));
  let longEdge = Number(argument("--long-edge", "1024"));
  const repetitions = Number(argument("--repetitions", "24"));
  const gradeRepetitions = Number(argument("--grade-repetitions", "12"));
  const importTimeout = Number(argument("--import-timeout", "120000"));
  const outputPath = path.resolve(argument("--output", path.join(codebase, "output", "performance", "denoise-selector-seam.json")));
  const defaultPackagedExecutable = path.join(codebase, "dist-electron", "win-unpacked", "HDR Finisher.exe");
  const executablePath = packaged
    ? path.resolve(argument("--executable", process.env.HDR_FINISHER_PACKAGED_EXECUTABLE || defaultPackagedExecutable))
    : electronExecutable;
  assert.ok(fs.existsSync(sourcePath), `Missing input: ${sourcePath}`);
  assert.ok(fs.existsSync(executablePath), `Missing Electron executable: ${executablePath}`);

  const userDataRoot = path.join(codebase, "output", "performance");
  fs.mkdirSync(userDataRoot, { recursive: true });
  const userDataPath = fs.mkdtempSync(path.join(userDataRoot, "denoise-selector-user-data-"));
  fs.writeFileSync(path.join(userDataPath, "application-preferences.json"), JSON.stringify({
    schemaVersion: 1,
    defaultReferenceWhiteNits: 203,
    renderingMode: "gpu",
    folders: { projectSave: "", projectImport: "", fileSave: "", fileImport: "", presetSave: "" },
    shortcuts: {},
    shortcutPresets: {},
    updates: { checkAutomatically: false, dismissedVersion: "" },
  }));

  const app = await electron.launch({
    executablePath,
    args: packaged
      ? ["--no-sandbox", "--enable-unsafe-webgpu"]
      : ["--no-sandbox", "--enable-unsafe-webgpu", "."],
    cwd: desktopDirectory,
    env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userDataPath },
  });
  try {
    const window = await app.firstWindow();
    const browserErrors = [];
    const measuredRequests = [];
    let recordRequests = false;
    window.on("request", (request) => {
      if (recordRequests) measuredRequests.push(new URL(request.url()).pathname);
    });
    window.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    window.on("pageerror", (error) => browserErrors.push(error.message));
    await window.waitForSelector("#empty-import-button", { state: "visible", timeout: 30000 });
    await window.waitForTimeout(1500);
    await window.locator("#file-input").setInputFiles(sourcePath);
    try {
      await window.waitForFunction(() => window.HDRFinisherPerformance?.sessionId?.(), null, { timeout: importTimeout });
    } catch (error) {
      const diagnostic = await window.evaluate(() => ({
        performanceApi: typeof window.HDRFinisherPerformance,
        sessionName: document.getElementById("session-name")?.textContent,
        status: document.getElementById("preview-status-copy")?.textContent,
        badge: document.getElementById("badge")?.textContent,
      }));
      throw new Error(`Source import did not create a session: ${JSON.stringify({ diagnostic, browserErrors })}`, { cause: error });
    }
    try {
      await window.waitForFunction(() => window.HDRFinisherPerformance?.gpuSnapshot?.()?.available === true, null, { timeout: 30000 });
    } catch (error) {
      const snapshot = await window.evaluate(() => window.HDRFinisherPerformance?.gpuSnapshot?.() || null);
      throw new Error(`WebGPU unavailable in Electron: ${JSON.stringify(snapshot)}`, { cause: error });
    }
    await window.waitForFunction(() => document.getElementById("preview-canvas")?.style.display !== "none", null, { timeout: 30000 });
    // The renderer caps a requested tier at native size. The diagnostic selector
    // must use that same identity even for the tiny default headroom fixture.
    longEdge = await window.evaluate((edge) => Math.min(edge,
      Math.max(state.session.source.width, state.session.source.height)), longEdge);
    await window.evaluate(() => window.HDRFinisherPerformance.enableGpuInstrumentation(true));
    const before = await window.evaluate(viewportState);
    assert.equal(await window.evaluate((edge) => window.HDRFinisherPerformance.prepareDenoiseSelectorSeam("resolved-a", edge), longEdge), true);
    const firstKnownPixel = await window.evaluate(() => window.HDRFinisherPerformance.readDenoiseSelectorPixel());
    assert.deepEqual(firstKnownPixel, [0, 0, 0, 1]);
    const prepared = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
    assert.equal(prepared.resources.denoiseTextures, 1);
    assert.ok(prepared.resources.denoiseBytes > 0);
    assert.equal(prepared.denoise.analysisCalls, 0);
    assert.equal(prepared.denoise.resolveCalls, 0);

    const toggleMs = [];
    for (let index = 0; index < repetitions; index += 1) {
      const enabled = index % 2 === 0;
      const timing = await waitForPresentation(window, { enabled, longEdge });
      toggleMs.push(timing.elapsedMs);
      await settleViewport(window);
      const current = await window.evaluate(viewportState);
      assertStableViewport(before, current, `toggle ${index}`);
    }
    const selectedSnapshot = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
    const lastResolvedGrade = [...selectedSnapshot.stages].reverse().find((entry) => entry.stage === "grading" && entry.source === "resolved");
    assert.ok(lastResolvedGrade, `resolved selector was not bound into grading: ${JSON.stringify(selectedSnapshot.denoise)}`);

    await waitForPresentation(window, { enabled: true, longEdge });
    const latestWins = await window.evaluate(async (edge) => Promise.all([
      window.HDRFinisherPerformance.prepareDenoiseSelectorSeam("resolved-a", edge),
      window.HDRFinisherPerformance.prepareDenoiseSelectorSeam("resolved-b", edge),
    ]), longEdge);
    assert.deepEqual(latestWins, [false, true]);
    const latestKnownPixel = await window.evaluate(() => window.HDRFinisherPerformance.readDenoiseSelectorPixel());
    assert.deepEqual(latestKnownPixel, [4, 4, 4, 1]);
    await waitForPresentation(window, { enabled: true, longEdge });
    assertStableViewport(before, await window.evaluate(viewportState), "atomic replacement");

    const finalSnapshot = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
    assert.equal(finalSnapshot.denoise.analysisCalls, 0);
    assert.equal(finalSnapshot.denoise.resolveCalls, 0);
    assert.equal(finalSnapshot.resources.denoiseTextures, 1);
    const encodedPreviewRequests = measuredRequests.filter((requestPath) => (
      /\/preview(?:-raw)?(?:\/|$)/.test(requestPath)
    ));
    assert.deepEqual(encodedPreviewRequests, [], `encoded preview requests entered the measured path: ${encodedPreviewRequests}`);
    const result = {
      schemaVersion: 1,
      completedAt: new Date().toISOString(),
      packaged,
      sourcePath,
      longEdge,
      renderedWidth: before.canvasWidth,
      renderedHeight: before.canvasHeight,
      repetitions,
      hardware: finalSnapshot.adapter,
      toggleToPresent: {
        medianMs: percentile(toggleMs, 0.5),
        p95Ms: percentile(toggleMs, 0.95),
        maxMs: Math.max(...toggleMs),
      },
      denoise: finalSnapshot.denoise,
      resources: finalSnapshot.resources,
      network: {
        requests: measuredRequests.length,
        proxyRequests: measuredRequests.filter((requestPath) => requestPath.includes("/proxy/")).length,
        encodedPreviewRequests: encodedPreviewRequests.length,
      },
      stageCounts: finalSnapshot.stages.reduce((counts, event) => {
        counts[event.stage] = (counts[event.stage] || 0) + 1;
        return counts;
      }, {}),
      viewport: before,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    await window.evaluate(() => window.HDRFinisherPerformance.disposeDenoiseSelectorSeam());
    const disposed = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
    assert.equal(disposed.resources.denoiseTextures, 0);
    assert.equal(disposed.resources.denoiseBytes, 0);
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => null);
    await app.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
