const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
test('streamed detail bands transfer once, upload bounded pieces and release ownership',async()=>{
 const chunks=[],calls=[];let worker;
 const context={ArrayBuffer,Uint8Array,AbortController,crypto:require('node:crypto').webcrypto,
  setTimeout:fn=>setImmediate(fn),self:{postMessage:data=>worker.onmessage({data})},
  fetch:async(url,options)=>{
   calls.push([url,options]);
   if(url.includes('?offset=')){chunks.push(Buffer.from(options.body));return {ok:true,status:200};}
   return {ok:true,status:200,text:async()=>'{"native_ready":true}'};
  }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/library-upload-worker.js'),'utf8'),context);
 class Worker{
  constructor(){worker=this;}
  postMessage(data,transfer){const received=structuredClone(data,{transfer});context.self.onmessage({data:received});}
 }
 const page={ArrayBuffer,URL,Worker,DOMException,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,document:{currentScript:{src:'http://app/static/library-upload.js'}},window:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/library-upload.js'),'utf8'),page);
 const parts=[new Uint8Array([1,2,3,4]).buffer,new Uint8Array(9*1024*1024).fill(7).buffer];
 const expected=Buffer.concat(parts.map(p=>Buffer.from(p)));
 const upload=page.window.HDRLibraryUpload.stream('/api/library/raw-developed',{total:expected.length});
 assert.equal((await upload.open()).ok,true);
 for(const part of parts)assert.equal((await upload.write(part)).ok,true);
 const result=await upload.end();
 assert.equal(result.ok,true);assert.deepEqual(JSON.parse(result.text),{native_ready:true});
 assert.ok(parts.every(p=>p.byteLength===0),'window relinquishes each band');
 assert.ok(chunks.every(c=>c.length<=4*1024*1024));assert.deepEqual(Buffer.concat(chunks),expected);
 assert.equal(calls.at(-1)[1].method,'DELETE');
 assert.ok(calls.at(-2)[1].headers['X-Library-Native-Upload']);
});


test('receiving memory refusal releases the producer instead of polling with its planes held',async()=>{
 const calls=[];let reply;
 const context={Uint8Array,AbortController,crypto:require('node:crypto').webcrypto,
  self:{postMessage:data=>reply=data},
  fetch:async(url,options)=>{calls.push([url,options.method]);return {ok:true,status:202};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/library-upload-worker.js'),'utf8'),context);
 await context.self.onmessage({data:{id:1,stream:{kind:'open',key:'k',url:'/api/library/live-developed',total:16}}});
 await context.self.onmessage({data:{id:2,stream:{kind:'write',key:'k'},buffer:new ArrayBuffer(16)}});
 assert.equal(reply.status,503);assert.match(JSON.parse(reply.text).detail,/Waiting for memory/);
 // The producer (sendStreamed) cancels on any refusal, then frees its GPU planes.
 await context.self.onmessage({data:{stream:{kind:'cancel',key:'k'}}});
 assert.equal(calls.length,2,'one admission, then ownership release; never poll while holding full output');
 assert.equal(calls.at(-1)[1],'DELETE');
});
