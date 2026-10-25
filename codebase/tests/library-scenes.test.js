const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const scheduler=require('../frontend/library-scene-scheduler');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function setup(plans,develop,cores=4){
 let time=0;const requests=[],events=[];
 const context={navigator:{hardwareConcurrency:cores},window:{HDRLibraryStopwatch:(stage,fields)=>events.push({stage,...fields})},HDRLibrarySceneScheduler:scheduler,AbortController,DOMException,setTimeout,clearTimeout,
  performance:{now:()=>time},console,crypto:require('node:crypto').webcrypto,
  HDRLibraryGpuRaw:{enabled:()=>true,liveScene:develop},
  fetch:async(url,options)=>{requests.push(JSON.parse(options.body));if(url==="/api/library/live-scene")return {ok:false,json:async()=>({detail:"decoder failed"})};const plan=plans[JSON.parse(options.body).path];return {ok:!plan.library_error,json:async()=>plan};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/library-scenes.js'),'utf8'),context);
 return {scenes:context.window.HDRLibraryScenes,requests,events,advance:ms=>time+=ms};
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
test('merged grid and selected demand survives one cancellation and reads the other cached size',async()=>{
 const block=gate(),started=[];
 const plans={photo:{bytes:96e6,revision:'1'}};
 const {scenes}=setup(plans,async(p,edge)=>{started.push(edge);await block.promise;
  plans.photo.cached={edge:2560,key:'large'};return {edge,key:'small'};});
 const cancel=new AbortController();const first=scenes.load('photo',640,cancel.signal,80);
 const selected=scenes.load('photo',2560,undefined,0);await tick();
 cancel.abort();await assert.rejects(first,{name:'AbortError'});block.resolve();
 assert.equal((await selected).key,'large');assert.deepEqual(started,[640]);
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

test('GPU failures retain their reason in the loading log before CPU fallback',async()=>{
 const {scenes,events}=setup({photo:{bytes:96e6}},async()=>{throw Error('Source transfer exceeds available GPU memory');});
 await assert.rejects(scenes.load('photo',640),/decoder failed/);
 assert.deepEqual(events.filter(event=>event.stage==="picture_source_gpu_fallback"),[{stage:'picture_source_gpu_fallback',path:'photo',reason:'Source transfer exceeds available GPU memory'}]);
});

test('source job survives an entirely absent tile and explicit invalidation rejects its old result',async()=>{
 const block=gate(),started=[];let shared;
 const {scenes}=setup({photo:{bytes:10,revision:'1'}},async(path,edge,signal)=>{
  shared=signal;started.push(path);await block.promise;return {edge,key:'stored'};
 });
 const cancel=new AbortController(),first=scenes.load('photo',640,cancel.signal);
 await tick();cancel.abort();await assert.rejects(first,{name:'AbortError'});assert.equal(shared.aborted,false);
 const returned=scenes.load('photo',640);await tick();assert.deepEqual(started,['photo']);
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
