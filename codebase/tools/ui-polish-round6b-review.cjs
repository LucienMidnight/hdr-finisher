const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/ui-polish/round-6');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'domcontentloaded'});
 await page.frameLocator('#library-frame').locator('#single-view').waitFor();
 await page.evaluate(async folder=>{const lib=document.querySelector('#library-frame').contentWindow;
 await lib.fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[folder]})});await lib.HDRLibrary.refreshPins();
 const key='hdr-finisher:library-show-all-files';lib.localStorage.setItem(key,'true');lib.dispatchEvent(new lib.StorageEvent('storage',{key,newValue:'true'}));await lib.HDRLibrary.browse(folder);
 },require('./lib/visual-test-photos.cjs')());
 await page.evaluate(async()=>{const r=await fetch('/api/proof/test-pattern');await importByteFile(new File([await r.blob()],'round6.tiff',{type:'image/tiff'}));});
 await page.waitForFunction(()=>state.session&&document.body.dataset.workflow==='grade');
 const cdp=await page.context().newCDPSession(page);
 const shot=async(name,loc)=>{await loc.evaluate(e=>e.ownerDocument.fonts.ready);await loc.screenshot({path:path.join(out,name+'.png')});};
 const contained=async(loc)=>loc.evaluate(e=>{const p=e.getBoundingClientRect();return {parent:{left:p.left,right:p.right,top:p.top,bottom:p.bottom},children:[...e.querySelectorAll('button,input[type=range]')].filter(x=>x.getClientRects().length&&!x.closest('[hidden], .workflow-side-panel')).map(x=>{const r=x.getBoundingClientRect();return {id:x.id||x.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};});
 const check=async(loc,label)=>{const g=await contained(loc);for(let i=0;i<g.children.length;i++)for(let j=i+1;j<g.children.length;j++){const a=g.children[i],b=g.children[j];assert.ok(Math.min(a.right,b.right)-Math.max(a.left,b.left)<1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<1,label+' overlapping controls '+a.id+' / '+b.id);}assert.ok(g.children.every(r=>r.left>=g.parent.left-1&&r.right<=g.parent.right+1&&r.top>=g.parent.top-1&&r.bottom<=g.parent.bottom+1),label+JSON.stringify(g));};

 for(const width of (process.argv.includes("--tooltip-only")?[]:[1100,1200,1201,1300,1500])){
 await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
 for(const theme of ['modern-dark','default-light','studio-gray']){
 await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);await page.locator('#settings-close').click();
 for(const closed of [false,true]){
 const pre=theme+'-'+width+'-'+(closed?'closed':'open');
 await page.evaluate(()=>activateWorkflowTab('import'));
 const lib=page.frameLocator('#library-frame');
 await lib.locator('.library').evaluate((e,c)=>{e.classList.toggle('library-left-closed',c);e.classList.toggle('library-right-closed',c);},closed);
 for(const mode of ['grid','single']){
 await lib.locator('#'+mode+'-view').click();await check(lib.locator('.library-toolbar'),pre+' Library '+mode);
 await shot(pre+'-library-'+mode,lib.locator('.library-toolbar'));
 }
 for(const workflow of ['grade','proof','export']){
 await page.evaluate(w=>activateWorkflowTab(w),workflow);
 await page.evaluate(c=>{state.wideSourceCollapsed=c;state.compactSourceOpen=!c;applyResponsiveWorkspaceState();state.layout.dockOpen=!c;applyLayoutState();},closed);
 await check(page.locator('.top-bar'),pre+' top');
 const toolbar=page.locator(workflow==='export'?'.batch-header':'.viewer-bar');
 await check(toolbar,pre+' '+workflow);await shot(pre+'-'+workflow,toolbar);
 if(workflow==='export'){
 await page.locator('#batch-view-preview').click();await check(page.locator('.viewer-bar'),pre+' Export Single');
 await shot(pre+'-export-single',page.locator('.viewer-bar'));await page.locator('#batch-view-grid').click();
 }
 }
 await shot(pre+'-top',page.locator('.top-bar'));
 checks.push(pre+' all toolbars contained');
 }
 }
 }
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false});
 await page.evaluate(()=>activateWorkflowTab('grade'));
 await page.locator('#overlay-toggle').hover();
 await page.screenshot({path:path.join(out,'hovered-overlays-tooltip.png'),clip:{x:230,y:40,width:Math.min(850, await page.evaluate(()=>innerWidth)-230),height:100}});
 assert.deepEqual(errors,[]);await cdp.detach();
 if(!process.argv.includes('--tooltip-only'))fs.writeFileSync(path.join(out,'checks-6b.json'),JSON.stringify({checks,errors},null,2));
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Toolbar fit review</title><style>body{background:#292929;color:#eee;font:16px system-ui}img{max-width:100%;height:auto}figure{margin:16px}</style><h1>Toolbar fit review</h1>'+fs.readdirSync(out).filter(f=>f.endsWith('.png')).map(f=>`<figure><figcaption>${f}</figcaption><img src="${f}"></figure>`).join(''));
 console.log('Toolbar fit review passed:',out);
 }finally{
 await browser.close();
 const profile=global.HDRFinisherElectronTestHarness?.userDataDirectory;
 const temp=path.resolve(require('node:os').tmpdir());
 if(profile&&path.dirname(path.resolve(profile))===temp&&path.basename(profile).startsWith('hdr-finisher-electron-test-')){try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch(error){console.warn('Disposable profile cleanup blocked:',profile,error.code);}}
 }} )().catch(e=>{console.error(e);process.exitCode=1;});
