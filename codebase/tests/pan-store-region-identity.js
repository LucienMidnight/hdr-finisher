/** A source region copied from the whole-frame store held for panning must be
 * byte-for-byte the region the backend serves (PAN-FETCH-01). Zooms to each
 * size, waits for the store, loads one region from it and the same region from
 * the backend, and compares the two textures. Disposable session; saves nothing.
 *
 *   node tests/run-in-electron.js tests/pan-store-region-identity.js --project <file> [--zooms 100,50] \n *     [--geometry straighten_angle=2] [--output report.json]
 */
const path = require('node:path');
const { chromium } = require('playwright');
const c = require('./performance/heavy-project-review-common');
const args = process.argv.slice(2), opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const project = path.resolve(opt('--project', ''));
const output = path.resolve(opt('--output', 'output/performance/pan-store-region-identity.json'));
const zooms = opt('--zooms', '100,50').split(',').map(Number);

(async () => {
  const browser = await chromium.launch({ headless: false }), page = await browser.newPage();
  const report = { ...c.manifest(project), rows: [], errors: [] };
  page.on('pageerror', error => report.errors.push(String(error)));
  try {
    await c.open(page, project, false);
    report.geometryEdits = opt('--geometry', '').split(',').filter(Boolean).map(entry => entry.split('='));
    await page.evaluate(geometry => {
      for (const [key, value] of geometry) commitAdjustmentValue(`shared.geometry.${key}`, Number(value), { manual: true });
    }, report.geometryEdits);
    await c.stable(page);
    for (const lane of ['hdr', 'sdr']) {
      await page.evaluate(lane => switchLane(lane), lane); await c.stable(page);
      for (const zoom of zooms) {
        await page.evaluate(zoom => setCustomZoom(zoom), zoom); await c.stable(page);
        const storeKey = await page.evaluate(() => window.HDRSourceTransport.panStoreKey(
          state.session.session_id, state.currentView, requiredProcessingLongEdge(), geometrySignature(), 'source'));
        await page.waitForFunction(key => state.gpuPreview.proxies.has(key), storeKey, { timeout: 30000 });
        const row = await page.evaluate(async storeKey => {
          const renderer = state.gpuPreview, device = renderer.device, lane = state.currentView;
          const edge = requiredProcessingLongEdge(), frame = renderer.proxies.get(storeKey);
          const region = { x: Math.min(512, frame.width - 1024), y: Math.min(1024, frame.height - 768), width: 1024, height: 768 };
          const prefix = `${state.session.session_id}:${lane}:${edge}:${geometrySignature()}:source:region:identity-check-`;
          async function load(name) {
            const proxy = await renderer.loadProxyRegion(state.session.session_id, lane, edge, geometrySignature(),
              state.editRevision, 'source', prefix + name, region, {});
            const bytesPerRow = proxy.textureWidth * (proxy.pixelFormat === 'rgba16float' ? 8 : 16);
            const buffer = device.createBuffer({ size: bytesPerRow * proxy.textureHeight, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToBuffer({ texture: proxy.texture }, { buffer, bytesPerRow }, { width: proxy.textureWidth, height: proxy.textureHeight });
            device.queue.submit([encoder.finish()]);
            await buffer.mapAsync(GPUMapMode.READ);
            const bytes = new Uint8Array(buffer.getMappedRange()).slice();
            buffer.unmap(); buffer.destroy();
            const transferred = renderer.sourceTransportMetrics.transferredBytes;
            renderer.evictGpuCacheEntry('source-proxy', prefix + name);
            return { bytes, transferred, format: proxy.pixelFormat, region: proxy.region };
          }
          const copied = await load('store');
          renderer.evictGpuCacheEntry('source-proxy', storeKey);
          const fetched = await load('backend');
          let different = copied.bytes.length === fetched.bytes.length ? 0 : -1, nonZero = 0;
          if (different === 0) for (let index = 0; index < copied.bytes.length; index++) {
            if (copied.bytes[index] !== fetched.bytes[index]) different++;
            if (fetched.bytes[index]) nonZero++;
          }
          return { lane, zoom: state.zoomPercent, edge, region: fetched.region, format: fetched.format, bytes: fetched.bytes.length,
            copiedTransferredBytes: copied.transferred, fetchedTransferredBytes: fetched.transferred, differentBytes: different, nonZeroBytes: nonZero };
        }, storeKey);
        row.pass = row.differentBytes === 0 && row.copiedTransferredBytes === 0 && row.fetchedTransferredBytes > 0 && row.nonZeroBytes > row.bytes / 4;
        report.rows.push(row); console.log(JSON.stringify(row));
      }
      await page.evaluate(() => setZoomMode('fit')); await c.stable(page);
    }
    report.pass = report.rows.length > 0 && report.rows.every(row => row.pass) && !report.errors.length;
    console.log(report.pass ? 'PASS' : 'FAIL');
    if (!report.pass) process.exitCode = 1;
  } catch (error) {
    report.failure = String(error.stack || error); console.error(report.failure); process.exitCode = 1;
  } finally { c.write(output, report); await browser.close(); }
})();
