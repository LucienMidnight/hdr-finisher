const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const { frontendSource } = require('./frontend-source.js');
function fixture(){
 const context=vm.createContext({window:{},performance:{now:()=>0},console,setTimeout,clearTimeout,setInterval,clearInterval});
 for(const file of ['mask-raster.js','gpu-brush-mask.js','webgpu-shaders.js','webgpu-preview.js'])vm.runInContext(frontendSource(file),context);
 const helper=context.window.HDRGpuBrushMask,renderer=new context.window.HDRWebGPUPreview(null);
 const mask={operator:'leaf',leaf:{type:'brush',mask_feather:0,mask_shift_edge:.005,strokes:[]}};
 const batch={local:{id:'brush',mask},localIndex:3,tiles:[{key:'tile'}]},proxy={width:4000,height:2667,region:{x:1300,y:900,width:1000,height:800}};
 renderer.device={limits:{maxTextureDimension2D:8192}};renderer.retainLocalMask=()=>{};
 const texture={count:0,destroy(){this.count++;}};let calls=0;
 context.window.HDRGpuBrushMask={...helper,generateShiftRegion:async()=>{calls++;return{texture,width:1000,height:800,byteSize:1600000,kind:'gpu-brush-native-shift'};}};
 const run=(current=()=>true,geometry='{}')=>renderer.loadGpuBrushShiftRegion('session',batch,4000,geometry,current,undefined,proxy);
 return {context,helper,renderer,batch,proxy,mask,texture,run,calls:()=>calls};
}
test('native Shift plan uses native sigma and the complete summed finite halo',()=>{const f=fixture(),p=f.helper.shiftRegionPlan(f.mask,4000,2667,'{}',f.proxy.region);assert.equal(p.region.x,1218);assert.equal(p.region.y,818);assert.equal(p.region.width,1164);assert.equal(p.region.height,964);});
test('native Shift refuses feather, resampling, excessive scratch and subpixel bypass',()=>{const f=fixture(),plan=()=>f.helper.shiftRegionPlan(f.mask,4000,2667,'{}',f.proxy.region);f.mask.leaf.mask_feather=.01;assert.equal(plan(),null);f.mask.leaf.mask_feather=0;assert.equal(f.helper.shiftRegionPlan(f.mask,4000,2667,'{"straighten_angle":1}',f.proxy.region),null);f.mask.leaf.mask_shift_edge=.000001;assert.equal(plan(),null);f.mask.leaf.mask_shift_edge=.05;assert.equal(f.helper.shiftRegionPlan(f.mask,8000,8000,'{}',{x:0,y:0,width:4000,height:4000}),null);});
test('native Shift caches one registered regional mask with exact output placement',async()=>{const f=fixture(),a=await f.run(),entry=a.entries.get('tile');assert.equal(a.localIndex,3);assert.equal(entry.wholeFrame,true);assert.deepEqual(Array.from(entry.frameRect),[.325,900/2667,.25,800/2667]);assert.equal((await f.run()).entries.get('tile'),entry);assert.equal(f.calls(),1);assert.equal(f.renderer.localMasks.size,1);});
test('stale and device-replaced native Shift outputs are released before registration',async()=>{const f=fixture();assert.equal(await f.run(()=>false),null);assert.equal(f.calls(),0);f.context.window.HDRGpuBrushMask.generateShiftRegion=async()=>{f.renderer.resourceGeneration++;return {texture:f.texture};};assert.equal(await f.run(),null);assert.equal(f.texture.count,1);assert.equal(f.renderer.localMasks.size,0);});
test('native Shift maps an index crop into uncropped coordinates',async()=>{const f=fixture();let captured;f.renderer.analyticMaskFrame=()=>({x:700,y:100,width:5000,height:3000,geometrySignature:'{}'});f.context.window.HDRGpuBrushMask.generateShiftRegion=async(...args)=>{captured=args;return{texture:f.texture,kind:'gpu-brush-native-shift'};};assert.ok(await f.run());assert.equal(captured[2],5000);assert.equal(captured[3],3000);assert.equal(captured[5].x,2000);assert.equal(captured[5].y,1000);});

test('whole picture proxies still derive bounded foreground mask placement',async()=>{const f=fixture();delete f.proxy.region;f.batch.tiles[0].haloRect={x:1300,y:900,width:1000,height:800};assert.ok(await f.run());assert.equal(f.calls(),1);});
test('concurrent native Shift requests share generation and release inflight ownership',async()=>{const f=fixture();let resolve;f.context.window.HDRGpuBrushMask.generateShiftRegion=()=>new Promise(done=>{resolve=done;});const a=f.run(),b=f.run();assert.equal(f.renderer.localMaskInflight.size,1);resolve({texture:f.texture,kind:'gpu-brush-native-shift'});assert.equal((await a).entries.get('tile'),(await b).entries.get('tile'));assert.equal(f.renderer.localMaskInflight.size,0);});
test('large catch-up batches split masks instead of allocating a whole frame',async()=>{const f=fixture();f.batch.tiles=[{key:'a',haloRect:{x:0,y:0,width:1000,height:800}},{key:'b',haloRect:{x:6000,y:5000,width:1000,height:800}}];const proxy={width:8000,height:8000};const result=await f.renderer.loadGpuBrushShiftRegion('session',f.batch,8000,'{}',()=>true,undefined,proxy);assert.equal(result.entries.size,2);assert.equal(f.calls(),2);});
