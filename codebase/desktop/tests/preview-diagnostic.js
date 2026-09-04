// Interactive reproduction harness. Opens a separate profile and never saves
// the project or touches another running instance.
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const output = path.resolve(__dirname, "../../output/preview-diagnostic");
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, "profile-"));
  const log = path.join(userData, "preview-trace.jsonl");
  const record = (entry) => fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  fs.writeFileSync(path.join(userData, "application-preferences.json"), JSON.stringify({
    schemaVersion: 1, renderingMode: "auto", updates: { checkAutomatically: false },
  }));
  const app = await electron.launch({
    executablePath: process.env.HDR_FINISHER_PACKAGED_EXECUTABLE,
    args: [process.env.HDR_FINISHER_MENU_PROJECT],
    env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userData },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => record({ event: "page-error", message: error.message, stack: error.stack }));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) record({ event: "console", type: message.type(), text: message.text() });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) record({ event: "http-error", status: response.status(), path: new URL(response.url()).pathname });
  });
  await page.waitForFunction(() => typeof state !== "undefined" && Boolean(state.acceptedPresentation), null, { timeout: 90000 });
  if (process.env.HDR_FINISHER_TEST_SOURCE_PATCH === "1") {
    const source = fs.readFileSync(path.resolve(__dirname, "../../frontend/app.js"), "utf8");
    const restore = source.slice(source.indexOf("async function showCachedPreview("), source.indexOf("function prepareInactivePreview("));
    await page.evaluate(`globalThis.showCachedPreview = (${restore}); void 0;`);
    record({ event: "preview-restoration-fix-applied" });
  }
  await page.evaluate(() => applyPreviewResolution("4096"));
  await page.waitForFunction(() => state.acceptedPresentation?.tier === "refinement"
    && state.acceptedPresentation.generation === state.previewGeneration[state.currentView], null, { timeout: 30000 });
  await page.evaluate(() => {
    const events = [];
    window.previewDiagnosticEvents = events;
    for (const type of ["pointerdown", "pointerup", "pointercancel", "lostpointercapture", "change", "click", "wheel", "focusin", "focusout"]) {
      document.addEventListener(type, (event) => {
        events.push({ type, at: performance.now(), target: event.target.id || event.target.tagName,
          buttons: event.buttons, value: event.target.value, deltaY: event.deltaY });
        if (events.length > 160) events.shift();
      }, { capture: true, passive: true });
    }
  });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setTitle("HDR Finisher — Preview diagnostic");
    window.maximize();
    window.show();
    window.focus();
  });
  fs.writeFileSync(path.join(output, "active.json"), JSON.stringify({ userData, log }, null, 2));
  console.log(`Diagnostic window ready. Trace: ${log}`);
  let closed = false;
  app.on("close", () => { closed = true; });
  let lastState = "";
  while (!closed) {
    try {
      const snapshot = await page.evaluate(() => ({
        events: window.previewDiagnosticEvents.splice(0),
        resolution: state.previewResolution, target: previewTargetLongEdge(), quality: els.previewQualityStatus.textContent,
        accepted: state.acceptedPresentation, generation: state.previewGeneration,
        image: { width: els.previewCanvas.width, height: els.previewCanvas.height, display: els.previewCanvas.style.display },
        geometry: { perspective: state.perspectiveMode, rotate: Boolean(state.rotateDraftGeometry), crop: state.cropMode,
          pending: state.geometryPresentationPending },
        edit: { dirty: state.globalEditDirty, revision: state.editRevision },
        zoom: { mode: state.zoomMode, percent: state.zoomPercent },
        menu: { visible: els.previewPopover.getClientRects().length > 0, open: els.previewResolution.matches(":open"),
          disabled: els.previewResolution.disabled, focus: document.activeElement?.id },
        scheduler: { current: state.previewScheduler.current, interacting: state.previewScheduler.interacting,
          frameInFlight: state.previewScheduler.frameInFlight, scopeInFlight: state.previewScheduler.scopeInFlight,
          pendingFrame: state.previewScheduler.framePending },
        gpu: { available: state.gpuPreview.available, detail: state.gpuPreview.detail,
          activeRenders: state.gpuPreview.activeRenderCount, activeScopes: state.gpuPreview.activeScopeCount,
          proxies: state.gpuPreview.proxies.size, deferredDestroy: state.gpuPreview.deferredDestroy.length },
      }));
      const { events, ...stateSnapshot } = snapshot;
      const serialized = JSON.stringify(stateSnapshot);
      if (events.length || serialized !== lastState) record({ event: "snapshot", ...snapshot });
      lastState = serialized;
      fs.writeFileSync(path.join(output, "latest-state.json"), JSON.stringify(snapshot, null, 2));
    } catch (error) {
      if (closed || page.isClosed()) break;
      record({ event: "snapshot-error", message: error.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
