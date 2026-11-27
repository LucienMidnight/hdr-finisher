const reusePhoto=require('./helpers/reuse-test-photo.cjs');
/* Same three photos and settings, Export page open versus closed. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-export-live-tiles',String(Date.now()));fs.mkdirSync(folder,{recursive:true});
// Two 42 MP Sony RAWs exercise native CPU strips at 4 GB. Use the curated
// 10.5 MP Sony RAW for the GPU case without resizing output or raising memory.
const photos=['DSC00264.ARW','DSC04375.ARW','DSC00512.ARW'].map(name=>reusePhoto(reusePhoto.source(name),path.join(folder,name)));
// Exports land beside the reused photos. Delete this run's exports and export
// staging, pass or fail; keep the reused photo copies and anything already there.
const photoFolder=path.dirname(photos[0]),existing=new Set(fs.readdirSync(photoFolder)),exported=new Set();
function removeExports(){for(const file of exported)fs.rmSync(file,{force:true});
 for(const name of fs.readdirSync(photoFolder))if(!existing.has(name)&&(/_Version \d/.test(name)||name.startsWith('.hdr-export-')))fs.rmSync(path.join(photoFolder,name),{recursive:true,force:true});}
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
 await page.evaluate(()=>activateWorkflowTab('import'));
 // The check measures finished live tiles; unedited RAWs now start as camera pictures.
 const dimensions=await page.locator('#library-frame').evaluate(async(element,photos)=>{
  const w=element.contentWindow;
  const sizes=[];for(const photo of photos){const meta=await w.HDRLibraryScenes.load(photo,640,undefined,10,null,{develop:true});await meta.directScene?.store();sizes.push([meta.source_width,meta.source_height]);}return sizes;
 },photos);
 await page.evaluate(paths=>batchExport.open(paths,{fromLibrary:true}),photos);
 await page.waitForFunction(()=>document.querySelectorAll('.batch-photo canvas[data-live-tile]').length===3,null,{timeout:120000});
 await page.getByRole('button',{name:'Export preset actions',exact:true}).click();
 await page.getByRole('menuitem',{name:'New preset\u2026',exact:true}).click();
 await page.locator('#app-dialog-input').fill('Live tile check');
 await page.locator('#app-dialog').getByRole('button',{name:'Create',exact:true}).click();
 await page.locator('#export-format').selectOption('jpeg_ultrahdr');
 await page.locator('#export-preset').selectOption('maximum_fidelity');
 // Count actual live draws, not progress badges or layout updates.
 await page.locator('#library-frame').evaluate(element=>{const w=element.contentWindow,original=w.HDRLibraryPictures.show;
  w.__tileDraws=0;const descriptor=Object.getOwnPropertyDescriptor(w,'HDRLibraryPictures');
  Object.defineProperty(w,'HDRLibraryPictures',{...descriptor,value:{...w.HDRLibraryPictures,show(...args){w.__tileDraws++;return original(...args);}}});
 });
 const memory=await (await global.HDRFinisherElectronTestHarness.fetch('/api/library/memory-setting')).json();
 assert.ok(dimensions.every(([w,h])=>w>640&&h>640),'Native dimensions are available');
 const cpuExpected=dimensions.map(([w,h])=>1_300_000_000+88*w*h+288*1024**2>memory.ceilingBytes);
 assert.ok(cpuExpected.some(value=>!value),'Retain a within-budget GPU coverage photo');
 const measurements=[];
 async function run(photo,open,label){
  await page.evaluate(photo=>batchExport.open([photo],{fromLibrary:true}),photo);
  await page.waitForFunction(()=>document.querySelectorAll('.batch-photo canvas[data-live-tile]').length===1,null,{timeout:60000});
  await global.HDRFinisherElectronTestHarness.selectExportDirectory(folder);
  await page.evaluate(()=>document.getElementById('batch-directory').value='');
  if(!open)await page.evaluate(()=>activateWorkflowTab('grade'));
  const previousJob=await page.evaluate(()=>batchExport.activity()?.id||null);
  const before=await page.locator('#library-frame').evaluate(e=>e.contentWindow.__tileDraws),started=Date.now();
  await page.evaluate(()=>document.getElementById('batch-run').click());
  await page.waitForFunction(previous=>batchExport.activity()?.id!==previous&&['finished','failed','cancelled'].includes(batchExport.activity()?.state),previousJob,{timeout:240000,polling:50});
  const seconds=(Date.now()-started)/1000,job=await page.evaluate(()=>batchExport.activity());
  for(const result of job.results||[])if(result.output_path)exported.add(result.output_path);
  assert.equal(job.state,'finished',JSON.stringify(job));assert.equal(job.results.length,1);
  const expectedCpu=cpuExpected[photos.indexOf(photo)];
  assert.equal(job.results[0].renderer,expectedCpu?'cpu':'gpu',JSON.stringify(job.results));
  if(expectedCpu)assert.equal(job.results[0].fallback_reason,'GPU delivery working set does not fit the existing app memory ceiling; using bounded CPU strips.');assert.ok(['exported','renamed'].includes(job.results[0].outcome),JSON.stringify(job.results));
  const after=await page.locator('#library-frame').evaluate(e=>e.contentWindow.__tileDraws);
  assert.equal(after,before,'Progress never redraws a completed tile');
  measurements.push({photo:path.basename(photo),page:label,seconds});console.log(JSON.stringify(measurements.at(-1)));
 }
 await run(photos[0],false,'warmup');
 for(const photo of photos)await run(photo,false,'closed');
 for(const photo of photos)await run(photo,true,'open');
 const average=label=>measurements.filter(r=>r.page===label).reduce((n,r)=>n+r.seconds,0)/3;
 const closed=average('closed'),open=average('open'),changePercent=(open/closed-1)*100;
 assert.deepEqual(errors,[]);
 const report={measurements,closedSecondsPerPhoto:closed,openSecondsPerPhoto:open,changePercent,withinAllowance:open<=closed*1.05};
 fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 assert.ok(report.withinAllowance,'Open Export page exceeds the agreed 5% timing allowance');
}finally{await browser.close();reusePhoto.cleanup();removeExports();fs.rmSync(folder,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>reusePhoto.cleanup());
