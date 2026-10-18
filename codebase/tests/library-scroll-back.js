/* Disposable folder of PNG copies; disposable Electron profile.
 * Scrolling back shows finished Library thumbnails at once: a screen away the
 * same cells are still built, and several screens away the recent pool answers
 * without asking the backend again (Steve, 2026-10-18).
 */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require('playwright');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-library-scroll-back-'));
// A 1200 x 800 photo-sized PNG, so pool entries have real 640 px thumbnail sizes.
function png(width, height) {
  const zlib = require('node:zlib'), rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = y * (width * 3 + 1) + 1 + x * 3; rows[o] = x * 255 / width; rows[o + 1] = y * 255 / height; rows[o + 2] = (x ^ y) & 255;
  }
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const picture = png(1200, 800);
for (let i = 0; i < 160; i++) fs.writeFileSync(path.join(folder, `p${String(i).padStart(3, '0')}.png`), picture);
const onScreenReady = () => {
  const bounds = document.querySelector('#library-grid').getBoundingClientRect();
  const cells = [...document.querySelectorAll('#grid-space .library-cell')].filter(cell => { const r = cell.getBoundingClientRect(); return r.bottom > bounds.top && r.top < bounds.bottom; });
  return cells.length > 0 && cells.every(cell => { const img = cell.querySelector('img'); return img?.dataset.pictureKey && img.complete && !img.hidden; });
};
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'load' });
    await page.evaluate(() => activateWorkflowTab('import'));
    const frame = page.frame({ url: /\/library(?:\?|$)/ }); await frame.waitForFunction(() => window.HDRLibrary);
    // Record thumbnail lookups in the page; watching network traffic overflows the
    // debugging connection once picture uploads start.
    await frame.evaluate(() => {
      window.scrollBackAsked = []; const fetch = window.fetch;
      window.fetch = (url, options) => { if (String(url).includes('/api/library/thumbnails')) try { window.scrollBackAsked.push(...(JSON.parse(options.body).paths || [])); } catch {} return fetch(url, options); };
    });
    // Largest cells: fewer cold uploads for the same number of screens.
    await frame.locator('#thumbnail-size').evaluate(e => { e.value = 360; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await frame.evaluate(f => HDRLibrary.browse(f), folder);
    const grid = frame.locator('#library-grid');
    const scrollTo = async y => { await grid.evaluate((g, y) => { g.scrollTop = y; }, y); await frame.waitForFunction(onScreenReady, null, { timeout: 120000 }); };
    await scrollTo(0);
    const screen = await grid.evaluate(g => g.clientHeight);
    const first = await frame.evaluate(() => {
      const bounds = document.querySelector('#library-grid').getBoundingClientRect();
      return [...document.querySelectorAll('#grid-space .library-cell')].filter(cell => { const r = cell.getBoundingClientRect(); return r.bottom > bounds.top && r.top < bounds.bottom; })
        .map(cell => { cell.dataset.scrollBackMark = '1'; return cell.dataset.path; });
    });
    const snapshot = await frame.evaluate(() => HDRLibrary.getSnapshot());
    assert.ok(snapshot.visible >= first.length && snapshot.visible <= first.length * 2, `On-screen count excludes kept cells: ${snapshot.visible} for ${first.length} on screen`);

    // One screen down and back: the same finished cells come back, already drawn.
    await scrollTo(screen);
    await grid.evaluate(g => { g.scrollTop = 0; });
    const back = await frame.evaluate(paths => paths.map(path => {
      const cell = [...document.querySelectorAll('#grid-space .library-cell')].find(c => c.dataset.path === path);
      return { path, same: cell?.dataset.scrollBackMark === '1', drawn: !!cell?.querySelector('img')?.dataset.pictureKey };
    }), first);
    assert.deepEqual(back.filter(c => !c.same || !c.drawn), [], 'One screen back, finished cells must still be built and drawn');

    // Three screens down and back: cells are rebuilt, but from the recent pool.
    for (let s = 1; s <= 3; s++) await scrollTo(screen * s);
    await frame.evaluate(() => { window.scrollBackAsked.length = 0; });
    await scrollTo(0);
    const asked = await frame.evaluate(() => window.scrollBackAsked);
    const refetched = first.filter(p => asked.includes(p));
    assert.deepEqual(refetched, [], 'Three screens back, the recent pool must answer without a backend request');
    const pool = await frame.evaluate(() => HDRLibraryThumbnailPool.snapshot());
    assert.ok(pool.bytes <= 512 * 1024 ** 2, 'Recent decoded pool stays within 512 MiB');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ onScreen: first.length, visible: snapshot.visible, pool }));
    console.log('PASS: scroll-back keeps finished cells and reuses the recent pool.');
  } finally {
    await browser.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
