/* Native Electron menu stacking, bounded geometry and platform shortcut review.
 * Run with run-native-electron.js through the shared GPU lock. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {_electron}=require('playwright');
const {waitForMainWindow,waitForInitialLoad}=require('./electron-initial-load.js');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/review/menu-shortcuts');fs.mkdirSync(out,{recursive:true});
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-finisher-test-menu-')),profile=path.join(scratch,'test-profile'),folder=path.join(scratch,'photos');
fs.mkdirSync(profile);fs.mkdirSync(folder);fs.copyFileSync(path.join(root,'tests/fixtures/library_photo.png'),path.join(folder,'photo.png'));
fs.writeFileSync(path.join(profile,'pinned-folders.json'),JSON.stringify([folder]));
const records=[];
async function surface(frame,selector){
 await frame.waitForFunction(selector=>document.querySelector(selector)?.matches(':popover-open'),selector);
 const result=await frame.locator(selector).evaluate(e=>{
  const r=e.getBoundingClientRect(),s=getComputedStyle(e),x=Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),y=Math.max(0,Math.min(innerHeight-1,r.top+Math.min(r.height-2,20)));
  return {rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},overflow:s.overflowY,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,hit:e.contains(document.elementFromPoint(x,y)),text:e.textContent};
 });
 assert.ok(result.rect.left>=7&&result.rect.top>=7,JSON.stringify(result));
 assert.ok(result.rect.right<=result.viewport.width-7&&result.rect.bottom<=result.viewport.height-7,JSON.stringify(result));
 assert.ok(result.hit,'surface must receive pointer above app chrome');
 if(result.scrollHeight>result.clientHeight+1)assert.ok(['auto','scroll'].includes(result.overflow));
 records.push({selector,...result});return result;
}
(async()=>{let app,page;try{
 const env={...process.env,HDR_FINISHER_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:require('../desktop/node_modules/electron'),args:[path.join(root,'desktop')],env});
 page=await waitForMainWindow(app);await waitForInitialLoad(app,page);page.setDefaultTimeout(30000);
 await page.waitForFunction(()=>typeof activateWorkflowTab==='function');await page.evaluate(()=>activateWorkflowTab('import'));
 const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);await lib.evaluate(()=>localStorage.setItem('hdr-finisher:library-show-all-files','true'));await lib.goto(lib.url());await lib.waitForFunction(()=>window.HDRLibrary);await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);
 const cell=lib.locator('#grid-space .library-cell').first();await cell.waitFor();await cell.dblclick();
 await page.waitForFunction(()=>HDRGradeSaving.active()&&state.activeWorkflow==='grade'&&!state.gradeOpen);
 await page.evaluate(async()=>{const a=structuredClone(state.adjustments);a.hdr.exposure=.5;await queueEditCommand('set_global_adjustments',{adjustments:a});if(!await HDRGradeSaving.save())throw Error('Save failed');});
 await page.evaluate(()=>activateWorkflowTab('import'));await cell.waitFor();
 const mac=process.platform==='darwin',mod=mac?'Meta':'Control';
 for(const size of [[1408,794],[1100,720]]){
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows().find(w=>/^https?:/.test(w.webContents.getURL())&&!w.webContents.getURL().includes('gpu-delivery')).setSize(...size),size);
  await page.waitForFunction(size=>innerWidth===size[0],size);
  await cell.click({button:'right'});await lib.waitForFunction(()=>!document.querySelector('.library-menu-pending'));
  const info=await surface(lib,'#library-folder-menu');
  assert.equal(await page.locator('#viewer-status-dock').evaluate(e=>getComputedStyle(e).visibility),'hidden','parent status overlay must yield to the iframe top layer');
  assert.ok(info.text.includes(mac?'⌘C':'Ctrl+C')&&info.text.includes(mac?'⇧⌘V':'Ctrl+Shift+V'));
  await page.screenshot({path:path.join(out,`library-${size.join('x')}.png`)});
  await lib.getByRole('menuitem',{name:'Revert to last session',exact:false}).scrollIntoViewIfNeeded().catch(()=>{});
  await page.keyboard.press('Escape');await lib.waitForFunction(()=>document.querySelector('#library-folder-menu').hidden);
 }
 // Physical Command combinations reach the real Library handlers.
 await cell.click();await page.keyboard.press(`${mod}+c`);await lib.waitForFunction(()=>document.querySelector('#library-status').textContent.includes('Grade copied'));
 for(const key of ['v','Shift+v']){
  await lib.locator('#library-grid').focus();await page.keyboard.press(`${mod}+${key}`);
  await lib.locator('dialog[open]').waitFor();assert.match(await lib.locator('dialog[open]').innerText(),mac?/⌘Z/:/Ctrl\+Z/);
  await page.keyboard.press('Escape');await lib.locator('dialog[open]').waitFor({state:'hidden'});
 }
 await lib.locator('#library-grid').focus();await page.keyboard.press(`${mod}+f`);assert.equal(await lib.locator('#library-filterbar').isVisible(),true);await page.keyboard.press(`${mod}+f`);
 const quick=page.waitForFunction(()=>document.querySelector('dialog[open]')||document.body.dataset.workflow==='export');
 await lib.locator('#library-grid').focus();await page.keyboard.press(`${mod}+Shift+e`);await quick;
 await page.keyboard.press('Escape');await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
 // All workflow menus and viewer popovers share top-layer placement.
 for(const workflow of ['grade','proof','export']){
  await page.evaluate(w=>activateWorkflowTab(w),workflow);
  if(workflow!=='export'){
   await page.locator('#overlay-toggle').click();await surface(page,'#overlay-popover');await page.locator('#overlay-toggle').click();
  }else{
   const button=page.locator('.batch-preset-row .top-icon-button').first();await button.click();await surface(page,'.window-menu-popover[popover]');await page.keyboard.press('Escape');
  }
 }
 // Windows custom application menus retain their DOM keyboard navigation on Mac too.
 await page.evaluate(()=>{const button=document.querySelector('.unified-menu-button');button.hidden=false;button.click();});
 await surface(page,'.window-menu-bar');await page.locator('.window-menu-trigger').first().focus();await page.keyboard.press('ArrowRight');await surface(page,'.window-menu .window-menu-popover[popover]');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 // A deliberately taller menu also grows asynchronously and keeps its final row reachable.
 await page.evaluate(()=>{const host=document.createElement('div');host.id='overflow-test-host';host.style.cssText='position:fixed;inset:0;z-index:999999;overflow:hidden;transform:translateZ(0)';const menu=document.createElement('div');menu.id='overflow-test';menu.className='window-menu-popover';menu.setAttribute('role','menu');menu.style.cssText='left:1000px;top:680px';for(let i=0;i<60;i++){const b=document.createElement('button');b.textContent=`Action ${i}`;menu.append(b);}host.append(menu);document.body.append(host);});
 await surface(page,'#overflow-test');await page.locator('#overflow-test button').last().scrollIntoViewIfNeeded();await page.locator('#overflow-test button').last().click();await page.evaluate(()=>document.querySelector('#overflow-test-host').remove());
 // Pop-out Library is a separate native window, using exactly the same helpers.
 await page.evaluate(()=>activateWorkflowTab('import'));const opened=app.waitForEvent('window');await lib.locator('#popout-library').click();
 const popped=await opened;await popped.waitForURL(/\/library/);await popped.waitForFunction(()=>window.HDRLibrary);await popped.locator('#grid-space .library-cell').first().click({button:'right'});await surface(popped,'#library-folder-menu');await popped.screenshot({path:path.join(out,'library-popout.png')});
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({platform:process.platform,records,checks:['native Command copy, paste, choose-paste, filter and quick export','Grade/Proof popovers, Export menus, application menu','minimum/default Library context menus, scroll and separate Library window']},null,2));
 console.log('PASS menu stacking, window bounds, long-menu scrolling and native platform shortcuts.');
}catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.error(await page.evaluate(()=>({workflow:document.body.dataset.workflow,body:document.body.innerText.slice(-1500)})).catch(()=>null));}throw error;}finally{await app?.close();fs.rmSync(scratch,{recursive:true,force:true});}})().catch(error=>{fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error.stack||error),records},null,2));console.error(error);process.exitCode=1;});
