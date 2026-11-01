const {test}=require('node:test'),assert=require('node:assert/strict');
const {Writable}=require('node:stream');
const {create}=require('../desktop/lib/backend-log');
test('slow diagnostic disk has bounded buffers and reports omitted records',async()=>{
 let complete;const output=[];
 const sink=new Writable({highWaterMark:16,write(chunk,encoding,callback){output.push(chunk.toString());complete=callback;}});
 const log=create(sink,1024);
 for(let i=0;i<10000;i++)log('x'.repeat(100));
 assert.ok(sink.writableLength<=1024);
 while(sink.writableLength){complete();await new Promise(r=>setImmediate(r));}
 assert.ok(output.some(line=>line.includes('log_overload')));
 sink.end();
});
