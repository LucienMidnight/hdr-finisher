const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('frontend/photo-library.js','utf8');
const mutations=source.slice(source.indexOf('  function invalidateGradePictures'),source.indexOf('  const pasteGrades'));
const installer=source.slice(source.indexOf('  async function replaceGradeThumbnail'),source.indexOf('  // Returning from Grade:'));

for(const mutation of ['Undo','display','source','cell'])test(`a saved-thumbnail flight cannot publish after ${mutation}`,async()=>{
  const photo={path:'photo',bytes:10,mtime_ns:20,grade_identity:'edited',edited:true};
  const original=new AbortController();let appended=0,release,entered;
  const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const cell={photo,identity:'old',controller:original,element:{remove(){},querySelector:()=>({append(){appended++;}})},fallback:{width:1,height:1}};
  const entry={controller:new AbortController()},gradeHandoffs=new Map([['photo',entry]]);
  const state={active:true,allPhotos:[photo],cells:new Map([['photo',cell]]),filmCells:new Map(),displayEpoch:0,hdr:false};
  const canvas={width:1,height:1,getContext:()=>({unconfigure(){}})};
  const context={state,gradeHandoffs,AbortController,selected:()=>null,readyWindow:{invalidate(){}},quickWindow:{invalidate(){}},recentPictures:new Map(),
    HDRLibraryScenes:{invalidate(){}},tilePool:{discard(){},values:()=>[],take:()=>null},window:{},pictureIdentity:p=>`${p.path}|${p.grade_identity}|${p.bytes}|${p.mtime_ns}`,
    tileKey:()=>'',document:{createElement:()=>canvas},HDRLibraryFinishedThumbnails:{load:async()=>{entered();await gate;return {key:'stale'};}}};
  vm.runInNewContext(mutations+installer+';this.install=replaceGradeThumbnail;this.invalidate=invalidateGradePictures;',context);
  const pending=context.install({path:'photo',id:'old-ticket',grade_identity:'late',edited:true});
  await started;
  if(mutation==='Undo'){context.invalidate(['photo']);Object.assign(photo,{grade_identity:'undone',edited:false});}
  if(mutation==='display')state.displayEpoch++;
  if(mutation==='source')photo.mtime_ns++;
  if(mutation==='cell')state.cells.delete('photo');
  release();assert.equal(await pending,false);assert.equal(appended,0);assert.notEqual(photo.grade_identity,'late');assert.equal(canvas.width,0);
  if(mutation==='Undo'){assert.equal(entry.controller.signal.aborted,true);assert.equal(gradeHandoffs.size,0);assert.equal(state.cells.size,0);assert.equal(photo.edited,false);}
});

test('Single resize during preparation hides every surface and never requests or borrows old pixels',async()=>{
  const photo={path:'photo',grade_identity:'old'},surfaces=new Map(['single-picture','native-picture'].map(id=>[id,{hidden:false}]));
  const state={active:true,view:'single',single:new AbortController(),native:new AbortController()};let restored=0;
  const single=source.slice(source.indexOf('  async function showSingle()'),source.indexOf('  function positionZoom()'));
  const context={state,navigationTrace:null,selected:()=>photo,pasteProgress:new Map([['photo','Preparing adjustments']]),
    restoreStandIn:()=>restored++,$:id=>surfaces.get(id),compare:{enabled:()=>false}};
  vm.runInNewContext(single+';this.show=showSingle;',context);
  await context.show();await context.show();
  assert.ok([...surfaces.values()].every(canvas=>canvas.hidden));assert.equal(restored,2);assert.equal(state.single.signal.aborted,true);assert.equal(state.native.signal.aborted,true);
});

test('preparation generations reject a previous draw even when cancellation restores the unchanged grade',()=>{
  const photo={path:'photo',grade_identity:'old'},context={state:{displayEpoch:0,hdr:false},pictureIdentity:photo=>photo.grade_identity};
  const guards=source.slice(source.indexOf('  const pasteProgress'),source.indexOf('  function pasteFeedback'));
  vm.runInNewContext(guards+';this.guard=publicationGuard;this.progress=pasteProgress;this.generations=gradeMutations;',context);
  const before=context.guard(photo);assert.equal(before(),true);
  context.progress.set('photo','Preparing adjustments');context.generations.set('photo',1);assert.equal(before(),false);assert.equal(context.guard(photo)(),false);
  context.progress.delete('photo');assert.equal(before(),false);assert.equal(context.guard(photo)(),true);
});

test('Compare preparation hides fitted and native surfaces without loading a stale grade',async()=>{
  const compareSource=fs.readFileSync('frontend/library-compare.js','utf8');
  const show=compareSource.slice(compareSource.indexOf('    async function show()'),compareSource.indexOf('    function zoom('));
  const sides=[0,1].map(()=>({fit:{cloneNode:()=>({hidden:false,style:{}}),replaceWith(){}},native:{hidden:false},note:{},stage:{}}));
  const context={enabled:true,generation:1,cancel(){},root:{},$:()=>({}),layout(){},sides,left:null,AbortController,window:{},
    o:{photos:()=>[{path:'photo'}],selected:()=>({path:'photo'}),active:()=>true,publicationGuard:()=>()=>false,load:()=>assert.fail('Compare loaded during preparation')}};
  vm.runInNewContext(show+';this.show=show;',context);await context.show();
  assert.ok(sides.every(side=>side.fit.hidden&&side.native.hidden&&side.note.textContent==='Preparing adjustments'));
});

test('native detail cannot start a source request during preparation',async()=>{
  const native=source.slice(source.indexOf('  async function showNative()'),source.indexOf('  function singleFrameInset('));
  const state={fitMeta:{route:'stored-screen-preview'},zoom:true,detailRequested:'photo',active:true,view:'single',zoomScale:1};
  const context={state,selected:()=>({path:'photo'}),window:{devicePixelRatio:1},$:()=>({}),AbortController,publicationGuard:()=>()=>false};
  vm.runInNewContext(native+';this.show=showNative;',context);await context.show();assert.equal(state.nativeLoading,false);
});
