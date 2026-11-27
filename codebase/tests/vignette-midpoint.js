// Focused real-device preview/CPU/PNG-delivery and midpoint authoring check.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { encodeTiff } = require('./large-noisy-tiff.js');
const { createColourComparator } = require('./helpers/parity-colour.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vignette-midpoint-'));
const comparator = createColourComparator();
const base = process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8000';
(async () => {
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(dynamic-range: high)'
      ? {matches:false,addEventListener(){},removeEventListener(){}} : original(query);
  });
  const post = async (url, body) => {
    const response = await page.request.post(base + url, {data:body});
    assert(response.ok(), await response.text()); return response.json();
  };
  try {
    await page.goto(base, {waitUntil:'networkidle'});
    const file = path.join(root,'flat.tiff');
    fs.writeFileSync(file,encodeTiff(Buffer.alloc(600*400*3,160),600,400));
    const response = await page.request.post(base+'/api/session',{multipart:{file:{name:'flat.tiff',mimeType:'application/octet-stream',buffer:fs.readFileSync(file)}}});
    assert(response.ok(),await response.text());
    const {session} = await response.json();
    await page.evaluate(s=>activateDesktopSession(s,''),session);
    await page.waitForFunction(()=>state.gpuPreview?.available && viewerState().status==='ready',null,{timeout:120000});
    assert.equal(await page.evaluate(()=>state.gpuPreview.adapterInfo?.fallback),false);
    await page.evaluate(()=>stopPreviewWatchdog());
    for (const lane of ['hdr','sdr']) for (const midpoint of [100,200]) {
      const captures = await page.evaluate(async ({lane,midpoint})=>{
        if(state.currentView!==lane) await switchLane(lane);
        commitAdjustmentValue('current.vignette.midpoint',midpoint,{manual:true});
        const v=state.adjustments[lane].vignette;
        if(v.midpoint!==midpoint) throw Error('Typed midpoint was clamped');
        const slider=document.querySelector('input[data-path="current.vignette.midpoint"]');
        if(Number(slider.max)!==200) throw Error('Slider maximum is not 200');
        slider.value=String(midpoint); slider.dispatchEvent(new Event('input',{bubbles:true}));
        Object.assign(v,{amount:-100,feather:0,center_x:.5,center_y:.5,scale_x:100,scale_y:100});
        state.globalEditDirty=true;
        if(!await syncGlobalEditState()) throw Error('Recipe sync failed');
        invalidatePreview(lane);await settlePreview(lane,{});
        while(pendingHighlightAnchors.size||exactHighlightAnchorInflight.size) await new Promise(r=>setTimeout(r,20));
        state.previewScheduler?.cancel();
        while(state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(()=>null);
        clearTimeout(state.refreshTimer);clearTimeout(state.settleTimer);
        state.renderCoordinator?.cancelCatchUp(lane);state.renderCoordinator?.cancelPan(lane);
        if(!await renderGpuDraft(lane,{longEdge:600})) throw Error('GPU render failed');
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        const im=new Image();im.src=els.previewCanvas.toDataURL('image/png');await im.decode();
        const c=document.createElement('canvas');c.width=els.previewCanvas.width;c.height=els.previewCanvas.height;
        c.getContext('2d').drawImage(im,0,0);
        const gpu=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        const response=await fetch(`/api/session/${state.session.session_id}/preview-raw/${lane}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adjustments:state.adjustments,local_adjustments:[],long_edge:600,hdr_display:false})});
        if(!response.ok) throw Error('CPU reference failed');
        const cpu=new Uint8Array(await response.arrayBuffer());
        const encode=b=>{let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);};
        return {size:[c.width,c.height,Number(response.headers.get('X-Image-Width')),Number(response.headers.get('X-Image-Height'))],captured:{gpu:encode(gpu),cpu:encode(cpu)}};
      },{lane,midpoint});
      const colour=await comparator.compare(captures);
      assert(colour.mean<=1 && colour.p999<=2,JSON.stringify(colour));
      console.log(`${lane} midpoint ${midpoint}: preview/CPU Delta E 2000 ${JSON.stringify(colour)}`);
      if(lane==='sdr') for(const force_cpu of [true,false]) {
        await post('/api/delivery/preferences',{force_cpu});
        const target=path.join(root,`midpoint-${midpoint}-${force_cpu}.png`);
        await global.HDRFinisherElectronTestHarness.selectExportPath(target);
        const permission=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:'png',suggestedName:'midpoint.png'}));
        const result=await post(`/api/session/${session.session_id}/export`,{format:'sdr_png',dithering:'off',output_finishing:{resize_mode:'long_edge',long_edge:600,sharpening:'off'},output_path:target,path_grant:permission.grant});
        assert(result.accepted,JSON.stringify(result));assert.equal(result.renderer,force_cpu?'cpu':'gpu');
        const pixels=await page.evaluate(async bytes=>{
          const im=new Image();im.src='data:image/png;base64,'+bytes;await im.decode();
          const c=document.createElement('canvas');c.width=im.width;c.height=im.height;c.getContext('2d').drawImage(im,0,0);
          const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          let s='';for(let i=0;i<data.length;i+=32768)s+=String.fromCharCode(...data.subarray(i,i+32768));return {width:c.width,height:c.height,data:btoa(s)};
        },fs.readFileSync(target).toString('base64'));
        const exported=await comparator.compare({size:[...captures.size.slice(0,2),pixels.width,pixels.height],captured:{gpu:captures.captured.gpu,cpu:pixels.data}});
        assert(exported.mean<=1 && exported.p999<=2,JSON.stringify(exported));
        console.log(`midpoint ${midpoint}: preview/${result.renderer} PNG Delta E 2000 ${JSON.stringify(exported)}`);
      }
    }
  } finally {await post('/api/delivery/preferences',{force_cpu:false}).catch(()=>{});await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{comparator.close();fs.rmSync(root,{recursive:true,force:true});});
