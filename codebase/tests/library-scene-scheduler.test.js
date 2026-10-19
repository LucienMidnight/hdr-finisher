const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../frontend/library-scene-scheduler');
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
test('source demand merges, promotes selected work and stops only after its last user leaves',async()=>{
 const queue=create(1),block=gate(),started=[];
 const first=queue.submit('running',()=>block.promise);
 const a=new AbortController(),b=new AbortController();let calls=0;
 const background=queue.submit('same',async()=>{calls++;started.push('selected');return 42;},a.signal,80);
 const other=queue.submit('other',async()=>started.push('other'),undefined,10);
 const selected=queue.submit('same',()=>assert.fail('Duplicate development'),b.signal,0);
 a.abort();await assert.rejects(background,{name:'AbortError'});block.resolve();
 await first;assert.equal(await selected,42);await other;
 assert.equal(calls,1);assert.deepEqual(started,['selected','other']);
});
test('full developments are capped and queued work is discarded when it leaves the screen',async()=>{
 const queue=create(2),block=gate();let running=0,peak=0,cancelledRan=false;
 const task=async()=>{peak=Math.max(peak,++running);await block.promise;running--;};
 const a=queue.submit('a',task),b=queue.submit('b',task),c=new AbortController();
 const discarded=queue.submit('c',()=>{cancelledRan=true;},c.signal);c.abort();
 await assert.rejects(discarded,{name:'AbortError'});block.resolve();await Promise.all([a,b]);
 assert.equal(peak,2);assert.equal(cancelledRan,false);
});
