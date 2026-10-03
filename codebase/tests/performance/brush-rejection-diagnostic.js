/** GPU admission decomposition. Read-only fixture, disposable session. */
const path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),c=require('./heavy-project-review-common');
const args=process.argv.slice(2),opt=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const project=path.resolve(opt('--project','')),output=path.resolve(opt('--output','output/performance/review/brush-rejection.json'));
(async()=>{
 const browser=await chromium.launch();const page=await browser.newPage();
 const report={...c.manifest(project),cases:[],errors:[],methodology:'Same GPU bitmap generator and classification endpoint as production; erase-free counterfactual isolates post-feather attenuation. No admission limits or fixture edits.'};
 page.on('pageerror',error=>report.errors.push(String(error)));
 try{
  await c.open(page,project,true);
  report.cases=await page.evaluate(async()=>{
   const renderer=state.gpuPreview,local=localAdjustments().find(local=>local.mask?.leaf?.type==='brush'),cases=[];
   if(!local)throw Error('No brush fixture');
   for(const feather of [.0085,.02,.05,.005,.03])for(const variant of ['saved','added-stroke','erase-free']){
    const candidate=structuredClone(local);candidate.mask.leaf.mask_feather=feather;
    if(variant!=='saved')candidate.mask.leaf.strokes.push({points:[{x:.35,y:.45,pressure:.4},{x:.4,y:.5,pressure:.8},{x:.45,y:.55,pressure:.7}],radius:.06,hardness:.5,flow:.7,opacity:.8,erase:false});
    if(variant==='erase-free')candidate.mask.leaf.strokes=candidate.mask.leaf.strokes.filter(stroke=>!stroke.erase);
    const maskEvents=renderer.performanceMetrics.maskEvents||=[];const start=maskEvents.length;
    for(const edge of [512,1024,1600,3200]){
     const entry=await renderer.loadGpuBrushLeaf(state.session.session_id,candidate,candidate.mask,'',edge,state.editRevision,JSON.stringify(state.adjustments.shared.geometry));
     cases.push({feather,variant,edge,soft:entry?.soft,estimate:entry?.softEstimate,reason:entry?.softReason,terms:entry?.softTerms,width:entry?.width,height:entry?.height});
    }
    cases.at(-1).events=structuredClone(maskEvents.slice(start));
   }
   return cases;
  });
  report.projectUnchanged=c.manifest(project).projectSha256===report.projectSha256;
  c.write(output,report);assert.ok(report.projectUnchanged);assert.equal(report.errors.length,0);
  console.log(JSON.stringify(report.cases.filter(item=>item.edge===3200).map(({feather,variant,soft,estimate,reason,terms})=>({feather,variant,soft,estimate,reason,terms})),null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
