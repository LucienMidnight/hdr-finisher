// Phase 6 exit gates 1-3 on the GPU:
//
//   1. tile seams, wavelet alignment, odd dimensions and image edges;
//   2. a live-control change issues no analysis dispatch;
//   3. an analysis cannot replace a valid Denoise result until it completes.
//
// The reference for gate 1 is the renderer itself with a denoise tile larger
// than the image, which is one tile and therefore exactly the whole-image
// decomposition Phase 5 shipped. Comparing against that isolates tiling from
// every other variable: same device, same shaders, same proxy, same settings.
//
//   node tests/denoise-tiled-parity.js --url http://127.0.0.1:8000
//     [--input <file>] [--tile-sizes 64,192,256,320] [--levels 1,2,3,4]

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
  const input = argument("--input", null);
  // 192 and 320 do not divide the proxy, so the last tile in each row and
  // column is partial -- the case an aligned grid has to get right at an edge.
  const tileSizes = (argument("--tile-sizes", "64,192,256,320") || "").split(",").map(Number).filter(Boolean);
  const levelsList = (argument("--levels", "1,2,3,4") || "").split(",").map(Number).filter(Boolean);

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    if (input) {
      const resolved = path.resolve(input);
      if (!fs.existsSync(resolved)) throw new Error(`Input does not exist: ${resolved}`);
      await page.setInputFiles("#file-input", resolved);
    } else {
      await page.getByRole("button", { name: "Load test pattern" }).click();
    }
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 600000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 180000 });

    await page.evaluate(() => {
      window.__denoise = {
        // One analysis run at a chosen tile size, followed by a full readback
        // of the resolved texture.
        run: async (levels, tileSize, controls, longEdge = null) => {
          const preview = state.gpuPreview;
          preview.denoiseTileSize = tileSize;
          const ok = await preview.analyzeDenoiseProxy(
            state.session.session_id,
            "hdr",
            JSON.parse(JSON.stringify(state.adjustments)),
            longEdge || previewTargetLongEdge(),
            state.editRevision,
            { levels, noiseThreshold: 3.0, lumaSigma: 0.035, chromaSigma: 0.035 },
            "source",
            controls,
          );
          if (!ok) return null;
          const resolved = preview.denoiseSourceSelector.resolved;
          const region = await preview.readDenoiseResolvedRegion(resolved.width, resolved.height, 0, 0);
          return { width: region.width, height: region.height, values: new Float32Array(region.values) };
        },
        compare: (a, b) => {
          if (a.width !== b.width || a.height !== b.height) return { error: "size mismatch" };
          let maxDelta = 0;
          let differing = 0;
          let worst = null;
          for (let index = 0; index < a.values.length; index += 1) {
            const delta = Math.abs(a.values[index] - b.values[index]);
            if (delta > 0) differing += 1;
            if (delta > maxDelta) {
              maxDelta = delta;
              const pixel = Math.floor(index / 4);
              worst = { x: pixel % a.width, y: Math.floor(pixel / a.width), channel: index % 4, a: a.values[index], b: b.values[index] };
            }
          }
          return { samples: a.values.length, differing, maxDelta, worst };
        },
      };
    });

    const source = await page.evaluate(() => {
      const proxy = state.gpuPreview.denoiseSourceSelector?.original;
      return { longEdge: previewTargetLongEdge(), width: proxy?.width ?? null, height: proxy?.height ?? null };
    });

    const CONTROLS = { amount: 0.8, luminance: 0.7, colorNoise: 0.6, detailRecovery: 0.3 };
    const failures = [];
    console.log(`denoise source: preview long edge ${source.longEdge}`);

    // `longEdge` 1023 asks the backend for an odd proxy, so both the source
    // dimensions and every band extent below them are odd. That is where edge
    // padding, partial trailing tiles and the absorbed short span all meet, and
    // it is the case a grid-aligned tiling is most likely to get wrong.
    const sourceCases = [
      { label: "even", longEdge: null },
      { label: "odd", longEdge: 1023 },
    ];

    for (const sourceCase of sourceCases) {
      for (const levels of levelsList) {
        // The whole-image reference: a tile bigger than the image is one tile.
        const reference = await page.evaluate(
          ({ levels, controls, longEdge }) => window.__denoise.run(levels, 16384, controls, longEdge).then((r) => {
            window.__reference = r;
            return r ? { width: r.width, height: r.height } : null;
          }),
          { levels, controls: CONTROLS, longEdge: sourceCase.longEdge },
        );
        if (!reference) throw new Error(`${sourceCase.label} levels ${levels}: the whole-image reference refused`);

        for (const tileSize of tileSizes) {
          const comparison = await page.evaluate(
            async ({ levels, tileSize, controls, longEdge }) => {
              const tiled = await window.__denoise.run(levels, tileSize, controls, longEdge);
              if (!tiled) return { error: "tiled analysis refused" };
              const result = window.__denoise.compare(window.__reference, tiled);
              const cache = state.gpuPreview.denoiseSourceSelector.cache;
              return { ...result, tiles: cache.tiles.length, alignedTile: cache.tileSize };
            },
            { levels, tileSize, controls: CONTROLS, longEdge: sourceCase.longEdge },
          );
          if (comparison.error) throw new Error(`${sourceCase.label} levels ${levels} tile ${tileSize}: ${comparison.error}`);
          const passed = comparison.differing === 0;
          if (!passed) failures.push({ source: sourceCase.label, levels, tileSize, ...comparison });
          console.log(
            `${sourceCase.label.padEnd(4)} ${reference.width}x${reference.height}  levels ${levels}  `
            + `tile ${String(tileSize).padStart(5)} -> aligned ${String(comparison.alignedTile).padStart(5)}  `
            + `tiles ${String(comparison.tiles).padStart(4)}  differing ${comparison.differing}/${comparison.samples}  `
            + `maxDelta ${comparison.maxDelta}  ${passed ? "PASS" : "FAIL"}`,
          );
          if (!passed) console.log(`   worst: ${JSON.stringify(comparison.worst)}`);
        }
      }
    }
    if (failures.length) {
      throw new Error(`Tiled denoise does not match the whole-image decomposition: ${JSON.stringify(failures, null, 2)}`);
    }
    console.log("wavelet alignment, tile seams and image edges: PASS");

    // Gate 2. A live control is not an analysis setting, so dragging one must
    // leave the analysis dispatch counter exactly where it was.
    const live = await page.evaluate(async () => {
      const preview = state.gpuPreview;
      const before = { ...preview.denoiseCounters };
      const drags = [
        { amount: 0.1, luminance: 0.9, colorNoise: 0.2, detailRecovery: 0.8 },
        { amount: 0.95, luminance: 0.15, colorNoise: 0.75, detailRecovery: 0.05 },
        { amount: 0.5, luminance: 0.5, colorNoise: 0.5, detailRecovery: 0.5 },
        { amount: 0.33, luminance: 0.66, colorNoise: 0.99, detailRecovery: 0.01 },
      ];
      for (const controls of drags) {
        if (!await preview.resolveDenoiseProxy(controls)) return { error: "a live reconstruction refused" };
      }
      const after = { ...preview.denoiseCounters };
      return {
        drags: drags.length,
        analysisCallsDelta: after.analysisCalls - before.analysisCalls,
        analysisDispatchesDelta: after.analysisDispatches - before.analysisDispatches,
        resolveCallsDelta: after.resolveCalls - before.resolveCalls,
        resolveDispatchesDelta: after.resolveDispatches - before.resolveDispatches,
      };
    });
    if (live.error) throw new Error(live.error);
    if (live.analysisDispatchesDelta !== 0 || live.analysisCallsDelta !== 0) {
      throw new Error(`A live control ran analysis: ${JSON.stringify(live)}`);
    }
    if (live.resolveCallsDelta !== live.drags || live.resolveDispatchesDelta <= 0) {
      throw new Error(`Live reconstruction did not actually run: ${JSON.stringify(live)}`);
    }
    console.log(
      `live controls: ${live.drags} drags -> ${live.analysisDispatchesDelta} analysis dispatches, `
      + `${live.resolveDispatchesDelta} reconstruction dispatches  PASS`,
    );

    // Zoom and pan: reconstruct part of the frame from evidence that is
    // already resident. The region must carry the new controls, everything
    // outside it must be untouched, and no analysis may run.
    const zoom = await page.evaluate(async () => {
      const preview = state.gpuPreview;
      const resolved = preview.denoiseSourceSelector.resolved;
      const readAll = async () => {
        const region = await preview.readDenoiseResolvedRegion(resolved.width, resolved.height, 0, 0);
        return new Float32Array(region.values);
      };
      const A = { amount: 0.2, luminance: 0.3, colorNoise: 0.4, detailRecovery: 0.5 };
      const B = { amount: 0.9, luminance: 0.8, colorNoise: 0.7, detailRecovery: 0.1 };

      await preview.resolveDenoiseProxy(B);
      const allB = await readAll();
      await preview.resolveDenoiseProxy(A);
      const allA = await readAll();

      const alignment = 2 ** preview.denoiseSourceSelector.cache.settings.levels;
      const region = {
        x: Math.floor(resolved.width / 4 / alignment) * alignment,
        y: Math.floor(resolved.height / 4 / alignment) * alignment,
        width: Math.floor(resolved.width / 3),
        height: Math.floor(resolved.height / 3),
      };
      const before = { ...preview.denoiseCounters };
      if (!await preview.resolveDenoiseProxy(B, { region })) return { error: "region reconstruction refused" };
      const after = { ...preview.denoiseCounters };
      const mixed = await readAll();
      // A request is honoured at tile granularity, so the rectangle actually
      // rewritten is the union of the tiles it touched. The renderer reports
      // that, and it is what confinement has to be measured against.
      const rebuilt = preview.denoiseSourceSelector.resolvedRegion;

      const covers = rebuilt.x <= region.x && rebuilt.y <= region.y
        && rebuilt.x + rebuilt.width >= region.x + region.width
        && rebuilt.y + rebuilt.height >= region.y + region.height;
      let insideWrong = 0;
      let outsideWrong = 0;
      for (let y = 0; y < resolved.height; y += 1) {
        for (let x = 0; x < resolved.width; x += 1) {
          const base = (y * resolved.width + x) * 4;
          const inside = x >= rebuilt.x && x < rebuilt.x + rebuilt.width
            && y >= rebuilt.y && y < rebuilt.y + rebuilt.height;
          for (let channel = 0; channel < 3; channel += 1) {
            const value = mixed[base + channel];
            if (inside) {
              if (value !== allB[base + channel]) insideWrong += 1;
            } else if (value !== allA[base + channel]) outsideWrong += 1;
          }
        }
      }
      return {
        region,
        rebuilt,
        covers,
        rebuiltFraction: (rebuilt.width * rebuilt.height) / (resolved.width * resolved.height),
        insideWrong,
        outsideWrong,
        analysisDispatchesDelta: after.analysisDispatches - before.analysisDispatches,
        tilesTouched: after.resolveTiles - before.resolveTiles,
        totalTiles: preview.denoiseSourceSelector.cache.tiles.length,
      };
    });
    if (zoom.error) throw new Error(zoom.error);
    if (zoom.insideWrong || zoom.outsideWrong || zoom.analysisDispatchesDelta !== 0) {
      throw new Error(`Region reconstruction was not confined or ran analysis: ${JSON.stringify(zoom)}`);
    }
    if (!zoom.covers) {
      throw new Error(`The rebuilt rectangle does not cover what was asked for: ${JSON.stringify(zoom)}`);
    }
    if (!(zoom.tilesTouched > 0 && zoom.tilesTouched < zoom.totalTiles) || zoom.rebuiltFraction >= 1) {
      throw new Error(`A region reconstruction should touch some but not all tiles: ${JSON.stringify(zoom)}`);
    }
    console.log(
      `zoom/pan: ${zoom.region.width}x${zoom.region.height} request rebuilt as `
      + `${zoom.rebuilt.width}x${zoom.rebuilt.height} (${(zoom.rebuiltFraction * 100).toFixed(1)}% of the frame) from `
      + `cached evidence using ${zoom.tilesTouched}/${zoom.totalTiles} tiles, `
      + `${zoom.analysisDispatchesDelta} analysis dispatches  PASS`,
    );

    // Gate 3. A superseded analysis must not replace a valid result. Bumping
    // the selector generation mid-flight is exactly what a newer request does.
    const atomic = await page.evaluate(async () => {
      const preview = state.gpuPreview;
      const before = preview.denoiseSourceSelector;
      const beforeSelected = before.selected;
      const beforeIdentity = before.cache.identity;
      const inFlight = preview.analyzeDenoiseProxy(
        state.session.session_id, "hdr", JSON.parse(JSON.stringify(state.adjustments)),
        previewTargetLongEdge(), state.editRevision,
        { levels: 3, noiseThreshold: 9.0, lumaSigma: 0.09, chromaSigma: 0.09 }, "source",
        { amount: 0.5, luminance: 0.5, colorNoise: 0.5, detailRecovery: 0.5 },
      );
      // Supersede it before it can install anything.
      preview.denoiseSelectorGeneration += 1;
      const accepted = await inFlight;
      const after = preview.denoiseSourceSelector;
      return {
        accepted,
        selectorUnchanged: after === before,
        selectedUnchanged: after.selected === beforeSelected,
        identityUnchanged: after.cache.identity === beforeIdentity,
        stillResolved: Boolean(after.resolved),
      };
    });
    if (atomic.accepted !== false || !atomic.selectorUnchanged || !atomic.selectedUnchanged
      || !atomic.identityUnchanged || !atomic.stillResolved) {
      throw new Error(`A superseded analysis disturbed the presented result: ${JSON.stringify(atomic)}`);
    }
    console.log("superseded analysis leaves the previous valid result in place  PASS");

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Tiled denoise analysis and reconstruction match the whole-image decomposition.");
  } finally {
    await browser.close();
  }
})();
