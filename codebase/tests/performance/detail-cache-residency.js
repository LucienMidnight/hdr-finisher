// Phase 5 exit gate 3: Detail peak residency remains bounded at 24 MP, 42 MP
// and 8K.
//
// Phase 4 replaced its modelled residency figures with measurements, and this
// does the same for what Phase 5 adds: the packed Detail band cache and the
// mask tile cache. Both are caches rather than fixed intermediates, so the
// question is not how big one tile is but whether the LRU bounds actually hold
// once every tile of a real full-resolution frame has been through them.
//
// Each source is rendered at its native resolution through the engineering Full
// gate, tiled, with global Detail and a local that carries its own Detail, so
// both band scopes and the mask tile path are live. The numbers come from the
// renderer's own live diagnostics, not from the planner's model.
//
//   node tests/performance/detail-cache-residency.js --url http://127.0.0.1:8000 \
//     --inputs <file>,<file>,<file> [--tile-size 512]

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const MB = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
  const tileSize = Number(argument("--tile-size", "512"));
  // Low enough that the planner refuses Direct at every measured size, so the
  // whole session runs on the route under test.
  const budgetGiB = Number(argument("--budget-gib", "1"));
  const inputs = (argument("--inputs", "") || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!inputs.length) throw new Error("--inputs is required: a comma-separated list of source files");

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });

  const rows = [];
  try {
    for (const input of inputs) {
      const resolved = path.resolve(input);
      if (!fs.existsSync(resolved)) throw new Error(`Input does not exist: ${resolved}`);

      // A fresh page per source, so no previous source's caches survive into
      // the measurement.
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      // Seed the stored preference rather than calling applyGpuMemoryBudget
      // after load. The preference subscription re-applies
      // preferences.maximumGpuMemoryGiB on later syncs, which silently puts a
      // transiently-set budget back to auto part-way through the run.
      await page.addInitScript(([key, gib]) => {
        try {
          const existing = JSON.parse(window.localStorage.getItem(key) || "{}");
          existing.maximumGpuMemoryGiB = gib;
          window.localStorage.setItem(key, JSON.stringify(existing));
        } catch { /* a blocked store just leaves the budget on auto */ }
      }, ["hdr-finisher:application-preferences:v1", budgetGiB]);
      try {
        const pageUrl = new URL(url);
        await page.goto(pageUrl.toString(), { waitUntil: "networkidle" });
        await page.setInputFiles("#file-input", resolved);
        await page.waitForFunction(() => state.session?.session_id, null, { timeout: 1_800_000 });
        await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
        await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 600000 });

        // Constrain the budget BEFORE selecting Full. The planner then refuses
        // Direct for the first Full presentation, so the session is tiled from
        // the outset and no whole-frame grading intermediate is ever allocated.
        // Setting it afterwards would leave Direct's intermediates resident
        // underneath the tiled caches and measure a state production never has.
        const budgetBytes = await page.evaluate(() => state.gpuPreview.memoryBudgetBytes());
        if (Math.abs(budgetBytes - budgetGiB * 1024 ** 3) > 1024) {
          throw new Error(`The GPU budget did not take: wanted ${budgetGiB} GiB, renderer reports ${MB(budgetBytes)}`);
        }

        await page.locator("#preview-resolution").evaluate((select) => {
          select.value = "full";
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await page.waitForFunction(() => state.acceptedPresentation?.requestedTier === "full"
          && state.acceptedPresentation?.exact === true
          && viewerState().status === "ready", null, { timeout: 1_800_000 });

        const settle = async () => {
          await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 600000 });
          await page.evaluate(async () => {
            if (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => false);
            state.previewScheduler?.cancel();
          });
        };
        await settle();

        await page.evaluate(async () => {
          const brush = newLocalAdjustment("brush");
          brush.name = "Residency brush";
          brush.mask.leaf.strokes = [{
            points: [{ x: 0.15, y: 0.3 }, { x: 0.7, y: 0.65 }],
            radius: 0.16, hardness: 0.5, flow: 1, opacity: 1, erase: false,
          }];
          brush.mask.leaf.mask_feather = 0.02;
          brush.hdr_grade.exposure = 0.3;
          Object.assign(brush.hdr_grade.detail, {
            texture_amount: 35, clarity_amount: 30, clarity_radius_percent: 1.2,
            sharpen_amount: 45, sharpen_radius_px: 1.3, sharpen_threshold: 12,
          });
          if (!await queueEditCommand("create_local", { local: brush })) throw new Error("Could not create the local");
          await syncGlobalEditState();
        });
        await settle();

        // Global grade last: a create_local response replaces state.adjustments.
        await page.evaluate(() => {
          state.adjustments.hdr.exposure = 0.6;
          Object.assign(state.adjustments.hdr.detail, {
            texture_amount: 40, clarity_amount: -25, clarity_radius_percent: 1.4,
            sharpen_amount: 65, sharpen_radius_px: 1.3, sharpen_threshold: 15,
          });
        });

        const measurement = await page.evaluate(async (size) => {
          const longEdge = previewTargetLongEdge();
          // Two renders: the first fills every band and mask tile, the second
          // is the steady state the bounds have to hold in.
          // The ordinary render path, not the engineering tiled entry, so the
          // planner's own decision is what puts this on the tiled route.
          const first = await window.HDRFinisherPerformance.renderGpuTier(longEdge, { tileSize: size });
          if (!first) return { error: "first render refused", refusal: state.gpuPreview?.lastRenderRefusal || null };
          if (state.acceptedPresentation?.execution !== "tiled") {
            return { error: `planner chose ${state.acceptedPresentation?.execution}, not tiled` };
          }
          await state.gpuPreview.device.queue.onSubmittedWorkDone();
          const second = await window.HDRFinisherPerformance.renderGpuTier(longEdge, { tileSize: size });
          if (!second) return { error: "second render refused", refusal: state.gpuPreview?.lastRenderRefusal || null };
          if (state.acceptedPresentation?.execution !== "tiled") {
            return { error: `planner chose ${state.acceptedPresentation?.execution} on the second render, not tiled` };
          }
          await state.gpuPreview.device.queue.onSubmittedWorkDone();
          // The unpinned trim runs once the queue drains. Await it, or the
          // snapshot below catches the caches still holding the generation's
          // pinned tiles and reports a peak that never actually persists.
          await state.gpuPreview.pendingCacheTrim;
          const diagnostics = state.gpuPreview.diagnosticsSnapshot();
          return {
            sourceWidth: state.session.source.width,
            sourceHeight: state.session.source.height,
            first: first.metrics || state.gpuPreview.tiledExecutionMetrics,
            steady: second.metrics || state.gpuPreview.tiledExecutionMetrics,
            budgetBytes: state.gpuPreview.memoryBudgetBytes(),
            budgetSetting: diagnostics.budget?.setting ?? diagnostics.budget ?? null,
            residentBytes: diagnostics.resources?.memory?.resident?.totalBytes ?? null,
            cachedBytes: diagnostics.resources?.memory?.cached?.totalBytes ?? null,
            peakLogicalBytes: diagnostics.resources?.memory?.peakLogicalBytes ?? null,
            decision: diagnostics.plan?.decision?.mode ?? null,
          };
        }, tileSize);
        if (measurement.error) throw new Error(`${input}: ${JSON.stringify(measurement)}`);
        if (pageErrors.length) throw new Error(`${input}: browser errors: ${pageErrors.join(" | ")}`);

        const megapixels = (measurement.sourceWidth * measurement.sourceHeight) / 1e6;
        rows.push({ input: path.basename(input), megapixels, ...measurement });
      } finally {
        await page.close();
      }
    }

    console.log(`\nTiled Detail and mask cache residency, tile size ${tileSize}, native resolution via engineering Full\n`);
    console.log(
      "source".padEnd(34) + "MP".padStart(7) + "tiles".padStart(7) + "halo".padStart(6)
      + "stacks".padStart(8) + "band cache".padStart(13) + "mask cache".padStart(13)
      + "working set".padStart(13) + "proxy".padStart(11) + "peak".padStart(11) + "budget".padStart(11),
    );
    const failures = [];
    for (const row of rows) {
      const steady = row.steady;
      console.log(
        row.input.padEnd(34)
        + row.megapixels.toFixed(1).padStart(7)
        + String(steady.tileCount).padStart(7)
        + String(steady.halo).padStart(6)
        + String(steady.detailBandStacks).padStart(8)
        + MB(steady.detailCacheBytes).padStart(13)
        + MB(steady.maskCacheBytes).padStart(13)
        + MB(steady.workingSetBytes).padStart(13)
        + MB(steady.proxyBytes).padStart(11)
        + MB(row.peakLogicalBytes).padStart(11)
        + MB(row.budgetBytes).padStart(11),
      );

      // Assert the outcome the gate is about rather than re-deriving the
      // renderer's internal trim formula here, which would only prove the test
      // and the renderer share an expression. What has to hold is that the
      // caches leave the whole tiled render inside the budget the planner
      // admitted it against.
      const cacheBytes = steady.detailCacheBytes + steady.maskCacheBytes;
      if (cacheBytes > row.budgetBytes) {
        failures.push(`${row.input}: the tile caches alone hold ${MB(cacheBytes)} against a ${MB(row.budgetBytes)} budget`);
      }
      if (row.peakLogicalBytes > row.budgetBytes) {
        failures.push(`${row.input}: peak ${MB(row.peakLogicalBytes)} exceeds the ${MB(row.budgetBytes)} budget`);
      }
      if (steady.detailBandStacks !== 2) {
        failures.push(`${row.input}: expected global plus one local Detail stack, got ${steady.detailBandStacks}`);
      }
    }

    // Phase 4 could assert a *constant* tiled working set, because a tile was
    // exactly a tile. Phase 5's halo is derived from the image diagonal, since
    // that is where Detail's radii come from, so the work tile is
    // (tileSize + 2 * halo) and grows with the square root of the pixel count.
    // The invariant that survives is the one that matters: the working set is
    // bounded by tile geometry rather than by the image, so it stays small
    // while Direct's grading set grows without limit.
    console.log("");
    for (const row of rows) {
      const directGrading = row.sourceWidth * row.sourceHeight * 8 * 4;
      const share = row.steady.workingSetBytes / directGrading;
      console.log(
        `${row.input.padEnd(34)} working set ${MB(row.steady.workingSetBytes).padStart(10)} `
        + `against a Direct grading set of ${MB(directGrading).padStart(10)} - ${(share * 100).toFixed(2)}%`,
      );
      if (row.steady.workingSetBytes > 128e6) {
        failures.push(`${row.input}: tiled working set ${MB(row.steady.workingSetBytes)} exceeds the 128 MB cap`);
      }
      if (share > 0.10) {
        failures.push(`${row.input}: tiled working set is ${(share * 100).toFixed(1)}% of Direct's; tiling is not paying for itself`);
      }
    }
    // The bounded property the gate asks for: peak must not follow the image.
    const peaks = rows.map((row) => row.peakLogicalBytes);
    const peakSpread = Math.max(...peaks) - Math.min(...peaks);
    console.log(
      `
peak residency across ${rows.length} sources: ${MB(Math.min(...peaks))} to ${MB(Math.max(...peaks))} `
      + `(spread ${MB(peakSpread)}) against a ${MB(rows[0].budgetBytes)} budget`,
    );
    if (peakSpread > 0.15 * rows[0].budgetBytes) {
      failures.push(`peak residency varies by ${MB(peakSpread)} from 24 MP to 8K; it is still following the image`);
    }

    const workingSets = rows.map((row) => row.steady.workingSetBytes);
    console.log(
      `tiled working set across ${rows.length} sources: `
      + `${MB(Math.min(...workingSets))} to ${MB(Math.max(...workingSets))}, `
      + `driven by halos of ${rows.map((row) => row.steady.halo).join(", ")} px`,
    );

    if (failures.length) throw new Error(`Detail residency bounds failed:\n  - ${failures.join("\n  - ")}`);
    console.log("\nDetail and mask cache residency stay bounded at every measured size.");
  } finally {
    await browser.close();
  }
})();
