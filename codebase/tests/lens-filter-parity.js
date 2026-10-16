// Film stock: the WebGPU preview matches the CPU export.
//
// A generated picture with every hue across it and brightness from deep
// shadow to HDR highlights down it, rendered through both renderers in each
// rendition. As in bw-parity.js, the measure is what the film stock adds to
// their disagreement: the difference with the stock on, less the difference
// with it off (the rest of the graph's own GPU/CPU gap).
//
//   node tests/run-in-electron.js tests/film-stock-parity.js [--input photo.heic]
//
// --input runs the same cases on a real file instead, and reports rather than
// fails.

const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
let LONG_EDGE = 1520;
const extremeHdr = process.argv.includes("--extreme-hdr");
const laneIndex = process.argv.indexOf("--lane");
const selectedLane = laneIndex >= 0 ? process.argv[laneIndex + 1] : null;
if (selectedLane !== null && !["hdr", "sdr"].includes(selectedLane)) throw new Error("--lane must be hdr or sdr");
const caseIndex = process.argv.indexOf("--case");
const selectedCase = caseIndex >= 0 ? process.argv[caseIndex + 1] : null;
if (selectedCase && !selectedCase.trim()) throw new Error("--case requires a label");
const LANES = selectedLane ? [selectedLane] : ["hdr", "sdr"];
const MAX_MEAN_DIFFERENCE = 0.1 / 255;
const MAX_P999_DIFFERENCE = 2 / 255;

const NEUTRAL = { lens_filter:"none",lens_strength:.5,lens_size:1,
  film_stock: "none", stock_color: 100, stock_tone: 100, stock_exposure: 0, stock_separation: 0,
  stock_print_warmth: 0, stock_print_tint: 0, stock_preflash: 0,
  push_pull: 0, print_paper: "default", print_exposure: 0, print_contrast: 0, shadow_contrast: 0, highlight_contrast: 0, scan_sharpening: 0, lab_levels: false,
};
const CASES = ["glimmerglass","black_pro_mist","pro_mist","cinebloom"].flatMap(family=>
  [.125,2].flatMap(strength=>[.25,4].flatMap(size=>["35mm","super8"].map(format=>({
    label:`${family} ${strength} ${size} ${format}`,
    stock:{film_stock:"none",lens_filter:family,lens_strength:strength,lens_size:size,grain_film_format:format},
  })))));

if (selectedCase && !CASES.some(c => c.label === selectedCase)) throw new Error(`Unknown case: ${selectedCase}`);

function writeFixture() {
  const python = path.resolve(__dirname, "..", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "film-stock-parity-")), "stock_hues.tiff");
  const script = `
import numpy as np, tifffile, sys, colorsys
h, w = 1600, 2400
x = np.arange(w) / w
hue = np.array([colorsys.hsv_to_rgb(v, 0.7, 1.0) for v in x], np.float32)
y = np.arange(h)[:, None, None] / h
level = np.float32(2.0) ** (${extremeHdr ? 7.0 : 4.0} - 12.0 * y)
rgb = (hue[None, :, :] * level).astype(np.float32)
rgb[:, :160] = level[:, :, :] * np.float32(0.8)
rgb[500:700,700:1100] = np.float32(8)
rgb[900:940,1600:1640] = np.float32(16)
tifffile.imwrite(sys.argv[1], rgb, photometric="rgb")
`;
  execFileSync(python, ["-c", script, target]);
  return target;
}

const inputIndex = process.argv.indexOf("--input");
const inputPath = inputIndex >= 0 ? path.resolve(process.argv[inputIndex + 1]) : null;

(async () => {
  const fixturePath = inputPath || writeFixture();
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // preview-raw is an SDR byte surface; pin the canvas to standard range so
  // the comparison is between two encodings of the same thing.
  await page.addInitScript(() => {
    const inherited = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = inherited(query);
      if (query !== "(dynamic-range: high)") return result;
      return new Proxy(result, {
        get(target, property) {
          if (property === "matches") return false;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
  });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => state.gpuPreview?.detail !== "WebGPU has not been initialized");
    if (!await page.evaluate(() => state.gpuPreview?.available)) throw new Error(`WebGPU is unavailable: ${await page.evaluate(() => state.gpuPreview?.detail)}`);
    const sessionResponse = await page.request.post(`${baseUrl}/api/session`, {
      multipart: { file: { name: path.basename(fixturePath), mimeType: "application/octet-stream", buffer: fs.readFileSync(fixturePath) } },
    });
    if (!sessionResponse.ok()) throw new Error(`Fixture session failed with HTTP ${sessionResponse.status()}.`);
    const { session } = await sessionResponse.json();
    await page.evaluate((loadedSession) => activateDesktopSession(loadedSession, ""), session);
    const loaded = await page.evaluate(async (ids) => {
      await Promise.all(ids.map((id) => window.HDRFilmStocks.request(id)));
      return window.HDRFilmStocks.loadedIds();
    }, [...new Set(CASES.map((item) => item.stock.film_stock))]);
    console.log(`Stocks on the GPU: ${loaded.join(", ")}`);

    const compare = async (...args) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await compareOnce(...args);
        if (!String(result.error || "").includes(" vs CPU ")) return result;
      }
      return compareOnce(...args);
    };
    const compareOnce = async (lane, stock, lookStrength) => page.evaluate(async ({ lane, stock, lookStrength, longEdge, extremeHdr }) => {
      if (state.currentView !== lane) await switchLane(lane);
      state.previewScheduler?.cancel();
      while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
      const branch = state.adjustments[lane];
      if (extremeHdr && lane === "hdr") Object.assign(branch, {
        highlight_section_enabled:true, highlight_compression_mode:"peak_fit",
        highlight_compression_start_nits:400, highlight_compression_target_nits:1000,
        highlight_compression_color_handling:"smooth_rolloff",
      });
      Object.assign(branch.film_look, { grain_amount: 0, halation_amount: 0, lens_filter: "none", film_resolution: 100,
        grain_size: 50, grain_film_format: "35mm", grain_chroma: 40, halation_radius: 1.2,
        look_strength: lookStrength }, stock);
      state.globalEditDirty = true;
      if (!await syncGlobalEditState()) throw Error("Recipe sync failed");
      invalidatePreview(lane);
      await settlePreview(lane, {});
      while (pendingHighlightAnchors.size || exactHighlightAnchorInflight.size)
        await new Promise(resolve => setTimeout(resolve, 20));
      state.previewScheduler?.cancel();
      while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
      const renderStarted=performance.now();
      if (!await renderGpuDraft(lane, { longEdge })) return { error: "GPU render failed" };
      await state.gpuPreview.device.queue.onSubmittedWorkDone();
      const renderMs=performance.now()-renderStarted;
      let textureStats=null;
      if (extremeHdr) {
        const device = state.gpuPreview.device;
        const source = state.gpuPreview.scopeSources.get(els.previewCanvas);
        const width=source.width, height=source.height, size=width*height*16;
        const storage=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
        const buffer=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        const module=device.createShaderModule({code:`
          @group(0) @binding(0) var picture:texture_2d<f32>;
          @group(0) @binding(1) var<storage,read_write> values:array<vec4f>;
          @compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u) {
            let d=textureDimensions(picture); if(id.x>=d.x || id.y>=d.y) {return;}
            values[id.y*d.x+id.x]=textureLoad(picture,vec2i(id.xy),0);
          }`});
        const pipeline=device.createComputePipeline({layout:"auto",compute:{module,entryPoint:"main"}});
        const bindings=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
          {binding:0,resource:source.filmTexture.createView()},{binding:1,resource:{buffer:storage}}]});
        const encoder=device.createCommandEncoder(), pass=encoder.beginComputePass();
        pass.setPipeline(pipeline);pass.setBindGroup(0,bindings);pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));pass.end();
        encoder.copyBufferToBuffer(storage,0,buffer,0,size);
        device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
        const values=new Float32Array(buffer.getMappedRange());
        let infinity=0,nan=0,maxFinite=0,maxDecoded=0,atLimit=0;
        for(let i=0;i<values.length;i++) if(i%4!==3) {
          const value=values[i];
          if(Number.isNaN(value)) nan++;
          else if(!Number.isFinite(value)) infinity++;
          else {maxDecoded=Math.max(maxDecoded,Math.abs(value*values[i-i%4+3]));maxFinite=Math.max(maxFinite,Math.abs(value));if(Math.abs(value)===65504) atLimit++;}
        }
        textureStats={infinity,nan,maxFinite,maxDecoded,atLimit, anchor:source.params[75], branchPeak:branch.highlight_compression_source_peak_nits,
          samples:[0,400,744,759,1000].map(x=>({x,rgba:Array.from(values.slice(x*4,x*4+4))}))};
        buffer.unmap();buffer.destroy();storage.destroy();
      }
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = reject;
        element.src = els.previewCanvas.toDataURL("image/png");
      });
      const surface = document.createElement("canvas");
      surface.width = els.previewCanvas.width;
      surface.height = els.previewCanvas.height;
      surface.getContext("2d").drawImage(image, 0, 0);
      const gpu = surface.getContext("2d").getImageData(0, 0, surface.width, surface.height).data;
      const cpuStarted=performance.now();
      const response = await fetch(`/api/session/${state.session.session_id}/preview-raw/${lane}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustments: state.adjustments, local_adjustments: [], long_edge: longEdge, hdr_display: false }),
      });
      if (!response.ok) return { error: `CPU reference failed with HTTP ${response.status}` };
      const cpu = new Uint8ClampedArray(await response.arrayBuffer());
      const size = [surface.width, surface.height, Number(response.headers.get("X-Image-Width")), Number(response.headers.get("X-Image-Height"))];
      if (size[0] !== size[2] || size[1] !== size[3]) return { error: `GPU ${size[0]}x${size[1]} vs CPU ${size[2]}x${size[3]}` };
      // Compare in the renderer and return a 256-bin histogram summary. The
      // old driver transferred and sorted millions of identical integer levels.
      // This computes the same mean and exact p99.9 without that diagnostic cost.
      const isBaseline = stock.lens_filter === "none";
      const count=cpu.length/4*3;
      const baseline=isBaseline ? new Uint8Array(count) : window.__lensBaseline;
      if (!baseline || baseline.length!==count) throw Error("Missing matching lens baseline");
      const histogram=new Uint32Array(256);
      let sum=0,raw=0,maximum=0,sample=0;
      const worst=[];
      for(let pixel=0;pixel<cpu.length;pixel+=4) {
        for(let channel=0;channel<3;channel++,sample++) {
          const difference=Math.abs(gpu[pixel+channel]-cpu[pixel+channel]);
          if(isBaseline) baseline[sample]=difference;
          const added=isBaseline ? 0 : Math.max(0,difference-baseline[sample]);
          histogram[added]++;sum+=added;maximum=Math.max(maximum,added);
          if(difference>raw) {raw=difference;worst.length=0;}
          if(difference===raw && worst.length<8) worst.push({x:(pixel/4)%surface.width,y:Math.floor(pixel/4/surface.width),gpu:Array.from(gpu.slice(pixel,pixel+3)),cpu:Array.from(cpu.slice(pixel,pixel+3))});
        }
      }
      if(isBaseline) window.__lensBaseline=baseline;
      let cumulative=0,p999=0;
      for(let level=0;level<256;level++) {cumulative+=histogram[level];if(cumulative>Math.floor(count*.999)){p999=level;break;}}
      return {size,mean:sum/count,p999,maximum,raw,worst,renderMs,cpuMs:performance.now()-cpuStarted};

    }, { lane, stock, lookStrength, longEdge: LONG_EDGE, extremeHdr });

    if(process.argv.includes("--inspect")) {
      await page.evaluate(()=>stopPreviewWatchdog());
      LONG_EDGE=1520;
      for(const [name,recipe] of [["none",NEUTRAL],["black_pro_mist",{...NEUTRAL,lens_filter:"black_pro_mist",lens_strength:.5,lens_size:1}],["cinebloom",{...NEUTRAL,lens_filter:"cinebloom",lens_strength:2,lens_size:4,grain_film_format:"super8"}]]) {
        await compare("hdr",recipe,100);
        const times=await page.evaluate(async edge=>{
          const times=[];
          for(let i=0;i<6;i++) {
            const start=performance.now();
            if(!await renderGpuDraft("hdr",{longEdge:edge})) throw Error("Timing render failed");
            await state.gpuPreview.device.queue.onSubmittedWorkDone();
            if(i) times.push(performance.now()-start);
          }
          return times.sort((a,b)=>a-b);
        },LONG_EDGE);
        console.log(`Warmed HDR Fit ${name}: median ${times[2].toFixed(1)} ms; samples ${times.map(v=>v.toFixed(1)).join(", ")}`);
        const png=await page.evaluate(()=>els.previewCanvas.toDataURL("image/png").split(",")[1]);
        const directory=path.resolve(__dirname,"../../output");
        fs.writeFileSync(path.join(directory,`phase3b-highlight-${name}.png`),Buffer.from(png,"base64"));
      }
      return;
    }
    const failures = [];
    for (const edge of (process.argv.includes("--smoke") ? [1520] : [1520,2400])) {
      LONG_EDGE=edge;
    for (const lane of LANES) {
      const off = await compare(lane, NEUTRAL, 100);
      if (off.error) throw new Error(`${lane} off: ${off.error}`);
      for (const { label, stock, look_strength: lookStrength = 100 } of CASES.filter(c => !selectedCase || c.label === selectedCase)) {
        const on = await compare(lane, { ...NEUTRAL, ...stock }, lookStrength);
        if (on.error) throw new Error(`${lane} ${label}: ${on.error}`);

        const mean=on.mean/255,p999=on.p999/255,maximum=on.maximum/255;
        const passed=mean<=MAX_MEAN_DIFFERENCE && p999<=MAX_P999_DIFFERENCE;
        if(!passed) failures.push({lane,label,mean:on.mean,p999:on.p999,worst:on.worst});
        console.log(`Timing edge ${LONG_EDGE} ${lane} ${label}: GPU ${on.renderMs.toFixed(1)} ms (None ${off.renderMs.toFixed(1)}), CPU ${on.cpuMs.toFixed(1)} ms`);
        console.log(
          `${lane} ${label.padEnd(20)} ${on.size[0]}x${on.size[1]}  `
          + `added GPU/CPU difference: mean ${(mean * 255).toFixed(3)} levels, p99.9 ${(p999 * 255).toFixed(1)}, max ${(maximum * 255).toFixed(0)}  `
          + `(raw max ${on.raw}, off max ${off.raw})  ${passed ? "PASS" : "FAIL"}`,
        );
      }
    }
    }
    if (failures.length && inputPath) {
      console.log(`Report only for --input: ${failures.length} case(s) above the synthetic-fixture tolerance.`);
      return;
    }
    if (failures.length) throw new Error(`Film stock preview and export disagree: ${JSON.stringify(failures)}`);
    console.log("Lens filters match between the WebGPU preview and the CPU export.");
  } finally {
    await browser.close();
    if (!inputPath) fs.rmSync(path.dirname(fixturePath), { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
