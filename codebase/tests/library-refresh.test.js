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
 const context={state,selected:()=>({path:'photo'}),readyWindow:{invalidate(){}},quickWindow:{invalidate(){}},recentPictures:new Map(),HDRLibraryScenes:{invalidate(){}},window:{},tilePool:{discard(){}},$:()=>native};
 const fn=source.slice(source.indexOf('  function invalidateGradePictures'),source.indexOf('  const pasteGrades'));
 vm.runInNewContext(fn+';invalidateGradePictures(["photo"],{source:true});',context);
 assert.ok(owners.every(c=>c.signal.aborted));assert.equal(state.cells.size,0);assert.equal(state.filmCells.size,0);
 assert.equal(state.fullDetail,null);assert.equal(state.nativeLoading,false);assert.equal(native.hidden,true);
});
