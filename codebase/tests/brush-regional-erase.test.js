const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
function fixture(){
 const context=vm.createContext({window:{},performance:{now:()=>0},console,AbortController,setTimeout,clearTimeout,setInterval,clearInterval});
 for(const file of ['mask-loader.js','mask-raster.js','gpu-brush-mask.js','webgpu-shaders.js','webgpu-preview.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend',file),'utf8'),context);
 const renderer=new context.window.HDRWebGPUPreview(null),writes=[],textures=[],qualified=[];
 renderer.device={queue:{writeBuffer:(_b,_o,v)=>writes.push(Array.from(v)),submit(){}},createCommandEncoder:()=>({finish:()=>({})})};
 renderer.maskSourceSize={sessionId:'session',width:8000,height:6000};
 renderer.maskPipelines={brushRegionalErase:{}};renderer.createStorageBuffer=()=>({destroy(){}});
 renderer.createMaskTexture=(w,h)=>{const t={width:w,height:h,destroy(){}};textures.push(t);return t;};
 renderer.createMaskBindGroup=()=>({});renderer.encodeMaskPass=()=>{};renderer.destroyAfterActiveRenders=fn=>fn();renderer.retainLocalMask=()=>{};
 renderer.loadGpuBrushLeaf=async(_id,_local,mask,_path,edge)=>{qualified.push({mask,edge});return{soft:edge>=1600,longEdge:edge,texture:{},frameRect:[0,0,1,1]};};
 // These cases cover the qualified-paint fallback used when the native field refuses.
 const native=[];renderer.loadGpuBrushShiftRegion=async(...values)=>{native.push(values);return null;};
 const stroke={points:[{x:.04,y:.09}],radius:.1,hardness:.8,flow:1,opacity:1};
 const mask={operator:'leaf',inverted:true,leaf:{type:'brush',mask_feather:.05,strokes:[stroke,{...stroke,erase:true},stroke]}};
 const proxy={region:{x:123,y:456,width:600,height:400},width:8000,height:6000};
 const batch={localIndex:0,local:{id:'brush',mask},tiles:[{key:'first'},{key:'second'}]};
 const run=(current=()=>true,geometry='{}')=>renderer.loadGpuBrushEraseRegion('session',batch,8000,1,geometry,current,undefined,proxy);
 return{renderer,qualified,textures,writes,batch,run,native};
}
test('paint qualification excludes erasers; native attenuation retains repaint and frame placement',async()=>{
 const f=fixture(),result=await f.run();
 assert.deepEqual(f.qualified.map(x=>x.edge),[512,1024,1600]);
 assert.equal(f.qualified[0].mask.leaf.strokes.length,2);assert.equal(f.qualified[0].mask.inverted,true);
 assert.equal(f.batch.local.mask.leaf.strokes.length,3);
 assert.deepEqual(f.writes[0].slice(-8),[8000,6000,123,456,0,0,1,1]);
 assert.equal(f.writes[0][7],3);assert.equal(f.writes[0][5],1);
 const entries=[...result.entries.values()];assert.equal(entries[0],entries[1]);assert.equal(entries[0].kind,'gpu-brush-regional-erase');
 await f.run();assert.equal(f.textures.length,1);
});
test('unqualified paint, Shift Edge, resampling and cancellation retain fallback',async()=>{
 const f=fixture();assert.equal(await f.run(()=>false),null);assert.equal(f.textures.length,0);
 assert.equal(await f.run(()=>true,JSON.stringify({straighten_angle:1})),null);
 f.batch.local.mask.leaf.mask_shift_edge=.01;assert.equal(await f.run(),null);
 f.batch.local.mask.leaf.mask_shift_edge=0;f.renderer.loadGpuBrushLeaf=async()=>({soft:false});
 assert.equal(await f.run(),null);assert.equal(f.textures.length,0);
});
test('an already qualified complete brush keeps its existing small-bitmap route',async()=>{
 const f=fixture();
 // Supply a previously qualified complete mask instead of a paint-only mask.
 f.renderer.softMasks.get=()=>({soft:true,destroyed:false});
 assert.equal(await f.run(),null);assert.equal(f.qualified.length,0);assert.equal(f.textures.length,0);
});
test('the native feather field precedes paint qualification and an already qualified mask precedes both',async()=>{
 const f=fixture(),entry={kind:'gpu-brush-native-feather'},served={localIndex:0,entries:new Map([['first',entry]])};
 f.renderer.loadGpuBrushShiftRegion=async(...values)=>{f.native.push(values);return served;};
 assert.equal(await f.run(),served);assert.equal(f.native[0][7],true);assert.equal(f.qualified.length,0);assert.equal(f.textures.length,0);
 f.renderer.softMasks.get=()=>({soft:true,destroyed:false});
 assert.equal(await f.run(),null);assert.equal(f.native.length,1);
});
