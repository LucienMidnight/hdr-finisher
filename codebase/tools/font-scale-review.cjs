// Captures the Library, Details panel, application menu and Grade panels so the
// shared type scale can be reviewed. Also reports any text drawn below the
// minimum size. Run through tests/run-in-electron.js. Overwrites its folder.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const label=(process.argv.find(a=>a.startsWith('--label='))||'--label=after').slice(8);
const out=path.resolve(__dirname,'../output/review/ui-polish/fonts');fs.mkdirSync(out,{recursive:true});
const MIN=11;
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'domcontentloaded'});
 await page.frameLocator('#library-frame').locator('#single-view').waitFor();
 await page.evaluate(async folder=>{const lib=document.querySelector('#library-frame').contentWindow;
 await lib.fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[folder]})});await lib.HDRLibrary.refreshPins();
 const key='hdr-finisher:library-show-all-files';lib.localStorage.setItem(key,'true');lib.dispatchEvent(new lib.StorageEvent('storage',{key,newValue:'true'}));await lib.HDRLibrary.browse(folder);
 },require('./lib/visual-test-photos.cjs')());
 const lib=page.frameLocator('#library-frame');
 await lib.locator('.library-cell[data-path]').first().waitFor({timeout:30000});await lib.locator('.library-cell[data-path]').first().click();
 await page.waitForTimeout(1500);
 const cdp=await page.context().newCDPSession(page);
 const shot=async(name,loc)=>{await loc.evaluate(e=>e.ownerDocument.fonts.ready);await loc.screenshot({path:path.join(out,label+'-'+name+'.png')});};
 const small=async(frame)=>frame.evaluate(min=>{const seen={};for(const e of document.querySelectorAll('body *')){if(!e.getClientRects().length)continue;const direct=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!direct)continue;const s=parseFloat(getComputedStyle(e).fontSize);if(s&&s<min){const k=(e.id?'#'+e.id:e.tagName.toLowerCase()+'.'+[...e.classList].join('.'))+' '+s+'px';seen[k]=(seen[k]||0)+1;}}return seen;},MIN);
 const report={};
 for(const width of [2560,1100]){
 await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:width>2000?1440:800,deviceScaleFactor:1,mobile:false});
 await page.evaluate(()=>activateWorkflowTab('import'));await page.waitForTimeout(400);
 await shot(width+'-library-toolbar',lib.locator('.library-toolbar'));
 await shot(width+'-library-details',lib.locator('.library-details'));
 await shot(width+'-library-nav',lib.locator('.library-nav'));
 await page.screenshot({path:path.join(out,label+'-'+width+'-library-window.png')});
 report['library '+width]=await small(page.frames().find(f=>/\/library/.test(f.url())));
 }
 await page.locator('.unified-menu-button').click();await page.locator('.window-menu-trigger').first().hover();await page.waitForTimeout(200);
 await page.screenshot({path:path.join(out,label+'-1100-app-menu.png'),clip:{x:0,y:0,width:520,height:420}});
 await page.keyboard.press('Escape');
 await page.evaluate(async()=>{const r=await fetch('/api/proof/test-pattern');await importByteFile(new File([await r.blob()],'fonts.tiff',{type:'image/tiff'}));});
 await page.waitForFunction(()=>state.session&&document.body.dataset.workflow==='grade');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:2560,height:1440,deviceScaleFactor:1,mobile:false});
 await page.waitForTimeout(800);
 await page.screenshot({path:path.join(out,label+'-2560-grade-window.png')});
 report.grade=await small(page.mainFrame());
 await page.evaluate(()=>activateWorkflowTab('export'));await page.waitForTimeout(600);
 await page.screenshot({path:path.join(out,label+'-2560-export-window.png')});
 report.export=await small(page.mainFrame());
 report.errors=errors;
 fs.writeFileSync(path.join(out,label+'-small-text.json'),JSON.stringify(report,null,1));
 await cdp.detach();
 console.log('Font review captured:',out);
 }finally{
 await browser.close();
 const profile=global.HDRFinisherElectronTestHarness?.userDataDirectory;
 const temp=path.resolve(require('node:os').tmpdir());
 if(profile&&path.dirname(path.resolve(profile))===temp&&path.basename(profile).startsWith('hdr-finisher-electron-test-')){try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch(error){console.warn('Disposable profile cleanup blocked:',profile,error.code);}}
 }})().catch(e=>{console.error(e);process.exitCode=1;});
