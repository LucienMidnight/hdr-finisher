const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
function fixture(){
 const context=vm.createContext({window:{},performance:{now:()=>0},console,setTimeout,clearTimeout,setInterval,clearInterval});
 for(const file of ['mask-raster.js','gpu-brush-mask.js','geometry-resample.js','gpu-mask-resample.js','webgpu-shaders.js','webgpu-preview.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend',file),'utf8'),context);
 const renderer=new context.window.HDRWebGPUPreview(null);
 renderer.device={limits:{maxTextureDimension2D:8192}};renderer.retainLocalMask=()=>{};renderer.gpuAnalyticMasksEnabled=true;
 renderer.maskSourceSize={sessionId:'session',width:4000,height:2667};
 const stroke={points:[{x:.3,y:.4},{x:.6,y:.5}],radius:.05};
 const brush=(leaf={})=>({operator:'leaf',leaf:{type:'brush',mask_feather:0,mask_shift_edge:0,strokes:[stroke],...leaf}});
 const straighten=JSON.stringify({rotation:0,straighten_angle:2,crop:{x:0,y:0,width:1,height:1}});
 const made=[];
 renderer.loadGpuResampledMask=async(...values)=>{const entry={kind:'gpu-resampled-brush',rect:values[5],texture:{}};made.push(values);return entry;};
 return {context,renderer,brush,straighten,made,resample:context.window.HDRGpuMaskResample,planner:context.window.HDRGeometryResample};
}
test('only straighten and perspective leaves get a resampling plan',()=>{
 const f=fixture(),plan=(mask,signature=f.straighten)=>f.renderer.resamplePlan('session',mask,4000,signature);
 const recipe=plan(f.brush({mask_feather:.02,mask_shift_edge:.005}));
 assert.ok(recipe);assert.equal(recipe.frame.width,4000);assert.equal(recipe.frame.height,2667);
 assert.equal(JSON.parse(recipe.frame.geometrySignature).straighten_angle,undefined);
 assert.equal(plan(f.brush()).coefficients,plan(f.brush()).coefficients,'plans are remembered');
 assert.ok(plan({operator:'leaf',leaf:{type:'path',nodes:[{x:.1,y:.1},{x:.9,y:.2},{x:.5,y:.8}]}}));
 assert.ok(plan(f.brush(),JSON.stringify({perspective_vertical:15})));
 assert.equal(plan(f.brush(),'{}'),null);assert.equal(plan(f.brush(),JSON.stringify({rotation:90,flip_horizontal:true})),null);
 assert.equal(plan({operator:'leaf',leaf:{type:'luminance_range'}}),null);
 assert.equal(plan({operator:'union',children:[f.brush(),f.brush()]}),null);
 assert.equal(f.renderer.resamplePlan('other',f.brush(),4000,f.straighten),null);
});
test('the source rectangle carries the bicubic reach and the shader terms reproduce the plan',()=>{
 const f=fixture(),recipe=f.renderer.resamplePlan('session',f.brush(),4000,JSON.stringify({perspective_horizontal:12,perspective_vertical:-9,straighten_angle:3}));
 const rect={x:900,y:500,width:1280,height:720},source=f.resample.sourceRect(recipe,rect);
 const p=f.resample.parameters(recipe,rect,source,{min:3,max:240});
 assert.equal(p[9],3);assert.equal(p[10],240);
 for(const [x,y] of [[0,0],[1279,0],[0,719],[1279,719],[640,360],[17,703]]){
  const [sx,sy]=f.planner.sample(recipe,rect.x+x,rect.y+y),ax=x+.5,ay=y+.5,divisor=p[6]*ax+p[7]*ay+p[8];
  const lx=(p[0]*ax+p[1]*ay+p[2])/divisor,ly=(p[3]*ax+p[4]*ay+p[5])/divisor;
  assert.ok(Math.abs(lx-(sx-source.x))<2e-3&&Math.abs(ly-(sy-source.y))<2e-3,`${lx} ${sx-source.x}`);
  assert.ok(lx-.5>=1&&ly-.5>=1&&lx+2.5<=source.width&&ly+2.5<=source.height,'every tap lies inside the source texture');
 }
 const edge=f.resample.sourceRect(recipe,{x:0,y:0,width:recipe.width,height:recipe.height});
 assert.ok(edge.x>=0&&edge.y>=0&&edge.x+edge.width<=recipe.orientedWidth&&edge.y+edge.height<=recipe.orientedHeight);
});
test('a tiled straightened picture takes one bounded resampled mask with exact placement',async()=>{
 const f=fixture(),mask=f.brush({mask_feather:.02}),recipe=f.renderer.resamplePlan('session',mask,4000,f.straighten);
 const batch={local:{id:'a',mask},localIndex:2,tiles:[{key:'t'}]},proxy={width:recipe.width,height:recipe.height,region:{x:800,y:600,width:1000,height:700}};
 const result=await f.renderer.loadGpuResampledRegion('session',batch,4000,f.straighten,()=>true,undefined,proxy);
 const entry=result.entries.get('t');assert.equal(result.localIndex,2);assert.equal(entry.wholeFrame,true);
 assert.deepEqual(Array.from(entry.frameRect),[800/recipe.width,600/recipe.height,1000/recipe.width,700/recipe.height]);
 assert.deepEqual({...f.made[0][5]},proxy.region);
 assert.equal(await f.renderer.loadGpuResampledRegion('session',batch,4000,f.straighten,()=>true,undefined,{...proxy,width:proxy.width-1}),null,'a picture of another size keeps the fallback');
 assert.equal(await f.renderer.loadGpuResampledRegion('session',batch,4000,'{}',()=>true,undefined,proxy),null);
 assert.equal(await f.renderer.loadGpuResampledRegion('session',batch,4000,f.straighten,()=>false,undefined,proxy),null);
});
test('a whole-picture catch-up splits resampled masks by tile',async()=>{
 const f=fixture();f.renderer.maskSourceSize={sessionId:'session',width:8000,height:6000};
 const mask=f.brush(),recipe=f.renderer.resamplePlan('session',mask,8000,f.straighten);
 const batch={local:{id:'a',mask},localIndex:0,tiles:[{key:'a',haloRect:{x:0,y:0,width:1000,height:800}},{key:'b',haloRect:{x:6000,y:4500,width:1000,height:800}}]};
 const result=await f.renderer.loadGpuResampledRegion('session',batch,8000,f.straighten,()=>true,undefined,{width:recipe.width,height:recipe.height});
 assert.equal(result.entries.size,2);assert.equal(f.made.length,2);
});
test('straightened Fit, scope and measurement leaves use the whole-frame resampled mask before any other route',async()=>{
 const f=fixture(),mask=f.brush({mask_feather:.02});
 f.renderer.loadCpuLeafAt=async()=>{throw Error('unexpected CPU mask');};
 const entry=await f.renderer.loadMaskLeaf('session',{id:'a',mask},mask,'',1600,1,f.straighten,()=>true,undefined,true,false);
 assert.equal(entry.kind,'gpu-resampled-brush');
 const recipe=f.made[0][4];assert.deepEqual({...f.made[0][5]},{x:0,y:0,width:recipe.width,height:recipe.height});
});
test('the oriented source mask comes from the native producers and refuses what they cannot hold',async()=>{
 const f=fixture(),helper=f.context.window.HDRGpuBrushMask,calls=[];
 f.context.window.HDRGpuBrushMask={...helper,
  generateFeatherRegion:async(...v)=>{calls.push('feather');return{texture:{},field:v[6]};},
  generateShiftRegion:async()=>{calls.push('shift');return{texture:{}};}};
 f.renderer.loadGpuBrushFeatherField=async()=>{calls.push('field');return{texture:{}};};
 const frame={width:4000,height:2667,geometrySignature:'{"rotation":0,"flip_horizontal":false,"flip_vertical":false}'},rect={x:100,y:100,width:800,height:600};
 const region=mask=>f.renderer.gpuOrientedMaskRegion('session',mask,4000,frame,rect,()=>true);
 assert.ok(await region(f.brush({mask_feather:.02,mask_shift_edge:.005})));assert.deepEqual(calls.splice(0),['field','feather']);
 assert.ok(await region(f.brush({mask_shift_edge:.005})));assert.deepEqual(calls.splice(0),['shift']);
 const large={...frame,width:8000,height:6000};
 assert.equal(await f.renderer.gpuOrientedMaskRegion('session',f.brush({mask_shift_edge:.05}),8000,large,{x:2000,y:1000,width:4000,height:4000},()=>true),null,'a Shift halo beyond the scratch cap is refused, not rastered unshifted');
 assert.deepEqual(calls.splice(0),[]);
 assert.equal(await f.renderer.gpuOrientedMaskRegion('session',f.brush(),4000,frame,{x:0,y:0,width:9000,height:10},()=>true),null);
 assert.equal(await f.renderer.gpuOrientedMaskRegion('session',f.brush(),4000,frame,rect,()=>false),null);
});
test('a Fit bitmap made at the requested scale serves measurements without a CPU mask',async()=>{
 const f=fixture(),mask=f.brush({mask_feather:.02}),edges=[];
 f.renderer.loadGpuBrushLeaf=async(_s,_l,_m,_p,edge)=>{edges.push(edge);return{soft:false,longEdge:edge,kind:'gpu-brush-feather'};};
 f.renderer.loadGpuAnalyticLeaf=()=>null;f.renderer.loadCpuLeafAt=async()=>{throw Error('unexpected CPU mask');};
 const entry=await f.renderer.loadMaskLeaf('session',{id:'a',mask},mask,'',1600,1,'{}',()=>true,undefined,true,false);
 assert.equal(entry.longEdge,1600);assert.deepEqual(edges,[512,1024,1600]);
});
