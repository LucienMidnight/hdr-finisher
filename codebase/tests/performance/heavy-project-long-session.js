/** Bounded endurance replay using original automatic anchors. No project saves. */
const path=require('path'); const {chromium}=require('playwright');
const c=require('./heavy-project-review-common'); const {selectLocal}=require('./heavy-project-drag-review');
const args=process.argv.slice(2); const opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const project=path.resolve(opt('--project','')); const output=path.resolve(opt('--output','output/performance/review/long-session.json'));
const freshWork=args.includes('--fresh-work');
// --native-shift-feather keeps a varying Feather so the replay exercises the
// native feather field as well as the regional masks made from it.
const shiftFeather=args.includes('--native-shift-feather');
const nativeShift=shiftFeather||args.includes('--native-shift-zero-feather');
if(nativeShift&&!freshWork)throw Error('--native-shift-zero-feather and --native-shift-feather require --fresh-work');
const skipMatch=args.includes('--skip-match');
const panLane=opt('--pan-lane','sdr');
if(!['hdr','sdr'].includes(panLane))throw Error('Invalid --pan-lane');
const budgetGb=args.includes('--budget-gb')?Number(opt('--budget-gb','')):null;
if(budgetGb!==null&&(!Number.isFinite(budgetGb)||budgetGb<.25||budgetGb>16))throw Error('Invalid --budget-gb (0.25–16 GiB)');
const minutes=Number(opt('--minutes',30)); const idleMinutes=Number(opt('--idle-minutes',2));
async function main(){
 const browser=await chromium.launch({headless:false}); const page=await browser.newPage({viewport:{width:2560,height:1440}});
 const report={...c.manifest(project),schemaVersion:1,activeMinutes:minutes,idleMinutes,anchorPolicy:'Original fixture automatic; no manual override',operations:[],checkpoints:[],errors:[],status:'running'};
 report.freshWork=freshWork; report.inputPolicy=freshWork?'Deterministic unique strokes, feather, exposure and clarity radius per lane/cycle; retained fixture strokes':'Original repeated two-value edits';
 if(nativeShift)report.shiftPolicy=`Disposable ${shiftFeather?'feathered':'zero-Feather'} brush, deterministic unique Shift and pointer drags; native zoom and pan`;
 report.matchPolicy=skipMatch?'Owner-accepted Match omitted from this ordinary-edit coverage run':'Existing periodic Match coverage';
 report.panLane=panLane;
 report.displayContext=JSON.parse(process.env.HDR_FINISHER_REVIEW_DISPLAY_CONTEXT||'null');
 report.actualViewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,devicePixelRatio}));
 const requests=c.networkProbe(page); const memory=c.sampler(); page.on('pageerror',e=>report.errors.push(String(e)));
 async function checkpoint(label){ report.checkpoints.push({label,at:Date.now(),state:await page.evaluate(()=>{const g=HDRFinisherPerformance.gpuSnapshot();return {nativeShiftCoverage:window.__nativeShiftCoverage||null,nativeAnchors:{cached:state.gpuPreview?.peakReductionCache?.size,pending:pendingHighlightAnchors.size,inflight:exactHighlightAnchorInflight.size,backgroundMasks:state.gpuPreview?.backgroundMaskRequestCoordinator?.snapshot()},readiness:{gpuDraftInFlight:Boolean(state.gpuDraftInFlight),generation:state.previewGeneration[state.currentView],requiredEdge:requiredProcessingLongEdge(),scopeUpdating:document.querySelector("#scope-freshness")?.classList.contains("updating"),scopeText:document.querySelector("#scope-freshness")?.textContent,gpuScopeInFlight:Boolean(state.gpuScopeRequestInFlight),cpuScopeInFlight:Boolean(state.scopeRequestInFlight),scopeGeneration:state.scopeGeneration},lane:state.currentView,viewer:viewerState(),accepted:state.acceptedPresentation,refusal:state.lastGpuDraftRefusal,gpu:{available:g.available,resources:g.resources,renders:g.renders?.slice(-2)},scheduler:HDRFinisherPerformance.snapshot(),failurePolicy:state.gpuFailurePolicy?.snapshot?.()};})}); report.memorySamples=memory.rows;report.samplerErrors=memory.errors;c.write(output,report); }
 async function operation(name,action){ const start=Date.now(),n=requests.length,b=await c.mark(page); const detail=await action(); await c.stable(page,180000); const end=Date.now();report.operations.push({name,startedAt:start,totalMs:end-start,drag:detail?.trustedPointers?detail:undefined,input:detail?.sequence?detail:undefined,observation:await c.result(page,b,b.at),requests:requests.slice(n)});c.write(output,report); }
 try{
  await c.open(page,project,false);
  if(nativeShift)await page.evaluate(()=>{
    window.__nativeShiftCoverage={successfulBatches:0,fields:0};
    const field=state.gpuPreview.loadGpuBrushFeatherField;
    state.gpuPreview.loadGpuBrushFeatherField=async function(...values){
      const entry=await field.apply(this,values);if(entry)__nativeShiftCoverage.fields++;return entry;};
    const renderer=state.gpuPreview,load=renderer.loadGpuBrushShiftRegion;
    renderer.loadGpuBrushShiftRegion=async function(...args){
      const result=await load.apply(this,args);
      if(result&&[...result.entries.values()].some(entry=>entry?.kind==='gpu-brush-native-shift'||entry?.kind==='gpu-brush-native-feather'))
        __nativeShiftCoverage.successfulBatches++;
      return result;
    };
  });
  await checkpoint('opened');
  if(budgetGb!==null){
   report.disposableBudgetGb=budgetGb;
   await page.evaluate(value=>state.gpuPreview.setMemoryBudget(value),budgetGb);
   await checkpoint('disposable budget applied');
  }
  const originals=await page.evaluate(()=>{const brush=state.editDocument.local_adjustments.find(x=>x.mask?.leaf?.type==='brush');return {strokes:structuredClone(brush.mask.leaf.strokes),feather:brush.mask.leaf.mask_feather,exposure:{hdr:state.adjustments.hdr.exposure,sdr:state.adjustments.sdr.exposure}};});
  report.activeStartedAt=Date.now(); const deadline=report.activeStartedAt+minutes*60000;let cycle=0;
  while(Date.now()<deadline){
   cycle++; console.log(`Cycle ${cycle} elapsed ${((Date.now()-report.activeStartedAt)/60000).toFixed(2)} min`);
   for(const lane of ['hdr','sdr']){
    await operation(`${cycle} ${lane} switch`,()=>page.evaluate(x=>switchLane(x),lane));
    if(freshWork) await operation(`${cycle} ${lane} fresh inputs`,()=>page.evaluate(({cycle,lane,originals})=>{
      const sequence=cycle*2+(lane==='sdr'?1:0);
      commitAdjustmentValue(`${lane}.exposure`,originals.exposure[lane]+Math.sin(sequence*1.731)*.12);
      commitAdjustmentValue(`${lane}.detail.clarity_radius_percent`,.5+((sequence*.61803398875)%1)*1.2);
    },{cycle,lane,originals}));
    for(const p of ['exposure','detail.clarity_amount'])await operation(`${cycle} ${lane} ${p} drag`,()=>c.drag(page,`current.${p}`,cycle%2?1:-1));
    await selectLocal(page,'brush');
    if(freshWork) await operation(`${cycle} ${lane} fresh brush stroke`,()=>page.evaluate(async({cycle,lane,originals,nativeShift,shiftFeather})=>{
      const sequence=cycle*2+(lane==='sdr'?1:0);
      const local=structuredClone(state.editDocument.local_adjustments.find(x=>x.id===state.selectedLocalId));
      const phase=(sequence*.61803398875)%1;
      const x=.18+phase*.58,y=.16+((sequence*.41421356237)%1)*.64;
      local.mask.leaf.strokes=[...originals.strokes,{points:[{x,y,pressure:.8},{x:Math.min(.94,x+.025+phase*.04),y:Math.min(.94,y+.03),pressure:1}],
        radius:.008+phase*.018,hardness:.25+phase*.55,flow:.25+phase*.5,opacity:.4+phase*.5,erase:sequence%5===0}];
      local.mask.leaf.mask_feather=nativeShift&&!shiftFeather?0:Math.max(.001,Math.min(.1,originals.feather*(.7+.6*phase)+sequence*.000001));
      if(nativeShift)local.mask.leaf.mask_shift_edge=(sequence%2?1:-1)*(.001+phase*.006);
      if(!await queueEditCommand('update_local',{local},local.id))throw Error('Fresh brush edit failed');
      return {sequence,x,y,phase};
    },{cycle,lane,originals,nativeShift,shiftFeather}));
    await operation(`${cycle} ${lane} brush ${nativeShift?'Shift':'feather'} drag`,()=>c.drag(page,
      nativeShift?'input[data-local-mask-param="mask_shift_edge"]':'input[data-local-mask-param="mask_feather"]',cycle%2?1:-1));
    if(await page.locator('#grade-mode-local').getAttribute('aria-expanded')==='true')await page.locator('#grade-mode-local').click();
   }
   if(panLane!=='sdr')await operation(`${cycle} ${panLane} pan lane`,()=>page.evaluate(x=>switchLane(x),panLane));
   await operation(`${cycle} zoom 100`,()=>page.locator('#zoom-actual').click());
   await operation(`${cycle} native navigation pan`,async()=>{
    await page.locator('#navigation-thumb').waitFor({state:'visible',timeout:180000});
    const box=await page.locator('#navigation-thumb-image').boundingBox();
    const before=await page.evaluate(()=>({left:els.dropzone.scrollLeft,top:els.dropzone.scrollTop}));
    await page.mouse.click(box.x+box.width*(cycle%2?.75:.25),box.y+box.height*(cycle%2?.7:.3));
    await page.waitForFunction(before=>els.dropzone.scrollLeft!==before.left||els.dropzone.scrollTop!==before.top,before);
    await page.waitForFunction(()=>{const c=state.renderCoordinator,lane=state.currentView;return !c||!c.panPending(lane)&&!c.catchUpPending(lane)&&!c.state(lane).inFlight&&!c.state(lane).pending;},null,{timeout:180000});
    return {before,after:await page.evaluate(()=>({left:els.dropzone.scrollLeft,top:els.dropzone.scrollTop}))};
   });
   await operation(`${cycle} zoom Fit`,()=>page.locator('#zoom-fit').click());
   if(!skipMatch&&(cycle===1||cycle%5===0))await operation(`${cycle} Match entire HDR grade`,async()=>{if(!await page.evaluate(()=>setSdrMatch('match')))throw Error('Match returned false');});
   await checkpoint(`cycle ${cycle}`);
   await page.waitForTimeout(1000);
  }
  report.activeEndedAt=Date.now();await checkpoint('active complete');
  for(let i=0;i<idleMinutes*6;i++){await page.waitForTimeout(10000);await checkpoint(`idle ${(i+1)*10}s`);}
  const final=report.checkpoints.at(-1)?.state;
  if(nativeShift&&!final?.nativeShiftCoverage?.successfulBatches)throw Error('Shift replay did not exercise the native GPU route');
  if(shiftFeather&&!final.nativeShiftCoverage.fields)throw Error('Feathered Shift replay did not build a native feather field');
  if(report.errors.length)throw Error(`Page errors: ${report.errors.join('; ')}`);
  if(!final?.gpu?.available||final.viewer?.status!=='ready'
   ||final.accepted?.generation!==final.readiness?.generation
   ||final.readiness?.gpuDraftInFlight||final.readiness?.scopeUpdating
   ||final.readiness?.gpuScopeInFlight||final.readiness?.cpuScopeInFlight
   ||final.nativeAnchors?.pending||final.nativeAnchors?.inflight)
   throw Error('Final idle checkpoint did not drain current GPU/picture/scope/anchor work');
  if(final.gpu.resources?.memory?.allocator?.overBudgetBytes>0)
   throw Error('Final allocator remains over the selected budget');
  const registeredMasks=final.gpu.resources?.memory?.allocator?.byKind?.['local-mask']?.bytes||0;
  if(registeredMasks!==(final.gpu.resources?.localMaskBytes||0))
   throw Error('Final local-mask registration disagrees with resident mask allocations');
  report.status='complete';report.completedAt=new Date().toISOString();
 }catch(e){report.status='failed';report.failure=String(e.stack||e);await checkpoint('failure').catch(()=>{});throw e;}
 finally{memory.stop();report.memorySamples=memory.rows;report.samplerErrors=memory.errors;report.requests=requests;c.write(output,report);await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
