const { importTestPattern } = require("./helpers/import-test-pattern");
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
const { installFilmParityCapture, waitForFilmParityIdle } = require("./helpers/film-parity-capture.cjs");

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
  const [width, height] = require("../tools/lib/platform.cjs").machineSettings().windowSize.split("x").map(Number);
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("response", async response => { if (response.status() >= 400) console.error(response.status(),response.url(),await response.text()); });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const results = [];

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    if (input) {
      const resolved = path.resolve(input);
      if (!fs.existsSync(resolved)) throw new Error(`Input does not exist: ${resolved}`);
      const response=await page.request.post(new URL("/api/session",url).href,{
        multipart:{file:{name:path.basename(resolved),mimeType:"application/octet-stream",buffer:fs.readFileSync(resolved)}}});
      if(!response.ok()) throw Error(`Fixture upload failed: ${response.status()}`);
      const {session}=await response.json();
      await page.evaluate(loaded=>activateDesktopSession(loaded,""),session);
    } else {
      await importTestPattern(page);
    }
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 600000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 180000 });

    // A non-neutral grade underneath, so parity is tested on real tone mapping
    // rather than on an identity transform that anything would match. The
    // vignette is deliberately off-centre: a centred one is symmetric about the
    // frame, and a tile-local placement could still average out to something
    // close. Off-centre, a wrong origin is a visible shift.
    // Softness and Microcontrast are Detail controls (NEXT-01 #2) that run in
    // the film stage, so they are set on Detail but tested here.
    // Black & White with sliders set reads each pixel's colour from the source
    // around it (BW-01), so tiles need its reach in their halo too.
    const configure = async (overrides = {}) => page.evaluate(async ({ detail_softness = 0, detail_microcontrast = 0, bw = null, ...extra }) => {
      Object.assign(state.adjustments.hdr.detail, { softness: detail_softness, microcontrast: detail_microcontrast });
      state.adjustments.hdr.black_and_white_section_enabled = Boolean(bw);
      state.adjustments.hdr.black_and_white = { reds: 0, oranges: 0, yellows: 0, greens: 0, aquas: 0, blues: 0, purples: 0, magentas: 0, ...(bw || {}) };
      state.adjustments.hdr.exposure = 0.85;
      state.adjustments.hdr.contrast = 1.18;
      state.adjustments.hdr.saturation = 1.12;
      Object.assign(state.adjustments.hdr.vignette, {
        amount: -55, midpoint: 38, roundness: 30, feather: 60,
        highlight_protection: 25, center_x: 0.33, center_y: 0.61,
      });
      Object.assign(state.adjustments.hdr.film_look, {
        grain_amount: 65, grain_size: 45, grain_softness: 30, grain_chroma: 35,
        grain_shadow_response: 110, grain_midtone_response: 100, grain_highlight_response: 70,
        halation_amount: 0, lens_filter: "none",
        push_pull:0, print_paper:"default", print_exposure:0,
        print_contrast:0, shadow_contrast:0, highlight_contrast:0,
        scan_sharpening:0, lab_levels:false,
      }, extra);
      await window.HDRFilmStocks.request(state.adjustments.hdr.film_look.film_stock,state.adjustments.hdr.film_look);
      state.globalEditDirty=true;
      if (!await syncGlobalEditState()) throw Error("Recipe sync failed: "+JSON.stringify({gradeOpen:state.gradeOpen,edit:status.get("edit")}));
      invalidatePreview("hdr");
      await settlePreview("hdr",{});
      while(state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(()=>null);
    }, overrides);

    await installFilmParityCapture(page, { dump: Boolean(process.env.HDR_FINISHER_DUMP_PARITY) });
    const compare = (a, b) => page.evaluate(([left, right]) => window.__filmParity.compare(left, right), [a.id, b.id]);
    const drop = frame => page.evaluate(id => window.__filmParity.drop(id), frame.id);
    const renderDirect = (tier = "settled") =>
      page.evaluate(tier => window.__filmParity.direct(requiredProcessingLongEdge(), tier), tier);

    const renderTiled = tileSize => page.evaluate(size => window.__filmParity.capture(async onFrameSubmitted => {
      const result = await window.HDRFinisherPerformance.renderTiledTier(requiredProcessingLongEdge(), {
        tileSize: size, onFrameSubmitted,
      });
      if (!result?.rendered) return { error: `tileSize ${size}: tiled render refused: ${(result?.refusals || []).join(", ")}` };
      return { metrics: result.metrics };
    }), tileSize);

    const parityPass = async (label, tileSize) => {
      await waitForFilmParityIdle(page);
      const directShot = await renderDirect();
      const tiledShot = await renderTiled(tileSize);
      const { metrics } = tiledShot;
      if (process.env.HDR_FINISHER_DUMP_PARITY) {
        // The two presented frames, for inspecting where they differ.
        fs.mkdirSync(process.env.HDR_FINISHER_DUMP_PARITY, { recursive: true });
        const slug = label.replace(/[^a-z0-9]+/gi, "-");
        fs.writeFileSync(path.join(process.env.HDR_FINISHER_DUMP_PARITY, `film-${slug}-${tileSize}-direct.png`), Buffer.from(directShot.shot, "base64"));
        fs.writeFileSync(path.join(process.env.HDR_FINISHER_DUMP_PARITY, `film-${slug}-${tileSize}-tiled.png`), Buffer.from(tiledShot.shot, "base64"));
      }
      const comparison = await compare(directShot, tiledShot).catch(error => {
        throw new Error(`${label} tileSize ${tileSize}: ${error.message}`);
      });
      await drop(directShot);
      if (!["vignette+grain", "grain-view-map"].includes(label)) await drop(tiledShot);
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

    // Negative and slide densities both carry the frame-placed grain field.
    await page.evaluate(async () => {
      await Promise.all(["kodak_portra_400", "fujifilm_velvia_100"].map(id => window.HDRFilmStocks.request(id)));
    });
    for (const stock of ["kodak_portra_400", "fujifilm_velvia_100"]) {
      await configure({ film_stock: stock, look_strength: 50 });
      for (const tileSize of tileSizes) await parityPass(stock, tileSize);
    }
    await configure({ film_stock: "none", look_strength: 100 });

    // Ideal Neutral can exceed half-float before the HDR shoulder. Exercise
    // both final film storage and its scanner / Detail consumers byte-exactly.
    for (const scan of [0,100]) {
      await configure({film_stock:"none", grain_amount:0, push_pull:2,
        print_exposure:-3, print_contrast:100, shadow_contrast:100,
        highlight_contrast:100, scan_sharpening:scan,
        detail_softness:scan ? 35 : 0, detail_microcontrast:scan ? 60 : 0});
      for(const tileSize of tileSizes) await parityPass(`Neutral range scan ${scan}`,tileSize);
    }
    await configure({film_stock:"none",look_strength:100});

    // 4 -- the spatial film effects. Halation and bloom are separable blurs on
    // the quarter-resolution grid, so this is where a tile whose grid is offset
    // from the frame's, or whose halo is short, shows a seam at every boundary.
    await configure({ halation_amount: 70, halation_radius: 1.2, lens_filter: "black_pro_mist", lens_size: 3.0,
      detail_softness: 25, detail_microcontrast: 30, film_resolution: 82 });
    for (const tileSize of tileSizes) await parityPass("spatial", tileSize);

    // 5 -- the same at the largest radii either effect can be asked for. Each
    // blur reaches its 64-texel cap; sequential support adds in the tile halo.
    await configure({ halation_amount: 100, halation_radius: 5.0, lens_filter: "black_pro_mist", lens_size: 4,
      detail_softness: 100, detail_microcontrast: 100, film_resolution: 0 });
    for (const tileSize of tileSizes) await parityPass("spatial-max", tileSize);

    // 6 -- the halation view map, which replaces the picture with the halo
    // field alone, so a seam in it has nothing to hide behind.
    await configure({ halation_amount: 70, halation_radius: 1.2, halation_view_map: true,
      lens_filter: "none", film_resolution: 100 });
    for (const tileSize of tileSizes) await parityPass("halation-view-map", tileSize);
    await configure({ halation_amount: 0, halation_view_map: false, lens_filter: "none",
      film_resolution: 100 });

    // Black & White's neighbourhood colour, alone and under the spatial effects.
    await configure({ bw: { reds: -100, oranges: 100, yellows: -100, greens: 100, aquas: -100, blues: 100, purples: -100, magentas: 100 } });
    for (const tileSize of tileSizes) await parityPass("black-and-white", tileSize);
    await configure({ bw: { oranges: 100, greens: -60, blues: -80 }, halation_amount: 70, halation_radius: 1.2,
      lens_filter: "black_pro_mist", lens_size: 3.0, detail_softness: 25, film_resolution: 82 });
    for (const tileSize of tileSizes) await parityPass("bw+spatial", tileSize);
    await configure({ film_resolution: 100 });

    // 3 -- the grain view map: a neutral grey card carrying the grain field and
    // nothing else. Any tile-origin drift in the noise is the whole signal here.
    await configure({ grain_view_map: true });
    for (const tileSize of tileSizes) await parityPass("grain-view-map", tileSize);
    const liveGrain = await renderDirect("interactive");
    const settledGrain = await renderDirect();
    const acrossTiers = await compare(liveGrain, settledGrain);
    if (!liveGrain.exact || !settledGrain.exact || acrossTiers.maxDelta !== 0) {
      throw new Error(`Film Grain changed at the same render scale on release: ${JSON.stringify(acrossTiers)}`);
    }
    await drop(liveGrain);
    await drop(settledGrain);
    console.log("same-scale interactive and settled Grain are exact and byte-identical  PASS");
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
