/** Measurement only: where a native source-region fetch spends its time.
 * Fetches one viewport-sized region of the open project's source as the
 * renderer does, and splits each request into waiting for the backend
 * (headers) and receiving the bytes. Disposable session; saves nothing.
 *
 *   node tests/run-in-electron.js tests/performance/source-tile-transfer-probe.js --project <file> [--output report.json]
 */
const path = require('node:path');
const { chromium } = require('playwright');
const c = require('./heavy-project-review-common');
const args = process.argv.slice(2), opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const project = path.resolve(opt('--project', ''));
const output = path.resolve(opt('--output', 'output/performance/review/source-tile-transfer-probe.json'));

(async () => {
  const browser = await chromium.launch({ headless: false }), page = await browser.newPage();
  const report = { ...c.manifest(project), rows: [] };
  try {
    await c.open(page, project, false);
    report.rows = await page.evaluate(async () => {
      const source = state.session.source, edge = Math.max(source.width, source.height);
      const region = { x: 512, y: 1024, width: Math.min(3584, source.width - 512), height: 2560 };
      const url = (rect, format = 'rgba16f') => `/api/session/${state.session.session_id}/source-tile/${state.currentView}`
        + `?long_edge=${edge}&format=${format}&edit_revision=${state.editRevision}`
        + `&geometry_signature=${encodeURIComponent(geometrySignature())}`
        + `&x=${rect.x}&y=${rect.y}&width=${rect.width}&height=${rect.height}&halo=0`;
      async function one(rect) {
        const started = performance.now(), response = await fetch(url(rect)), headers = performance.now();
        const bytes = (await response.arrayBuffer()).byteLength;
        return { headersMs: headers - started, bodyMs: performance.now() - headers, bytes };
      }
      async function pass(label, chunks, parallel) {
        const rows = Math.ceil(region.height / chunks), rects = [];
        for (let top = 0; top < region.height; top += rows) rects.push({ ...region, y: region.y + top, height: Math.min(rows, region.height - top) });
        const started = performance.now(), results = [];
        let next = 0;
        await Promise.all(Array.from({ length: parallel }, async () => { while (next < rects.length) results.push(await one(rects[next++])); }));
        const wallMs = performance.now() - started, bytes = results.reduce((sum, row) => sum + row.bytes, 0);
        const mean = key => Math.round(results.reduce((sum, row) => sum + row[key], 0) / results.length);
        return { label, chunks, parallel, wallMs: Math.round(wallMs), megabytes: Math.round(bytes / 2 ** 20),
          megabytesPerSecond: Math.round(bytes / 2 ** 20 / (wallMs / 1000)), meanHeadersMs: mean('headersMs'), meanBodyMs: mean('bodyMs') };
      }
      const rows = [];
      await pass('warm-up', 5, 4);
      for (const [chunks, parallel] of [[1, 1], [5, 1], [5, 4], [5, 4], [10, 4], [10, 6], [20, 6]]) {
        rows.push(await pass(`${chunks} chunks, ${parallel} at a time`, chunks, parallel));
      }
      const probe = performance.now();
      await (await fetch(url({ x: 512, y: 1024, width: 1, height: 1 }))).arrayBuffer();
      rows.push({ label: 'one-pixel probe', wallMs: Math.round((performance.now() - probe) * 10) / 10 });
      return rows;
    });
    for (const row of report.rows) console.log(JSON.stringify(row));
  } catch (error) {
    report.failure = String(error.stack || error); console.error(report.failure); process.exitCode = 1;
  } finally { c.write(output, report); await browser.close(); }
})();
