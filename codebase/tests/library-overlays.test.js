const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(probe){
 const elements=new Map(),requests=[],probes=[],messages=[],frames=[],timers=new Map();let timer=0;
 function element(id=''){
  const e={id,style:{},dataset:{},hidden:false,isConnected:true,width:10,height:10,clientWidth:10,clientHeight:10,listeners:{},children:[],classList:{contains:()=>false,toggle(){}},setAttribute(){},addEventListener(k,f){this.listeners[k]=f;},append(c){c.parentElement=this;this.children.push(c);},before(){},remove(){this.removed=true;},getContext:()=>({drawImage(){},getImageData:()=>({width:1,height:1,data:new Uint8ClampedArray(4)}),putImageData(){},clearRect(){}}),};
  Object.defineProperty(e,'innerHTML',{set(value){for(const match of value.matchAll(/<input id="([^"]+)"[^>]*>/g)){const input=element(match[1]),tag=match[0];input.type=tag.match(/type="([^"]+)"/)?.[1];input.checked=tag.includes('checked');input.value=tag.match(/value="([^"]+)"/)?.[1];elements.set(input.id,input);}}});return e;
 }
 elements.set('zoom-button',element());const body=element(),canvas=element('single-picture');body.append(canvas);
 const owner=new AbortController();const surfaces=[{photo:{path:'test.raw'},canvas,meta:{},controller:owner,current:()=>true}];
 const context={devicePixelRatio:1,ImageData:class{constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);}},fetch:async()=>({ok:true,blob:async()=>({})}),createImageBitmap:async()=>({width:1,height:1,close(){}}),window:{},document:{getElementById:id=>elements.get(id),createElement:()=>element(),body,querySelectorAll:()=>[],addEventListener(){}},AbortController,MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}},getComputedStyle:()=>({padding:'0'}),requestAnimationFrame:f=>(frames.push(f),frames.length),setTimeout:f=>{timers.set(++timer,f);return timer;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/library-overlays.js'),'utf8'),context);
 const overlay=context.window.HDRLibraryOverlays.create({surfaces:()=>surfaces,status:m=>messages.push(m),api:(url,data,signal)=>{if(data?.cache_only){probes.push({data,signal});return probe?probe(data,signal):Promise.resolve({cache_miss:true});}if(url.endsWith('overlay-switch'))return Promise.resolve({enabled:data.enabled});if(url.endsWith('review-preferences')){requests.push({url,data});return Promise.resolve(data);}return new Promise((resolve,reject)=>requests.push({url,data,signal,resolve,reject}));}});
 function surface(photo={...surfaces[0].photo},id='filmstrip-picture'){
  const next=element(id),controller=new AbortController();body.append(next);
  const entry={photo,canvas:next,meta:{},controller,current:()=>true};surfaces.push(entry);return entry;
 }
 return {overlay,requests,probes,messages,canvas,owner,elements,frames,timers,surface,surfaces};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('switching Exposure preserves Focus request and switching Focus preserves Exposure',async()=>{
 const h=setup();await h.overlay.toggle('focus',true);await tick();const focus=h.requests[0];await h.overlay.toggle('exposure',true);const exposure=h.requests[1];
 assert.equal(h.requests.length,2);assert.equal(focus.signal.aborted,false);
 await h.overlay.toggle('exposure',false);assert.equal(exposure.signal.aborted,true);assert.equal(focus.signal.aborted,false);
 exposure.resolve({unavailable:'late failure'});await tick();assert.deepEqual(h.messages,[]);
 await h.overlay.toggle('exposure',true);const next=h.requests[2];await h.overlay.toggle('focus',false);
 assert.equal(focus.signal.aborted,true);assert.equal(next.signal.aborted,false);assert.equal(h.requests.length,3);
 h.owner.abort();assert.equal(next.signal.aborted,true);assert.equal(h.overlay.snapshot().maps.length,0);
});
test('request failure stays on its layer and cancelled failures are ignored',async()=>{
 const h=setup();await h.overlay.toggle('focus',true);await tick();await h.overlay.toggle('exposure',true);
 h.requests[0].reject(new Error('focus failed'));await tick();
 assert.equal(h.overlay.snapshot().maps.find(m=>m.kind==='focus').unavailable,'focus failed');
 assert.equal(h.requests[1].signal.aborted,false);await h.overlay.toggle('exposure',false);h.requests[1].reject(new Error('late exposure failure'));await tick();
 assert.equal(h.overlay.snapshot().maps.length,1);assert.deepEqual(h.messages,[]);
});
test('slider bursts draw once and save the latest values together',async()=>{
 const h=setup(),strength=h.elements.get('exposure-strength'),color=h.elements.get('exposure-highlight-color');
 for(const value of ['.2','.4','.8'])strength.listeners.input({target:{type:'range',value}});
 color.listeners.input({target:{type:'color',value:'#ffffff'}});
 assert.equal(h.frames.length,1);assert.equal(h.timers.size,0);h.frames[0]();await tick();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].data.exposure_strength,.8);assert.equal(h.requests[0].data.exposure_highlight_color,'#ffffff');
});

test('Exposure toggles leave the pending full Focus refinement running',async()=>{
 const h=setup();await h.overlay.toggle('focus',true);await tick();
 h.requests[0].resolve({key:'half-map',quality:'half',frame:[0,0,1,1]});await tick();
 const full=h.requests[1];assert.equal(full.data.quality,'full');
 await h.overlay.toggle('exposure',true);await h.overlay.toggle('exposure',false);
 assert.equal(full.signal.aborted,false);assert.equal(h.requests.filter(r=>r.data.kind==='focus').length,2);
 full.resolve({key:'full-map',quality:'full',frame:[0,0,1,1]});await tick();
 assert.equal(h.overlay.snapshot().maps[0].quality,'full');h.owner.abort();
});

test('duplicate surfaces share metadata, and one detach leaves the other live',async()=>{
 const h=setup(),film=h.surface();await h.overlay.toggle('focus',true);await tick();
 assert.equal(h.requests.length,1);const half=h.requests[0];assert.equal(half.data.priority,82);
 h.overlay.detach(h.canvas);assert.equal(half.signal.aborted,false);
 half.resolve({key:'shared-half',quality:'half',frame:[0,0,1,1]});await tick();
 assert.equal(h.overlay.snapshot().maps.length,1);assert.equal(h.overlay.snapshot().maps[0].key,'shared-half');
 assert.equal(h.requests.length,1);film.controller.abort();
});
test('last subscriber abort removes the job immediately and late success cannot display',async()=>{
 const h=setup(),film=h.surface();await h.overlay.toggle('focus',true);await tick();const first=h.requests[0];
 h.overlay.detach(h.canvas);film.controller.abort();assert.equal(first.signal.aborted,true);
 first.resolve({key:'stale',quality:'half',frame:[0,0,1,1]});await tick();
 assert.equal(h.overlay.snapshot().maps.length,0);
 const next=h.surface();h.overlay.attach(next.photo,next.canvas,next.meta,next.controller,next.current);await tick();
 assert.equal(h.requests.length,2);assert.equal(h.requests[1].signal.aborted,false);next.controller.abort();
});
test('failed shared metadata is released for a subsequent request',async()=>{
 const h=setup();h.surface();await h.overlay.toggle('focus',true);await tick();
 h.requests[0].reject(new Error('map failed'));await tick();
 assert.equal(h.overlay.snapshot().maps.filter(m=>m.unavailable==='map failed').length,2);
 const next=h.surface();h.overlay.attach(next.photo,next.canvas,next.meta,next.controller,next.current);await tick();
 assert.equal(h.requests.length,2);next.controller.abort();h.owner.abort();
});
test('half and full jobs stay separate while matching half requests join',async()=>{
 const h=setup();await h.overlay.toggle('focus',true);await tick();
 h.requests[0].resolve({key:'half',quality:'half',frame:[0,0,1,1]});await tick();
 assert.equal(h.requests[1].data.quality,'full');
 const film=h.surface();h.overlay.attach(film.photo,film.canvas,film.meta,film.controller,film.current);await tick();
 assert.equal(h.requests.length,3);assert.equal(h.requests[2].data.quality,'half');
 assert.equal(h.requests[1].signal.aborted,false);h.owner.abort();film.controller.abort();
});
test('source version and grade identities do not join, nor do virtual-copy paths',async()=>{
 const h=setup();h.surfaces[0].photo={path:'test.raw',bytes:10,mtime_ns:20,grade_identity:'a'};
 h.surface({...h.surfaces[0].photo});
 for(const change of [{bytes:11},{mtime_ns:21},{grade_identity:'b'},{path:'test.raw|copy|1'}])h.surface({...h.surfaces[0].photo,...change});
 await h.overlay.toggle('focus',true);await tick();assert.equal(h.requests.length,5);
 for(const s of h.surfaces)s.controller.abort();
});
test('disabled layers ignore a late successful shared result',async()=>{
 const h=setup();h.surface();await h.overlay.toggle('focus',true);await tick();const first=h.requests[0];
 await h.overlay.toggle('focus',false);assert.equal(first.signal.aborted,true);
 first.resolve({key:'disabled',quality:'half',frame:[0,0,1,1]});await tick();
 assert.equal(h.overlay.snapshot().maps.length,0);assert.equal(h.requests.length,1);
});
test('filmstrip-first sharing retains Single priority and both surfaces receive the result',async()=>{
 const h=setup();h.canvas.id='filmstrip-picture';const single=h.surface(undefined,'single-picture');
 await h.overlay.toggle('focus',true);await tick();assert.equal(h.requests.length,1);assert.equal(h.requests[0].data.priority,82);
 h.requests[0].resolve({key:'both',quality:'half',frame:[0,0,1,1]});await tick();
 assert.equal(h.overlay.snapshot().maps.filter(m=>m.key==='both').length,2);
 assert.equal(h.requests.length,2);assert.equal(h.requests[1].data.quality,'full');
 h.owner.abort();single.controller.abort();
});


test('grid-only maps keep their background priority',async()=>{
 const h=setup();h.canvas.id='grid-picture';await h.overlay.toggle('focus',true);await tick();
 assert.equal(h.requests[0].data.priority,85);h.owner.abort();
});


test('late Single demand keeps its priority when background work is already submitted',async()=>{
 const h=setup();h.canvas.id='grid-picture';await h.overlay.toggle('focus',true);await tick();
 const background=h.requests[0];const single=h.surface(undefined,'single-picture');
 h.overlay.attach(single.photo,single.canvas,single.meta,single.controller,single.current);await tick();
 assert.equal(h.requests.length,2);assert.equal(background.data.priority,85);
 assert.equal(h.requests[1].data.priority,82);assert.equal(background.signal.aborted,false);
 h.owner.abort();single.controller.abort();
});


test('disk full hit skips half construction; cold miss still builds half then full',async()=>{
 const hit=setup(async()=>({key:'disk-full',quality:'full',frame:[0,0,1,1]}));
 await hit.overlay.toggle('focus',true);await tick();
 assert.equal(hit.probes[0].data.quality,'full');assert.equal(hit.requests.length,0);
 assert.equal(hit.overlay.snapshot().maps[0].key,'disk-full');hit.owner.abort();
 const cold=setup();await cold.overlay.toggle('focus',true);await tick();
 assert.equal(cold.requests[0].data.quality,'half');
 cold.requests[0].resolve({key:'half',quality:'half'});await tick();
 assert.equal(cold.requests[1].data.quality,'full');cold.owner.abort();
});

test('retained full validates full directly and a stale full stays hidden',async()=>{
 const h=setup(async()=>({key:'retained',quality:'full'}));
 await h.overlay.toggle('focus',true);await tick();h.overlay.detach(h.canvas);
 h.overlay.attach(h.surfaces[0].photo,h.canvas,{},h.owner,()=>true);await tick();
 assert.equal(h.probes.length,1);assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].data.quality,'full');
 const layer=h.canvas.parentElement.children.filter(e=>e.dataset.kind==='focus'&&e.className==='library-source-overlay').at(-1);
 assert.equal(layer.hidden,true);
 h.requests[0].resolve({unavailable:'changed',reason:'graded'});await tick();
 assert.equal(layer.hidden,true);h.owner.abort();
});

test('full lookup and full construction have independent cancellation',async()=>{
 let resolveProbe;const h=setup(()=>new Promise(resolve=>{resolveProbe=resolve;}));
 await h.overlay.toggle('focus',true);await tick();const first=h.probes[0];
 const other=h.surface(undefined,'compare');other.canvas.classList.contains=c=>c==='compare-fit';
 h.overlay.attach(other.photo,other.canvas,other.meta,other.controller,other.current);await tick();
 h.overlay.detach(h.canvas);assert.equal(first.signal.aborted,false);
 resolveProbe({cache_miss:true});await tick();
 assert.equal(h.requests[0].data.quality,'half');assert.equal(h.requests[0].data.cache_only,false);
 other.controller.abort();assert.equal(h.requests[0].signal.aborted,true);
});


test('validated retained full map becomes visible without a half build',async()=>{
 const h=setup(async()=>({key:'valid-full',quality:'full',frame:[0,0,1,1]}));
 await h.overlay.toggle('focus',true);await tick();h.overlay.detach(h.canvas);
 h.overlay.attach(h.surfaces[0].photo,h.canvas,{},h.owner,()=>true);await tick();
 const layer=h.canvas.parentElement.children.filter(e=>e.dataset.kind==='focus'&&e.className==='library-source-overlay').at(-1);
 assert.equal(layer.hidden,true);assert.equal(h.requests[0].data.quality,'full');
 h.requests[0].resolve({key:'valid-full',quality:'full',frame:[0,0,1,1]});await tick();
 assert.equal(layer.hidden,false);assert.equal(layer.dataset.key,'valid-full');assert.equal(h.requests.length,1);h.owner.abort();
});

test('ordinary grid does not probe full cache but selected filmstrip shares its probe',async()=>{
 const grid=setup();grid.canvas.id='grid-picture';await grid.overlay.toggle('focus',true);await tick();
 assert.equal(grid.probes.length,0);assert.equal(grid.requests[0].data.quality,'half');grid.owner.abort();
 const h=setup(async()=>({key:'full-only',quality:'full',frame:[0,0,1,1]}));h.canvas.id='filmstrip-picture';
 const single=h.surface(undefined,'single-picture');await h.overlay.toggle('focus',true);await tick();
 assert.equal(h.probes.length,1);assert.equal(h.requests.length,0);
 assert.equal(h.overlay.snapshot().maps.filter(m=>m.quality==='full').length,2);h.owner.abort();single.controller.abort();
});


test('failed optional cache lookup falls back to the normal half-first route',async()=>{
 const h=setup(async()=>{throw new Error('lookup unavailable');});
 await h.overlay.toggle('focus',true);await tick();assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].data.quality,'half');h.requests[0].resolve({key:'half-after-probe-error',quality:'half',frame:[0,0,1,1]});await tick();
 assert.equal(h.overlay.snapshot().maps[0].key,'half-after-probe-error');
 assert.equal(h.requests[1].data.quality,'full');h.owner.abort();
});
