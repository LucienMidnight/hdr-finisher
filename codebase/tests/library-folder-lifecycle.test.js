const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../frontend/photo-library.js'),'utf8');
const tick=()=>new Promise(setImmediate);
test('a previous folder stream cannot cancel the current folder paint timer',async()=>{
 const readers=[];const timers=new Map();let serial=0;
 const state={photos:[],allPhotos:[],sort:'name',descending:false,size:190},grid={scrollTop:0,offsetWidth:900,clientHeight:600},film={scrollLeft:0};
 const context={state,grid,film,space:{style:{}},performance,Map,TextDecoder,Promise,DOMException,
  gridLaneWidth:15,folderPaintTimer:null,HDRLibraryStopwatch(){},paintGrid(){},paintFilm(){},status(){},readDates:async()=>{},
  applyQuery(){state.photos=state.allPhotos;},HDRLibraryLayout:require('../frontend/library-layout.js'),aborted:error=>error.name==='AbortError',
  requestAnimationFrame:fn=>queueMicrotask(fn),setTimeout:(fn,delay)=>{if(!delay){queueMicrotask(fn);return 0;}const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  fetch:async()=>{const reader={read:()=>new Promise(resolve=>{reader.next=resolve;}),releaseLock(){}};readers.push(reader);return {ok:true,body:{getReader:()=>reader}};}};
 vm.createContext(context);const start=source.indexOf('  async function openFolderStream('),end=source.indexOf('  window.HDRLibraryFolderAction',start);
 vm.runInContext(source.slice(source.indexOf("  function measureGrid("),source.indexOf("  let reviewGrid"))+source.slice(start,end),context);
 async function open(path){const controller=new AbortController();state.scan=controller;const ready=context.openFolderStream(path,controller);await tick();readers.at(-1).next({value:new TextEncoder().encode(JSON.stringify({kind:'rows',photos:[{path:path+'/one'}]})+'\n'),done:false});await ready;await tick();return readers.at(-1);}
 const old=await open('old'),current=await open('new');
 current.next({value:new TextEncoder().encode(JSON.stringify({kind:'rows',photos:[{path:'new/two'}]})+'\n'),done:false});await tick();
 assert.equal(timers.size,1);
 old.next({done:true});await tick();assert.equal(timers.size,1,'Old stream cleanup must leave the new paint scheduled');
 current.next({done:true});await tick();assert.equal(timers.size,0);
});
test('visible details from a new folder do not inherit the previous folder cancellation',async()=>{
 const callbacks=new Map(),calls=[];let serial=0;const state={cells:new Map(),filmCells:new Map()};
 const context={state,Map,Promise,AbortController,DOMException,
  setTimeout:fn=>{const id=++serial;callbacks.set(id,fn);return id;},clearTimeout:id=>callbacks.delete(id),
  api:async(route,body,signal)=>{assert.equal(signal.aborted,false);calls.push(body.paths);return {photos:body.paths.map(path=>({path,grade_identity:'fresh'}))};},
  pictureIdentity:photo=>photo.path,paintGrid(){},paintFilm(){},readVisibleFacts:async()=>{},updateDetails(){},aborted:error=>error.name==='AbortError',status(){}};
 vm.createContext(context);const start=source.indexOf('  let visibleDetails ='),end=source.indexOf('  function applyQuery',start);
 // hydrateVisible ends immediately before applyQuery.
 vm.runInContext(source.slice(start,end),context);
 const first=new AbortController();state.scan=first;state.folderOpen={controller:first};
 const old=context.hydrateVisible({path:'old'},()=>!first.signal.aborted,first.signal);const rejected=assert.rejects(old,{name:'AbortError'});
 first.abort();const next=new AbortController();state.scan=next;state.folderOpen={controller:next};const photo={path:'new'};
 const fresh=context.hydrateVisible(photo,()=>true,next.signal);await rejected;
 assert.equal(callbacks.size,1);await callbacks.values().next().value();await fresh;
 assert.deepEqual(calls.map(paths=>Array.from(paths)),[['new']]);assert.equal(photo.grade_identity,'fresh');assert.equal(photo._details,true);
});
