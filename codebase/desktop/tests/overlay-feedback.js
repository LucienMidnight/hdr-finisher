const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const codebase = path.resolve(__dirname, '../..');
const output = path.join(codebase, 'output/overlay-feedback');
fs.mkdirSync(output, {recursive:true});
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
const photos = fs.mkdtempSync(path.join(output, 'photos-'));
const photo = path.join(photos, 'gradient.png');
const reviewPhotos=path.join(photos,'review');fs.mkdirSync(reviewPhotos);
fs.mkdirSync(path.join(reviewPhotos,'moved'));
fs.copyFileSync(path.join(codebase, 'tests/fixtures/sdr_gradient.png'),path.join(reviewPhotos,'gradient.png'));
fs.copyFileSync(path.join(codebase, 'tests/fixtures/sdr_gradient.png'), photo);
fs.copyFileSync(path.join(codebase, 'tests/fixtures/linear_unconfirmed.exr'), path.join(reviewPhotos, 'linear.exr'));
fs.writeFileSync(path.join(profile, 'application-preferences.json'), JSON.stringify({theme:'default-dark',updates:{checkAutomatically:false}}));
const launch = () => electron.launch({executablePath:require('electron'), args:[path.join(codebase,'desktop')], cwd:path.join(codebase,'desktop'), env:{...process.env,HDR_FINISHER_USER_DATA_DIR:profile}});
async function close(app) { await app.evaluate(({app})=>app.exit(0)).catch(()=>{}); await app.close(); }
async function drop(surface, filename, target='body') {
  await surface.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='drop-fixture';input.hidden=true;document.body.append(input);});
  await surface.locator('#drop-fixture').setInputFiles(filename);
  await surface.evaluate(target=>{
    const dt=new DataTransfer();dt.items.add(document.querySelector('#drop-fixture').files[0]);
    document.querySelector(target).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
    document.querySelector('#drop-fixture').remove();
  },target);
}
async function library(app,page) {
  await page.waitForFunction(()=>document.body?.dataset.ready==='true',null,{timeout:60000});
  await page.evaluate(()=>activateWorkflowTab('import'));
  const frame=page.frameLocator('#library-frame');
  await frame.locator('#popout-library').click();
  let window;
  for(let i=0;i<100;i++) {window=app.windows().find(p=>new URL(p.url()).pathname==='/library');if(window)break;await page.waitForTimeout(100);}
  assert(window,'Separate Library did not open');
  await window.waitForFunction(()=>Boolean(window.HDRLibrary));return window;
}
(async()=>{
 let app=await launch();
 try {
  const page=app.windows()[0] || await app.waitForEvent('window');
  await page.waitForLoadState('domcontentloaded'); page.setDefaultTimeout(30000); page.on('pageerror',e=>console.error('Renderer:',e.message)); console.log('Main loaded',page.url());
  console.log(await page.evaluate(()=>({ready:document.body.dataset.ready,scheduler:!!state.previewScheduler,shell:!!window.HDRApplicationShell})));
  await page.waitForFunction(()=>document.body.dataset.ready === 'true');
  console.log('Opening appearance'); await page.evaluate(()=>HDRApplicationShell.openSettings('appearance'));
  console.log('Appearance opened');
  await page.locator('[data-theme-option="default-light"]').click(); console.log('Light selected');
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='default-light');
  for(let i=0;i<100 && JSON.parse(fs.readFileSync(path.join(profile,'application-preferences.json'))).theme!=='default-light';i++) await page.waitForTimeout(50);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'application-preferences.json'))).theme,'default-light');
  await page.evaluate(()=>HDRApplicationShell.openSettings('performance'));
  for(const id of ['settings-faster-dragging','settings-rendering-mode','settings-gpu-memory-limit','preview-quality-status']) {
    assert(await page.locator(`#${id}`).isVisible(),`${id} is missing from Performance`);
  }
  assert.equal(await page.locator('#preview-toggle').count(),0);
  assert.equal(await page.locator('#scope-exact-peak').count(),0);
  await page.locator('#settings-close').click();
  console.log('Settings checked'); const docked=page.frames().find(f=>new URL(f.url()).pathname==='/library');
  await drop(docked,photo,'.library-nav');
  await page.waitForFunction(()=>state.session?.source?.filename==='gradient.png',null,{timeout:60000});
  await page.waitForFunction(()=>state.gpuPreview?.available && viewerState().status==='ready',null,{timeout:60000});
  console.log('Docked drop opened'); const project=path.join(photos,'drop.hdrfinisher');
  const saved=await page.evaluate(async ({project,photo})=>{
    const r=await fetch(`/api/session/${state.session.session_id}/project/save`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:project,source_path:photo})});return {ok:r.ok,body:await r.json()};
  },{project,photo});assert(saved.ok,JSON.stringify(saved));
  await page.evaluate(()=>activateWorkflowTab('import'));
  const dockedBefore=await page.evaluate(()=>state.session.session_id);
  await drop(docked,project,'.library-centre');
  await page.waitForFunction(before=>state.session?.session_id!==before && state.projectPath?.endsWith('drop.hdrfinisher'),dockedBefore,{timeout:60000});
  // Both instruments must actually paint pixels over the GPU preview, and react to every option.
  async function overlay(values) {
    await page.evaluate(async values=>{
      for(const [key,value] of Object.entries(values)) commitAdjustmentValue(key,value);
      await syncGlobalEditState();await settlePreview(state.currentView);
    },values);
    await page.waitForFunction(()=>!state.gpuDraftInFlight && !state.previewScheduler.frameInFlight && !state.globalEditDirty,null,{timeout:60000});
    await page.evaluate(()=>refreshOverlay(512));
    await page.waitForFunction(()=>state.overlayPresented?.revision===state.editRevision && els.previewOverlay.complete && els.previewOverlay.naturalWidth>0,null,{timeout:30000});
    return page.evaluate(()=>{
      const img=els.previewOverlay;
      const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
      const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;
      let colored=0,alpha=0,hash=2166136261;for(let i=0;i<data.length;i++){hash=Math.imul(hash^data[i],16777619)>>>0;if(i%4===3){alpha+=data[i];if(data[i])colored++;}}
      return {colored,alpha,hash,display:getComputedStyle(img).display,gpu:state.gpuPreview.available};
    });
  }
  console.log('Checking overlay pixels'); const fc=await overlay({'shared.overlay_mode':'false_color','shared.overlay_opacity':.7});
  assert(fc.gpu && fc.colored && fc.display!=='none');
  const faded=await overlay({'shared.overlay_opacity':.2});assert.notEqual(faded.alpha,fc.alpha);
  assert.notEqual((await overlay({'shared.false_color_band_anchor':'100_nits'})).hash,faded.hash);
  const high=await overlay({'shared.false_color_ceiling_nits':100});
  assert.notEqual((await overlay({'shared.false_color_ceiling_nits':4000})).hash,high.hash);
  const zebra=await overlay({'shared.overlay_mode':'zebra','shared.overlay_threshold':20});assert(zebra.colored);
  const raised=await overlay({'shared.overlay_threshold':200});assert.notEqual(raised.hash,zebra.hash);
  assert.notEqual((await overlay({'hdr.exposure':2})).hash,raised.hash);
  await page.evaluate(async ()=>{commitAdjustmentValue('shared.overlay_mode','off');await syncGlobalEditState();await refreshOverlay();});
  for(const key of ['grain_enabled','halation_enabled']) {
    await page.evaluate(key=>{commitAdjustmentValue(`current.film_look.${key}`,false);renderControlState();},key);
    const label=page.locator(`[data-path="current.film_look.${key}"]`).locator('..');
    assert.equal((await label.locator('.film-toggle-state').textContent()).trim(),'Disabled');
    assert.equal(await label.locator('[data-stock-reset]').count(),0);
    await page.evaluate(key=>{commitAdjustmentValue(`current.film_look.${key}`,true);renderControlState();},key);
    assert.equal((await label.locator('.film-toggle-state').textContent()).trim(),'Enabled');
  }
  await page.evaluate(()=>{const original=state.capabilities;state.capabilities={...original,ultrahdr_encoder:{status:'unavailable',detail:'Test missing encoder'}};renderCapabilities();window.restoreCapabilities=()=>{state.capabilities=original;renderCapabilities();};});
  assert.equal(await page.locator('#capability-summary').count(),0);
  assert(await page.locator('#export-format option[value="jpeg_ultrahdr"]').isDisabled());
  assert.equal(await page.locator('#export-format option[value="jpeg_ultrahdr"]').getAttribute('title'),'Test missing encoder');
  await page.evaluate(()=>restoreCapabilities());
  await page.evaluate(async () => {
    await settlePreview(state.currentView);
    const measure=measureExactScopePeak;window.automaticPeakCalls=0;
    measureExactScopePeak=(...args)=>{window.automaticPeakCalls++;return measure(...args);};
    exactScopePeakCache.clear();await refreshScopes(scopeLongEdge('settled'),{tier:'settled'});
  });
  await page.waitForFunction(()=>window.automaticPeakCalls>0 && !state.gpuScopeRequestInFlight,null,{timeout:60000});
  await page.evaluate(async ()=>{const r=await fetch('/api/library/albums/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Check',paths:[]})});if(!r.ok)throw Error(await r.text());});
  console.log('Editor controls checked'); const lib=await library(app,page);
  assert.equal(await lib.evaluate(()=>document.documentElement.dataset.theme),'default-light');
  await lib.evaluate(async folder=>{await fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[folder]})});await HDRLibrary.browse(folder);},reviewPhotos);
  await lib.waitForFunction(()=>HDRLibrary.getSnapshot().count===2);
  await lib.locator('#sort-button').click();await lib.locator('[data-sort="name"]').click();
  await lib.locator('.library-cell').filter({hasText:'gradient'}).first().click();
  await lib.locator('#single-view').click();
  await lib.waitForFunction(()=>document.querySelector('#single-picture').dataset.pictureKey);
  for(const kind of ['focus','exposure']) {
    await lib.locator(`#${kind}-button`).click();await lib.locator(`#${kind}-enabled`).check();
    await lib.waitForFunction(kind=>HDRLibrary.getSnapshot().overlays.enabled[kind],kind);
    assert.equal((await lib.locator(`[data-switch-for="${kind}-enabled"]`).textContent()).trim(),'Enabled');
    assert.equal(await lib.locator(`#${kind}-options input[type="color"]`).count(),kind==='focus'?1:2);
    await lib.locator(`#${kind}-button`).click();
  }
  await lib.waitForFunction(()=>HDRLibrary.getSnapshot().overlays.maps.filter(m=>m.ready).length>=2,null,{timeout:60000});
  assert.equal(await lib.locator('#library-overlay-legend').count(),0);
  await lib.evaluate(()=>{
    const cell=[...document.querySelectorAll('.library-cell')].find(e=>e.dataset.path.endsWith('gradient.png'));
    const dt=new DataTransfer();cell.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
    document.querySelector('[data-album="Check"]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
  });
  await lib.waitForFunction(async ()=>(await (await fetch('/api/library/albums')).json()).albums.some(a=>a.name==='Check'&&a.count===1));
  for(const zoom of ['fit','100']) {
    if(zoom==='100') await lib.locator('#zoom-button').click();
    await lib.locator('#exposure-button').click();
    await lib.locator('#exposure-highlights').uncheck();assert.equal(await lib.locator('[data-switch-for="exposure-highlights"]').textContent(),'Disabled');
    await lib.locator('#exposure-highlights').check();
    await lib.screenshot({path:path.join(output,`library-${zoom}.png`)});
    await lib.locator('#exposure-button').click();
  }
  await lib.keyboard.press('ArrowRight');
  await lib.waitForFunction(()=>HDRLibrary.getSnapshot().selected?.endsWith('.exr'));
  await lib.waitForFunction(()=>[...document.querySelectorAll('.library-map-status')].some(e=>e.textContent.includes('Exposure unavailable')&&e.textContent.includes('EXR')));
  const before=await page.evaluate(()=>state.session.session_id);
  await drop(lib,project,'.library-nav');
  await page.waitForFunction(before=>state.session?.session_id!==before && state.projectPath?.endsWith('drop.hdrfinisher'),before,{timeout:60000});
  fs.writeFileSync(path.join(photos,'bad.xyz'),'not a photo');await drop(lib,path.join(photos,'bad.xyz'));
  await lib.waitForFunction(()=>document.body.textContent.includes('This file type cannot be opened'));
  // A photo drag must still reach the existing folder move handler.
  await lib.reload();await lib.waitForFunction(()=>Boolean(window.HDRLibrary),null,{timeout:30000});
  await lib.evaluate(folder=>HDRLibrary.browse(folder),reviewPhotos);
  await lib.locator('#folders .library-folder-row .expand-folder').first().click();
  await lib.waitForFunction(()=>[...document.querySelectorAll('#folders .library-folder-row')].some(e=>e.dataset.path.endsWith('moved')));
  await lib.evaluate(()=>{
    const cell=[...document.querySelectorAll('.library-cell')].find(e=>e.dataset.path.endsWith('gradient.png'));
    const dt=new DataTransfer();cell.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
    const target=[...document.querySelectorAll('#folders .library-folder-row')].find(e=>e.dataset.path.endsWith('moved'));
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
  });
  await lib.getByRole('dialog',{name:'Move photos',exact:true}).getByRole('button',{name:'Move photos',exact:true}).click();
  for(let i=0;i<100&&!fs.existsSync(path.join(reviewPhotos,'moved/gradient.png'));i++) await lib.waitForTimeout(100);
  assert(fs.existsSync(path.join(reviewPhotos,'moved/gradient.png')),'Internal folder drop did not move the scratch photo');
  console.log('PASS: GPU overlays, Library Fit/100%, switches, OS and internal drops, unavailable formats, encoder warning, Performance.');
 } finally {await close(app);}
 app=await launch();
 try {
   const page=app.windows()[0] || await app.waitForEvent('window');const lib=await library(app,page);
   for(const surface of [page,lib]) {
     assert.equal(await surface.evaluate(()=>document.documentElement.dataset.theme),'default-light');
     await surface.addInitScript(()=>{requestAnimationFrame(()=>{window.themeAtFirstFrame=document.documentElement.dataset.theme;});});
     await surface.reload();await surface.waitForFunction(()=>window.themeAtFirstFrame);
     assert.equal(await surface.evaluate(()=>window.themeAtFirstFrame),'default-light');
   }
   console.log('PASS: Editor and Library restore saved theme before their first painted frame after restart.');
 } finally {await close(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
