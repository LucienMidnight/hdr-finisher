const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const scheduler=require('../frontend/library-scene-scheduler');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function setup(plans,develop){
 let time=0;const requests=[];
 const context={window:{},HDRLibrarySceneScheduler:scheduler,AbortController,DOMException,setTimeout,clearTimeout,
  performance:{now:()=>time},console,
  HDRLibraryGpuRaw:{enabled:()=>true,liveScene:develop},
  fetch:async(url,options)=>{requests.push(JSON.parse(options.body));if(url==="/api/library/live-scene")return {ok:false,json:async()=>({detail:"decoder failed"})};return {ok:true,json:async()=>plans[JSON.parse(options.body).path]};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/library-scenes.js'),'utf8'),context);
 return {scenes:context.window.HDRLibraryScenes,requests,advance:ms=>time+=ms};
}
test('cached pictures bypass occupied sources and any large format leaves room for small pictures',async()=>{
 const block=gate(),started=[];
 const {scenes}=setup({a:{bytes:96e6,revision:'a'},b:{bytes:400e6,revision:'b'},
  quick:{bytes:1e6,revision:'q'},cached:{cached:{edge:640,key:'cached'}}},async(p,edge)=>{
   started.push(p);if(p==='a'||p==='b')await block.promise;return {edge,key:p};
  });
 const a=scenes.load('a',640),b=scenes.load('b',640);await tick();
 assert.equal((await scenes.load('cached',640)).key,'cached');
 assert.equal((await scenes.load('quick',640)).key,'quick');
 assert.deepEqual(started,['a','quick']);
 block.resolve();await Promise.all([a,b]);assert.deepEqual(started,['a','quick','b']);
});
test('merged grid and selected demand survives one cancellation and reads the other cached size',async()=>{
 const block=gate(),started=[];
 const plans={photo:{bytes:96e6,revision:'1'}};
 const {scenes}=setup(plans,async(p,edge)=>{started.push(edge);await block.promise;
  plans.photo.cached={edge:2560,key:'large'};return {edge,key:'small'};});
 const cancel=new AbortController();const first=scenes.load('photo',640,cancel.signal,80);
 const selected=scenes.load('photo',2560,undefined,0);await tick();
 cancel.abort();await assert.rejects(first,{name:'AbortError'});block.resolve();
 assert.equal((await selected).key,'large');assert.deepEqual(started,[640]);
});
test('observed slow small files become expensive, and changed sources discard old timings',async()=>{
 const started=[];let block=gate(),hold=false;
 const plans={odd:{bytes:1,revision:'1'},other:{bytes:96e6,revision:'1'}};
 const {scenes,advance}=setup(plans,async(p,edge)=>{started.push(p);advance(3000);
  if(hold)await block.promise;return {edge};});
 await scenes.load('odd',640);hold=true;
 const a=scenes.load('other',640),b=scenes.load('odd',640);await tick();
 assert.deepEqual(started,['odd','other']);block.resolve();await Promise.all([a,b]);
 plans.odd.revision='2';block=gate();const c=scenes.load('other',640),d=scenes.load('odd',640);
 await tick();assert.deepEqual(started.slice(-2),['other','odd']);
 block.resolve();await Promise.all([c,d]);
});
test('cancelled pending expensive demand never starts and a failed preparation releases capacity',async()=>{
 const block=gate(),started=[];
 const {scenes}=setup({a:{bytes:96e6},b:{bytes:96e6},c:{bytes:96e6}},async(p,edge)=>{
  started.push(p);if(p==='a'){await block.promise;throw Error('decoder failed');}return {edge};});
 const a=scenes.load('a',640);const aError=assert.rejects(a,/decoder failed/);
 const cancel=new AbortController(),b=scenes.load('b',640,cancel.signal);await tick();
 cancel.abort();await assert.rejects(b,{name:'AbortError'});
 const c=scenes.load('c',640);block.resolve();await aError;await c;assert.deepEqual(started,['a','c']);
});
