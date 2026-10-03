/** GPU masks under straighten/perspective against exact CPU export masks:
 * leaves, luminance leaves made from un-resampled scene luminance, and
 * combinations composed in source space before the warp.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const output=path.resolve(opt('--output','output/performance/review/phase3-continuation/mask-resample-reference.json'));
const {cases,planes}=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import base64,json,numpy as np
from backend.hdr_finisher.models import MaskExpression,GeometryAdjustments
from backend.hdr_finisher.local_adjustments import compile_geometry_fixed_mask,ACESCG_LUMA
from backend.hdr_finisher.finishing import _oriented_view
cases=[];planes={}
def scene(w,h):
 # Smooth structure across twelve stops with pixel noise on top, so a mask
 # qualified after the warp differs visibly from one qualified before it.
 x,y=np.meshgrid(np.arange(w,dtype=np.float64),np.arange(h,dtype=np.float64))
 noise=np.random.default_rng(w*7+h).standard_normal((h,w)).clip(-2,2)
 v=.18*2**(5*np.sin(x*27.3/w)+2*np.cos(y*33.3/h))*(1+.25*noise)
 return np.stack((v,v*.7,v*.4),axis=-1).astype(np.float32)
def add(name,w,h,expression,geometry,rects,luminance=False):
 source=scene(w,h) if luminance else np.zeros((h,w,3),np.float32)
 expected=compile_geometry_fixed_mask(source,expression,geometry,spatial_only=True)
 height,width=expected.shape
 plane=None
 if luminance:
  oriented=_oriented_view(source,geometry)
  plane=f'{w}x{h}:{geometry.rotation}:{geometry.flip_horizontal}:{geometry.flip_vertical}'
  if plane not in planes:
   luma=np.einsum('...c,c->...',oriented[...,:3],ACESCG_LUMA,optimize=True)
   planes[plane]=dict(width=oriented.shape[1],height=oriented.shape[0],data=base64.b64encode(luma.astype('<f2').tobytes()).decode())
 for x,y,rw,rh in rects(width,height):
  cases.append(dict(name=name,plane=plane,sourceWidth=w,sourceHeight=h,width=width,height=height,rect=dict(x=x,y=y,width=rw,height=rh),expression=expression.model_dump(),geometry=geometry.model_dump(),expected=base64.b64encode(expected[y:y+rh,x:x+rw].astype(np.uint8).tobytes()).decode()))
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
# Luminance leaves and combinations. The source-space mask is finished first.
def luma(feather=0,opacity=1,narrow=False):
 stops=dict(fade_in_start_ev=5.5,full_start_ev=9,full_end_ev=12,fade_out_end_ev=14) if narrow else dict(fade_in_start_ev=-6,full_start_ev=-3,full_end_ev=2,fade_out_end_ev=5)
 return dict(type='luminance_range',mask_feather=feather,mask_opacity=opacity,**stops)
node=lambda leaf,**more:dict(operator='leaf',leaf=leaf,**more)
shape=node(dict(type='path',mask_opacity=.55,nodes=[dict(x=.48,y=.2),dict(x=.9,y=.2),dict(x=.9,y=.9),dict(x=.48,y=.9)]))
fan=node(dict(type='linear_gradient',start=dict(x=.1,y=.2),end=dict(x=.8,y=.9),gradient_midpoint_1=.3,gradient_midpoint_2=.7,gradient_fan=-1))
paint=node(dict(type='brush',mask_feather=.01,strokes=strokes))
def graphs(i):
 leaf=node(luma([0,.004,.03][i%3],.7))
 return [
  ('union graph',dict(operator='union',inverted=True,children=[leaf,shape])),
  ('intersect graph',dict(operator='intersect',children=[leaf,paint])),
  ('subtract graph',dict(operator='subtract',children=[paint,leaf,fan])),
  ('nested graph',dict(operator='subtract',children=[dict(operator='union',children=[leaf,shape]),fan,node(luma(),enabled=False)])),
  ('spatial graph',dict(operator='subtract',inverted=bool(i%2),children=[paint,shape])),
 ]
selected=[recipes[0],recipes[3],recipes[5],recipes[6]]
i=0
for recipe in selected:
 geometry=lambda i:GeometryAdjustments(rotation=[0,90,180,270][i%4],flip_horizontal=bool(i%3==0),flip_vertical=bool(i%5==0),**recipe)
 for name,leaf,inverted in [('luma',luma(),False),('luma feather',luma(.004),True),('luma wide feather',luma(.03),False),('luma partial range',luma(narrow=True),False)]:
  w,h=[(384,256),(301,467),(1024,683)][i%3]
  add(name,w,h,MaskExpression(leaf=leaf,inverted=inverted),geometry(i),whole,True)
  i+=1
 for name,graph in graphs(i):
  w,h=[(384,256),(301,467),(1024,683)][i%3]
  add(name,w,h,MaskExpression.model_validate(graph),geometry(i),whole,name!='spatial graph')
  i+=1
views=lambda width,height:[(width//2-640,height//2-360,1280,720),(0,0,640,480),(width-640,height-480,640,480)]
add('luma feather',4000,2667,MaskExpression(leaf=luma(.01)),GeometryAdjustments(**recipes[1]),views,True)
add('nested graph',4000,2667,MaskExpression.model_validate(graphs(1)[3][1]),GeometryAdjustments(**recipes[4]),views,True)
print(json.dumps(dict(cases=cases,planes=planes)))
`],{cwd:root,encoding:'utf8',maxBuffer:1024*1024*1024}));
(async()=>{const browser=await chromium.launch();try{const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799');await page.waitForFunction(()=>state.gpuPreview?.available);
const results=[];
for(const [name,plane] of Object.entries(planes))await page.evaluate(({name,plane})=>{
  const bytes=Uint8Array.from(atob(plane.data),c=>c.charCodeAt(0));
  (window.__luminancePlanes||={})[name]={width:plane.width,height:plane.height,words:new Uint16Array(bytes.buffer)};
},{name,plane});
for(const fixture of cases)results.push(await page.evaluate(async fixture=>{
  const renderer=state.gpuPreview,signature=JSON.stringify(fixture.geometry),session='resample-reference';
  const size=renderer.maskSourceSize,create=renderer.createMaskTexture,plane=window.__luminancePlanes?.[fixture.plane];
  // The backend's un-resampled luminance for this synthetic source.
  if(plane)renderer.fetchOrientedLuminance=async(_session,_edge,_frame,rect)=>{
    const data=new Uint16Array(rect.width*rect.height);
    for(let row=0;row<rect.height;row++)data.set(plane.words.subarray((rect.y+row)*plane.width+rect.x,(rect.y+row)*plane.width+rect.x+rect.width),row*rect.width);
    return {data:data.buffer,width:rect.width,height:rect.height,frameWidth:plane.width,frameHeight:plane.height};
  };
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
    for(const key of [...renderer.orientedLuminance.keys()])if(key.startsWith(session+':'))renderer.evictGpuCacheEntry('oriented-luminance',key);
    delete renderer.fetchOrientedLuminance;
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
