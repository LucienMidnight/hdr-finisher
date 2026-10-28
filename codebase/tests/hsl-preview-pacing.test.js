const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {declarations}=require('./frontend-source.js');
const HDRHSL=require('../frontend/hsl-engine.js');
const {HDRMaskExpression}=require('../frontend/mask-expression.js');
function setup(){
 const state={previewScheduler:{interacting:true},adjustments:{hdr:{hsl:HDRHSL.defaultSettings()},sdr:{hsl:HDRHSL.defaultSettings()},shared:{}},denoise:{},previewGeneration:{hdr:0,sdr:0}};
 const locals=[];let preserved;
 const context={state,HDRHSL,HDRMaskExpression,localAdjustments:()=>locals,markGlobalEditDirty(){},window:{},renderCompareStatus(){},updateExportAvailability(){},renderViewerStatus(){}};
 vm.createContext(context);vm.runInContext(declarations('pacedPreviewInteraction','invalidatePreview'),context);
 state.renderCoordinator={noteEdit:(_lane,options)=>{preserved=options.preserveInteractive;},generation:()=>1};
 return {state,locals,active:lane=>context.pacedPreviewInteraction(lane),invalidate:()=>{context.invalidatePreview('hdr');return preserved;}};
}
test('Global HSL exact drag frames finish across newer slider inputs, only while enabled',()=>{
 const t=setup(),r=t.state.adjustments.hdr.hsl.channels[0].recipe;r.luminance=.8;
 assert.equal(t.active('hdr'),true);assert.equal(t.invalidate(),true);
 assert.equal(t.active('sdr'),false);
 t.state.adjustments.hdr.hsl_section_enabled=false;assert.equal(t.invalidate(),false);
 t.state.adjustments.hdr.hsl_section_enabled=true;t.state.previewScheduler.interacting=false;assert.equal(t.invalidate(),false);
});
test('Local hue leaves, including combinations, pace without preserving bypassed locals',()=>{
 const t=setup(),leaf=HDRMaskExpression.createExpression('hue_range',()=> 'hue');
 t.locals.push({enabled:true,mask:{operator:'union',children:[leaf]}});
 assert.equal(t.active('hdr'),true);assert.equal(t.invalidate(),true);
 t.locals[0].enabled=false;assert.equal(t.invalidate(),false);
 t.locals[0].enabled=true;t.state.adjustments.shared.local_adjustments_enabled=false;assert.equal(t.invalidate(),false);
});
test('neutral HSL does not opt ordinary editing in; Denoise keeps its existing pacing',()=>{
 const t=setup();assert.equal(t.invalidate(),false);
 t.state.denoise.hdr={enabled:true};assert.equal(t.invalidate(),true);
 t.state.previewScheduler.interacting=false;assert.equal(t.invalidate(),false);
});

// Execute the actual Local-mask adapter with a fake leaf producer. The crop
// must contain all requested tiles plus the selection's full neighbourhood.
test('resident Local hue crop covers tile halos plus selection reach and clamps at frame edges',async()=>{
 const {frontendSource}=require('./frontend-source.js');
 const {HslSelectionGpu}=require('../frontend/hsl-selection-gpu.js');
 const c=vm.createContext({window:{},HDRHslSelectionGpu:HslSelectionGpu,performance:{now:()=>0}});
 for(const f of ['mask-request-coordinator.js','graph-scale.js','mask-loader.js','webgpu-shaders.js','webgpu-preview.js'])vm.runInContext(frontendSource(f),c);
 const p=new c.window.HDRWebGPUPreview(null),leaf={type:'hue_range',hue_center:109,edge:3,edge_feather:8};
 const mask={operator:'leaf',leaf},proxy={width:6000,height:4000},hue={params:new Float32Array(require('../frontend/gpu-param-layout.js').HDRGpuParamLayout.count)};
 let crop;p.loadGpuHueLeaf=async(...args)=>{crop=args[7];return {};};
 const tiles=[{key:'a',haloRect:{x:1200,y:1400,width:512,height:512}},{key:'b',haloRect:{x:1712,y:1400,width:512,height:512}}];
 const invoke=()=>p.loadLocalMaskTiles('s',{local:{mask},tiles},6000,1,'g',()=>true,null,proxy,null,hue);
 await invoke();const reach=HslSelectionGpu.geometry(1,{edge:8,edge_feather:16}).reach;
 assert.deepEqual(JSON.parse(JSON.stringify(crop)),{x:1200-reach,y:1400-reach,width:1024+2*reach,height:512+2*reach});
 const firstCrop=JSON.stringify(crop);leaf.edge=-8;leaf.edge_feather=16;await invoke();assert.equal(JSON.stringify(crop),firstCrop);
 tiles[0].haloRect={x:0,y:0,width:6000,height:4000};await invoke();assert.equal(crop,null);
 proxy.region={x:100,y:200};proxy.textureWidth=3000;proxy.textureHeight=2000;
 tiles[0].haloRect={x:1200,y:1400,width:512,height:512};await invoke();
 assert.deepEqual(JSON.parse(JSON.stringify(crop)),{x:1200-reach,y:1400-reach,width:1024+2*reach,height:512+2*reach});
});
