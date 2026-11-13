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
      w.__developments = [];
      w.__folderComplete = false;
      const record = w.HDRLibraryStopwatch;
      w.HDRLibraryStopwatch = (stage, fields) => {
        if (stage === 'picture_development_start') w.__developments.push(fields.path);
        if (stage === 'folder_complete') w.__folderComplete = true;
        record(stage, fields);
      };
      w.fetch = (url, options) => {
        if (/live-plan|live-scene|live-developed|live-pixels|\/preview$/.test(String(url)))
          w.__pictureRequests.push(String(url));
        return fetch(url, options);
      };
      const input = w.document.getElementById('thumbnail-size');
      input.value = 360; input.dispatchEvent(new w.Event('input'));
    });
    await library.evaluate((element, folder) => element.contentWindow.HDRLibrary.browse(folder),
      process.env.HDR_LIBRARY_SCROLL_FOLDER || require('./helpers/photos-root.cjs').photosPath('D:/Photos/2026/20261017 badminton'));
    // browse() resolves at the first usable rows, before the streamed list ends.
    await page.waitForFunction(() => document.getElementById('library-frame').contentWindow.__folderComplete,
      null, {timeout:180000});
    await library.evaluate(element => {
      // Capture dates arrive asynchronously and can move the original first
      // photo off the top screen. This checks cache reuse, not metadata sorting.
      element.contentWindow.document.querySelector('#sort-menu [data-sort="name"]').click();
      element.contentWindow.document.getElementById('library-grid').scrollTop = 0;
      element.contentWindow.document.getElementById('library-grid').dispatchEvent(new element.contentWindow.Event('scroll'));
    });
    const settled = () => page.waitForFunction(() => {
      const d = document.getElementById('library-frame').contentWindow.document;
      const bounds = d.getElementById('library-grid').getBoundingClientRect();
      const visible = [...d.querySelectorAll('#grid-space .library-cell')].filter(cell => {
        const r = cell.getBoundingClientRect(); return r.top < bounds.bottom && r.bottom > bounds.top;
      });
      return visible.length > 0 && visible.every(cell => !cell.classList.contains('loading') &&
        cell.querySelector('canvas[data-picture-key]:not([hidden])'));
    }, null, {timeout:180000});
    await settled();
    // Retained DOM insertion order need not match the sorted grid order.
    const firstPath = await library.evaluate(element => element.contentWindow.HDRLibrary.getSnapshot().paths[0]);
    const firstTile = library.contentFrame().locator('#grid-space canvas[data-picture-path=' + JSON.stringify(firstPath) + ']:not([hidden])');
    if (await firstTile.getAttribute('data-camera-preview') === 'true') {
      // Unedited RAWs legitimately keep their camera picture. Prepare this
      // test's finished picture through Develop (cache only; no sidecar edits).
      await firstTile.click({button:'right'});
      await library.contentFrame().getByRole('menuitem', {name:'Develop', exact:true}).click();
      await page.waitForFunction(path => {
        const d = document.getElementById('library-frame').contentWindow.document;
        return [...d.querySelectorAll('#grid-space canvas[data-picture-key]:not([hidden])')].some(canvas =>
          canvas.dataset.picturePath === path && canvas.dataset.cameraPreview !== 'true' &&
          !canvas.closest('.library-cell').classList.contains('loading'));
      }, firstPath, {timeout:180000});
      await settled();
    }
    assert.equal(await firstTile.getAttribute('data-camera-preview'), null, 'Start with a finished picture, not a camera preview');
    const before = await firstTile.screenshot();
    const count = await library.evaluate(element => {
      const w = element.contentWindow;
      const grid = w.document.getElementById('library-grid');
      const bounds = grid.getBoundingClientRect();
      w.__originalTiles = [...w.document.querySelectorAll('#grid-space canvas[data-picture-key]:not([hidden])')].filter(canvas => {
        const r = canvas.closest('.library-cell').getBoundingClientRect();
        return r.top < bounds.bottom && r.bottom > bounds.top;
      });
      grid.scrollTop = grid.clientHeight * 4; grid.dispatchEvent(new w.Event('scroll'));
      return w.__originalTiles.length;
    });
    await settled();
    assert.ok(await library.evaluate(element => element.contentWindow.__originalTiles.some(c => !c.isConnected)),
      'The trip actually leaves the retained one-screen buffer');
    const started = await library.evaluate(element => {
      const w = element.contentWindow; w.__pictureRequests = []; w.__developments = [];
      const grid = w.document.getElementById('library-grid');
      grid.scrollTop = 0; grid.dispatchEvent(new w.Event('scroll'));
      return performance.now();
    });
    await settled();
    const report = await library.evaluate((element, started) => {
      const w = element.contentWindow;
      return {returnMs:performance.now()-started, requests:w.__pictureRequests,
        developments:w.__developments,
        restored:w.__originalTiles.every(c => c.isConnected)};
    }, started);
    if (report.restored) assert.deepEqual(report.requests, [], 'Retained cells make no backend picture requests');
    // A scene-cache hit can rebuild an evicted surface without backend traffic.
    assert.deepEqual(report.developments, [], 'Returning to finished pictures does not redevelop them');
    assert.ok(await firstTile.count(), 'The first picture is restored');
    assert.ok((await firstTile.screenshot()).equals(before), 'Restored surface preserves its displayed pixels');
    console.log(JSON.stringify({returnMs:report.returnMs, reused:count, backendPictureRequests:report.requests.length, restored:report.restored, pixelsPreserved:true}));
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
