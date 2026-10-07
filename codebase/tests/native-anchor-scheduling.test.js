const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { declarations } = require('./frontend-source.js');
function fixture() {
  const timers = new Map(), jobs = []; let serial = 0;
  const state = { session: {session_id:'one'}, currentView:'hdr', previewGeneration:{hdr:1},
    acceptedPresentation:{exact:true,generation:1}, gpuPreview:{requestedCanonicalHighlightKeys:new Set()}, previewScheduler:{} };
  const context = vm.createContext({state, window:{setTimeout:fn => {timers.set(++serial,fn);return serial;},clearTimeout:id => timers.delete(id)},
    measureExactHighlightAnchor:r => jobs.push(r)});
  vm.runInContext(declarations('pendingHighlightAnchors', 'scheduleExactHighlightAnchor'), context);
  return {state,jobs,schedule:context.scheduleExactHighlightAnchor, tick:() => {const batch=[...timers.values()];timers.clear();batch.forEach(fn=>fn());}};
}
test('Native anchors coalesce latest inputs and wait for foreground presentation', () => {
  const f=fixture(); f.state.previewScheduler.interacting=true;
  f.schedule({lane:'hdr',key:'old'}); f.schedule({lane:'hdr',key:'new'}); f.tick(); assert.equal(f.jobs.length,0);
  f.state.previewScheduler.interacting=false; f.state.gpuDraftInFlight={}; f.tick(); assert.equal(f.jobs.length,0);
  f.state.gpuDraftInFlight=null; f.state.previewGeneration.hdr=2; f.tick(); assert.equal(f.jobs.length,0);
  f.state.acceptedPresentation.generation=2; f.tick(); assert.equal(f.jobs.length,1); assert.equal(f.jobs[0].key,'new');
});
test('Pending native work is discarded on session or lane replacement', () => {
  for(const replacement of ['session','lane']) {const f=fixture();f.schedule({lane:'hdr',key:'old'});
    if(replacement==='session') f.state.session.session_id='two';else f.state.currentView='sdr';
    f.tick();assert.equal(f.jobs.length,0);}
});
