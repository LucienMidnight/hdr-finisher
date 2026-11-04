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
 const state={active:true,view:'single',photos:[a,b],index:0,displayEpoch:0,hdr:false,cells:new Map()};
 const key=p=>p.path+':'+p.grade_identity;
 const readyWindow=create({key,load:async p=>{const value={canvas:canvas(p),meta:{key:p.grade_identity,edge:2560}};if(block)await block;return value;},dispose:value=>{disposed.push(value);if(value.canvas===visible)value.canvas.hidden=true;}});
 const surfaces={has:()=>true,get:()=>undefined};
 const context={HDRLibraryStopwatch(){},logView:()=>"single",HDRLibraryScreenPreviews:{display:()=>({})},state,navigationTrace:null,selected:()=>state.photos[state.index],singleEdge:()=>2560,readyKey:key,readyWindow,readySurfaces:surfaces,
   HDRLibraryScenes:{review(){},save(){}},quickWindow:{update(){},get:async()=>null},navigationGate:{touch(){}},beforeSource:async()=>{},showQuick(){},showCameraPreview(){},performance,
   readAhead:{update(){}},developmentNeighbours:()=>[],developAhead(){},
  compare:{enabled:()=>false,hide(){}},HDRLibraryTrace:{begin:()=>({}),end(){},mark(){},present:(trace,current)=>{assert.ok(current());assert.equal(visible.pixels,key(state.photos[state.index]));}},
  restoreStandIn(){},showStandIn(){},AbortController,positionZoom(){},updateSingleCaption(){},status(){},startRawAhead(){},readyNeighbours:()=>[a,b].filter(p=>p!==state.photos[state.index]),warmReady(){},overlays:null,
  HDRLibraryPictures:{usable:()=>true},loadAndShow:()=>assert.fail('Unexpected fallback'),aborted:e=>e.name==='AbortError',removeUnreadable:(_p,e)=>{throw e;},$:id=>id==='single-picture'?visible:{hidden:true}};
 vm.runInNewContext(fn+';this.showSingle=showSingle;',context);
 await context.showSingle();assert.equal(visible.pixels,'a:old');
 state.index=1;readyWindow.update(b,[a]);await readyWindow.get(b);const previous=visible;const swapping=context.showSingle();assert.equal(previous.hidden,false,'Ready swap preserves the displayed surface until replacement');await swapping;assert.equal(visible.pixels,'b:old');
 state.index=0;await context.showSingle();assert.equal(visible.pixels,'a:old');
 a.grade_identity='new';let release;block=new Promise(r=>release=r);
 const pending=context.showSingle();await Promise.resolve();assert.equal(visible.hidden,true);
 release();await pending;assert.equal(visible.pixels,'a:new');assert.equal(visible.hidden,false);
 assert.equal(visible.dataset.picturePath,'a');assert.equal(visible.dataset.pictureKey,'new');
});

test('selected Denoise measurements pass queued neighbours while quick draws stay independent',async()=>{
 const source=fs.readFileSync(require.resolve('../frontend/library-gpu'),'utf8');
 const fn=source.slice(source.indexOf('const libraryDenoiseModels'),source.indexOf('class HDRLibraryGPU'));
 let release;const block=new Promise(r=>release=r),calls=[];
 const context={HDRLibrarySceneScheduler:require('../frontend/library-scene-scheduler'),fetch:async url=>{
  calls.push(url);if(url==='running')await block;return {ok:true,json:async()=>({url})};}};
 vm.runInNewContext(fn+';this.model=libraryDenoiseModel;',context);
 const model=(url,meta)=>context.model(url,meta,async()=>(await context.fetch(url)).json());
 const meta=(path,priority,edge=2560)=>({path,draw_priority:priority,edge});
 const first=model('running',meta('a',5));await new Promise(r=>setImmediate(r));
 const neighbour=model('neighbour',meta('b',5));
 const selected=model('selected',meta('c',0));
 const quick=model('quick',meta('c',0,640));await quick;
 assert.deepEqual(calls,['running','quick']);release();await Promise.all([first,selected,neighbour]);
 assert.deepEqual(calls,['running','quick','selected','neighbour']);
 await model('selected',meta('c',0));assert.equal(calls.length,4,'Exact model reused');
});


test('memory polling preserves the stopped selection during source work and still yields to delivery',async()=>{
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  async function pollReadyMemory()'),source.indexOf('  setInterval(pollReadyMemory'));
 let invalidated=0,finished=false,sourceActive=1,budget=100,permit={ready:true,idle:false};
 const context={readySurfaces:new Map([["gpu",{meta:{}}]]),readyPolling:false,readyBytes:50,state:{active:true,view:'single',singleIdentity:'selected'},
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


test('Develop stores only the selected photos at both tiers without changing grades',async()=>{
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  async function developSelection('),source.indexOf('  const showAllKey='));
 const photos=[{path:'a.arw',name:'a'},{path:'b.dng',name:'b'}],before=JSON.stringify(photos),calls=[],stored=[];
 const context={status(){},HDRLibraryScenes:{async load(path,edge,signal,priority,trace,options){assert.equal(options.develop,true);calls.push([path,edge]);return {key:path+edge,directScene:{async store(){stored.push(path+edge);}}};}},
  async fetch(url,options){assert.match(url,/^\/api\/library\/live-store\//);assert.equal(options.method,'POST');return {ok:true};},
  tilePool:{clear(){}},clearCells(){},state:{cells:new Map(),filmCells:new Map(),view:'grid'},readyWindow:{invalidate(){}},quickWindow:{invalidate(){}},paintGrid(){},paintFilm(){}};
 vm.runInNewContext(fn+';this.run=developSelection;',context);await context.run(photos);
 assert.deepEqual(calls,[['a.arw',640],['a.arw',2560],['b.dng',640],['b.dng',2560]]);
 assert.equal(stored.length,4);assert.equal(JSON.stringify(photos),before);
});


test('a stored Fit remains visible while native detail is unavailable',()=>{
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  function positionZoom()'),source.indexOf('  async function prepareRawNative('));
 const fit={style:{visibility:'hidden'}},native={hidden:false,style:{}},stage={clientWidth:1000,clientHeight:800,classList:{toggle(){}},querySelector(){}};
 const state={zoom:true,zoomScale:1,zoomX:.5,zoomY:.5,fitMeta:{route:'stored-screen-preview',width:1000,height:800},nativeMeta:null};
 const context={state,window:{devicePixelRatio:1},$:id=>id==='single-picture'?fit:id==='native-picture'?native:stage,HDRPhotoFraming:{layout:()=>({width:2000,height:1600,frame:0,border:0}),draw(){}},HDRLibraryZoom:{center:()=>({x:.5,y:.5})}};
 vm.runInNewContext(fn+';this.run=positionZoom;',context);context.run();
 assert.equal(fit.style.visibility,'');assert.equal(native.hidden,true);
 state.nativeMeta={width:100,height:100,crop_x:0,crop_y:0};context.run();assert.equal(native.hidden,false);
});

test('inherited zoom state cannot develop detail without this photos explicit request',async()=>{
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  async function showNative()'),source.indexOf('  function singleFrameInset('));
 const context={state:{fitMeta:{},zoom:true,active:true,view:'single',detailRequested:null},selected:()=>({path:'photo'}),$:()=>assert.fail('Unrequested detail reached the surface')};
 vm.runInNewContext(fn+';this.run=showNative;',context);await context.run();
});


test('a hidden stand-in is a presentation fault, never a presented picture',()=>{
 const source=fs.readFileSync(require.resolve('../frontend/library-stopwatch'),'utf8');
 const events=[],parent={hidden:true,parentElement:null},canvas={isConnected:true,width:100,height:100,hidden:false,parentElement:parent,getBoundingClientRect:()=>({width:100})};
 const context={window:{},performance,HDRLibraryStopwatch:(stage,fields)=>events.push({stage,...fields}),requestAnimationFrame:f=>f(),getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};
 vm.runInNewContext(source.slice(source.indexOf('window.HDRLibraryTrace =')),context);
 const trace={started:performance.now()};context.window.HDRLibraryTrace.present(trace,()=>true,{quick_draw:true},canvas);
 assert.equal(events.filter(e=>e.stage==='picture_surface_fault').length,1);assert.equal(trace.presented,undefined);
 parent.hidden=false;context.window.HDRLibraryTrace.present(trace,()=>true,{quick_draw:true},canvas);
 assert.equal(trace.standInPresented,true);assert.equal(events.filter(e=>e.stage==='picture_present').length,1);
});


test('fullscreen entry resets inherited zoom and explicit detail demand to Fit',()=>{
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  function setReview('),source.indexOf('  function openGrade('));
 let aborted=false,view;
 const state={zoom:true,detailRequested:'photo',nativeMeta:{},native:{abort(){aborted=true;}},view:'single'};
 const context={state,selected:()=>({path:'photo'}),$:()=>({setAttribute(){}}),library:{classList:{toggle(){}}},setView:v=>view=v,postParent(){}};
 vm.runInNewContext(fn+';this.run=setReview;',context);context.run(true);
 assert.equal(state.zoom,false);assert.equal(state.detailRequested,null);assert.equal(state.nativeMeta,null);assert.equal(aborted,true);assert.equal(view,'single');
});


test('a retained failed detail request becomes eligible for an explicit user retry',async()=>{
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  async function showNative()'),source.indexOf('  function singleFrameInset('));
 const error=Object.assign(Error('Not enough memory'),{needsMemory:true});
 const state={fitMeta:{route:'stored-screen-preview'},zoom:true,detailRequested:'photo',active:true,view:'single',zoomScale:1,fullDetail:Promise.reject(error)};
 const messages=[],context={state,selected:()=>({path:'photo',name:'photo'}),window:{devicePixelRatio:1},$:()=>({}),AbortController,aborted:()=>false,status:s=>messages.push(s)};
 vm.runInNewContext(fn+';this.run=showNative;',context);await context.run();
 assert.equal(state.detailRefused,true);assert.equal(state.nativeLoading,false);assert.match(messages.at(-1),/unavailable/);
});


test('Library compiles only demanded passes and uses the unchanged Grade descriptors',async()=>{
 const grade=fs.readFileSync(require.resolve('../frontend/webgpu-preview'),'utf8');
 const library=fs.readFileSync(require.resolve('../frontend/library-gpu'),'utf8');
 const base=grade.slice(grade.indexOf('    pipelineFor(format, factory = null)'),grade.indexOf('    async warmPipelines'));
 const methods=library.slice(library.indexOf('  pipelineFor(format, factory = null)'),library.indexOf('  async loadProxy'));
 const context={HDRLibraryStopwatch(){},window:{},performance,CLARITY_MAP_FORMAT:'rgba16float'};
 vm.runInNewContext('class Grade {'+base+'};class Library extends Grade {'+methods+'};this.Grade=Grade;this.Library=Library;',context);
 const created=[],gpu=new context.Library();gpu.pipelines=new Map();gpu.module={shader:'unchanged'};gpu.pipelineLayout={layout:'unchanged'};
 gpu.device={createRenderPipeline:d=>{created.push(d);return {descriptor:d};},createRenderPipelineAsync:async d=>{created.push(d);return {descriptor:d};}};
 const staged=gpu.pipelineFor('bgra8unorm');assert.equal(created.length,0,'Unused passes never compile');
 const gradeGpu=new context.Grade();gradeGpu.pipelines=new Map();gradeGpu.module=gpu.module;gradeGpu.pipelineLayout=gpu.pipelineLayout;
 const expected=gradeGpu.pipelineFor('bgra8unorm',d=>d);
 const first=staged.finish;assert.deepEqual(first.descriptor,expected.finish);assert.equal(created.length,1);assert.equal(staged.finish,first);
 await gpu.prepareLibraryPipelines('bgra8unorm',['base','finish']);assert.equal(created.length,2);assert.deepEqual(staged.base.descriptor,expected.base);
 for(const [name,descriptor] of Object.entries(expected))assert.deepEqual(staged[name].descriptor,descriptor,name);
 assert.equal(created.length,Object.keys(expected).length);
});
