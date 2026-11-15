const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../frontend/grade-opening');

for(const failure of ['http','network'])test(`a failed ${failure} presentation POST retries without another picture and success is idempotent`,async()=>{
  let calls=0,retry;
  const opening=create({fetch:async()=>{calls++;if(calls===1&&failure==='network')throw Error('Disconnected');return {ok:calls>1};},current:()=>true,timer:fn=>{retry=fn;},clear(){}});
  await opening.acknowledge('session');
  assert.equal(calls,1);assert.equal(typeof retry,'function');
  await retry();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2);
  await opening.acknowledge('session');assert.equal(calls,2);
  opening.reset();await opening.acknowledge('session');assert.equal(calls,3);
});

test('a terminal preview failure retires the session opening and preserves its visible error',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('frontend/viewer-status.js','utf8'),retired=[];
  const context={state:{session:{session_id:'failed-session'}},window:{HDRGradeOpenFailed:id=>retired.push(id)},previewStatusText:value=>value,geometrySignature:()=>'',syncViewerStatusEntry(){}};
  const failure=source.slice(source.indexOf('function setPreviewError('),source.indexOf('function hidePreviewMessage('));
  vm.runInNewContext(failure+';setPreviewError("No picture available");',context);
  assert.deepEqual(retired,['failed-session']);assert.equal(context.state.previewStatusEntry.message,'No picture available');assert.equal(context.state.previewStatusEntry.severity,'error');
});

test('retirement cancels a retry, and a disconnected renderer closes its ownership channel',async()=>{
  let retry,closed=false;const messages=[];
  const socket={readyState:1,send:message=>messages.push(JSON.parse(message)),close(){closed=true;this.onclose();}};
  const opening=create({fetch:async()=>{throw Error('network');},current:()=>true,socket:()=>socket,
    timer:fn=>{retry=fn;},clear(){retry=null;},interval:()=>1,clearIntervalFn(){}});
  const connected=opening.connect();socket.onopen();socket.onmessage({data:JSON.stringify({owner:'owner'})});
  assert.equal(await connected,'owner');
  await opening.acknowledge('session');assert.ok(retry);
  opening.retire('session');assert.equal(retry,null);assert.deepEqual(messages,[{type:'retire',session_id:'session'}]);
  opening.close();assert.equal(closed,true);
});

test('a late acknowledgement for the same session cannot acknowledge its newer import ticket',async()=>{
  let release,retry;const urls=[];
  const opening=create({fetch:async url=>{urls.push(url);if(urls.length===1)await new Promise(resolve=>release=resolve);return {ok:true};},
    current:()=>true,timer:fn=>{retry=fn;},clear(){}});
  opening.reset('first');const old=opening.acknowledge('session');
  opening.reset('second');await opening.acknowledge('session');release();await old;
  await retry();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(new URL(urls[0],'http://test').searchParams.get('job_id'),'first');
  assert.equal(new URL(urls[1],'http://test').searchParams.get('job_id'),'second');assert.equal(urls.length,2);
});
