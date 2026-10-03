/** GPU leaf masks under straighten/perspective against exact CPU export masks. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const output=path.resolve(opt('--output','output/performance/review/phase3-continuation/mask-resample-reference.json'));
const cases=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import base64,json,numpy as np
from backend.hdr_finisher.models import MaskExpression,GeometryAdjustments
from backend.hdr_finisher.local_adjustments import compile_geometry_fixed_mask
cases=[]
def add(name,w,h,expression,geometry,rects):
 expected=compile_geometry_fixed_mask(np.zeros((h,w,3),np.float32),expression,geometry,spatial_only=True)
 height,width=expected.shape
 for x,y,rw,rh in rects(width,height):
  cases.append(dict(name=name,sourceWidth=w,sourceHeight=h,width=width,height=height,rect=dict(x=x,y=y,width=rw,height=rh),expression=expression.model_dump(),geometry=geometry.model_dump(),expected=base64.b64encode(expected[y:y+rh,x:x+rw].astype(np.uint8).tobytes()).decode()))
strokes=[dict(points=[dict(x=.1,y=.4,pressure=.4),dict(x=.65,y=.6,pressure=.9)],radius=.12,hardness=.6,flow=.8,opacity=1),dict(points=[dict(x=.8,y=.2)],radius=.06,hardness=1),dict(points=[dict(x=.5,y=.5)],radius=.08,erase=True)]
def leaves(i):
 return [
  ('hard brush',dict(type='brush',strokes=strokes)),
  ('dense hard brush',dict(type='brush',strokes=[dict(points=[dict(x=.3,y=.3),dict(x=.7,y=.7)],radius=.15,hardness=1,opacity=.35)])),
  ('feather brush',dict(type='brush',mask_feather=[.004,.03][i%2],strokes=strokes)),
  ('shift brush',dict(type='brush',mask_shift_edge=[.01,-.008][i%2],strokes=strokes)),
  ('shift feather brush',dict(type='brush',mask_shift_edge=[.01,-.008][i%2],mask_feather=.01,strokes=strokes)),
  ('path',dict(type='path',nodes=[dict(x=.2,y=.2),dict(x=.8,y=.25),dict(x=.7,y=.8),dict(x=.25,y=.7)],feather=[0,.03][i%2])),
  ('gradient',dict(type='linear_gradient',start=dict(x=.3,y=.2),end=dict(x=.6,y=.8))),
 ]
recipes=[dict(straighten_angle=1.3),dict(straighten_angle=-7.25),dict(straighten_angle=31),dict(perspective_horizontal=18),
 dict(perspective_vertical=-33,perspective_rotate=2),dict(straighten_angle=5,crop=dict(x=.11,y=.07,width=.63,height=.81)),
 dict(perspective_horizontal=-12,perspective_vertical=9,straighten_angle=3.5,crop=dict(x=.2,y=.15,width=.5,height=.7))]
whole=lambda width,height:[(0,0,width,height)]
i=0
for recipe in recipes:
 for name,leaf in leaves(i):
  w,h=[(384,256),(301,467),(1024,683)][i%3]
  geometry=GeometryAdjustments(rotation=[0,90,180,270][i%4],flip_horizontal=bool(i%3==0),flip_vertical=bool(i%5==0),**recipe)
  add(name,w,h,MaskExpression(leaf=leaf,inverted=bool(i%4==1)),geometry,whole)
  i+=1
# Native frames are sampled in viewport rectangles, as the tiled picture is.
for j,(name,leaf) in enumerate(leaves(0)[:5]+leaves(1)[5:]):
 geometry=GeometryAdjustments(**recipes[[1,3,5,4,0,6,2][j]])
 add(name,4000,2667,MaskExpression(leaf=leaf),geometry,lambda width,height:[(width//2-640,height//2-360,1280,720),(0,0,640,480),(width-640,height-480,640,480)])
print(json.dumps(cases))
`],{cwd:root,encoding:'utf8',maxBuffer:512*1024*1024}));
(async()=>{const browser=await chromium.launch();try{const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799');await page.waitForFunction(()=>state.gpuPreview?.available);
const results=[];
for(const fixture of cases)results.push(await page.evaluate(async fixture=>{
  const renderer=state.gpuPreview,signature=JSON.stringify(fixture.geometry),session='resample-reference';
  const size=renderer.maskSourceSize,create=renderer.createMaskTexture;
  renderer.ensureStorageBuffers(196*4,4);renderer.device.pushErrorScope('validation');
  renderer.maskSourceSize={sessionId:session,width:fixture.sourceWidth,height:fixture.sourceHeight};
  renderer.createMaskTexture=function(width,height){return this.device.createTexture({size:{width,height},format:'r16float',
    usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});};
  try{
    const longEdge=Math.max(fixture.sourceWidth,fixture.sourceHeight),started=performance.now();
    const recipe=renderer.resamplePlan(session,fixture.expression,longEdge,signature);
    if(!recipe)throw Error(`No plan for ${fixture.name}`);
    if(recipe.width!==fixture.width||recipe.height!==fixture.height)throw Error(`Frame ${recipe.width}x${recipe.height} is not ${fixture.width}x${fixture.height}`);
    const entry=await renderer.loadGpuResampledMask(session,fixture.expression,longEdge,signature,recipe,fixture.rect,()=>true);
    if(!entry)throw Error(`Unexpected fallback for ${fixture.name}`);
    const elapsed=performance.now()-started;
    const stride=Math.ceil(entry.width*2/256)*256,buffer=renderer.device.createBuffer({size:stride*entry.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
      const encoder=renderer.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:entry.texture},{buffer,bytesPerRow:stride},[entry.width,entry.height]);renderer.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
      const words=new Uint16Array(buffer.getMappedRange()),expected=Uint8Array.from(atob(fixture.expected),c=>c.charCodeAt(0));
      let maxLevels=0,maxByteLevels=0,over=0,overTwo=0,expectedPeak=0,expectedFloor=255;
      for(let y=0;y<entry.height;y++)for(let x=0;x<entry.width;x++){
        const word=words[y*stride/2+x],exponent=(word>>10)&31,mantissa=word&1023;
        const value=exponent?(1+mantissa/1024)*2**(exponent-15):mantissa*2**-24,reference=expected[y*entry.width+x];
        const error=Math.abs(value*255-reference);maxLevels=Math.max(maxLevels,error);
        maxByteLevels=Math.max(maxByteLevels,Math.abs(Math.round(value*255)-reference));
        expectedPeak=Math.max(expectedPeak,reference);expectedFloor=Math.min(expectedFloor,reference);
        if(error>1.13)over++;if(error>2)overTwo++;
      }
      const error=await renderer.device.popErrorScope();if(error)throw Error(error.message);
      const extent=[...renderer.maskExtents.values()].at(-1);
      return {name:fixture.name,sourceWidth:fixture.sourceWidth,sourceHeight:fixture.sourceHeight,rect:fixture.rect,geometry:fixture.geometry,
        kind:entry.kind,extent,elapsedMs:elapsed,expectedPeak,expectedFloor,pixels:entry.width*entry.height,maxLevels,maxByteLevels,over,overTwo};
    }finally{buffer.destroy();}
  }finally{
    for(const [key,entry] of [...renderer.localMasks])if(key.startsWith(session+':')){renderer.localMasks.delete(key);renderer.destroyLocalMaskEntry(entry);}
    renderer.maskExtents?.clear();renderer.maskSourceSize=size;renderer.createMaskTexture=create;
  }
},fixture));
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
// Export rounds the source mask to bytes before its bicubic warp, so a byte
// that rounds the other way on the GPU is amplified by the kernel. The general
// approval is two levels: no byte may differ by more. Regions above the
// tighter 1.13 guard of the unwarped references are listed, not hidden.
const failed=results.filter(r=>r.maxByteLevels>2);
const listed=results.filter(r=>r.maxLevels>1.13);
for(const r of listed)console.log(`Above 1.13: ${r.name} ${r.sourceWidth}x${r.sourceHeight} max ${r.maxLevels.toFixed(3)} (${r.maxByteLevels} byte levels), ${r.over} of ${r.pixels} px over 1.13, ${r.overTwo} over 2.0 as stored`);
for(const r of failed)console.error(JSON.stringify({...r,geometry:JSON.stringify(r.geometry)}));
const names=[...new Set(results.map(r=>r.name))];
console.log(`Resampled masks: ${results.length} regions; max ${Math.max(...results.map(r=>r.maxLevels))}; `
  +names.map(name=>`${name} ${Math.max(...results.filter(r=>r.name===name).map(r=>r.maxLevels)).toFixed(3)}`).join(', '));
console.log(`${results.length-listed.length} of ${results.length} regions within 1.13 levels`);
assert.equal(failed.length,0,`${failed.length} of ${results.length} resampled regions differ by more than two byte levels`);
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
