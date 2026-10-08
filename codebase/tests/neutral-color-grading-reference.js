/** Actual GPU grading versus export, including signed near-black RAW pixels.
 * Run through tests/run-in-electron.js; no project is opened or saved.
 */
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const {chromium} = require('playwright');
const root = path.join(__dirname, '..');
const index = process.argv.indexOf('--output');
const output = path.resolve(index < 0 ? 'output/performance/neutral-color-grading.json' : process.argv[index + 1]);
const cases = JSON.parse(execFileSync(process.env.HDR_FINISHER_PYTHON || path.join(root, '.venv/Scripts/python.exe'), ['-c', `
import json
import numpy as np
from backend.hdr_finisher.color import map_negative_acescg
from backend.hdr_finisher.adjustments import _apply_color_grading
from backend.hdr_finisher.models import ColorGradingAdjustments, PreviewKind
pixels = np.array([[[-.00028979886,-.00048077852,.00236804318],[-.00001202161,-.00023974421,.001966723], [0,0,0],[-.001,-.001,-.001], [1e-8,2e-8,3e-8],[.1,.2,.3],[1,2,4],[-.01,.2,.3]]],dtype=np.float32)
cases=[]
for kind in [PreviewKind.HDR,PreviewKind.SDR]:
    for name, recipe, enabled in [('neutral',{},True),('neutral-hue-balance',dict(shadows=dict(hue=270),midtones=dict(hue=90),highlights=dict(hue=180),balance=45,blending=100),True),('disabled',dict(shadows=dict(saturation=30)),False),('active',dict(shadows=dict(hue=210,saturation=30,luminance_ev=.2),midtones=dict(hue=45,saturation=20,luminance_ev=-.1),highlights=dict(hue=90,saturation=15,luminance_ev=.1)),True)]:
        grading=ColorGradingAdjustments(**recipe)
        expected=_apply_color_grading(pixels,grading,kind) if enabled else pixels
        fixture=dict(lane=kind.value,name=name,grading=grading.model_dump(),enabled=enabled,clampOutput=kind==PreviewKind.SDR and name=='active',source=pixels.reshape(-1).tolist(),expected=expected.reshape(-1).tolist())
        cases.append(fixture)
        if kind==PreviewKind.HDR:cases.append(dict(fixture,name='base/'+name,base=True))
        if kind==PreviewKind.HDR:
            mapped=map_negative_acescg(pixels)
            mapped_expected=_apply_color_grading(mapped,grading,kind) if enabled else mapped
            mapped_fixture=dict(fixture,name='mapped-source/'+name,source=mapped.reshape(-1).tolist(),expected=mapped_expected.reshape(-1).tolist())
            cases.append(mapped_fixture)
            cases.append(dict(mapped_fixture,name='base/mapped-source/'+name,base=True))
print(json.dumps(cases))
`], {cwd:root,encoding:'utf8'}));

(async () => {
  const browser = await chromium.launch(), page = await browser.newPage();
  try {
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8799');
    await page.waitForFunction(() => state.gpuPreview?.available);
    const results = await page.evaluate(async cases => {
      const renderer=state.gpuPreview,device = renderer.device;
      renderer.ensureStorageBuffers(196*4,4);
      const dummy=renderer.createMaskTexture(1,1);
      const module = device.createShaderModule({code:HDRWebGPUShaders.SHADER_SOURCE + `
        @fragment fn gradingProbe(input: VertexOut) -> @location(0) vec4f {
          let source=textureLoad(sourceTexture, vec2i(input.position.xy), 0).rgb;
          var graded = applyColorGrading(source, p[0] > 0.5);
          if(p[194]>0.5){graded=renderHdrBase(source);}
          // renderSdrBase immediately clamps active grading to display range;
          // CPU's grading function includes that upper clamp itself.
          return vec4f(select(graded, min(graded, vec3f(1.0)), p[195] > 0.5), 1.0);
        }
      `});
      const pipeline = device.createRenderPipeline({layout:renderer.pipelineLayout,
        vertex:{module,entryPoint:'vertexMain'},fragment:{module,entryPoint:'gradingProbe',targets:[{format:'rgba32float'}]},primitive:{topology:'triangle-list'}});
      const results=[];
      for(const fixture of cases) {
        const source=device.createTexture({size:[8,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
        const target=device.createTexture({size:[8,1],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
        const params=new Float32Array(196); params[0]=fixture.lane==='hdr'?1:0;params[111]=fixture.enabled?1:0;
        params[195]=fixture.clampOutput?1:0;
        params[194]=fixture.base?1:0;
        params[112]=.55+3.45*fixture.grading.blending/100;params[113]=fixture.grading.balance/50;
        ['shadows','midtones','highlights'].forEach((name,i)=>{const wheel=fixture.grading[name];params[114+i*3]=wheel.hue;params[115+i*3]=wheel.saturation/400;params[116+i*3]=wheel.luminance_ev;});
        const buffer=device.createBuffer({size:params.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
        const read=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        try {
          const rgba=new Float32Array(32); for(let i=0;i<8;i++){rgba.set(fixture.source.slice(i*3,i*3+3),i*4);rgba[i*4+3]=1;}
          device.queue.writeTexture({texture:source},rgba,{bytesPerRow:128},[8,1]);device.queue.writeBuffer(buffer,0,params);
          const group=renderer.bindGraphResources(source.createView(),dummy.createView(),{buffer},dummy.createView());
          const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
          pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
          encoder.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:256},[8,1]);device.queue.submit([encoder.finish()]);
          await read.mapAsync(GPUMapMode.READ); const values=new Float32Array(read.getMappedRange());
          const actual=[];for(let i=0;i<8;i++)actual.push(...values.slice(i*4,i*4+3));read.unmap();
          const maxError=Math.max(...actual.map((v,i)=>Math.abs(v-fixture.expected[i])));
          results.push({lane:fixture.lane,name:fixture.name,pixels:8,maxError,firstPixel:actual.slice(0,3)});
        } finally {[source,target,buffer,read].forEach(r=>r.destroy());}
      }
      dummy.destroy();return results;
    },cases);
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
    for(const result of results) assert.ok(result.maxError<=.000002,JSON.stringify(result));
    console.log(`Colour grading/HDR base CPU/GPU: ${results.length} cases, ${results.length*8} pixels pass.`);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
