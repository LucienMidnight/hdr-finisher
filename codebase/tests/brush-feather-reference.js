const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),index=process.argv.indexOf('--output');
const output=path.resolve(index<0?'output/performance/brush-feather-reference.json':process.argv[index+1]);
const cases=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import base64,json,numpy as np
from backend.hdr_finisher.models import MaskExpression,GeometryAdjustments
from backend.hdr_finisher.local_adjustments import compile_geometry_fixed_mask
cases=[]
for w,h in [(96,64),(64,96),(384,256)]:
 for feather in [.001,.005,.015,.03,.05]:
  for inverted in [False,True]:
   for hardness in [0,.65,1]:
    strokes=[dict(points=[dict(x=.01,y=.4,pressure=.3),dict(x=.7,y=.6,pressure=.8)],radius=.14,hardness=hardness,flow=.3,opacity=.75),dict(points=[dict(x=.4,y=.52),dict(x=.6,y=.6)],radius=.1,hardness=.5,flow=.8,opacity=.9,erase=True),dict(points=[dict(x=.48,y=.52)],radius=.16,hardness=.7,flow=.6,opacity=.8)]
    expression=MaskExpression(leaf=dict(type='brush',strokes=strokes,mask_feather=feather),inverted=inverted)
    geometry=GeometryAdjustments()
    expected=compile_geometry_fixed_mask(np.zeros((h,w,3),np.float32),expression,geometry,spatial_only=True)
    cases.append(dict(width=w,height=h,expression=expression.model_dump(),geometry=geometry.model_dump(),expected=base64.b64encode(expected.astype(np.uint8).tobytes()).decode()))
rng=np.random.default_rng(20261003)
for i in range(500):
 w,h=[(96,64),(64,96),(101,67),(67,101)][i%4]
 strokes=[]
 for j in range(int(rng.integers(0,5))):
  points=[dict(x=float(rng.choice([0,1,rng.random()])),y=float(rng.choice([0,1,rng.random()])),pressure=float(rng.uniform(.05,1))) for _ in range(int(rng.integers(1,5)))]
  strokes.append(dict(points=points,radius=float(rng.uniform(.003,.3)),hardness=float(rng.choice([0,.5,1,rng.random()])),flow=float(rng.uniform(.1,1)),opacity=float(rng.uniform(.1,1)),erase=bool(j and rng.random()<.4)))
 expression=MaskExpression(leaf=dict(type='brush',strokes=strokes,mask_feather=float(rng.choice([.001,.005,.015,.03,.05]))),inverted=bool(i%2),enabled=bool(i%19))
 geometry=GeometryAdjustments(rotation=[0,90,180,270][i%4],flip_horizontal=bool(i%3),flip_vertical=bool(i%5))
 expected=compile_geometry_fixed_mask(np.zeros((h,w,3),np.float32),expression,geometry,spatial_only=True)
 height,width=expected.shape
 cases.append(dict(width=width,height=height,expression=expression.model_dump(),geometry=geometry.model_dump(),expected=base64.b64encode(expected.astype(np.uint8).tobytes()).decode()))
for i in range(160):
 w,h=[(96,64),(64,96),(384,256),(256,384)][i%4]
 expression=MaskExpression(leaf=dict(type='brush',mask_feather=[.001,.005,.015,.05][i%4],strokes=[dict(points=[dict(x=.01,y=.4,pressure=.3),dict(x=.7,y=.6,pressure=.8)],radius=.14,hardness=.65,flow=.3,opacity=.75)]),inverted=bool(i%2))
 geometry=GeometryAdjustments(rotation=[0,90,180,270][i%4],flip_horizontal=bool(i%3),flip_vertical=bool(i%5),crop=dict(x=.17,y=.08,width=.63,height=.81))
 expected=compile_geometry_fixed_mask(np.zeros((h,w,3),np.float32),expression,geometry,spatial_only=True)
 height,width=expected.shape
 frame_width,frame_height=(h,w) if geometry.rotation%180 else (w,h)
 cases.append(dict(width=width,height=height,frameWidth=frame_width,frameHeight=frame_height,expression=expression.model_dump(),geometry=geometry.model_dump(),expected=base64.b64encode(expected.astype(np.uint8).tobytes()).decode()))
for edge in [1024,1600,3200]:
 for inverted in [False,True]:
  w,h=edge,round(edge*2/3)
  expression=MaskExpression(leaf=dict(type='brush',mask_feather=.05,strokes=[dict(points=[dict(x=0,y=.4,pressure=.3),dict(x=.7,y=.6,pressure=.8)],radius=.14,hardness=.65,flow=.3,opacity=.75)]),inverted=inverted)
  geometry=GeometryAdjustments(crop=dict(x=.17,y=.08,width=.63,height=.81))
  expected=compile_geometry_fixed_mask(np.zeros((h,w,3),np.float32),expression,geometry,spatial_only=True)
  height,width=expected.shape
  cases.append(dict(width=width,height=height,frameWidth=w,frameHeight=h,expression=expression.model_dump(),geometry=geometry.model_dump(),expected=base64.b64encode(expected.astype(np.uint8).tobytes()).decode()))
for shift in [-.03,-.005,.005,.03]:
 for feather in [0,.005,.03]:
  for inverted in [False,True]:
   for density in [.35,1]:
    w,h=96,64
    expression=MaskExpression(leaf=dict(type='brush',mask_shift_edge=shift,mask_feather=feather,strokes=[dict(points=[dict(x=.1,y=.3,pressure=.4),dict(x=.65,y=.6,pressure=.9)],radius=.12,hardness=.6,flow=.8,opacity=density),dict(points=[dict(x=.5,y=.5)],radius=.08,erase=True)]),inverted=inverted)
    geometry=GeometryAdjustments(rotation=90,flip_horizontal=True,crop=dict(x=.1,y=.1,width=.8,height=.8))
    expected=compile_geometry_fixed_mask(np.zeros((h,w,3),np.float32),expression,geometry,spatial_only=True)
    height,width=expected.shape
    cases.append(dict(width=width,height=height,frameWidth=h,frameHeight=w,expression=expression.model_dump(),geometry=geometry.model_dump(),expected=base64.b64encode(expected.astype(np.uint8).tobytes()).decode()))
print(json.dumps(cases))
`],{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024}));
(async()=>{const browser=await chromium.launch();try{const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799');await page.waitForFunction(()=>state.gpuPreview?.available);
const results=await page.evaluate(async cases=>{const renderer=state.gpuPreview,results=[];renderer.ensureStorageBuffers(196*4,4);renderer.device.pushErrorScope('validation');
const readHalf=async entry=>{
 const stride=Math.ceil(entry.width*2/256)*256,buffer=renderer.device.createBuffer({size:stride*entry.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 try{const encoder=renderer.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:entry.texture},{buffer,bytesPerRow:stride},{width:entry.width,height:entry.height});renderer.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const source=new Uint8Array(buffer.getMappedRange()),packed=new Uint8Array(entry.width*entry.height*2);for(let y=0;y<entry.height;y++)packed.set(source.subarray(y*stride,y*stride+entry.width*2),y*entry.width*2);let binary='';for(let i=0;i<packed.length;i+=16384)binary+=String.fromCharCode(...packed.subarray(i,i+16384));return btoa(binary);}finally{buffer.destroy();}
};
for(const fixture of cases){const entry=await HDRGpuBrushMask.generate(renderer,fixture.expression,fixture.frameWidth||fixture.width,fixture.frameHeight||fixture.height,JSON.stringify(fixture.geometry));if(!entry)throw Error('Unexpected fallback');const expected=Uint8Array.from(atob(fixture.expected),c=>c.charCodeAt(0));let maxLevels=0;for(let i=0;i<entry.bitmap.length;i++)maxLevels=Math.max(maxLevels,Math.abs(entry.bitmap[i]-expected[i]));let binary='';for(let i=0;i<entry.bitmap.length;i+=16384)binary+=String.fromCharCode(...entry.bitmap.subarray(i,i+16384));results.push({width:fixture.width,height:fixture.height,feather:fixture.expression.leaf.mask_feather,hardness:fixture.expression.leaf.strokes[0]?.hardness,inverted:fixture.expression.inverted,maxLevels,paintedPeak:entry.paintedPeak,qualification: {expression:fixture.expression,geometry:fixture.geometry,frameWidth:fixture.frameWidth,frameHeight:fixture.frameHeight,bitmap:btoa(binary),textureHalf:await readHalf(entry)}});entry.texture.destroy();}
const error=await renderer.device.popErrorScope();if(error)throw Error(error.message);return results;},cases);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');for(const result of results)assert.ok(result.maxLevels<=1,JSON.stringify(result));console.log(`GPU brush feather: ${results.length} CPU-reference cases pass.`);if(process.argv.includes('--qualification'))execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'tests/performance/brush_feather_qualification.py'),output],{cwd:root,stdio:'inherit'});
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
