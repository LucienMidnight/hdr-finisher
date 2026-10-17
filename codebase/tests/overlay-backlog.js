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
    const photo = path.resolve(__dirname, '../local-test-media/inputs/iphone-12-pro-HDR.heic');
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
    // Different edges prevent the requests from sharing one cached frame flight.
    const burst = await page.evaluate(async () => {
      state.previewScheduler.cancel(); clearTimeout(state.refreshTimer);
      const adjustments = structuredClone(state.adjustments);
      const requests = [];
      for (let i=0; i<40; i++) {
        const grade = structuredClone(adjustments);
        requests.push(fetch(`/api/session/${state.session.session_id}/overlay/hdr`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({adjustments:grade, long_edge:960+i})
        }).then(async r => { await r.arrayBuffer(); return r.status; }));
      }
      return Promise.all(requests);
    });
    assert(burst.includes(409), 'Superseded overlay requests were not dropped');
    assert.equal(burst.at(-1), 200);
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
    const samples = memory.rows.map(row => row.processes.filter(p => /python|backend/i.test(p.name)).reduce((n,p)=>n+p.privateBytes,0)).filter(Boolean);
    assert(samples.length >= 5, 'Backend process memory samples missing');
    const growth = Math.max(...samples)-samples[0];
    assert(growth <= 2*1024**3, `Backend growth exceeded 2 GiB: ${growth}`);
    console.log(JSON.stringify({burstStatuses:burst.reduce((a,n)=>(a[n]=(a[n]||0)+1,a),{}),dragMoves:moves,memoryGrowthBytes:growth,recovered}));
  } finally { memory?.stop(); await browser.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
