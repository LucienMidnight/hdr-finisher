const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const c = require('./performance/heavy-project-review-common');
(async () => {
  const browser = await chromium.launch({headless:true, channel:'msedge'});
  let memory;
  try {
    const page = await browser.newPage();
    page.on('console',m=>{if(m.text().startsWith('Library'))console.log(m.text());});
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8000');
    const photo = require('./helpers/photos-root.cjs').photosPath('D:/Photos/HDR Test Images/iphone_16_pro_IMG_3324.HEIC');
    await page.locator('#file-input').setInputFiles(photo);
    await page.waitForFunction(() => state.session && state.gpuPreview?.available && viewerState().status === 'ready');
    await page.evaluate(async () => {
      commitAdjustmentValue('current.film_look.grain_amount', 50);
      commitAdjustmentValue('current.film_look.halation_amount', 30);
      commitAdjustmentValue('shared.overlay_mode', 'false_color');
      await syncGlobalEditState();
      await refreshOverlay(960);
    });
    await page.waitForFunction(() => state.overlayPresented && els.previewOverlay.naturalWidth > 0);
    console.log("Overlay presented");
    assert.equal(await page.locator('#preview-overlay').isVisible(), true);
    // Let the app's own preview and live-overlay work finish first, so none
    // of it is already on its way to the overlay lane when the burst starts.
    await page.evaluate(() => { state.previewScheduler.cancel(); clearTimeout(state.refreshTimer); });
    await page.waitForFunction(() => !state.gpuDraftInFlight && !state.liveOverlay?.running);
    // Different edges prevent the requests from sharing one cached frame flight.
    // The backend keeps the newest request to ARRIVE, not the newest sent: the
    // browser opens about 6 connections per host, so the last few requests
    // race each other to the server. Any overlay the app itself sends during
    // the burst is counted, because it is newer and may rightly win instead.
    const { statuses: burst, appOverlays } = await page.evaluate(async () => {
      state.previewScheduler.cancel(); clearTimeout(state.refreshTimer);
      const send = window.fetch;
      let appOverlays = 0;
      window.fetch = (url, init) => { if (String(url).includes('/overlay/')) appOverlays++; return send(url, init); };
      try {
        const adjustments = structuredClone(state.adjustments);
        const requests = [];
        for (let i=0; i<40; i++) {
          const grade = structuredClone(adjustments);
          requests.push(send(`/api/session/${state.session.session_id}/overlay/hdr`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({adjustments:grade, long_edge:960+i})
          }).then(async r => { await r.arrayBuffer(); return r.status; }));
        }
        return { statuses: await Promise.all(requests), appOverlays };
      } finally { window.fetch = send; }
    });
    console.log(JSON.stringify({ burstStatuses: burst, appOverlays }));
    assert(burst.every(s => s === 200 || s === 409), `Unexpected overlay statuses: ${burst}`);
    assert(burst.includes(409), 'Superseded overlay requests were not dropped');
    if (appOverlays === 0) {
      // Nothing newer than the burst reached the lane, so the newest arrival
      // must have been rendered, and it can only be one of the final requests
      // still in flight together.
      assert(burst.lastIndexOf(200) >= burst.length - 6, `Newest overlay request was dropped: ${burst}`);
    }
    // What the user sees: after a burst, the overlay is current again.
    await page.evaluate(async () => { await syncGlobalEditState(); await refreshOverlay(960); });
    await page.waitForFunction(() => state.overlayPresented?.revision === state.editRevision
      && state.overlayPresented?.longEdge === 960 && els.previewOverlay.naturalWidth > 0);
    await page.evaluate(() => activateWorkflowTab('import'));
    await page.frameLocator('#library-frame').locator('#popout-library').click();
    await page.evaluate(() => activateWorkflowTab('grade'));
    memory = c.sampler();
    await page.waitForTimeout(2500);
    const selector = '[data-path="hdr.exposure"]';
    await c.reveal(page, selector);
    const box = await page.locator(selector).boundingBox();
    assert(box);
    await page.mouse.move(box.x+box.width*.5, box.y+box.height/2);
    await page.mouse.down();
    const picture = page.evaluate(async photo => {
      for(let i=0;i<20;i++) {
        const r = await fetch('/api/library/picture', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path:photo,edge:320,quality:'quick'})});
        if(r.ok && r.status!==202) {
          const meta = await r.json();
          const pixels = await fetch(meta.pixels_url || `/api/library/pixels/${meta.key}`);
          if (!pixels.ok) console.log('Library pixels refused', pixels.status, meta); return pixels.ok;
        }
        if (!r.ok) console.log('Library refused',r.status,await r.text()); await new Promise(resolve=>setTimeout(resolve,500));
      }
      return false;
    }, path.resolve(__dirname, 'fixtures/sdr_gradient.png'));
    const start = Date.now();
    let moves = 0;
    while (Date.now()-start < 30000) {
      await page.mouse.move(box.x+box.width*(.5+.1*Math.sin(moves++/8)), box.y+box.height/2);
      await page.waitForTimeout(100);
    }
    await page.mouse.up();
    assert(await picture, 'Library did not deliver picture pixels while the slider was moving');
    await page.evaluate(async () => { await syncGlobalEditState(); await refreshOverlay(960); });
    await page.waitForFunction(() => state.overlayPresented?.revision === state.editRevision);
    const recovered = await page.evaluate(async () => {
      const health = await fetch('/health');
      const library = await fetch('/api/library/options');
      return health.ok && library.ok && state.gpuPreview.available;
    });
    assert(recovered, 'Editor/Library did not recover after drag');
    const samples = memory.rows.map(row => row.processes.filter(p => /python|backend/i.test(p.name)).reduce((n,p)=>n+(p.privateBytes ?? p.chargedBytes ?? 0),0)).filter(Boolean);
    assert(samples.length >= 5, 'Backend process memory samples missing');
    const growth = Math.max(...samples)-samples[0];
    assert(growth <= 2*1024**3, `Backend growth exceeded 2 GiB: ${growth}`);
    console.log(JSON.stringify({burstStatuses:burst.reduce((a,n)=>(a[n]=(a[n]||0)+1,a),{}),dragMoves:moves,memoryGrowthBytes:growth,recovered}));
  } finally { memory?.stop(); await browser.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
