/** Finished SDR local Detail -> Film Look: real preview against CPU export. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const python = require('../tools/lib/platform.cjs').pythonExecutable();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'test-local-detail-film-'));
const fixture = path.join(scratch, 'headroom.tif');
const output = path.join(root, 'output/w1-local-detail-film.json');
const records = [];
execFileSync(python, ['-c', `
import numpy as np,tifffile,sys
h,w=256,384
y,x=np.mgrid[:h,:w].astype(np.float32)
v=np.exp2(2-8*y/h+.35*np.sin(x*.17)+.15*np.cos(y*.29))
rgb=np.stack([v,v*.78,v*.53],axis=-1).astype(np.float32)
tifffile.imwrite(sys.argv[1],rgb,photometric='rgb')
`, fixture], {cwd:root});
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = query => {
        const answer = original(query);
        return query === '(dynamic-range: high)' ? new Proxy(answer, {get(target,key) {
          if(key === 'matches')return false;
          const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
        }}) : answer;
      };
    });
    const url = process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8799';
    await page.goto(url);
    await page.waitForFunction(() => state.gpuPreview?.available, null, {timeout:30000});
    const response = await page.request.post(url+'/api/session', {multipart:{file:{name:'headroom.tif',mimeType:'application/octet-stream',buffer:fs.readFileSync(fixture)}}});
    assert.ok(response.ok(), await response.text());
    await page.evaluate(session => activateDesktopSession(session,''), (await response.json()).session);
    await page.waitForFunction(() => viewerState().status==='ready'&&!state.gpuDraftInFlight);
    await page.evaluate(async () => {
      stopPreviewWatchdog();
      await switchLane('sdr');
      const local=newLocalAdjustment('linear_gradient');
      local.name='Headroom before Film';
      local.mask.leaf.start={x:.5,y:.5};local.mask.leaf.end={x:.5,y:.5};
      local.sdr_grade.exposure=1;
      Object.assign(local.sdr_grade.detail,{clarity_amount:21,sharpen_amount:55});
      if(!await queueEditCommand('create_local',{local}))throw Error('Local creation failed');
    });
    for (const stock of ['kodak_portra_400','fujifilm_velvia_100']) {
      const result = await page.evaluate(async stock => {
        await HDRFilmStocks.request(stock);
        state.adjustments.sdr.film_look_section_enabled=true;
        Object.assign(state.adjustments.sdr.film_look,{film_stock:stock,grain_amount:0,halation_amount:0,lens_filter:'none',film_resolution:100});
        state.globalEditDirty=true;
        if(!await syncGlobalEditState())throw Error('Grade sync failed');
        invalidatePreview('sdr');await settlePreview('sdr',{});
        while(pendingHighlightAnchors.size||exactHighlightAnchorInflight.size)await new Promise(r=>setTimeout(r,20));
        state.previewScheduler?.cancel();
        while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);
        if(!await renderGpuDraft('sdr',{longEdge:384}))throw Error('GPU preview failed');
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        const image=new Image();image.src=els.previewCanvas.toDataURL('image/png');await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const context=canvas.getContext('2d');context.drawImage(image,0,0);
        const pixels=context.getImageData(0,0,image.width,image.height).data;
        const edit=await (await fetch(`/api/session/${state.session.session_id}/edit-state`)).json();
        let binary='';for(let i=0;i<pixels.length;i+=32768)binary+=String.fromCharCode(...pixels.subarray(i,i+32768));
        return {width:image.width,height:image.height,gpu:btoa(binary),document:edit.document};
      }, stock);
      assert.equal(result.width,384);assert.equal(result.height,256);
      fs.writeFileSync(path.join(scratch,'capture.json'),JSON.stringify(result));
      const metrics=JSON.parse(execFileSync(python, ['-c', `
import base64,json,sys,numpy as np
sys.path.insert(0, "backend")
from pathlib import Path
from dataclasses import asdict
from hdr_finisher.models import EditDocument,ExportSettings,PreviewKind
from hdr_finisher.projects import open_document
from hdr_finisher.sessions import SessionStore
from hdr_finisher.exporters import _render_export_branch,_finishing_adjustments_for_export
from hdr_finisher.delivery_colour import compare_finished_pixels
capture=json.loads(Path(sys.argv[1]).read_text())
store=SessionStore()
try:
 session=open_document(store,EditDocument.model_validate(capture['document']),Path(sys.argv[2]))
 reference=_render_export_branch(session,ExportSettings(renderer='cpu'),PreviewKind.SDR,_finishing_adjustments_for_export(session))
 rgba=np.frombuffer(base64.b64decode(capture['gpu']),np.uint8).reshape(capture['height'],capture['width'],4)
 assert np.all(rgba[...,3]==255)
 encoded=rgba[...,:3].astype(np.float32)/255
 gpu=np.where(encoded<=.04045,encoded/12.92,((encoded+.055)/1.055)**2.4)
 metrics=compare_finished_pixels(gpu,reference,'sdr')
 print(json.dumps(dict(**asdict(metrics),passed=metrics.passed)))
finally:store.clear()
`,path.join(scratch,'capture.json'),fixture], {cwd:root,encoding:'utf8',maxBuffer:1024*1024}));
      records.push({stock,...metrics});
      assert.ok(metrics.passed,JSON.stringify(records.at(-1)));
    }
    console.log('Local Detail then Film Look matches CPU export:',JSON.stringify(records));
  } finally {
    fs.writeFileSync(output,JSON.stringify({records},null,2)+'\n');
    await browser.close();fs.rmSync(scratch,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);fs.rmSync(scratch,{recursive:true,force:true});process.exitCode=1;});
