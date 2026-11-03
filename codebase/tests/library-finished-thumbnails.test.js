const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup({stale=false}={}){
  const writes=[],requests=[];
  const gpu={configureSurface:()=>({format:'bgra8unorm'}),device:{queue:{writeTexture:(_dst,body)=>writes.push([...body]),onSubmittedWorkDone:async()=>{}}}};
  const context={navigator:{gpu:{getPreferredCanvasFormat:()=>"bgra8unorm"}},console,performance,URLSearchParams,TextDecoder,TextEncoder,DataView,Uint8Array,DOMException,queueMicrotask,
    HDRLibraryPictures:{initialize:async()=>gpu},HDRLibraryStopwatch:()=>{},
    fetch:async(url,options)=>{
      requests.push(url);const paths=JSON.parse(options.body).paths;assert.ok(paths.length<=32);const parts=paths.map((_,i)=>Uint8Array.from([i+1,2,3,4]));
      let offset=0;
      const rows=paths.map((path,i)=>{const row={path,offset,length:parts[i].length,meta:{key:'surface-'+i,width:1,height:1,stride:4,identity:{format:"bgra8unorm",bytes:12,mtime_ns:100,grade:stale?'changed':'grade'}}};offset+=parts[i].length;return row;});
      const header=new TextEncoder().encode(JSON.stringify(rows)),body=new Uint8Array(4+header.length+offset);
      new DataView(body.buffer).setUint32(0,header.length,true);body.set(header,4);parts.forEach((p,i)=>body.set(p,4+header.length+rows[i].offset));
      return {ok:true,arrayBuffer:async()=>body.buffer};
    }};
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('frontend/library-finished-thumbnails.js','utf8'),context);
  const canvas=()=>({dataset:{},getContext:()=>({getCurrentTexture:()=>({})})});
  const load=(path,options={})=>{const target=canvas();return {target,promise:context.HDRLibraryFinishedThumbnails.load({path,bytes:12,mtime_ns:100,grade_identity:'grade'},target,options.signal||new AbortController().signal,options.current||(()=>true),false)}};
  return {load,writes,requests};
}
test('visible stored surfaces share one request and upload the original exact bytes',async()=>{
  const s=setup(),a=s.load('a'),b=s.load('b');
  const results=await Promise.all([a.promise,b.promise]);
  assert.equal(s.requests.length,1);assert.match(s.requests[0],/finished-thumbnails/);
  assert.deepEqual(s.writes,[[1,2,3,4],[2,2,3,4]]);assert.equal(results[0].route,'finished-thumbnail');
  assert.equal(a.target.dataset.picturePath,'a');assert.equal(b.target.dataset.picturePath,'b');
});
test('a known changed grade cannot upload an old finished surface',async()=>{
  const s=setup({stale:true});assert.equal(await s.load('a').promise,null);assert.deepEqual(s.writes,[]);
});
test('an abandoned cell cannot publish a cached surface',async()=>{
  const s=setup(),a=s.load('a',{current:()=>false});
  await assert.rejects(a.promise,{name:'AbortError'});assert.deepEqual(s.writes,[]);assert.equal(a.target.dataset.pictureKey,undefined);
});

test('72 visible finished thumbnails are fetched within the 32-path limit and all publish',async()=>{
 const s=setup(),items=Array.from({length:72},(_,i)=>s.load('photo-'+i));
 const results=await Promise.all(items.map(item=>item.promise));
 assert.equal(s.requests.length,3);assert.equal(s.writes.length,72);
 assert.ok(results.every(value=>value.route==='finished-thumbnail'));
});
