/* Finished live cells survive a trip beyond the one-screen retention buffer. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.env.HDR_FINISHER_URL);
    await page.evaluate(() => activateWorkflowTab('import'));
    const library = page.locator('#library-frame');
    await library.evaluate(element => {
      const w = element.contentWindow, fetch = w.fetch.bind(w);
      w.__pictureRequests = [];
      w.fetch = (url, options) => {
        if (/live-plan|live-scene|live-developed|live-pixels|\/preview$/.test(String(url)))
          w.__pictureRequests.push(String(url));
        return fetch(url, options);
      };
      const input = w.document.getElementById('thumbnail-size');
      input.value = 360; input.dispatchEvent(new w.Event('input'));
    });
    await library.evaluate((element, folder) => element.contentWindow.HDRLibrary.browse(folder),
      process.env.HDR_LIBRARY_SCROLL_FOLDER || 'D:/Photos/2026/20261017 badminton');
    const settled = () => page.waitForFunction(() => {
      const d = document.getElementById('library-frame').contentWindow.document;
      const bounds = d.getElementById('library-grid').getBoundingClientRect();
      const visible = [...d.querySelectorAll('#grid-space .library-cell')].filter(cell => {
        const r = cell.getBoundingClientRect(); return r.top < bounds.bottom && r.bottom > bounds.top;
      });
      return visible.length > 0 && visible.every(cell => cell.querySelector('canvas[data-picture-key]'));
    }, null, {timeout:180000});
    await settled();
    const firstKey = await library.contentFrame().locator('#grid-space .library-cell canvas[data-picture-key]').first().getAttribute('data-picture-key');
    const firstTile = library.contentFrame().locator('canvas[data-picture-key="' + firstKey + '"]');
    const before = await firstTile.screenshot();
    const count = await library.evaluate(element => {
      const w = element.contentWindow;
      w.__originalTiles = [...w.document.querySelectorAll('#grid-space canvas[data-picture-key]')];
      const grid = w.document.getElementById('library-grid');
      grid.scrollTop = grid.clientHeight * 4; grid.dispatchEvent(new w.Event('scroll'));
      return w.__originalTiles.length;
    });
    await settled();
    assert.ok(await library.evaluate(element => element.contentWindow.__originalTiles.some(c => !c.isConnected)),
      'The trip actually leaves the retained one-screen buffer');
    const started = await library.evaluate(element => {
      const w = element.contentWindow; w.__pictureRequests = [];
      const grid = w.document.getElementById('library-grid');
      grid.scrollTop = 0; grid.dispatchEvent(new w.Event('scroll'));
      return performance.now();
    });
    await settled();
    const report = await library.evaluate((element, started) => {
      const w = element.contentWindow;
      return {returnMs:performance.now()-started, requests:w.__pictureRequests,
        restored:w.__originalTiles.every(c => c.isConnected)};
    }, started);
    assert.deepEqual(report.requests, [], 'Recent completed cells make no backend picture requests');
    assert.ok(report.restored, 'Original completed canvas surfaces are restored');
    assert.ok((await firstTile.screenshot()).equals(before), 'Restored surface preserves its displayed pixels');
    console.log(JSON.stringify({returnMs:report.returnMs, reused:count, backendPictureRequests:0, pixelsPreserved:true}));
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
