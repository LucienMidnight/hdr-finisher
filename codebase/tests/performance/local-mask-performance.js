const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (amount) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))] || 0;
  return {
    samples: values.length,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1) || 0,
    totalMs: values.reduce((sum, value) => sum + value, 0),
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.addInitScript(() => {
      window.__localMaskLongTasks = [];
      new PerformanceObserver((list) => {
        window.__localMaskLongTasks.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ type: "longtask", buffered: true });
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#grade-mode-local").click();
    const created = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.locator('[data-local-tool="brush"]').click();
    await page.locator("#local-add-adjustment").click();
    await created;

    await page.evaluate(async () => {
      const leaf = selectedLocal().mask.leaf;
      leaf.mask_shift_edge = 0.025;
      leaf.mask_feather = 0.025;
      for (let strokeIndex = 0; strokeIndex < 24; strokeIndex += 1) {
        const row = strokeIndex % 6;
        const column = Math.floor(strokeIndex / 6);
        const startX = 0.18 + column * 0.18;
        const startY = 0.18 + row * 0.11;
        leaf.strokes.push({
          points: Array.from({ length: 16 }, (_, index) => ({
            x: startX + index * 0.018,
            y: startY + Math.sin(index * 0.6) * 0.015,
            pressure: 1,
          })),
          radius: 0.025,
          hardness: 0.5,
          flow: 1,
          opacity: 1,
          erase: false,
        });
      }
      await commitSelectedLocal();
    });
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && state.localMaskCommitDepth === 0
        && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    }, null, { timeout: 30000 });

    await page.evaluate(() => {
      window.__localMaskTimings = {};
      for (const name of ["renderLocalMaskOverlay", "drawBrushMaskOverlay", "drawBrushMaskStroke", "postProcessBrushMaskPreviewWithErase"]) {
        const original = window[name];
        window.__localMaskTimings[name] = [];
        window[name] = function instrumentedLocalMaskFunction(...args) {
          const started = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            window.__localMaskTimings[name].push(performance.now() - started);
          }
        };
      }
    });

    const zoomWallMs = [];
    for (const percent of [100, 200, 300, 150, 300]) {
      zoomWallMs.push(await page.evaluate((nextPercent) => new Promise((resolve) => {
        const started = performance.now();
        setCustomZoom(nextPercent);
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)));
      }), percent));
    }

    await page.locator("#local-eraser").click();
    const overlayBox = await page.locator("#local-mask-overlay").boundingBox();
    const eraseStarted = Date.now();
    const strokesBeforeErase = await page.evaluate(() => selectedLocal().mask.leaf.strokes.length);
    const eraseStartX = Math.max(overlayBox.x + 20, 400);
    const eraseEndX = Math.min(overlayBox.x + overlayBox.width - 20, 800);
    const eraseStartY = Math.max(overlayBox.y + 20, 380);
    const eraseEndY = Math.min(overlayBox.y + overlayBox.height - 20, 480);
    await page.mouse.move(eraseStartX, eraseStartY);
    await page.mouse.down();
    await page.mouse.move(eraseEndX, eraseEndY, { steps: 40 });
    const commitResponse = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    const commitStarted = Date.now();
    await page.mouse.up();
    await commitResponse;
    const eraseCommitResponseMs = Date.now() - commitStarted;
    const eraseGestureWallMs = Date.now() - eraseStarted;
    await page.waitForFunction(() => state.localMaskCommitDepth === 0, null, { timeout: 30000 });

    const raw = await page.evaluate(() => ({
      timings: window.__localMaskTimings,
      longTasks: window.__localMaskLongTasks,
      source: state.session.source,
      zoomPercent: state.zoomPercent,
      localErase: state.localErase,
      strokesAfterErase: selectedLocal().mask.leaf.strokes.length,
      localPayloadBytes: new Blob([JSON.stringify(selectedLocal())]).size,
      geometry: Object.fromEntries(["local-mask-overlay", "preview-canvas", "preview-primary-pane"].map((id) => {
        const rect = document.getElementById(id).getBoundingClientRect();
        return [id, [rect.left, rect.top, rect.right, rect.bottom]];
      })),
      authoritativeSize: (() => {
        const local = selectedLocal();
        const canvas = localAuthoritativeMaskCache.get(local.id)?.canvas;
        return canvas ? [canvas.width, canvas.height] : null;
      })(),
    }));
    console.log(JSON.stringify({
      source: raw.source,
      authoritativeSize: raw.authoritativeSize,
      zoomWall: summarize(zoomWallMs),
      eraseGestureWallMs,
      eraseCommitResponseMs,
      strokesBeforeErase,
      strokesAfterErase: raw.strokesAfterErase,
      localPayloadBytes: raw.localPayloadBytes,
      localErase: raw.localErase,
      geometry: raw.geometry,
      functions: Object.fromEntries(Object.entries(raw.timings).map(([name, values]) => [name, summarize(values)])),
      longTasks: summarize(raw.longTasks),
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
