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
    // Softness and Microcontrast are Detail controls (NEXT-01 #2) that run in
    // the film stage, so they are set on Detail but tested here.
    // Black & White with sliders set reads each pixel's colour from the source
    // around it (BW-01), so tiles need its reach in their halo too.
    const configure = async (overrides = {}) => page.evaluate(({ detail_softness = 0, detail_microcontrast = 0, bw = null, ...extra }) => {
      Object.assign(state.adjustments.hdr.detail, { softness: detail_softness, microcontrast: detail_microcontrast });
      state.adjustments.hdr.black_and_white_section_enabled = Boolean(bw);
      state.adjustments.hdr.black_and_white = { reds: 0, oranges: 0, yellows: 0, greens: 0, aquas: 0, blues: 0, purples: 0, magentas: 0, ...(bw || {}) };
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

    // What a capture actually shows. The comparison is only meaningful when
    // each screenshot shows the frame the test just rendered, at the same
    // backing size. Both diagnostic renders run at the size the app itself
    // presents, so the viewer stays Ready and has no reason to redraw; if the
    // app does present a frame of its own between a render and its screenshot
    // (it announces every presentation), the pair is refused rather than
    // compared, because resampling alone differs at every edge.
    const presentedFrame = () => page.evaluate(() => {
      if (window.__parityPresentations === undefined) {
        window.__parityPresentations = 0;
        window.addEventListener("hdrfinisher:preview-presented", () => { window.__parityPresentations += 1; });
      }
      return { backing: [els.previewCanvas.width, els.previewCanvas.height], presentations: window.__parityPresentations,
        execution: state.acceptedPresentation?.execution ?? null };
    });
    const assertComparable = (label, tileSize, direct, tiled) => {
      const stable = (capture) => capture.mark.presentations === capture.after.presentations
        && capture.mark.backing.join("x") === capture.after.backing.join("x");
      if (direct.mark.execution !== "direct" || !stable(direct) || !stable(tiled)
        || direct.after.backing.join("x") !== tiled.after.backing.join("x")) {
        throw new Error(`${label} tileSize ${tileSize}: the app presented its own frame during the captures, so they are not comparable: `
          + JSON.stringify({ direct, tiled }));
      }
    };
    await presentedFrame();
    // Capture the submitted surface before its WebGPU swapchain expires.
    // Browser screenshots resample the 1004-pixel backing into a fractional
    // CSS width and can differ even when both rendered surfaces are identical.
    await page.evaluate(() => {
      const context = els.previewCanvas.getContext("webgpu");
      const device = state.gpuPreview.device;
      const configure = context.configure.bind(context);
      context.configure = (config) => configure({ ...config, usage: (config.usage || GPUTextureUsage.RENDER_ATTACHMENT) | GPUTextureUsage.COPY_SRC });
      context.configure(context.getConfiguration());
      const current = context.getCurrentTexture.bind(context);
      let pending = null;
      context.getCurrentTexture = () => { pending = current(); return pending; };
      const submit = device.queue.submit.bind(device.queue);
      window.__parityRawFrames = [];
      device.queue.submit = (commands) => {
        submit(commands);
        if (!pending) return;
        const texture = pending;
        pending = null;
        const width = texture.width, height = texture.height, format = texture.format;
        const pixelBytes = format === "rgba16float" ? 8 : 4;
        const rowBytes = Math.ceil(width * pixelBytes / 256) * 256;
        const buffer = device.createBuffer({size: rowBytes * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({texture}, {buffer, bytesPerRow: rowBytes}, {width, height});
        submit([encoder.finish()]);
        window.__parityRawPending = (async () => {
          await buffer.mapAsync(GPUMapMode.READ);
          const padded = new Uint8Array(buffer.getMappedRange());
          const data = new Uint8Array(width * height * pixelBytes);
          for (let y=0; y<height; y++) data.set(padded.subarray(y*rowBytes, y*rowBytes+width*pixelBytes), y*width*pixelBytes);
          buffer.unmap(); buffer.destroy();
          let nonzero=0; for (const byte of data) if (byte) nonzero++;
          const id = window.__parityRawFrames.push({width,height,format,pixelBytes,data}) - 1;
          return {id,width,height,format,nonzero};
        })();
      };
    });
    let lastFrame = null;
    const capture = async () => {
      const mark = await presentedFrame();
      const raw = await page.evaluate(() => window.__parityRawPending);
      if (!raw || !raw.nonzero) throw new Error("No nonblank submitted surface was captured");
      const shot = process.env.HDR_FINISHER_DUMP_PARITY
        ? (await page.locator("#preview-canvas").screenshot()).toString("base64") : null;
      lastFrame = { mark, after: await presentedFrame() };
      return { ...raw, shot };
    };

    const compare = async (a, b) => page.evaluate(({ left, right }) => {
      const first = window.__parityRawFrames[left.id];
      const second = window.__parityRawFrames[right.id];
      if (first.width !== second.width || first.height !== second.height || first.format !== second.format) {
        return { error: "captured sizes or formats differ" };
      }
      let differing = 0;
      let maxDelta = 0;
      for (let index = 0; index < first.data.length; index += first.pixelBytes) {
        let delta = 0;
        // Compare every byte of RGB, including both bytes of half-float HDR.
        // Alpha is opaque. No tone mapping or conversion enters the comparison.
        for (let channel = 0; channel < first.pixelBytes * 3 / 4; channel += 1) {
          delta = Math.max(delta, Math.abs(first.data[index + channel] - second.data[index + channel]));
        }
        if (delta > maxDelta) maxDelta = delta;
        if (delta > 0) differing += 1;
      }
      return { width: first.width, height: first.height, samples: first.width * first.height, differing, maxDelta };
    }, { left: a, right: b });

    const renderDirect = async () => {
      const staged = await page.evaluate(async () => {
        const rendered = await window.HDRFinisherPerformance.renderGpuTier(requiredProcessingLongEdge());
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
        const result = await window.HDRFinisherPerformance.renderTiledTier(requiredProcessingLongEdge(), { tileSize: size });
        if (!result?.rendered) return { error: `tiled render refused: ${(result?.refusals || []).join(", ")}` };
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        return { metrics: result.metrics };
      }, tileSize);
      if (staged.error) throw new Error(`tileSize ${tileSize}: ${JSON.stringify(staged)}`);
      return { shot: await capture(), metrics: staged.metrics };
    };

    const parityPass = async (label, tileSize) => {
      // Start from an idle app: Ready, nothing in flight, and no settle or
      // refinement timer left to present its own frame over a capture.
      await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight && pendingHighlightAnchors.size === 0 && exactHighlightAnchorInflight.size === 0, null, { timeout: 180000 });
      await page.evaluate(() => state.previewScheduler?.cancel());
      const directShot = await renderDirect();
      const directFrame = lastFrame;
      const { shot: tiledShot, metrics } = await renderTiled(tileSize);
      assertComparable(label, tileSize, directFrame, lastFrame);
      if (process.env.HDR_FINISHER_DUMP_PARITY) {
        // The two presented frames, for inspecting where they differ.
        fs.mkdirSync(process.env.HDR_FINISHER_DUMP_PARITY, { recursive: true });
        const slug = label.replace(/[^a-z0-9]+/gi, "-");
        fs.writeFileSync(path.join(process.env.HDR_FINISHER_DUMP_PARITY, `film-${slug}-${tileSize}-direct.png`), Buffer.from(directShot.shot, "base64"));
        fs.writeFileSync(path.join(process.env.HDR_FINISHER_DUMP_PARITY, `film-${slug}-${tileSize}-tiled.png`), Buffer.from(tiledShot.shot, "base64"));
      }
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
      bloom_amount: 55, bloom_radius: 3.0,
      detail_softness: 25, detail_microcontrast: 30, film_resolution: 82 });
    for (const tileSize of tileSizes) await parityPass("spatial", tileSize);

    // 5 -- the same at the largest radii either effect can be asked for, where
    // the halo is at its 64-texel cap and largest relative to the tile.
    await configure({ halation_amount: 100, halation_radius: 5.0, halation_sensitivity: 100,
      bloom_amount: 100, bloom_radius: 10.0,
      detail_softness: 100, detail_microcontrast: 100, film_resolution: 0 });
    for (const tileSize of tileSizes) await parityPass("spatial-max", tileSize);

    // 6 -- the halation view map, which replaces the picture with the halo
    // field alone, so a seam in it has nothing to hide behind.
    await configure({ halation_amount: 70, halation_radius: 1.2, halation_view_map: true,
      bloom_amount: 0, film_resolution: 100 });
    for (const tileSize of tileSizes) await parityPass("halation-view-map", tileSize);
    await configure({ halation_amount: 0, halation_view_map: false, bloom_amount: 0,
      film_resolution: 100 });

    // Black & White's neighbourhood colour, alone and under the spatial effects.
    await configure({ bw: { reds: -100, oranges: 100, yellows: -100, greens: 100, aquas: -100, blues: 100, purples: -100, magentas: 100 } });
    for (const tileSize of tileSizes) await parityPass("black-and-white", tileSize);
    await configure({ bw: { oranges: 100, greens: -60, blues: -80 }, halation_amount: 70, halation_radius: 1.2,
      bloom_amount: 55, bloom_radius: 3.0, detail_softness: 25, film_resolution: 82 });
    for (const tileSize of tileSizes) await parityPass("bw+spatial", tileSize);
    await configure({ film_resolution: 100 });

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
