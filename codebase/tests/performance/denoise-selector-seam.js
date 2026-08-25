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
  return {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    left: rect.left,
    top: rect.top,
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
    assert.ok(Math.abs(before[key] - after[key]) <= 0.01, `${label}: ${key} changed (${before[key]} -> ${after[key]})`);
  }
  for (const key of ["zoomMode", "lane", "sessionId"]) assert.equal(after[key], before[key], `${label}: ${key} changed`);
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
    return presented;
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
  const phase2 = process.argv.includes("--wavelet");
  const phase3 = process.argv.includes("--ui");
  const desktopDirectory = path.resolve(__dirname, "..", "..", "desktop");
  const codebase = path.resolve(desktopDirectory, "..");
  const sourcePath = path.resolve(argument("--input", path.join(codebase, "tests", "fixtures", "hdr_headroom.tiff")));
  const longEdge = Number(argument("--long-edge", "1024"));
  const repetitions = Number(argument("--repetitions", "24"));
  const gradeRepetitions = Number(argument("--grade-repetitions", "12"));
  const methodLevels = Number(argument("--method-levels", "2"));
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
    if (phase3) {
      await window.locator("#preview-resolution").evaluate((control, edge) => {
        control.value = String(edge);
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }, longEdge);
      await window.waitForFunction(
        (edge) => window.HDRFinisherPerformance.authoringState().previewResolution === String(edge),
        longEdge,
      );
      await window.waitForFunction(
        (edge) => Math.max(
          document.getElementById("preview-canvas")?.width || 0,
          document.getElementById("preview-canvas")?.height || 0,
        ) === edge,
        longEdge,
        { timeout: 30000 },
      );
    }
    await window.evaluate(() => {
      setCustomZoom(200);
      const viewport = document.getElementById("dropzone");
      viewport.scrollLeft = Math.max(0, viewport.scrollWidth * 0.37);
      viewport.scrollTop = Math.max(0, viewport.scrollHeight * 0.41);
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
    });
    recordRequests = true;

    const initialViewport = await window.evaluate(viewportState);
    await renderTier(window, longEdge);
    const baselineViewport = await window.evaluate(viewportState);
    assertStableViewport(initialViewport, baselineViewport, "proxy tier transition", { allowCanvasResize: true });
    const exposureSamples = [];
    for (let index = 0; index < gradeRepetitions; index += 1) {
      exposureSamples.push(await measureExposure(window, index % 2 ? 0.35 : -0.35));
    }
    assert.ok(exposureSamples.every((sample) => !sample.timedOut), `exposure telemetry timed out: ${JSON.stringify(exposureSamples)}`);
    assertStableViewport(
      baselineViewport,
      await window.evaluate(viewportState),
      "unrelated exposure controls",
      { allowCanvasResize: true },
    );
    await renderTier(window, longEdge);

    const unused = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
    assert.equal(unused.denoise.selectorCreated, false);
    assert.equal(unused.resources.denoiseTextures, 0);
    assert.equal(unused.resources.denoiseBytes, 0);
    assert.equal(unused.denoise.analysisCalls, 0);
    assert.equal(unused.denoise.resolveCalls, 0);

    if (phase3) {
      const before = await window.evaluate(viewportState);
      await window.locator('.denoise-group > .control-group-header > .group-toggle').click();
      await window.locator("#denoise-bypass").click();
      await window.waitForFunction(() => document.getElementById("denoise-status")?.textContent === "Denoise cache ready.", null, { timeout: 30000 });
      assertStableViewport(before, await window.evaluate(viewportState), "UI initial analysis");
      const ready = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
      assert.equal(ready.denoise.analysisCalls, 1);
      assert.equal(ready.denoise.resolveCalls, 1);

      await window.locator("#denoise-amount").evaluate((control) => {
        control.value = "0.82";
        control.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await window.waitForFunction(() => window.HDRFinisherPerformance.gpuSnapshot().denoise.resolveCalls >= 2);
      const live = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
      assert.equal(live.denoise.analysisCalls, 1);
      assert.equal(await window.locator("#denoise-amount-value").textContent(), "82%");

      for (const value of ["0.2", "0.82"]) {
        await window.locator("#denoise-amount").evaluate((control, next) => {
          control.value = next;
          control.dispatchEvent(new Event("input", { bubbles: true }));
        }, value);
      }
      await window.waitForFunction(() => window.HDRFinisherPerformance.gpuSnapshot().denoise.resolveCalls >= 4);
      const liveRace = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
      assert.equal(liveRace.denoise.analysisCalls, 1);
      assert.equal(liveRace.denoise.selectedSource, "resolved");
      assert.equal(await window.locator("#denoise-amount-value").textContent(), "82%");

      const beforeGrade = liveRace.denoise;
      await measureExposure(window, 0.25);
      const afterGrade = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot().denoise);
      assert.equal(afterGrade.analysisCalls, beforeGrade.analysisCalls);
      assert.equal(afterGrade.resolveCalls, beforeGrade.resolveCalls);

      await window.locator("#denoise-bypass").click();
      await window.waitForFunction(() => document.getElementById("denoise-status")?.textContent === "Denoise is off.");
      const bypassed = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot().denoise);
      assert.equal(bypassed.analysisCalls, beforeGrade.analysisCalls);
      assert.equal(bypassed.resolveCalls, beforeGrade.resolveCalls);
      assert.equal(bypassed.selectedSource, "original");
      await window.locator("#denoise-bypass").click();
      await window.waitForFunction(() => document.getElementById("denoise-status")?.textContent === "Denoise cache ready.");
      const restored = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot().denoise);
      assert.equal(restored.analysisCalls, beforeGrade.analysisCalls);
      assert.equal(restored.resolveCalls, beforeGrade.resolveCalls);
      assert.equal(restored.selectedSource, "resolved");

      await window.locator("#denoise-method").selectOption("render_coarse");
      await window.waitForFunction(() => document.getElementById("denoise-status")?.textContent.startsWith("Analysis settings changed."));
      assert.equal(await window.locator("#denoise-method-note").textContent(), "Four-scale cleanup for larger Monte Carlo noise; inspect edges and texture carefully.");
      assert.equal(await window.locator("#denoise-custom-settings").isHidden(), true);
      const methodDirty = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot().denoise);
      assert.equal(methodDirty.analysisCalls, restored.analysisCalls);
      await window.locator("#denoise-recalculate").click();
      await window.waitForFunction(() => document.getElementById("denoise-status")?.textContent === "Denoise cache ready.", null, { timeout: 30000 });
      const methodReady = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
      assert.equal(methodReady.denoise.analysisCalls, restored.analysisCalls + 1);
      assert.equal(methodReady.resources.denoiseTextures, 16);

      await window.locator('.denoise-group > .control-group-header > [data-reset-group="denoise"]').click();
      await window.waitForFunction(() => document.getElementById("denoise-status")?.textContent.startsWith("Analysis settings changed."));
      const resetVisuals = await window.locator('.denoise-group input[type="range"]').evaluateAll((controls) => controls.map((control) => {
        const minimum = Number(control.min);
        const maximum = Number(control.max);
        const expected = maximum > minimum ? ((Number(control.value) - minimum) / (maximum - minimum)) * 100 : 0;
        const rendered = Number.parseFloat(control.closest(".range-shell")?.style.getPropertyValue("--pos"));
        return { expected, rendered };
      }));
      assert.ok(resetVisuals.every(({ expected, rendered }) => Math.abs(expected - rendered) < 0.001), `Denoise reset detached a slider fill: ${JSON.stringify(resetVisuals)}`);
      const afterReset = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot().denoise);
      assert.equal(afterReset.analysisCalls, methodReady.denoise.analysisCalls);
      assert.equal(afterReset.resolveCalls, methodReady.denoise.resolveCalls);

      await window.locator('.denoise-group > .control-group-header > .group-preset').click();
      await window.waitForFunction(() => document.getElementById("group-preset-dialog")?.open
        && document.getElementById("group-preset-list")?.textContent.includes("Photo / Fine"));
      await window.locator(".group-preset-row.built-in button").first().click();
      await window.waitForFunction(() => document.getElementById("denoise-status")?.textContent.startsWith("Analysis settings changed."));
      const dirty = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot().denoise);
      assert.equal(dirty.analysisCalls, methodReady.denoise.analysisCalls);
      await window.locator("#denoise-recalculate").click();
      await window.waitForFunction(() => document.getElementById("denoise-status")?.textContent === "Denoise cache ready.", null, { timeout: 30000 });
      const recalculated = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
      assert.equal(recalculated.denoise.analysisCalls, methodReady.denoise.analysisCalls + 1);
      assert.equal(recalculated.denoise.cacheReady, true);

      await window.locator('[data-kind="sdr"]').click();
      await window.waitForFunction(() => document.body.dataset.activeLane === "sdr");
      await window.waitForFunction(() => !window.HDRFinisherPerformance.gpuSnapshot().denoise.selectorCreated);
      const laneEvicted = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
      assert.equal(laneEvicted.resources.denoiseTextures, 0);
      assert.equal(laneEvicted.resources.denoiseBytes, 0);
      assert.equal(await window.locator("#denoise-status").textContent(), "Denoise is off.");

      await window.locator('[data-kind="hdr"]').click();
      await window.waitForFunction(() => document.body.dataset.activeLane === "hdr");
      await window.waitForFunction(() => document.getElementById("denoise-status")?.textContent === "Denoise cache ready.", null, { timeout: 30000 });
      const laneRestored = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
      assert.equal(laneRestored.denoise.analysisCalls, recalculated.denoise.analysisCalls + 1);
      assert.equal(laneRestored.denoise.resolveCalls, recalculated.denoise.resolveCalls + 1);
      assert.ok(laneRestored.denoise.identity.includes(":hdr:"));

      await window.locator("#denoise-bypass").click();
      await window.waitForFunction(() => document.getElementById("denoise-status")?.textContent === "Denoise is off.");
      const disabled = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
      assert.equal(disabled.denoise.analysisCalls, laneRestored.denoise.analysisCalls);
      assert.equal(disabled.denoise.resolveCalls, laneRestored.denoise.resolveCalls);
      assert.equal(disabled.denoise.selectedSource, "original");
      assertStableViewport(before, await window.evaluate(viewportState), "UI disable");
      const result = {
        schemaVersion: 1,
        completedAt: new Date().toISOString(),
        packaged,
        phase: 3,
        sourcePath,
        longEdge,
        hardware: disabled.adapter,
        ready: ready.denoise,
        live: live.denoise,
        liveRace: liveRace.denoise,
        recalculated: recalculated.denoise,
        laneEvicted: { denoise: laneEvicted.denoise, resources: laneEvicted.resources },
        laneRestored: laneRestored.denoise,
        disabled: disabled.denoise,
        resources: disabled.resources,
        viewport: before,
      };
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (phase2) {
      const before = await window.evaluate(viewportState);
      const analysisElapsedMs = await window.evaluate(async ({ edge, levels }) => {
        const presented = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timed out waiting for wavelet analysis presentation")), 30000);
          window.addEventListener("hdrfinisher:preview-presented", (event) => {
            clearTimeout(timeout);
            resolve(event.detail);
          }, { once: true });
        });
        const started = performance.now();
        if (!await window.HDRFinisherPerformance.analyzeDenoiseWavelet({
          levels,
          noiseThreshold: levels >= 4 ? 4 : 3,
          lumaSigma: levels >= 4 ? 0.065 : 0.035,
          chromaSigma: levels >= 4 ? 0.065 : 0.035,
        }, edge)) throw new Error("Wavelet analysis failed");
        await presented;
        return performance.now() - started;
      }, { edge: longEdge, levels: methodLevels });
      assertStableViewport(before, await window.evaluate(viewportState), "wavelet analysis");
      const resolveMs = [];
      for (let index = 0; index < repetitions; index += 1) {
        const elapsed = await window.evaluate(async ({ edge, index: iteration }) => {
          const presented = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timed out waiting for wavelet resolve presentation")), 10000);
            window.addEventListener("hdrfinisher:preview-presented", (event) => {
              clearTimeout(timeout);
              resolve(event.detail);
            }, { once: true });
          });
          const started = performance.now();
          const amount = iteration % 2 ? 0.2 : 0.8;
          if (!await window.HDRFinisherPerformance.resolveDenoiseWavelet({
            amount, luminance: 0.65, colorNoise: 0.75, detailRecovery: 0.4,
          }, edge)) throw new Error("Wavelet resolve failed");
          await presented;
          return performance.now() - started;
        }, { edge: longEdge, index });
        resolveMs.push(elapsed);
        assertStableViewport(before, await window.evaluate(viewportState), `wavelet resolve ${index}`);
      }
      const resolveRace = await window.evaluate((edge) => Promise.all([
        window.HDRFinisherPerformance.resolveDenoiseWavelet({
          amount: 0.1, luminance: 0.65, colorNoise: 0.75, detailRecovery: 0.4,
        }, edge),
        window.HDRFinisherPerformance.resolveDenoiseWavelet({
          amount: 0.9, luminance: 0.65, colorNoise: 0.75, detailRecovery: 0.4,
        }, edge),
      ]), longEdge);
      assert.deepEqual(resolveRace, [false, true]);
      assertStableViewport(before, await window.evaluate(viewportState), "wavelet latest-wins resolve");
      const beforeUnrelated = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot().denoise);
      const selectedExposure = [];
      for (let index = 0; index < gradeRepetitions; index += 1) {
        selectedExposure.push(await measureExposure(window, index % 2 ? 0.2 : -0.2));
      }
      const finalSnapshot = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
      const resolvedSample = await window.evaluate(() => window.HDRFinisherPerformance.readDenoiseResolvedRegion(16, 16));
      assert.equal(finalSnapshot.denoise.analysisCalls, 1);
      assert.equal(finalSnapshot.denoise.resolveCalls, repetitions + 3);
      assert.equal(finalSnapshot.denoise.analysisCalls, beforeUnrelated.analysisCalls);
      assert.equal(finalSnapshot.denoise.resolveCalls, beforeUnrelated.resolveCalls);
      assert.equal(finalSnapshot.denoise.cacheReady, true);
      assert.equal(finalSnapshot.denoise.algorithmVersion, "compact-haar-residual-v1");
      const encodedPreviewRequests = measuredRequests.filter((requestPath) => /\/preview(?:-raw)?(?:\/|$)/.test(requestPath));
      assert.deepEqual(encodedPreviewRequests, []);
      const result = {
        schemaVersion: 1,
        completedAt: new Date().toISOString(),
        packaged,
        phase: 2,
        sourcePath,
        longEdge,
        methodLevels,
        renderedWidth: before.canvasWidth,
        renderedHeight: before.canvasHeight,
        hardware: finalSnapshot.adapter,
        analysisToPresentMs: analysisElapsedMs,
        resolveToPresent: summarize(resolveMs),
        resolveRace,
        selectedExposure: {
          preview: summarize(selectedExposure.map((sample) => sample.previewMs)),
          firstScope: summarize(selectedExposure.map((sample) => sample.firstScopeMs)),
          settledScope: summarize(selectedExposure.map((sample) => sample.settledScopeMs)),
        },
        denoise: finalSnapshot.denoise,
        resources: finalSnapshot.resources,
        resolvedSample,
        network: { requests: measuredRequests.length, encodedPreviewRequests: encodedPreviewRequests.length },
        viewport: before,
      };
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await window.evaluate(() => window.HDRFinisherPerformance.disposeDenoiseSelectorSeam());
      return;
    }

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
      baselineExposure: {
        preview: summarize(exposureSamples.map((sample) => sample.previewMs)),
        firstScope: summarize(exposureSamples.map((sample) => sample.firstScopeMs)),
        settledScope: summarize(exposureSamples.map((sample) => sample.settledScopeMs)),
      },
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
