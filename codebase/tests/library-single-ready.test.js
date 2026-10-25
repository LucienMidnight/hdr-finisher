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
  HDRLibraryScenes:{review(){},save(){}},quickWindow:{update(){},get:async()=>null},navigationGate:{touch(){}},beforeSource:async()=>{},showQuick(){},performance,
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
