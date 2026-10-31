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
for(const attached of [false,true])test(`native pressure preserves an existing debugger: ${attached}`,async()=>{
  let connected=attached;const calls=[];
  const debuggerTransport={isAttached:()=>connected,attach:()=>{connected=true;calls.push('attach');},
    detach:()=>{connected=false;calls.push('detach');},sendCommand:async(command,value)=>calls.push([command,value])};
  await notifyChromiumPressure({debugger:debuggerTransport},'moderate');
  assert.equal(connected,attached);
  assert.deepEqual(calls,attached ? [['HeapProfiler.collectGarbage',undefined]] :
    ['attach',['HeapProfiler.collectGarbage',undefined],'detach']);
});
test('failed native notification releases its own debugger',async()=>{
 let connected=false;
 const transport={isAttached:()=>connected,attach:()=>{connected=true;},detach:()=>{connected=false;},
   sendCommand:async()=>{throw Error('unavailable');}};
 await assert.rejects(notifyChromiumPressure({debugger:transport},'critical'),/unavailable/);
 assert.equal(connected,false);
});


test('critical pressure still purges native allocations',async()=>{
 const calls=[];
 const transport={isAttached:()=>true,sendCommand:async(...args)=>calls.push(args)};
 await notifyChromiumPressure({debugger:transport},'critical');
 assert.deepEqual(calls,[['Memory.simulatePressureNotification',{level:'critical'}]]);
});
