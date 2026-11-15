const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/w6-interface');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();
 if(process.argv.includes('--baseline'))await page.route('**/static/**',route=>{
 const file=new URL(route.request().url()).pathname.replace('/static/','');
 if(['photo-library.js','library-dialogs.js','photo-library.css','styles.css','visual-controls.css','appearance.js'].includes(file))return route.fulfill({body:require('node:child_process').execFileSync('git',['show',`7d745d28:codebase/frontend/${file}`]),contentType:file.endsWith('.css')?'text/css':'application/javascript'});
 return route.continue();});
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>activateWorkflowTab('import'));
 await page.evaluate(async folder=>{const w=document.querySelector('#library-frame').contentWindow;await w.fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[folder]})});await w.HDRLibrary.refreshPins();const key='hdr-finisher:library-show-all-files';w.localStorage.setItem(key,'true');w.dispatchEvent(new w.StorageEvent('storage',{key,newValue:'true'}));await w.HDRLibrary.browse(folder);},require('./lib/visual-test-photos.cjs')());
 const lib=await (await page.locator('#library-frame').elementHandle()).contentFrame();
 await lib.locator('.library-cell').first().waitFor();
 const timings=[];
 for(let i=0;i<5;i++){
 await lib.evaluate(()=>{window.menuElapsed=null;document.addEventListener('contextmenu',()=>{const start=performance.now();const observer=new MutationObserver(()=>{const m=document.getElementById('library-folder-menu');if(m&&!m.hidden){observer.disconnect();requestAnimationFrame(()=>window.menuElapsed=performance.now()-start);}});observer.observe(document.body,{subtree:true,childList:true,attributes:true});},{capture:true,once:true});});
 await lib.locator('.library-cell').first().click({button:'right'});
 await lib.locator('#library-folder-menu').waitFor({state:'visible'});
 await lib.waitForFunction(()=>window.menuElapsed!==null);timings.push(await lib.evaluate(()=>window.menuElapsed));
 await lib.locator('#library-folder-menu').press('Escape');
 }
 fs.writeFileSync(path.join(out,process.argv.includes('--baseline')?'before.json':'after.json'),JSON.stringify({machine:'MacBook Neo, 8 GB',timings},null,2));console.log({timings});
 if(process.argv.includes('--baseline'))return;
 const checks=[],cdp=await page.context().newCDPSession(page);
 const shot=async(name,loc)=>{await loc.screenshot({path:path.join(out,name+'.png')});};
 // Hold the server answer: commands must be usable while Revert is unknown.
 let release,fulfilled;const held=new Promise(r=>release=r),done=new Promise(r=>fulfilled=r);
 await page.route('**/api/library/grade-reverts',async route=>{await held;await route.fulfill({json:{counts:{original:1}}});fulfilled();});
 await lib.locator('.library-cell').first().click({button:'right'});
 await lib.getByRole('menuitem',{name:/^Open in Grade/}).waitFor();
 assert.equal(await lib.locator('.library-menu-pending').isVisible(),true);
 await lib.locator('#library-folder-menu').press('Escape');release();await done;await page.unroute('**/api/library/grade-reverts');
 await lib.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(await lib.locator('#library-folder-menu').isVisible(),false);
 await lib.locator('#review-view').click();
 await lib.locator('#single-picture').waitFor();
 await lib.locator('body').press('3');await lib.locator('body').press('p');await lib.locator('body').press('7');
 await lib.waitForFunction(()=>{const m=HDRLibrary.getSnapshot().marks;return m?.rating===3&&m.pick==='pick'&&m.label==='orange';});
 assert.equal(await lib.locator('#single-review-marks .library-stars').textContent(),'★★★');
 await shot('fullscreen-marks',lib.locator('#single-stage'));
 await lib.locator('body').press('ArrowRight');
 await lib.waitForFunction(()=>document.querySelector('#single-review-marks .library-stars')?.textContent==='');
 await lib.locator('body').press('Escape');
 // HTML drag events exercise the actual navigation controller, with no file move.
 await lib.evaluate(()=>{
 const handles=[...document.querySelectorAll('.section-handle')],targets=[...document.querySelectorAll('.library-nav-section')];
 const dataTransfer=new DataTransfer();handles[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
 const target=targets[1],r=target.getBoundingClientRect();target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer,clientY:r.top+2}));
 if(!target.classList.contains('nav-insert-before'))throw Error('Missing before line');
 target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer,clientY:r.bottom-2}));
 if(!target.classList.contains('nav-insert-after'))throw Error('Missing after line');
 });
 await shot('navigation-insertion',lib.locator('.library-nav'));
 await lib.evaluate(()=>document.querySelector('.section-handle').dispatchEvent(new DragEvent('dragend',{bubbles:true})));
 await page.evaluate(async()=>{const r=await fetch('/api/proof/test-pattern');await importByteFile(new File([await r.blob()],'w6-interface.tiff',{type:'image/tiff'}));});
 await page.waitForFunction(()=>state.session&&document.body.dataset.workflow==='grade');
 for(const size of [{width:1408,height:794},{width:1100,height:720}]){
 await cdp.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:false});
 for(const theme of ['modern-dark','default-light','studio-gray']){
 await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);await page.locator('#settings-close').click();
 const prefix=theme+'-'+size.width;
 await page.evaluate(()=>{activateWorkflowTab('grade');document.querySelector('[data-group="hdr-tone"]').classList.add('modified');});
 const header=page.locator('[data-group="hdr-tone"] > .control-group-header');await header.scrollIntoViewIfNeeded();
 const order=await header.evaluate(e=>[...e.querySelectorAll('button')].map(b=>({cls:b.className,x:b.getBoundingClientRect().left,w:b.getBoundingClientRect().width,opacity:getComputedStyle(b).opacity})));
 assert.ok(order[0].x<order[1].x&&order[1].x<order[2].x&&order[2].x<order[3].x,JSON.stringify(order));assert.equal(order[2].opacity,'1');
 await shot(prefix+'-header',header);
 await page.locator('#photo-frame-toggle').click();
 const frame=page.locator('#photo-frame-popover');const geom=await frame.evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,scroll:e.scrollHeight,client:e.clientHeight};});
 assert.ok(geom.x>=0&&geom.y>=0&&geom.right<=size.width+1&&geom.bottom<=size.height+1,JSON.stringify(geom));assert.ok(geom.scroll<=geom.client+1,JSON.stringify(geom));
 await shot(prefix+'-frame',frame);await page.locator('#photo-frame-close').click();
 await page.evaluate(()=>activateWorkflowTab('export'));
 await page.locator('#batch-run').waitFor();
 await page.locator('#batch-pattern').click();await page.keyboard.type('W6');
 assert.equal(await page.locator('#batch-pattern').evaluate(e=>getComputedStyle(e).outlineStyle),'none');
 await page.keyboard.press('Shift+Tab');assert.notEqual(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'none');
 await page.locator('#export-sheet .sheet-header').click();
 await page.evaluate(()=>{document.getElementById('batch-pattern').value='{filename}_{version}';for(const id of ['batch-pause','batch-cancel','batch-meter'])document.getElementById(id).hidden=true;for(const id of ['batch-reveal','batch-close'])document.getElementById(id).hidden=false;const strip=document.getElementById('batch-run-strip');strip.hidden=false;document.getElementById('batch-progress').textContent='Finished · 2 of 2 files';document.getElementById('batch-results').hidden=false;document.getElementById('batch-results').innerHTML='<li class="batch-result"><span>photo_HDR.avif</span><span>Written</span></li><li class="batch-result"><span>photo_SDR.jpg</span><span>Written</span></li>';strip.scrollIntoView();});
 const padding=await page.evaluate(()=>{const strip=document.getElementById('batch-run-strip'),footer=document.querySelector('.batch-export-footer');return {strip:getComputedStyle(strip).paddingLeft,footer:getComputedStyle(footer).paddingLeft,border:getComputedStyle(strip).borderBottomWidth,last:getComputedStyle(document.querySelector('.batch-result:last-child')).borderBottomWidth};});assert.equal(padding.strip,padding.footer);assert.equal(padding.border,'0px');assert.equal(padding.last,'0px');
 await shot(prefix+'-export',page.locator('#export-sheet'));
 checks.push({size,theme,frame:geom,header:'DOM and visual order agree',focus:'pointer typing quiet, Tab visible',export:padding});
 await page.evaluate(()=>{document.getElementById('batch-run-strip').hidden=true;activateWorkflowTab('import');});
 await lib.locator('.library-cell').first().click({button:'right'});
 const menu=lib.locator('#library-folder-menu');const menuGeom=await menu.evaluate(e=>{const r=e.getBoundingClientRect();return {size:getComputedStyle(e.querySelector('button')).fontSize,x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
 assert.equal(menuGeom.size,'14.5px');assert.ok(menuGeom.bottom<=size.height+1);await shot(prefix+'-menu',menu);await menu.press('Escape');
 }
 }
 await cdp.detach();fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,timings},null,2));
 console.log('W6 interface checks passed');

}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
