/** One Fit edit and zoom sequence; disposable session, never saves a project. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),c=require('./heavy-project-review-common');
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const args=process.argv.slice(2),opt=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const project=path.resolve(opt('--project','')),output=path.resolve(opt('--output','output/performance/phase3-local-route-smoke.json'));
const lane=opt('--lane','hdr');
const zooms=opt('--zoom-sequence','100').split(',').map(Number);
if(zooms.some(zoom=>!Number.isFinite(zoom)||zoom<=0))throw Error('Invalid --zoom-sequence');
// A current exact picture can precede an automatic-anchor replacement. Keep
// first feedback separate, but measure settlement through that replacement.
async function completeGeneration(page){
 await page.waitForFunction(()=>pendingHighlightAnchors.size===0&&exactHighlightAnchorInflight.size===0,
  null,{timeout:180000});
 await page.waitForFunction(()=>{
  const coordinator=state.renderCoordinator?.state(state.currentView);
  return !state.zoomRefinementTimer&&!coordinator?.panTimerPending&&!coordinator?.inFlight&&!coordinator?.pending;
 },null,{timeout:30000});
 await c.stable(page);
}
(async()=>{const browser=await chromium.launch();const page=await browser.newPage();const report={project,operations:[],errors:[]};page.on('pageerror',error=>report.errors.push(String(error)));try{
 const network=c.networkProbe(page);
 await c.open(page,project,false);
 report.regionalErasePolicy=args.includes('--disable-regional-erase')?'Disabled in disposable renderer for paired baseline':'Production';
 if(args.includes('--disable-regional-erase'))await page.evaluate(()=>{state.gpuPreview.loadGpuBrushEraseRegion=async()=>null;});
 // Paired baseline for native Feather: keep native Shift, refuse the feather-only field.
 report.nativeFeatherPolicy=args.includes('--disable-native-feather')?'Disabled in disposable renderer for paired baseline':'Production';
 if(args.includes('--disable-native-feather'))await page.evaluate(()=>{const renderer=state.gpuPreview,load=renderer.loadGpuBrushShiftRegion;
  renderer.loadGpuBrushShiftRegion=function(...values){return values[7]?Promise.resolve(null):load.apply(this,values);};});
 // Straighten/perspective coverage: --geometry straighten_angle=2 sets shared geometry outside the clock.
 report.resampledMaskPolicy=args.includes('--disable-resampled-masks')?'Disabled in disposable renderer for paired baseline':'Production';
 if(args.includes('--disable-resampled-masks'))await page.evaluate(()=>{state.gpuPreview.resamplePlan=()=>null;});
 report.geometryEdits=opt('--geometry','').split(',').filter(Boolean).map(entry=>entry.split('='));
 if(report.geometryEdits.length){await page.evaluate(edits=>{for(const [key,value] of edits)commitAdjustmentValue(`shared.geometry.${key}`,Number(value),{manual:true});},report.geometryEdits);await c.stable(page);}
 if(lane!=='hdr'){await page.evaluate(lane=>switchLane(lane),lane);await c.stable(page);}
 await completeGeneration(page);
 report.settlementContract='Current exact picture and scopes after automatic-anchor and coordinator work drain';
 report.lane=await page.evaluate(()=>state.currentView);assert.equal(report.lane,lane);
 const networkStart=network.length;
 report.localCount=await page.evaluate(()=>localAdjustments().length);
 report.initialMaskEvents=await page.evaluate(()=>structuredClone(state.gpuPreview.performanceMetrics.maskEvents||[]));
 for(const step of [{name:'Fit local curves/wheels'},...(args.includes('--brush-stroke')?[{name:'Brush stroke',stroke:true}]:[]),...(args.includes('--brush-feather')?[.02,.05,.005,.03].map(feather=>({name:`Brush feather ${feather}`,feather})):[]) ,...zooms.map(zoom=>({name:`Zoom ${zoom}%`,zoom}))]){
  const {name}=step;
  const before=await c.mark(page),requestStart=network.length;
  const maskEventStart=await page.evaluate(()=>state.gpuPreview.performanceMetrics.maskEvents?.length||0);
  if(name.startsWith('Fit'))await page.evaluate(async()=>{
   const local=structuredClone(localAdjustments().find(local=>local.mask?.leaf?.type==='path')||localAdjustments()[0]);
   const grade=local[state.currentView+'_grade'];grade.luma_curve=[[0,0],[.25,.3],[.5,.6],[.75,.8],[1,1]];
   Object.assign(grade.color_grading.midtones,{hue:160,saturation:20,luminance_ev:.1});grade.color_grading.balance=20;grade.color_grading.blending=80;
   if(!await queueEditCommand('update_local',{local},local.id))throw Error('Session edit failed');
  });else if(step.stroke)await page.evaluate(async()=>{const local=structuredClone(localAdjustments().find(local=>local.mask?.leaf?.type==='brush'));if(!local)throw Error('No brush fixture');local.mask.leaf.strokes.push({points:[{x:.35,y:.45,pressure:.4},{x:.4,y:.5,pressure:.8},{x:.45,y:.55,pressure:.7}],radius:.06,hardness:.5,flow:.7,opacity:.8,erase:false});if(!await queueEditCommand('update_local',{local},local.id))throw Error('Brush edit failed');});else if(step.feather)await page.evaluate(async feather=>{const local=structuredClone(localAdjustments().find(local=>local.mask?.leaf?.type==='brush'));if(!local)throw Error('No brush fixture');local.mask.leaf.mask_feather=feather;if(!await queueEditCommand('update_local',{local},local.id))throw Error('Feather edit failed');},step.feather);else await page.evaluate(zoom=>setCustomZoom(zoom),step.zoom);
  await page.waitForFunction(()=>{
   const coordinator=state.renderCoordinator?.state(state.currentView);
   return !state.zoomRefinementTimer && !coordinator?.panTimerPending
    && !coordinator?.inFlight && !coordinator?.pending;
  },null,{timeout:30000});
  await c.stable(page);
  const firstSettlement=await c.result(page,before,before.at);
  await completeGeneration(page);
  await page.waitForFunction(mark=>__review.scopes.slice(mark.s).some(scope=>scope.tier==='settled'
   && scope.lane===state.currentView && (scope.metric?.applicationGeneration??scope.accepted?.generation)===state.previewGeneration[state.currentView]),before,{timeout:30000});
  const observation=await c.result(page,before,before.at);
  observation.firstSettlement=firstSettlement;
  observation.anchorWorkDrained=await page.evaluate(()=>pendingHighlightAnchors.size===0&&exactHighlightAnchorInflight.size===0);
  const route=await page.evaluate(()=>({accepted:state.acceptedPresentation,source:state.gpuPreview.sourceTransportMetrics,
   maskSourceSize:state.gpuPreview.maskSourceSize,maskEvents:state.gpuPreview.performanceMetrics.maskEvents,
   supportsLocals:state.gpuPreview.supportsLocalAdjustments(state.currentView,localAdjustments()),
   locals:localAdjustments().length,brushMasks:[...state.gpuPreview.localMasks.values()].filter(entry=>entry.kind==='gpu-brush-feather').map(entry=>({width:entry.width,height:entry.height,soft:entry.soft,softEstimate:entry.softEstimate,softLimit:entry.softLimit,longEdge:entry.longEdge,softReason:entry.softReason})),
   analyticMasks: [...state.gpuPreview.maskTiles.values()].reduce((counts, entry) => {
    if (entry.kind?.startsWith('gpu-')) {
     counts[entry.wholeFrame ? 'regions' : 'tiles']++;
     counts.bytes += entry.byteSize;
    }
    return counts;
   }, {regions:0,tiles:0,bytes:0})}));
  route.maskEvents=route.maskEvents.slice(maskEventStart);
  assert.ok(route.supportsLocals,'Curves/wheels refused');assert.equal(route.accepted?.transport,'WebGPU');assert.equal(route.locals,report.localCount);
  // Backend mask tiles are the CPU fallback a GPU-made mask must not need.
  const cpuMaskTileRequests=network.slice(requestStart).filter(row=>row.path.endsWith('/local-mask-tiles')).length;
  report.operations.push({name,observation,route,cpuMaskTileRequests,cpuMaskRequests:network.slice(requestStart).filter(row=>row.path.includes('/local-mask')&&!/\/bitmap-verdict(?:-raw)?$/.test(row.path)).map(row=>({...row}))});c.write(output,report);
  assert.equal(observation.scope?.source,'gpu','Settled scopes left the GPU');
  console.log(name,JSON.stringify({pictureMs:observation?.releaseToExactMs,scopeMs:observation?.releaseToScopesMs,accepted:route.accepted,scopeSource:observation.scope?.source,cpuMaskTileRequests}));
  if(args.includes('--roi-parity') && step.zoom===50){
   const parity=await page.evaluate(async()=>{
    const renderer=state.gpuPreview,original=renderer.readPresentationRegion,buffers=[];
    renderer.readPresentationRegion=async function(...args){
     const pixels=await original.apply(this,args);
     if(pixels){
      const bytes=new Uint8Array(new Float32Array(pixels.values).buffer);let binary='';
      for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      buffers.push(btoa(binary));
     }
     return pixels;
    };
    try{return {...await HDRFinisherPerformance.roiParity({longEdge:requiredProcessingLongEdge()}),
     buffers,format:renderer.presentationTarget.format,white:projectReferenceWhiteNits()};}
    finally{renderer.readPresentationRegion=original;}
   });
   const files=['whole','region'].map(name=>output.replace(/\.json$/,'')+`-${name}.rgba32`);
   parity.buffers.forEach((data,i)=>fs.writeFileSync(files[i],Buffer.from(data,'base64')));delete parity.buffers;
   parity.tone=JSON.parse(execFileSync(path.resolve('.venv/Scripts/python.exe'),['-c',`
import sys,json,numpy as np
sys.path.insert(0,'tests/performance')
from preview_export_compare import srgb_decode,presentation_space,tone_statistics
a,b=[np.fromfile(p,dtype=np.float32).reshape(int(sys.argv[7]),int(sys.argv[6]),4)[...,:3].astype(np.float64) for p in sys.argv[1:3]]
lane,fmt,white=sys.argv[3],sys.argv[4],float(sys.argv[5])
space=presentation_space(lane,lane=='hdr' and '16float' in fmt,white)
r=tone_statistics(srgb_decode(b),srgb_decode(a),space,eight_bit_target='16float' not in fmt)
print(json.dumps({k:v for k,v in r.items() if not k.startswith('_')}))
`,...files,lane,parity.format,String(parity.white),String(parity.visible.width),String(parity.visible.height)],{encoding:'utf8',maxBuffer:1024*1024}));
   report.subnativeParity=parity;c.write(output,report);
   assert.ok(parity.ok,JSON.stringify(parity));
   assert.equal(parity.legacy.execution,'direct');assert.equal(parity.roi.execution,'tiled');
   // Same approved picture limits; the whole-frame GPU route is this A/B's
   // reference. This is not a native CPU/export or zoom-continuity sign-off.
   for(const metric of ['luminance','oklab'])assert.ok(parity.tone[metric].typicalOk && parity.tone[metric].ceilingOk,JSON.stringify(parity.tone));
   console.log('50% whole/region parity',JSON.stringify({comparison:parity.comparison,tone:parity.tone}));
   await page.evaluate(()=>refreshScopes(scopeLongEdge('settled'),{tier:'settled'}));await c.stable(page);
  }
 }
 await page.waitForFunction(()=>pendingHighlightAnchors.size===0&&exactHighlightAnchorInflight.size===0,null,{timeout:180000});
 await c.stable(page);
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
   {applicationGeneration:accepted.generation,isCurrent:()=>current});
  current=false;
  return !await pending && state.acceptedPresentation===accepted;
 });
 assert.ok(report.staleScopeRefused,'Superseded auxiliary render published');
 c.write(output,report);
 assert.equal(report.errors.length,0,report.errors.join('\n'));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
