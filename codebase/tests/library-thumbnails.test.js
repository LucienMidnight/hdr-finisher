const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../frontend/library-thumbnails');
const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
function image(){return {naturalWidth:100,naturalHeight:100,src:'',decode:async()=>{},style:{},dataset:{}};}
test('batch hits decode together while a miss remains pending, and mode needs no request',async()=>{
 let calls=0;const cache=create({identity:p=>p.path,image,api:async(_route,body)=>{calls++;return {ready:body.paths.filter(p=>p!=='miss').map(path=>({path,key:path,url:'/thumb/'+path})),pending:body.paths.filter(p=>p==='miss'),errors:[]};}});
 const shown=[image(),image()];await Promise.all(shown.map((img,i)=>cache.show({path:'photo'+i},100,img,()=>true,()=>false,()=>assert.fail('A cache hit must not request a scene fallback'))));
 assert.equal(calls,1);assert.ok(shown.every(img=>img.src.startsWith('/thumb/')));
 const before=calls;
 await cache.show({path:'photo0'},100,image(),()=>true,()=>false,()=>assert.fail('A recent-pool hit must not request a scene fallback'));
 assert.equal(calls,before,'A recent-pool hit needs no metadata request');
 cache.mode(shown[0],true);assert.equal(shown[0].style.dynamicRangeLimit,'no-limit');assert.equal(calls,before);
 cache.clear();
});
test('recent pool obeys budget and cleared in-flight decodes cannot repopulate it',async()=>{
 let release;const hold=new Promise(resolve=>release=resolve);
 const cache=create({identity:p=>p.path,budget:250000,image:()=>({...image(),decode:()=>hold}),api:async(_r,b)=>({ready:b.paths.map(path=>({path,key:path,url:'/thumb/'+path})),pending:[],errors:[]})});
 const img=image();const pending=cache.show({path:'a'},100,img,()=>true,()=>false);await tick();cache.clear();release();await assert.rejects(pending,/Cache changed/);await tick();assert.equal(cache.snapshot().bytes,0);
 const bounded=create({identity:p=>p.path,image,budget:250000,api:async(_r,b)=>({ready:b.paths.map(path=>({path,key:path,url:'/thumb/'+path})),pending:[],errors:[]})});
 await Promise.all(['a','b','c'].map(path=>bounded.show({path},100,image(),()=>true,()=>false)));assert.ok(bounded.snapshot().bytes<=250000);bounded.clear();
});

test('a miss draws immediately while gain-map creation is still pending, once per cell',async()=>{
 let finished=false,misses=0;
 const cache=create({identity:p=>p.path,image,api:async(_r,b)=>({ready:finished?b.paths.map(path=>({path,key:path,url:'/thumb/'+path})):[],pending:finished?[]:b.paths,errors:[]})});
 const img=image();let shown=false;
 const pending=cache.show({path:'cold'},100,img,()=>true,()=>false,()=>{misses++;assert.equal(img.src,'');}).then(()=>shown=true);
 await tick();assert.equal(misses,1);assert.equal(shown,false);
 await tick();assert.equal(misses,1);
 finished=true;await pending;assert.equal(img.src,'/thumb/cold');assert.equal(misses,1);cache.clear();
});
