const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'), output=path.join(root,'output','batch-export-ui');
fs.mkdirSync(output,{recursive:true});
const folder=fs.mkdtempSync(path.join(output,'photos-'));
const photos=['first.png','second.png','third.png'].map(name=>path.join(folder,name));
for(const photo of photos)fs.copyFileSync(path.join(root,'tests','fixtures','sdr_gradient.png'),photo);
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage(),errors=[];page.setDefaultTimeout(30000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8000',{waitUntil:'networkidle'});
    for(const workflow of ['grade','proof','export','import']){
      await page.locator(`[data-workflow-tab="${workflow}"]`).click();
      assert.equal(await page.evaluate(()=>document.body.dataset.workflow),workflow);
    }
    await page.waitForFunction(()=>window.batchExport);
    await page.evaluate(async photo=>{await openDesktopSelection({kind:'source',...await desktop.grantSourcePath(photo)});},photos[0]);
    await page.waitForFunction(()=>HDRGradeSaving.ready());
    await page.locator('[data-workflow-tab="export"]').click();
    await page.locator('#batch-preset-editor').waitFor();
    await page.waitForFunction(()=>document.getElementById('batch-summary').textContent.includes('1 photos'));
    assert.equal(await page.locator('#batch-grid').isVisible(),false,'Grade opens Preview');
    await page.evaluate(paths=>window.batchExport.open(paths,{fromLibrary:true}),photos);
    await page.locator('#batch-grid-panel').waitFor();
    assert.equal(await page.locator('.batch-photo').count(),3);
    await page.locator('#batch-preset-rail').getByRole('button',{name:'New preset',exact:true}).click();
    await page.locator('#batch-preset-name').fill('Batch UI '+Date.now());
    await page.locator('#export-format').selectOption('sdr_jpeg');
    await page.locator('#export-preset').selectOption('maximum_fidelity');
    await page.locator('#batch-version-name').fill('SDR');
    await page.locator('#batch-pattern').fill('{filename}_{sequence:3}_{version}');
    await page.locator('#batch-subfolder').fill('SDR');
    await page.locator('#batch-versions').getByRole('button',{name:'+ Add version',exact:true}).click();
    await page.locator('#batch-version-name').fill('PNG');
    await page.locator('#export-format').selectOption('sdr_png');
    await page.locator('#batch-pattern').fill('{filename}_{sequence:3}_{version}');
    await page.locator('#batch-subfolder').fill('PNG');
    await page.locator('#batch-preset-editor').getByRole('button',{name:'Save',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('batch-modified').textContent==='');
    await page.locator('#batch-versions').getByRole('button',{name:'SDR',exact:true}).click();
    assert.equal(await page.locator('#export-format').inputValue(),'sdr_jpeg');
    assert.equal(await page.locator('#export-quality').inputValue(),'100');
    await page.locator('#batch-versions').getByRole('button',{name:'PNG',exact:true}).click();
    assert.equal(await page.locator('#export-format').inputValue(),'sdr_png');
    assert.match(await page.locator('#batch-example').textContent(),/PNG\/first_001_PNG.png/);
    assert.equal(await page.locator('#batch-run').textContent(),'Export 6 files');
    await page.locator('#batch-pattern').fill('{filename}:invalid');
    assert.match(await page.locator('#batch-example').textContent(),/first_invalid/);
    assert.equal(await page.locator('#batch-modified').textContent(),'Modified');
    await page.locator('#batch-preset-editor').getByRole('button',{name:'Revert',exact:true}).click();
    assert.equal(await page.locator('#batch-pattern').inputValue(),'{filename}_{sequence:3}_{version}');
    console.log('grid ready');await page.waitForFunction(()=>[...document.querySelectorAll('.batch-photo canvas')].every(i=>i.dataset.liveTile&&!i.hidden));await page.screenshot({path:path.join(output,'export-grid.png')});
    console.log('opening quick');await page.evaluate(paths=>window.batchExport.quick(paths),photos);console.log('quick opened');
    const dialog=page.getByRole('dialog',{name:'Quick export…',exact:true});await dialog.waitFor();
    assert.match(await dialog.innerText(),/3 photos/);assert.match(await dialog.innerText(),/SDR.*PNG/s);
    await page.screenshot({path:path.join(output,'quick-export.png')});
    await dialog.getByRole('button',{name:'Open Export page',exact:true}).click();await dialog.waitFor({state:'detached'}).catch(async error=>{console.log(await page.locator('#viewer-status-dock').innerText());throw error;});
    await page.locator('.batch-photo').first().click();
    await page.locator('#batch-grid-panel').getByRole('button',{name:'Remove',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.batch-photo').length===2);
    await page.locator('#batch-grid-panel').getByRole('button',{name:'Clear',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.batch-photo').length===0);
    await page.evaluate(paths=>batchExport.open(paths),photos);
    await page.waitForFunction(()=>[...document.querySelectorAll('.batch-photo canvas')].every(i=>i.dataset.liveTile&&!i.hidden));
    // Exercise selection modifiers without the old hidden checkboxes.
    await page.locator('.batch-photo').nth(0).click();
    await page.locator('.batch-photo').nth(2).click({modifiers:['Shift']});
    assert.equal(await page.locator('.batch-photo[aria-selected="true"]').count(),3);
    await page.locator('.batch-photo').nth(1).click({modifiers:['Control']});
    assert.equal(await page.locator('.batch-photo[aria-selected="true"]').count(),2);
    const visualPhotos=[...photos];
    for(let n=4;n<=24;n++){const photo=path.join(folder,`photo-${String(n).padStart(2,'0')}.png`);fs.copyFileSync(photos[(n-1)%3],photo);visualPhotos.push(photo);}
    await page.evaluate(paths=>batchExport.open(paths),visualPhotos);
    await page.waitForFunction(()=>document.querySelectorAll('.batch-photo canvas').length===24&&[...document.querySelectorAll('.batch-photo')].filter(row=>{const r=row.getBoundingClientRect(),g=document.getElementById('batch-grid').getBoundingClientRect();return r.top<g.bottom&&r.bottom>g.top;}).every(row=>row.querySelector('canvas').dataset.liveTile));
    let job={id:'visual-job' ,directory:'D:/Exports',state:'running',completed:1,total:48,active_photo:photos[0],photo_completed:1,photo_total:2,estimated_seconds:30,results:[{photo:photos[0],version:'SDR',outcome:'exported',output_path:'D:/Exports/first_SDR.jpg'}]};
    await page.route('**/api/batch-export',route=>route.fulfill({json:job}));
    await page.route('**/api/batch-export/visual-job',route=>{
      if(route.request().method()==='POST')job={...job,state:JSON.parse(route.request().postData()).action==='pause'?'paused':'running'};
      return route.fulfill({json:job});
    });
    // Only the folder chooser is substituted; no files are written by these
    // deterministic UI states. Python tests cover real worker export results.
    await global.HDRFinisherElectronTestHarness.selectExportDirectory(folder);
    await page.locator('#batch-directory').evaluate(el=>el.value='');
    const size=process.env.HDR_POLISH_SMALL?'1440x900':'2560x1440';
    await page.screenshot({path:path.join(output,`not-started-${size}.png`)});
    await page.locator('#batch-run').click();
    await page.waitForFunction(()=>document.querySelector('.batch-photo progress')?.value===1);
    assert.equal(await page.locator('.batch-photo progress').getAttribute('max'),'2');
    await page.locator('#batch-pause').click();
    await page.waitForFunction(()=>document.getElementById('batch-pause').textContent==='Resume');
    await page.locator('#batch-pause').click();
    const bounds=await page.evaluate(()=>{
      const rect=id=>document.getElementById(id).getBoundingClientRect().toJSON();
      return {grid:rect('batch-grid'),strip:rect('batch-run-strip'),rail:rect('export-sheet'),top:document.querySelector('.top-bar').getBoundingClientRect().toJSON()};
    });
    assert.ok(bounds.grid.bottom<=bounds.strip.top+1,'grid ends above fixed progress strip');
    // The preset has no HDR version, so an SDR-only photo loses nothing and is not flagged.
    assert.equal(await page.locator('.batch-flag').count(),0);
    // Preset rail, batch and control panel headers share one baseline.
    const headers=await page.evaluate(()=>['#batch-preset-rail .panel-title','.batch-header .panel-title','#export-sheet .panel-title'].map(s=>Math.round(document.querySelector(s).getBoundingClientRect().top)));
    assert.ok(Math.max(...headers)-Math.min(...headers)<=2,`column headers line up: ${headers}`);
    assert.ok(bounds.rail.top>=bounds.top.bottom-1,'control panel clears the top bar');
    assert.equal(await page.locator('#viewer-status-dock').isVisible(),false);
    assert.ok(await page.locator('.batch-photo').first().evaluate(el=>el.lastChild.getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom+1),'tile must retain the full caption');
    if(process.env.HDR_POLISH_SMALL)assert.ok(await page.locator('#batch-grid').evaluate(el=>el.scrollHeight>el.clientHeight),'large batch must scroll');
    await page.locator('#export-sheet').evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:path.join(output,`running-${size}.png`)});
    const stripTop=await page.locator('#batch-run-strip').evaluate(el=>el.getBoundingClientRect().top);
    await page.locator('#batch-grid').evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.equal(await page.locator('#batch-run-strip').evaluate(el=>el.getBoundingClientRect().top),stripTop,'scrolling cannot move the status strip');
    await page.locator('#batch-grid').evaluate(el=>el.scrollTop=0);
    job={...job,state:'finished',completed:48,active_photo:null,photo_completed:2,results:visualPhotos.flatMap(photo=>['SDR','PNG'].map(version=>({photo,version,outcome:'exported',output_path:`D:/Exports/${version}/${path.parse(photo).name}_${version}.${version==='SDR'?'jpg':'png'}`})))};
    await page.waitForFunction(()=>!document.getElementById('batch-results').hidden);
    assert.equal(await page.locator('.batch-result').count(),48);
    // Results name the written file with its sub-folder, and say the outcome plainly.
    assert.deepEqual(await page.locator('.batch-result').first().locator('span').allInnerTexts(),['SDR/first_SDR.jpg','first.png · SDR','Exported']);
    await page.screenshot({path:path.join(output,`finished-${size}.png`)});
    await page.locator('#batch-close').click();
    assert.equal(await page.locator('#batch-run-strip').isVisible(),false);
    for(const photo of photos)assert(fs.existsSync(photo));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({photos:3,versions:2,presetRoundTrip:true,liveNames:true,gridPreview:true,quickDialog:true,removeLeavesOriginals:true}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
