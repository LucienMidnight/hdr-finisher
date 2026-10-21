/* GPU-developed camera RAW grid thumbnails in the real app, against Grade's
 * CPU development of the same photos (finished SDR and HDR pictures, agreed
 * perceptual limits). Photos are copied first; originals are only read.
 * Samples: HDR_FINISHER_GPU_RAW_SAMPLES (semicolon-separated paths), else a
 * few of Steve's Play Raw photos; skipped when none exist on this machine. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..'), out = path.join(root, 'output', 'library-gpu-raw');
const python = path.join(root, '.venv', 'Scripts', 'python.exe');
const defaults = [
  'D:/Photos/Play_Raw/Hawai\'ian Fire Dancers - Challenge the Darkside - LaurentFromSF/IMG_0790.CR2',
  'D:/Photos/Play_Raw/An alley at Seoul - lucas faco/2025_0730_1331_3.arw',
  'D:/Photos/Play_Raw/Lakeland landscape in dry Summer/A7R00619.ARW',
  'D:/Photos/Play_Raw/Zebras Crossing - thekman/DSC_3931.NEF',
  'D:/Photos/Play_Raw/Foggy morning at Dunn Lake/IMG_7723.CR3',
];
const samples = (process.env.HDR_FINISHER_GPU_RAW_SAMPLES ? process.env.HDR_FINISHER_GPU_RAW_SAMPLES.split(';') : defaults).filter(p => fs.existsSync(p));
if (!samples.length) { console.log(JSON.stringify({ skipped: 'No sample camera RAWs on this machine.' })); process.exit(0); }
fs.mkdirSync(out, { recursive: true });
const folder = fs.mkdtempSync(path.join(out, 'photos-'));
const photos = samples.map(sample => { const copy = path.join(folder, path.basename(sample)); fs.copyFileSync(sample, copy); return copy; });
const png = path.join(folder, 'not-raw.png');
fs.copyFileSync(path.join(root, 'tests', 'fixtures', 'sdr_gradient.png'), png);

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    const frame = page.frame({ url: /\/library(?:\?|$)/ }) || page.mainFrame();
    await frame.waitForFunction(() => window.HDRLibraryGpuRaw, null, { timeout: 60000 });
    const result = await frame.evaluate(async ({ photos, png }) => {
      const settings = await (await fetch('/api/library/cache-settings')).json();
      const rows = [];
      for (const photo of photos) {
        const started = performance.now();
        const meta = await HDRLibraryGpuRaw.thumbnail(photo, 640);
        rows.push({ path: photo, ms: Math.round(performance.now() - started), key: meta?.key, route: meta?.route, cache_hit: !!meta?.cache_hit, gpu_ms: meta?.gpu_development_ms });
      }
      const again = await HDRLibraryGpuRaw.thumbnail(photos[0], 640);
      const skipped = await HDRLibraryGpuRaw.thumbnail(png, 640);
      return { location: settings.location, rows, againCached: !!again?.cache_hit, againKey: again?.key, skipped };
    }, { photos, png });
    fs.writeFileSync(path.join(out, 'app-result.json'), JSON.stringify(result, null, 1));
    assert.deepEqual(errors, [], 'No page errors');
    for (const row of result.rows) assert.equal(row.route, 'gpu-raw-thumbnail', `${path.basename(row.path)} took the GPU route`);
    assert.ok(result.againCached && result.againKey === result.rows[0].key, 'A repeat request is answered from the cache');
    assert.equal(result.skipped, null, 'A non-RAW photo keeps the CPU route');
    const report = JSON.parse(execFileSync(python, [path.join(root, 'tools', 'gpu_raw_prototype', 'compare_library.py'), path.join(out, 'app-result.json')], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').at(-1));
    console.log(JSON.stringify({ rows: result.rows.map(r => ({ photo: path.basename(r.path), app_ms: r.ms, gpu_ms: r.gpu_ms })), compare: report }));
    for (const row of report.photos) {
      for (const lane of ['sdr', 'hdr']) assert.ok(row[lane].passed, `${row.photo} ${lane}: mean ${row[lane].mean}, p99.9 ${row[lane].p999}`);
    }
  } finally {
    await browser.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
