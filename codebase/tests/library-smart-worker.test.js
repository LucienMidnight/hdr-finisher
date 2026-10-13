const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const q=require("../frontend/library-query");
test("worker caches counts and choices, checks versions, and invalidates on index change",async()=>{
 const photos=[{path:"D:/a.jpg",name:"a.jpg",type:"JPG",marks:{rating:5}},{path:"D:/b.jpg",name:"b.jpg",type:"JPG",marks:{rating:0}}];
 let stamp="one",fail=false,counts=0,choices=0;const requests=[],messages=[];
 const context={HDRLibraryQuery:{...q,count(...args){counts++;return q.count(...args);},values(...args){choices++;return q.values(...args);}},
  importScripts(){},self:{postMessage(message){messages.push(message);}},fetch:async url=>{
   requests.push(url);if(fail)throw new Error("offline");
   return {ok:true,json:async()=>({version:stamp,photos:url.endsWith(`version=${stamp}`)?null:structuredClone(photos),indexing:false})};
  }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../frontend/library-smart-worker.js"),"utf8"),context);
 let id=0;const send=async(action,extra={})=>{await context.self.onmessage({data:{id:++id,action,...extra}});return messages.at(-1);};
 const filters={rules:[{field:"rating",value:5,op:"is"}]};
 assert.equal((await send("refresh",{filters})).result.count,1);
 assert.equal((await send("count",{filters})).result.count,1);assert.equal(counts,1);
 assert.deepEqual(Array.from((await send("paths",{filters})).result),["D:/a.jpg"]);
 await send("values",{field:"type"});await send("values",{field:"type"});assert.equal(choices,1);
 await send("refresh",{filters});assert.equal(counts,1);assert.equal(requests.at(-1),"/api/library/smart-candidates?version=one");
 assert.equal((await send("candidates",{knownVersion:"one"})).result.photos,null);
 stamp="two";photos[1].marks.rating=5;
 assert.equal((await send("refresh",{filters})).result.count,2);assert.equal(counts,2);
 await send("values",{field:"type"});assert.equal(choices,2);
 assert.equal((await send("candidates",{knownVersion:"one"})).result.photos.length,2);
 fail=true;assert.equal((await send("refresh",{filters})).error,"offline");
 fail=false;assert.equal((await send("refresh",{filters})).result.count,2);
});
