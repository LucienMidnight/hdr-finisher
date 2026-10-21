/* Run the GPU RAW prototype on prepared photos in headless Edge (WebGPU on the
 * real graphics card) and save its results beside each photo's CPU reference.
 * Usage: node run.js <prepared name> [...]   (names under output/gpu-raw-prototype) */
"use strict";
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const here = __dirname;
const root = path.resolve(here, "..", "..", "output", "gpu-raw-prototype");
const repeats = Number(process.env.GPU_RAW_REPEATS || 3);

const server = http.createServer((request, response) => {
  const url = decodeURIComponent(request.url.split("?")[0]);
  if (request.method === "POST" && url.startsWith("/result/")) {
    const [, , name, file] = url.split("/");
    const target = path.join(root, path.basename(name), path.basename(file));
    const out = fs.createWriteStream(target);
    request.pipe(out); out.on("finish", () => { response.writeHead(200); response.end("ok"); });
    return;
  }
  let file;
  if (url === "/") file = path.join(here, "page.html");
  else if (url === "/library-gpu-raw.js") file = path.join(here, "..", "..", "frontend", "library-gpu-raw.js");
  else if (url.startsWith("/data/")) { const [, , name, base] = url.split("/"); file = path.join(root, path.basename(name), path.basename(base)); }
  if (!file || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript" : file.endsWith(".html") ? "text/html" : "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: "msedge", args: ["--enable-unsafe-webgpu"] });
  try {
    const page = await browser.newPage();
    page.on("console", message => console.log("[page]", message.text()));
    page.on("pageerror", error => console.log("[page error]", error.message));
    await page.goto(base);
    for (const name of process.argv.slice(2)) {
      const summary = await page.evaluate(async ({ name, repeats }) => {
        const meta = await (await fetch(`/data/${name}/meta.json`)).json();
        let fetchMs = [];
        let mosaic;
        for (let k = 0; k < 3; k++) { const t = performance.now(); mosaic = new Uint8Array(await (await fetch(`/data/${name}/mosaic.bin`)).arrayBuffer()); fetchMs.push(performance.now() - t); }
        const runs = [];
        let last;
        for (let k = 0; k < repeats; k++) {
          const started = performance.now();
          last = await window.developRaw({ mosaic, meta, syncStages: true });
          runs.push({ total_ms: performance.now() - started, stages: last.timings });
        }
        // One run without waiting between stages: the realistic end-to-end time.
        const started = performance.now();
        const fast = await window.developRaw({ mosaic, meta, syncStages: false });
        runs.push({ total_ms: performance.now() - started, unsynced: true, stages: fast.timings });
        const post = (file, data) => fetch(`/result/${name}/${file}`, { method: "POST", body: data });
        for (const [edge, r] of Object.entries(last.reduced)) {
          const joined = new Float32Array(r.height * r.width * 3);
          r.planes.forEach((plane, k) => joined.set(new Float32Array(plane), k * r.height * r.width));
          await post(`gpu_${edge}.bin`, joined);
        }
        await post("gpu_samples.bin", last.samples);
        const report = { fetchMs, runs, errors: last.errors, clipped: last.clipped, chroma: last.chroma,
          residualCounts: last.residualCounts, peaks: last.peaks, sampleShape: last.sampleShape,
          reduced: Object.fromEntries(Object.entries(last.reduced).map(([e, r]) => [e, [r.height, r.width]])) };
        await post("gpu.json", JSON.stringify(report, null, 1));
        return report;
      }, { name, repeats });
      console.log(JSON.stringify({ photo: name, fetch_ms: summary.fetchMs.map(Math.round), errors: summary.errors, clipped: summary.clipped,
        runs: summary.runs.map(r => ({ total_ms: Math.round(r.total_ms), unsynced: !!r.unsynced,
          stages: Object.fromEntries(Object.entries(r.stages).map(([k, v]) => [k, Math.round(v)])) })) }));
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
