const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../frontend/library-grants');
const tick=()=>new Promise(r=>setImmediate(r));
function setup(){
 const sockets=[],timers=[];
 const grants=create({url:'ws://local/api/library/grants',socket:()=>{const s={readyState:0,sent:[],send(v){this.sent.push(JSON.parse(v));},close(){this.readyState=3;this.onclose();},open(){this.readyState=1;this.onopen();},receive(v){this.onmessage({data:JSON.stringify(v)});}};sockets.push(s);return s;},timer:fn=>timers.push(fn),interval:()=>null});
 return {grants,sockets,timers};
}
test('one ask waits without HTTP retries, is promoted and cancels immediately',async()=>{
 const {grants,sockets}=setup(),abort=new AbortController();
 const pending=grants.acquire('scan.dng','source',abort.signal,80);sockets[0].open();
 assert.equal(sockets[0].sent.length,1);const id=sockets[0].sent[0].id;
 sockets[0].receive({type:'waiting',id,reason:'paused for Grade',grade:'scan.dng'});
 grants.promote('scan.dng',10);assert.equal(sockets[0].sent[1].type,'priority');
 assert.equal(grants.snapshot().jobs[0].state,'waiting');
 abort.abort();await assert.rejects(pending,{name:'AbortError'});
 assert.equal(sockets[0].sent.at(-1).type,'cancel');assert.equal(grants.snapshot().jobs.length,0);grants.close();
});
test('reconnect resubmits waiting work once and aborts and restarts active work',async()=>{
 const {grants,sockets,timers}=setup();let attempts=0;
 const active=grants.run('photo.jpg','source',null,async(id,signal)=>{attempts++;if(attempts===1)await new Promise((r,j)=>signal.addEventListener('abort',()=>j(new DOMException('lost','AbortError'))));return 42;});
 const waiting=grants.acquire('scan.dng','source');sockets[0].open();
 sockets[0].receive({type:'granted',id:sockets[0].sent[0].id});await tick();
 sockets[0].close();await tick();timers.shift()();sockets[1].open();
 assert.equal(sockets[1].sent.filter(v=>v.type==='ask'&&v.path==='scan.dng').length,1);
 for(const j of sockets[1].sent.filter(v=>v.type==='ask'))sockets[1].receive({type:'granted',id:j.id});
 assert.equal(await active,42);grants.finish(await waiting);grants.close();
});
test('finishing and changed outcomes release their grant exactly once',async()=>{
 const {grants,sockets}=setup();const work=grants.run('photo.jpg','quick',null,async()=>{throw Error('Photo changed during read');});sockets[0].open();sockets[0].receive({type:'granted',id:sockets[0].sent[0].id});
 await assert.rejects(work,/changed/);assert.equal(sockets[0].sent.at(-1).outcome,'changed');assert.equal(grants.snapshot().jobs.length,0);grants.close();
});


test('changed source work leaves no queue failure',async()=>{
 const {create:queue}=require('../frontend/library-scene-scheduler');
 const states=[],sources=queue(1,undefined,{onChange:(_,state)=>states.push(state)});
 await assert.rejects(sources.submit('photo',async()=>{throw new DOMException('Source settings changed during development.','AbortError');}),{name:'AbortError'});
 assert.deepEqual(sources.snapshot().failures,[]);assert.ok(states.includes('changed'));
});


test('thirty paused cells send one ask each without polling',async()=>{
 const {grants,sockets}=setup(),abort=new AbortController();
 const pending=Array.from({length:30},(_,i)=>grants.acquire(`scan-${i}.dng`,'source',abort.signal));
 const settled=Promise.allSettled(pending);sockets[0].open();
 for(const ask of [...sockets[0].sent])sockets[0].receive({type:'waiting',id:ask.id,reason:'paused for Grade',grade:'scan.dng'});
 await tick();await tick();
 assert.equal(sockets[0].sent.length,30);assert.equal(grants.snapshot().jobs.length,30);
 sockets[0].receive({type:'grade',name:'next.dng',bytes:4e9});assert.ok(grants.snapshot().jobs.every(j=>j.grade==='next.dng'));
 abort.abort();assert.ok((await settled).every(r=>r.status==='rejected'));grants.close();
});


test('hidden window class changes use the channel and survive reconnect',async()=>{
 const {grants,sockets,timers}=setup();
 grants.visibility(false);
 const abort=new AbortController(),pending=grants.acquire('hidden.jpg','source',abort.signal);
 sockets[0].open();assert.deepEqual(sockets[0].sent[0],{type:'visibility',visible:false});
 sockets[0].close();timers.shift()();sockets[1].open();
 assert.deepEqual(sockets[1].sent[0],{type:'visibility',visible:false});
 grants.visibility(true);assert.deepEqual(sockets[1].sent.at(-1),{type:'visibility',visible:true});
 abort.abort();await assert.rejects(pending,{name:'AbortError'});grants.close();
});


test('native minimisation keeps a visible Chromium page in eventually until restored',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 const listeners={},sockets=[];let native;
 const document={visibilityState:'visible',addEventListener:(type,fn)=>listeners[type]=fn};
 const root={document,crypto:require('node:crypto').webcrypto,dispatchEvent:()=>{},addEventListener:()=>{},
  hdrFinisherDesktop:{onWindowStateChanged:fn=>native=fn,getWindowState:async()=>({visible:true})}};
 class Socket{constructor(){this.readyState=0;this.sent=[];sockets.push(this);}send(v){this.sent.push(JSON.parse(v));}close(){this.readyState=3;this.onclose();}}
 const context={window:root,location:{origin:'http://local'},WebSocket:Socket,DOMException,AbortController,Event,
  setTimeout,clearTimeout,setInterval:()=>null,clearInterval};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/library-grants.js'),'utf8'),context);
 await tick();const abort=new AbortController(),pending=root.HDRLibraryGrants.acquire('a.jpg','source',abort.signal);
 sockets[0].readyState=1;sockets[0].onopen();
 native({visible:false});assert.equal(sockets[0].sent.at(-1).visible,false);
 listeners.visibilitychange();assert.equal(sockets[0].sent.at(-1).visible,false);
 native({visible:true});assert.equal(sockets[0].sent.at(-1).visible,true);
 document.visibilityState='hidden';listeners.visibilitychange();native({visible:true});
 assert.equal(sockets[0].sent.at(-1).visible,false);
 abort.abort();await assert.rejects(pending,{name:'AbortError'});root.HDRLibraryGrants.close();
});
