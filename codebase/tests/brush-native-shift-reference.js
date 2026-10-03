const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const output=path.resolve(opt('--output','output/performance/review/phase3-continuation/native-shift-reference.json'));
const cases=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import base64,json,numpy as np
from backend.hdr_finisher.models import MaskExpression,GeometryAdjustments
from backend.hdr_finisher.local_adjustments import compile_geometry_fixed_mask
cases=[]
for i in range(48):
 w,h=[(96,64),(101,67),(384,256),(1024,683)][i%4]
 shift=[-.03,-.005,.005,.03][(i//4)%4]
 expression=MaskExpression(leaf=dict(type='brush',mask_shift_edge=shift,strokes=[dict(points=[dict(x=0,y=.4,pressure=.4),dict(x=.65,y=.6,pressure=.9)],radius=.12,hardness=[0,.6,1][i%3],flow=.8,opacity=[.35,1][i%2]),dict(points=[dict(x=.91,y=.13)],radius=.065,hardness=1,flow=1,opacity=1),dict(points=[dict(x=.5,y=.5)],radius=.08,erase=True),dict(points=[dict(x=.48,y=.5)],radius=.05,flow=.5)]),inverted=bool(i%2),enabled=bool(i%11))
 geometry=GeometryAdjustments(rotation=[0,90,180,270][i%4],flip_horizontal=bool(i%3),flip_vertical=bool(i%5))
 expected=compile_geometry_fixed_mask(np.zeros((h,w,3),np.float32),expression,geometry,spatial_only=True)
 height,width=expected.shape
 x,y=width//4,height//4;rw,rh=width//2,height//2
 cases.append(dict(width=width,height=height,rect=dict(x=x,y=y,width=rw,height=rh),expression=expression.model_dump(),geometry=geometry.model_dump(),expected=base64.b64encode(expected[y:y+rh,x:x+rw].astype(np.uint8).tobytes()).decode()))
for shift in [-.05,-.005,.005,.05]:
 w,h=4000,2667
 expression=MaskExpression(leaf=dict(type='brush',mask_shift_edge=shift,strokes=[dict(points=[dict(x=.35,y=.4),dict(x=.55,y=.5)],radius=.08,hardness=1,opacity=.35),dict(points=[dict(x=.9,y=.1)],radius=.01,hardness=1)]))
 expected=compile_geometry_fixed_mask(np.zeros((h,w,3),np.float32),expression,GeometryAdjustments(),spatial_only=True)
 x,y,rw,rh=1300,900,1000,800
 cases.append(dict(width=w,height=h,rect=dict(x=x,y=y,width=rw,height=rh),expression=expression.model_dump(),geometry={},expected=base64.b64encode(expected[y:y+rh,x:x+rw].astype(np.uint8).tobytes()).decode()))
print(json.dumps(cases))
`],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024}));
(async()=>{const browser=await chromium.launch();try{const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799');await page.waitForFunction(()=>state.gpuPreview?.available);
const results=await page.evaluate(async cases=>{const renderer=state.gpuPreview,results=[];renderer.ensureStorageBuffers(196*4,4);renderer.device.pushErrorScope('validation');
for(const fixture of cases){const entry=await HDRGpuBrushMask.generateShiftRegion(renderer,fixture.expression,fixture.width,fixture.height,JSON.stringify(fixture.geometry),fixture.rect);if(!entry)throw Error('Unexpected fallback');
const stride=Math.ceil(entry.width*2/256)*256,buffer=renderer.device.createBuffer({size:stride*entry.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
try{const encoder=renderer.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:entry.texture},{buffer,bytesPerRow:stride},[entry.width,entry.height]);renderer.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const words=new Uint16Array(buffer.getMappedRange()),expected=Uint8Array.from(atob(fixture.expected),c=>c.charCodeAt(0));let maxLevels=0,overOne=0,worst=[];
for(let y=0;y<entry.height;y++)for(let x=0;x<entry.width;x++){const word=words[y*stride/2+x],exponent=(word>>10)&31,mantissa=word&1023;const value=exponent?(1+mantissa/1024)*2**(exponent-15):mantissa*2**-24;const error=Math.abs(value*255-expected[y*entry.width+x]);maxLevels=Math.max(maxLevels,error);if(error>1.13){overOne++;if(worst.length<8)worst.push({x:x+fixture.rect.x,y:y+fixture.rect.y,actual:value*255,expected:expected[y*entry.width+x]});}}
results.push({width:fixture.width,height:fixture.height,shift:fixture.expression.leaf.mask_shift_edge,maxLevels,overOne,worst,...entry.timings,scratchRegion:entry.scratchRegion});
}finally{buffer.destroy();entry.texture.destroy();}}
const error=await renderer.device.popErrorScope();if(error)throw Error(error.message);return results;},cases);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');for(const r of results)assert.ok(r.maxLevels<=1.13,JSON.stringify(r));console.log(`Native Shift: ${results.length} CPU-reference regions pass; max ${Math.max(...results.map(r=>r.maxLevels))}`);
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
