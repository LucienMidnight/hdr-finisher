const {test}=require('node:test');
const assert=require('node:assert/strict');
const {notifyChromiumPressure,pressureGate,COOLDOWN_MS}=require('../desktop/memory-pressure.cjs');
test('trims once per level rise, never at none',()=>{
  const step=pressureGate();let t=0;const ticks=[];
  // 500 ms ticks: 3 s none, 3 s moderate, 3 s critical, 3 s none.
  for(const level of ['none','moderate','critical','none'])for(let i=0;i<6;i++,t+=500)ticks.push(step(level,t));
  assert.deepEqual(ticks.filter(Boolean),['moderate','critical']);
  assert.equal(ticks[6],'moderate');assert.equal(ticks[12],'critical');
});
test('a sustained overrun still reclaims, once per cool-down',()=>{
  const step=pressureGate();const trims=[];
  for(let t=0;t<=30000;t+=500)if(step('moderate',t))trims.push(t);
  assert.deepEqual(trims,[0,COOLDOWN_MS,2*COOLDOWN_MS,3*COOLDOWN_MS]);
});
test('flapping around the target does not trim on every return',()=>{
  const step=pressureGate();const trims=[];
  for(let t=0;t<COOLDOWN_MS;t+=500)if(step(t%1000?'none':'moderate',t))trims.push(t);
  assert.deepEqual(trims,[0]);
});
test('moderate reclaim awaits renderer collection without accessing DevTools',async()=>{
 const vm=require('node:vm');let complete,seen;
 const pending=notifyChromiumPressure({get debugger(){throw Error('DevTools must stay detached');},
  executeJavaScriptInIsolatedWorld:async(world,scripts)=>vm.runInNewContext(scripts[0].code,{gc:options=>{seen=options;return new Promise(resolve=>{complete=resolve;});}}),
  send:()=>{throw Error('moderate must retain native caches');}},'moderate');
 let finished=false;pending.then(()=>{finished=true;});await Promise.resolve();
 assert.equal(finished,false);assert.equal(seen.type,'major');assert.equal(seen.execution,'async');assert.equal(seen.flavor,'last-resort');
 complete();await pending;assert.equal(finished,true);
});
test('critical reclaim also requests native cache eviction',async()=>{
 const calls=[];
 await notifyChromiumPressure({executeJavaScriptInIsolatedWorld:async()=>calls.push('collected'),send:channel=>calls.push(channel)},'critical');
 assert.deepEqual(calls,['collected','desktop:clear-native-cache']);
});
test('failed renderer collection surfaces to the caller',async()=>{
 await assert.rejects(notifyChromiumPressure({executeJavaScriptInIsolatedWorld:async()=>{throw Error('unavailable');}},'moderate'),/unavailable/);
});

 test('stuck renderer times out without queuing more collections',async()=>{
 let calls=0;const contents={executeJavaScriptInIsolatedWorld:()=>{calls++;return new Promise(()=>{});}};
 await assert.rejects(notifyChromiumPressure(contents,'moderate',20),/timed out/);
 await assert.rejects(notifyChromiumPressure(contents,'moderate',20),/timed out/);
 assert.equal(calls,1);
});
const {emptyTrimGuard,trimReason}=require('../desktop/memory-pressure.cjs');
function exportRun(samples){
  // 500 ms polls through the same two gates as the desktop's memory timer.
  const trim=pressureGate(),grain=pressureGate(),guard=emptyTrimGuard(),rounds=[],events=[];
  samples.forEach((value,index)=>{
    const decision=guard(value,trim(value.level,index*500),!!grain(value.gradePressure,index*500));
    if(decision.entered)events.push(['paused',index*500]);
    if(decision.resumed)events.push([decision.resumed,index*500]);
    if(decision.trimLevel)rounds.push(index*500);
  });
  return {rounds,events};
}
const sample=(extra={})=>({level:'moderate',gradePressure:'moderate',pressure:'none',gradeBytes:400e6,caches:{working:{bytes:0},raw:{bytes:0}},...extra});
test('an export over the target with empty caches gets one trim round, then silence',()=>{
  const {rounds,events}=exportRun(Array.from({length:360},()=>sample()));
  assert.deepEqual(rounds,[0]);
  assert.deepEqual(events,[['paused',COOLDOWN_MS]]);
});
test('rounds that free memory continue; growth or OS pressure wakes a quiet guard',()=>{
  let caches=800e6;const samples=[];
  for(let i=0;i<120;i++){if(i%20===0)caches/=2;samples.push(sample({caches:{working:{bytes:caches}}}));}
  assert.equal(exportRun(samples).rounds.length,6);
  const quiet=Array.from({length:60},()=>sample());
  const grown=[...quiet,...Array.from({length:30},()=>sample({caches:{working:{bytes:50e6}}}))];
  // Woken, it runs a round on the new caches (this sample never frees them, so it pauses again).
  for(const [samples,reason] of [[grown,'cache_growth'],[[...quiet,...Array.from({length:30},()=>sample({pressure:'moderate'}))],'system_pressure_changed']]){
    const run=exportRun(samples);
    assert.deepEqual(run.events.slice(0,2).map(event=>event[0]),['paused',reason]);
    assert.ok(run.rounds.some(time=>time>=run.events[1][1]));
  }
});
test('a budget level flapping around the target with Grade open stays quiet',()=>{
  // Recorded November 23 on the MacBook Neo: Profile A export with Grade open.
  const samples=Array.from({length:300},(_,i)=>sample({level:Math.floor(i/7)%3?'none':'moderate'}));
  const {rounds,events}=exportRun(samples);
  assert.equal(rounds.length,1);
  assert.deepEqual(events.map(event=>event[0]),['paused']);
  const critical=[...samples,...Array.from({length:30},()=>sample({level:'critical'}))];
  assert.ok(exportRun(critical).events.some(event=>event[0]==='pressure_rose'));
});
test('a Grade-only round does not silence a trim of caches that still hold pictures',()=>{
  const full={caches:{working:{bytes:300e6}}};
  const samples=[...Array.from({length:30},()=>sample({...full,level:'none'})),...Array.from({length:30},()=>sample({...full}))];
  const trim=pressureGate(),grain=pressureGate(),guard=emptyTrimGuard();let trims=0;
  samples.forEach((value,index)=>{if(guard(value,trim(value.level,index*500),!!grain(value.gradePressure,index*500)).trimLevel)trims++;});
  assert.ok(trims>=1);
});
test('over the target with no OS shortage is logged as budget pressure',()=>{
  assert.equal(trimReason({pressure:'none'}),'budget_pressure');
  assert.equal(trimReason({pressure:'moderate'}),'system_memory_pressure');
});
