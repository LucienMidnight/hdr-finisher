// Physical lens filters: exact Direct/Tiled bytes at Fit and native.
const fs = require("fs");
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
  const python = path.resolve(__dirname, "..", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
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
  const input = argument("--input", null) || writeFixture();

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

    const renderTiled = async (tileSize) => {
      const staged = await page.evaluate(async (size) => {
        const result = await window.HDRFinisherPerformance.renderTiledTier(window.__lensEdge, { tileSize: size });
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

    for (const edge of (argument("--edge") ? [Number(argument("--edge"))] : [1520,2400])) {
      await page.evaluate(value=>window.__lensEdge=value,edge);
      for (const lane of (argument("--lane") ? [argument("--lane")] : ["hdr","sdr"])) {
        await page.evaluate(async value=>{if(state.currentView!==value) await switchLane(value);},lane);
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
    console.log("All lens filters are byte-exact between Direct and Tiled.");
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
