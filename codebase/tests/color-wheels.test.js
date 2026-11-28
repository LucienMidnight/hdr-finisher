const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function harness(lane='sdr') {
  class Node {
    constructor(){this.children=[];this.dataset={};this.style={};this.events={};this.classList={add(){},toggle(){}};}
    setAttribute(){} append(node){this.children.push(node);} prepend(){} addEventListener(name,fn){this.events[name]=fn;}
    setPointerCapture(){this.captured=true;} hasPointerCapture(){return this.captured;}
  }
  const panels=['shadows','midtones','highlights'].map(name=>{
    const node=new Node();node.dataset.wheel=name;node.puck=new Node();
    node.fields={hue:{},saturation:{}};
    node.querySelectorAll=()=>[];
    node.querySelector=selector=>selector==='.color-wheel-puck'?node.puck:node.fields[selector.match(/\.(hue|saturation)"\]/)?.[1]];
    node.puck.closest=()=>node.puck;
    node.puck.getBoundingClientRect=()=>({left:parseFloat(node.puck.style.left)*2-5,top:parseFloat(node.puck.style.top)*2-5,width:10,height:10});
    node.pad=new Node();node.pad.closest=()=>node;node.pad.getBoundingClientRect=()=>({left:0,top:0,width:200,height:200});
    return node;
  });
  const host=new Node();host.querySelector=selector=>panels.find(p=>selector.includes(p.dataset.wheel));
  const grading={};panels.forEach(p=>grading[p.dataset.wheel]={hue:123,saturation:40,luminance_ev:.2});
  const frames=new Map(),interactions=[];
  const state={currentView:lane,adjustments:{[lane]:{color_grading:grading}},previewScheduler:{
    beginInteraction(){interactions.push('begin');},endInteraction(){interactions.push('end');}}};
  let writes=0,frame=0,fullSyncs=0;
  const context={state,Math,document:{createElement:()=>new Node(),createElementNS:()=>new Node(),
    querySelector:s=>s==='.grading-wheels'?host:null,
    querySelectorAll:s=>s==='.grading-wheel'?panels:s==='.color-wheel-pad'?panels.map(p=>p.pad):[]},
    setValueByPath:(obj,path,value)=>{const keys=path.replace('current',lane).split('.');let parent=obj;for(const k of keys.slice(0,-1))parent=parent[k];parent[keys.at(-1)]=value;writes++;},
    requestAnimationFrame:cb=>{frames.set(++frame,cb);return frame;},
    cancelAnimationFrame:id=>frames.delete(id),
    syncControlsFromState(){fullSyncs++;context.renderColorWheels();},invalidatePreview(){},debouncePreview(){}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../frontend/color-wheels.js'),'utf8'),context);
  context.bindColorWheels();context.renderColorWheels();
  return {panels,grading,writes:()=>writes,fullSyncs:()=>fullSyncs,frames,interactions};
}
for(const lane of ['hdr','sdr']) test(`${lane}: stationary puck is exact; pad input and drawing share radius`,()=>{
  const h=harness(lane),{pad,puck}=h.panels[0],before=JSON.stringify(h.grading);
  const r=puck.getBoundingClientRect();
  // Grab near the edge of the puck, as a person usually does.
  const event={button:0,pointerId:1,clientX:r.left+8,clientY:r.top+3,target:puck};
  pad.events.pointerdown(event);pad.events.pointermove(event);
  assert.equal(JSON.stringify(h.grading),before);assert.equal(h.writes(),0);
  pad.events.pointermove({...event,clientX:event.clientX+.5});
  pad.events.pointermove({...event,clientX:event.clientX+1});
  assert.equal(h.frames.size,1);
  assert.equal(h.writes(),0);
  h.frames.values().next().value();
  assert.equal(h.writes(),2);
  const expectedRadius=Math.hypot(r.left+6-100,r.top+5-100)/90*100;
  assert.ok(Math.abs(h.grading.shadows.saturation-expectedRadius)<1e-12);
  pad.events.pointermove({...event,clientX:event.clientX+2});
  pad.events.pointerup(event);
  pad.events.lostpointercapture(event);
  const finalRadius=Math.hypot(r.left+7-100,r.top+5-100)/90*100;
  assert.equal(h.frames.size,0);
  assert.equal(h.writes(),4);
  assert.ok(Math.abs(h.grading.shadows.saturation-finalRadius)<1e-12);
  assert.equal(h.panels[0].fields.saturation.value,String(Math.round(finalRadius)));
  assert.equal(h.panels[1].fields.saturation.value,undefined);
  assert.equal(h.fullSyncs(),0);
  assert.deepEqual(h.interactions,['begin','end']);
  // Clicking the drawn 40% location on the pad also retains 40% saturation.
  pad.events.pointerdown({...event,clientX:r.left+5,clientY:r.top+5,target:{closest:()=>null}});
  assert.ok(Math.abs(h.grading.shadows.saturation-40)<1e-12);
  assert.ok(Math.abs(h.grading.shadows.hue-123)<1e-12);
});
