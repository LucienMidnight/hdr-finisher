/** One Fit edit and native zoom; disposable session, never saves a project. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),c=require('./heavy-project-review-common');
const args=process.argv.slice(2),opt=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const project=path.resolve(opt('--project','')),output=path.resolve(opt('--output','output/performance/phase3-local-route-smoke.json'));
const lane=opt('--lane','hdr');
(async()=>{const browser=await chromium.launch();const page=await browser.newPage();const report={project,operations:[],errors:[]};page.on('pageerror',error=>report.errors.push(String(error)));try{
 const network=c.networkProbe(page);
 await c.open(page,project,false);
 if(lane!=='hdr'){await page.evaluate(lane=>switchLane(lane),lane);await c.stable(page);}
 report.lane=await page.evaluate(()=>state.currentView);assert.equal(report.lane,lane);
 const networkStart=network.length;
 report.localCount=await page.evaluate(()=>localAdjustments().length);
 for(const name of ['Fit local curves/wheels','Native zoom']){
  const before=await c.mark(page),requestStart=network.length;
  if(name.startsWith('Fit'))await page.evaluate(async()=>{
   const local=structuredClone(localAdjustments().find(local=>local.mask?.leaf?.type==='path')||localAdjustments()[0]);
   const grade=local[state.currentView+'_grade'];grade.luma_curve=[[0,0],[.25,.3],[.5,.6],[.75,.8],[1,1]];
   Object.assign(grade.color_grading.midtones,{hue:160,saturation:20,luminance_ev:.1});grade.color_grading.balance=20;grade.color_grading.blending=80;
   if(!await queueEditCommand('update_local',{local},local.id))throw Error('Session edit failed');
  });else await page.evaluate(()=>setCustomZoom(100));
  await c.stable(page);
  await page.waitForFunction(mark=>__review.scopes.slice(mark.s).some(scope=>scope.tier==='settled'
   && scope.lane===state.currentView && scope.accepted?.generation===state.previewGeneration[state.currentView]),before,{timeout:30000});
  const observation=await c.result(page,before,before.at);
  const route=await page.evaluate(()=>({accepted:state.acceptedPresentation,source:state.gpuPreview.sourceTransportMetrics,
   supportsLocals:state.gpuPreview.supportsLocalAdjustments(state.currentView,localAdjustments()),
   locals:localAdjustments().length}));
  assert.ok(route.supportsLocals,'Curves/wheels refused');assert.equal(route.accepted?.transport,'WebGPU');assert.equal(route.locals,report.localCount);
  // Backend mask tiles are the CPU fallback a GPU-made mask must not need.
  const cpuMaskTileRequests=network.slice(requestStart).filter(row=>row.path.endsWith('/local-mask-tiles')).length;
  report.operations.push({name,observation,route,cpuMaskTileRequests});c.write(output,report);
  assert.equal(observation.scope?.source,'gpu','Settled scopes left the GPU');
  console.log(name,JSON.stringify({pictureMs:observation?.releaseToExactMs,scopeMs:observation?.releaseToScopesMs,accepted:route.accepted,scopeSource:observation.scope?.source,cpuMaskTileRequests}));
 }
 const accepted=await page.evaluate(()=>structuredClone(state.acceptedPresentation));
 await page.waitForFunction(()=>navigationThumbnail.url && els.navigationThumbImage.naturalHeight>0
  && JSON.parse(navigationThumbnail.key).generation===state.previewGeneration[state.currentView],null,{timeout:30000});
 report.navigation=await page.evaluate(()=>({key:JSON.parse(navigationThumbnail.key),width:els.navigationThumbImage.naturalWidth,height:els.navigationThumbImage.naturalHeight,accepted:state.acceptedPresentation}));
 assert.equal(report.navigation.accepted.sourceSerial,accepted.sourceSerial,'Overview replaced the accepted picture');
 assert.ok(Math.max(report.navigation.width,report.navigation.height)<=512);
 report.cpuAuxiliaryRequests=network.slice(networkStart).filter(row=>row.path.includes('/scopes')||row.query.includes('purpose=navigation'));
 assert.equal(report.cpuAuxiliaryRequests.length,0,'GPU session requested CPU scopes/navigation');
 report.staleScopeRefused=await page.evaluate(async()=>{
  const accepted=state.acceptedPresentation;let current=true;
  const pending=state.gpuPreview.renderScopeProxy(state.session.session_id,state.currentView,state.adjustments,
   sampleCurvePoints,960,localAdjustments(),state.editRevision,projectReferenceWhiteNits(),
   {width:state.session.source.width,height:state.session.source.height},
   {...gpuPreviewSourceOptions(),applicationGeneration:accepted.generation,isCurrent:()=>current});
  current=false;
  return !await pending && state.acceptedPresentation===accepted;
 });
 assert.ok(report.staleScopeRefused,'Superseded auxiliary render published');
 c.write(output,report);
 assert.equal(report.errors.length,0,report.errors.join('\n'));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
