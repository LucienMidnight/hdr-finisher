const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(root,'output','compare-'));
execFileSync(path.join(root,'.venv','Scripts','python.exe'),['-c',"from PIL import Image; from pathlib import Path; import sys; im=Image.open(sys.argv[1]).resize((3000,2000)); [im.save(Path(sys.argv[2])/n) for n in ['a.png','b.png','c.png']]",path.join(root,'tests','fixtures','sdr_gradient.png'),folder]);
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});await page.evaluate(()=>activateWorkflowTab('import'));
 const host=page.locator('#library-frame'),frame=page.frameLocator('#library-frame');await host.evaluate((e,p)=>e.contentWindow.HDRLibrary.browse(p),folder);await frame.locator('.library-cell canvas').first().waitFor();
 const snapshot=()=>host.evaluate(e=>e.contentWindow.HDRLibrary.getSnapshot());
 await frame.locator('#library-grid').focus();await page.keyboard.press('[');await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare.enabled);
 let s=await snapshot();assert.equal(path.basename(s.compare.left),'a.png');assert.equal(path.basename(s.selected),'b.png');assert.deepEqual(s.selection,[s.selected]);
 await frame.locator('.compare-fit').nth(1).waitFor();await page.keyboard.press('z');await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare.sides.every(s=>s.native),null,{timeout:60000});
 const area=await frame.locator('.compare-stage').nth(1).boundingBox();await page.mouse.move(area.x+area.width/2,area.y+area.height/2);await page.mouse.down();await page.mouse.move(area.x+area.width/2-100,area.y+area.height/2-50,{steps:6});await page.mouse.up();
 s=await snapshot();assert.ok(s.zoomCenter[0]>.5);const center=s.zoomCenter;
 await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().selected.endsWith('c.png'));s=await snapshot();assert.equal(path.basename(s.compare.left),'a.png');assert.deepEqual(s.zoomCenter,center);
 await page.keyboard.press('4');await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().marks?.rating===4);await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().marks?.rating===0);
 await frame.locator('#compare-button').click();for(const layout of ['top','split','side']){await frame.locator('#compare-layout').selectOption(layout);await page.waitForFunction(layout=>document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare.layout===layout,layout);}
 await frame.locator('#compare-names').uncheck();await frame.locator('.compare-caption').first().waitFor({state:'hidden'});await frame.locator('#compare-names').check();await frame.locator('.compare-caption').first().waitFor({state:'visible'});
 await frame.locator('#compare-button').click();await frame.locator('#hdr-button').click();assert.ok((await snapshot()).hdr);
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
 await page.waitForFunction(()=>{const c=document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().compare;return c.sides[0].kept&&c.sides[1].native;},null,{timeout:60000});
 assert.equal((await snapshot()).compare.sides[0].native,false);assert.match(await frame.locator('.compare-note').first().textContent(),/Saved Library picture enlarged/);
 assert.deepEqual(errors,[]);console.log('PASS: compare pins, right-only marks/Undo, locked native pan, layouts, captions, HDR, independent virtual copies and mixed edited/native zoom.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
