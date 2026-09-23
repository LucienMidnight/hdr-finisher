/**
 * Phase 7 — vignette and grain on the tiled path.
 *
 * Both modules are pointwise, but neither is tile-local: a vignette is placed
 * against the frame, and grain is a fixed noise field over the frame. Before
 * Phase 7 the shader derived both from `textureDimensions(sourceTexture)` and a
 * tile-local coordinate, so a tile would have drawn its own small vignette and
 * restarted the grain field at every tile origin. The scheduler refused them
 * rather than render that.
 *
 * This proves the refusal is no longer needed:
 *
 *   1. Direct/Tiled parity with a strong off-centre vignette and visible grain,
 *      at two tile sizes.
 *   2. Grain is identical across tile size -- the same picture whatever the
 *      tiling, which is what "deterministic" has to mean here. A field keyed on
 *      tile-local coordinates would pass parity at neither size.
 *   3. The grain view map, which replaces the picture with a grey card and
 *      isolates the grain field, so tile-origin drift has nothing to hide
 *      behind.
 *
 * Usage: node tests/tiled-film-parity.js --url http://127.0.0.1:8000
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

// Byte-exact. These modules are pointwise, so unlike a haloed neighbourhood
// filter there is no resampling that could justify a one-count difference.
const MAX_CHANNEL_DELTA = 0;

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
  const input = argument("--input", null);
  const tileSizes = (argument("--tile-sizes", "256,512") || "").split(",").map(Number).filter(Boolean);

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const results = [];

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

    // A non-neutral grade underneath, so parity is tested on real tone mapping
    // rather than on an identity transform that anything would match. The
    // vignette is deliberately off-centre: a centred one is symmetric about the
    // frame, and a tile-local placement could still average out to something
    // close. Off-centre, a wrong origin is a visible shift.
    const configure = async (overrides = {}) => page.evaluate((extra) => {
      state.adjustments.hdr.exposure = 0.85;
      state.adjustments.hdr.contrast = 18;
      state.adjustments.hdr.saturation = 12;
      Object.assign(state.adjustments.hdr.vignette, {
        amount: -55, midpoint: 38, roundness: 30, feather: 60,
        highlight_protection: 25, center_x: 0.33, center_y: 0.61,
      });
      Object.assign(state.adjustments.hdr.film_look, {
        grain_amount: 65, grain_size: 45, grain_softness: 30, grain_chroma: 35,
        grain_shadow_response: 110, grain_midtone_response: 100, grain_highlight_response: 70,
        halation_amount: 0, bloom_amount: 0,
      }, extra);
    }, overrides);

    const capture = async () => {
      await page.waitForTimeout(250);
      return (await page.locator("#preview-canvas").screenshot()).toString("base64");
    };

    const compare = async (a, b) => page.evaluate(async ({ left, right }) => {
      const decode = async (base64) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const surface = document.createElement("canvas");
        surface.width = bitmap.width;
        surface.height = bitmap.height;
        const context = surface.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const first = await decode(left);
      const second = await decode(right);
      if (first.width !== second.width || first.height !== second.height) return { error: "captured sizes differ" };
      let differing = 0;
      let maxDelta = 0;
      for (let index = 0; index < first.data.length; index += 4) {
        let delta = 0;
        for (let channel = 0; channel < 3; channel += 1) {
          delta = Math.max(delta, Math.abs(first.data[index + channel] - second.data[index + channel]));
        }
        if (delta > maxDelta) maxDelta = delta;
        if (delta > 0) differing += 1;
      }
      return { width: first.width, height: first.height, samples: first.data.length / 4, differing, maxDelta };
    }, { left: a, right: b });

    const renderDirect = async () => {
      const staged = await page.evaluate(async () => {
        const rendered = await window.HDRFinisherPerformance.renderGpuTier(previewTargetLongEdge());
        if (!rendered) return { error: "direct render failed", lastRefusal: state.lastGpuDraftRefusal || null };
        if (state.acceptedPresentation?.execution !== "direct") {
          return { error: `planner selected ${state.acceptedPresentation?.execution || "unknown"}, not direct` };
        }
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        return { ok: true };
      });
      if (staged.error) throw new Error(JSON.stringify(staged));
      return capture();
    };

    const renderTiled = async (tileSize) => {
      const staged = await page.evaluate(async (size) => {
        const result = await window.HDRFinisherPerformance.renderTiledTier(previewTargetLongEdge(), { tileSize: size });
        if (!result?.rendered) return { error: `tiled render refused: ${(result?.refusals || []).join(", ")}` };
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        return { metrics: result.metrics };
      }, tileSize);
      if (staged.error) throw new Error(`tileSize ${tileSize}: ${JSON.stringify(staged)}`);
      return { shot: await capture(), metrics: staged.metrics };
    };

    const parityPass = async (label, tileSize) => {
      const directShot = await renderDirect();
      const { shot: tiledShot, metrics } = await renderTiled(tileSize);
      const comparison = await compare(directShot, tiledShot);
      if (comparison.error) throw new Error(`${label} tileSize ${tileSize}: ${comparison.error}`);
      const passed = comparison.maxDelta <= MAX_CHANNEL_DELTA;
      results.push({ label, tileSize, ...comparison, passed, metrics, tiledShot });
      console.log(
        `${label.padEnd(16)} tileSize ${String(tileSize).padStart(4)}  ${comparison.width}x${comparison.height}  `
        + `tiles ${String(metrics.tileCount).padStart(4)}  halo ${String(metrics.halo).padStart(4)}  `
        + `work ${metrics.tileWidth ?? "?"}x${metrics.tileHeight ?? "?"}  submissions ${metrics.submissions}  `
        + `maxDelta ${comparison.maxDelta}  differing ${comparison.differing}/${comparison.samples}  `
        + `${passed ? "PASS" : "FAIL"}`,
      );
      return results[results.length - 1];
    };

    // 1 and 2 -- parity with the picture present.
    await configure();
    for (const tileSize of tileSizes) await parityPass("vignette+grain", tileSize);

    // 4 -- the spatial film effects. Halation and bloom are separable blurs on
    // the quarter-resolution grid, so this is where a tile whose grid is offset
    // from the frame's, or whose halo is short, shows a seam at every boundary.
    await configure({ halation_amount: 70, halation_radius: 1.2, halation_sensitivity: 60,
      bloom_amount: 55, bloom_radius: 3.0, image_structure_enabled: true,
      image_softness: 25, microcontrast: 30, film_resolution: 82 });
    for (const tileSize of tileSizes) await parityPass("spatial", tileSize);

    // 5 -- the same at the largest radii either effect can be asked for, where
    // the halo is at its 64-texel cap and largest relative to the tile.
    await configure({ halation_amount: 100, halation_radius: 5.0, halation_sensitivity: 100,
      bloom_amount: 100, bloom_radius: 10.0, image_structure_enabled: true,
      image_softness: 100, microcontrast: 100, film_resolution: 0 });
    for (const tileSize of tileSizes) await parityPass("spatial-max", tileSize);

    // 6 -- the halation view map, which replaces the picture with the halo
    // field alone, so a seam in it has nothing to hide behind.
    await configure({ halation_amount: 70, halation_radius: 1.2, halation_view_map: true,
      bloom_amount: 0, image_structure_enabled: false, film_resolution: 100 });
    for (const tileSize of tileSizes) await parityPass("halation-view-map", tileSize);
    await configure({ halation_amount: 0, halation_view_map: false, bloom_amount: 0,
      image_structure_enabled: false, film_resolution: 100 });

    // 3 -- the grain view map: a neutral grey card carrying the grain field and
    // nothing else. Any tile-origin drift in the noise is the whole signal here.
    await configure({ grain_view_map: true });
    for (const tileSize of tileSizes) await parityPass("grain-view-map", tileSize);
    await configure({ grain_view_map: false });

    // Grain determinism across tiling: two tile sizes divide the frame along
    // different boundaries, so a field that restarted per tile could not agree
    // with itself between them.
    for (const label of ["vignette+grain", "grain-view-map"]) {
      const runs = results.filter((entry) => entry.label === label);
      if (runs.length < 2) continue;
      const across = await compare(runs[0].tiledShot, runs[1].tiledShot);
      const passed = across.maxDelta === 0;
      console.log(
        `${label.padEnd(16)} tile ${runs[0].tileSize} vs ${runs[1].tileSize}  `
        + `maxDelta ${across.maxDelta}  differing ${across.differing}/${across.samples}  ${passed ? "PASS" : "FAIL"}`,
      );
      if (!passed) {
        throw new Error(`${label} is not identical across tile sizes: ${JSON.stringify(across)}`);
      }
    }

    // Tiles submit in bounded batches; a final copy presents the assembled
    // offscreen target. Submission count therefore grows with tile count.
    if (!results.every((entry) => entry.metrics.submissions
      === Math.ceil(entry.metrics.foregroundTiles / entry.metrics.tileBatchSize) + 1)) {
      throw new Error("A tiled generation did not use bounded tile batches and one presentation copy");
    }
    console.log("bounded tile batches plus one presentation copy  PASS");

    const failures = results.filter((entry) => !entry.passed);
    if (failures.length) {
      throw new Error(`Vignette/grain parity failed: ${JSON.stringify(failures.map((entry) => ({
        label: entry.label, tileSize: entry.tileSize, maxDelta: entry.maxDelta, differing: entry.differing,
      })))}`);
    }
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Vignette and grain are frame-placed and byte-exact on the tiled path.");
  } finally {
    await browser.close();
  }
})();
