/** Native Feather (with and without Shift Edge) against exact CPU export masks. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const output=path.resolve(opt('--output','output/performance/review/phase3-continuation/native-feather-reference.json'));
const cases=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import base64,json,numpy as np
from backend.hdr_finisher.models import MaskExpression,GeometryAdjustments
from backend.hdr_finisher.local_adjustments import compile_geometry_fixed_mask
cases=[]
def add(w,h,expression,geometry,rects):
 expected=compile_geometry_fixed_mask(np.zeros((h,w,3),np.float32),expression,geometry,spatial_only=True)
 height,width=expected.shape
 for rect in rects(width,height):
  x,y,rw,rh=rect
  cases.append(dict(width=width,height=height,rect=dict(x=x,y=y,width=rw,height=rh),expression=expression.model_dump(),geometry=geometry.model_dump(),expected=base64.b64encode(expected[y:y+rh,x:x+rw].astype(np.uint8).tobytes()).decode()))
def strokes(i):
 return [dict(points=[dict(x=0,y=.4,pressure=.4),dict(x=.65,y=.6,pressure=.9)],radius=.12,hardness=[0,.6,1][i%3],flow=.8,opacity=[.35,1][i%2]),dict(points=[dict(x=.91,y=.13)],radius=.065,hardness=1,flow=1,opacity=1),dict(points=[dict(x=.5,y=.5)],radius=.08,erase=True),dict(points=[dict(x=.48,y=.5)],radius=.05,flow=.5)]
# Compact frames: narrow full-resolution feathers and small reduced grids,
# every quarter turn and flip, inversion, disabled masks and ordered erase.
for i in range(60):
 w,h=[(96,64),(101,67),(384,256),(1024,683)][i%4]
 shift=[-.03,-.005,0,.005,.03][(i//4)%5]
 feather=[.0004,.004,.05][(i//20)%3]
 expression=MaskExpression(leaf=dict(type='brush',mask_shift_edge=shift,mask_feather=feather,strokes=strokes(i)),inverted=bool(i%2),enabled=bool(i%11))
 geometry=GeometryAdjustments(rotation=[0,90,180,270][i%4],flip_horizontal=bool(i%3),flip_vertical=bool(i%5))
 add(w,h,expression,geometry,lambda width,height:[(width//4,height//4,width//2,height//2)])
# Native frames: every reduction factor range, a small strong mark far from
# the viewport, frame-edge paint and viewports on the physical borders.
for shift,feather in [(-.005,.0002),(.005,.001),(-.005,.005),(.005,.02),(-.05,.05),(.05,.05),(0,.0006),(0,.02),(.0000001,.01),(.005,.0000001)]:
 w,h=4000,2667
 expression=MaskExpression(leaf=dict(type='brush',mask_shift_edge=shift,mask_feather=feather,strokes=[dict(points=[dict(x=.35,y=.4),dict(x=.55,y=.5)],radius=.08,hardness=1,opacity=.35),dict(points=[dict(x=.9,y=.1)],radius=.01,hardness=1),dict(points=[dict(x=0,y=.02),dict(x=.03,y=0)],radius=.02,hardness=.5,opacity=.3),dict(points=[dict(x=.45,y=.45)],radius=.03,erase=True)]))
 add(w,h,expression,GeometryAdjustments(),lambda width,height:[(1300,900,1000,800),(0,0,640,480),(width-640,height-480,640,480),(3300,0,640,480)])
# A 24-megapixel frame exceeds one scratch band: Shift halos repeat per band
# and the coarse rows of adjacent bands must join without a seam.
for shift,feather,turn in [(.05,.05,0),(-.02,.004,90),(0,.0006,0),(.01,.0005,270)]:
 w,h=6000,4000
 expression=MaskExpression(leaf=dict(type='brush',mask_shift_edge=shift,mask_feather=feather,strokes=[dict(points=[dict(x=.1,y=.08),dict(x=.85,y=.95)],radius=.09,hardness=.8,opacity=.6),dict(points=[dict(x=.9,y=.1)],radius=.004,hardness=1),dict(points=[dict(x=.5,y=.52)],radius=.05,erase=True)]),inverted=turn==90)
 add(w,h,expression,GeometryAdjustments(rotation=turn),lambda width,height:[(width//2-1280,height//2-720,2560,1440),(0,height-1440,2560,1440)])
print(json.dumps(cases))
`],{cwd:root,encoding:'utf8',maxBuffer:512*1024*1024}));
(async()=>{const browser=await chromium.launch();try{const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799');await page.waitForFunction(()=>state.gpuPreview?.available);
const results=[];
// One case per round trip keeps each transferred reference small.
for(const fixture of cases)results.push(await page.evaluate(async fixture=>{
  const renderer=state.gpuPreview,helper=HDRGpuBrushMask,signature=JSON.stringify(fixture.geometry);
  renderer.ensureStorageBuffers(196*4,4);renderer.device.pushErrorScope('validation');
  const {expression,width,height,rect}=fixture,started=performance.now();
  const recipe=helper.featherFieldPlan(expression,width,height,signature,renderer.device.limits.maxTextureDimension2D);
  let field=null,entry;
  if(recipe){
    field=await helper.generateFeatherField(renderer,expression,width,height,signature);
    if(!field)throw Error('Unexpected field fallback');
    entry=await helper.generateFeatherRegion(renderer,expression,width,height,signature,rect,field);
  // Below a quarter pixel export skips the feather entirely.
  }else entry=await helper.generateShiftRegion(renderer,expression,width,height,signature,rect);
  if(!entry)throw Error('Unexpected fallback');
  const stride=Math.ceil(entry.width*2/256)*256,buffer=renderer.device.createBuffer({size:stride*entry.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
    const encoder=renderer.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:entry.texture},{buffer,bytesPerRow:stride},[entry.width,entry.height]);renderer.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
    const words=new Uint16Array(buffer.getMappedRange()),expected=Uint8Array.from(atob(fixture.expected),c=>c.charCodeAt(0));let maxLevels=0,over=0,expectedPeak=0,worst=[];
    for(let y=0;y<entry.height;y++)for(let x=0;x<entry.width;x++){
      const word=words[y*stride/2+x],exponent=(word>>10)&31,mantissa=word&1023;
      const value=exponent?(1+mantissa/1024)*2**(exponent-15):mantissa*2**-24,reference=expected[y*entry.width+x];
      const error=Math.abs(value*255-reference);maxLevels=Math.max(maxLevels,error);expectedPeak=Math.max(expectedPeak,reference);
      if(error>1.13){over++;if(worst.length<8)worst.push({x:x+rect.x,y:y+rect.y,actual:value*255,expected:reference});}
    }
    const error=await renderer.device.popErrorScope();if(error)throw Error(error.message);
    return {width,height,rect,rotation:fixture.geometry.rotation||0,shift:expression.leaf.mask_shift_edge,feather:expression.leaf.mask_feather,
      kind:entry.kind,factor:recipe?.factor??null,bands:field?.bands??null,fieldMs:field?.timings.gpuPrepareMs??null,
      regionMs:entry.timings.gpuPrepareMs,totalMs:performance.now()-started,expectedPeak,maxLevels,over,worst};
  }finally{buffer.destroy();entry.texture.destroy();field?.texture.destroy();}
},fixture));
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
const failed=results.filter(r=>r.maxLevels>1.13);
for(const r of failed)console.error(JSON.stringify(r));
assert.equal(failed.length,0,`${failed.length} of ${results.length} native Feather regions exceed 1.13 levels`);
const count=key=>results.filter(key).length;
console.log(`Native Feather: ${results.length} CPU-reference regions pass; max ${Math.max(...results.map(r=>r.maxLevels))}; `
  +`reduced ${count(r=>r.factor>1)}, full ${count(r=>r.factor===1)}, unfeathered ${count(r=>r.factor===null)}, multi-band ${count(r=>r.bands>1)}`);
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
