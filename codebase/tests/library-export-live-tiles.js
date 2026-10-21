/* Same three photos, same GPU export settings, Export page open versus closed. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-export-live-tiles',String(Date.now()));fs.mkdirSync(folder,{recursive:true});
const photos=['DSC07060','DSC07061','DSC07072'].map(n=>{const p=path.join(folder,n+'.ARW');fs.copyFileSync('D:/test-photos-delete-later/'+n+'.ARW',p);return p;});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
 await page.evaluate(paths=>batchExport.open(paths,{fromLibrary:true}),photos);
 await page.waitForFunction(()=>document.querySelectorAll('.batch-photo canvas[data-live-tile]').length===3,null,{timeout:120000});
 await page.locator('#batch-preset-rail').getByRole('button',{name:'New preset',exact:true}).click();
 await page.locator('#export-format').selectOption('jpeg_ultrahdr');
 await page.locator('#export-preset').selectOption('maximum_fidelity');
 // Count actual live draws, not progress badges or layout updates.
 await page.locator('#library-frame').evaluate(element=>{const w=element.contentWindow,original=w.HDRLibraryPictures.show;
  w.__tileDraws=0;const descriptor=Object.getOwnPropertyDescriptor(w,'HDRLibraryPictures');
  Object.defineProperty(w,'HDRLibraryPictures',{...descriptor,value:{...w.HDRLibraryPictures,show(...args){w.__tileDraws++;return original(...args);}}});
 });
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
  assert.equal(job.state,'finished',JSON.stringify(job));assert.equal(job.results.length,1);
  assert.equal(job.results[0].renderer,'gpu',JSON.stringify(job.results));assert.ok(['exported','renamed'].includes(job.results[0].outcome),JSON.stringify(job.results));
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
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
