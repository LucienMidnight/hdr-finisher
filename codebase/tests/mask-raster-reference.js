/** Native GPU shape tiles versus CPU export masks. No project is opened.
 * Run with tests/run-in-electron.js; output lists every case and pixel count.
 */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const root=path.join(__dirname,'..'), index=process.argv.indexOf('--output');
const output=path.resolve(index<0?'output/performance/mask-raster-reference.json':process.argv[index+1]);
const shared=process.argv.includes('--shared');
const orthogonal=process.argv.includes('--orthogonal');
const cases=JSON.parse(execFileSync(process.env.HDR_FINISHER_PYTHON || path.join(root,'.venv/Scripts/python.exe'),['-c',`
import json, sys
import numpy as np
from backend.hdr_finisher.models import MaskExpression,GeometryAdjustments
from backend.hdr_finisher.local_adjustments import compile_spatial_preview_mask, _flatten_path
from backend.hdr_finisher.local_adjustments import compile_geometry_fixed_mask
recipes=[]
for hardness in [0,.65,1]:
    stroke=dict(points=[dict(x=.13,y=.25,pressure=.2),dict(x=.45,y=.52,pressure=.9),dict(x=.8,y=.7,pressure=.5)],radius=.14,hardness=hardness,flow=.3,opacity=.75)
    erase=dict(points=[dict(x=.4,y=.52),dict(x=.6,y=.6)],radius=.10,hardness=.5,flow=.8,opacity=.9,erase=True)
    repaint=dict(points=[dict(x=.48,y=.52)],radius=.16,hardness=.7,flow=.6,opacity=.8)
    recipes += [(f'brush-{hardness}',dict(type='brush',strokes=[stroke,stroke,erase,repaint])),(f'disc-{hardness}',dict(type='brush',strokes=[dict(points=[dict(x=0,y=.5,pressure=.4)],radius=.3,hardness=hardness)]))]
nodes=[dict(x=.15,y=.2),dict(x=.85,y=.2),dict(x=.8,y=.8),dict(x=.2,y=.85)]
curved=[dict(x=.15,y=.2,out_x=.4,out_y=-.1),dict(x=.85,y=.2,in_x=.6,in_y=.05),dict(x=.8,y=.8),dict(x=.2,y=.85)]
for feather in [0,.08]:
    recipes += [(f'path-{feather}',dict(type='path',nodes=nodes,feather=feather)),(f'curved-{feather}',dict(type='path',nodes=curved,feather=feather))]
for softness in [0,.5,1]:
    outer=[dict(x=0,y=0,out_x=.3,out_y=0),dict(x=1,y=0,in_x=.7,in_y=0),dict(x=1,y=1),dict(x=0,y=1)]
    for name,inner,feather_nodes in [('uniform',nodes,[]),('paired',nodes,outer),('curved',curved,outer),('resampled',nodes,outer+[dict(x=0,y=.5)])]:
        recipes.append((f'outer-{name}-{softness}',dict(type='path',nodes=inner,feather_mode='outer_boundary',feather=.12,feather_nodes=feather_nodes,feather_softness=softness)))
recipes.append(('empty-brush',dict(type='brush',strokes=[])))
cases=[]
for width,height in [(96,64),(64,96)]:
    for name,leaf in recipes:
        for inverted in [False,True]:
            expression=MaskExpression(leaf=leaf,inverted=inverted)
            expected=compile_spatial_preview_mask(np.zeros((height,width,3),dtype=np.float32),expression,GeometryAdjustments())
            cases.append(dict(name=name,inverted=inverted,width=width,height=height,expression=expression.model_dump(),expected=expected.reshape(-1).tolist(),vertices=_flatten_path(expression.leaf) if expression.leaf.type=='path' else None))
if sys.argv[1]=='orthogonal':
    for source_width,source_height in [(96,64),(64,96)]:
        for rotation in [0,90,180,270]:
            for horizontal,vertical in [(False,False),(True,False),(False,True),(True,True)]:
                if not rotation and not horizontal and not vertical:continue
                geometry=GeometryAdjustments(rotation=rotation,flip_horizontal=horizontal,flip_vertical=vertical)
                for name,leaf in recipes:
                    if name not in ['brush-0.65','disc-1','path-0','curved-0.08']:continue
                    for inverted in [False,True]:
                        expression=MaskExpression(leaf=leaf,inverted=inverted)
                        expected=compile_geometry_fixed_mask(np.zeros((source_height,source_width,3),dtype=np.float32),expression,geometry,spatial_only=True)
                        height,width=expected.shape
                        cases.append(dict(name=name,inverted=inverted,width=width,height=height,geometry=geometry.model_dump(),expression=expression.model_dump(),expected=expected.reshape(-1).tolist()))
from backend.hdr_finisher.local_adjustments import _flatten_path, _points_inside_polygon
expression=MaskExpression(leaf=dict(type='path',nodes=[dict(x=.58,y=.52),dict(x=.92,y=.56),dict(x=.88,y=.93),dict(x=.62,y=.88)]))
x,y=np.meshgrid((np.arange(3140,3172,dtype=np.float32)+.5)/5320,(np.arange(4140,4172,dtype=np.float32)+.5)/7968)
expected=_points_inside_polygon(x,y,_flatten_path(expression.leaf)).astype(np.uint8)*255
cases.append(dict(name='native-path-boundary',inverted=False,width=5320,height=7968,rect=dict(x=3140,y=4140,width=32,height=32),expression=expression.model_dump(),expected=expected.reshape(-1).tolist()))
if sys.argv[1]=='orthogonal':
    for rotation in [0,90,180,270]:
        for horizontal,vertical in [(False,False),(True,False),(False,True),(True,True)]:
            if not rotation and not horizontal and not vertical:continue
            width,height=(7968,5320) if rotation%180 else (5320,7968)
            left,top=(3140,4140)
            if rotation==90:left,top=7968-(4140+32),3140
            elif rotation==180:left,top=5320-(3140+32),7968-(4140+32)
            elif rotation==270:left,top=4140,5320-(3140+32)
            patch=np.rot90(expected,k=(-rotation//90)%4)
            if horizontal:left=width-(left+32);patch=np.flip(patch,axis=1)
            if vertical:top=height-(top+32);patch=np.flip(patch,axis=0)
            geometry=GeometryAdjustments(rotation=rotation,flip_horizontal=horizontal,flip_vertical=vertical)
            cases.append(dict(name='native-path-boundary-transformed',inverted=False,width=width,height=height,rect=dict(x=left,y=top,width=32,height=32),geometry=geometry.model_dump(),expression=expression.model_dump(),expected=patch.reshape(-1).tolist()))
print(json.dumps(cases))
`,orthogonal?'orthogonal':'neutral'],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}));

(async()=>{
  const browser=await chromium.launch(),page=await browser.newPage();
  try {
    await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799');
    await page.waitForFunction(()=>state.gpuPreview?.available);
    const results=await page.evaluate(async ({cases,shared})=>{
      const renderer=state.gpuPreview,device=renderer.device,results=[];
      if(shared)renderer.ensureStorageBuffers(196*4,4);
      const source=device.createTexture({size:[1,1],format:'r16float',usage:GPUTextureUsage.TEXTURE_BINDING});
      const half=v=>{const sign=v&32768?-1:1,e=(v>>10)&31,m=v&1023;return sign*(e?(1+m/1024)*2**(e-15):m*2**-24);};
      try {for(const fixture of cases){
        const geometrySignature=JSON.stringify(fixture.geometry||{});
        if(!HDRMaskRaster.eligible(fixture.expression,geometrySignature))throw Error('Unexpected rejection');
        if(fixture.vertices && !fixture.name.startsWith('outer-') && JSON.stringify(HDRMaskRaster.flatten(fixture.expression.leaf.nodes))!==JSON.stringify(fixture.vertices))throw Error('Bezier float32 vertices differ from export: '+fixture.name);
        let maxLevels=0,mismatchedHardPixels=0,pixels=0;
        // Nonzero tile origins exercise coverage across seams;
        // no GPU tile ever receives a whole-image bitmap.
        const region=fixture.rect||{x:0,y:0,width:fixture.width,height:fixture.height};
        if(shared){
          const tiles=[];
          for(let y=region.y;y<region.y+region.height;y+=23)for(let x=region.x;x<region.x+region.width;x+=31){
            const rect={x,y,width:Math.min(31,region.x+region.width-x),height:Math.min(23,region.y+region.height-y)};
            tiles.push({key:`${x}:${y}`,rect,haloRect:rect,halo:0});
          }
          const id=`shared-${results.length}`,local={id,mask:fixture.expression};
          const loaded=await renderer.loadLocalMaskTiles(id,{localIndex:0,local,tiles},Math.max(fixture.width,fixture.height),
            0,geometrySignature,()=>true,undefined,{region,width:fixture.width,height:fixture.height,texture:source});
          if(new Set(loaded.entries.values()).size!==1)throw Error('Tiles did not share one mask');
          renderer.recordFrameMasks({execution:'tiled',sessionId:id,lane:'hdr',width:fixture.width,height:fixture.height,
            locals:[local],pieces:tiles.map(tile=>({rect:tile.rect,origin:tile.haloRect,entries:[loaded.entries.get(tile.key)]}))});
          const read=await renderer.readLocalMaskRegion(id,region.x,region.y,region.width,region.height);
          if(read.error||read.coveredPixels!==region.width*region.height)throw Error(read.error||'Incomplete region');
          for(let i=0;i<read.values.length;i++){
            const value=read.values[i]*255,expected=fixture.expected[i];
            maxLevels=Math.max(maxLevels,Math.abs(value-expected));
            if((value>=127.5)!==(expected>=127.5))mismatchedHardPixels++;
          }
          results.push({name:fixture.name,inverted:fixture.inverted,geometry:fixture.geometry,width:fixture.width,height:fixture.height,
            pixels:read.coveredPixels,maxLevels,mismatchedHardPixels,sharedTextures:1,sources:read.sources});
          continue;
        }
        for(let top=region.y;top<region.y+region.height;top+=23)for(let left=region.x;left<region.x+region.width;left+=31){
          const rect={x:left,y:top,width:Math.min(31,region.x+region.width-left),height:Math.min(23,region.y+region.height-top)};
          const values=HDRMaskRaster.parameters(fixture.expression,rect,fixture.width,fixture.height,geometrySignature);
          const buffer=renderer.createStorageBuffer(values);device.queue.writeBuffer(buffer,0,values);
          const texture=device.createTexture({size:[rect.width,rect.height],format:'r16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
          const read=device.createBuffer({size:256*rect.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
          try {
            const encoder=device.createCommandEncoder();renderer.encodeMaskPass(encoder,renderer.maskPipelines.shapeRaster,renderer.createMaskBindGroup(source,buffer),texture);
            encoder.copyTextureToBuffer({texture},{buffer:read,bytesPerRow:256},[rect.width,rect.height]);device.queue.submit([encoder.finish()]);
            await read.mapAsync(GPUMapMode.READ);const actual=new Uint16Array(read.getMappedRange());
            for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++){
              const expected=fixture.expected[(top+y-region.y)*region.width+left+x-region.x],value=half(actual[y*128+x])*255;
              maxLevels=Math.max(maxLevels,Math.abs(value-expected));
              if((value>=127.5)!==(expected>=127.5))mismatchedHardPixels++;
              pixels++;
            }
            read.unmap();
          }finally{[buffer,texture,read].forEach(r=>r.destroy());}
        }
        results.push({name:fixture.name,inverted:fixture.inverted,width:fixture.width,height:fixture.height,pixels,maxLevels,mismatchedHardPixels});
      }}finally{source.destroy();}
      return results;
    },{cases,shared});
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
    for(const r of results){assert.ok(r.maxLevels<=1.1,JSON.stringify(r));if(!r.name.startsWith('outer-'))assert.equal(r.mismatchedHardPixels,0,JSON.stringify(r));}
    console.log(`GPU shape tiles: ${results.length} CPU-reference cases pass.`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
