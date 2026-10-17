const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(root,'output','compare-'));
execFileSync(path.join(root,'.venv','Scripts','python.exe'),['-c',"from PIL import Image; from pathlib import Path; import sys; im=Image.open(sys.argv[1]).resize((3000,2000)); [im.save(Path(sys.argv[2])/n) for n in ['a.png','b.png','c.png']]",path.join(root,'tests','fixtures','sdr_gradient.png'),folder]);
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});await page.evaluate(()=>activateWorkflowTab('import'));
 const host=page.locator('#library-frame'),frame=page.frameLocator('#library-frame');await host.evaluate((e,p)=>e.contentWindow.HDRLibrary.browse(p),folder);await frame.locator('.library-cell canvas').first().waitFor();
 const snapshot=()=>host.evaluate(e=>e.contentWindow.HDRLibrary.getSnapshot());
 const checkFilmstrip=async()=>{const geometry=await host.evaluate(e=>{const d=e.contentDocument,f=d.querySelector('#filmstrip'),r=f.getBoundingClientRect();return {height:f.clientHeight,content:d.querySelector('#film-space').offsetHeight,bottom:r.bottom,footer:d.querySelector('.library-footer').getBoundingClientRect().top};});assert.ok(geometry.height>=geometry.content,`Filmstrip clipped: ${JSON.stringify(geometry)}`);assert.ok(geometry.bottom<=geometry.footer,'Filmstrip falls below footer');};
 const wheelZoom=async(stage,picture)=>{
  const read=()=>snapshot().then(s=>({zoom:s.zoom,scale:s.zoomScale})),width=()=>frame.locator(picture).evaluate(e=>e.getBoundingClientRect().width);
  const box=await frame.locator(stage).boundingBox();await page.mouse.move(box.x+box.width*.35,box.y+box.height*.4);
  const before=await read(),beforeWidth=await width();let after=before;
  for(let i=0;i<20&&!(after.zoom&&(!before.zoom||after.scale>before.scale));i++){await page.mouse.wheel(0,-400);await page.waitForTimeout(150);after=await read();}
  assert.ok(after.zoom&&(!before.zoom||after.scale>before.scale),`Wheel up must zoom in: ${JSON.stringify({before,after})}`);
  assert.ok(await width()>beforeWidth,'Wheel zoom must enlarge the actual picture');
  for(let i=0;i<8&&after.zoom;i++){await page.mouse.wheel(0,3000);await page.waitForTimeout(150);after=await read();}
  assert.equal(after.zoom,false,'Wheel down must return to the whole photo');
 };
 await frame.locator('#library-grid').focus();await page.keyboard.press('[');await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare.enabled);
 let s=await snapshot();assert.equal(path.basename(s.compare.left),'a.png');assert.equal(path.basename(s.selected),'b.png');assert.deepEqual(s.selection,[s.selected]);
 await frame.locator('.compare-fit').nth(1).waitFor();await checkFilmstrip();
 const filmWidths=[];
 for(const size of [140,360]){await frame.locator('#thumbnail-size').evaluate((e,size)=>{e.value=size;e.dispatchEvent(new Event('input',{bubbles:true}));},size);filmWidths.push(await frame.locator('#filmstrip .library-cell').first().evaluate(e=>e.getBoundingClientRect().width));await checkFilmstrip();}
 assert.ok(filmWidths[1]>filmWidths[0],'Thumbnail slider must resize filmstrip images');
 await frame.locator('#thumbnail-size').evaluate(e=>{e.value=190;e.dispatchEvent(new Event('input',{bubbles:true}));});
 const fitWidth=await frame.locator('.compare-fit').nth(1).evaluate(e=>e.getBoundingClientRect().width);
 await frame.locator('#zoom-button').click();await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare.sides.every(s=>s.native),null,{timeout:60000});
 assert.ok(await frame.locator('.compare-fit').nth(1).evaluate((e,w)=>e.getBoundingClientRect().width>w,fitWidth),'Compare 100% must enlarge the actual picture');
 await frame.locator('.compare-native').nth(1).waitFor({state:'visible'});
 await frame.locator('#zoom-button').click();assert.equal((await snapshot()).zoom,false);
 await frame.locator('#filmstrip').focus();await page.keyboard.press('z');await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare.sides.every(s=>s.native),null,{timeout:60000});
 const area=await frame.locator('.compare-stage').nth(1).boundingBox();await page.mouse.move(area.x+area.width/2,area.y+area.height/2);await page.mouse.down();await page.mouse.move(area.x+area.width/2-100,area.y+area.height/2-50,{steps:6});await page.mouse.up();
 s=await snapshot();assert.ok(s.zoomCenter[0]>.5);const center=s.zoomCenter;
 await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().selected.endsWith('c.png'));s=await snapshot();assert.equal(path.basename(s.compare.left),'a.png');assert.deepEqual(s.zoomCenter,center);
 await page.keyboard.press('4');await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().marks?.rating===4);await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().marks?.rating===0);
 await frame.locator('#compare-button').click();assert.equal(await frame.locator('[data-compare-state=compare-enabled]').textContent(),'Enabled');for(const layout of ['top','split','side']){await frame.locator('#compare-layout').selectOption(layout);await page.waitForFunction(layout=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare.layout===layout,layout);}
 await frame.locator('#compare-names').uncheck();await frame.locator('.compare-caption').first().waitFor({state:'hidden'});await frame.locator('#compare-names').check();await frame.locator('.compare-caption').first().waitFor({state:'visible'});assert.equal(await frame.locator('[data-compare-state=compare-names]').textContent(),'Enabled');await checkFilmstrip();await frame.locator('#compare-enabled').uncheck();await page.waitForFunction(()=>!document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare.enabled);await checkFilmstrip();await frame.locator('#compare-button').click();await frame.locator('#single-picture[data-picture-path]').waitFor();await wheelZoom('#single-stage','#single-picture');await frame.locator('#compare-button').click();assert.equal(await frame.locator('[data-compare-state=compare-enabled]').textContent(),'Disabled');await frame.locator('#compare-enabled').check();await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare.enabled);await checkFilmstrip();
 await frame.locator('#compare-button').click();await wheelZoom('.compare-stage >> nth=1','.compare-fit >> nth=1');
 await frame.locator('#hdr-button').click();assert.ok((await snapshot()).hdr);
 await frame.locator('.compare-stage').nth(1).dblclick();assert.equal(await page.locator('#app-dialog[open]').count(),0);

 // Create two real virtual items and compare their independent identities.
 await host.evaluate(async(e,folder)=>{const w=e.contentWindow;for(let i=0;i<2;i++){const r=await w.fetch('/api/library/virtual-copies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',paths:[folder+'\\b.png'],start:'clean'})});if(!r.ok)throw new Error(await r.text());}await w.HDRLibrary.browse(folder);},folder);
 await frame.locator('.library-cell[data-path*="|copy|"]').first().waitFor();await frame.locator('.library-cell[data-path*="|copy|"]').first().click();await page.keyboard.press('[');
 await page.waitForFunction(()=>{const c=document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare;return c.left?.includes('|copy|')&&c.right?.includes('|copy|')&&c.left!==c.right;});
 // Save a real edit, then compare its kept picture with a native unedited side.
 const editedPath=path.join(folder,'a.png');await page.evaluate(async photo=>openDesktopSelection({kind:'source',...await desktop.grantSourcePath(photo)}),editedPath);
 await page.waitForFunction(()=>HDRGradeSaving.active());await page.locator('.top-actions #grade-autosave').click();
 await page.evaluate(async()=>{const a=structuredClone(state.adjustments);a.hdr.exposure=1;await queueEditCommand('set_global_adjustments',{adjustments:a});});await page.waitForFunction(()=>state.documentDirty);await page.waitForTimeout(1300);await page.evaluate(()=>HDRGradeSaving.save());
 await page.evaluate(()=>activateWorkflowTab('import'));await host.evaluate((e,p)=>e.contentWindow.HDRLibrary.browse(p),folder);
 await frame.locator('.library-cell canvas[data-kept="true"]').first().waitFor({timeout:60000});await frame.locator('.library-cell').filter({has:frame.locator('canvas[data-kept="true"]')}).first().click();await page.keyboard.press('[');
 await page.waitForFunction(p=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare.left===p,editedPath);
 if((await snapshot()).zoom)await page.keyboard.press('z');await page.keyboard.press('z');
 try { await page.waitForFunction(()=>{const c=document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare;return c.sides[0].kept&&c.sides[1].native;},null,{timeout:60000});} catch(error) {console.error('Compare zoom snapshot:',JSON.stringify(await snapshot()));console.error(await frame.locator('.compare-side').evaluateAll(sides=>sides.map(s=>({note:s.querySelector('.compare-note').textContent,fit:s.querySelector('.compare-fit').getAttribute('style'),native:s.querySelector('.compare-native').getAttribute('style')}))));throw error;}
 assert.equal((await snapshot()).compare.sides[0].native,false);assert.match(await frame.locator('.compare-note').first().textContent(),/Saved Library picture enlarged/);
 assert.deepEqual(errors,[]);console.log('PASS: compare pins, Single and Compare wheel zoom, right-only marks/Undo, locked native pan, layouts, captions, HDR, independent virtual copies and mixed edited/native zoom.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
