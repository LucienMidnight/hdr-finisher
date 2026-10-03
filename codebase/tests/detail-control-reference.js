/** Isolated global/local Detail controls versus apply_detail. Disposable GPU only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const output = path.resolve(args.includes('--output') ? args[args.indexOf('--output') + 1]
  : path.join(root, 'output/performance/detail-control-reference.json'));
const python = process.env.HDR_FINISHER_PYTHON || path.join(root, '.venv/Scripts/python.exe');
const fixtures = JSON.parse(execFileSync(python, ['-c', `
import base64,json,numpy as np
from backend.hdr_finisher.detail import apply_detail
from backend.hdr_finisher.models import DetailAdjustments,PreviewKind
def encoded(a): return base64.b64encode(np.asarray(a,dtype=np.float32).tobytes()).decode()
w,h=192,128
y,x=np.mgrid[:h,:w].astype(np.float32)
v=.18*np.exp2(.7*np.sin(x*.41)+.3*np.cos(y*.19)+2*np.sin(x*.017))
v[:,90:94]*=4
v[40:44,:]*=.02
rgb=np.stack([v,v*.7,v*.4],axis=-1).astype(np.float32)
rgba=np.concatenate([rgb,np.ones((h,w,1),np.float32)],axis=-1)
mask=(.5+.5*np.sin(x*.028)*np.cos(y*.039)).astype(np.float32)
base=DetailAdjustments().model_dump()
controls={'texture_amount':[-100,0,100],'clarity_amount':[-100,0,100],
 'clarity_radius_percent':[.2,.75,3],'sharpen_amount':[0,0,200],
 'sharpen_radius_px':[.3,.8,3],'sharpen_threshold':[0,10,100]}
cases=[]
for lane in ['hdr','sdr']:
 for route in ['global','local']:
  for name,values in controls.items():
   for label,value in zip(['low','default','maximum'],values):
    detail=dict(base)
    if name=='clarity_radius_percent': detail['clarity_amount']=65
    if name in ['sharpen_radius_px','sharpen_threshold']: detail['sharpen_amount']=100
    detail[name]=value
    candidate=apply_detail(rgb,DetailAdjustments(**detail),PreviewKind(lane))
    expected=rgb+(candidate-rgb)*mask[...,None] if route=='local' else candidate
    cases.append(dict(lane=lane,route=route,control=name,label=label,detail=detail,opacity=1,expected=encoded(expected)))
  if route=='local':
   for label,opacity in [('low',0),('default',1),('maximum',1),('partial',.35)]:
    detail=dict(base,texture_amount=100,clarity_amount=100,clarity_radius_percent=3,sharpen_amount=200,sharpen_radius_px=3,sharpen_threshold=0)
    candidate=apply_detail(rgb,DetailAdjustments(**detail),PreviewKind(lane))
    expected=rgb+(candidate-rgb)*(mask*opacity)[...,None]
    cases.append(dict(lane=lane,route=route,control='opacity',label=label,detail=detail,opacity=opacity,expected=encoded(expected)))
print(json.dumps(dict(width=w,height=h,source=encoded(rgba),mask=encoded(mask),cases=cases)))
`], { cwd: root, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8799');
    await page.waitForFunction(() => state.gpuPreview?.available, null, { timeout: 30000 });
    const report = await page.evaluate(async fixtures => {
      const renderer = state.gpuPreview, device = renderer.device;
      renderer.ensureStorageBuffers(196 * 4, 4);
      device.pushErrorScope('validation');
      const { width, height } = fixtures;
      const decoded = data => {
        const binary = atob(data), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new Float32Array(bytes.buffer);
      };
      const half = value => {
        const sign = value & 0x8000 ? -1 : 1, exponent = (value >> 10) & 31, mantissa = value & 1023;
        return sign * (exponent ? (1 + mantissa / 1024) * 2 ** (exponent - 15) : mantissa * 2 ** -24);
      };
      const texture = format => device.createTexture({ size: [width, height], format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
          | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const source = texture('rgba16float'), maskTexture = texture('rgba16float');
      const a = texture('rgba16float'), b = texture('rgba16float'), candidate = texture('rgba16float'), mixed = texture('rgba16float');
      const packed = values => {
        const result = new Uint16Array(values.length);
        for (let i = 0; i < values.length; i++) {
          const value = values[i], sign = value < 0 ? 0x8000 : 0, magnitude = Math.abs(value);
          const exponent = Math.floor(Math.log2(Math.max(magnitude, 1e-30)));
          result[i] = sign | (exponent < -14 ? Math.round(magnitude / 2 ** -24)
            : ((exponent + 15) << 10) + Math.round((magnitude / 2 ** exponent - 1) * 1024));
        }
        return result;
      };
      const maskValues = decoded(fixtures.mask), maskFloat = new Float32Array(width * height * 4);
      maskValues.forEach((value,i) => { maskFloat[i*4] = value; });
      device.queue.writeTexture({ texture: source }, packed(decoded(fixtures.source)), { bytesPerRow: width * 8 }, [width, height]);
      device.queue.writeTexture({ texture: maskTexture }, packed(maskFloat), { bytesPerRow: width * 8 }, [width, height]);
      const pipelines = renderer.pipelineFor('rgba16float');
      const stride = Math.ceil(width * 8 / 256) * 256;
      const read = device.createBuffer({ size: stride * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const results = [];
      try {
        for (const fixture of fixtures.cases) {
          const local = { id: 'detail-reference', enabled: true, opacity: fixture.opacity,
            mask: { operator: 'leaf', leaf: { mask_opacity: 1 } },
            [fixture.lane + '_grade']: { enabled: true, detail: fixture.detail } };
          const buffer = renderer.localParamBuffer(local, fixture.lane, 1, width, height);
          const values = new Float32Array(renderer.localParamValues.get(local.id + ':' + fixture.lane));
          values[162] = width; values[163] = height;
          for (let i = 0; i < 7; i++) values[149 + i] = values[14 + i];
          device.queue.writeBuffer(buffer, 0, values);
          const encoder = device.createCommandEncoder();
          const bind = (src, spatial, overlay = spatial) => renderer.bindGraphResources(src.createView(), spatial.createView(), { buffer }, overlay.createView());
          const pass = (pipeline, target, group) => {
            const render = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
            render.setPipeline(pipeline); render.setBindGroup(0, group); render.draw(3); render.end();
          };
          const localRoute = fixture.route === 'local';
          pass(localRoute ? pipelines.localDetailHorizontal : pipelines.detailHorizontal, a, bind(source, source));
          pass(localRoute ? pipelines.localDetailVertical : pipelines.detailVertical, b, bind(a, a));
          let clarity = b;
          if (fixture.detail.clarity_amount) {
            const plan = { scale: values[167], baseScale: values[172],
              width: Math.ceil(width / values[167]), height: Math.ceil(height / values[167]),
              baseWidth: Math.ceil(width / values[172]), baseHeight: Math.ceil(height / values[172]) };
            const maps = renderer.clarityMapTextures('detail-reference', plan.baseWidth, plan.baseHeight);
            clarity = renderer.encodeClarityMap(encoder, pipelines,
              view => renderer.bindGraphResources(view, view, { buffer }, view), source.createView(), maps.textures, plan);
          }
          pass(localRoute ? pipelines.localDetailComposite : pipelines.detailComposite, candidate, bind(source, b, clarity));
          if (localRoute) pass(pipelines.localDetailMix, mixed, bind(source, maskTexture, candidate));
          encoder.copyTextureToBuffer({ texture: localRoute ? mixed : candidate }, { buffer: read, bytesPerRow: stride }, [width, height]);
          device.queue.submit([encoder.finish()]);
          await read.mapAsync(GPUMapMode.READ);
          const actual = new Uint16Array(read.getMappedRange()), expected = decoded(fixture.expected);
          const weights = fixture.lane === 'hdr' ? [.2722287,.6740818,.0536895] : [.2126,.7152,.0722];
          const errors = []; let maxChannelError = 0;
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            let actualY = 0, expectedY = 0;
            for (let channel = 0; channel < 3; channel++) {
              const value = half(actual[y * stride / 2 + x * 4 + channel]), reference = expected[(y * width + x) * 3 + channel];
              actualY += value * weights[channel]; expectedY += reference * weights[channel];
              maxChannelError = Math.max(maxChannelError, Math.abs(value - reference));
            }
            errors.push(Math.abs(actualY - expectedY) / Math.max(.01, Math.abs(expectedY)));
          }
          read.unmap(); errors.sort((a,b) => a-b);
          results.push({ lane: fixture.lane, route: fixture.route, control: fixture.control,
            label: fixture.label, detail: fixture.detail, opacity: fixture.opacity,
            pixels: width * height, luminanceP99: errors[Math.floor(errors.length * .99)],
            luminanceMax: errors.at(-1), maxChannelError });
        }
      } finally { [source, maskTexture, a, b, candidate, mixed, read].forEach(resource => resource.destroy()); }
      const validationError = await device.popErrorScope();
      if (validationError) throw new Error(validationError.message);
      return { adapter: renderer.adapterInfo, scope: 'isolated Detail and local influence, before output colour conversion', results };
    }, fixtures);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    for (const result of report.results) {
      assert.ok(result.luminanceP99 <= .02 && result.luminanceMax <= .05,
        `${result.lane} ${result.route} ${result.control} ${result.label}: ${result.luminanceP99}/${result.luminanceMax}`);
    }
    console.log(`Detail control reference: ${report.results.length} cases pass.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
