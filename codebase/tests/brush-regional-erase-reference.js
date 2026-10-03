/** Check actual R16 regional attenuation against export; admission is unchanged. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2),idx=args.indexOf('--output');
const output=path.resolve(idx<0?'output/performance/brush-regional-erase-reference.json':args[idx+1]);
const cases=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import base64,json,numpy as np
from backend.hdr_finisher.models import MaskExpression,GeometryAdjustments
from backend.hdr_finisher.local_adjustments import compile_geometry_fixed_mask
rng=np.random.default_rng(20261004);cases=[]
for i in range(96):
 w,h=768,512
 strokes=[dict(points=[dict(x=.2,y=.3,pressure=.5),dict(x=.7,y=.65,pressure=.9)],radius=.12,hardness=.7,flow=.9,opacity=.8)]
 for j in range(1+i%3):
  strokes.append(dict(points=[dict(x=float(rng.random()),y=float(rng.random()),pressure=float(rng.uniform(.3,1)))],radius=float(rng.uniform(.025,.13)),hardness=float(rng.choice([.5,.85,1])),flow=float(rng.uniform(.5,1)),opacity=float(rng.uniform(.4,1)),erase=True))
 if i%2:strokes.append(dict(points=[dict(x=.5,y=.5),dict(x=.65,y=.55)],radius=.09,hardness=.4,flow=.6,opacity=.75))
 expression=MaskExpression(leaf=dict(type='brush',strokes=strokes,mask_feather=[.005,.015,.03,.05][i%4]),inverted=bool(i%2))
 geometry=GeometryAdjustments(rotation=[0,90,180,270][i%4],flip_horizontal=bool(i%3),flip_vertical=bool(i%5),crop=dict(x=.1,y=.07,width=.81,height=.86) if i%3 else {})
 mask=compile_geometry_fixed_mask(np.zeros((h,w,3),np.float32),expression,geometry,spatial_only=True)
 height,width=mask.shape;rect=dict(x=width//5,y=height//6,width=width*3//5,height=height*2//3)
 expected=mask[rect['y']:rect['y']+rect['height'],rect['x']:rect['x']+rect['width']]
 cases.append(dict(expression=expression.model_dump(),geometry=geometry.model_dump(),rect=rect,width=width,height=height,expected=base64.b64encode(expected.tobytes()).decode()))
print(json.dumps(cases))
`],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024}));
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799');await page.waitForFunction(()=>state.gpuPreview?.available);
 const results=await page.evaluate(async cases=>{
  const renderer=state.gpuPreview,results=[];renderer.maskSourceSize={sessionId:'reference',width:768,height:512};
  renderer.ensureStorageBuffers(196*4,4);renderer.device.pushErrorScope('validation');
  const load=renderer.loadGpuBrushLeaf,create=renderer.createMaskTexture;
  renderer.createMaskTexture=(width,height)=>renderer.device.createTexture({size:[width,height],format:'r16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  const b64=bytes=>{let str='';for(let i=0;i<bytes.length;i+=16384)str+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(str);};
  try{for(const fixture of cases){
   const signature=JSON.stringify(fixture.geometry),quarter=fixture.geometry.rotation%180;
   const paint={...fixture.expression,leaf:{...fixture.expression.leaf,strokes:fixture.expression.leaf.strokes.filter(stroke=>!stroke.erase)}};
   const entry=await HDRGpuBrushMask.generate(renderer,paint,quarter?256:384,quarter?384:256,signature);
   const ox=fixture.geometry.crop.x,oy=fixture.geometry.crop.y,cw=fixture.geometry.crop.width,ch=fixture.geometry.crop.height;
   const smallWidth=quarter?256:384,smallHeight=quarter?384:256,nativeWidth=quarter?512:768,nativeHeight=quarter?768:512;
   const left=HDRGpuBrushMask.evenRound(ox*smallWidth),top=HDRGpuBrushMask.evenRound(oy*smallHeight);
   const right=HDRGpuBrushMask.evenRound((ox+cw)*smallWidth),bottom=HDRGpuBrushMask.evenRound((oy+ch)*smallHeight);
   const nativeLeft=HDRGpuBrushMask.evenRound(ox*nativeWidth),nativeTop=HDRGpuBrushMask.evenRound(oy*nativeHeight);
   entry.soft=true;entry.longEdge=384;entry.frameRect=[(left*2-nativeLeft)/fixture.width,(top*2-nativeTop)/fixture.height,(right-left)*2/fixture.width,(bottom-top)*2/fixture.height];
   renderer.loadGpuBrushLeaf=async()=>entry;
   const batch={localIndex:0,local:{id:String(results.length),mask:fixture.expression},tiles:[{key:'region'}]};
   const result=await renderer.loadGpuBrushEraseRegion('reference',batch,768,1,signature,()=>true,undefined,{width:fixture.width,height:fixture.height,region:fixture.rect});
   if(!result)throw Error('Unexpected regional fallback');
   const regional=result.entries.get('region'),w=regional.width,h=regional.height,stride=Math.ceil(w*2/256)*256;
   const buffer=renderer.device.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{
    const encoder=renderer.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:regional.texture},{buffer,bytesPerRow:stride},[w,h]);renderer.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
    const words=new Uint16Array(buffer.getMappedRange()),expected=Uint8Array.from(atob(fixture.expected),x=>x.charCodeAt(0));let maxLevels=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const word=words[y*stride/2+x],exponent=(word>>10)&31,mantissa=word&1023,value=exponent?(1+mantissa/1024)*2**(exponent-15):mantissa*2**-24;maxLevels=Math.max(maxLevels,Math.abs(value*255-expected[y*w+x]));}
    results.push({maxLevels,expression:paint,geometry:fixture.geometry,rect:entry.frameRect,bitmap:b64(entry.bitmap),width:entry.width,height:entry.height});
   }finally{buffer.destroy();entry.texture.destroy();}
  }}finally{renderer.loadGpuBrushLeaf=load;renderer.createMaskTexture=create;}
  const error=await renderer.device.popErrorScope();if(error)throw Error(error.message);return results;
 },cases);
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
 execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import base64,json,sys,numpy as np
from backend.hdr_finisher.models import MaskExpression
from backend.hdr_finisher.mask_softness import gpu_bitmap_soft_verdict
p=sys.argv[1];report=json.load(open(p));admitted=[]
for item in report['results']:
 bitmap=np.frombuffer(base64.b64decode(item['bitmap']),np.uint8).reshape(item['height'],item['width'])
 verdict=gpu_bitmap_soft_verdict(MaskExpression.model_validate(item['expression']),bitmap,384,256,rect=tuple(item['rect']))
 item['soft']=verdict.soft;item['terms']=verdict.terms;item['estimate']=verdict.estimate
 if verdict.soft:admitted.append(item)
report['admitted']=len(admitted);report['maximumAdmittedLevels']=max((x['maxLevels'] for x in admitted),default=0)
open(p,'w').write(json.dumps(report,indent=2)+'\\n')
print('Regional eraser:',len(admitted),'admitted of',len(report['results']),'maximum',report['maximumAdmittedLevels'])
assert admitted and report['maximumAdmittedLevels']<=2
`,output],{cwd:root,stdio:'inherit'});
 assert.equal(results.length,96);
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
