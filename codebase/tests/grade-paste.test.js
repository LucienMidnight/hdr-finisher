const {test} = require('node:test');
const assert = require('node:assert/strict');
const {selectionModel} = require('../frontend/grade-paste.js');
const groups = [
  {id:'hdr-tone',lane:'hdr',settings:[{id:'hdr.exposure',modified:true},{id:'hdr.contrast',modified:false}]},
  {id:'sdr-colour',lane:'sdr',settings:[{id:'sdr.saturation',modified:true}]},
  {id:'geometry',settings:[{id:'shared.geometry',modified:true}]}
];
test('paste selection preserves partial choices and inactive lane values', () => {
  const model = selectionModel(groups,{lanes:['hdr'],settings:['hdr.exposure','sdr.saturation','unknown']});
  assert.deepEqual(model.value(),{lanes:['hdr'],settings:['hdr.exposure','sdr.saturation']});
  assert.deepEqual(model.active().map(g=>g.id),['hdr-tone']);
  model.toggleLane('sdr',true); assert.deepEqual(model.active().map(g=>g.id),['hdr-tone','sdr-colour']);
  model.toggle('hdr.contrast',true); model.toggle('hdr.exposure',false);
  assert.deepEqual(model.value().settings,['hdr.contrast','sdr.saturation']);
});
test('quick paste choices select results from per-setting modifications', () => {
  const model=selectionModel(groups,{lanes:['hdr','sdr'],settings:[]});
  model.choose('modified'); assert.deepEqual(model.value().settings,['hdr.exposure','sdr.saturation','shared.geometry']);
  model.choose('none'); assert.deepEqual(model.active(),[]);
  model.choose('all'); assert.equal(model.value().settings.length,4);
});

test('copy failure is reported through the Library status message', async () => {
  const {create} = require('../frontend/grade-paste.js');
  const messages = [];
  const paste = create({api: async () => { throw new Error('Copy failed'); }, status: message => messages.push(message)});
  await paste.copy('photo.png');
  assert.equal(paste.available(), false);
  assert.deepEqual(messages, ['Could not copy grade: Copy failed']);
});

function dialogHarness(api) {
  const vm = require('node:vm'), fs = require('node:fs');
  const nodes = [];
  class Element {
    constructor(tag, cls, text) { this.tag=tag; this.className=cls; this.textContent=text; this.children=[]; this.events={}; this.dataset={}; this.isConnected=true; nodes.push(this); }
    append(...children) { this.children.push(...children); }
    setAttribute() {}
    addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
    fire(name) { for (const callback of this.events[name] || []) callback({preventDefault(){},stopPropagation(){}}); }
    close() { this.fire('close'); }
    remove() { this.isConnected=false; }
    focus() {}
    showModal() {}
  }
  const timers = new Map(); let sequence=0;
  const window = {HDRLibraryDialogs:{make:(...args)=>new Element(...args)},addEventListener(){},removeEventListener(){}};
  const context = {window, document:{body:new Element('body')},setTimeout:callback=>{timers.set(++sequence,callback);return sequence;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/grade-paste.js'),'utf8'),context);
  const controller=window.HDRGradePaste.create({api,status(){},prepare:async()=>true});
  return {nodes, timers, controller};
}
const clipboard = {name:'source',groups:[{id:'tone',label:'Tone',section:'Tone',lane:'hdr',settings:[{id:'exposure',label:'Exposure'}]}],selection:{lanes:['hdr'],settings:['exposure']}};

test('closing the picker cancels pending checks; cold photos remain available to confirm', async () => {
  const requests=[];
  const {nodes,timers,controller}=dialogHarness(async (url,body)=>{requests.push({url,body});return {count:0,unchecked:2};});
  const answer=controller.dialog(clipboard,['one','two'],false);
  await [...timers.values()][0]();
  const yes=nodes.find(node=>node.className==='button-primary');
  assert.equal(yes.disabled,false);
  assert.ok(nodes.some(node=>String(node.textContent).includes('checked after you confirm')));
  nodes.find(node=>node.textContent==='Cancel').fire('click');
  assert.equal(await answer,null);
  assert.equal(timers.size,0);
  assert.equal(requests.length,1);
  assert.equal(requests[0].body.preview,true);
});

test('cancelling preparation stops the next photo and never applies grades', async () => {
  const requests=[];let release, entered;
  const preparing=new Promise(resolve=>{entered=resolve;});
  const {nodes,controller}=dialogHarness(async (url,body)=>{
    requests.push({url,body});
    if(url.endsWith('grade-copy'))return clipboard;
    if(url.endsWith('grade-preparation'))return {token:'operation'};
    if(url.endsWith('grade-prepare')){entered();return new Promise(resolve=>{release=resolve;});}
    return {};
  });
  const work=controller.paste(['one','two']);
  await new Promise(resolve=>setImmediate(resolve));
  nodes.find(node=>node.className==='button-primary').fire('click');
  await preparing;
  nodes.filter(node=>node.textContent==='Cancel').at(-1).fire('click');
  release({ready:true});await work;
  assert.equal(requests.filter(row=>row.url.endsWith('grade-prepare')).length,1);
  assert.equal(requests.filter(row=>row.url.endsWith('grade-paste')).length,0);
  assert.ok(requests.some(row=>row.url.endsWith('grade-preparation-cancel')));
  // Library api() sends GET without a body; every preparation route is POST.
  for (const row of requests.filter(row=>row.url.includes('grade-prepar'))) assert.notEqual(row.body,undefined,row.url);
});
