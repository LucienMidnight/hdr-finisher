/** Shared GPU gradients versus export's source-rasterized geometry masks. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),args=process.argv.slice(2);
const output=path.resolve(args.includes('--output')?args[args.indexOf('--output')+1]:'output/performance/gradient-transform-reference.json');
const cases=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import json,numpy as np
from backend.hdr_finisher.models import MaskExpression,GeometryAdjustments
from backend.hdr_finisher.local_adjustments import compile_geometry_fixed_mask
cases=[]
for w,h in [(96,64),(64,96)]:
 for rotation in [0,90,180,270]:
  for horizontal,vertical in [(False,False),(True,False),(False,True),(True,True)]:
   for inverted in [False,True]:
    for first,last in [(.3,.7),(.1,.9)]:
     for fan in [-1,-.4,0,.4,1]:
      geometry=GeometryAdjustments(rotation=rotation,flip_horizontal=horizontal,flip_vertical=vertical)
      expression=MaskExpression(inverted=inverted,leaf=dict(type='linear_gradient',start=dict(x=.08,y=.27),end=dict(x=.81,y=.94),gradient_midpoint_1=first,gradient_midpoint_2=last,gradient_fan=fan))
      expected=compile_geometry_fixed_mask(np.zeros((h,w,3),np.float32),expression,geometry,spatial_only=True)
      height,width=expected.shape
      cases.append(dict(width=width,height=height,geometry=geometry.model_dump(),expression=expression.model_dump(),expected=expected.reshape(-1).tolist()))
recipes=[dict(type='linear_gradient',start=dict(x=.08,y=.27),end=dict(x=.81,y=.94),gradient_midpoint_1=.3,gradient_midpoint_2=.7,gradient_fan=fan) for fan in [-1,0,1]]
recipes += [dict(type='brush',strokes=[dict(points=[dict(x=.13,y=.25,pressure=.2),dict(x=.8,y=.7,pressure=.9)],radius=.14,hardness=1,flow=.75,opacity=.8)]),dict(type='path',nodes=[dict(x=.15,y=.2),dict(x=.85,y=.2),dict(x=.8,y=.8),dict(x=.2,y=.85)],feather=0)]
for source_width,source_height in [(96,64),(64,96)]:
 for rotation in [0,90,180,270]:
  for horizontal,vertical in [(False,False),(True,False),(False,True),(True,True)]:
   for inverted in [False,True]:
    for leaf in recipes:
     geometry=GeometryAdjustments(rotation=rotation,flip_horizontal=horizontal,flip_vertical=vertical,crop=dict(x=.17,y=.08,width=.63,height=.81))
     expression=MaskExpression(inverted=inverted,leaf=leaf)
     expected=compile_geometry_fixed_mask(np.zeros((source_height,source_width,3),np.float32),expression,geometry,spatial_only=True)
     height,width=expected.shape
     cases.append(dict(width=width,height=height,sourceWidth=source_width,sourceHeight=source_height,geometry=geometry.model_dump(),expression=expression.model_dump(),expected=expected.reshape(-1).tolist()))
print(json.dumps(cases))
`],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024}));
(async()=>{
 const browser=await chromium.launch();try{
  const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799');
  await page.waitForFunction(()=>state.gpuPreview?.available);
  const results=await page.evaluate(async cases=>{
   const renderer=state.gpuPreview,d=renderer.device,results=[];renderer.ensureStorageBuffers(196*4,4);
   d.pushErrorScope('validation');
   const source=d.createTexture({size:[1,1],format:'r16float',usage:GPUTextureUsage.TEXTURE_BINDING});
   try{for(const fixture of cases){
    const {width,height}=fixture,region={x:0,y:0,width,height},tiles=[];
    for(let y=0;y<height;y+=23)for(let x=0;x<width;x+=31){
     const rect={x,y,width:Math.min(31,width-x),height:Math.min(23,height-y)};
     tiles.push({key:`${x}:${y}`,rect,haloRect:rect,halo:0});
    }
    const id=`gradient-${results.length}`,local={id,mask:fixture.expression};
    const edge=Math.max(fixture.sourceWidth||width,fixture.sourceHeight||height);
    if(fixture.sourceWidth)renderer.maskSourceSize={sessionId:id,width:fixture.sourceWidth,height:fixture.sourceHeight};
    const expectedKind=fixture.expression.leaf.type==='linear_gradient'?'gpu-linear-gradient':`gpu-${fixture.expression.leaf.type}-raster`;
    const loaded=await renderer.loadLocalMaskTiles(id,{localIndex:0,local,tiles},edge,0,
     JSON.stringify(fixture.geometry),()=>true,undefined,{region,width,height,texture:source});
    const entries=[...loaded.entries.values()];
    if(new Set(entries).size!==1||entries[0].kind!==expectedKind)throw Error('Gradient left shared GPU route');
    renderer.recordFrameMasks({execution:'tiled',sessionId:id,lane:'hdr',width,height,locals:[local],
     pieces:tiles.map(tile=>({rect:tile.rect,origin:tile.rect,entries:[loaded.entries.get(tile.key)]}))});
    const read=await renderer.readLocalMaskRegion(id,0,0,width,height);
    if(read.error||read.coveredPixels!==width*height)throw Error(read.error||'Incomplete capture');
    const geometrySignature=JSON.stringify(fixture.geometry);
    renderer.proxies.set(id,{sessionId:id,longEdge:edge,geometrySignature,width,height,texture:source});
    const fit=await renderer.loadMaskLeaf(id,local,fixture.expression,'',edge,0,geometrySignature,()=>true);
    if(fit?.kind!==expectedKind)throw Error('Fit gradient left the GPU route');
    renderer.recordFrameMasks({execution:'direct',sessionId:id,lane:'hdr',width,height,locals:[local],
      pieces:[{rect:region,origin:region,entries:[fit]}]});
    const fitRead=await renderer.readLocalMaskRegion(id,0,0,width,height);
    if(fitRead.error||fitRead.coveredPixels!==width*height)throw Error(fitRead.error||'Incomplete Fit capture');
    const fitRegionMaxLevels=Math.max(...fitRead.values.map((value,i)=>Math.abs(value-read.values[i])*255));
    let maxLevels=0,worst=null;for(let i=0;i<read.values.length;i++){
     const error=Math.abs(read.values[i]*255-fixture.expected[i]);
     if(error>maxLevels){maxLevels=error;worst={x:i%width,y:Math.floor(i/width),actual:read.values[i]*255,expected:fixture.expected[i]};}
    }
    results.push({width,height,geometry:fixture.geometry,inverted:fixture.expression.inverted,
     leafType:fixture.expression.leaf.type,fan:fixture.expression.leaf.gradient_fan,worst,fitRegionMaxLevels,
     midpoints:[fixture.expression.leaf.gradient_midpoint_1,fixture.expression.leaf.gradient_midpoint_2],pixels:read.coveredPixels,maxLevels});
   }}finally{source.destroy();}
   const error=await d.popErrorScope();if(error)throw Error(error.message);return results;
  },cases);
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
  for(const result of results){assert.ok(result.maxLevels<=1.1,JSON.stringify(result));assert.ok(result.fitRegionMaxLevels<=.25,JSON.stringify(result));}
  console.log(`Shared transformed gradients: ${results.length} CPU-reference cases pass.`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
