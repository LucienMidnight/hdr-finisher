const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {run}=require('../desktop/quick-library-test.cjs');
test('unset quick switch touches no app, page, filesystem or backend capability',async()=>{
  const trap=new Proxy({},{get(){throw Error('ordinary startup must stay inert');}});
  await run({app:trap,window:trap,backend:trap,configPath:''});
});
function uploads(Worker){
  const context={window:{},document:{currentScript:{src:'http://localhost/static/library-upload.js'}},URL,Worker,ArrayBuffer,DOMException,TextDecoder,Map,setTimeout,clearTimeout};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/library-upload.js'),'utf8'),context);
  return context.window.HDRLibraryUpload;
}
test('worker construction and asynchronous start failures reject promptly',async()=>{
  await assert.rejects(uploads(class{constructor(){throw Error('start failed');}}).send('/upload',{}),/start failed/);
  let worker;const api=uploads(class{constructor(){worker=this;}postMessage(){}terminate(){}});
  const task=api.send('/upload',{body:new ArrayBuffer(8)});worker.onerror();await assert.rejects(task,/could not start/);
});
test('backend error status reaches caller and transferred buffer is listed',async()=>{
  let worker,message,transfer;const api=uploads(class{constructor(){worker=this;}postMessage(m,t){message=m;transfer=t;}terminate(){}});
  const body=new ArrayBuffer(8),task=api.send('/upload',{body});assert.equal(transfer[0],body);
  worker.onmessage({data:{id:message.id,ok:false,status:409,text:'changed'}});
  const result=await task;assert.equal(result.ok,false);assert.equal(result.status,409);assert.equal(result.text,'changed');
});
test('cancelled photo settles and tells the worker to abort',async()=>{
  const messages=[];const api=uploads(class{postMessage(m){messages.push(m);}terminate(){}});
  const controller=new AbortController(),task=api.send('/upload',{body:new ArrayBuffer(8),signal:controller.signal});
  controller.abort();await assert.rejects(task,{name:'AbortError'});assert.equal(messages.at(-1).cancel,messages[0].id);
  await assert.rejects(api.send('/upload',{signal:controller.signal}),{name:'AbortError'});
});
test('worker converts HTTP and network failures into settled responses',async()=>{
  const replies=[];let fetchCall;
  const context={self:{postMessage:v=>replies.push(v)},AbortController,fetch:async(url,args)=>{fetchCall=args;return {ok:false,status:503,text:async()=>'{"detail":"unavailable"}'};}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/library-upload-worker.js'),'utf8'),context);
  await context.self.onmessage({data:{id:1,url:'/upload',body:new ArrayBuffer(8)}});
  assert.equal(replies[0].status,503);assert.ok(fetchCall.signal);
  context.fetch=async()=>{throw Error('network failed');};await context.self.onmessage({data:{id:2,url:'/upload'}});
  assert.match(replies[1].error,/network failed/);
});
test('quick check refuses ordinary and external profiles before touching page or backend',async()=>{
  const trap=new Proxy({},{get(){throw Error('unexpected capability access');}});
  await assert.rejects(run({app:{getPath:()=> 'C:\\Users\\Steve\\AppData\\Roaming\\hdr-finisher-desktop'},window:trap,backend:trap,configPath:'x'}),/test- profile/);
  await assert.rejects(run({app:{getPath:()=> 'D:\\scratch\\test-quick'},window:trap,backend:trap,configPath:'C:\\elsewhere\\quick-config.json'}),/inside the test profile/);
});

test('upload releases the transferred message root and collects its worker heap',async()=>{
 const body=new ArrayBuffer(16),data={id:7,url:'/upload',body};let sent,collections=0;
 const context={self:{postMessage:()=>{}},AbortController,Promise,
  gc:options=>{collections++;assert.equal(options.flavor,'last-resort');},
  fetch:async(url,args)=>{sent=args.body;return {ok:true,status:200,text:async()=>''};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/library-upload-worker.js'),'utf8'),context);
 await context.self.onmessage({data});assert.equal(sent,body);assert.equal(data.body,null);assert.equal(collections,1);
});

test('source response headers and bytes survive worker transfer, including error JSON',async()=>{
 let worker,message;const api=uploads(class{constructor(){worker=this;}postMessage(m){message=m;}terminate(){}});
 const task=api.fetchSource('/source',{body:'{}'});assert.equal(message.responseType,'buffer');
 const body=new TextEncoder().encode('{"detail":"no source"}').buffer;
 worker.onmessage({data:{id:message.id,ok:false,status:422,body,headerEntries:[['content-type','application/json']]}});
 const response=await task;assert.equal(response.status,422);assert.equal(response.headers.get('Content-Type'),'application/json');
 assert.equal(await response.arrayBuffer(),body);assert.equal((await response.json()).detail,'no source');
 const replies=[];const context={self:{postMessage:(value,transfer)=>replies.push({value,transfer})},AbortController,
  fetch:async()=>({ok:true,status:200,headers:new Map([['x-meta','yes']]),arrayBuffer:async()=>body})};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/library-upload-worker.js'),'utf8'),context);
 await context.self.onmessage({data:{id:9,url:'/source',responseType:'buffer'}});
 assert.equal(replies[0].value.body,body);assert.equal(replies[0].transfer[0],body);
});


test('picture progress uses page time, ignores pre-browse events and duplicate draws',()=>{
 const {pictures}=require('../tools/library-quick-metrics.cjs');
 const result=pictures([{stage:'picture_shown',path:'D:/copy/a.jpg',at:99},
  {stage:'picture_shown',path:'D:/copy/a.jpg',at:250},
  {stage:'picture_shown',path:'D:/copy/a.jpg',at:900},
  {stage:'picture_camera_preview_decoded',path:'D:/copy/a.jpg',at:200}],100);
 assert.equal(result.shown.get('D:/copy/a.jpg'),.15);assert.equal(result.preview.get('D:/copy/a.jpg'),.1);
 assert.equal(result.shown.size,1);
});
test('photo coverage includes every eligible photo, not just the pictured subset',()=>{
 const {coverage}=require('../tools/library-quick-metrics.cjs');
 const files=Array.from({length:33},(_,index)=>`/photos/${index}.jpg`);
 const shown=new Map(files.slice(0,29).map(file=>[file,1]));
 assert.deepEqual(coverage(files,shown),{eligible:33,pictured:29,complete:false,missing:files.slice(29)});
 for(const file of files)shown.set(file,1);
 assert.equal(coverage(files,shown).complete,true);
 assert.equal(coverage([],shown).complete,false);
});
test('per-photo diagnostics separate unrequested files, memory waits and decode failures',()=>{
 const {photoDiagnostics}=require('../tools/library-quick-metrics.cjs');
 const files=['/camera/a.ARW','/camera/b.exr','/camera/c.raf','/camera/d.dng'];
 const events=[{stage:'picture_work_waiting',path:files[0],at:200},
  {stage:'picture_shown',path:files[0],at:700,reason:'camera picture'},
  {stage:'picture_shown',path:files[0],at:1700,reason:'camera picture'},
  {stage:'picture_work_waiting',path:files[1],at:200},
  {stage:'picture_work_failed',path:files[1],at:500,reason:'decode failed'},
  {stage:'picture_work_waiting',path:files[3],at:300}];
 const log=[{request:'a',path:files[0],granted_at:1,wait_ms:20},
  {request:'d',path:files[3],granted_at:null,wait_ms:60000,reason:'system reserve'}]
  .map(d=>'[library] library_grant_completed '+JSON.stringify(d)).join('\n');
 const result=photoDiagnostics(files,events,100,log,{jobs:[{path:files[3],reason:'system reserve'}]},{});
 assert.equal(result.photos[0].first_picture_s,.6);
 assert.equal(result.photos[0].request_to_picture_s,.5);
 assert.equal(result.by_type.ARW.granted,1);
 assert.equal(result.by_type.EXR.failures,1);
 assert.equal(result.by_type.RAF.requested,0);
 assert.equal(result.by_type.DNG.ungranted,1);
 assert.deepEqual(result.by_type.DNG.wait_reasons,['system reserve']);
 assert.equal(result.photos[3].pending_grants[0].reason,'system reserve');
});
test('same-named photos in different folders are counted separately',()=>{
 const {pictures,coverage}=require('../tools/library-quick-metrics.cjs');
 const files=['D:/one/a.jpg','D:/two/a.jpg'];
 const shown=pictures([{stage:'picture_shown',path:files[0],at:200}],100).shown;
 assert.deepEqual(coverage(files,shown),{eligible:2,pictured:1,complete:false,missing:[files[1]]});
});
test('viewport coverage excludes unvisited rows but still catches a visible photo never requested',()=>{
 const {viewportCoverage}=require('../tools/library-quick-metrics.cjs');
 const files=Array.from({length:33},(_,i)=>`/photos/${i}.arw`);
 const seen=files.slice(0,6).map(path=>({path}));
 const shown=new Map(files.slice(0,6).map(path=>[path,1]));
 const result=viewportCoverage(files,seen,shown);
 assert.equal(result.complete,true);assert.equal(result.eligible,6);
 assert.equal(result.unvisited.length,27);
 shown.delete(files[5]);
 assert.deepEqual(viewportCoverage(files,seen,shown).missing,[files[5]]);
 assert.equal(viewportCoverage(files,[],shown).complete,false);
});
test('hidden windows and absent frame evidence invalidate drawing-gap measurements',()=>{
 const {visibility}=require('../tools/library-quick-metrics.cjs');
 assert.equal(visibility({hidden:true,native_hidden:false,frames:300}).valid,false);
 assert.equal(visibility({hidden:false,native_hidden:false,frames:0}).valid,false);
 assert.equal(visibility({hidden:false,native_hidden:false,frames:300}).valid,true);
 assert.equal(visibility({hidden:false,native_hidden:true,frames:300}).valid,false);
 assert.equal(visibility({hidden:false,frames:300}).valid,false);
 assert.equal(visibility().valid,false);
});
test('native hide and minimize events stay recorded even after the window returns',()=>{
 const {EventEmitter}=require('node:events');
 const {observeVisibility}=require('../desktop/quick-library-test.cjs');
 for(const event of ['hide','minimize']){
  const window=Object.assign(new EventEmitter(),{isVisible:()=>true,isMinimized:()=>false});
  const observer=observeVisibility(window);
  assert.equal(observer.result.hidden,false);
  window.emit(event);window.emit('show');window.emit('restore');
  assert.equal(observer.result.hidden,true);
  observer.stop();assert.equal(window.listenerCount(event),0);
 }
 for(const state of [{visible:false,minimized:false},{visible:true,minimized:true}]){
  const window=Object.assign(new EventEmitter(),{isVisible:()=>state.visible,isMinimized:()=>state.minimized});
  const observer=observeVisibility(window);assert.equal(observer.result.hidden,true);observer.stop();
 }
});


test('picture wait includes browse/scroll time before the probe was queued',()=>{
 const {photoDiagnostics}=require('../tools/library-quick-metrics.cjs');
 const files=['/photos/a.arw','/photos/b.arw'];
 const events=[{stage:'picture_work_waiting',path:files[0],at:200},{stage:'picture_work_waiting',path:files[1],at:1500},
  {stage:'picture_shown',path:files[0],at:2000,reason:'camera picture'},{stage:'picture_shown',path:files[1],at:2000,reason:'camera picture'}];
 const rows=photoDiagnostics(files,events,100,'',{}, {}, {},[{at:100},{at:1300}]).photos;
 assert.equal(rows[0].action_to_picture_s,1.9);assert.equal(rows[1].action_to_picture_s,.7);
 assert.equal(rows[1].request_to_picture_s,.5);
});
