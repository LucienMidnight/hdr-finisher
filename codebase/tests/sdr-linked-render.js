/* Finished float SDR CPU/GPU comparison, before encoders; no presentation shortcut. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const platform = require('../tools/lib/platform.cjs');
const base = process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8765';
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'test-sdr-link-'));
  let browser;
  const report = [];
  try {
    execFileSync(platform.pythonExecutable(), ['tests/helpers/sdr_link_reference.py', directory]);
    const cases = JSON.parse(fs.readFileSync(path.join(directory, 'cases.json')));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('pageerror', e => console.error(e));
    await page.goto(base);
    await page.waitForFunction(() => state.gpuPreview?.available, null, { timeout: 30000 });
    const response = await page.request.post(`${base}/api/session`, {multipart:{file:{name:'source.tiff',mimeType:'image/tiff',buffer:fs.readFileSync(path.join(directory,'source.tiff'))}}});
    assert(response.ok(), await response.text());
    const {session} = await response.json();
    await page.evaluate(s => activateDesktopSession(s, ''), session);
    await page.addScriptTag({url:base+'/static/gpu-delivery-finishing.js'});
    await page.evaluate(async()=>{state.previewScheduler?.cancel();while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);});
    for (const test of cases.rows) for (const execution of ['preview','direct','tiled']) {
      const pixels = await page.evaluate(async ({test,width,height,execution}) => {
        const gpu = state.gpuPreview;
        gpu.device.pushErrorScope('validation');
        const canvas = gpu.linkedTestCanvas ||= document.createElement('canvas');

        if(execution==='preview') {
          const rendered=await gpu.renderTo(canvas,state.session.session_id,'sdr',test.adjustments,sampleCurvePoints,
            Math.max(width,height),test.locals,state.editRevision,null,203,{width,height},
            {measureOnly:true,scopeAnalysis:true,sourceLane:'hdr',frameAnchor:true});
          const error=await gpu.device.popErrorScope();if(error)throw Error(error.message);
          if(rendered?.execution!=='direct')throw Error('Linked preview refused');
          const raw=await gpu.analyzeScope(canvas,{width,height,tier:'picture',raw:true});
          const floats=new Float32Array(width*height*4);
          for(let i=0;i<width*height;i++){for(let c=0;c<3;c++)floats[i*4+c]=(()=>{const h=raw.halves[i*3+c],sign=h&32768?-1:1,e=(h>>10)&31,f=h&1023;return sign*(e?Math.pow(2,e-15)*(1+f/1024):f*Math.pow(2,-24));})();floats[i*4+3]=1;}
          return Array.from(floats);
        }
        const finishing = new HDRGpuDeliveryFinishing(gpu,async()=>{});await finishing.initialize();
        gpu.executionOverride=execution;
        try {
          const delivery={texture:finishing.texture(width,height,'rgba16float')};
          const rendered = await gpu.renderTo(canvas,state.session.session_id,'sdr',test.adjustments,sampleCurvePoints,
            Math.max(width,height),test.locals,state.editRevision,null,203,{width,height},
            {measureOnly:true,delivery,beforeDeliverySubmit:async()=>{},sourceLane:'hdr',tileSize:64});
          const error=await gpu.device.popErrorScope();if(error)throw Error(error.message);
          if(rendered?.execution!==execution)throw Error('Linked GPU renderer refused '+execution+': '+JSON.stringify(rendered));
          const job={id:'linked-test',params:delivery.params,width,height,output:[width,height],
            adjustments:test.adjustments,finishing:{sharpening:'off'}};
          const texture=await finishing.finish(delivery.texture,job,'sdr');
          return Array.from(await finishing.read(texture));
        } finally {finishing.destroy();gpu.executionOverride=null;}
      }, {test,width:cases.width,height:cases.height,execution});
      const half = Buffer.from(new Float32Array(pixels).buffer);
      fs.writeFileSync(path.join(directory,'gpu.f32'), half);
      const result = JSON.parse(execFileSync(platform.pythonExecutable(), ['-c', `
import sys,json,numpy as np,colour
from pathlib import Path
sys.path.insert(0,'backend')
from hdr_finisher.models import AdjustmentState,LocalAdjustment,PreviewKind
from hdr_finisher.adjustments import apply_adjustments
import tifffile
p=Path(sys.argv[1]);c=json.loads((p/'cases.json').read_text());t=c['rows'][int(sys.argv[2])]
suffix='sdr' if sys.argv[3]=='preview' else 'delivery'
cpu=np.fromfile(p/(t['name']+'-'+suffix+'.f32'),dtype='<f4').reshape(c['height'],c['width'],3)
gpu=np.fromfile(p/'gpu.f32',dtype='<f4').reshape(c['height'],c['width'],4)[...,:3]
s=colour.RGB_COLOURSPACES['sRGB']
def lab(x):return colour.XYZ_to_Lab(x.astype(float)@s.matrix_RGB_to_XYZ.T,s.whitepoint)
e=colour.difference.delta_E_CIE2000(lab(cpu),lab(gpu))
print(json.dumps(dict(mean=float(e.mean()),p999=float(np.percentile(e,99.9)),finite=bool(np.isfinite(gpu).all()))))
`, directory, String(cases.rows.indexOf(test)),execution], {encoding:'utf8'}));
      report.push({name:test.name,execution,...result}); console.log(test.name,execution,result);
      assert(result.finite && result.mean < 1 && result.p999 <= 3, JSON.stringify(report.at(-1)));
    }
  } finally {
    fs.mkdirSync('output/review/safe-link',{recursive:true});
    fs.writeFileSync('output/review/safe-link/gpu.json',JSON.stringify(report,null,2));
    await browser?.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
