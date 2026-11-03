const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
test('native planes transfer once, upload bounded pieces, wait for memory and release ownership',async()=>{
 const chunks=[],calls=[];let waited=false,worker;
 const context={ArrayBuffer,Uint8Array,AbortController,crypto:require('node:crypto').webcrypto,
  setTimeout:fn=>setImmediate(fn),self:{postMessage:data=>worker.onmessage({data})},
  fetch:async(url,options)=>{
   calls.push([url,options]);
   if(url.includes('?offset=0&')&&!waited){waited=true;return {ok:true,status:202};}
   if(url.includes('?offset=')){chunks.push(Buffer.from(options.body));return {ok:true,status:200};}
   return {ok:true,status:200,text:async()=>'{"native_ready":true}'};
  }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/library-upload-worker.js'),'utf8'),context);
 class Worker{
  constructor(){worker=this;}
  postMessage(data,transfer){const received=structuredClone(data,{transfer});context.self.onmessage({data:received});}
 }
 const page={ArrayBuffer,URL,Worker,DOMException,setTimeout,clearTimeout,document:{currentScript:{src:'http://app/static/library-upload.js'}},window:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/library-upload.js'),'utf8'),page);
 const parts=[new Uint8Array([1,2,3,4]).buffer,new Uint8Array(9*1024*1024).fill(7).buffer];
 const expected=Buffer.concat(parts.map(p=>Buffer.from(p)));
 const result=await page.window.HDRLibraryUpload.send('/api/library/raw-developed',{parts});
 assert.equal(result.ok,true);assert.deepEqual(JSON.parse(result.text),{native_ready:true});
 assert.ok(parts.every(p=>p.byteLength===0),'window relinquishes its planes');
 assert.ok(chunks.every(c=>c.length<=4*1024*1024));assert.deepEqual(Buffer.concat(chunks),expected);
 assert.ok(waited);assert.equal(calls.at(-1)[1].method,'DELETE');
 assert.ok(calls.at(-2)[1].headers['X-Library-Native-Upload']);
});
