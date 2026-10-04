/** Same-scene 50%/100% continuity at the PRD's 8-screen-pixel block size.
 * Disposable session, bounded visible readbacks, no CPU export or project save.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const c = require('./heavy-project-review-common');
const args = process.argv.slice(2);
const opt = (key,value) => args.includes(key) ? args[args.indexOf(key)+1] : value;
const project = path.resolve(opt('--project',''));
const output = path.resolve(opt('--output','output/performance/zoom-block-continuity.json'));
const lanes = opt('--lanes','hdr,sdr').split(',');
const zooms = opt('--zooms','50').split(',').map(Number);
assert(zooms.length && zooms.every(z=>z>0&&z<100),'--zooms must be below 100%');
const edits = opt('--set','').split(',').filter(Boolean).map(item => {
  const [key,raw] = item.split('=');let value=raw;try {value=JSON.parse(raw);} catch {} return {key,value};
});

(async () => {
  const browser = await chromium.launch();
  const report = {...c.manifest(project),edits,results:[]};
  fs.mkdirSync(path.dirname(output),{recursive:true});
  try {
    const page = await browser.newPage();
    await c.open(page,project,false);
    if(args.includes('--warm-denoise-first')) {
      assert(args.includes('--denoise') && lanes.join(',')==='hdr','Warm-first currently covers HDR only');
      await page.evaluate(async()=>{
        updateDenoiseAlgorithm(DENOISE_ADAPTIVE_ALGORITHM);await persistDenoiseSettings();
        await setDenoiseEnabled(true);setCustomZoom(50);
      });await page.waitForTimeout(250);await c.stable(page);
      report.warmedBeforeEdits=await page.evaluate(()=>({
        geometry:geometrySignature(),edge:requiredProcessingLongEdge(),
        model:structuredClone(state.gpuPreview.denoiseSourceSelector.cache.model)}));
    }
    if(args.includes('--without-locals')) {
      await page.evaluate(async () => {
        for(const existing of localAdjustments()) {
          const local=structuredClone(existing);local.enabled=false;
          if(!await queueEditCommand('update_local',{local},local.id))throw Error('Could not disable diagnostic local');
        }
      });
      report.localsDisabled=true;
    }
    if(args.includes('--without-local-detail')) {
      await page.evaluate(async()=>{
        for(const existing of localAdjustments()) {
          const local=structuredClone(existing);Object.assign(local.hdr_grade.detail,{texture_amount:0,clarity_amount:0,sharpen_amount:0});
          if(!await queueEditCommand('update_local',{local},local.id))throw Error('Could not neutralize local Detail');
        }
      });report.localDetailDisabled=true;
    }
    await page.evaluate(async edits => {
      for(const edit of edits)commitAdjustmentValue(edit.key,edit.value,{manual:true});
      await settlePreview('hdr',{});
    },edits);
    const stable = async () => {
      await page.waitForFunction(() => {
        const coordinator=state.renderCoordinator.state(state.currentView);
        return !state.zoomRefinementTimer&&!coordinator.panTimerPending&&!coordinator.inFlight&&!coordinator.pending
          &&pendingHighlightAnchors.size===0&&exactHighlightAnchorInflight.size===0;
      },null,{timeout:60000});
      await c.stable(page);
    };
    for(const lane of lanes) {
      await page.evaluate(lane=>switchLane(lane),lane);await stable();
      if(args.includes('--denoise')) {
        await page.evaluate(async()=>{
          if(state.denoise[state.currentView].analysis.algorithm_version!==DENOISE_ADAPTIVE_ALGORITHM) {
            updateDenoiseAlgorithm(DENOISE_ADAPTIVE_ALGORITHM);await persistDenoiseSettings();
          }
          await setDenoiseEnabled(true);
        });await stable();
      }
      for(const comparisonZoom of zooms) {
      const frames=[];
      for(const zoom of [100,comparisonZoom]) {
        await page.evaluate(zoom=>setCustomZoom(zoom),zoom);await stable();
        await page.evaluate(() => {
          const canvas=els.previewCanvas.getBoundingClientRect(),pane=els.dropzone.getBoundingClientRect();
          els.dropzone.scrollLeft+=(canvas.left+canvas.width/2)-(pane.left+els.dropzone.clientWidth/2);
          els.dropzone.scrollTop+=(canvas.top+canvas.height/2)-(pane.top+els.dropzone.clientHeight/2);
        });
        await page.waitForTimeout(150);await stable();
        const frame=await page.evaluate(async () => {
          const renderer=state.gpuPreview,target=renderer.presentationTarget,accepted=state.acceptedPresentation;
          if(accepted?.execution!=='tiled'||!accepted.exact||!target?.valid)throw Error('App-selected route is not a readable exact tile frame');
          const box=els.previewCanvas.getBoundingClientRect();
          const screenScale={x:box.width/target.width,y:box.height/target.height,dpr:devicePixelRatio};
          if(screenScale.dpr!==1)throw Error('This checker requires DPR 1');
          const visible=visibleOutputRect(target.width,target.height);
          if(!visible)throw Error('This test requires a partially visible custom zoom');
          const width=Math.min(1024,visible.width-2),height=Math.min(768,visible.height-2);
          const rect={x:Math.ceil(visible.x+(visible.width-width)/2),y:Math.ceil(visible.y+(visible.height-height)/2),width,height};
          const read=await renderer.readPresentationRegion(rect.width,rect.height,rect.x,rect.y);
          if(!read?.values||read.width!==rect.width||read.height!==rect.height)throw Error('Incomplete visible readback');
          const bytes=new Uint8Array(new Float32Array(read.values).buffer);let binary='';
          for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
          return {rect,visible,width:target.width,height:target.height,format:target.format,
            white:projectReferenceWhiteNits(),zoom:state.zoomPercent,base64:btoa(binary),screenScale,
            laneAdjustments:structuredClone(state.adjustments[state.currentView]),
            denoise:structuredClone(state.denoise[state.currentView]),
            denoiseStatus:state.denoiseRuntime[state.currentView].status,
            denoiseSelected:renderer.diagnosticsSnapshot().denoise.selectedSource,
            denoiseModel:renderer.denoiseSourceSelector?.cache?.model || null,
            accepted:{lane:accepted.lane,execution:accepted.execution,processedLongEdge:accepted.processedLongEdge}};
        });
        const file=output.replace(/\.json$/,'')+`-${lane}-${comparisonZoom}-${zoom}.rgba32`;
        fs.writeFileSync(file,Buffer.from(frame.base64,'base64'));delete frame.base64;
        frames.push({...frame,file});
      }
      if(report.warmedBeforeEdits && frames[1].accepted.processedLongEdge===report.warmedBeforeEdits.edge) {
        assert.deepEqual(frames[1].denoiseModel,report.warmedBeforeEdits.model,'Intermediate model changed after geometry edit');
        report.modelReuseChecked=true;
      }
      assert.equal(frames[0].format,frames[1].format);
      const metadata=output.replace(/\.json$/,'')+`-${lane}-${comparisonZoom}-frames.json`;
      fs.writeFileSync(metadata,JSON.stringify({lane,frames},null,2)+'\n');
      const result=JSON.parse(execFileSync(path.resolve('.venv/Scripts/python.exe'),['tests/performance/zoom_block_compare.py',metadata],{encoding:'utf8',maxBuffer:1024*1024}));
      report.results.push({lane,zoom:comparisonZoom,frames,...result});c.write(output,report);
      console.log(JSON.stringify({lane,zoom:comparisonZoom,blocks:result.blocks,luminanceP99:result.tone.luminance.p99,
        oklabP99:result.tone.oklab.p99,passed:result.passed}));
      }
    }
    report.projectUnchanged=c.manifest(project).projectSha256===report.projectSha256;
    assert.ok(report.projectUnchanged);c.write(output,report);
    assert.ok(report.results.every(result=>result.passed),'8-screen-pixel continuity exceeded the existing typical tone/colour limits');
  } finally {
    report.projectUnchanged=c.manifest(project).projectSha256===report.projectSha256;c.write(output,report);
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
