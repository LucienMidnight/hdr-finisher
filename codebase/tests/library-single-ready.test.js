const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {create}=require('../frontend/library-ready-window');
test('Single swaps the correct finished canvas and hides the previous grade while a replacement waits',async()=>{
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  async function showSingle()'),source.indexOf('  function positionZoom()'));
 const a={path:'a',name:'a',bytes:1,mtime_ns:1,grade_identity:'old'},b={...a,path:'b',name:'b'};
 let visible,block=null;const disposed=[];
 const canvas=photo=>({id:'',hidden:false,style:{},dataset:{picturePath:photo.path,pictureKey:photo.grade_identity,pictureEdge:2560},pixels:photo.path+':'+photo.grade_identity,
  removeAttribute(name){if(name==='id')this.id='';},replaceWith(next){visible=next;},getContext(){return {unconfigure(){}};}});
 visible=canvas(a);visible.id='single-picture';visible.hidden=true;
 const state={active:true,view:'single',photos:[a,b],index:0,displayEpoch:0,hdr:false};
 const key=p=>p.path+':'+p.grade_identity;
 const readyWindow=create({key,load:async p=>{const value={canvas:canvas(p),meta:{key:p.grade_identity,edge:2560}};if(block)await block;return value;},dispose:value=>{disposed.push(value);if(value.canvas===visible)value.canvas.hidden=true;}});
 const surfaces={has:()=>true,get:()=>undefined};
 const context={state,navigationTrace:null,selected:()=>state.photos[state.index],singleEdge:()=>2560,readyKey:key,readyWindow,readySurfaces:surfaces,
   HDRLibraryScenes:{review(){},save(){}},quickWindow:{update(){},get:async()=>null},navigationGate:{touch(){}},beforeSource:async()=>{},showQuick(){},showCameraPreview(){},performance,
   readAhead:{update(){}},developmentNeighbours:()=>[],developAhead(){},
  compare:{enabled:()=>false,hide(){}},HDRLibraryTrace:{begin:()=>({}),end(){},mark(){},present:(trace,current)=>{assert.ok(current());assert.equal(visible.pixels,key(state.photos[state.index]));}},
  restoreStandIn(){},showStandIn(){},AbortController,positionZoom(){},updateSingleCaption(){},status(){},startRawAhead(){},readyNeighbours:()=>[a,b].filter(p=>p!==state.photos[state.index]),warmReady(){},overlays:null,
  HDRLibraryPictures:{usable:()=>true},loadAndShow:()=>assert.fail('Unexpected fallback'),aborted:e=>e.name==='AbortError',removeUnreadable:(_p,e)=>{throw e;},$:id=>id==='single-picture'?visible:{hidden:true}};
 vm.runInNewContext(fn+';this.showSingle=showSingle;',context);
 await context.showSingle();assert.equal(visible.pixels,'a:old');
 state.index=1;await readyWindow.get(b);const previous=visible;const swapping=context.showSingle();assert.equal(previous.hidden,false,'Ready swap preserves the displayed surface until replacement');await swapping;assert.equal(visible.pixels,'b:old');
 state.index=0;await context.showSingle();assert.equal(visible.pixels,'a:old');
 a.grade_identity='new';let release;block=new Promise(r=>release=r);
 const pending=context.showSingle();await Promise.resolve();assert.equal(visible.hidden,true);
 release();await pending;assert.equal(visible.pixels,'a:new');assert.equal(visible.hidden,false);
 assert.equal(visible.dataset.picturePath,'a');assert.equal(visible.dataset.pictureKey,'new');
});

test('camera quick draw rejects edits, navigation changes and late delivery after HDRF pixels',async()=>{
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  async function showCameraPreview('),source.indexOf('  HDRLibraryScenes.onReclaim'));
 for(const change of ['none','edited','navigated','source','thumbnail','sharp','quick']){
  const photo={path:'a',type:'ARW',bytes:1,mtime_ns:1,edited:change==='edited'};let selected=photo,sharp=false,thumbnail=false,quick=null,requests=0,presents=0;
  const images=[],stage={querySelector:()=>quick,append(image){images.push(image);image.isConnected=true;quick=image;}};
  const context={photo,rawTypes:new Set(['ARW']),pictureIdentity:p=>`${p.path}|${p.bytes}|${p.mtime_ns}`,selected:()=>selected,
   readyWindow:{has:()=>sharp},quickWindow:{has:()=>thumbnail},performance,console,AbortController,
   fetch:async()=>{requests++;return {status:200,json:async()=>({url:'camera',route:'camera-preview'})};},
   document:{createElement:()=>({dataset:{},style:{},isConnected:false,async decode(){
    if(change==='navigated')selected={...photo,path:'b'};if(change==='source')photo.mtime_ns=2;
    if(change==='thumbnail')thumbnail=true;if(change==='sharp')sharp=true;if(change==='quick')quick={};
   },remove(){this.isConnected=false;quick=null;},removeAttribute(){}})},$:()=>stage,restoreStandIn(){},pictureMode(image,hdr){assert.equal(hdr,false);},
   HDRLibraryTrace:{mark(){},present(_trace,current,fields){assert.ok(current());assert.equal(fields.picture_size,'camera preview');presents++;}},aborted:e=>e.name==='AbortError'};
  vm.runInNewContext(fn+';this.showCameraPreview=showCameraPreview;',context);
  const controller=new AbortController();await context.showCameraPreview(photo,controller,()=>true,{});
  assert.equal(requests,change==='edited'?0:1);assert.equal(presents,change==='none'?1:0);
  assert.equal(images.length,change==='none'?1:0);
  if(change==='none'){assert.equal(images[0].dataset.picturePath,'a');controller.abort();assert.equal(images[0].isConnected,false);}
 }
});

test('selected Denoise measurements pass queued neighbours while quick draws stay independent',async()=>{
 const source=fs.readFileSync(require.resolve('../frontend/library-gpu'),'utf8');
 const fn=source.slice(source.indexOf('const libraryDenoiseModels'),source.indexOf('class HDRLibraryGPU'));
 let release;const block=new Promise(r=>release=r),calls=[];
 const context={HDRLibrarySceneScheduler:require('../frontend/library-scene-scheduler'),fetch:async url=>{
  calls.push(url);if(url==='running')await block;return {ok:true,json:async()=>({url})};}};
 vm.runInNewContext(fn+';this.model=libraryDenoiseModel;',context);
 const meta=(path,priority,edge=2560)=>({path,draw_priority:priority,edge});
 const first=context.model('running',meta('a',5));await new Promise(r=>setImmediate(r));
 const neighbour=context.model('neighbour',meta('b',5));
 const selected=context.model('selected',meta('c',0));
 const quick=context.model('quick',meta('c',0,640));await quick;
 assert.deepEqual(calls,['running','quick']);release();await Promise.all([first,selected,neighbour]);
 assert.deepEqual(calls,['running','quick','selected','neighbour']);
 await context.model('selected',meta('c',0));assert.equal(calls.length,4,'Exact model reused');
});


test('memory polling preserves the stopped selection during source work and still yields to delivery',async()=>{
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  async function pollReadyMemory()'),source.indexOf('  setInterval(pollReadyMemory'));
 let invalidated=0,finished=false,sourceActive=1,budget=100,permit={ready:true,idle:false};
 const context={readyPolling:false,readyBytes:50,state:{active:true,view:'single',singleIdentity:'selected'},
   api:async()=>permit,HDRLibraryPictures:{readyMemory:async()=>budget},
   HDRLibraryScenes:{snapshot:()=>({draws:{active:0},sources:{active:sourceActive},probes:{active:0}})},
   tilePool:{snapshot:()=>({bytes:0})},quickWindow:{invalidate(){}},readyWindow:{has:()=>finished,invalidate:()=>invalidated++},selected:()=>({path:'a'}),compare:{enabled:()=>false}};
 vm.runInNewContext(fn+';this.poll=pollReadyMemory;',context);
 await context.poll();assert.equal(invalidated,0,'Pending selected photo finishes');
 finished=true;await context.poll();assert.equal(invalidated,0,'Neighbour source does not evict selected surface');
 sourceActive=0;await context.poll();assert.equal(invalidated,1,'Other delivery gets its memory');
 permit={ready:false,idle:false};sourceActive=1;await context.poll();assert.equal(invalidated,2,'Grade still preempts');
 permit={ready:true,idle:true};budget=25;await context.poll();assert.equal(invalidated,2,'Own reservation must not cancel its draw');
 sourceActive=0;await context.poll();assert.equal(invalidated,3,'Existing budget still enforced');
});
