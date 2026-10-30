const {test}=require('node:test');
const assert=require('node:assert/strict');
const {notifyChromiumPressure}=require('../desktop/memory-pressure.cjs');
for(const attached of [false,true])test(`native pressure preserves an existing debugger: ${attached}`,async()=>{
  let connected=attached;const calls=[];
  const debuggerTransport={isAttached:()=>connected,attach:()=>{connected=true;calls.push('attach');},
    detach:()=>{connected=false;calls.push('detach');},sendCommand:async(command,value)=>calls.push([command,value])};
  await notifyChromiumPressure({debugger:debuggerTransport},'moderate');
  assert.equal(connected,attached);
  assert.deepEqual(calls,attached ? [['Memory.simulatePressureNotification',{level:'moderate'}]] :
    ['attach',['Memory.simulatePressureNotification',{level:'moderate'}],'detach']);
});
test('failed native notification releases its own debugger',async()=>{
 let connected=false;
 const transport={isAttached:()=>connected,attach:()=>{connected=true;},detach:()=>{connected=false;},
   sendCommand:async()=>{throw Error('unavailable');}};
 await assert.rejects(notifyChromiumPressure({debugger:transport},'critical'),/unavailable/);
 assert.equal(connected,false);
});
