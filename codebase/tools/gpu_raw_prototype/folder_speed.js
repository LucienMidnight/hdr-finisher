/* Whole-folder throughput: camera RAW grid thumbnails through the GPU route
 * and through Grade's CPU route, four at a time as the grid requests them.
 * Run in the app: node tests/run-in-electron.js tools/gpu_raw_prototype/folder_speed.js
 * Photos are read in place (read-only); results go to the run's own cache.
 * HDR_FINISHER_SPEED_FOLDER and HDR_FINISHER_SPEED_COUNT choose the photos. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const folder = process.env.HDR_FINISHER_SPEED_FOLDER || 'D:/Photos/2026/20261017 badminton';
const count = Number(process.env.HDR_FINISHER_SPEED_COUNT || 24);
const raws = fs.existsSync(folder) ? fs.readdirSync(folder).filter(name => /\.(arw|cr2|cr3|nef|orf)$/i.test(name)).sort() : [];
if (raws.length < 2 * count) { console.log(JSON.stringify({ skipped: `Need ${2 * count} RAWs in ${folder}.` })); process.exit(0); }
// Different photos for each route, so neither benefits from the other's cache.
const gpuPhotos = raws.slice(0, count).map(name => path.join(folder, name));
const cpuPhotos = raws.slice(count, 2 * count).map(name => path.join(folder, name));
const out = path.resolve(__dirname, '..', '..', 'output', 'gpu-raw-prototype', 'folder-speed.json');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    const frame = page.frame({ url: /\/library(?:\?|$)/ }) || page.mainFrame();
    await frame.waitForFunction(() => window.HDRLibraryGpuRaw, null, { timeout: 60000 });
    const result = await frame.evaluate(async ({ gpuPhotos, cpuPhotos }) => {
      const pool = async (items, work, width = 4) => {
        const times = [], started = performance.now(); let next = 0;
        await Promise.all(Array.from({ length: width }, async () => {
          while (next < items.length) {
            const item = items[next++], t = performance.now();
            const meta = await work(item);
            times.push({ ms: performance.now() - t, route: meta?.route });
          }
        }));
        const sorted = times.map(t => t.ms).sort((a, b) => a - b);
        return { total_s: (performance.now() - started) / 1000, per_photo_s: (performance.now() - started) / 1000 / items.length,
          median_ms: sorted[Math.floor(sorted.length / 2)], p90_ms: sorted[Math.floor(sorted.length * 0.9)], routes: [...new Set(times.map(t => t.route))] };
      };
      // Warm the GPU pipelines once, as an idle launch would.
      await HDRLibraryGpuRaw.thumbnail(gpuPhotos[0], 640);
      const gpu = await pool(gpuPhotos.slice(1), photo => HDRLibraryGpuRaw.thumbnail(photo, 640));
      const cpu = await pool(cpuPhotos, async photo => {
        for (;;) {
          const response = await fetch('/api/library/picture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: photo, edge: 640, quality: 'quick', purpose: 'thumbnail', priority: 10 }) });
          if (response.status === 202) { await new Promise(r => setTimeout(r, 150)); continue; }
          return response.json();
        }
      });
      return { gpu, cpu };
    }, { gpuPhotos, cpuPhotos });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ folder, count, ...result }, null, 1));
    console.log(JSON.stringify({ folder, count, ...result }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
