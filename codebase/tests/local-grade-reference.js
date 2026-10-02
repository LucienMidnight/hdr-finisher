/** Actual local GPU pass versus CPU export, with colour wheels and opacity. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),index=process.argv.indexOf('--output');
const output=path.resolve(index<0?'output/performance/local-grade-reference.json':process.argv[index+1]);
const cases=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import json,numpy as np
from backend.hdr_finisher.models import LocalGrade,PreviewKind
from backend.hdr_finisher.local_adjustments import _apply_local_grade
pixels=np.array([[[0,0,0],[.00001,.00002,.00003],[-.0002,-.0004,.002],[.05,.1,.2],[.3,.8,.2],[.8,.7,.6],[1,2,4],[4,.1,.2]]],dtype=np.float32)
cases=[]
for kind in [PreviewKind.HDR,PreviewKind.SDR]:
 for name,recipe in [('neutral',{}),('neutral-hue-balance',dict(color_grading=dict(shadows=dict(hue=270),balance=45,blending=100))),('active',dict(color_grading=dict(shadows=dict(hue=210,saturation=30,luminance_ev=.2),midtones=dict(hue=45,saturation=20,luminance_ev=-.1),highlights=dict(hue=90,saturation=15,luminance_ev=.1),balance=-30,blending=0))),('combined',dict(exposure=.7,contrast=.2,white_balance_kelvin=8000,tint=.2,saturation=.15,vibrance=.25,color_grading=dict(midtones=dict(hue=160,saturation=25,luminance_ev=.3),balance=20,blending=100))),('luma-curve',dict(luma_curve=[[0,0],[.25,.3],[.5,.6],[.75,.8],[1,1]])),('rgb-curves',dict(red_curve=[[0,0],[.25,.2],[.5,.4],[.75,.7],[1,1]],blue_curve=[[0,0],[.25,.3],[.5,.6],[.75,.8],[1,1]]))]:
  grade=LocalGrade(**recipe)
  for opacity in [1,.4]:
   candidate=_apply_local_grade(pixels,grade,kind)
   expected=pixels+(candidate-pixels)*np.float32(opacity)
   cases.append(dict(lane=kind.value,name=name,opacity=opacity,grade=grade.model_dump(),source=pixels.reshape(-1).tolist(),expected=expected.reshape(-1).tolist()))
print(json.dumps(cases))
`],{cwd:root,encoding:'utf8'}));
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799');await page.waitForFunction(()=>state.gpuPreview?.available);
 const results=await page.evaluate(async cases=>{
  const renderer=state.gpuPreview,d=renderer.device,results=[];
  renderer.uploadParamsAndCurves('hdr',state.adjustments,sampleCurvePoints,new Float32Array(190));
  const pipeline=d.createRenderPipeline({layout:renderer.pipelineLayout,vertex:{module:renderer.module,entryPoint:'vertexMain'},fragment:{module:renderer.module,entryPoint:'localAdjustmentFragmentMain',targets:[{format:'rgba32float'}]},primitive:{topology:'triangle-list'}});
  for(const fixture of cases){
   const local={id:'local-grade-probe',enabled:true,opacity:fixture.opacity,mask:{operator:'leaf',leaf:{type:'brush',mask_opacity:1}},[fixture.lane+'_grade']:fixture.grade};
   const decoy={...local,id:'other-curve-probe',[fixture.lane+'_grade']:{...fixture.grade,luma_curve:[[0,0],[.5,.2],[1,1]]}};
   renderer.uploadParamsAndCurves(fixture.lane,state.adjustments,sampleCurvePoints,new Float32Array(190),[decoy,local]);
   if(!renderer.supportsLocalAdjustments(fixture.lane,[local]))throw Error('Local colour wheels rejected');
   const params=renderer.localParamBuffer(local,fixture.lane,1,8,1,null);
   const source=d.createTexture({size:[8,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const mask=d.createTexture({size:[8,1],format:'r16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const target=d.createTexture({size:[8,1],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   const read=d.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{
    const rgba=new Float32Array(32);for(let i=0;i<8;i++){rgba.set(fixture.source.slice(i*3,i*3+3),i*4);rgba[i*4+3]=1;}
    d.queue.writeTexture({texture:source},rgba,{bytesPerRow:128},[8,1]);d.queue.writeTexture({texture:mask},new Uint16Array(8).fill(0x3c00),{bytesPerRow:16},[8,1]);
    const e=d.createCommandEncoder(),pass=e.beginRenderPass({colorAttachments:[{view:target.createView(),clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'}]});
    pass.setPipeline(pipeline);pass.setBindGroup(0,renderer.bindGraphResources(source.createView(),mask.createView(),{buffer:params}));pass.draw(3);pass.end();e.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:256},[8,1]);d.queue.submit([e.finish()]);
    await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange()),actual=[];for(let i=0;i<8;i++)actual.push(...values.slice(i*4,i*4+3));read.unmap();
    results.push({lane:fixture.lane,name:fixture.name,opacity:fixture.opacity,pixels:8,maxError:Math.max(...actual.map((v,i)=>Math.abs(v-fixture.expected[i]))),actual,expected:fixture.expected});
   }finally{[source,mask,target,read].forEach(v=>v.destroy());}
  }return results;
 },cases);
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
 for(const result of results)assert.ok(result.maxError<=.00002,JSON.stringify(result));
 console.log(`Local grade GPU/export: ${results.length} cases, ${results.length*8} pixels pass.`);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
