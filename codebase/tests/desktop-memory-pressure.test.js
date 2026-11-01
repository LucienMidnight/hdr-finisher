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
