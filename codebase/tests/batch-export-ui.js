const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'), output=path.join(root,'output','batch-export-ui');
fs.mkdirSync(output,{recursive:true});
const folder=fs.mkdtempSync(path.join(output,'photos-'));
const photos=['first.png','second.png','third.png'].map(name=>path.join(folder,name));
for(const photo of photos)fs.copyFileSync(path.join(root,'tests','fixtures','library_photo.png'),photo);
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage(),errors=[];page.setDefaultTimeout(30000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("hdr-finisher:library-show-all-files", "true"));
    await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8000',{waitUntil:'networkidle'});
    const library=await (await page.locator("#library-frame").elementHandle()).contentFrame();
    assert(library,"Library frame exists");
    const contrasts=await library.evaluate(()=>{
      const cell=document.createElement("div");cell.className="library-cell active lead";
      cell.innerHTML='<div class="picture-frame"></div><span class="name">Selected</span>';
      document.body.append(cell);
      const original=document.documentElement.dataset.theme,results=[];
      const luminance=color=>{
        const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
        return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
      };
      for(const theme of ["default-dark","modern-dark","studio-gray","default-light"]){
        document.documentElement.dataset.theme=theme;
        const ink=getComputedStyle(cell.firstChild),face=getComputedStyle(cell),a=luminance(ink.outlineColor),backgrounds=face.backgroundImage.match(/rgb\([^)]+\)/g)||[face.backgroundColor];
        results.push({theme,contrast:Math.min(...backgrounds.map(color=>{const b=luminance(color);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);})),width:ink.outlineWidth,style:ink.outlineStyle});
      }
      if(original===undefined)delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=original;
      cell.remove();return results;
    });
    for(const result of contrasts){assert.equal(result.width,"2px");assert.equal(result.style,"solid");assert(result.contrast>=7,JSON.stringify(result));}
    console.log("Selected-photo contrast",JSON.stringify(contrasts));
    for(const workflow of ['grade','proof','export','import']){
      await page.locator(`[data-workflow-tab="${workflow}"]`).click();
      assert.equal(await page.evaluate(()=>document.body.dataset.workflow),workflow);
    }
    await page.waitForFunction(()=>window.batchExport);
    await page.evaluate(async photo=>{await openDesktopSelection({kind:'source',...await desktop.grantSourcePath(photo)});},photos[0]);
    await page.waitForFunction(()=>HDRGradeSaving.ready());
    await page.locator('[data-workflow-tab="export"]').click();
    await page.locator('#batch-preset-editor').waitFor();
    await page.waitForFunction(()=>document.getElementById('batch-count').textContent.startsWith('1 photo ·'));
    assert.equal(await page.locator('#batch-grid').isVisible(),false,'Grade opens Preview');
    await page.evaluate(paths=>window.batchExport.open(paths,{fromLibrary:true}),photos);
    await page.locator('#batch-grid-panel').waitFor();
    assert.equal(await page.locator('.batch-photo').count(),3);
    const presetAction=async name=>{await page.getByRole('button',{name:'Export preset actions',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();};
    const versionAction=async name=>{await page.getByRole('button',{name:'Output version actions',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();};
    const answer=async (value,action)=>{await page.locator('#app-dialog-input').fill(value);await page.locator('#app-dialog').getByRole('button',{name:action,exact:true}).click();};
    const renameVersion=async value=>{await versionAction('Rename version…');await answer(value,'Rename');};
    assert.equal(path.resolve(await page.locator('#batch-directory').inputValue()),path.resolve(folder),'default destination is the first source folder');
    const defaultFolder=await page.evaluate(photo=>desktop.defaultBatchExportDirectory(photo),photos[0]);
    assert.equal(path.resolve(defaultFolder.path),path.resolve(folder));assert(defaultFolder.grant,'default folder receives a normal desktop grant');
    await presetAction('New preset…');await answer('Batch UI '+Date.now(),'Create');
    await page.locator('#export-format').selectOption('sdr_jpeg');
    await page.locator('#export-preset').selectOption('maximum_fidelity');
    await renameVersion('SDR');
    await page.locator('#export-watermark-mode').selectOption('rendition_test');
    await page.locator('#export-watermark-text').fill('Delivery test');
    await page.locator('#export-watermark-position').selectOption('top_left');
    await page.locator('#batch-pattern').fill('{filename}_{sequence:3}_{version}');
    await page.locator('#jpeg-advanced-settings > summary').click();
    await page.locator('.batch-advanced-group > summary').filter({hasText:'Subfolder'}).click();
    await page.locator('#batch-subfolder').fill('SDR');
    await versionAction('Add version');
    await renameVersion('PNG');
    await page.locator('#export-format').selectOption('sdr_png');
    await page.locator('#batch-pattern').fill('{filename}_{sequence:3}_{version}');
    await page.locator('#batch-subfolder').fill('PNG');
    await presetAction('Save preset');await page.locator('#app-dialog').getByRole('button',{name:'Save',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('batch-modified').textContent==='');
    await page.locator('#batch-version-select').selectOption({label:'SDR'});
    assert.equal(await page.locator('#export-format').inputValue(),'sdr_jpeg');
    assert.equal(await page.locator('#export-quality').inputValue(),'100');
    assert.equal(await page.locator('#export-watermark-mode').inputValue(),'rendition_test');
    assert.equal(await page.locator('#export-watermark-text').inputValue(),'Delivery test');
    assert.equal(await page.locator('#export-watermark-position').inputValue(),'top_left');
    await page.locator('#batch-version-select').selectOption({label:'PNG'});
    assert.equal(await page.locator('#export-format').inputValue(),'sdr_png');
    assert.match(await page.locator('#batch-example').textContent(),/PNG\/first_001_PNG.png/);
    assert.equal(await page.locator('#batch-run').textContent(),'Export 6 files');
    await page.locator('#batch-pattern').fill('{filename}:invalid');
    assert.match(await page.locator('#batch-example').textContent(),/first_invalid/);
    assert.equal(await page.locator('#batch-modified').textContent(),'Unsaved changes');
    await presetAction('Revert changes');
    assert.equal(await page.locator('#batch-pattern').inputValue(),'{filename}_{sequence:3}_{version}');
    await page.locator('#export-resize-mode').selectOption('long_edge');
    await page.locator('#export-long-edge').fill('1920');
    const geometry=await page.evaluate(()=>{
      const rect=id=>document.getElementById(id).getBoundingClientRect();
      const field=document.querySelector('.batch-unit-field').getBoundingClientRect(),toggle=rect('export-prevent-enlargement');
      const suffix=document.querySelector('.batch-unit-field > span').getBoundingClientRect();
      return {fieldLeft:field.left,toggleLeft:toggle.left,suffixInside:suffix.right<=field.right&&suffix.left>=field.left};
    });
    assert.ok(Math.abs(geometry.fieldLeft-geometry.toggleLeft)<2,'toggle starts at field column');
    assert(geometry.suffixInside,'pixel suffix stays inside dimension field');
    const exportLayout=await page.evaluate(()=>{
      const rect=el=>el.getBoundingClientRect();
      const frame=document.getElementById('export-with-frame'),label=frame.previousElementSibling;
      const pattern=document.getElementById('batch-pattern'),tokens=document.querySelector('[aria-label="Insert filename token"]');
      return {labelLeft:rect(label).left,labelRight:rect(label).right,frameLeft:rect(frame).left,pattern:rect(pattern).toJSON(),tokens:rect(tokens).toJSON()};
    });
    assert(exportLayout.labelRight<=exportLayout.frameLeft,'frame label precedes the switch');
    assert.ok(Math.abs(exportLayout.frameLeft-geometry.toggleLeft)<2,'frame and enlargement switches share a column');
    assert(exportLayout.tokens.top>=exportLayout.pattern.bottom,'token menu sits below the pattern');
    assert.ok(Math.abs(exportLayout.tokens.width-exportLayout.pattern.width)<2,'naming controls use the full field width');
    assert.equal(await page.locator('#export-framing-note').isVisible(),false);
    assert.equal(await page.locator('#batch-example').isVisible(),false);
    for(const trigger of ['#batch-preset-editor h2','#export-with-frame','#batch-pattern-help']){
      const target=trigger==='#export-with-frame'?page.locator('#export-with-frame').locator('..').locator('span'):page.locator(trigger);
      await target.hover();
      await page.locator('#bounded-help-tooltip').waitFor({state:'visible'});
      assert((await page.locator('#bounded-help-tooltip').innerText()).length>20,'help appears on label hover');
      await page.locator('#batch-pattern').click();
      await page.locator('#bounded-help-tooltip').waitFor({state:'hidden'});
    }
    const originalPattern=await page.locator('#batch-pattern').inputValue();
    await page.locator('[aria-label="Insert filename token"]').selectOption('rating');
    assert.match(await page.locator('#batch-pattern').inputValue(),/\{rating\}/,'token insertion still updates the pattern');
    await page.locator('#batch-pattern').fill(originalPattern);
    const expandedLeft=await page.locator('#batch-grid-panel').evaluate(el=>el.getBoundingClientRect().left);
    await page.getByRole('button',{name:'Collapse export presets',exact:true}).click();
    assert.equal(await page.locator('#batch-preset-list').isVisible(),false);
    assert(await page.locator('#batch-grid-panel').evaluate((el,left)=>el.getBoundingClientRect().left<left,expandedLeft),'collapse gives space to the center');
    await page.getByRole('button',{name:'Expand export presets',exact:true}).click();
    assert.equal(await page.locator('#batch-preset-list').isVisible(),true);
    assert.equal(await page.locator('#batch-grid-panel').evaluate(el=>el.getBoundingClientRect().left),expandedLeft);
    assert.equal(await page.locator('#proof-workflow-panel .panel-title').textContent(),'Proof Settings');
    await page.locator('#export-prevent-enlargement').uncheck();assert.equal(await page.locator('#export-prevent-enlargement').isChecked(),false);
    const footerTop=await page.locator('.batch-export-footer').evaluate(el=>el.getBoundingClientRect().top);
    await page.locator('.batch-settings-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.equal(await page.locator('.batch-export-footer').evaluate(el=>el.getBoundingClientRect().top),footerTop,'destination stays fixed while settings scroll');
    await page.locator('.batch-settings-scroll').evaluate(el=>el.scrollTop=0);
    await page.locator('#jpeg-advanced-settings > summary').click();
    await page.evaluate(()=>batchExport.open([HDRGradeSaving.item()],{fromLibrary:false}));
    await page.screenshot({path:path.join(output,'export-preview.png')});
    await page.evaluate(paths=>batchExport.open(paths,{fromLibrary:true}),photos);
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
    await page.locator('.batch-export-footer').getByRole('button',{name:'Browse…',exact:true}).click();
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
    // The export log sits in Export Settings under Advanced settings, and the
    // shared status bar says the app is exporting (November 8).
    assert.ok(await page.locator('#export-sheet #batch-run-strip').count()===1,'export log lives in the settings panel');
    assert.ok(await page.evaluate(()=>{const a=document.querySelector('#export-sheet details.batch-settings-section');return !!(a.compareDocumentPosition(document.getElementById('batch-run-strip'))&Node.DOCUMENT_POSITION_FOLLOWING);}),'export log follows Advanced settings');
    assert.match(await page.locator('#application-status-entries [data-status-id="batch-export"]').innerText(),/Export(ing| paused) \d+ of \d+/);
    // The preset has no HDR version, so an SDR-only photo loses nothing and is not flagged.
    assert.equal(await page.locator('.batch-flag').count(),0);
    // Preset rail and control panel headers share one baseline; the batch title
    // sits in the bottom bar under the grid (November 7).
    const headers=await page.evaluate(()=>['#batch-preset-rail .panel-title','#export-sheet .panel-title'].map(s=>Math.round(document.querySelector(s).getBoundingClientRect().top)));
    assert.ok(Math.max(...headers)-Math.min(...headers)<=2,`column headers line up: ${headers}`);
    assert.ok(bounds.rail.top>=bounds.top.bottom-1,'control panel clears the top bar');
    // Export shows the shared status bar under the batch (UI polish, November 4).
    assert.equal(await page.locator('#viewer-status-dock').isVisible(),true);
    assert.ok(await page.locator('.batch-photo').first().evaluate(el=>el.lastChild.getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom+1),'tile must retain the full caption');
    if(process.env.HDR_POLISH_SMALL)assert.ok(await page.locator('#batch-grid').evaluate(el=>el.scrollHeight>el.clientHeight),'large batch must scroll');
    await page.locator('#export-sheet').evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:path.join(output,`running-${size}.png`)});
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
  }finally{try { await browser.close(); } finally { fs.rmSync(folder,{recursive:true,force:true}); }}
})().catch(error=>{console.error(error);process.exitCode=1;});
