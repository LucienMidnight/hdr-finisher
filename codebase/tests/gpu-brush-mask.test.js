const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
function fixture(){
 const context=vm.createContext({window:{},performance:{now:()=>0},console,AbortController,TextEncoder,Blob,setTimeout,clearTimeout,setInterval,clearInterval,btoa:s=>Buffer.from(s,'binary').toString('base64')});
 for(const file of ['mask-loader.js','mask-raster.js','gpu-brush-mask.js','webgpu-shaders.js','webgpu-preview.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend',file),'utf8'),context);
 const helper=context.window.HDRGpuBrushMask,renderer=new context.window.HDRWebGPUPreview(null),textures=[],requests=[];
 renderer.device={};renderer.maskSourceSize={sessionId:'session',width:3000,height:2000};renderer.gpuAnalyticMasksEnabled=true;
 renderer.retainLocalMask=()=>{};
 context.window.HDRGpuBrushMask={...helper,generate:async(_renderer,_mask,width,height)=>{const texture={destroyed:0,destroy(){this.destroyed++;}};textures.push(texture);return{texture,bitmap:new Uint8Array(width*height),width,height,kind:'gpu-brush-feather'};}};
 context.fetch=async(url,options)=>{const data=new Uint8Array(await options.body.arrayBuffer()),size=new DataView(data.buffer).getUint32(0,true);requests.push({url,body:JSON.parse(new TextDecoder().decode(data.subarray(4,4+size))),bitmap:data.subarray(4+size)});return{ok:true,headers:{get:key=>({'X-Geometry-Signature':'{}','X-Mask-Soft':'1','X-Mask-Soft-Estimate':'1.000','X-Mask-Soft-Limit':'3.000','X-Mask-Frame-Rect':'0,0,1,1'})[key]||''}};};
 const mask={operator:'leaf',enabled:true,inverted:false,leaf:{type:'brush',mask_feather:.05,mask_shift_edge:0,strokes:[]}},local={id:'brush',mask};
 const run=(current=()=>true,signal)=>renderer.loadGpuBrushLeaf('session',local,mask,'',512,1,'{}',current,signal);
 return{context,renderer,textures,requests,mask,local,run};
}
test('qualified brush bitmap reuses cache without a CPU mask request',async()=>{const f=fixture(),entry=await f.run();assert.equal(entry.kind,'gpu-brush-feather');assert.equal(entry.soft,true);assert.equal(entry.width,512);assert.equal(entry.height,341);assert.equal(f.requests.length,1);assert.match(f.requests[0].url,/bitmap-verdict-raw$/);assert.equal(f.requests[0].body.edit_revision,1);assert.equal(f.requests[0].bitmap.length,512*341);assert.equal(await f.run(),entry);assert.equal(f.textures.length,1);});
test('evicted qualified larger brushes recover at their qualified size',async()=>{
 const f=fixture();
 const entry=await f.renderer.loadGpuBrushLeaf('session',f.local,f.mask,'',3200,1,'{}');
 f.renderer.localMasks.delete(entry.cacheKey);entry.destroyed=true;
 f.renderer.loadCpuLeafAt=()=>{throw Error('Qualified GPU recovery must not compile a CPU mask');};
 const recovered=await f.renderer.softLeafMask('session',f.local,f.mask,'',1,'{}');
 assert.equal(recovered.longEdge,3200);assert.equal(f.requests.at(-1).body.long_edge,3200);
 assert.notEqual(recovered,entry);
});
test('device refusal during larger bitmap recovery preserves the fallback size',async()=>{
 const f=fixture();
 const entry=await f.renderer.loadGpuBrushLeaf('session',f.local,f.mask,'',1600,1,'{}');
 entry.destroyed=true;f.renderer.localMasks.delete(entry.cacheKey);
 f.context.window.HDRGpuBrushMask.generate=async()=>null;
 let edge;
 f.renderer.loadCpuLeafAt=async(...args)=>{edge=args[4];return{soft:true};};
 assert.ok(await f.renderer.softLeafMask('session',f.local,f.mask,'',1,'{}'));
 assert.equal(edge,1600);
});
test('stale requests are dropped before allocation and after qualification',async()=>{const f=fixture();assert.equal(await f.run(()=>false),null);assert.equal(f.textures.length,0);let current=true;f.context.fetch=async()=>{current=false;return{ok:true,headers:{get:()=> '{}'}};};assert.equal(await f.run(()=>current),null);assert.equal(f.textures[0].destroyed,1);assert.equal(f.renderer.localMasks.size,0);});
test('resource replacement and aborted classification release scratch output',async()=>{const f=fixture();f.context.fetch=async()=>{f.renderer.resourceGeneration++;return{ok:true,headers:{get:()=> '{}'}};};assert.equal(await f.run(),null);assert.equal(f.textures[0].destroyed,1);const g=fixture(),controller=new AbortController();controller.abort();assert.equal(await g.run(()=>true,controller.signal),null);assert.equal(g.textures.length,0);});
test('Shift Edge gets a bounded GPU bitmap but resampling geometry retains fallback',async()=>{const f=fixture();f.mask.leaf.mask_shift_edge=.01;assert.ok(await f.run());assert.equal(f.requests.length,1);f.mask.leaf.mask_shift_edge=0;assert.equal(await f.renderer.loadGpuBrushLeaf('session',f.local,f.mask,'',512,1,JSON.stringify({straighten_angle:1})),null);});
test('auxiliary Shift Edge uses an exact bounded GPU bitmap without soft stretching',async()=>{
 const f=fixture();f.mask.leaf.mask_shift_edge=.01;
 f.renderer.loadCpuLeafAt=()=>{throw Error('Bounded Shift Edge must not compile on CPU');};
 f.context.fetch=async()=>({ok:true,headers:{get:key=>({'X-Geometry-Signature':'{}','X-Mask-Soft':'0','X-Mask-Soft-Reason':'shift-edge','X-Mask-Soft-Estimate':'Infinity','X-Mask-Soft-Limit':'3.000','X-Mask-Frame-Rect':'0,0,1,1'})[key]||''}});
 const entry=await f.renderer.loadMaskLeaf('session',f.local,f.mask,'',512,1,'{}',()=>true,undefined,true,false);
 assert.equal(entry.kind,'gpu-brush-feather');assert.equal(entry.soft,false);
 assert.equal(entry.width,512);assert.equal(entry.height,341);
});
