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
 assert.equal(f.renderer.resamplePlan('other',f.brush(),4000,f.straighten),null);
});
test('luminance leaves and whole combinations get the same plan; one unsupported leaf refuses the mask',()=>{
 const f=fixture(),plan=mask=>f.renderer.resamplePlan('session',mask,4000,f.straighten);
 const luma={operator:'leaf',leaf:{type:'luminance_range',mask_feather:.01}};
 const gradient=leaf=>({operator:'leaf',leaf:{type:'linear_gradient',start:{x:.1,y:.2},end:{x:.8,y:.9},gradient_midpoint_1:.3,gradient_midpoint_2:.7,...leaf}});
 assert.ok(plan(luma));assert.equal(plan({...luma,enabled:false}),null);
 assert.ok(plan({operator:'union',children:[f.brush({mask_feather:.02}),luma]}));
 assert.ok(plan({operator:'subtract',inverted:true,children:[{operator:'intersect',children:[luma,gradient()]},f.brush(),{...luma,enabled:false}]}));
 assert.equal(plan({operator:'union',children:[luma,gradient({gradient_luma_enabled:true})]}),null);
 assert.equal(plan({operator:'union',children:[luma,{operator:'leaf',leaf:{type:'sampled'}}]}),null);
 assert.equal(plan({operator:'union',children:[luma]}),null,'a degenerate graph keeps the established path');
 assert.equal(plan({operator:'union',children:[luma,{...luma,enabled:false}]}),null);
 assert.equal(plan({operator:'union',enabled:false,children:[luma,f.brush()]}),null);
 assert.equal(plan({operator:'union',children:[luma,{operator:'intersect',children:[f.brush()]}]}),null);
});
function gpuStub(f){
 const passes=[],made=[];
 const texture=(width,height)=>{const t={width,height,destroyed:false,destroy(){this.destroyed=true;}};made.push(t);return t;};
 Object.assign(f.renderer,{createMaskTexture:texture,createStorageBuffer:values=>({values,destroy(){}}),
  createMaskBindGroup:(...v)=>v,encodeMaskPass:(_e,pipeline,group,target)=>passes.push({pipeline,group,target}),
  maskPipelines:{combine:'combine',qualify:'qualify'},destroyAfterActiveRenders:callback=>callback(),performanceMetrics:{}});
 f.context.GPUTextureUsage={COPY_SRC:1,COPY_DST:2,TEXTURE_BINDING:4,RENDER_ATTACHMENT:16};
 f.renderer.device={limits:{maxTextureDimension2D:8192},createShaderModule:()=>({}),createRenderPipeline:({fragment})=>fragment.entryPoint,createCommandEncoder:()=>({finish(){},copyTextureToTexture(...v){passes.push({copy:v});}}),
  createTexture:({size})=>texture(size[0],size[1]),queue:{writeBuffer(){},writeTexture(){},submit(){}}};
 return {passes,made,texture};
}
test('a combination is composed in source space in export order, one operand at a time',async()=>{
 const f=fixture(),gpu=gpuStub(f),order=[];
 const luma=(name,opacity=1)=>({operator:'leaf',leaf:{type:'luminance_range',mask_opacity:opacity,name}});
 f.renderer.gpuOrientedLumaRegion=async(_s,expression)=>{order.push(expression.leaf.name);return{texture:gpu.texture(8,8)};};
 const frame={width:4000,height:2667,geometrySignature:'{}'},rect={x:10,y:20,width:800,height:600};
 const graph={operator:'subtract',inverted:true,children:[luma('a',.7),{operator:'intersect',children:[luma('b',.5),luma('c')]},{...luma('skipped'),enabled:false},luma('d',.25)]};
 const result=await f.renderer.gpuOrientedMaskRegion('session',graph,4000,frame,rect,()=>true);
 assert.deepEqual(order,['a','b','c','d']);
 const values=gpu.passes.map(pass=>Array.from(pass.group[1].values).map(v=>Math.round(v*100)/100));
 // intersect(b,c); then a minus that; then minus d, inverted on the last operand.
 assert.deepEqual(values,[[1,.5,1,0],[2,.7,1,0],[2,1,.25,1]]);
 assert.equal(result.texture,gpu.passes.at(-1).target);assert.equal(result.texture.destroyed,false);
 assert.equal(result.width,800);assert.equal(result.height,600);
 assert.ok(gpu.made.filter(t=>t!==result.texture).every(t=>t.destroyed),'operands and intermediates are released');
 f.renderer.gpuOrientedLumaRegion=async(_s,expression)=>expression.leaf.name==='c'?null:{texture:gpu.texture(8,8)};
 gpu.made.length=0;
 assert.equal(await f.renderer.gpuOrientedMaskRegion('session',graph,4000,frame,rect,()=>true),null);
 assert.ok(gpu.made.every(t=>t.destroyed),'a refused operand releases the ones before it');
});
test('a source-space luminance leaf builds its whole feather reach on the frame grid',async()=>{
 const f=fixture(),gpu=gpuStub(f),regions=[],refined=[];
 f.renderer.orientedLuminanceRegion=async(_s,_e,_f,region)=>{regions.push(region);return gpu.texture(region.width,region.height);};
 f.renderer.refineLumaMask=(entry,plan,inverted,edge)=>{refined.push({plan,inverted,edge});entry.refinedTexture=gpu.texture(entry.width,entry.height);entry.texture=entry.refinedTexture;};
 const frame={width:4000,height:2667,geometrySignature:'{}'},rect={x:1500,y:900,width:640,height:480};
 const leaf=(feather,inverted=false)=>({operator:'leaf',inverted,leaf:{type:'luminance_range',mask_feather:feather,fade_in_start_ev:-6,full_start_ev:-3,full_end_ev:2,fade_out_end_ev:5}});
 let result=await f.renderer.gpuOrientedMaskRegion('session',leaf(.01),4000,frame,rect,()=>true);
 const region=regions[0],{plan}=refined[0],grid=plan.factor;
 assert.equal(plan.sigma,.09*.2*4000);assert.ok(grid>1);
 assert.equal(region.x%grid,0);assert.equal(region.y%grid,0);
 assert.ok(region.x<=rect.x-4*plan.sigma&&region.y<=rect.y-4*plan.sigma);
 assert.ok(region.x+region.width>=rect.x+rect.width+4*plan.sigma&&region.y+region.height>=rect.y+rect.height+4*plan.sigma);
 assert.equal(refined[0].edge,true,'a bounded interior region still takes the exact boxes');
 const crop=gpu.passes.at(-1);assert.deepEqual(Array.from(crop.group[1].values).slice(0,2),[rect.x-region.x,rect.y-region.y]);
 assert.equal(result.texture,crop.target);assert.equal(result.width,640);
 assert.ok(gpu.made.filter(t=>t!==result.texture).every(t=>t.destroyed),'luminance and scratch are released');
 // Unfeathered: exactly the rectangle, no refinement, no crop.
 regions.length=refined.length=gpu.passes.length=0;
 result=await f.renderer.gpuOrientedMaskRegion('session',leaf(0),4000,frame,rect,()=>true);
 assert.deepEqual({...regions[0]},rect);assert.equal(refined.length,0);assert.equal(gpu.passes.length,1);
 assert.equal(result.texture,gpu.passes[0].target);assert.equal(result.texture.destroyed,false);
 result=await f.renderer.gpuOrientedMaskRegion('session',leaf(0,true),4000,frame,rect,()=>true);
 assert.equal(refined[0].inverted,true);assert.equal(result.texture.destroyed,false);
 // A region at the frame corner is clipped and says so.
 regions.length=refined.length=0;
 await f.renderer.gpuOrientedMaskRegion('session',leaf(.01),4000,frame,{x:0,y:0,width:640,height:480},()=>true);
 assert.equal(regions[0].x,0);assert.equal(regions[0].y,0);assert.equal(refined[0].edge,true);
 // A reach no bounded region can hold is refused rather than truncated.
 const huge={width:9000,height:6000,geometrySignature:'{}'};regions.length=0;
 assert.equal(await f.renderer.gpuOrientedMaskRegion('session',leaf(.05),9000,huge,{x:3000,y:2000,width:2048,height:2048},()=>true),null);
 assert.equal(regions.length,0);
 f.renderer.orientedLuminanceRegion=async()=>null;
 assert.equal(await f.renderer.gpuOrientedMaskRegion('session',leaf(.01),4000,frame,rect,()=>true),null);
});
test('un-resampled luminance is fetched once per tile and assembled per rectangle',async()=>{
 const f=fixture(),gpu=gpuStub(f),fetched=[];
 f.renderer.resourceGeneration=0;f.renderer.sourceAbortSignal=()=>undefined;
 f.renderer.fetchOrientedLuminance=async(_s,_e,frame,rect)=>{fetched.push(`${rect.x},${rect.y},${rect.width},${rect.height}`);
  return{data:new ArrayBuffer(8),width:rect.width,height:rect.height,frameWidth:frame.width,frameHeight:frame.height};};
 const frame={width:5000,height:3000,geometrySignature:'{"rotation":90}'},rect={x:2000,y:1000,width:2200,height:1100};
 const [a,b]=await Promise.all([f.renderer.orientedLuminanceRegion('session',5000,frame,rect,()=>true),
  f.renderer.orientedLuminanceRegion('session',5000,frame,rect,()=>true)]);
 assert.ok(a&&b&&a!==b);
 assert.deepEqual(fetched.sort(),['0,0,2048,2048','0,2048,2048,952','2048,0,2048,2048','2048,2048,2048,952','4096,0,904,2048','4096,2048,904,952']);
 const copies=gpu.passes.filter(pass=>pass.copy).slice(0,6).map(pass=>pass.copy);
 assert.deepEqual(copies.map(([from,to,size])=>[...from.origin,...to.origin,...size].join()).sort(),
  ['2000,1000,0,0,48,1048','0,1000,48,0,2048,1048','0,1000,2096,0,104,1048','2000,0,0,1048,48,52','0,0,48,1048,2048,52','0,0,2096,1048,104,52'].sort());
 fetched.length=0;
 await f.renderer.orientedLuminanceRegion('session',5000,frame,{x:10,y:10,width:100,height:100},()=>true);
 assert.deepEqual(fetched,[],'resident tiles are not fetched again');
 assert.equal(await f.renderer.orientedLuminanceRegion('session',5000,frame,rect,()=>false),null);
 // A frame the backend sizes differently is refused, not stretched.
 f.renderer.fetchOrientedLuminance=async(_s,_e,_f,rect)=>({data:new ArrayBuffer(8),width:rect.width,height:rect.height,frameWidth:5001,frameHeight:3000});
 assert.equal(await f.renderer.orientedLuminanceRegion('other',5000,frame,rect,()=>true),null);
 f.renderer.fetchOrientedLuminance=async()=>{throw Error('offline');};
 assert.equal(await f.renderer.orientedLuminanceRegion('third',5000,frame,rect,()=>true),null);
});
test('a straightened combination is warped whole for Fit and tiles, and prepared while the zoom source is in transit',async()=>{
 const f=fixture(),luma={operator:'leaf',leaf:{type:'luminance_range',mask_feather:.01}};
 const mask={operator:'intersect',children:[f.brush({mask_feather:.02}),luma]},local={id:'a',mask};
 f.renderer.loadGpuMaskGraph=async()=>{throw Error('unexpected per-leaf composition');};
 const entry=await f.renderer.loadLocalMask('session',local,1600,1,f.straighten,()=>true,undefined,true);
 assert.equal(entry.kind,'gpu-resampled-brush');assert.equal(f.made[0][1],mask);
 const recipe=f.renderer.resamplePlan('session',mask,4000,f.straighten);
 const result=await f.renderer.loadGpuResampledRegion('session',{local,localIndex:0,tiles:[{key:'t'}]},4000,f.straighten,()=>true,undefined,
  {width:recipe.width,height:recipe.height,region:{x:800,y:600,width:1000,height:700}});
 assert.ok(result.entries.get('t'));assert.equal(f.made[1][1],mask);
 const extents=[];
 f.renderer.gpuMaskExtent=async(_s,expression)=>{extents.push(expression);return{min:0,max:255};};
 f.renderer.resourceGeneration=0;f.renderer.renderSerials=new Map([['canvas',3]]);f.renderer.sourceAbortSignal=()=>undefined;
 f.renderer.softLeafMask=async()=>{throw Error('unexpected bitmap');};
 f.renderer.prefetchZoomMasks('canvas','session',[local,{id:'b',mask:luma}],1,f.straighten,{viewport:{}},3,4000);
 assert.deepEqual(extents,[mask,luma]);
 // Without resampling geometry the established graph route is untouched.
 let graphs=0;f.renderer.loadGpuMaskGraph=async()=>{graphs++;return{kind:'gpu-mask-graph'};};
 assert.equal((await f.renderer.loadLocalMask('session',local,1600,1,'{}',()=>true,undefined,true)).kind,'gpu-mask-graph');assert.equal(graphs,1);
});
test('an index-geometry combination with a feathered brush is composed on the GPU, not sent to CPU tiles',async()=>{
 const f=fixture(),luma={operator:'leaf',leaf:{type:'luminance_range',mask_feather:.01}};
 const cropped=JSON.stringify({rotation:0,crop:{x:.25,y:.25,width:.5,height:.5}}),plain=JSON.stringify({rotation:0});
 const feathered={operator:'intersect',children:[luma,f.brush({mask_feather:.02})]},hard={operator:'union',children:[luma,f.brush()]};
 const frame=f.renderer.composedFrame('session',feathered,4000,cropped);
 assert.deepEqual({x:frame.x,y:frame.y,width:frame.width,height:frame.height},{x:1000,y:667,width:4000,height:2667});
 assert.equal(JSON.parse(frame.geometrySignature).crop.width,1);
 assert.equal(f.renderer.composedFrame('session',hard,4000,cropped),null,'the regional graph route keeps what it already serves');
 assert.equal(f.renderer.composedFrame('session',feathered,4000,f.straighten),null,'resampling geometry takes the warp');
 assert.equal(f.renderer.composedFrame('session',{operator:'union',children:[luma,luma]},4000,f.straighten),null);
 assert.equal(f.renderer.composedFrame('session',f.brush({mask_feather:.02}),4000,cropped),null);
 assert.equal(f.renderer.composedFrame('other',feathered,4000,cropped),null);
 assert.ok(f.renderer.sourceSpaceMask('session',feathered,4000,cropped)&&f.renderer.sourceSpaceMask('session',feathered,4000,f.straighten));
 assert.equal(f.renderer.sourceSpaceMask('session',hard,4000,cropped),false);
 const regions=[];f.renderer.localMaskInflight=new Map();f.renderer.resourceGeneration=0;f.renderer.performanceMetrics={};
 f.renderer.gpuOrientedMaskRegion=async(_s,_m,_e,made,rect)=>{regions.push({made,rect});return{texture:{destroy(){}}};};
 f.context.window.HDRMaskTileBatch=undefined;
 const batch={local:{id:'a',mask:feathered},localIndex:1,tiles:[{key:'t'}]},proxy={width:2000,height:1333,region:{x:300,y:200,width:900,height:700}};
 const result=await f.renderer.loadLocalMaskTiles('session',batch,4000,1,cropped,()=>true,undefined,proxy);
 const entry=result.entries.get('t');assert.equal(entry.kind,'gpu-composed-graph');assert.equal(entry.wholeFrame,true);
 assert.deepEqual({...regions[0].rect},{x:1300,y:867,width:900,height:700});
 assert.deepEqual(Array.from(entry.frameRect),[300/2000,200/1333,900/2000,700/1333]);
 assert.equal((await f.renderer.loadLocalMaskTiles('session',batch,4000,1,cropped,()=>true,undefined,proxy)).entries.get('t'),entry,'a resident region is reused');
 assert.equal(regions.length,1);
 assert.equal(await f.renderer.loadGpuComposedRegion('session',batch,4000,cropped,()=>true,undefined,{...proxy,width:1999}),null,'a picture of another size keeps the fallback');
 const extents=[],bitmaps=[];
 f.renderer.renderSerials=new Map([['canvas',3]]);f.renderer.sourceAbortSignal=()=>undefined;
 f.renderer.softLeafMask=async(_s,local)=>{bitmaps.push(local.id);return null;};
 const gradient={operator:'leaf',leaf:{type:'linear_gradient',start:{x:.1,y:.2},end:{x:.8,y:.9},gradient_midpoint_1:.3,gradient_midpoint_2:.7}};
 f.renderer.prefetchZoomMasks('canvas','session',[{id:'gradient',mask:gradient},{id:'hard',mask:f.brush()}],1,cropped,{viewport:{}},3,4000);
 assert.deepEqual(bitmaps,[],'a cropped analytic leaf is rastered per region and prefetches no bitmap');
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
test('a region its producer refuses is warped tile by tile instead of falling back to CPU tiles',async()=>{
 // A wide Shift halo around a large view exceeds the scratch cap as one
 // region; each tile's halo fits.
 const f=fixture(),mask=f.brush({mask_shift_edge:.019}),recipe=f.renderer.resamplePlan('session',mask,4000,f.straighten);
 const calls=[];
 const tiles=[0,1,2,3].flatMap(column=>[0,1].map(row=>({key:`${column},${row}`,haloRect:{x:800+column*250,y:600+row*250,width:300,height:300}})));
 const proxy={width:recipe.width,height:recipe.height,region:{x:800,y:600,width:1050,height:550}};
 f.renderer.loadGpuResampledMask=async(...values)=>{calls.push({...values[5]});return values[5].width>600?null:{kind:'gpu-resampled-brush',texture:{},rect:values[5]};};
 const result=await f.renderer.loadGpuResampledRegion('session',{local:{id:'a',mask},localIndex:0,tiles},4000,f.straighten,()=>true,undefined,proxy);
 assert.equal(result.entries.size,8);
 // The whole region is refused; two halves of two columns each are accepted.
 assert.deepEqual(calls.map(rect=>[rect.x,rect.y,rect.width,rect.height].join()),['800,600,1050,550','800,600,550,550','1300,600,550,550']);
 assert.equal(result.entries.get('0,0'),result.entries.get('1,1'),'tiles of one half share its mask');
 assert.notEqual(result.entries.get('1,1'),result.entries.get('2,0'));
 assert.deepEqual(Array.from(result.entries.get('3,1').frameRect),[1300/recipe.width,600/recipe.height,550/recipe.width,550/recipe.height]);
 assert.equal(await f.renderer.loadGpuResampledRegion('session',{local:{id:'a',mask},localIndex:0,tiles:[{key:'only'}]},4000,f.straighten,()=>true,undefined,proxy),null,'a single refused region keeps the fallback');
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
