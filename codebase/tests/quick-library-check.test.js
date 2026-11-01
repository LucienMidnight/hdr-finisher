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
