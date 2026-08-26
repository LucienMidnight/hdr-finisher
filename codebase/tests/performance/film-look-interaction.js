const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("../../desktop/node_modules/playwright");
const electronExecutable = require("../../desktop/node_modules/electron");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

async function measureControl(window, selector, action) {
  return window.evaluate(async ({ selector: target, action: controlAction }) => {
    const control = document.querySelector(target);
    if (!control) throw new Error(`Missing control: ${target}`);
    const events = [];
    const onPresented = (event) => events.push({
      elapsedMs: event.detail.presentedAt - startedAt,
      longEdge: event.detail.longEdge,
    });
    window.addEventListener("hdrfinisher:preview-presented", onPresented);
    const startedAt = performance.now();
    if (controlAction.type === "click") control.click();
    else {
      control.value = String(controlAction.value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    window.removeEventListener("hdrfinisher:preview-presented", onPresented);
    return { events, elapsedMs: performance.now() - startedAt };
  }, { selector, action });
}

async function measureFilmLookBefore(window) {
  return window.evaluate(async () => {
    const originalAdjustments = JSON.stringify(state.adjustments);
    const originalDirty = state.documentDirty;
    const events = [];
    const waitForPresentation = () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for Film Look comparison preview.")), 5000);
      window.addEventListener("hdrfinisher:preview-presented", (event) => {
        clearTimeout(timeout);
        events.push(event.detail);
        resolve();
      }, { once: true });
    });
    let presentation = waitForPresentation();
    const startedAt = performance.now();
    beginFilmLookBefore();
    await presentation;
    const beforePresentedMs = performance.now() - startedAt;
    presentation = waitForPresentation();
    endFilmLookBefore();
    await presentation;
    return {
      beforePresentedMs,
      roundTripMs: performance.now() - startedAt,
      events,
      restored: state.filmLookBeforeLane === null,
      adjustmentsUnchanged: JSON.stringify(state.adjustments) === originalAdjustments,
      dirtyUnchanged: state.documentDirty === originalDirty,
    };
  });
}

async function main() {
  const sourcePath = path.resolve(argument("--input", path.join(__dirname, "..", "fixtures", "hdr_headroom.tiff")));
  const longEdge = Number(argument("--long-edge", "4096"));
  const desktopDirectory = path.resolve(__dirname, "..", "..", "desktop");
  assert.ok(fs.existsSync(sourcePath), `Missing input: ${sourcePath}`);
  const userDataRoot = path.resolve(__dirname, "..", "..", "output", "performance");
  fs.mkdirSync(userDataRoot, { recursive: true });
  const userDataPath = fs.mkdtempSync(path.join(userDataRoot, "film-look-user-data-"));
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
    executablePath: electronExecutable,
    args: ["--no-sandbox", "--enable-unsafe-webgpu", "."],
    cwd: desktopDirectory,
    env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userDataPath },
  });
  try {
    const window = await app.firstWindow();
    const requests = [];
    window.on("request", (request) => {
      if (request.method() === "POST") requests.push({ path: new URL(request.url()).pathname, startedAt: Date.now() });
    });
    window.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      const pending = [...requests].reverse().find((request) => request.path === pathname && request.durationMs === undefined);
      if (pending) pending.durationMs = Date.now() - pending.startedAt;
    });
    await window.waitForSelector("#empty-import-button", { state: "visible", timeout: 30000 });
    await window.waitForTimeout(1500);
    await window.locator("#file-input").setInputFiles(sourcePath);
    await window.waitForFunction(() => window.HDRFinisherPerformance?.sessionId?.(), null, { timeout: 120000 });
    await window.waitForFunction(() => window.HDRFinisherPerformance?.gpuSnapshot?.()?.available === true, null, { timeout: 120000 });
    await window.waitForFunction(() => document.getElementById("preview-canvas")?.style.display !== "none", null, { timeout: 120000 });
    await window.waitForTimeout(2000);
    await window.evaluate((edge) => applyPreviewResolution(String(edge), { schedule: false }), longEdge);
    await window.waitForFunction(
      (edge) => window.HDRFinisherPerformance.authoringState().previewResolution === String(edge),
      longEdge,
    );
    const initialRender = await window.evaluate(
      (edge) => window.HDRFinisherPerformance.renderGpuTier(edge),
      longEdge,
    );
    if (!initialRender) {
      const diagnostic = await window.evaluate(() => ({
        authoring: window.HDRFinisherPerformance.authoringState(),
        gpu: window.HDRFinisherPerformance.gpuSnapshot(),
        status: document.getElementById("preview-status-copy")?.textContent,
        badge: document.getElementById("badge")?.textContent,
      }));
      throw new Error(`Initial 4K render failed: ${JSON.stringify(diagnostic)}`);
    }

    // Activate a spatial Film Look once, then wait for its 4K resources and
    // source proxy to become resident before measuring bypass reuse.
    await window.locator("#film-halation-amount").evaluate((control) => {
      control.value = "10";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await window.waitForTimeout(250);
    assert.equal(await window.evaluate(
      (edge) => window.HDRFinisherPerformance.renderGpuTier(edge),
      longEdge,
    ), true);
    await window.waitForTimeout(1000);
    await window.evaluate(() => window.HDRFinisherPerformance.enableGpuInstrumentation(true));
    requests.length = 0;

    const before = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
    const filmLookBefore = await measureFilmLookBefore(window);
    assert.equal(filmLookBefore.restored, true);
    assert.equal(filmLookBefore.adjustmentsUnchanged, true);
    assert.equal(filmLookBefore.dirtyUnchanged, true);
    assert.equal(requests.length, 0);
    const afterFilmLookBefore = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
    const bypass = await measureControl(window, '[data-section-path="current.film_look_section_enabled"]', { type: "click" });
    const afterBypass = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
    const slider = await measureControl(window, "#film-print-contrast", { type: "input", value: 12 });
    const afterSlider = await window.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot());
    const result = {
      sourcePath,
      longEdge,
      filmLookBefore,
      bypass,
      slider,
      requests,
      allocationsAfterFilmLookBefore: afterFilmLookBefore.allocations.slice(before.allocations.length),
      allocationsAfterBypass: afterBypass.allocations.slice(afterFilmLookBefore.allocations.length),
      allocationsAfterSlider: afterSlider.allocations.slice(afterBypass.allocations.length),
      renders: afterSlider.renders,
      resources: afterSlider.resources,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
