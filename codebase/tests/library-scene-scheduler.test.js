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

test('cancelling a running expensive decoder retains its borrowed slot until it stops',async()=>{
 const queue=create(2,undefined,{heavyLimit:1}),a=gate(),b=gate(),cancel=new AbortController(),started=[];
 const first=queue.submit('running',async()=>{started.push('running');await a.promise;},cancel.signal,10,{heavy:true});
 const second=queue.submit('borrowed',async()=>{started.push('borrowed');await b.promise;},undefined,10,{heavy:true});
 await new Promise(resolve=>setImmediate(resolve));cancel.abort();await assert.rejects(first,{name:'AbortError'});
 const next=queue.submit('next',async()=>started.push('next'),undefined,10,{heavy:true});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(started,['running','borrowed']);assert.equal(queue.snapshot().active,2);
 a.resolve();await next;assert.deepEqual(started,['running','borrowed','next']);
 b.resolve();await second;
});

test('expensive-only demand uses both slots and drains without exceeding the limit',async()=>{
 const queue=create(2,undefined,{heavyLimit:1}),blocks=[gate(),gate(),gate()],started=[];
 let running=0,peak=0;
 const jobs=blocks.map((block,i)=>queue.submit(String(i),async()=>{
   started.push(i);peak=Math.max(peak,++running);await block.promise;running--;
 },undefined,10,{heavy:true}));
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(started,[0,1]);assert.equal(queue.snapshot().waiting,1);
 blocks[0].resolve();await jobs[0];await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(started,[0,1,2]);assert.equal(peak,2);
 blocks[1].resolve();blocks[2].resolve();await Promise.all(jobs);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(queue.snapshot().active,0);
});

test('light work arriving while both expensive slots are occupied gets the next free slot',async()=>{
 const queue=create(2,undefined,{heavyLimit:1}),a=gate(),b=gate(),started=[];
 const first=queue.submit('a',()=>a.promise,undefined,10,{heavy:true});
 const second=queue.submit('b',()=>b.promise,undefined,10,{heavy:true});
 await new Promise(resolve=>setImmediate(resolve));
 const heavy=queue.submit('heavy',async()=>started.push('heavy'),undefined,10,{heavy:true,cost:5});
 const light=queue.submit('light',async()=>started.push('light'),undefined,10,{cost:1});
 a.resolve();await light;assert.equal(started[0],'light');
 b.resolve();await Promise.all([first,second,heavy]);
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
  assert.deepEqual(queue.snapshot().jobs,[{path:"image.dng",priority:10,stage:"Correcting DNG brightness",background:false,state:"running"}]);
 queue.stage("image.dng","Waiting for GPU preparation",true);
 assert.equal(queue.snapshot().jobs[0].state,"waiting");
 queue.stage("image.dng","Correcting DNG distortion on GPU");
 assert.equal(queue.snapshot().jobs[0].state,"running");
 finish(42);assert.equal(await result,42);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(queue.snapshot().jobs,[]);
});

test('detached active preparation finishes its cache and returning demand reuses it',async()=>{
 const queue=create(2,undefined,{keepRunning:true}),block=gate(),cancel=new AbortController();
 let calls=0,published=false,shared;
 const first=queue.submit('photo',async signal=>{calls++;shared=signal;await block.promise;published=true;return 42;},cancel.signal);
 await Promise.resolve();cancel.abort();await assert.rejects(first,{name:'AbortError'});
 assert.equal(shared.aborted,false);assert.equal(queue.snapshot().active,1);
 const returned=queue.submit('photo',()=>assert.fail('Duplicate preparation'));
 block.resolve();assert.equal(await returned,42);assert.equal(calls,1);assert.equal(published,true);
 const offscreen=gate(),gone=new AbortController();
 const orphan=queue.submit('other',async()=>{await offscreen.promise;published='offscreen';},gone.signal);
 await Promise.resolve();gone.abort();await assert.rejects(orphan,{name:'AbortError'});
 offscreen.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(published,'offscreen');
});

test('viewport demotes old pending demand and keeps explicit requests ahead of aged thumbnails',async()=>{
 let time=0;const queue=create(1,()=>time),block=gate(),started=[];
 const first=queue.submit('block',()=>block.promise);
 const old=queue.submit('old',async()=>started.push('old'));
 time=600000;
 const visible=queue.submit('visible',async()=>started.push('visible'));
 const near=queue.submit('near',async()=>started.push('near'));
 const selected=queue.submit('selected',async()=>started.push('selected'),null,0,{heavy:true});
 queue.reprioritize(path=>path==='visible'?10:path==='near'?50:80);
 block.resolve();await Promise.all([first,old,visible,near,selected]);
 assert.deepEqual(started,['selected','visible','near','old']);
});

test('explicit invalidation aborts detached work while retaining its occupied slot',async()=>{
 const queue=create(1,undefined,{keepRunning:true}),block=gate();let shared,secondStarted=false;
 const first=queue.submit('old',async signal=>{shared=signal;await block.promise;},null,10,{path:'photo'});
 await Promise.resolve();queue.invalidate(path=>path==='photo');
 await assert.rejects(first,{name:'AbortError'});assert.equal(shared.aborted,true);
 const second=queue.submit('new',async()=>{secondStarted=true;});
 await Promise.resolve();assert.equal(secondStarted,false);
 block.resolve();await second;assert.equal(secondStarted,true);
});

test('idle pass is sequential, yields to activity, and stops at cache headroom without cycling',async()=>{
 const {createWarmer}=require('../frontend/library-scene-scheduler');
 let time=0,foreground=false;const calls=[],block=gate();let active=0,peak=0;
 const warmer=createWarmer({now:()=>time,idle:()=>!foreground,load:async(path,signal)=>{
  calls.push(path);peak=Math.max(peak,++active);
  try{if(path==='a')await block.promise;return path==='full'?null:{cached:true};}finally{active--;}
 }});
 const rows=['a','b','full','never'].map(path=>({path,identity:path}));
 warmer.update('folder',rows);await warmer.tick();assert.deepEqual(calls,[]);
 time=1001;foreground=true;await warmer.tick();assert.deepEqual(calls,[]);
 foreground=false;const first=warmer.tick();await warmer.tick();assert.deepEqual(calls,['a']);
 block.resolve();await first;await warmer.tick();await warmer.tick();
 for(let i=0;i<10;i++){warmer.update('folder',rows);await warmer.tick();}
 assert.deepEqual(calls,['a','b','full']);assert.equal(peak,1);
 warmer.update('other',[{path:'b',identity:'b'}]);time+=1001;await warmer.tick();assert.equal(calls.length,4);
});

test('idle activity detaches queued demand and retries it after the next idle period',async()=>{
 const {createWarmer}=require('../frontend/library-scene-scheduler');let time=0,calls=0;
 const warmer=createWarmer({now:()=>time,idle:()=>true,load:async(path,signal)=>{
  calls++;if(calls===1)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError'))));return {};
 }});
 warmer.update('folder',[{path:'a',identity:'a'}]);time=1001;
 const pending=warmer.tick();warmer.touch();await pending;await warmer.tick();assert.equal(calls,1);
 time+=1001;await warmer.tick();assert.equal(calls,2);
});

test('visible heavy demand keeps the next slot ahead of nearby light work',async()=>{
 const queue=create(2,undefined,{heavyLimit:1}),a=gate(),b=gate(),started=[];
 const first=queue.submit('first',()=>a.promise,null,10,{heavy:true});
 const second=queue.submit('second',()=>b.promise,null,10,{heavy:true});
 await new Promise(resolve=>setImmediate(resolve));
 const visible=queue.submit('visible',async()=>started.push('visible'),null,10,{heavy:true});
 const near=queue.submit('near',async()=>started.push('near'),null,50);
 queue.reprioritize(path=>path==='visible'?10:50);
 a.resolve();await visible;await near;assert.deepEqual(started,['visible','near']);
 b.resolve();await Promise.all([first,second]);
});

test('fullscreen cancels a lower priority draw before the next draw starts',async()=>{
 const queue=create(1,undefined,{preemptLower:true}),order=[];
 const lower=queue.submit('film',signal=>new Promise(resolve=>{order.push('film');signal.addEventListener('abort',()=>{order.push('cancel');resolve();});}),undefined,10);
 await Promise.resolve();
 const fullscreen=queue.submit('single',()=>order.push('single'),undefined,0);
 await Promise.all([lower,fullscreen]);assert.deepEqual(order,['film','cancel','single']);
});

test('superseded fullscreen source work stops when its last neighbour leaves',async()=>{
 const queue=create(1,undefined,{keepRunning:job=>job.priority>=10});
 const controller=new AbortController(),stopped=gate();
 const work=queue.submit('neighbour',signal=>new Promise(resolve=>signal.addEventListener('abort',()=>{stopped.resolve();resolve();})),controller.signal,5);
 const cancelled=assert.rejects(work,{name:'AbortError'});await Promise.resolve();controller.abort();await stopped.promise;await cancelled;
});

test('selected source borrows idle capacity and preempts only one neighbour when full',async()=>{
 const queue=create(3,undefined,{preemptLower:true,preemptForCapacity:true}),blocks=[gate(),gate(),gate()],signals=[];
 const task=i=>async signal=>{signals[i]=signal;await blocks[i].promise;};
 const a=queue.submit('a',task(0),null,5),b=queue.submit('b',task(1),null,5);await Promise.resolve();
 const c=queue.submit('selected',task(2),null,0);await Promise.resolve();assert.ok(signals.every(s=>!s.aborted));
 const next=queue.submit('next',async()=>42,null,0);assert.equal(signals.filter(s=>s.aborted).length,1);assert.equal(signals[2].aborted,false);
 blocks[0].resolve();blocks[1].resolve();blocks[2].resolve();await Promise.all([a,b,c]);assert.equal(await next,42);
});

test('nearby source survives a scroll, reattaches once, and stops after leaving the nearby window',async()=>{
 let nearby=new Set(['photo']);const block=gate(),controller=new AbortController();let starts=0,shared;
 const queue=create(1,undefined,{keepRunning:job=>nearby.has(job.path)});
 const task=async signal=>{starts++;shared=signal;await block.promise;return 42;};
 const first=queue.submit('photo-v1',task,controller.signal,10,{path:'photo'});
 const cancelled=assert.rejects(first,{name:'AbortError'});await Promise.resolve();controller.abort();await cancelled;
 assert.equal(shared.aborted,false);
 const again=new AbortController(),second=queue.submit('photo-v1',task,again.signal,10,{path:'photo'});
 await Promise.resolve();assert.equal(starts,1);block.resolve();assert.equal(await second,42);
 const last=new AbortController(),finish=gate();let orphan;
 const third=queue.submit('photo-v2',async signal=>{orphan=signal;await finish.promise;},last.signal,10,{path:'photo'});
 const rejected=assert.rejects(third,{name:'AbortError'});await new Promise(resolve=>setImmediate(resolve));last.abort();await rejected;
 nearby=new Set();queue.reprioritize(()=>80);assert.equal(orphan.aborted,true);finish.resolve();
});

test('memory waits leave active slots free and newly visible work wins admission',async()=>{
 let granted=false;const starts=[],queue=create(2,undefined,{admit:async()=>granted});
 const off=queue.submit('offscreen',async()=>starts.push('offscreen'),undefined,80);
 await new Promise(r=>setImmediate(r));
 assert.equal(queue.snapshot().active,0);assert.equal(queue.snapshot().waiting,1);
 const visible=queue.submit('visible',async()=>starts.push('visible'),undefined,10);
 await new Promise(r=>setImmediate(r));assert.equal(queue.snapshot().active,0);
 granted=true;
 await Promise.all([off,visible]);assert.deepEqual(starts,['visible','offscreen']);
});

test('a cancelled admission cannot start development or strand the next job',async()=>{
 const admission=gate(),cancel=new AbortController(),starts=[];
 const queue=create(1,undefined,{admit:job=>job.path==='cancelled'?admission.promise:Promise.resolve(true)});
 const removed=queue.submit('cancelled',async()=>starts.push('cancelled'),cancel.signal);
 await new Promise(r=>setImmediate(r));cancel.abort();await assert.rejects(removed,{name:'AbortError'});
 const next=queue.submit('next',async()=>starts.push('next'));
 admission.resolve(true);await next;assert.deepEqual(starts,['next']);
});

test('grid read-ahead follows the viewport even when the selection is offscreen',async()=>{
 const queue=create(1),block=gate(),started=[];
 const running=queue.submit('running',()=>block.promise);
 queue.reprioritize(path=>path==='visible'?10:80);
 const selected=queue.submit('old-selection',async()=>started.push('old-selection'),undefined,80,{viewport:true});
 const visible=queue.submit('visible',async()=>started.push('visible'),undefined,80,{viewport:true});
 block.resolve();await Promise.all([running,selected,visible]);
 assert.deepEqual(started,['visible','old-selection']);
});

test('visible development releases an offscreen source parked at GPU admission',async()=>{
 const queue=create(1,undefined,{preemptLower:(job,priority)=>priority<=10&&job.resourceWaiting});
 let released=false;
 const off=queue.submit('offscreen',signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{
  released=true;reject(new DOMException('Cancelled','AbortError'));
 })),undefined,80);
 await new Promise(r=>setImmediate(r));queue.stage('offscreen','Waiting for GPU memory',true);
 const rejected=assert.rejects(off,{name:'AbortError'});
 const visible=queue.submit('visible',async()=>assert.equal(released,true),undefined,10);
 await Promise.all([visible,rejected]);assert.equal(queue.snapshot().active<=1,true);
});

test('development FIFO keeps screen order despite different costs',async()=>{
 const q=create(1,undefined,{fifo:true}),block=gate(),started=[];
 const first=q.submit('first',()=>block.promise);
 const a=q.submit('visible-a',()=>started.push('a'),null,10,{cost:5});
 const b=q.submit('visible-b',()=>started.push('b'),null,10,{cost:0});
 const selected=q.submit('selected',()=>started.push('selected'),null,0);
 block.resolve();await Promise.all([first,a,b,selected]);
 assert.deepEqual(started,['selected','a','b']);
});

test('a job that loses its development turn frees its slot for an admitted job (Nov 1 stall)',async()=>{
 const order=[];let tries=0;
 const queue=create(1,undefined,{admit:async()=>true});
 const lost=queue.submit('lost',async()=>{tries++;order.push('lost-'+tries);if(tries===1)throw Object.assign(new DOMException('Waiting for another development turn','AbortError'),{laneRequeue:true});return 'lost done';});
 const other=queue.submit('other',async()=>{order.push('other');return 'other done';});
 assert.equal(await other,'other done');assert.equal(await lost,'lost done');
 assert.deepEqual(order,['lost-1','other','lost-2']); await new Promise(r=>setImmediate(r));
 assert.equal(queue.snapshot().active,0);assert.equal(queue.snapshot().waiting,0);assert.deepEqual(queue.snapshot().failures,[]);
});
test('idle work is reported as background until someone asks for the same picture',async()=>{
 const queue=create(1),block=gate();
 const idle=queue.submit('thumb',()=>block.promise,undefined,80,{path:'a.arw',background:true});
 assert.equal(queue.snapshot().jobs[0].background,true);
 const asked=queue.submit('thumb',()=>assert.fail('Duplicate check'),undefined,10,{path:'a.arw'});
 assert.equal(queue.snapshot().jobs[0].background,false);
 block.resolve();await Promise.all([idle,asked]);
 assert.equal(queue.snapshot().jobs.length,0);
});
