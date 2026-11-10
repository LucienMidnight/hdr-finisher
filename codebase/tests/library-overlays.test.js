const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){
 const elements=new Map(),requests=[],messages=[],frames=[],timers=new Map();let timer=0;
 function element(id=''){
  const e={id,style:{},dataset:{},hidden:false,isConnected:true,width:10,height:10,clientWidth:10,clientHeight:10,listeners:{},children:[],classList:{contains:()=>false,toggle(){}},setAttribute(){},addEventListener(k,f){this.listeners[k]=f;},append(c){c.parentElement=this;this.children.push(c);},before(){},remove(){this.removed=true;},getContext:()=>({drawImage(){},getImageData:()=>({width:1,height:1,data:new Uint8ClampedArray(4)}),putImageData(){},clearRect(){}}),};
  Object.defineProperty(e,'innerHTML',{set(value){for(const match of value.matchAll(/<input id="([^"]+)"[^>]*>/g)){const input=element(match[1]),tag=match[0];input.type=tag.match(/type="([^"]+)"/)?.[1];input.checked=tag.includes('checked');input.value=tag.match(/value="([^"]+)"/)?.[1];elements.set(input.id,input);}}});return e;
 }
 elements.set('zoom-button',element());const body=element(),canvas=element('single-picture');body.append(canvas);
 const owner=new AbortController();const surfaces=[{photo:{path:'test.raw'},canvas,meta:{},controller:owner,current:()=>true}];
 const context={devicePixelRatio:1,ImageData:class{constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);}},fetch:async()=>({ok:true,blob:async()=>({})}),createImageBitmap:async()=>({width:1,height:1,close(){}}),window:{},document:{getElementById:id=>elements.get(id),createElement:()=>element(),body,querySelectorAll:()=>[],addEventListener(){}},AbortController,MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}},getComputedStyle:()=>({padding:'0'}),requestAnimationFrame:f=>(frames.push(f),frames.length),setTimeout:f=>{timers.set(++timer,f);return timer;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/library-overlays.js'),'utf8'),context);
 const overlay=context.window.HDRLibraryOverlays.create({surfaces:()=>surfaces,status:m=>messages.push(m),api:(url,data,signal)=>{if(url.endsWith('overlay-switch'))return Promise.resolve({enabled:data.enabled});if(url.endsWith('review-preferences')){requests.push({url,data});return Promise.resolve(data);}return new Promise((resolve,reject)=>requests.push({url,data,signal,resolve,reject}));}});
 return {overlay,requests,messages,canvas,owner,elements,frames,timers};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('switching Exposure preserves Focus request and switching Focus preserves Exposure',async()=>{
 const h=setup();await h.overlay.toggle('focus',true);const focus=h.requests[0];await h.overlay.toggle('exposure',true);const exposure=h.requests[1];
 assert.equal(h.requests.length,2);assert.equal(focus.signal.aborted,false);
 await h.overlay.toggle('exposure',false);assert.equal(exposure.signal.aborted,true);assert.equal(focus.signal.aborted,false);
 exposure.resolve({unavailable:'late failure'});await tick();assert.deepEqual(h.messages,[]);
 await h.overlay.toggle('exposure',true);const next=h.requests[2];await h.overlay.toggle('focus',false);
 assert.equal(focus.signal.aborted,true);assert.equal(next.signal.aborted,false);assert.equal(h.requests.length,3);
 h.owner.abort();assert.equal(next.signal.aborted,true);assert.equal(h.overlay.snapshot().maps.length,0);
});
test('request failure stays on its layer and cancelled failures are ignored',async()=>{
 const h=setup();await h.overlay.toggle('focus',true);await h.overlay.toggle('exposure',true);
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
 const h=setup();await h.overlay.toggle('focus',true);
 h.requests[0].resolve({key:'half-map',quality:'half',frame:[0,0,1,1]});await tick();
 const full=h.requests[1];assert.equal(full.data.quality,'full');
 await h.overlay.toggle('exposure',true);await h.overlay.toggle('exposure',false);
 assert.equal(full.signal.aborted,false);assert.equal(h.requests.filter(r=>r.data.kind==='focus').length,2);
 full.resolve({key:'full-map',quality:'full',frame:[0,0,1,1]});await tick();
 assert.equal(h.overlay.snapshot().maps[0].quality,'full');h.owner.abort();
});
