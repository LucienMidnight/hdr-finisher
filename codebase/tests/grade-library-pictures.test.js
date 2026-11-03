const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../frontend/grade-library-pictures.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
  const sent=[],tasks=[],stored=[],finished=[];
  let frame={sessionId:'session',revision:1,lane:'hdr',clean:true},wait;
  const api=create({snapshot:()=>frame,capture:async()=>({body:new ArrayBuffer(16)}),
    store:async(packet,lane,pixels)=>{stored.push(packet.grade_identity);if(wait)await wait;return true;},
    sources:async packet=>{finished.push(packet.grade_identity);return {scenes:[]};},
    send:packet=>sent.push(packet),defer:work=>tasks.push(work),now:()=>100});
  return {api,sent,tasks,stored,finished,setFrame:value=>frame={...frame,...value},wait:value=>wait=value};
}
test('publication starts after saving, defers capture, and preserves release timing',async()=>{
  const s=setup();s.api.changed();s.api.released();
  assert.equal(s.sent.length,0);
  s.api.available({path:'photo',revision:1,grade_identity:'saved',available_at:900});
  assert.equal(s.stored.length,0);assert.equal(s.sent[0].stage,'pending');
  await s.tasks.shift()();
  assert.deepEqual(s.stored,['saved']);assert.deepEqual(s.finished,['saved']);
  assert.equal(s.sent[1].stage,'picture');assert.equal(s.sent[1].settled_at,100);
  assert.equal(s.sent[2].captured_lane,'hdr');
});
test('an older asynchronous capture never publishes after a newer save',async()=>{
  const s=setup();let release;
  s.wait(new Promise(resolve=>release=resolve));
  s.api.available({path:'photo',revision:1,grade_identity:'old'});
  const first=s.tasks.shift()();await tick();
  s.setFrame({revision:2});s.api.available({path:'photo',revision:2,grade_identity:'new'});
  release();await first;await s.tasks.shift()();
  assert.deepEqual(s.sent.filter(p=>p.stage==='picture').map(p=>p.grade_identity),['new']);
  assert.deepEqual(s.finished,['new']);
});
test('zoom or overlays without a clean full frame use only the developed-source fallback',async()=>{
  const s=setup();s.setFrame({clean:false,reason:'Tiled frame'});
  s.api.available({path:'photo',revision:1,grade_identity:'saved'});await s.tasks.shift()();
  assert.deepEqual(s.stored,[]);assert.deepEqual(s.finished,['saved']);
  assert.equal(s.sent.at(-1).reason,'Tiled frame');assert.equal(s.sent.at(-1).captured_lane,null);
});
test('a frame for an older revision is never labeled with the saved grade',async()=>{
  const s=setup();s.api.available({path:'photo',revision:2,grade_identity:'new'});await s.tasks.shift()();
  assert.deepEqual(s.stored,[]);assert.deepEqual(s.finished,['new']);
});

test('acknowledging the same edit keeps its release time; a new edit resets it',async()=>{
  let clock=10;const sent=[],tasks=[];
  const api=create({snapshot:()=>({sessionId:'s',revision:1,lane:'hdr',clean:true}),capture:async()=>null,
    store:async()=>true,sources:async()=>({scenes:[]}),send:p=>sent.push(p),defer:work=>tasks.push(work),now:()=>clock});
  api.changed('edit-1');clock=20;api.released();clock=80;api.changed('edit-1');
  api.available({revision:1,grade_identity:'a',available_at:100});assert.equal(sent.at(-1).settled_at,20);
  api.changed('edit-2');api.available({revision:1,grade_identity:'b',available_at:100});assert.equal(sent.at(-1).settled_at,80);
});

for(const failure of ['capture','store'])test(failure+' failure falls back to the developed source',async()=>{
  const sent=[],tasks=[];let loans=0;
  const api=create({snapshot:()=>({sessionId:'s',revision:1,lane:'hdr',clean:true}),
    capture:async()=>{if(failure==='capture')throw Error('device lost');return {};},
    store:async()=>{throw Error('upload interrupted');},sources:async()=>{loans++;return {scenes:[]};},
    send:p=>sent.push(p),defer:f=>tasks.push(f)});
  api.available({revision:1,grade_identity:'saved'});await tasks.shift()();
  assert.equal(loans,1);assert.equal(sent.at(-1).stage,'sources');
  assert.equal(sent.at(-1).captured_lane,null);assert.match(sent.at(-1).reason,/capture failed/);
});
test('closing Grade cancels a queued publication',async()=>{
  const s=setup();s.api.available({revision:1,grade_identity:'saved'});s.api.dispose();
  await s.tasks.shift()();assert.deepEqual(s.stored,[]);assert.deepEqual(s.finished,[]);
});
test('changing photos before capture clears the pending hand-off',async()=>{
  const s=setup();s.api.available({revision:1,grade_identity:'saved'});s.setFrame({sessionId:'other'});
  await s.tasks.shift()();assert.equal(s.sent.at(-1).stage,'failed');assert.deepEqual(s.finished,[]);
});
