const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const HDRHSL=require('../frontend/hsl-engine.js');
function context(){const c=vm.createContext({HDRHSL});for(const name of ['adjustment-controls.js','range-controls.js','hsl-panel.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend',name),'utf8'),c);return c;}
test('edited status ignores object key order and default roundoff but preserves real changes and array order',()=>{
 const c=context();assert.equal(vm.runInContext('valuesEqual({a:1,b:{hue:27.567096839175015}},{b:{hue:27.567096839175008},a:1})',c),true);
 assert.equal(vm.runInContext('valuesEqual({hue:27},{hue:27.01})',c),false);
 assert.equal(vm.runInContext('valuesEqual([1,2],[2,1])',c),false);
 assert.equal(vm.runInContext('valuesEqual({a:1},{a:1,b:2})',c),false);
});
test('print exposure shows small changes in signed stops',()=>{
 const c=context();for(const [v,text] of [[0,'0.00 EV'],[.14,'+0.14 EV'],[-.03,'-0.03 EV']])assert.equal(vm.runInContext(`formatControlValue('current.film_look.print_exposure',${v})`,c),text);
});
test('HSL primary directions match grading hues and wheel dragging round-trips',()=>{
 const c=context();for(const [i,rgb] of [[1,0,0],[1,1,0],[0,1,0],[0,1,1],[0,0,1],[1,0,1]].entries()){
  const lab=HDRHSL.toLab(rgb),h=HDRHSL.wrap(Math.atan2(lab[2],lab[1])*180/Math.PI);c.hue=h;
  assert(Math.abs(vm.runInContext('hslWheelAngle(hue)',c)-(210+i*60))<1e-9);
 }
 for(let h=0;h<360;h+=3){c.hue=h;assert(Math.abs(HDRHSL.delta(vm.runInContext('hslWheelHue(hslWheelAngle(hue))',c),h))<1e-9);}
});

test('a readout populated after binding accepts a typed percentage without clamping it to maximum',()=>{
 const listeners={};
 const slider={value:'0.5',min:'0',max:'1',step:'0.01',disabled:false,dispatchEvent(){}};
 const row={querySelectorAll:()=>[slider],querySelector:()=>({textContent:'Amount'})};
 const output={textContent:'',dataset:{},classList:{add(){},remove(){}},closest:()=>row,
  setAttribute(){},removeAttribute(){},focus(){},addEventListener:(name,fn)=>{listeners[name]=fn;}};
 const c=context();Object.assign(c,{state:{session:{}},clamp:(v,lo,hi)=>Math.min(hi,Math.max(lo,v)),
  document:{createRange:()=>({selectNodeContents(){}})},
  window:{getSelection:()=>({removeAllRanges(){},addRange(){}}),setTimeout(){}},
  requestAnimationFrame:fn=>fn(),Event:class{},root:{querySelectorAll:()=>[output]}});
 vm.runInContext('bindSliderReadouts(root)',c);
 output.textContent='50%';
 listeners.dblclick({preventDefault(){}});
 assert.equal(output.textContent,'50');
 output.textContent='70';listeners.keydown({key:'Enter',preventDefault(){}});
 assert.equal(slider.value,'0.7');
 output.textContent='70%';listeners.dblclick({preventDefault(){}});
 output.textContent='30';listeners.keydown({key:'Enter',preventDefault(){}});
 assert.equal(slider.value,'0.3');
});

test('Grade readout sync updates only changed labels, including replacement controls', () => {
 const c=context(), writes=[];
 const field=(key,value)=>{
  let text=value;
  return {dataset:{valuePath:key},get textContent(){return text;},set textContent(next){text=next;writes.push([key,next]);}};
 };
 const control=(key,value)=>{
  let aria=value;
  return {getAttribute:()=>aria,setAttribute:(_name,next)=>{aria=next;writes.push([key,next]);}};
 };
 const exposure=field('exposure','0'), contrast=field('contrast','10'), typed=field('typed','15');
 typed.dataset.editing='true';
 const controls={exposure:control('exposure aria','0'),contrast:control('contrast aria',null),typed:control('typed aria','20')};
 Object.assign(c,{els:{valueOutputs:[exposure,contrast,typed]},state:{adjustments:{exposure:1,contrast:10,typed:20}},
  getValueByPath:(adjustments,key)=>adjustments[key], formatControlValue:(_key,value)=>String(value),
  syncTintPurityVisuals(){},
  document:{querySelector:selector=>controls[selector.match(/"([^"]+)"/)[1]]},
 });
 c.updateControlReadouts();
 assert.deepEqual(writes,[['exposure','1'],['exposure aria','1'],['contrast aria','10']]);
 assert.equal(typed.textContent,'15');
 writes.length=0;
 c.updateControlReadouts();
 assert.deepEqual(writes,[]);
});

test('Tone inputs update readouts and preview immediately but paint the affected highlight graph once', () => {
 const c=context(), frames=new Map(), readouts=[], previews=[], graphs=[];
 let frame=0;
 const adjustments={hdr:{exposure:0},sdr:{exposure:0}};
 const noOp=()=>{};
 Object.assign(c,{
  state:{adjustments,currentView:'hdr'},
  els:{controlRows:[],viewButtons:[],sectionBypasses:[],gradeModifiedSummary:{},curveGroupState:{},
   curveReset:{closest:()=>null},highlightCompressionGraph:{},sdrHighlightCompressionGraph:{}},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  controlGroups:{},defaultAdjustments:()=>({hdr:{exposure:0},sdr:{exposure:0}}),
  setValueByPath:(_adjustments,path,value)=>{const [lane,key]=path.split('.');adjustments[lane][key]=value;},
  syncRangeControlFromState:noOp,updateControlReadouts:()=>readouts.push(adjustments.hdr.exposure),
  syncHighlightCompressionMinimum:noOp,syncHighlightCompressionSourcePeak:noOp,syncSdrHighlightCompressionSourcePeak:noOp,
  invalidatePreview:lane=>previews.push(adjustments[lane].exposure),debouncePreview:noOp,
  requestAnimationFrame:cb=>{frames.set(++frame,cb);return frame;},
  cancelAnimationFrame:id=>frames.delete(id),
  renderHighlightCompressionControls:()=>graphs.push(['hdr',adjustments.hdr.exposure]),
  renderSdrHighlightCompressionControls:()=>graphs.push(['sdr',adjustments.sdr.exposure]),
  renderHslPanels:noOp,renderFilmGrainChroma:noOp,renderFilmStockControls:noOp,renderFilmStockDots:noOp,
  renderGeometryResetState:noOp,laneCurvesModified:()=>false,syncDesktopDocumentState:noOp,
 });
 c.commitAdjustmentValue('hdr.exposure',.1,{deferToneUi:true});
 c.commitAdjustmentValue('hdr.exposure',.2,{deferToneUi:true});
 assert.deepEqual(readouts,[.1,.2]);
 assert.deepEqual(previews,[.1,.2]);
 assert.deepEqual(graphs,[]);
 assert.equal(frames.size,1);
 frames.values().next().value();
 assert.deepEqual(graphs,[['hdr',.2]]);
 c.commitAdjustmentValue('hdr.exposure',.3,{deferToneUi:true});
 c.flushToneControlState();
 assert.deepEqual(graphs,[['hdr',.2],['hdr',.3]]);
 assert.equal(frames.size,0);
});
