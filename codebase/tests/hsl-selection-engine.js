// Shared colour selection on the real GPU against its CPU reference: whole frame,
// a halo tile (interior must match the frame), reduced scale, Global/Local equality,
// unsampled emptiness and preparation reuse. Runs in an isolated window.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(root,'output/hsl-selection-engine');
 require('node:child_process').execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'tools/hsl_selection_fixture.py')],{stdio:'inherit'});
 const fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.json')));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-test-selection-'));
 const app=await _electron.launch({executablePath:require('../desktop/node_modules/electron'),args:[path.join(root,'tools/hsl-prototype/electron-main.cjs')],env:{...process.env,HDR_FINISHER_USER_DATA_DIR:profile,HSL_PROTOTYPE_TEST:'1'}});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>window.hslPrototype?.ready);
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'frontend/hsl-selection-gpu.js'),'utf8')});
  const report=await page.evaluate(async f=>{
   const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No GPU adapter');
   const device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
   const engine=await new HDRHslSelectionGpu(device).initialize();
   const all=new Float32Array(f.width*f.height*4);f.fields.flat().forEach((v,i)=>all.set(v,i*4));
   async function run(c,channels,{prepareKey=null,selectKey=null}={}){
    const encoder=device.createCommandEncoder();
    engine.ensure(c.width,c.height,Math.ceil(channels.length/4),HDRHslSelectionGpu.geometry(c.scale).cell);
    if(!engine.isPrepared(prepareKey)){
     const region=new Float32Array(c.width*c.height*4);
     for(let y=0;y<c.height;y++)region.set(all.subarray(((c.y+y)*f.width+c.x)*4,((c.y+y)*f.width+c.x+c.width)*4),y*c.width*4);
     device.queue.writeTexture({texture:engine.textures.fields},region,{bytesPerRow:c.width*16},{width:c.width,height:c.height});
    }
    const token=engine.encode(encoder,{width:c.width,height:c.height,originX:c.x,originY:c.y,scale:c.scale,channels,prepareKey,selectKey}),layers=token.layers;
    const row=Math.ceil(c.width*16/256)*256;
    const read=device.createBuffer({size:row*c.height*layers,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    encoder.copyTextureToBuffer({texture:engine.textures.output},{buffer:read,bytesPerRow:row,rowsPerImage:c.height},{width:c.width,height:c.height,depthOrArrayLayers:layers});
    device.queue.submit([encoder.finish()]);engine.commit(token);await read.mapAsync(GPUMapMode.READ);
    const v=new Float32Array(read.getMappedRange().slice(0));read.unmap();read.destroy();
    return (lane,x,y)=>v[Math.floor(lane/4)*row/4*c.height+y*row/4+x*4+lane%4];
   }
   const result={cases:{},errors,tileSeamMax:0}; let whole=null,wholeCase=null;
   for(const c of f.cases){
    const at=await run(c,c.channels||f.channels),diff=[];
    const [ix,iy,iw,ih]=c.interior||[0,0,c.width,c.height];
    for(let lane=0;lane<2;lane++)for(let y=iy;y<iy+ih;y++)for(let x=ix;x<ix+iw;x++){
     const g=at(lane,x,y);if(!Number.isFinite(g))throw Error('Non-finite coverage');diff.push(Math.abs(g-c.weights[lane][y][x]));
    }
    if(c.interior && whole && wholeCase.scale===c.scale && c.channels){
     for(let lane=0;lane<2;lane++)for(let y=iy;y<iy+ih;y++)for(let x=ix;x<ix+iw;x++)
      result.tileSeamMax=Math.max(result.tileSeamMax,Math.abs(at(lane,x,y)-whole(lane,x+c.x,y+c.y)));
    }
    if(!c.interior){whole=at;wholeCase=c;}
    diff.sort((a,b)=>a-b);
    result.cases[c.name]={mean:diff.reduce((a,b)=>a+b,0)/diff.length,p99:diff[Math.floor(diff.length*.99)],max:diff.at(-1)};
   }
   // Local adapter: equal settings give identical coverage (same lane maths).
   const full=f.cases[0];
   const global=await run(full,[f.channels[0]]);
   const local=await run(full,[{ranges:[{center:109,width:15,feather:21,subtract:false}],floor:.02}]);
   let equal=true;for(let y=0;y<full.height;y++)for(let x=0;x<full.width;x++)if(global(0,x,y)!==local(0,x,y))equal=false;
   result.equalGlobalLocal=equal;
   // Preparation reuse: range edits keep the prepared serial; a new key rebuilds.
   await run(full,f.channels,{prepareKey:'above:1',selectKey:'a'});const serial=engine.serial;
   const t0=performance.now();await run(full,[{ranges:[{center:109,width:24,feather:41}],floor:.04}],{prepareKey:'above:1',selectKey:'b'});
   result.rangeEditMs=performance.now()-t0;result.reused=engine.serial===serial;
   const t1=performance.now();await run(full,[{...f.channels[0],edge:8,edge_feather:16,edge_detail:100}],{prepareKey:'above:1',selectKey:'edges'});
   result.edgeEditMs=performance.now()-t1;result.edgesReused=engine.serial===serial;
   await run(full,f.channels,{prepareKey:'above:2',selectKey:'b'});result.invalidated=engine.serial!==serial;
   engine.destroy();device.destroy();return result;
  },fixture);
  for(const [name,c] of Object.entries(report.cases)){
   assert.ok(c.mean<.0001&&c.p99<.002,`${name}: ${JSON.stringify(c)}`);
  }
  assert.ok(report.equalGlobalLocal,'Equal Global/Local settings produced different coverage');
  assert.ok(report.reused&&report.edgesReused&&report.invalidated,JSON.stringify(report));assert.deepEqual(report.errors,[]);
  assert.equal(fixture.tile_seam_max,0);assert.ok(report.tileSeamMax<.000001,'GPU tile joins: '+report.tileSeamMax);
  assert.ok(report.edgeEditMs<=report.rangeEditMs*1.2+10,'Edge edit exceeds proposed timing allowance');
  assert.ok(fixture.selected_mean>.8);assert.ok(fixture.noisy_std_after<fixture.noisy_std_before*.3);assert.ok(fixture.fringe_mean>.8);assert.ok(fixture.neutral_mean<.001);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log('PASS shared selection GPU/CPU',JSON.stringify(report));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
