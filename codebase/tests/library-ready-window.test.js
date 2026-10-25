const {test}=require('node:test'), assert=require('node:assert/strict');
const {create}=require('../frontend/library-ready-window');
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
test('ready pictures reuse only their exact photo, grade, source and display identity',async()=>{
  for (const field of ['path','grade','source','display']) {
    const photo={path:'a',grade:1,source:1,display:1}, blocked=gate(),disposed=[];
    let calls=0;
    const window=create({key:p=>JSON.stringify(p),load:async p=>{calls++;const image={...p};if(calls===1)await blocked.promise;return image;},dispose:v=>disposed.push(v)});
    const obsolete=window.get(photo);const rejected=assert.rejects(obsolete,{name:'AbortError'});
    await Promise.resolve();photo[field]=field==='path'?'b':2;
    window.update(photo,[]);const correct=await window.get(photo);blocked.resolve();await rejected;
    assert.deepEqual(correct,photo);assert.equal(await window.get(photo),correct);assert.equal(calls,2);
    assert.equal(disposed.length,1);assert.notDeepEqual(disposed[0],correct);
    window.invalidate();assert.equal(window.size(),0);assert.equal(disposed.length,2);
  }
});
test('navigation drops unfinished passed photos but promotes the stopped neighbour',async()=>{
  const a={path:'a'},b={path:'b'},c={path:'c'},blocked=gate();let cancelled=false;
  const window=create({key:p=>p.path,load:async(p,signal)=>{if(p===b){signal.addEventListener('abort',()=>{cancelled=true;});await blocked.promise;}return p;},dispose:()=>{}});
  await window.get(a);const old=window.get(b,0);const rejected=assert.rejects(old,{name:'AbortError'});await Promise.resolve();
  window.update(c,[a,b]);assert.equal(cancelled,true);assert.equal(await window.get(c),c);assert.equal(await window.get(a),a);
  blocked.resolve();await rejected;
});

test('stand-in selects only finished pixels for the same source, grade, mode and display',()=>{
  const {standIn}=require('../frontend/library-ready-window');
  const make=(identity='a|grade2|size|mtime',epoch=2,rendition='hdr',route='library-live')=>({
    identity,displayEpoch:epoch,controller:new AbortController(),photo:{path:'a'},meta:{route},
    fallback:{hidden:false,dataset:{rendition,picturePath:'a'}}});
  const valid=make(),camera=make(undefined,undefined,undefined,'camera-raw-scene'),oldGrade=make('a|grade1|size|mtime');
  const oldSource=make('a|grade2|oldsize|mtime'),other=make('b|grade2|size|mtime'),sdr=make(undefined,undefined,'sdr'),oldDisplay=make(undefined,1);
  const aborted=make();aborted.controller.abort();
  const cells=[camera,oldGrade,oldSource,other,sdr,oldDisplay,aborted];
  assert.equal(standIn(cells,valid.identity,2,true),undefined);
  assert.equal(standIn([...cells,valid],valid.identity,2,true),valid);
  assert.equal(standIn([sdr,valid],valid.identity,2,false),sdr);
  valid.fallback.hidden=true;assert.equal(standIn([valid],valid.identity,2,true),undefined);
});

test('selected photo promotes the same unfinished neighbour demand without restarting it',async()=>{
  const photo={path:'a'},blocked=gate(),priorities=[],promoted=[];
  const window=create({key:p=>p.path,promote:(p,priority)=>promoted.push(priority),load:async(p,signal,current,priority,trace,importance)=>{priorities.push(priority);await blocked.promise;assert.equal(signal.aborted,false);return {path:p.path,priority:importance()};},dispose:()=>{}});
  const neighbour=window.get(photo,5);
  await Promise.resolve();window.update(photo,[]);
  assert.equal(window.get(photo,0),neighbour);blocked.resolve();
  assert.deepEqual(await neighbour,{path:'a',priority:0});assert.deepEqual(priorities,[5]);assert.deepEqual(promoted,[0]);
});

test('rapid navigation delays source preparation until the last selection settles',async()=>{
  const {navigationGate}=require('../frontend/library-ready-window');
  let now=0;const ticks=[],started=[];
  const navigation=navigationGate({now:()=>now,wait:()=>new Promise(resolve=>ticks.push(resolve))});
  async function source(photo,signal){await navigation.settled(signal);if(!signal.aborted)started.push(photo);}
  const passed=new AbortController();navigation.touch();const first=source('passed',passed.signal);
  now=200;navigation.touch();passed.abort();const final=source('stopped',new AbortController().signal);
  now=350;ticks.splice(0).forEach(resolve=>resolve());await Promise.resolve();assert.deepEqual(started,[]);
  now=550;ticks.splice(0).forEach(resolve=>resolve());await Promise.all([first,final]);assert.deepEqual(started,['stopped']);
});

test('key release wakes a stopped selection without the remaining quiet timeout',async()=>{
  const {navigationGate}=require('../frontend/library-ready-window');
  const navigation=navigationGate({wait:()=>new Promise(()=>{})});
  navigation.touch();let started=false;
  const pending=navigation.settled(new AbortController().signal).then(()=>{started=true;});
  await Promise.resolve();assert.equal(started,false);
  navigation.release();await pending;assert.equal(started,true);
});
