// Physical lens filters: exact Direct/Tiled bytes at Fit and native.
const assert = require("node:assert/strict");
const fs = require("fs");
const { importTestPattern } = require("./helpers/import-test-pattern");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

// Byte-exact: both paths use the same globally anchored processing grid.
const MAX_CHANNEL_DELTA = 0;

function writeFixture() {
  const python = require('../tools/lib/platform.cjs').pythonExecutable();
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "film-stock-parity-")), "stock_hues.tiff");
  const script = `
import numpy as np, tifffile, sys, colorsys
h, w = 1600, 2400
x = np.arange(w) / w
hue = np.array([colorsys.hsv_to_rgb(v, 0.7, 1.0) for v in x], np.float32)
y = np.arange(h)[:, None, None] / h
level = np.float32(2.0) ** (4.0 - 12.0 * y)
rgb = (hue[None, :, :] * level).astype(np.float32)
rgb[:, :160] = level[:, :, :] * np.float32(0.8)
rgb[500:700,700:1100] = np.float32(8)
rgb[900:940,1600:1640] = np.float32(16)
tifffile.imwrite(sys.argv[1], rgb, photometric="rgb")
`;
  execFileSync(python, ["-c", script, target]);
  return target;
}


(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
  const suppliedInput = argument("--input", null);
  const input = suppliedInput || writeFixture();

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  page.on("response", async response => { if (response.status() >= 400) console.error(response.status(),response.url(),await response.text()); });
  const pageErrors = [];
  page.on("pageerror", (error) => {pageErrors.push(error.stack || error.message); console.error("PAGE ERROR",error.stack);});
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
      Object.assign(state.adjustments[state.currentView].detail, { softness: detail_softness, microcontrast: detail_microcontrast });
      state.adjustments[state.currentView].black_and_white_section_enabled = Boolean(bw);
      state.adjustments[state.currentView].black_and_white = { reds: 0, oranges: 0, yellows: 0, greens: 0, aquas: 0, blues: 0, purples: 0, magentas: 0, ...(bw || {}) };
      state.adjustments[state.currentView].exposure = 0;
      state.adjustments[state.currentView].contrast = 0;
      state.adjustments[state.currentView].saturation = 0;
      Object.assign(state.adjustments[state.currentView].vignette, {
        amount: 0, midpoint: 38, roundness: 30, feather: 60,
        highlight_protection: 25, center_x: 0.33, center_y: 0.61,
      });
      Object.assign(state.adjustments[state.currentView].film_look, {
        grain_amount: 65, grain_size: 45, grain_softness: 30, grain_chroma: 35,
        grain_shadow_response: 110, grain_midtone_response: 100, grain_highlight_response: 70,
        halation_amount: 0, lens_filter: "none",
        push_pull:0, print_paper:"default", print_exposure:0,
        print_contrast:0, shadow_contrast:0, highlight_contrast:0,
        scan_sharpening:0, lab_levels:false,
      }, extra);
      await window.HDRFilmStocks.request(state.adjustments[state.currentView].film_look.film_stock,state.adjustments[state.currentView].film_look);
      state.globalEditDirty=true;
      if (!await syncGlobalEditState()) throw Error("Recipe sync failed: "+JSON.stringify({gradeOpen:state.gradeOpen,edit:status.get("edit")}));
      invalidatePreview(state.currentView);
      await settlePreview(state.currentView,{});
      while(state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(()=>null);
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
    await page.evaluate(()=>stopPreviewWatchdog());
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
        const rendered = await window.HDRFinisherPerformance.renderGpuTier(window.__lensEdge);
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

    const renderTiled = async (tileSize, options = {}) => {
      const staged = await page.evaluate(async ({ tileSize, viewport, redraw, secondary }) => {
        const lane = state.currentView;
        if (redraw) state.previewGeneration[lane] += 1;
        let result;
        if (secondary) {
          const before = structuredClone(state.adjustments);
          before[lane].film_look.lens_filter = 'none';
          result = await state.gpuPreview.renderTiledTo(els.comparisonCanvas, state.session.session_id, lane,
            before, sampleCurvePoints, window.__lensEdge, [], state.editRevision, null,
            projectReferenceWhiteNits(), state.session.source, { tileSize });
        } else {
          result = await window.HDRFinisherPerformance.renderTiledTier(window.__lensEdge, { tileSize, viewport });
        }
        if (!result?.rendered) return { error: `tiled render refused: ${(result?.refusals || []).join(", ")}` };
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        return { metrics: result.metrics };
      }, { tileSize, ...options });
      if (staged.error) throw new Error(`tileSize ${tileSize}: ${JSON.stringify(staged)}`);
      return { shot: options.secondary ? null : await capture(), metrics: staged.metrics };
    };

    const parityPass = async (label, tileSize) => {
      // Start from an idle app: Ready, nothing in flight, and no settle or
      // refinement timer left to present its own frame over a capture.
      await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight && pendingHighlightAnchors.size === 0 && exactHighlightAnchorInflight.size === 0, null, { timeout: 180000 });
      await page.evaluate(() => {state.previewScheduler?.cancel();state.renderCoordinator?.cancelFollowUps(state.currentView);});
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

    const reused = (count) => page.evaluate(tiles => state.gpuPreview.diagnosticsSnapshot().stages
      .filter(entry => entry.stage === "lens-glow").slice(-tiles).filter(entry => entry.reused).length, count);
    const glowBytes = () => page.evaluate(() => state.gpuPreview.resourceMemorySnapshot().resident.categories.lensGlowTileBytes);
    const cacheEnabled = enabled => page.evaluate(value => { state.gpuPreview.disableLensGlowCache = !value; }, enabled);
    const drawDirect = async ({ secondary = false, superseded = false } = {}) => {
      await page.evaluate(async ({ secondary, superseded }) => {
        const lane = state.currentView;
        const preview = state.gpuPreview;
        const target = secondary ? els.comparisonCanvas : els.previewCanvas;
        const gate = preview.presentationGate;
        const acquire = gate.acquire;
        if (superseded) gate.acquire = (canvas, current, resize) => acquire.call(gate, canvas, () => false, resize);
        try {
          const result = await preview.renderTo(target, state.session.session_id, lane,
            structuredClone(state.adjustments), sampleCurvePoints, window.__lensEdge, [], state.editRevision, null,
            projectReferenceWhiteNits(), state.session.source, { tier: 'settled', identity: gradeSourceIdentity(lane),
              gradePreview: !secondary, originalSource: secondary, keepProxies: secondary || superseded });
          const refusal = preview.lastRenderRefusal?.reason;
          if (superseded ? result || refusal !== 'superseded-before-presentation' : result?.execution !== 'direct') {
            throw Error(`Unexpected Direct Mist result: ${result?.execution}; ${refusal}`);
          }
          await preview.device.queue.onSubmittedWorkDone();
        } finally {
          if (superseded) gate.acquire = acquire;
        }
      }, { secondary, superseded });
      return secondary || superseded ? null : capture();
    };

    const verifyMistCacheRegressions = async (check) => {
      await page.evaluate(() => state.gpuPreview.setInstrumentationEnabled(true));
      await configure({ film_stock: 'none', grain_amount: 20, lens_filter: 'pro_mist', lens_strength: 2, lens_size: 4 });
      await page.evaluate(() => { state.previewScheduler.cancel(); state.renderCoordinator?.cancelFollowUps(state.currentView); });
      await drawDirect();
      if (check !== 'presentation') {
        const setClarity = amount => page.evaluate(value => Object.assign(state.adjustments[state.currentView].detail,
          { clarity_amount: value, clarity_radius_percent: 1.5 }), amount);
        await setClarity(100);
        const left = { x: 100, y: 300, width: 110, height: 110 };
        const shifted = { x: 290, y: 300, width: 270, height: 110 };
        const first = await renderTiled(512, { viewport: left, redraw: true });
        assert.equal(first.metrics.foregroundTiles, 1, 'The first viewport fills only one tile');
        assert.equal(first.metrics.clarityMapReblurred, true);
        const panned = await renderTiled(512, { viewport: shifted, redraw: true });
        assert.equal(panned.metrics.foregroundTiles, 2, 'The expanded viewport redraws the overlap and new tile');
        assert.notEqual(panned.metrics.sourceRoute, 'region', 'The pan expands coverage on one whole-frame source');
        assert.equal(panned.metrics.clarityMapReblurred, true, 'The pan fills more of the Clarity map');
        const panHits = await reused(panned.metrics.foregroundTiles);
        await page.evaluate(() => { state.adjustments[state.currentView].film_look.lens_strength = 1; });
        const strength = await renderTiled(512, { viewport: shifted, redraw: true });
        assert.equal(strength.metrics.clarityMapReblurred, false, 'A strength-only edit does not rewrite Clarity');
        const strengthHits = await reused(strength.metrics.foregroundTiles);
        await page.evaluate(() => { state.adjustments[state.currentView].film_look.grain_amount = 30; });
        const grain = await renderTiled(512, { viewport: shifted, redraw: true });
        assert.equal(grain.metrics.clarityMapReblurred, false, 'A grain-only edit does not rewrite Clarity');
        const grainHits = await reused(grain.metrics.foregroundTiles);
        await cacheEnabled(false);
        try {
          const freshGrain = await renderTiled(512, { viewport: shifted, redraw: true });
          await page.evaluate(() => { state.adjustments[state.currentView].film_look.grain_amount = 20; });
          const freshStrength = await renderTiled(512, { viewport: shifted, redraw: true });
          await page.evaluate(() => { state.adjustments[state.currentView].film_look.lens_strength = 2; });
          const freshPan = await renderTiled(512, { viewport: shifted, redraw: true });
          assert.equal((await compare(panned.shot, freshPan.shot)).maxDelta, 0, 'Clarity pan is byte-exact with a fresh glow');
          assert.equal(panHits, 0, 'Expanded Clarity map invalidates the old glow');
          assert.equal((await compare(strength.shot, freshStrength.shot)).maxDelta, 0, 'Mist strength after a Clarity pan is byte-exact');
          assert.equal(strengthHits, strength.metrics.foregroundTiles, 'Mist strength fully reuses glow once Clarity is stable');
          assert.equal((await compare(grain.shot, freshGrain.shot)).maxDelta, 0, 'Grain after a Clarity pan is byte-exact');
          assert.equal(grainHits, grain.metrics.foregroundTiles, 'Grain fully reuses glow once Clarity is stable');
        } finally {
          await cacheEnabled(true);
          await setClarity(0);
        }
        console.log('PASS: Clarity pan, Mist strength and grain match uncached bytes');
      }
      if (check !== 'clarity') {
        await renderTiled(512);
        const bytes = await glowBytes();
        assert.ok(bytes > 0, 'Main tiled frame has resident Mist glow');
        await drawDirect({ secondary: true });
        assert.equal(await glowBytes(), bytes, 'Before/compare Direct preserves the main glow pool');
        await renderTiled(512, { secondary: true });
        assert.equal(await glowBytes(), bytes, 'Tiled compare preserves the main glow pool');
        await drawDirect({ superseded: true });
        assert.equal(await glowBytes(), bytes, 'Superseded main Direct preserves the main glow pool');
        const warm = await renderTiled(512);
        assert.equal(await reused(warm.metrics.foregroundTiles), warm.metrics.foregroundTiles, 'Main tiles still reuse glow');
        await drawDirect();
        assert.equal(await glowBytes(), 0, 'A presented main Direct frame releases the tiled glow pool');
        console.log('PASS: compare and refused Direct preserve main glow; presenting main Direct releases it');
      }
      await page.evaluate(() => { window.__parityRawFrames.length = 0; });
    };

    const verifySpeedCaches = async () => {
      await page.evaluate(() => state.gpuPreview.setInstrumentationEnabled(true));
      await configure({ film_stock: 'kodak_portra_400', grain_amount: 45, lens_filter: 'black_pro_mist',
        lens_strength: .125, lens_size: 1, halation_amount: 10 });
      await page.evaluate(() => { state.previewScheduler.cancel(); state.renderCoordinator?.cancelFollowUps(state.currentView); });
      const reference = await renderDirect();
      const moving = await page.evaluate(async () => {
        const rendered = await renderGpuDraft(state.currentView, { longEdge: window.__lensEdge, tier: 'interactive' });
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        return { rendered, ...state.acceptedPresentation };
      });
      assert.ok(moving.rendered && moving.approximate && !moving.exact, 'Drag grain is never settled');
      const released = await renderDirect();
      assert.equal((await compare(reference, released)).maxDelta, 0, 'Release restores exact grain bytes');
      await page.evaluate(async () => {
        state.adjustments[state.currentView].film_look.lens_strength = 2;
        state.globalEditDirty = true;
        if (!await syncGlobalEditState()) throw Error('Strength sync failed');
        invalidatePreview(state.currentView);
      });
      await page.evaluate(() => { state.previewScheduler.cancel(); state.renderCoordinator?.cancelFollowUps(state.currentView); });
      const cached = await renderDirect();
      assert.equal(await page.evaluate(() => state.gpuPreview.diagnosticsSnapshot().stages
        .filter(entry => entry.stage === 'lens-glow').at(-1)?.reused), true, 'Strength change reuses summed glow');
      await page.evaluate(() => { state.gpuPreview.intermediates.get(els.previewCanvas).lensGlowKey = null; });
      const fresh = await renderDirect();
      assert.equal((await compare(cached, fresh)).maxDelta, 0, 'Strength-only cached glow is byte-exact with fresh glow');
      console.log('PASS: direct grain settlement and Strength-only cached glow', moving.lane, await page.evaluate(() => window.__lensEdge));
      const captureTiled = async (hits, label) => {
        const { shot, metrics } = await renderTiled(512);
        assert.ok(metrics.foregroundTiles > 0, label);
        assert.equal(await reused(metrics.foregroundTiles), hits ? metrics.foregroundTiles : 0, label);
        return shot;
      };
      const setFilm = patch => page.evaluate(async values => {
        const film = state.adjustments[state.currentView].film_look;
        if (values.film_stock) await HDRFilmStocks.request(values.film_stock, { ...film, ...values });
        Object.assign(film, values);
      }, patch);
      const denoise = moving.lane === 'hdr';
      if (denoise) await page.evaluate(async () => {
        state.denoise.hdr.enabled = true;
        state.denoise.hdr.controls.method = 'standard';
        state.denoiseRuntime.hdr.dirty = true;
        if (!await recalculateDenoise('hdr', { longEdge: window.__lensEdge, renderAfter: false })) throw Error('Denoise preparation failed');
        state.previewScheduler.cancel();
        state.renderCoordinator?.cancelFollowUps('hdr');
      });
      try {
        const variants = [{ grain_amount: 55 }, { lens_strength: 1 }, { halation_amount: 16 }, { film_stock: 'fujifilm_velvia_100' }];
        const assertBytes = async (route, actual, expected, edit) => assert.equal(
          (await compare(actual, expected)).maxDelta, 0, `${route}: ${edit} cached vs uncached (Denoise ${denoise ? 'on' : 'off'})`,
        );
        await drawDirect();
        if (denoise) assert.equal(await page.evaluate(() => state.gpuPreview.denoiseSourceSelector?.selected), 'resolved');
        for (const patch of variants) {
          const label = Object.keys(patch)[0];
          await setFilm(patch);
          const cached = await drawDirect();
          assert.equal(await reused(1), 1, `Direct: ${label} reuses Mist`);
          await cacheEnabled(false);
          await assertBytes('Direct', cached, await drawDirect(), label);
          await cacheEnabled(true);
        }
        await captureTiled(false, 'First tiled frame builds Mist');
        let memory = await glowBytes();
        assert.ok(memory > 0, 'Tiled Mist holds resident glow');
        for (const patch of [{ grain_amount: 45 }, { lens_strength: 0.125 }, { halation_amount: 10 }, { film_stock: 'kodak_portra_400' }]) {
          const label = Object.keys(patch)[0];
          await setFilm(patch);
          const cached = await captureTiled(true, `Tiled: ${label} reuses Mist`);
          await cacheEnabled(false);
          await assertBytes('Tiled', cached, await captureTiled(false, 'Disabled cache rebuilds Mist'), label);
          assert.equal(await glowBytes(), 0, 'Disabling reuse releases retained tiles');
          await cacheEnabled(true);
          await captureTiled(false, 'Re-enabling cache rebuilds Mist');
        }
        if (denoise) {
          await page.evaluate(async () => {
            const preview = state.gpuPreview;
            const fetchModel = preview.fetchDenoiseModel;
            preview.fetchDenoiseModel = async function (...args) {
              const model = await fetchModel.apply(this, args);
              return { ...model, a: model.a + 0.01 };
            };
            try {
              if (!await recalculateDenoise('hdr', { force: true, longEdge: window.__lensEdge, renderAfter: false })) {
                throw Error('Denoise refresh failed');
              }
            } finally {
              preview.fetchDenoiseModel = fetchModel;
            }
          });
          await captureTiled(false, 'Denoise refresh rebuilds Mist');
          await captureTiled(true, 'Refreshed Denoise glow is reused');
          await page.evaluate(() => { state.adjustments.hdr.highlight_compression_target_nits = 600; });
          await captureTiled(false, 'Changing the Tone peak rebuilds Mist');
          await page.evaluate(() => { state.editDocument.hdr_reference_white_nits = projectReferenceWhiteNits() === 100 ? 203 : 100; });
          await captureTiled(false, 'Changing reference white rebuilds Mist');
          await page.evaluate(() => {
            delete state.editDocument.hdr_reference_white_nits;
            state.denoise.hdr.enabled = false;
            state.gpuPreview.selectDenoiseSelectorSource(false);
          });
          await captureTiled(false, 'Denoise bypass rebuilds Mist');
        } else {
          await page.evaluate(() => { state.adjustments.sdr.linked_to_hdr = true; });
          await captureTiled(false, 'Linking SDR to HDR rebuilds Mist');
          await page.evaluate(() => { state.adjustments.sdr.linked_to_hdr = false; });
          await captureTiled(false, 'Unlinking SDR from HDR rebuilds Mist');
        }
        await page.evaluate(async () => {
          const local = newLocalAdjustment('linear_gradient');
          local.mask.leaf.start = { x: 0.1, y: 0.3 };
          local.mask.leaf.end = { x: 0.9, y: 0.6 };
          local[`${state.currentView}_grade`].exposure = 0.5;
          if (!await queueEditCommand('create_local', { local }, null, { refreshPreview: false })) throw Error('Local creation failed');
          window.__mistLocalId = local.id;
        });
        await captureTiled(false, 'Adding a local grade rebuilds Mist');
        await page.evaluate(async () => {
          const local = structuredClone(localAdjustments().find(item => item.id === window.__mistLocalId));
          local.mask.leaf.start.x = 0.65;
          if (!await queueEditCommand('update_local', { local }, local.id, { refreshPreview: false })) throw Error('Mask edit failed');
        });
        await captureTiled(false, 'Editing the local mask rebuilds Mist');
        await page.evaluate(() => queueEditCommand('delete_local', {}, window.__mistLocalId, { refreshPreview: false }));
        await captureTiled(false, 'Removing the local grade rebuilds Mist');
        memory = await glowBytes();
        assert.ok(memory > 0, 'Tiled Mist stores glow before disabling the filter');
        await setFilm({ lens_filter: 'none' });
        await renderTiled(512);
        assert.equal(await glowBytes(), 0, 'Mist off releases retained tiles');
        await setFilm({ lens_filter: 'black_pro_mist' });
        await captureTiled(false, 'Mist back on rebuilds glow');
        await drawDirect();
        assert.equal(await glowBytes(), 0, 'Returning to Direct releases retained tiles');
        console.log(`PASS: ${moving.lane} Mist reuse, exact bytes and invalidation; ${memory} glow bytes → 0 with Mist off`);
      } finally {
        await cacheEnabled(true);
      }
      await page.evaluate(() => { window.__parityRawFrames.length = 0; });
    };

    const edges = argument("--edge") ? [Number(argument("--edge"))] : [1520, 2400];
    const mistRegressionOnly = argument('--mist-regression-only');
    for (const edge of edges) {
      await page.evaluate(value=>window.__lensEdge=value,edge);
      for (const lane of (argument("--lane") ? [argument("--lane")] : ["hdr","sdr"])) {
        await page.evaluate(async value=>{if(state.currentView!==value) await switchLane(value);},lane);
        if (edge === edges[0]) await verifyMistCacheRegressions(mistRegressionOnly);
        if (mistRegressionOnly) continue;
        if (edge === edges[0]) await verifySpeedCaches();
        for (const family of ["glimmerglass","black_pro_mist","pro_mist","cinebloom"])
        for (const strength of [.125,2]) for (const size of [.25,4]) for (const format of ["35mm","super8"]) {
          if(argument("--case") && argument("--case")!==`${family} ${strength} ${size} ${format}`) continue;
          await configure({film_stock:"none",look_strength:100,lens_filter:family,lens_strength:strength,lens_size:size,grain_film_format:format,grain_amount:0,film_resolution:100});
          await parityPass(`${lane} ${edge} ${family} ${strength} ${size} ${format}`,512);
          await page.evaluate(()=>window.__parityRawFrames.length=0);
        }
      }
    }
    if(results.some(result=>!result.passed)) throw Error("Lens Direct/Tiled differences: "+JSON.stringify(results.filter(result=>!result.passed).map(({label,maxDelta,differing})=>({label,maxDelta,differing}))));
    if(pageErrors.length) throw Error(pageErrors.join(" | "));
    console.log(mistRegressionOnly ? 'Selected Mist regressions passed.' : 'All tested lens filters are byte-exact between Direct and Tiled.');
  } finally {
    await browser.close();
    if (!suppliedInput) fs.rmSync(path.dirname(input), { recursive: true, force: true });
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
