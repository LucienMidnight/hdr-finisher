const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../frontend', name), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
class Element {
  constructor(){this.children=[];this.dataset={};this.events={};this.classList={toggle(){}};}
  replaceChildren(...items){this.children=items;}
  append(...items){this.children.push(...items);}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(){}
}
function harness(smart=false) {
  let menu; const reads=[], root=new Element(), error=new Error('mutation failed');
  const context=vm.createContext({URL,document:{currentScript:{src:'http://localhost/library-smart-albums.js'}},HDRLibraryQuery:{},HDRLibraryDialogs:{make:()=>new Element(),ask:async()=>({}),showMenu:(_e,items)=>{menu=items;}},window:{}});
  vm.runInContext(source(smart?'library-smart-albums.js':'library-albums.js'),context);
  let closed=0, fail=false;
  const controller=context.window[smart?'HDRLibrarySmartAlbums':'HDRLibraryAlbums'].create({root,addButton:new Element(),api:async(route)=>{if(route.endsWith('/impact'))return {};const d=deferred();reads.push(d);return d.promise;},run:async()=>{if(fail)throw error;return {warnings:[]};},status(){},closed:()=>closed++});
  return {controller,root,reads,error,setFail:()=>fail=true,closed:()=>closed,remove:()=>{root.children[0].events.contextmenu({});return menu.find(item=>item.label.startsWith('Delete')).run();}};
}
for(const smart of [false,true]) {
 const label=smart?'smart':'manual'; const item=smart?{id:'a',name:'A'}:{name:'A',count:2};
 test(`${label}: newest list wins`,async()=>{const h=harness(smart);const a=h.controller.refresh(),b=h.controller.refresh();h.reads[1].resolve({albums:[]});await b;h.reads[0].resolve({albums:[item]});await a;assert.equal(h.root.children.some(row=>row.dataset[smart?'smart':'album']),false);});
 for(const fail of [false,true]) test(`${label}: ${fail?'failed':'successful'} delete survives failed GET and old GET`,async()=>{
  const h=harness(smart);let p=h.controller.refresh();h.reads[0].resolve({albums:[item]});await p;h.controller.setActive(smart?'a':'A');
  const stale=h.controller.refresh();if(fail)h.setFail();
  const removing=h.remove();await new Promise(setImmediate);
  h.reads[2].reject(new Error('GET failed'));
  if(fail)await assert.rejects(removing,e=>e===h.error);else await removing;
  h.reads[1].resolve({albums:[item]});await stale;
  assert.equal(h.closed(),fail?0:1);
  assert.equal(h.root.children.some(row=>row.dataset[smart?'smart':'album']),fail);
 });
}
// Execute the actual closure functions with controlled state and inert painting.
function functionBody(name,next){const text=source('photo-library.js');return text.slice(text.indexOf(`  ${name}`),text.indexOf(`  ${next}`,text.indexOf(`  ${name}`)));}
function queryHarness(paths,index){
 const state={photos:paths.map(path=>({path})),allPhotos:[],index,selection:new Set([paths[index]]),anchor:index,filters:{},sort:'time',view:'grid'};
 const context=vm.createContext({state,selected:()=>state.photos[state.index],showAllFiles:true,HDRLibraryQuery:{apply:p=>p},paintFilterButton(){},updateDetails(){},paintGrid(){},paintFilm(){},showSingle(){},compare:{enabled:()=>false},setView:v=>state.view=v,status(){}});
 vm.runInContext(functionBody('function applyQuery(', 'let factsQueryTimer;'),context);
 return {state,apply:()=>vm.runInContext('applyQuery()',context)};
}
for(const [name,index,remaining,want] of [['middle',1,['a','c'],'c'],['last',2,['a','b'],'b'],['all',1,[],undefined]])test(`removed ${name}: neighbour selection`,()=>{const h=queryHarness(['a','b','c'],index);h.state.allPhotos=remaining.map(path=>({path}));h.apply();assert.equal(h.state.photos[h.state.index]?.path,want);assert.deepEqual([...h.state.selection],want?[want]:[]);});
test('filter changes retain existing first-result fallback',()=>{const h=queryHarness(['a','b','c'],1);h.state.allPhotos=['a','b','c'].map(path=>({path})); // source still contains lead
 h.state.filters={};h.apply();assert.equal(h.state.photos[h.state.index].path,'b');});
function navigationHarness(fail=false, fallback=false) {
 const pin={path:'C:/photos',name:'Photos',available:true};
 const state={pins:[pin,...(fallback?[{path:'C:/other',available:true}]:[])],folderSelection:new Set([pin.path]),path:pin.path,lastFolder:pin.path,collection:null,photos:[{path:'one'}],allPhotos:[{path:'one'}],selection:new Set(['one']),index:0,anchor:0,view:'single',cells:new Map(),filmCells:new Map(),scan:new AbortController(),single:new AbortController(),native:new AbortController()};
 const elements=new Map(),visited=[], error=new Error('remove failed');let menu;
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};get('place-title').textContent='Photos';
 const context=vm.createContext({state,offlineSources:new Set(),pinsRevision:0,$:get,api:async route=>{if(route.endsWith('/impact'))return {leaving:1,kept:0};if(route.endsWith('/remove')){if(fail)throw error;return {};}throw new Error('GET failed');},HDRLibraryDialogs:{ask:async()=>true},showMenu:(_e,actions)=>menu=actions,paintFolderSelection(){},folderRow:()=>new Element(),status(){},clearPrefetch(){},clearCells:m=>m.clear(),albums:{setActive(){},refresh:async()=>{}},smart:{setActive(){}},tagWindow:{refresh:async()=>{}},setView:v=>state.view=v,updateDetails(){},paintGrid(){},paintFilm(){},browse:async p=>visited.push(p),reopen:async()=>{},portableState:()=>({path:state.path}),restoreState:async()=>{state.scan=new AbortController();},navigation:{orderPins:p=>p}});
 vm.runInContext(functionBody('function leaveRemovedCollection()', 'void smart.refresh'),context);
 vm.runInContext(functionBody('async function refreshPins()', 'function paintFolderSelection()'),context);
 vm.runInContext(functionBody('function showFolderMenu(', '$("folders").addEventListener'),context);
 return {state,visited,error,title:get('place-title'),leave:()=>vm.runInContext('leaveRemovedCollection()',context),unpin:()=>{context.event={target:{closest:()=>null}};vm.runInContext('showFolderMenu(event,"C:/photos")',context);return menu.find(a=>a.label==='Unpin folder').run();}};
}
test('removed collection without valid fallback clears identity, title, selection and jobs',()=>{const h=navigationHarness();h.state.pins=[];h.state.collection={kind:'album',name:'Gone'};const scan=h.state.scan;h.leave();assert.equal(scan.signal.aborted,true);assert.equal(h.state.collection,null);assert.equal(h.state.path,'');assert.equal(h.state.index,-1);assert.equal(h.state.selection.size,0);assert.equal(h.title.textContent,'Library');assert.deepEqual(h.visited,[]);});
test('failed unpin and failed GET retain usable navigation and original error',async()=>{const h=navigationHarness(true);const scan=h.state.scan;await assert.rejects(h.unpin(),e=>e===h.error);assert.equal(scan.signal.aborted,true);assert.equal(h.state.scan.signal.aborted,false);assert.equal(h.state.path,'C:/photos');assert.equal(h.state.view,'single');assert.equal(h.title.textContent,'Photos');assert.deepEqual([...h.state.selection],['one']);assert.equal(h.state.pins.length,1);});
test('successful unpin cancels old work and chooses valid fallback despite failed GET',async()=>{const h=navigationHarness(false,true);const scan=h.state.scan;await h.unpin();assert.equal(scan.signal.aborted,true);assert.deepEqual(h.visited,['C:/other']);assert.equal(h.state.pins.some(p=>p.path==='C:/photos'),false);});

for(const index of [1,2]) test(`Single removal at ${index} retains Single with neighbour`,()=>{const h=queryHarness(['a','b','c'],index);h.state.view='single';h.state.allPhotos=['a','b','c'].filter((_,i)=>i!==index).map(path=>({path}));h.apply();assert.equal(h.state.view,'single');assert.equal(h.state.photos[h.state.index].path,index===1?'c':'b');});
test('pins: newest list wins',async()=>{
 const reads=[], state={pins:[]}, folders=new Element();
 const context=vm.createContext({state,pinsRevision:0,offlineSources:new Set(),api:()=>{const d=deferred();reads.push(d);return d.promise;},navigation:{orderPins:p=>p},$:()=>folders,folderRow:pin=>pin,paintGrid(){}});
 vm.runInContext(functionBody('async function refreshPins()', 'function paintFolderSelection()'),context);
 const first=vm.runInContext('refreshPins()',context),second=vm.runInContext('refreshPins()',context);
 reads[1].resolve({pinned:[{path:'new'}]});await second;reads[0].resolve({pinned:[{path:'old'}]});await first;
 assert.equal(state.pins[0].path,'new');assert.equal(folders.children[0].path,'new');
});
test('Single removal of all photos leaves empty Grid',()=>{const h=queryHarness(['a'],0);h.state.view='single';h.state.allPhotos=[];h.apply();assert.equal(h.state.view,'grid');assert.equal(h.state.index,-1);assert.equal(h.state.selection.size,0);});
