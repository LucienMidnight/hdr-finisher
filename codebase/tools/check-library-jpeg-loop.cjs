// Run through tests/run-in-electron.js at 2560x1440 with a fresh disposable
// profile. Only output/test-photos/20260214 is opened; copy originals there
// once for this task, then remove those copies and the test profile afterwards.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {hashProjects,checkProjects}=require('../tests/release/runner.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/jpeg-loop');
const photos=path.join(root,'output/test-photos/20260214').replaceAll('\\','/');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const before=hashProjects(require('../tests/release/drivers.json').protectedProjects);
 const browser=await chromium.launch();let report={};
 try{
  const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL);await page.evaluate(()=>activateWorkflowTab('import'));
  const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibraryScenes);
  const baseline=process.argv.includes('--baseline');
  report=await lib.evaluate(async({photo,baseline})=>{
   const events=[],errors=[];const log=HDRLibraryStopwatch;
   window.HDRLibraryStopwatch=(stage,fields)=>{events.push({stage,at:performance.now(),...fields});log(stage,fields);};
   const original=HDRLibraryRGB.develop;
   window.HDRLibraryRGB={...HDRLibraryRGB,develop:async args=>{try{return await original(args);}catch(e){errors.push({reason:e.message,meta:{width:args.meta.width,height:args.meta.height,colour:args.meta.colour},budget:args.memoryBudget});throw e;}}};
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
   let result,error;
   try{const meta=await HDRLibraryScenes.load(photo,640,controller.signal,0);result={key:meta.key,edge:meta.edge};await meta.directScene?.store();}catch(e){error=e.message;}
   finally{clearTimeout(timer);}
   return {events,errors,result,error};
  },{photo:photos+'/darktable_exported/DSC01910.jpg',baseline});
  console.log(JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(out,baseline?'baseline.json':'focused.json'),JSON.stringify(report,null,2));
  if(!baseline)assert.ok(report.result,report.error);
 }finally{checkProjects(before);await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
