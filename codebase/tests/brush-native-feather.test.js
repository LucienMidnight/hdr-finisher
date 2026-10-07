const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const { frontendSource } = require('./frontend-source.js');
function fixture(){
 const context=vm.createContext({window:{},performance:{now:()=>0},console,setTimeout,clearTimeout,setInterval,clearInterval});
 for(const file of ['mask-raster.js','gpu-brush-mask.js','webgpu-shaders.js','webgpu-preview.js'])vm.runInContext(frontendSource(file),context);
 const helper=context.window.HDRGpuBrushMask,renderer=new context.window.HDRWebGPUPreview(null);
 const mask={operator:'leaf',leaf:{type:'brush',mask_feather:.02,mask_shift_edge:.005,strokes:[]}};
 const batch={local:{id:'brush',mask},localIndex:3,tiles:[{key:'tile'}]},proxy={width:4000,height:2667,region:{x:1300,y:900,width:1000,height:800}};
 renderer.device={limits:{maxTextureDimension2D:8192}};renderer.retainLocalMask=()=>{};
 const texture=()=>({count:0,destroy(){this.count++;}});
 const calls={field:0,region:0,shift:0},made={fields:[],regions:[]};
 context.window.HDRGpuBrushMask={...helper,
  generateFeatherField:async()=>{calls.field++;const entry={texture:texture(),width:127,height:86,byteSize:43688,kind:'gpu-brush-native-feather-field',timings:{}};made.fields.push(entry);return entry;},
  generateFeatherRegion:async(...args)=>{calls.region++;const entry={texture:texture(),width:args[5].width,height:args[5].height,byteSize:1,kind:'gpu-brush-native-feather',timings:{},field:args[6],rect:args[5]};made.regions.push(entry);return entry;},
  generateShiftRegion:async()=>{calls.shift++;return{texture:texture(),kind:'gpu-brush-native-shift',timings:{}};}};
 const run=(current=()=>true,region=proxy.region,featherOnly=false)=>renderer.loadGpuBrushShiftRegion('session',batch,4000,'{}',current,undefined,{...proxy,region},featherOnly);
 return {context,helper,renderer,batch,proxy,mask,run,calls,made};
}
test('native Feather plans the export reduction grid and needs no viewport halo',()=>{
 const f=fixture(),p=f.helper.featherRegionPlan(f.mask,4000,2667,'{}',f.proxy.region);
 assert.equal(p.factor,22);assert.deepEqual({...p.coarse},{width:184,height:124});assert.equal(p.shiftActive,true);
 assert.deepEqual({...p.region},{x:1300,y:900,width:1000,height:800});
});
test('a narrow native Feather keeps full-resolution boxes over both finite halos',()=>{
 const f=fixture();f.mask.leaf.mask_feather=.0002;
 const p=f.helper.featherRegionPlan(f.mask,4000,2667,'{}',f.proxy.region);
 assert.equal(p.factor,1);assert.equal(p.coarse,null);
 assert.equal(p.region.x,1300-p.shiftReach-p.reach);assert.equal(p.region.width,1000+2*(p.shiftReach+p.reach));
 assert.ok(p.reach>0&&p.shiftReach>0);
});
test('native Feather refuses resampling, other leaves and scratch beyond the cap',()=>{
 const f=fixture(),plan=(mask=f.mask,signature='{}',rect=f.proxy.region,w=4000,h=2667)=>f.helper.featherRegionPlan(mask,w,h,signature,rect);
 assert.equal(plan(f.mask,'{"straighten_angle":1}'),null);
 assert.equal(plan({operator:'leaf',leaf:{type:'path',mask_feather:.02}}),null);
 assert.equal(plan(f.mask,'{}',{x:0,y:0,width:8000,height:8000},8000,8000),null);
 assert.equal(plan(f.mask,'{}',{x:3500,y:0,width:1000,height:800}),null);
});
test('a feather below a quarter pixel is the unfeathered native Shift route',async()=>{
 const f=fixture();f.mask.leaf.mask_feather=1e-7;
 assert.equal(f.helper.featherFieldPlan(f.mask,4000,2667,'{}'),null);
 assert.ok(f.helper.shiftRegionPlan(f.mask,4000,2667,'{}',f.proxy.region));
 assert.equal((await f.run()).entries.get('tile').kind,'gpu-brush-native-shift');assert.equal(f.calls.field,0);
});
test('Shift plus Feather makes one field and one registered regional mask',async()=>{
 const f=fixture(),a=await f.run(),entry=a.entries.get('tile');
 assert.equal(entry.kind,'gpu-brush-native-feather');assert.equal(entry.wholeFrame,true);
 assert.deepEqual(Array.from(entry.frameRect),[.325,900/2667,.25,800/2667]);
 assert.equal((await f.run()).entries.get('tile'),entry);
 assert.deepEqual({...f.calls},{field:1,region:1,shift:0});assert.equal(f.renderer.localMasks.size,2);
});
test('a pan reuses the resident field and only makes the new region',async()=>{
 const f=fixture();await f.run();
 const moved=await f.run(()=>true,{x:2000,y:1000,width:1000,height:800});
 assert.equal(moved.entries.get('tile').field,f.made.fields[0]);
 assert.deepEqual({...f.calls},{field:1,region:2,shift:0});assert.equal(f.renderer.localMasks.size,3);
});
test('an evicted field is rebuilt before the next region uses it',async()=>{
 const f=fixture();await f.run();f.made.fields[0].destroyed=true;
 const moved=await f.run(()=>true,{x:2000,y:1000,width:1000,height:800});
 assert.equal(moved.entries.get('tile').field,f.made.fields[1]);assert.equal(f.calls.field,2);
});
test('Feather without Shift reaches the native field only as the post-qualification route',async()=>{
 const f=fixture();f.mask.leaf.mask_shift_edge=0;
 assert.equal(await f.run(),null);assert.equal(f.calls.field,0);
 assert.equal((await f.run(()=>true,f.proxy.region,true)).entries.get('tile').kind,'gpu-brush-native-feather');
 f.mask.leaf.mask_shift_edge=.005;assert.equal(await f.run(()=>true,f.proxy.region,true),null);
});
test('unqualified feathered paint is served natively before any CPU mask request',async()=>{
 const f=fixture();f.mask.leaf.mask_shift_edge=0;
 f.renderer.gpuAnalyticMasksEnabled=true;f.renderer.softLeafMask=async()=>null;f.renderer.loadGpuBrushEraseRegion=async()=>null;
 f.renderer.loadGpuAnalyticRegion=()=>null;
 const result=await f.renderer.loadLocalMaskTiles('session',f.batch,4000,1,'{}',()=>true,undefined,f.proxy);
 assert.equal(result.entries.get('tile').kind,'gpu-brush-native-feather');
 const qualified={kind:'soft'};f.renderer.softLeafMask=async()=>qualified;
 assert.equal((await f.renderer.loadLocalMaskTiles('session',f.batch,4000,1,'{}',()=>true,undefined,f.proxy)).entries.get('tile'),qualified);
});
test('stale and device-replaced fields and regions are released before registration',async()=>{
 const f=fixture();assert.equal(await f.run(()=>false),null);assert.deepEqual({...f.calls},{field:0,region:0,shift:0});
 const field=f.context.window.HDRGpuBrushMask.generateFeatherField;
 f.context.window.HDRGpuBrushMask.generateFeatherField=async()=>{const entry=await field();f.renderer.resourceGeneration++;return entry;};
 assert.equal(await f.run(),null);assert.equal(f.made.fields[0].texture.count,1);assert.equal(f.renderer.localMasks.size,0);assert.equal(f.renderer.localMaskInflight.size,0);
 f.context.window.HDRGpuBrushMask.generateFeatherField=field;
 const region=f.context.window.HDRGpuBrushMask.generateFeatherRegion;
 f.context.window.HDRGpuBrushMask.generateFeatherRegion=async(...args)=>{const entry=await region(...args);f.renderer.resourceGeneration++;return entry;};
 assert.equal(await f.run(),null);assert.equal(f.made.regions[0].texture.count,1);assert.equal(f.renderer.localMaskInflight.size,0);
});
test('a requester that outlives a superseded field generation makes its own',async()=>{
 const f=fixture();let release,live=true;
 const field=f.context.window.HDRGpuBrushMask.generateFeatherField;
 f.context.window.HDRGpuBrushMask.generateFeatherField=async(...args)=>{
  if(f.calls.field)return field();
  f.calls.field++;await new Promise(done=>{release=done;});return args[5]()?field():null;};
 const first=f.run(()=>live),second=f.run(()=>true,{x:2000,y:1000,width:1000,height:800});
 await new Promise(done=>setImmediate(done));live=false;release();
 assert.equal(await first,null);
 assert.equal((await second).entries.get('tile').kind,'gpu-brush-native-feather');
 assert.equal(f.renderer.localMaskInflight.size,0);
});
test('a still-current requester repeats a superseded regional generation',async()=>{
 const f=fixture();let release,live=true;
 const region=f.context.window.HDRGpuBrushMask.generateFeatherRegion;
 f.context.window.HDRGpuBrushMask.generateFeatherRegion=async(...args)=>{
  if(f.calls.region)return region(...args);
  f.calls.region++;await new Promise(done=>{release=done;});return args[7]()?region(...args):null;};
 const first=f.run(()=>live),second=f.run();
 await new Promise(done=>setImmediate(done));live=false;release();
 assert.equal(await first,null);
 assert.equal((await second).entries.get('tile').kind,'gpu-brush-native-feather');
 assert.equal(f.calls.field,1);assert.equal(f.renderer.localMaskInflight.size,0);
});
test('concurrent regions share one field generation',async()=>{
 const f=fixture(),[a,b]=await Promise.all([f.run(),f.run(()=>true,{x:2000,y:1000,width:1000,height:800})]);
 assert.equal(a.entries.get('tile').field,b.entries.get('tile').field);assert.equal(f.calls.field,1);
});
test('large catch-up batches split feathered masks by tile over one field',async()=>{
 const f=fixture();f.batch.tiles=[{key:'a',haloRect:{x:0,y:0,width:1000,height:800}},{key:'b',haloRect:{x:6000,y:5000,width:1000,height:800}}];
 const result=await f.renderer.loadGpuBrushShiftRegion('session',f.batch,8000,'{}',()=>true,undefined,{width:8000,height:8000});
 assert.equal(result.entries.size,2);assert.deepEqual({...f.calls},{field:1,region:2,shift:0});
});
function zoom(f){
 const canvas={},soft=[];let warmed=0;
 f.renderer.gpuAnalyticMasksEnabled=true;f.renderer.maskSourceSize={sessionId:'session',width:4000,height:2667};
 f.renderer.renderSerials.set(canvas,1);f.renderer.softLeafMask=async(...values)=>{soft.push(values);return null;};
 f.context.window.HDRGpuBrushMask={...f.context.window.HDRGpuBrushMask,warm:()=>{warmed++;return true;}};
 const prefetch=(longEdge=4000,geometry='{}')=>{f.renderer.prefetchZoomMasks(canvas,'session',[f.batch.local],1,geometry,{viewport:{}},1,longEdge);
  return new Promise(done=>setImmediate(done));};
 return {soft,prefetch,warmed:()=>warmed};
}
test('zoom preparation starts the feather field for Shift without a bitmap qualification',async()=>{
 const f=fixture(),z=zoom(f);await z.prefetch();
 assert.equal(f.calls.field,1);assert.equal(z.soft.length,0);
 // The zoomed render then finds the field resident and only makes its region.
 await f.run();assert.deepEqual({...f.calls},{field:1,region:1,shift:0});
});
test('zoom preparation leaves Fit scales, resampling and unfeathered Shift without a field',async()=>{
 const f=fixture(),z=zoom(f);
 await z.prefetch(1600);assert.equal(f.calls.field,0);assert.equal(z.soft.length,1);
 await z.prefetch(4000,'{"straighten_angle":1}');assert.equal(f.calls.field,0);assert.equal(z.soft.length,2);
 f.mask.leaf.mask_feather=0;await z.prefetch();
 assert.equal(f.calls.field,0);assert.equal(z.warmed(),1);assert.equal(z.soft.length,2);
});
test('zoom preparation prefers a resident qualified mask, then the field for erased paint',async()=>{
 const f=fixture(),z=zoom(f),stroke={points:[{x:.4,y:.4}],radius:.1};
 f.mask.leaf.mask_shift_edge=0;f.mask.leaf.strokes=[stroke,{...stroke,erase:true}];
 await z.prefetch();assert.equal(f.calls.field,1);assert.equal(z.soft.length,0);
 const qualified={soft:true,destroyed:false};f.renderer.softMasks.get=()=>qualified;
 f.renderer.softLeafMask=async(...values)=>{z.soft.push(values);return qualified;};
 await z.prefetch();assert.equal(z.soft.length,1);assert.equal(f.calls.field,1);
});
test('zoom preparation tries qualification first for unerased paint and builds the field on refusal',async()=>{
 const f=fixture(),z=zoom(f);f.mask.leaf.mask_shift_edge=0;f.mask.leaf.strokes=[{points:[{x:.4,y:.4}],radius:.1}];
 await z.prefetch();assert.equal(z.soft.length,1);assert.equal(f.calls.field,1);
});
