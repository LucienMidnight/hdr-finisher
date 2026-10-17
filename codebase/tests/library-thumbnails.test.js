const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../frontend/library-thumbnails');
const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
function image(){return {naturalWidth:100,naturalHeight:100,src:'',decode:async()=>{},style:{},dataset:{}};}
test('batch hits decode together while a miss remains pending, and mode needs no request',async()=>{
 let calls=0;const cache=create({identity:p=>p.path,image,api:async(_route,body)=>{calls++;return {ready:body.paths.filter(p=>p!=='miss').map(path=>({path,key:path,url:'/thumb/'+path})),pending:body.paths.filter(p=>p==='miss'),errors:[]};}});
 const shown=[image(),image()];await Promise.all(shown.map((img,i)=>cache.show({path:'photo'+i},100,img,()=>true,()=>false)));
 assert.equal(calls,1);assert.ok(shown.every(img=>img.src.startsWith('/thumb/')));
 const before=calls;cache.mode(shown[0],true);assert.equal(shown[0].style.dynamicRangeLimit,'no-limit');assert.equal(calls,before);
 cache.clear();
});
test('recent pool obeys budget and cleared in-flight decodes cannot repopulate it',async()=>{
 let release;const hold=new Promise(resolve=>release=resolve);
 const cache=create({identity:p=>p.path,budget:250000,image:()=>({...image(),decode:()=>hold}),api:async(_r,b)=>({ready:b.paths.map(path=>({path,key:path,url:'/thumb/'+path})),pending:[],errors:[]})});
 const img=image();const pending=cache.show({path:'a'},100,img,()=>true,()=>false);await tick();cache.clear();release();await assert.rejects(pending,/Cache changed/);await tick();assert.equal(cache.snapshot().bytes,0);
 const bounded=create({identity:p=>p.path,image,budget:250000,api:async(_r,b)=>({ready:b.paths.map(path=>({path,key:path,url:'/thumb/'+path})),pending:[],errors:[]})});
 await Promise.all(['a','b','c'].map(path=>bounded.show({path},100,image(),()=>true,()=>false)));assert.ok(bounded.snapshot().bytes<=250000);bounded.clear();
});
