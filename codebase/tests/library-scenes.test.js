const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const scheduler=require('../frontend/library-scene-scheduler');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function setup(plans,develop,cores=4){
 let time=0;const requests=[],events=[];
 const context={navigator:{hardwareConcurrency:cores},window:{HDRLibraryStopwatch:(stage,fields)=>events.push({stage,...fields})},HDRLibrarySceneScheduler:scheduler,AbortController,DOMException,setTimeout,clearTimeout,setInterval,clearInterval,
  performance:{now:()=>time},console,crypto:require('node:crypto').webcrypto,
  HDRLibraryGrants:{acquire:async()=>({id:"test"}),run:async(p,k,s,task)=>task("test",s),promote:()=>{},release:()=>{}},
  HDRLibraryGpuRaw:{enabled:()=>true,liveScene:develop},
  fetch:async(url,options)=>{if(url==="/api/library/memory-admission")return {ok:true,json:async()=>({granted:true})};requests.push(JSON.parse(options.body));if(url==="/api/library/live-scene")return {ok:false,json:async()=>({detail:"decoder failed"})};const plan=plans[JSON.parse(options.body).path];return {ok:!plan.library_error,json:async()=>plan};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/library-scenes.js'),'utf8'),context);
 return {context,scenes:context.window.HDRLibraryScenes,requests,events,advance:ms=>time+=ms};
}

test('quick stored-scene misses never start a source; a stopped request may prepare it',async()=>{
 const started=[],plans={missing:{bytes:96e6,revision:'1'},stored:{cached:{edge:640,key:'current-grade'}}};
 const {scenes}=setup(plans,async(path,edge)=>{started.push(path);return {edge,key:'developed'};});
 assert.equal(await scenes.load('missing',640,null,0,false,null,{cachedOnly:true}),null);
 assert.equal((await scenes.load('stored',640,null,0,false,null,{cachedOnly:true})).key,'current-grade');
 assert.deepEqual(started,[]);
 assert.equal((await scenes.load('missing',640,null,0)).key,'developed');assert.deepEqual(started,['missing']);
});

test('in-window drawing is not preempted by another selected photo and promotion keeps the same job',async()=>{
 const {scenes}=setup({},()=>assert.fail('No source expected'));
 const block=gate(),order=[];let signal;
 scenes.viewport([],[]);
 const neighbour=scenes.draw(async shared=>{signal=shared;order.push('neighbour');await block.promise;return 42;},null,5,'a');
 await tick();scenes.promote('a',0);
 const selected=scenes.draw(async()=>order.push('selected'),null,0,'b');await tick();
 assert.equal(signal.aborted,false);assert.deepEqual(order,['neighbour']);
 block.resolve();assert.equal(await neighbour,42);await selected;assert.deepEqual(order,['neighbour','selected']);
});
test('cached pictures bypass both occupied sources and light demand gets the next slot',async()=>{
 const block=gate(),started=[];
 const {scenes}=setup({a:{bytes:96e6,revision:'a'},b:{bytes:400e6,revision:'b'},
  quick:{bytes:1e6,revision:'q'},cached:{cached:{edge:640,key:'cached'}}},async(p,edge)=>{
   started.push(p);if(p==='a'||p==='b')await block.promise;return {edge,key:p};
  });
 const a=scenes.load('a',640),b=scenes.load('b',640);await tick();
 assert.equal((await scenes.load('cached',640)).key,'cached');
 assert.deepEqual(started,['a','b']);assert.equal(scenes.snapshot().sources.active,2);
 const quick=scenes.load('quick',640);await tick();
 assert.equal(scenes.snapshot().sources.waiting,1);
 block.resolve();assert.equal((await quick).key,'quick');
 await Promise.all([a,b]);assert.deepEqual(started,['a','b','quick']);
});
test('different GPU tiers share admission and one cancellation keeps the other tier alive',async()=>{
 const block=gate(),started=[];let sharedSignal;
 const plans={photo:{bytes:96e6,revision:'1'}};
 const {scenes}=setup(plans,async(p,edge,signal,_priority,_version,_grant,edges)=>{
  started.push(edge);sharedSignal=signal;await block.promise;
  assert.deepEqual([...edges].sort((a,b)=>a-b),[640,2560]);
  plans.photo.cached={edge:2560,key:'large'};
  return {edge,key:'small'};
 });
 const cancel=new AbortController();const first=scenes.load('photo',640,cancel.signal,80);
 const selected=scenes.load('photo',2560,undefined,0);await tick();
 cancel.abort();await assert.rejects(first,{name:'AbortError'});
 assert.equal(sharedSignal.aborted,false);assert.equal(scenes.snapshot().sources.active,1);
 block.resolve();assert.equal((await selected).key,'large');assert.deepEqual(started,[640]);
});

test('observed slow files still borrow idle capacity, and source revisions remain usable',async()=>{
 const started=[];let block=gate(),hold=false;
 const plans={odd:{bytes:1,revision:'1'},other:{bytes:96e6,revision:'1'}};
 const {scenes,advance}=setup(plans,async(p,edge)=>{started.push(p);advance(3000);
  if(hold)await block.promise;return {edge};});
 await scenes.load('odd',640);hold=true;
 const a=scenes.load('other',640),b=scenes.load('odd',640);await tick();
 assert.deepEqual(started,['odd','other','odd']);assert.equal(scenes.snapshot().sources.active,2);
 block.resolve();await Promise.all([a,b]);
 plans.odd.revision='2';block=gate();const c=scenes.load('other',640),d=scenes.load('odd',640);
 await tick();assert.deepEqual(started.slice(-2),['other','odd']);
 block.resolve();await Promise.all([c,d]);
});
test('cancelled pending expensive demand never starts and a failed preparation releases capacity',async()=>{
 const block=gate(),started=[];
 const {scenes}=setup({a:{bytes:96e6},occupied:{bytes:96e6},b:{bytes:96e6},c:{bytes:96e6}},async(p,edge)=>{
  started.push(p);if(p==='a'){await block.promise;throw Error('decoder failed');}if(p==='occupied')await block.promise;return {edge};});
 const a=scenes.load('a',640);const aError=assert.rejects(a,/decoder failed/);
 const occupied=scenes.load('occupied',640);await tick();
 const cancel=new AbortController(),b=scenes.load('b',640,cancel.signal);await tick();
 cancel.abort();await assert.rejects(b,{name:'AbortError'});
 const c=scenes.load('c',640);block.resolve();await aError;await occupied;await c;assert.deepEqual(started,['a','occupied','c']);
});

test('remembered errors skip both source slots while later pictures finish',async()=>{
 const started=[];
 const record={path:'broken',revision:'1',reason:'Saved edits cannot be read'};
 const {scenes}=setup({broken:{detail:record.reason,library_error:record},broken2:{detail:'unreadable',library_error:{...record,path:'broken2'}},
  large:{bytes:96e6},small:{bytes:1e6}},async(path,edge)=>{started.push(path);return {edge};});
 const results=await Promise.allSettled(['broken','broken2','large','small'].map(path=>scenes.load(path,640)));
 assert.equal(results[0].reason.libraryError.revision,'1');
 assert.equal(results[1].reason.libraryError.path,'broken2');
 assert.ok(results.slice(2).every(result=>result.status==='fulfilled'));
 assert.deepEqual(started.sort(),['large','small']);
 await tick();
 assert.equal(scenes.snapshot().sources.active,0);
 assert.equal(scenes.snapshot().sources.waiting,0);
});

test('GPU memory shortage never requests CPU development',async()=>{
 const {scenes,events}=setup({photo:{bytes:96e6}},async()=>{throw Error('Source transfer exceeds available GPU memory');});
 await assert.rejects(scenes.load('photo',640),/Source transfer exceeds available GPU memory/);
 assert.deepEqual(events.filter(event=>event.stage==="picture_source_gpu_fallback"),[]);
});

test('departed tile cancels its source job and invalidation rejects a fresh request',async()=>{
 const block=gate(),started=[];let shared;
 const {scenes}=setup({photo:{bytes:10,revision:'1'}},async(path,edge,signal)=>{
  shared=signal;started.push(path);await block.promise;return {edge,key:'stored'};
 });
 const cancel=new AbortController(),first=scenes.load('photo',640,cancel.signal,10,false,null,{viewportDemand:true});
 await tick();cancel.abort();await assert.rejects(first,{name:'AbortError'});assert.equal(shared.aborted,true);
 const returned=scenes.load('photo',640);await tick();assert.deepEqual(started,['photo','photo']);
 scenes.invalidate(['photo']);await assert.rejects(returned,{name:'AbortError'});assert.equal(shared.aborted,true);
 block.resolve();await tick();assert.equal(scenes.snapshot().sources.active,0);
});

test('new source identity never joins a preparation for older pixels',async()=>{
 const block=gate(),plans={photo:{bytes:1,source_identity:'old'}},started=[];
 const {scenes}=setup(plans,async(path,edge)=>{started.push(plans.photo.source_identity);await block.promise;return {edge};});
 const old=scenes.load('photo',640);const rejected=assert.rejects(old,{name:'AbortError'});await tick();plans.photo.source_identity='new';
 const fresh=scenes.load('photo',640);await tick();assert.deepEqual(started,['old','new']);
 block.resolve();await Promise.all([rejected,fresh]);
});

test('idle cache refusal skips development but foreground can still request the photo',async()=>{
 let calls=0;const {scenes}=setup({photo:{bytes:1,warm_allowed:false}},async(path,edge)=>{calls++;return {edge};});
 assert.equal(await scenes.load('photo',640,null,80,true),null);assert.equal(calls,0);
 await scenes.load('photo',640,null,0);assert.equal(calls,1);
});


test('source admission scales with logical CPUs including heavy photos',async()=>{
 const block=gate(),started=[],plans={};
 for(let i=0;i<6;i++)plans['heavy'+i]={bytes:96e6,revision:'1'};
 const {scenes}=setup(plans,async(p,edge)=>{started.push(p);await block.promise;return {edge,key:p};},36);
 const jobs=Object.keys(plans).map(p=>scenes.load(p,640));await tick();
 assert.equal(started.length,6);
 assert.equal(scenes.snapshot().sources.active,6);
 block.resolve();await Promise.all(jobs);
});

test('selected source is admitted before development-ahead demand and both run in parallel',async()=>{
 const block=gate(),started=[],plans={selected:{bytes:96e6},ahead:{bytes:96e6}};
 const {scenes}=setup(plans,async(p,edge)=>{started.push(p);await block.promise;return {edge};});let ahead;
 const selected=scenes.load('selected',2560,null,0,false,null,{onSourceDemand:()=>{ahead=scenes.load('ahead',2560,null,5);}});
 await tick();assert.deepEqual(started,['selected','ahead']);assert.equal(scenes.snapshot().sources.active,2);
 block.resolve();await Promise.all([selected,ahead]);
});

test('development-ahead GPU refusal never starts a background CPU fallback',async()=>{
 const {scenes,requests}=setup({photo:{bytes:96e6}},async()=>{throw Object.assign(Error('No hardware GPU'),{gpuUnavailable:true});});
 assert.equal(await scenes.load('photo',2560,null,5,false,null,{gpuOnly:true}),null);
 assert.equal(requests.length,1,'Cache discovery only; no CPU development request');
});

test('selected photo joining development-ahead keeps its CPU fallback if GPU fails',async()=>{
 const block=gate();
 const {context,scenes,requests}=setup({photo:{bytes:96e6}},async()=>{await block.promise;throw Object.assign(Error('GPU lost'),{gpuUnavailable:true});});
 const fetch=context.fetch;context.fetch=async(url,options)=>{const response=await fetch(url,options);return url==='/api/library/live-scene'?{ok:true,json:async()=>({edge:2560,key:'cpu'})}:response;};
 const ahead=scenes.load('photo',2560,null,5,false,null,{gpuOnly:true});await tick();
 const selected=scenes.load('photo',2560,null,0);await tick();block.resolve();
 const [a,b]=await Promise.all([ahead,selected]);assert.ok(a&&b);
 assert.ok(requests.some(request=>request.gpu===false&&request.priority===0));
});


test('direct scenes reuse both sizes only for the current finishing grade',async()=>{
 const plans={photo:{source_identity:'same-source',render_identity:'grade-a'}};
 const {context,scenes}=setup(plans,()=>assert.fail('Direct scenes need no second development'));
 const forgotten=[];
 context.HDRLibraryGpuRaw.cachedDirect=(p,e,v)=>({path:p,edge:e,key:v});
 context.HDRLibraryGpuRaw.forgetDirect=p=>forgotten.push(p);
 assert.equal((await scenes.load('photo',640,null,0,false,null,{cachedOnly:true})).key,'grade-a');
 plans.photo.render_identity='grade-b';
 assert.equal((await scenes.load('photo',2560,null,0)).key,'grade-b');
 scenes.invalidate(['photo']);assert.deepEqual(forgotten,['photo']);
});

test('direct scene persistence waits for acceptance and starts after presentation',async()=>{
 const {context,scenes}=setup({},()=>{}),accepted=gate(),calls=[];
 context.fetch=async url=>{calls.push(url);return {ok:true};};
 const meta={path:'photo',key:'current',directScene:{store:()=>{calls.push('accept');return accepted.promise;}}};
 scenes.review('photo');scenes.save(meta);await tick();assert.deepEqual(calls,[]);
 scenes.save(meta,true);await tick();assert.deepEqual(calls,['accept']);
 accepted.resolve();await tick();assert.deepEqual(calls,['accept','/api/library/live-store/current']);
});

test('nearby viewport retains source preparation across a returning grid scroll',async()=>{
 const block=gate(),controller=new AbortController();let starts=0,shared;
 const {scenes}=setup({photo:{bytes:96e6,revision:'same'}},async(path,edge,signal)=>{
  starts++;shared=signal;await block.promise;return {edge,key:'finished'};
 });
 scenes.viewport(['photo'],['photo']);
 const first=scenes.load('photo',640,controller.signal,10,false,null,{viewportDemand:true});const rejected=assert.rejects(first,{name:'AbortError'});
 await tick();scenes.viewport([],['photo']);controller.abort();await rejected;
 assert.equal(shared.aborted,false);
 scenes.viewport(['photo'],['photo']);
 const returning=scenes.load('photo',640,undefined,10);await tick();
 assert.equal(starts,1);block.resolve();assert.equal((await returning).key,'finished');
});


test('needed explicit and viewport sources survive reranking and competing demand; abandoned viewport work stops',async()=>{
 const block=gate(),started=[],signals={};
 const plans=Object.fromEntries(['build','tile','selected'].map(p=>[p,{bytes:1,revision:'1'}]));
 const {scenes}=setup(plans,async(path,edge,signal)=>{
  started.push(path);signals[path]=signal;await block.promise;return {edge,key:path};
 });
 scenes.viewport(['tile'],['tile']);
 const controller=new AbortController();
 const build=scenes.load('build',2560,undefined,99);
 const tile=scenes.load('tile',640,controller.signal,10,false,null,{viewportDemand:true});
 const cancelled=assert.rejects(tile,{name:'AbortError'});
 await tick();scenes.viewport([],[]);
 const selected=scenes.load('selected',2560,undefined,0);
 await tick();assert.equal(signals.build.aborted,false);assert.equal(signals.tile.aborted,false);
 assert.deepEqual(started,['tile','build']);
 scenes.viewport([],['tile']);controller.abort();await cancelled;assert.equal(signals.tile.aborted,false);
 scenes.viewport([],[]);assert.equal(signals.tile.aborted,true);assert.equal(signals.build.aborted,false);
 block.resolve();assert.equal((await build).key,'build');assert.equal((await selected).key,'selected');
});

test('returning explicit demand at the same resolution reuses detached preparation',async()=>{
 const block=gate(),controller=new AbortController(),plans={photo:{bytes:1,revision:'1'}};let starts=0,shared;
 const {scenes,context}=setup(plans,async(path,edge,signal)=>{
  starts++;shared=signal;await block.promise;
  context.HDRLibraryGpuRaw.cachedDirect=(p,e)=>({path:p,edge:e,key:'finished'});
  return {path,edge,key:'finished'};
 });
 const first=scenes.load('photo',640,controller.signal);const cancelled=assert.rejects(first,{name:'AbortError'});
 await tick();controller.abort();await cancelled;scenes.viewport([],[]);
 assert.equal(shared.aborted,false);
 const returning=scenes.load('photo',640,undefined,0);await tick();assert.equal(starts,1);
 block.resolve();assert.equal((await returning).edge,640);
 assert.equal((await scenes.load('photo',640)).key,'finished');assert.equal(starts,1);
});


test('Build previews drawing survives a new grid draw while its caller still needs it',async()=>{
 const {scenes}=setup({},()=>assert.fail('No source expected')),block=gate();let shared;
 const build=scenes.draw(async signal=>{shared=signal;await block.promise;return 'built';},undefined,99,'build');
 await tick();const grid=scenes.draw(async()=> 'grid',undefined,10,'tile');
 scenes.viewport(['tile'],['tile']);await tick();assert.equal(shared.aborted,false);
 block.resolve();assert.equal(await build,'built');assert.equal(await grid,'grid');
});


test('parallel thumbnail and screen cache lookups retain both callers after viewport reranking',async()=>{
 const block=gate(),signals=[];
 const {scenes,context}=setup({photo:{bytes:1,revision:'1'}},async(path,edge)=>{
  context.HDRLibraryGpuRaw.cachedDirect=(p,e)=>({path:p,edge:e,key:'finished'});
  return {path,edge,key:'finished'};
 });
 const fetch=context.fetch;
 context.fetch=async(url,options)=>{
  signals.push(options.signal);
  await new Promise((resolve,reject)=>{
   const stop=()=>reject(new DOMException('Cancelled','AbortError'));
   options.signal.addEventListener('abort',stop,{once:true});
   block.promise.then(()=>{options.signal.removeEventListener('abort',stop);resolve();});
  });
  return fetch(url,options);
 };
 scenes.viewport([],[]);
 const small=scenes.load('photo',640),large=scenes.load('photo',2560);
 small.catch(()=>{});large.catch(()=>{});
 try{await tick();assert.equal(signals.length,2);assert.ok(signals.every(s=>!s.aborted));}
 finally{block.resolve();await Promise.allSettled([small,large]);}
 assert.equal((await small).edge,640);assert.equal((await large).edge,2560);
});

test('idle no-GPU demand never develops on the CPU',async()=>{
 const {scenes,requests}=setup({photo:{bytes:1,warm_allowed:true}},async()=>{throw Object.assign(Error('No GPU'),{gpuUnavailable:true});});
 assert.equal(await scenes.load('photo',640,null,80,true),null);
 assert.ok(!requests.some(request=>request.gpu===false));
});


test('offline cache reads cancel without a broken-photo receipt and notify the folder', async()=>{
 const {scenes,context,requests}=setup({offline:{offline:true,path:'offline',detail:'Folder offline',library_error:undefined}},()=>assert.fail('Offline source must not develop'));
 const dispatched=[];
 context.Event=Event;
 context.CustomEvent=class {constructor(type,options){this.type=type;this.detail=options.detail;}};
 context.window.dispatchEvent=event=>dispatched.push(event);
 const fetch=context.fetch;
 context.fetch=async(url,options)=>url==='/api/library/live-plan'?{ok:false,json:async()=>({offline:true,path:'offline',detail:'Folder offline'})}:fetch(url,options);
 await assert.rejects(scenes.load('offline',640),{name:'AbortError'});
 assert.equal(dispatched.filter(e=>e.type==='library-offline').length,1);
 assert.equal(dispatched.find(e=>e.type==='library-offline').detail.path,'offline');
 assert.equal(requests.length,0);
});


test('screen neighbour priority follows the photo viewport and stops when demand leaves',async()=>{
 const block=gate(),plans={photo:{bytes:1,revision:'1'}},started=[];let shared;
 const {scenes}=setup(plans,async(p,edge,signal,importance)=>{
  shared=signal;started.push({edge,priority:importance()});await block.promise;return {edge};
 });
 scenes.viewport([],['photo']);
 const controller=new AbortController();
 const neighbour=scenes.load('photo',2560,controller.signal,50,false,null,{viewportDemand:true});
 const stopped=assert.rejects(neighbour,{name:'AbortError'});await tick();
 assert.deepEqual(started,[{edge:2560,priority:50}]);
 scenes.viewport(['photo'],[]);
 assert.equal(scenes.snapshot().sources.jobs.find(job=>job.path==='photo').priority,10);
 scenes.viewport([],['photo']);
 assert.equal(scenes.snapshot().sources.jobs.find(job=>job.path==='photo').priority,50);
 controller.abort();await stopped;assert.equal(shared.aborted,true);block.resolve();
});


test('confirmed X-Trans uses its CPU grant directly even with a usable GPU',async()=>{
 const {context,scenes}=setup({fuji:{cpu_route:'xtrans',bytes:32e6}},()=>assert.fail('X-Trans must not enter Bayer development'));
 const grants=[],requests=[];
 context.HDRLibraryGrants.acquire=async(path,kind,signal,priority,edge,gpuBytes)=>{grants.push({kind,edge,gpuBytes});return {id:'bounded-fuji'};};
 context.HDRLibraryGrants.run=async(path,kind,signal,task,priority,initial)=>{assert.equal(kind,'cpu');assert.equal(initial.id,'bounded-fuji');return task(initial.id,signal);};
 context.HDRLibraryGpuRaw.preflight=()=>assert.fail('No Bayer GPU reservation for X-Trans');
 const fetch=context.fetch;
 context.fetch=async(url,options)=>{
  if(url!=='/api/library/live-scene')return fetch(url,options);
  const body=JSON.parse(options.body);requests.push(body);return {ok:true,json:async()=>({edge:body.edge,key:'stored-fuji'})};
 };
 for(const edge of [640,2560])assert.equal((await scenes.load('fuji',edge,null,0)).key,'stored-fuji');
 assert.equal(grants.length,2);assert.ok(grants.every(g=>g.kind==='cpu'&&g.gpuBytes===0));
 assert.ok(requests.every(r=>r.gpu===false&&r.grant==='bounded-fuji'));
});

test('unsupported source refusals never reopen the general CPU path',async()=>{
 for(const reason of ['unresolved EXR interpretation','JPEG XL interpretation required','unsupported DNG opcode']){
  const {scenes,requests}=setup({photo:{bytes:96e6}},async()=>{throw Error(reason);});
  await assert.rejects(scenes.load('photo',640),new RegExp(reason));
  assert.ok(requests.every(r=>r.gpu!==false));
 }
});

test('CPU tiers share admission and cancellation while both requests attach to the helper',async()=>{
 const block=gate(),calls=[],signals=[];
 const plans={photo:{bytes:96e6,source_identity:'recipe',cpu_route:'xtrans'}};
 const {scenes,context}=setup(plans,()=>assert.fail('CPU route must not use GPU development'));
 const original=context.fetch;
 context.fetch=async(url,options)=>{
  if(url!=='/api/library/live-scene')return original(url,options);
  const request=JSON.parse(options.body);calls.push(request);signals.push(options.signal);
  await block.promise;return {ok:true,json:async()=>({edge:request.edge,key:String(request.edge)})};
 };
 const cancel=new AbortController();const small=scenes.load('photo',640,cancel.signal,10,false,null,{viewportDemand:true});
 const rejected=assert.rejects(small,{name:'AbortError'});await tick();
 const large=scenes.load('photo',2560,null,0);await tick();
 cancel.abort();await rejected;
 assert.equal(scenes.snapshot().sources.active,1);assert.equal(signals[0].aborted,false);
 assert.deepEqual(calls.map(x=>x.edge).sort((a,b)=>a-b),[640,2560]);
 assert.equal(calls[0].grant,calls[1].grant);
 plans.photo.cached={edge:2560,key:'2560'};block.resolve();assert.equal((await large).edge,2560);
});


test('a save timeout or lost grant retries fresh work and never writes a failure receipt',async()=>{
 for(const message of ['Library upload timed out.','Library grant expired; request it again.']){
  let calls=0;
  const {scenes,requests,events}=setup({photo:{source_identity:'a'.repeat(64)}},async(p,edge)=>{
   if(++calls===1)throw Error(message);return {edge,key:'recovered'};
  });
  assert.equal((await scenes.load('photo',640,undefined,0)).key,'recovered');
  assert.equal(calls,2);assert.equal(events.filter(e=>e.stage==='picture_preparation_retry').length,1);
  assert.ok(requests.every(r=>!r.reason));
 }
});

test('temporary retries stop after three attempts with a local retryable warning',async()=>{
 let calls=0;
 const {scenes,requests}=setup({photo:{source_identity:'a'.repeat(64)}},async()=>{calls++;throw Error('Library upload timed out.');});
 await assert.rejects(scenes.load('photo',640,undefined,0),error=>{
  assert.equal(error.libraryError.timeout,true);
  assert.equal(error.libraryError.reason,"Couldn't finish preparing this photo. Try again.");return true;
 });
 assert.equal(calls,3);assert.ok(requests.every(r=>!r.reason));
});

test('leaving during transient backoff cancels the retry',async()=>{
 let calls=0;const cancel=new AbortController();
 const {scenes,events}=setup({photo:{source_identity:'a'.repeat(64)}},async()=>{calls++;throw Error('Library upload timed out.');});
 const work=scenes.load('photo',640,cancel.signal,0);
 while(!events.some(e=>e.stage==='picture_preparation_retry'))await tick();
 cancel.abort();await assert.rejects(work,{name:'AbortError'});assert.equal(calls,1);
});


test('invalid GPU pixels finish on the CPU even for a background thumbnail',async()=>{
 const {scenes,context,events,requests}=setup({photo:{source_identity:'a'.repeat(64)}},async()=>{
  throw Object.assign(Error('GPU edge colour produced 141 invalid pixels; using the CPU.'),{gpuUnavailable:true,gpuInvalidPixels:true});
 });
 let released=0;context.HDRLibraryGpuRaw.releaseSource=()=>released++;
 const original=context.fetch;
 context.fetch=async(url,options)=>url==='/api/library/live-scene'?{ok:true,json:async()=>({edge:640,key:'cpu-result',route:'cpu'})}:original(url,options);
 const result=await scenes.load('photo',640,undefined,80);
 assert.equal(result.key,'cpu-result');assert.equal(released,1);
 assert.equal(events.filter(e=>e.stage==='picture_source_gpu_fallback').length,1);
 assert.equal(events.filter(e=>e.stage==='picture_source_cpu_completed').length,1);
 assert.ok(requests.every(r=>!r.reason));
});
