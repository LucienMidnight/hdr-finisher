// Owns an isolated GPU window; the shipping app does not load this engine.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(root,'output/hsl-selection-engine');
 require('node:child_process').execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'tools/hsl_selection_fixture.py')],{stdio:'inherit'});
 const fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.json')));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-selection-'));
 const app=await _electron.launch({executablePath:require('../desktop/node_modules/electron'),args:[path.join(root,'tools/hsl-prototype/electron-main.cjs')],env:{...process.env,HDR_FINISHER_USER_DATA_DIR:profile,HSL_PROTOTYPE_TEST:'1'}});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>window.hslPrototype?.ready);
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'frontend/hsl-selection-gpu.js'),'utf8')});
  const report=await page.evaluate(async f=>{
   const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No GPU adapter');
   const device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
   const engine=await new HDRHslSelectionGpu(device).initialize();
   const input=new Float32Array(f.width*f.height*4);
   f.pixels.flat().forEach((rgb,i)=>input.set([...rgb,1],i*4));
   const source=device.createTexture({size:[f.width,f.height],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   device.queue.writeTexture({texture:source},input,{bytesPerRow:f.width*16},{width:f.width,height:f.height});
   const start=performance.now();const prepared=engine.prepare(source,'above-HSL:1');
   const selection=engine.select({ranges:f.ranges});
   const row=Math.ceil(f.width*16/256)*256;
   const read=device.createBuffer({size:row*f.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   const encoder=device.createCommandEncoder();
   encoder.copyTextureToBuffer({texture:selection},{buffer:read,bytesPerRow:row},{width:f.width,height:f.height});
   device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const values=new Float32Array(read.getMappedRange()),diff=[],angles=[];
   for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
    const at=y*row/4+x*4;
    if(!Number.isFinite(values[at]))throw Error('Non-finite coverage');
    diff.push(Math.abs(values[at]-f.weight[y][x]));
    if(f.weight[y][x]>.01)angles.push(Math.abs(((values[at+1]-f.target[y][x]+540)%360)-180));
   }
   diff.sort((a,b)=>a-b);angles.sort((a,b)=>a-b);
   const saved=new Float32Array(values);
   read.unmap();
   const local=engine.selectHue({hue_center:109,hue_width:15,hue_smoothness:21,saturation_floor:.02});
   const copy=device.createCommandEncoder();
   copy.copyTextureToBuffer({texture:local},{buffer:read,bytesPerRow:row},{width:f.width,height:f.height});
   device.queue.submit([copy.finish()]);await read.mapAsync(GPUMapMode.READ);
   const localValues=new Float32Array(read.getMappedRange());
   let equal=true;
   for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++) {
     const at=y*row/4+x*4;if(localValues[at]!==saved[at])equal=false;
   }
   if(!equal)throw Error('Equal Global/Local settings produced different coverage');
   read.unmap();local.destroy();
   const empty=engine.selectHue({hue_center:null});
   const emptyCopy=device.createCommandEncoder();
   emptyCopy.copyTextureToBuffer({texture:empty},{buffer:read,bytesPerRow:row},{width:f.width,height:f.height});
   device.queue.submit([emptyCopy.finish()]);await read.mapAsync(GPUMapMode.READ);
   const emptyValues=new Float32Array(read.getMappedRange());
   for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
     if(emptyValues[y*row/4+x*4]!==0)throw Error('Unsampled Local hue selected pixels');
   }
   empty.destroy();
   const same=engine.prepare(source,'above-HSL:1')===prepared;
   const retained=engine.prepared.serial;
   const second=engine.select({ranges:[{center:109,width:24,feather:41}]},.04);second.destroy();
   if(engine.prepared.serial!==retained)throw Error('Selection controls rebuilt prepared chroma');
   engine.prepare(source,'above-HSL:2');const invalidated=engine.prepared.serial!==retained;
   const result={mean:diff.reduce((a,b)=>a+b,0)/diff.length,p99:diff[Math.floor(diff.length*.99)],targetP99:angles[Math.floor(angles.length*.99)],cached:same,invalidated,equalGlobalLocal:true,unsampledEmpty:true,elapsed_ms:performance.now()-start,errors};
   read.unmap();read.destroy();selection.destroy();engine.destroy();source.destroy();device.destroy();return result;
  },fixture);
  // Engineering coverage check only; final-image perceptual acceptance is still required.
  assert.ok(report.mean<.0001,JSON.stringify(report));assert.ok(report.p99<.002,JSON.stringify(report));
  assert.ok(report.targetP99<.02,JSON.stringify(report));assert.ok(report.cached&&report.invalidated);assert.deepEqual(report.errors,[]);
  assert.ok(fixture.selected_mean>.8);assert.ok(fixture.noisy_std_after<fixture.noisy_std_before*.3);assert.ok(fixture.fringe_mean<.01);assert.ok(fixture.neutral_mean<.001);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log('PASS isolated selection GPU/CPU',JSON.stringify(report));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
