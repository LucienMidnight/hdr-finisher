// Phase 1.3 -- local masks must travel as bounded batches, not one request per tile.
//
//   node tests/performance/tiled-mask-batch-transport.js --url http://127.0.0.1:8765
//
// The tiled path used to issue one HTTP request per tile per local, so one
// 42 MP local could fan out to hundreds of requests and a cold cache could
// compile the same mask repeatedly. The batched route carries many tiles in
// one request, grouped by local so the backend compiles each mask identity
// once. This scenario forces the tiled route with an active local and records
// what the renderer actually asked the backend for.
//
// Negative controls:
//   - zero per-tile requests to /local-mask-tile/<id>
//   - at least one batched request to /local-mask-tiles
//   - every batch body carries no more than the declared tile cap
//   - at least one batch carries more than one tile, which is what makes the
//     request count follow batches instead of tiles

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const TILE_BATCH_CAP = 64;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function clipBrightness(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    let total = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      total += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
    }
    return total / (pixels.length / 4);
  }, `data:image/png;base64,${png.toString("base64")}`);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const output = argument("--output", path.join("output", "performance", "tiled-mask-batch-transport.json"));
  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.addInitScript(() => {
      window.__maskTransport = { batch: [], perTile: [] };
      const original = window.fetch;
      window.fetch = function recordingFetch(input, init = {}) {
        const target = typeof input === "string" ? input : (input && input.url) || "";
        if (target.includes("/local-mask-tiles")) {
          let tiles = -1;
          try {
            tiles = (JSON.parse(init.body || "{}").tiles || []).length;
          } catch {
            tiles = -1;
          }
          const entry = { url: target, tiles, status: null };
          window.__maskTransport.batch.push(entry);
          const pending = original.call(this, input, init);
          pending.then((response) => { entry.status = response.status; }).catch(() => {});
          return pending;
        }
        if (target.includes("/local-mask-tile/")) {
          const entry = { url: target, status: null };
          window.__maskTransport.perTile.push(entry);
          const pending = original.call(this, input, init);
          pending.then((response) => { entry.status = response.status; }).catch(() => {});
          return pending;
        }
        return original.call(this, input, init);
      };
    });

    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 120000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 120000 });

    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#grade-mode-local").click();
    const created = page.waitForResponse(
      (response) => response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.locator('[data-local-tool="brush"]').click();
    await page.locator("#local-add-adjustment").click();
    await created;
    await page.waitForFunction(() => state.localMaskCommitDepth === 0, null, { timeout: 30000 });

    // Force the route under test and let the automatic re-render settle first.
    // Two tiled generations sharing the presentation canvas at different sizes
    // is a different defect; this scenario measures transport.
    await page.evaluate(() => applyExecutionOverride("tiled"));
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    // A legacy pass first: no viewport, every tile foreground, nothing kept.
    const longEdge = await page.evaluate(
      () => Math.max(state.session.source.width, state.session.source.height),
    );
    const legacy = await page.evaluate(async (edge) => {
      const rendered = await window.HDRFinisherPerformance.renderTiledTier(edge);
      return {
        rendered: Boolean(rendered && rendered.rendered),
        refusals: (rendered && rendered.refusals) || [],
        metrics: window.HDRFinisherPerformance.tiledExecutionMetrics(),
      };
    }, longEdge);

    // The region the ROI pass must not touch, captured before it runs.
    const canvasBox = await page.locator("#preview-canvas").boundingBox();
    const offscreenClip = {
      x: canvasBox.x + canvasBox.width * 0.6,
      y: canvasBox.y,
      width: canvasBox.width * 0.4,
      height: canvasBox.height,
    };
    const offscreenBefore = await clipBrightness(page, offscreenClip);

    // The ROI pass: only tiles intersecting the viewport are processed, and the
    // accepted frame is kept everywhere else.
    const outcome = await page.evaluate(async ({ edge, viewport }) => {
      const rendered = await window.HDRFinisherPerformance.renderTiledTier(edge, { viewport });
      return {
        rendered: Boolean(rendered && rendered.rendered),
        refusals: (rendered && rendered.refusals) || [],
        execution: state.acceptedPresentation?.execution || null,
        metrics: window.HDRFinisherPerformance.tiledExecutionMetrics(),
        contract: window.HDRFinisherPerformance.viewportRequest({ visible: viewport }),
        transport: window.__maskTransport,
      };
    }, { edge: longEdge, viewport: { x: 0, y: 0, width: 512, height: 512 } });
    const offscreenAfter = await clipBrightness(page, offscreenClip);

    const transport = outcome.transport;
    const batchTiles = transport.batch.map((entry) => entry.tiles);
    const summary = {
      url,
      execution: outcome.execution,
      rendered: outcome.rendered,
      refusals: outcome.refusals,
      legacy: {
        rendered: legacy.rendered,
        foregroundTiles: legacy.metrics?.foregroundTiles ?? null,
        skippedTiles: legacy.metrics?.skippedTiles ?? null,
        retainedFrame: legacy.metrics?.retainedFrame ?? null,
      },
      roi: {
        foregroundTiles: outcome.metrics?.foregroundTiles ?? null,
        skippedTiles: outcome.metrics?.skippedTiles ?? null,
        retainedFrame: outcome.metrics?.retainedFrame ?? null,
        offscreenBrightness: { before: offscreenBefore, after: offscreenAfter },
      },
      submissions: {
        legacy: legacy.metrics?.submissions ?? null,
        roi: outcome.metrics?.submissions ?? null,
        tileBatchSize: outcome.metrics?.tileBatchSize ?? null,
      },
      batchRequests: transport.batch.length,
      perTileRequests: transport.perTile.length,
      batchTiles,
      maxTilesInBatch: batchTiles.length ? Math.max(...batchTiles) : 0,
      totalTilesRequested: batchTiles.reduce((sum, value) => sum + Math.max(0, value), 0),
      batchStatuses: transport.batch.map((entry) => entry.status),
      pageErrors,
      viewport: outcome.metrics?.viewport || null,
      offscreenTiles: outcome.metrics?.offscreenTiles ?? null,
      processedPixels: outcome.metrics?.processedPixels ?? null,
      outputPixels: outcome.metrics?.outputPixels ?? null,
      contract: outcome.contract
        ? {
            roi: { ...outcome.contract.roi },
            sourceRect: { ...outcome.contract.sourceRect },
            tileCount: outcome.contract.tiles.length,
            telemetry: { ...outcome.contract.telemetry },
          }
        : null,
      tiledMetrics: outcome.metrics
        ? {
            tileCount: outcome.metrics.tileCount ?? null,
            visibleCount: outcome.metrics.visibleCount ?? null,
            batchCount: outcome.metrics.batchCount ?? null,
            passes: outcome.metrics.passes ?? null,
          }
        : null,
    };

    assert(pageErrors.length === 0, `Page errors were raised: ${JSON.stringify(pageErrors)}`);
    assert(outcome.rendered, `The tiled render did not complete: ${JSON.stringify(outcome.refusals)}`);
    assert(
      transport.perTile.length === 0,
      `The per-tile route is still in use: ${transport.perTile.length} requests`,
    );
    assert(
      transport.batch.length >= 1,
      "No batched mask request was issued for a tiled render with an active local",
    );
    assert(
      transport.batch.every((entry) => entry.status === 200),
      `A batched mask request failed: ${JSON.stringify(transport.batch)}`,
    );
    assert(
      batchTiles.every((tiles) => tiles >= 1 && tiles <= TILE_BATCH_CAP),
      `A batch carried an invalid tile count: ${JSON.stringify(batchTiles)}`,
    );
    assert(
      summary.maxTilesInBatch > 1,
      "Every batch carried a single tile, so batching was not demonstrated",
    );
    assert(
      outcome.metrics?.viewport
        && outcome.metrics.viewport.x === 0
        && outcome.metrics.viewport.width === 512,
      `The scheduler did not receive the viewport request: ${JSON.stringify(outcome.metrics?.viewport)}`,
    );
    assert(
      outcome.metrics.offscreenTiles > 0,
      "A magnified viewport still reported every tile as visible",
    );
    assert(
      outcome.metrics.processedPixels > 0 && outcome.metrics.outputPixels > 0,
      `Processed/output pixel telemetry is missing: ${JSON.stringify(outcome.metrics)}`,
    );
    assert(
      outcome.contract?.roi && outcome.contract.roi.width > 512,
      `The viewport contract did not pad the ROI: ${JSON.stringify(outcome.contract?.roi)}`,
    );
    // The legacy pass processes everything and retains nothing; the ROI pass
    // keeps the retained frame and processes only the tiles intersecting the
    // viewport, which is the "offscreen tiles are not part of the foreground
    // batch" gate.
    assert(
      legacy.metrics?.retainedFrame === false && legacy.metrics?.skippedTiles === 0,
      `The legacy pass was not a full-frame pass: ${JSON.stringify(legacy.metrics)}`,
    );
    assert(
      legacy.metrics?.foregroundTiles === legacy.metrics?.tileCount,
      `The legacy pass did not process every tile: ${JSON.stringify(legacy.metrics)}`,
    );
    assert(
      outcome.metrics?.retainedFrame === true,
      `The ROI pass did not retain the accepted frame: ${JSON.stringify(outcome.metrics)}`,
    );
    assert(
      outcome.metrics.foregroundTiles > 0
        && outcome.metrics.foregroundTiles < outcome.metrics.tileCount,
      `The ROI pass did not restrict the foreground batch: ${JSON.stringify(outcome.metrics)}`,
    );
    assert(
      outcome.metrics.skippedTiles > 0,
      `Offscreen tiles were still part of the foreground batch: ${JSON.stringify(outcome.metrics)}`,
    );
    // Small-batch submission: a six-tile pass is not one giant submit, and the
    // ROI pass still submits in batches rather than per tile.
    assert(
      legacy.metrics?.submissions >= 2 && outcome.metrics?.submissions >= 2,
      `Small-batch submission was not used: ${JSON.stringify({
        legacy: legacy.metrics?.submissions,
        roi: outcome.metrics?.submissions,
      })}`,
    );
    assert(
      outcome.metrics.tileBatchSize >= 1,
      `The tile batch size was not reported: ${JSON.stringify(outcome.metrics)}`,
    );
    // The offscreen region stays painted and materially unchanged: a pass that
    // cleared the canvas or presented a partial frame would show it.
    assert(
      offscreenAfter > 4,
      `The ROI pass left the offscreen region blank: brightness ${offscreenAfter}`,
    );
    assert(
      Math.abs(offscreenAfter - offscreenBefore) < 12,
      `The ROI pass changed the offscreen region: ${offscreenBefore} -> ${offscreenAfter}`,
    );

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
