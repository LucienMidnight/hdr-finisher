// Phase 6 exit gate 4: two- and four-level 24 MP, 42 MP and 8K memory traces
// remain within budget.
//
// Denoise holds three very different kinds of memory and the gate is only
// meaningful if they are reported apart:
//
//   evidence   persistent, and the reason a slider does not re-analyse;
//   scratch    transient, the low-band chain analysis walks down;
//   resolved   the reconstructed image the grade reads.
//
// Before Phase 6 the scratch was a whole-image chain held all at once. Tiling
// it is the point of this measurement, so the trace prints scratch next to
// evidence rather than folding both into one total.
//
//   node tests/performance/denoise-memory-trace.js --url http://127.0.0.1:8000 \
//     --inputs <file>,<file>,<file> [--levels 2,4] [--budget-gib 2]

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
  const inputs = (argument("--inputs", "") || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const levelsList = (argument("--levels", "2,4") || "").split(",").map(Number).filter(Boolean);
  const budgetGiB = Number(argument("--budget-gib", "2"));
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
      for (const levels of levelsList) {
        const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        try {
          // Seed the stored preference: a later preference sync re-applies it,
          // so a transiently-set budget does not survive the run.
          await page.addInitScript(([key, gib]) => {
            try {
              const existing = JSON.parse(window.localStorage.getItem(key) || "{}");
              existing.maximumGpuMemoryGiB = gib;
              window.localStorage.setItem(key, JSON.stringify(existing));
            } catch { /* a blocked store just leaves the budget on auto */ }
          }, ["hdr-finisher:application-preferences:v1", budgetGiB]);

          const pageUrl = new URL(url);
          await page.goto(pageUrl.toString(), { waitUntil: "networkidle" });
          await page.setInputFiles("#file-input", resolved);
          await page.waitForFunction(() => state.session?.session_id, null, { timeout: 1_800_000 });
          await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
          await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 600000 });

          await page.locator("#preview-resolution").evaluate((select) => {
            select.value = "full";
            select.dispatchEvent(new Event("change", { bubbles: true }));
          });
          await page.waitForFunction(() => state.acceptedPresentation?.requestedTier === "full"
            && viewerState().status === "ready", null, { timeout: 1_800_000 });
          await page.evaluate(async () => {
            if (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => false);
            state.previewScheduler?.cancel();
          });

          const measurement = await page.evaluate(async (levels) => {
            const preview = state.gpuPreview;
            const longEdge = previewTargetLongEdge();
            const ok = await preview.analyzeDenoiseProxy(
              state.session.session_id, "hdr", JSON.parse(JSON.stringify(state.adjustments)),
              longEdge, state.editRevision,
              { levels, noiseThreshold: 3.0, lumaSigma: 0.035, chromaSigma: 0.035 }, "source",
              { amount: 0.6, luminance: 0.6, colorNoise: 0.6, detailRecovery: 0.4 },
            );
            if (!ok) return { error: "analysis refused" };
            // A live drag, to show reconstruction adds no persistent memory.
            await preview.resolveDenoiseProxy({ amount: 0.9, luminance: 0.4, colorNoise: 0.8, detailRecovery: 0.2 });

            const diagnostics = preview.diagnosticsSnapshot();
            const memory = diagnostics.resources?.memory || {};
            const cache = preview.denoiseSourceSelector.cache;
            const counters = preview.denoiseCounters;
            return {
              sourceWidth: state.session.source.width,
              sourceHeight: state.session.source.height,
              proxyWidth: preview.denoiseSourceSelector.original.width,
              proxyHeight: preview.denoiseSourceSelector.original.height,
              tiles: cache.tiles.length,
              alignedTile: cache.tileSize,
              evidenceBytes: memory.resident?.categories?.denoiseEvidenceBytes ?? 0,
              resolvedBytes: memory.resident?.categories?.denoiseResolvedBytes ?? 0,
              reconstructionScratchBytes: memory.resident?.categories?.denoiseReconstructionScratchBytes ?? 0,
              analysisScratchBytes: counters.analysisScratchBytes,
              proxyBytes: memory.resident?.categories?.sourceProxyBytes ?? 0,
              peakLogicalBytes: memory.peakLogicalBytes ?? 0,
              budgetBytes: preview.memoryBudgetBytes(),
            };
          }, levels);
          if (measurement.error) throw new Error(`${input} levels ${levels}: ${measurement.error}`);
          if (pageErrors.length) throw new Error(`${input}: browser errors: ${pageErrors.join(" | ")}`);
          rows.push({ input: path.basename(input), levels, ...measurement });
        } finally {
          await page.close();
        }
      }
    }

    console.log(`\nDenoise memory trace at native resolution, GPU budget ${budgetGiB} GiB\n`);
    console.log(
      "source".padEnd(30) + "lv".padStart(4) + "proxy".padStart(12) + "MP".padStart(7)
      + "tiles".padStart(7) + "evidence".padStart(12) + "resolved".padStart(12)
      + "an.scratch".padStart(12) + "re.scratch".padStart(12) + "peak".padStart(11) + "budget".padStart(11),
    );
    const failures = [];
    for (const row of rows) {
      const megapixels = (row.proxyWidth * row.proxyHeight) / 1e6;
      console.log(
        row.input.slice(0, 29).padEnd(30)
        + String(row.levels).padStart(4)
        + `${row.proxyWidth}x${row.proxyHeight}`.padStart(12)
        + megapixels.toFixed(1).padStart(7)
        + String(row.tiles).padStart(7)
        + MB(row.evidenceBytes).padStart(12)
        + MB(row.resolvedBytes).padStart(12)
        + MB(row.analysisScratchBytes).padStart(12)
        + MB(row.reconstructionScratchBytes).padStart(12)
        + MB(row.peakLogicalBytes).padStart(11)
        + MB(row.budgetBytes).padStart(11),
      );
      if (row.peakLogicalBytes > row.budgetBytes) {
        failures.push(`${row.input} at ${row.levels} levels: peak ${MB(row.peakLogicalBytes)} exceeds ${MB(row.budgetBytes)}`);
      }
      // The property tiling exists for: analysis scratch must follow the tile,
      // not the image. A whole-image two-level chain at 24 MP would be ~60 MB.
      if (row.analysisScratchBytes > 16e6) {
        failures.push(`${row.input} at ${row.levels} levels: analysis scratch ${MB(row.analysisScratchBytes)} is following the image`);
      }
    }

    const scratches = rows.map((row) => row.analysisScratchBytes);
    console.log(
      `\nanalysis scratch across ${rows.length} traces: ${MB(Math.min(...scratches))} to ${MB(Math.max(...scratches))} `
      + `— bounded by the ${rows[0].alignedTile}px denoise tile, not by the source`,
    );
    if (Math.max(...scratches) - Math.min(...scratches) > 1e6) {
      failures.push("analysis scratch varies with the source; it should depend only on the tile");
    }

    if (failures.length) throw new Error(`Denoise memory trace failed:\n  - ${failures.join("\n  - ")}`);
    console.log("\nTwo- and four-level traces stay within budget at every measured size.");
  } finally {
    await browser.close();
  }
})();
