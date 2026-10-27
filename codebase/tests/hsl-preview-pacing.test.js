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

