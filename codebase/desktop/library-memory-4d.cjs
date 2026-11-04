// Opt-in measurement only, reached through the existing test-profile guard.
const fs=require('node:fs'),path=require('node:path');
const {BrowserWindow}=require('electron');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run({app,window,frame,config,stage,backend}){
  const steps=[],points=[];window.show();window.focus();
  const main=code=>window.webContents.executeJavaScript(code);
  const lib=code=>frame.executeJavaScript(code);
  const wait=async(fn,ms=60000)=>{const end=Date.now()+ms;while(!await fn()){if(Date.now()>end)throw Error('4d wait timed out');await sleep(100);}};
  const api=async route=>(await fetch(backend.url+route,{headers:{'X-HDR-Finisher-Token':backend.authoringSecret},signal:AbortSignal.timeout(8000)})).json();
  let current='start',busy=false;
  async function point(){if(busy)return;busy=true;try{
    const windows=BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({pid:w.webContents.getOSProcessId(),url:w.webContents.getURL(),visible:w.isVisible()}));
    const page=await main(`({session:state.session?.session_id,gpu:state.gpuPreview?.gpuAllocator?.snapshot?.(),proof:document.getElementById('chrome-proof-status')?.textContent})`);
    const p={page,at:Date.now(),step:current,memory:await api('/api/library/memory'),windows,electron:app.getAppMetrics()};
    points.push(p);fs.appendFileSync(path.join(config.out,'points.jsonl'),JSON.stringify(p)+'\n');
  }catch(e){fs.appendFileSync(path.join(config.out,'observer-errors.txt'),String(e)+'\n');}finally{busy=false;}}
  const timer=setInterval(point,2000);
  async function step(name,fn){current=name;stage(name);const start=Date.now();try{await fn();await point();}finally{steps.push({name,start,end:Date.now()});fs.writeFileSync(path.join(config.out,'steps.json'),JSON.stringify(steps,null,2));}}
  const open=async photo=>{await main(`(async()=>{await openDesktopSelection({kind:'source',...await hdrFinisherDesktop.grantSourcePath(${JSON.stringify(photo)}),fromLibrary:true});})()`);await wait(()=>main(`HDRGradeSaving.ready()&&!document.body.classList.contains('grade-opening')`));};
  try{
    const setting=await api('/api/library/memory-setting');fs.writeFileSync(path.join(config.out,'setting.json'),JSON.stringify(setting));
    await step('1 grid and preparation',async()=>{await lib(`HDRLibrary.browse(${JSON.stringify(config.folder)})`);await sleep(30000);const grid=await lib(`({library:HDRLibrary.getSnapshot(),scenes:HDRLibraryScenes.snapshot(),shown:document.querySelectorAll('#grid-space canvas[data-picture-key]').length})`);fs.writeFileSync(path.join(config.out,'grid.json'),JSON.stringify(grid,null,2));});
    await step('2 browse and fullscreen',async()=>{await lib(`document.querySelector('#grid-space .library-cell')?.click();document.getElementById('single-view').click();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}));`);await sleep(15000);await lib(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));`);await sleep(15000);await lib(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);});
    await step('3 Grade A and edits',async()=>{await open(config.photoA);for(const value of [.25,.5,.35]){await main(`(()=>{const c=document.getElementById('hdr-exposure');c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:991}));c.value=${value};c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:991}));})()`);await sleep(1500);}await sleep(10000);});
    await step('4 Grade B',async()=>{await open(config.photoB);await sleep(10000);});
    await step('5 popout and dock',async()=>{await lib(`document.getElementById('popout-library').click()`);let detached;await wait(()=>{detached=BrowserWindow.getAllWindows().find(w=>w!==window&&/\/library(?:\?|$)/.test(w.webContents.getURL()));return !!detached;},20000);await sleep(4000);await detached.webContents.executeJavaScript(`document.querySelector('#grid-space .library-cell')?.click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));`);await sleep(10000);await detached.webContents.executeJavaScript(`document.getElementById('popout-library').click()`);await sleep(10000);});
    await step('6 Grade idle 60s',async()=>{await main(`activateWorkflowTab('grade')`);await sleep(60000);});
    await step('7 close Grade',async()=>{await main(`closePhotoInGrade()`);await main(`activateWorkflowTab('import')`);await sleep(10000);});
    await step('8 Library idle 60s',()=>sleep(60000));
    // Proof is optional; observe through the normal UI command, no direct delivery calls.
    await step('9 B reduced Proof',async()=>{await open(config.photoB);await sleep(10000);await main(`activateWorkflowTab('proof');document.getElementById('chrome-proof-refresh').click()`);await wait(()=>main(`!!state.proofReconstruction&&document.getElementById('chrome-proof-image').complete&&document.getElementById('chrome-proof-image').naturalWidth>0`),60000);await sleep(10000);fs.writeFileSync(path.join(config.out,'proof.json'),JSON.stringify(await main(`({status:document.getElementById('chrome-proof-status').textContent,src:document.getElementById('chrome-proof-image').getAttribute('src')?.split('?')[0],size:document.getElementById('chrome-proof-size').value})`)));});
    return {stage:'done',steps,points:points.length};
  }catch(error){return {stage:current,error:String(error.stack||error),steps,points:points.length};}
  finally{clearInterval(timer);}
}
module.exports={run};
