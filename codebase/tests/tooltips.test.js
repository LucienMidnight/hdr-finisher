const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');

function setup(text){
  const events={},timers=new Map();let sequence=0;
  class Element {
    constructor(){this.dataset={};this.childNodes=[];this.nodeType=1;this.isConnected=true;this.classList={remove(){},add(){}};this.style={};}
    matches(selector){return selector===':popover-open'&&this.open;}
    closest(){return this;}
    contains(){return false;}
    querySelector(){return null;}
    querySelectorAll(){return [];}
    getAttribute(){return null;}
    setAttribute(){}
    removeAttribute(){}
    hasAttribute(){return false;}
    getClientRects(){return [{}];}
    getBoundingClientRect(){return {left:20,right:60,top:20,bottom:40,width:40,height:20};}
    showPopover(){this.open=true;}
    hidePopover(){this.open=false;}
  }
  const tooltip=new Element(),trigger=new Element();trigger.dataset.tooltip=text;
  const document={readyState:'complete',body:{append(){}},documentElement:new Element(),createElement:()=>tooltip,getElementById:()=>null,addEventListener:(name,fn)=>events[name]=fn};
  const context={window:{addEventListener(){}},document,Element,MutationObserver:class{observe(){}},performance,innerWidth:1000,innerHeight:700,
    getComputedStyle:()=>({fontSize:'12px'}),setTimeout:fn=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync('frontend/tooltips.js','utf8'),context);
  const escape=()=>{const event={key:'Escape',preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};events.keydown(event);return event;};
  return {hover:()=>events.pointerover({target:trigger}),escape,tooltip,timers};
}
test('Escape cancels pending help but still reaches the dialog',()=>{
  const help=setup('Explains the action');help.hover();assert.equal(help.timers.size,1);
  const event=help.escape();assert.equal(help.timers.size,0);assert.equal(event.prevented,undefined);assert.equal(event.stopped,undefined);assert.equal(help.tooltip.hidden,true);
});
test('empty help never starts a timer or intercepts dialog Escape',()=>{
  const help=setup('');help.hover();assert.equal(help.timers.size,0);assert.equal(help.escape().prevented,undefined);
});
test('Escape consumes the key only when help is actually visible',()=>{
  const help=setup('Explains the action');help.hover();[...help.timers.values()][0]();assert.equal(help.tooltip.hidden,false);
  const event=help.escape();assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(help.tooltip.hidden,true);
});
