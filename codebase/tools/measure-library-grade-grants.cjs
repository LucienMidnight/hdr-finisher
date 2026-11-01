// Phase 3a: reuse the one line-scan copy; leave no profile or decoded copies.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {hashProjects,checkProjects}=require('../tests/release/runner.cjs');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/test-photos/phase0');
const photo=path.join(folder,fs.readdirSync(folder).find(n=>n.startsWith('line_scan_')&&n.endsWith('.dng')));
const out=path.join(root,'output/phase3a-grade');fs.mkdirSync(out,{recursive:true});
const sidecar=photo+'.hdrf', originalSidecar=fs.existsSync(sidecar)?fs.readFileSync(sidecar):null;
const report={errors:[]},before=hashProjects(require('../tests/release/drivers.json').protectedProjects);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let browser,page,lib;try{
 browser=await chromium.launch();page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto(process.env.HDR_FINISHER_URL);
 await page.evaluate(async photo=>openDesktopSelection({kind:'source',...await desktop.grantSourcePath(photo)}),photo);
 await page.waitForFunction(()=>state.session&&!state.importInProgress&&HDRGradeSaving.active(),null,{timeout:180000});
 report.grade=await page.evaluate(()=>({name:state.session.source.filename,retained:state.session.source.width*state.session.source.height*12}));
 // A small real edit verifies that the close action drains/saves before deleting.
 await page.evaluate(async()=>{const a=structuredClone(state.adjustments);a.hdr.exposure=.125;await queueEditCommand('set_global_adjustments',{adjustments:a});});
 await page.evaluate(()=>activateWorkflowTab('import'));
 lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibraryGrants);
 await lib.evaluate(()=>{window.grantFrames=[];window.grantHttp=[];const original=fetch;window.fetch=(url,args)=>{grantHttp.push({url:String(url),at:performance.now()});return original(url,args);};});
 const opened=Date.now();void lib.evaluate(folder=>HDRLibrary.browse(folder),folder.replaceAll('\\','/'));
 await lib.waitForFunction(()=>HDRLibraryGrants.snapshot().jobs.some(j=>j.reason==='paused for Grade'),null,{timeout:30000});
 report.pauseMs=Date.now()-opened;
 report.paused=await lib.evaluate(()=>HDRLibraryGrants.snapshot());
 await lib.waitForFunction(()=>[...document.querySelectorAll('#grid-space .library-cell')].some(c=>!c.dataset.path.includes('line_scan_')&&c.querySelector('canvas[data-picture-key],img[data-preview="true"]')),null,{timeout:15000});
 report.firstOrdinaryMs=Date.now()-opened;
 const click=Date.now();await lib.evaluate(folder=>HDRLibrary.browse(folder),folder.replaceAll('\\','/'));report.folderClickMs=Date.now()-click;
 await lib.locator('#index-status').click();
 report.heading=await lib.locator('#library-activity').textContent();
 await sleep(1500);report.waitingRequests=await lib.evaluate(()=>grantHttp);
 const closing=Date.now();await lib.getByRole('button',{name:'Close photo in Grade',exact:true}).click();
 await page.waitForFunction(()=>state.session===null,null,{timeout:30000});report.closeMs=Date.now()-closing;
 const closed=Date.now();
 await lib.waitForFunction(()=>!HDRLibraryGrants.snapshot().jobs.some(j=>j.reason==='paused for Grade'),null,{timeout:5000});report.resumeMs=Date.now()-closed;
 report.savedExposure=JSON.parse(fs.readFileSync(photo+'.hdrf','utf8')).grade.global_adjustments.hdr.exposure;
 assert.equal(report.savedExposure,.125);report.noPhoto=await page.evaluate(()=>state.session===null);
 await page.screenshot({path:path.join(out,'screen.png')});
 assert.ok(report.pauseMs<1000,`Pause ${report.pauseMs} ms`);assert.ok(report.firstOrdinaryMs<5000);assert.ok(report.folderClickMs<500);assert.ok(report.resumeMs<2000);assert.deepEqual(report.errors,[]);
}catch(e){report.error=String(e.stack||e);process.exitCode=1;}finally{
 checkProjects(before);report.protectedProjectsUnchanged=true;
 if(originalSidecar)fs.writeFileSync(sidecar,originalSidecar);else if(fs.existsSync(sidecar))fs.unlinkSync(sidecar);
 const log=path.join(global.HDRFinisherElectronTestHarness.userDataDirectory,'logs/backend.log');if(fs.existsSync(log))fs.copyFileSync(log,path.join(out,'backend.log'));
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser?.close();
}})();
