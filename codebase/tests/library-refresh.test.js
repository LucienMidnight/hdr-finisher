const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
function setup(api){
 const display={textContent:''},listeners={},invalidated=[],shown=[];
 const context={$:()=>display,document:{addEventListener:(name,fn)=>listeners[name]=fn},api,
  plural:(n)=>`${n} photos`,invalidateGradePictures:paths=>invalidated.push([...paths]),
  state:{view:'grid'},paintGrid(){},paintFilm(){},showSingle:async()=>{},
  HDRLibraryStopwatch:(...args)=>shown.push(args)};
 const status=source.slice(source.indexOf('  let refreshNotice'),source.indexOf('  // Capture OS drops'));
 const refresh=source.slice(source.indexOf('  async function refreshThumbnails'),source.indexOf('  async function developSelection'));
 vm.runInNewContext(status+refresh+';this.refresh=refreshThumbnails;this.background=status;this.shown=refreshedShown;',context);
 return {context,display,listeners,invalidated,shown};
}
test('Refresh acknowledges before the backend answers and rejects old front-end work at both boundaries',async()=>{
 let answer;const pending=new Promise(resolve=>answer=resolve),h=setup(()=>pending);
 const run=h.context.refresh(['photo']);
 assert.match(h.display.textContent,/Refreshing/);assert.equal(h.invalidated.length,1);
 answer({});await run;assert.equal(h.invalidated.length,2);
 h.context.shown('photo','grid');h.context.shown('photo','filmstrip');h.context.shown('photo','single');
 assert.deepEqual(h.shown.map(row=>row[1].view),['grid','filmstrip','single']);
 assert.match(h.display.textContent,/shown/);
});
test('Refresh failure remains visible through background updates until another user action',async()=>{
 const h=setup(async()=>{throw Error('Drive is unavailable');});
 await h.context.refresh(['photo']);assert.match(h.display.textContent,/Refresh failed: Drive is unavailable/);
 h.context.background('Scanning');assert.match(h.display.textContent,/Refresh failed/);
 h.listeners.pointerdown({isTrusted:true});h.context.background('Next action');assert.equal(h.display.textContent,'Next action');
});

test('Refresh cancels old Grid, filmstrip, Single and zoom presentation owners',()=>{
 const cells=()=>new Map([['photo',{photo:{path:'photo'},controller:new AbortController(),element:{remove(){}}}]]);
 const state={cells:cells(),filmCells:cells(),single:new AbortController(),native:new AbortController(),nativeSource:new AbortController(),fullDetail:Promise.resolve('old'),nativeLoading:true};
 const owners=[...state.cells.values(),...state.filmCells.values()].map(c=>c.controller).concat(state.single,state.native,state.nativeSource);
 const native={hidden:false};
 const context={state,gradeHandoffs:new Map(),selected:()=>({path:'photo'}),readyWindow:{invalidate(){}},quickWindow:{invalidate(){}},recentPictures:new Map(),HDRLibraryScenes:{invalidate(){}},window:{},tilePool:{discard(){}},$:()=>native};
 const fn=source.slice(source.indexOf('  function invalidateGradePictures'),source.indexOf('  const pasteGrades'));
 vm.runInNewContext(fn+';invalidateGradePictures(["photo"],{source:true});',context);
 assert.ok(owners.every(c=>c.signal.aborted));assert.equal(state.cells.size,0);assert.equal(state.filmCells.size,0);
 assert.equal(state.fullDetail,null);assert.equal(state.nativeLoading,false);assert.equal(native.hidden,true);
});


function settingsPoll({photoGrade = 'new', tileGrade = 'old', handoff = null} = {}) {
 const photo={path:'photo',grade_identity:photoGrade,bytes:10,mtime_ns:20,edited:true,marks:{},albums:[]};
 const cell={photo,identity:`photo|${tileGrade}|10|20`,controller:new AbortController(),element:{remove(){}}};
 const invalidated=[];
 const context={state:{active:true,allPhotos:[photo],cells:new Map([['photo',cell]]),filmCells:new Map(),view:'grid'},
  document:{hidden:false},selected:()=>photo,shownCells:map=>[...map.values()],
  api:async()=>({photos:[{...photo,grade_identity:'new'}],events:[]}),
  pictureIdentity:p=>`${p.path}|${p.grade_identity || ''}|${p.bytes}|${p.mtime_ns}`,
  gradeHandoffs:new Map(handoff?[['photo',{...handoff,controller:new AbortController()}]]:[]),tilePool:{discard(){}},
  readyWindow:{invalidate(){}},quickWindow:{invalidate(){}},recentPictures:new Map(),
  HDRLibraryScenes:{invalidate:paths=>invalidated.push(...paths)},
  applyQuery(){},updateDetails(){},paintGrid(){},paintFilm(){},showSingle(){},status(){},console};
 const poll=source.slice(source.indexOf('  let writerEvent = 0;'),source.indexOf('  // One poll at a time.'));
 const invalidate=source.slice(source.indexOf('  function invalidateGradePictures'),source.indexOf('  const pasteGrades ='));
 vm.runInNewContext(invalidate+poll+';this.poll=pollSettings;',context);
 return {context,cell,invalidated};
}

test('settings poll replaces an old tile even when metadata already has the saved grade',async()=>{
 const {context,cell,invalidated}=settingsPoll();await context.poll();
 assert.deepEqual(invalidated,['photo']);assert.equal(cell.controller.signal.aborted,true);
});

test('settings poll invalidates finishing work when it discovers a changed grade',async()=>{
 const {context,invalidated}=settingsPoll({photoGrade:'old'});await context.poll();
 assert.deepEqual(invalidated,['photo']);assert.equal(context.state.allPhotos[0].grade_identity,'new');
});

test('settings poll retains a current tile and an active atomic Grade handoff',async()=>{
 const current=settingsPoll({tileGrade:'new'});await current.context.poll();assert.deepEqual(current.invalidated,[]);
 const pending=settingsPoll({handoff:{grade_identity:'new',received:Date.now()}});
 await pending.context.poll();assert.deepEqual(pending.invalidated,[]);assert.equal(pending.cell.controller.signal.aborted,false);
});


test('a failed handoff cannot leave the old filmstrip tile under updated photo metadata',async()=>{
 const run=settingsPoll({handoff:{grade_identity:'new',received:Date.now(),finished:true}});
 run.context.state.cells.clear();run.context.state.filmCells.set('photo',run.cell);
 await run.context.poll();assert.deepEqual(run.invalidated,['photo']);assert.equal(run.cell.controller.signal.aborted,true);
});

test('ready Grade thumbnail installs on return while the extra-work queue is blocked',async()=>{
 const packet={path:'photo',id:'saved'},entry={deferred:packet,queue:new Promise(()=>{})};
 const installs=[],shown=[];
 const context={gradeHandoffs:new Map([['photo',entry]]),state:{active:true},performance,
  replaceGradeThumbnail:async p=>{installs.push(p);return true;},
  HDRLibraryStopwatch:(name)=>shown.push(name),logView:()=> 'grid',aborted:()=>false,checkSettingsNow(){throw Error('unexpected fallback');}};
 const start=source.indexOf('  function replaceDeferredGradeThumbnails()'),end=source.indexOf('  gradePictureChannel.onmessage',start);
 vm.runInNewContext(source.slice(start,end)+';replaceDeferredGradeThumbnails();',context);
 await entry.installing;
 assert.equal(installs.length,1);assert.equal(installs[0],packet);assert.equal(entry.deferred,null);
 assert.deepEqual(shown,['grade_picture_shown_on_return']);
});

test('a stalled Grade publication falls back after the clean handoff window',async()=>{
 const run=settingsPoll({handoff:{grade_identity:'new',received:Date.now()-501}});
 await run.context.poll();assert.deepEqual(run.invalidated,['photo']);
});
