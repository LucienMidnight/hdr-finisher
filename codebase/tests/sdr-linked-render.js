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
    for (const test of cases.rows) {
      const pixels = await page.evaluate(async ({test,width,height}) => {
        const gpu = state.gpuPreview;
        gpu.device.pushErrorScope('validation');
        const value = await gpu.renderMatchCandidate(state.session.session_id, test.adjustments, sampleCurvePoints,
          test.locals, state.editRevision, 203, {width,height}, Math.max(width,height), {width,height});
        const error = await gpu.device.popErrorScope();
        if(error) throw Error(error.message);
        if(!value) throw Error('Linked GPU renderer refused the reference');
        // renderMatchCandidate disables grain for fitting. Physical-effect rows
        // are separately compared with the same no-grain CPU recipe below.
        return Array.from(value.pixels);
      }, {test,width:cases.width,height:cases.height});
      const half = Buffer.from(new Uint16Array(pixels).buffer);
      fs.writeFileSync(path.join(directory,'gpu.f16'), half);
      const result = JSON.parse(execFileSync(platform.pythonExecutable(), ['-c', `
import sys,json,numpy as np,colour
from pathlib import Path
sys.path.insert(0,'backend')
from hdr_finisher.models import AdjustmentState,LocalAdjustment,PreviewKind
from hdr_finisher.adjustments import apply_adjustments
import tifffile
p=Path(sys.argv[1]);c=json.loads((p/'cases.json').read_text());t=c['rows'][int(sys.argv[2])]
a=AdjustmentState.model_validate(t['adjustments']);a.hdr.film_look.grain_amount=0
cpu=apply_adjustments(tifffile.imread(p/'source.tiff'),a,PreviewKind.SDR,local_adjustments=[LocalAdjustment.model_validate(x) for x in t['locals']])
gpu=np.fromfile(p/'gpu.f16',dtype='<f2').astype(np.float32).reshape(c['height'],c['width'],3)
s=colour.RGB_COLOURSPACES['sRGB']
def lab(x):return colour.XYZ_to_Lab(x.astype(float)@s.matrix_RGB_to_XYZ.T,s.whitepoint)
e=colour.difference.delta_E_CIE2000(lab(cpu),lab(gpu))
print(json.dumps(dict(mean=float(e.mean()),p999=float(np.percentile(e,99.9)),finite=bool(np.isfinite(gpu).all()))))
`, directory, String(cases.rows.indexOf(test))], {encoding:'utf8'}));
      report.push({name:test.name,...result}); console.log(test.name, result);
      assert(result.finite && result.mean < 1 && result.p999 <= 3, JSON.stringify(report.at(-1)));
    }
  } finally {
    fs.mkdirSync('output/review/safe-link',{recursive:true});
    fs.writeFileSync('output/review/safe-link/gpu.json',JSON.stringify(report,null,2));
    await browser?.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
