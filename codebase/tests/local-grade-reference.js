/** Actual local GPU pass versus CPU export, with colour wheels and opacity. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),index=process.argv.indexOf('--output');
const output=path.resolve(index<0?'output/performance/local-grade-reference.json':process.argv[index+1]);
const cases=JSON.parse(execFileSync(require('../tools/lib/platform.cjs').pythonExecutable(),['-c',`
import json,numpy as np
from backend.hdr_finisher.models import LocalGrade,PreviewKind,HDRAdjustments,SDRAdjustments
from backend.hdr_finisher.adjustments import _apply_curve_set, SDR_SCENE_TO_DISPLAY_SCALE
from backend.hdr_finisher.color import acescg_to_linear_srgb
from backend.hdr_finisher.local_adjustments import _apply_local_grade
pixels=np.array([[[0,0,0],[.00001,.00002,.00003],[-.0002,-.0004,.002],[.05,.1,.2],[.3,.8,.2],[.8,.7,.6],[1,2,4],[4,.1,.2]]],dtype=np.float32)
cases=[]
for kind in [PreviewKind.HDR,PreviewKind.SDR]:
 for name,recipe in [('neutral',{}),('five-tone',dict(exposure=.35,contrast=.2,blacks=80,whites=-75,shadows=100,midtones=-80,highlights=65,shadows_center=-2,shadows_width=3.5,midtones_width=2.5,highlights_center=2,highlights_width=4)),('whites',dict(whites=100)),('black-floor',dict(blacks=-100)),('neutral-hue-balance',dict(color_grading=dict(shadows=dict(hue=270),balance=45,blending=100))),('tiny-shadows',dict(color_grading=dict(shadows=dict(hue=210,saturation=.001),blending=0))),('active',dict(color_grading=dict(shadows=dict(hue=210,saturation=30,luminance_ev=.2),midtones=dict(hue=45,saturation=20,luminance_ev=-.1),highlights=dict(hue=90,saturation=15,luminance_ev=.1),balance=-30,blending=0))),('combined',dict(exposure=.7,contrast=.2,white_balance_kelvin=8000,tint=.2,saturation=.15,vibrance=.25,color_grading=dict(midtones=dict(hue=160,saturation=25,luminance_ev=.3),balance=20,blending=100))),('luma-curve',dict(luma_curve=[[0,0],[.25,.3],[.5,.6],[.75,.8],[1,1]])),('rgb-curves',dict(red_curve=[[0,0],[.25,.2],[.5,.4],[.75,.7],[1,1]],blue_curve=[[0,0],[.25,.3],[.5,.6],[.75,.8],[1,1]]))]:
  grade=LocalGrade(**recipe)
  for reference,peak in ([(203,1000),(100,400),(203,400)] if name=="five-tone" else [(203,1000)]):
   for opacity in [1,.4]:
    candidate=_apply_local_grade(pixels,grade,kind,reference_white_nits=reference,target_peak_nits=peak)
    expected=pixels+(candidate-pixels)*np.float32(opacity)
    cases.append(dict(lane=kind.value,name=name,reference=reference,peak=peak,opacity=opacity,grade=grade.model_dump(),source=pixels.reshape(-1).tolist(),expected=expected.reshape(-1).tolist()))
# Exercise both entry points with signed shadows, a black floor, and scene
# values above 4,000 nits before delivery compression.
high=np.array([[[0,0,0],[0,1e-5,0],[.00006,-.0002,-.00005],[.05,.1,.2],
                [.1,.2,.04],[.8,.2,.3],[4,.8,2],[4.5,5,6]]],dtype=np.float32)
recipe=dict(luma_curve=[[0,.12],[.25,.22],[.5,.54],[1,1]],
            red_curve=[[0,0],[.3,.28],[.55,.60],[1,1]],
            blue_curve=[[0,0],[.25,.30],[.55,.50],[1,1]])
for kind,branch in [(PreviewKind.HDR,HDRAdjustments),(PreviewKind.SDR,SDRAdjustments)]:
 p=high if kind==PreviewKind.HDR else acescg_to_linear_srgb(high)*SDR_SCENE_TO_DISPLAY_SCALE
 for scope in ['global','local']:
  grade=branch(**recipe) if scope=='global' else LocalGrade(**recipe)
  result=_apply_curve_set(p,grade,kind) if scope=='global' else _apply_local_grade(p,grade,kind)
  cases.append(dict(scope=scope,lane=kind.value,name='extended-curve',reference=203,peak=1000,opacity=1,
                    grade=grade.model_dump(),source=p.reshape(-1).tolist(),expected=result.reshape(-1).tolist()))
print(json.dumps(cases))
`],{cwd:root,encoding:'utf8'}));
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799');await page.waitForFunction(()=>state.gpuPreview?.available);
 const results=await page.evaluate(async cases=>{
  const renderer=state.gpuPreview,d=renderer.device,results=[];
  renderer.uploadParamsAndCurves('hdr',state.adjustments,sampleCurvePoints,buildParams("hdr",state.adjustments,"acescg",true,203));
  const pipeline=d.createRenderPipeline({layout:renderer.pipelineLayout,vertex:{module:renderer.module,entryPoint:'vertexMain'},fragment:{module:renderer.module,entryPoint:'localAdjustmentFragmentMain',targets:[{format:'rgba32float'}]},primitive:{topology:'triangle-list'}});
  const globalModule=d.createShaderModule({code:HDRWebGPUShaders.SHADER_SOURCE + `
    @fragment fn globalCurveProbe(input: VertexOut) -> @location(0) vec4f {
      let rgb = textureLoad(sourceTexture, vec2i(input.position.xy), 0).rgb;
      return vec4f(applyCurves(rgb, p[${GPU_PARAMS.HDR_LANE}] > 0.5), 1.0);
    }
  `});
  const globalPipeline=d.createRenderPipeline({layout:renderer.pipelineLayout,vertex:{module:globalModule,entryPoint:'vertexMain'},fragment:{module:globalModule,entryPoint:'globalCurveProbe',targets:[{format:'rgba32float'}]},primitive:{topology:'triangle-list'}});
  for(const fixture of cases){
   const local={id:'local-grade-probe',enabled:true,opacity:fixture.opacity,mask:{operator:'leaf',leaf:{type:'brush',mask_opacity:1}},[fixture.lane+'_grade']:fixture.grade};
   const decoy={...local,id:'other-curve-probe',[fixture.lane+'_grade']:{...fixture.grade,luma_curve:[[0,0],[.5,.2],[1,1]]}};
   renderer.uploadParamsAndCurves(fixture.lane,state.adjustments,sampleCurvePoints,buildParams("hdr",state.adjustments,"acescg",true,203),[decoy,local]);
   if(!renderer.supportsLocalAdjustments(fixture.lane,[local]))throw Error('Local colour wheels rejected');
   const globalAdjustments=structuredClone(state.adjustments);
   globalAdjustments.hdr.highlight_compression_target_nits=fixture.peak;
   const globalParams=buildParams(fixture.lane,globalAdjustments,'acescg',fixture.lane==='hdr',fixture.reference);
   const global=fixture.scope==='global';
   if(global){
    globalAdjustments[fixture.lane]=fixture.grade;
    const uniforms=buildParams(fixture.lane,globalAdjustments,'acescg',fixture.lane==='hdr',fixture.reference);
    renderer.uploadParamsAndCurves(fixture.lane,globalAdjustments,sampleCurvePoints,uniforms);
   }
   const params=global?renderer.paramBuffer:renderer.localParamBuffer(local,fixture.lane,1,8,1,null,globalParams);
   const source=d.createTexture({size:[8,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const mask=d.createTexture({size:[8,1],format:'r16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const target=d.createTexture({size:[8,1],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   const read=d.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{
    const rgba=new Float32Array(32);for(let i=0;i<8;i++){rgba.set(fixture.source.slice(i*3,i*3+3),i*4);rgba[i*4+3]=1;}
    d.queue.writeTexture({texture:source},rgba,{bytesPerRow:128},[8,1]);d.queue.writeTexture({texture:mask},new Uint16Array(8).fill(0x3c00),{bytesPerRow:16},[8,1]);
    const e=d.createCommandEncoder(),pass=e.beginRenderPass({colorAttachments:[{view:target.createView(),clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'}]});
    pass.setPipeline(global?globalPipeline:pipeline);pass.setBindGroup(0,renderer.bindGraphResources(source.createView(),mask.createView(),{buffer:params}));pass.draw(3);pass.end();e.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:256},[8,1]);d.queue.submit([e.finish()]);
    await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange()),actual=[];for(let i=0;i<8;i++)actual.push(...values.slice(i*4,i*4+3));read.unmap();
    results.push({scope:fixture.scope,lane:fixture.lane,name:fixture.name,opacity:fixture.opacity,pixels:8,maxError:Math.max(...actual.map((v,i)=>Math.abs(v-fixture.expected[i]))),actual,expected:fixture.expected});
   }finally{[source,mask,target,read].forEach(v=>v.destroy());}
  }return results;
 },cases);
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
 for(const result of results.filter(result=>!result.scope))assert.ok(result.maxError<=.00002,JSON.stringify(result));
 const perceptual=execFileSync(require('../tools/lib/platform.cjs').pythonExecutable(),['-c',`
import sys,json,colour,numpy as np
from backend.hdr_finisher.color import acescg_to_linear_bt2020
for case in json.load(sys.stdin):
 rgb=[np.array(case[k],dtype=np.float32).reshape(-1,3) for k in ('actual','expected')]
 if case['lane']=='hdr':
  ictcp=[colour.RGB_to_ICtCp(np.maximum(acescg_to_linear_bt2020(x),0)*203/.18) for x in rgb]
  delta=colour.difference.delta_E_ITP(*ictcp)
  limits=(1,3)
 else:
  from backend.hdr_finisher.sdr_gamut import compress_to_srgb_gamut
  lab=[colour.XYZ_to_Lab(colour.RGB_to_XYZ(compress_to_srgb_gamut(x[None])[0],colour.RGB_COLOURSPACES['sRGB'])) for x in rgb]
  delta=colour.difference.delta_E_CIE2000(*lab)
  limits=(.5,1.5)
 mean,p99=float(delta.mean()),float(np.percentile(delta,99))
 print(case['lane'],case['scope'],'mean/p99',mean,p99)
 assert mean<limits[0] and p99<limits[1], case
 `],{cwd:root,encoding:'utf8',input:JSON.stringify(results.filter(result=>result.scope))});
 console.log(perceptual.trim());
 console.log(`Curve and local grade GPU/CPU: ${results.length} cases, ${results.length*8} pixels pass.`);
 if(process.argv.includes('--layout')){
  const base=process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799';
  const uploaded=await page.request.post(`${base}/api/session`,{multipart:{file:{name:'local.tiff',mimeType:'image/tiff',buffer:fs.readFileSync(path.join(__dirname,'fixtures','hdr_headroom.tiff'))}}});
  assert.ok(uploaded.ok(),await uploaded.text());
  await page.evaluate(session=>activateDesktopSession(session,''),(await uploaded.json()).session);
  await page.locator("#grade-mode-local").click();
  for(const [width,height] of [[1408,794],[1100,720]]){
   await browser.newPage({viewport:{width,height}});
   for(const lane of ['hdr','sdr']){
    await page.evaluate(async lane=>{
     await switchLane(lane);
     state.localUnusedAdjustment=newLocalAdjustment('brush');
     state.selectedLocalId=state.localUnusedAdjustment.id;
     renderLocalAdjustments();
     const group=document.querySelector('[data-group="local-adjustments"]');
     if(group.classList.contains('collapsed'))group.querySelector('.group-toggle').click();
    },lane);
    const fields=['blacks','shadows','shadows_center','shadows_width','midtones','midtones_center','midtones_width','highlights','highlights_center','highlights_width','whites'];
    for(const field of fields){
     const control=page.locator(`[data-local-grade="${field}"]`);
     await control.evaluate(node=>node.scrollIntoView({block:"center",inline:"nearest"}));
     await page.evaluate(()=>new Promise(requestAnimationFrame));
     const box=await control.boundingBox();
     assert.ok(box&&box.width>0&&box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=height,`${lane} ${field} ${width}: ${JSON.stringify(box)}`);
    }
    assert.equal(await page.locator('[data-local-grade="highlights_center"]').inputValue(),lane==='hdr'?'2.25':'1.75');
    await page.screenshot({path:path.join(path.dirname(output),`local-tone-${lane}-${width}x${height}.png`)});
   }
  }
  console.log('Local Tone layout: HDR/SDR at 1408x794 and 1100x720 pass.');
 }

}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
