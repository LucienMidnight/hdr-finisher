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

test('expensive work leaves a slot for lighter files without exceeding two developments',async()=>{
 const queue=create(2,undefined,{heavyLimit:1}),a=gate(),b=gate(),started=[];
 let running=0,peak=0;
 const task=(name,block)=>async()=>{started.push(name);peak=Math.max(peak,++running);await block?.promise;running--;};
 const first=queue.submit('large-tiff',task('large-tiff',a),undefined,10,{heavy:true,cost:5});
 const second=queue.submit('large-dng',task('large-dng',b),undefined,10,{heavy:true,cost:5});
 const quick=queue.submit('small-jpeg',task('small-jpeg'),undefined,10,{cost:1});
 await quick;assert.deepEqual(started,['large-tiff','small-jpeg']);assert.equal(peak,2);
 a.resolve();await first;
 // An expensive-only tail still runs to completion.
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(started,['large-tiff','small-jpeg','large-dng']);b.resolve();await second;
});
test('cost ordering ages waiting work and preserves selected-photo priority',async()=>{
 let time=0;const queue=create(1,()=>time),block=gate(),started=[];
 const running=queue.submit('block',()=>block.promise);
 const old=queue.submit('old',async()=>started.push('old'),undefined,10,{cost:5});
 time=6000;
 const cheap=queue.submit('cheap',async()=>started.push('cheap'),undefined,10,{cost:0});
 const selected=queue.submit('selected',async()=>started.push('selected'),undefined,0,{cost:5});
 block.resolve();await Promise.all([running,old,cheap,selected]);
 assert.deepEqual(started,['selected','old','cheap']);
});

test('cancelling a running expensive decoder does not release its slot before it stops',async()=>{
 const queue=create(2,undefined,{heavyLimit:1}),block=gate(),cancel=new AbortController(),started=[];
 const first=queue.submit('running',async()=>{started.push('running');await block.promise;},cancel.signal,10,{heavy:true});
 await new Promise(resolve=>setImmediate(resolve));cancel.abort();await assert.rejects(first,{name:'AbortError'});
 const next=queue.submit('next',async()=>started.push('next'),undefined,10,{heavy:true});
 const quick=queue.submit('quick',async()=>started.push('quick'));
 await quick;assert.deepEqual(started,['running','quick']);
 block.resolve();await next;assert.deepEqual(started,['running','quick','next']);
});

test("Activity retains running cancellations until work exits and records failures", async()=>{
  const transitions=[], queue=create(1,()=>Date.now(),{onChange:(job,state,error)=>transitions.push([job.path,state,error?.message])});
  let finish; const abort=new AbortController();
  const active=queue.submit("a",()=>new Promise(resolve=>finish=resolve),abort.signal,10,{path:"one.dng",stage:"Reading source"});
  await Promise.resolve();
  const waiting=queue.submit("b",()=>{throw Error("Unreadable source");},null,10,{path:"two.jpg"});
  assert.equal(queue.snapshot().jobs[1].state,"waiting");
  abort.abort();await assert.rejects(active,{name:"AbortError"});
  assert.equal(queue.snapshot().jobs.find(j=>j.path==="one.dng").state,"stopping");finish();
  await assert.rejects(waiting,/Unreadable source/);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(queue.snapshot().jobs.length,0);
  assert.ok(transitions.some(t=>t[0]==="one.dng"&&t[1]==="cancelled"));
  assert.ok(transitions.some(t=>t[0]==="two.jpg"&&t[1]==="failed"&&t[2]==="Unreadable source"));
});


test("Activity stages reflect real execution and resource waits, then clear on completion", async()=>{
 const queue=create(1);let finish;
 const result=queue.submit("photo",()=>new Promise(resolve=>finish=resolve),null,10,{path:"image.dng",stage:"Reading source"});
 await Promise.resolve();
 queue.stage("image.dng","Correcting DNG brightness");
 assert.deepEqual(queue.snapshot().jobs,[{path:"image.dng",stage:"Correcting DNG brightness",state:"running"}]);
 queue.stage("image.dng","Waiting for GPU preparation",true);
 assert.equal(queue.snapshot().jobs[0].state,"waiting");
 queue.stage("image.dng","Correcting DNG distortion on GPU");
 assert.equal(queue.snapshot().jobs[0].state,"running");
 finish(42);assert.equal(await result,42);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(queue.snapshot().jobs,[]);
});
