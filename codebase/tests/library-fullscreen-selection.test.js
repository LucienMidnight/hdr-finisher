const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');

// Runs the real setReview from photo-library.js with small stand-ins.
function load(selection,index){
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  function setReview(review)'),source.indexOf('  function openGrade()'));
 const photos=['a','b','c'].map(path=>({path}));
 const state={photos,index,selection:new Set(selection),anchor:0,view:'grid',review:false,zoom:false};
 const context={grid:{scrollTop:417},reviewGrid:null,restoreReviewGrid:null,state,selected:()=>state.photos[state.index],library:{classList:{toggle(){}}},
  $:()=>({setAttribute(){}}),setView:view=>{state.view=view;},postParent(){}};
 vm.runInNewContext(fn+';this.setReview=setReview;',context);
 return {state,setReview:context.setReview};
}

test('fullscreen keeps a multi-photo selection for when it closes',()=>{
 const {state,setReview}=load(['a','b','c'],1);
 setReview(true);
 assert.deepEqual([...state.selection].sort(),['a','b','c']);
 setReview(false);
 assert.equal(state.view,'grid');
 assert.deepEqual([...state.selection].sort(),['a','b','c']);
});

test('fullscreen adds the shown photo when Ctrl-click had deselected it',()=>{
 const {state,setReview}=load(['a','c'],1);
 setReview(true);
 assert.ok(state.selection.has('b'));
 assert.deepEqual([...state.selection].sort(),['a','b','c']);
});

// Exercise the actual grid drawing with layout math, rather than pinning source wording.
function gridHarness(count, index, width=900, height=400) {
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  let gridRequests ='),source.indexOf('  let lastFilmLeft ='));
 const state={active:true,view:'grid',photos:Array.from({length:count},(_,i)=>({path:String(i)})),pins:[],index,size:190,cells:new Map()};
 const grid={clientWidth:width,clientHeight:height,scrollTop:0}, space={style:{}};
 const context={selected:()=>state.photos[state.index],state,grid,space,HDRLibraryLayout:require('../frontend/library-layout'),$:()=>({}),reconcile:()=>0,paintMemoryNeeds(){}};
 vm.runInNewContext(fn+';this.paint=paintGrid;',context);
 return {state,grid,paint:context.paint,restore:value=>vm.runInNewContext(`restoreReviewGrid = ${JSON.stringify(value)}`,context)};
}

test('returning from fullscreen reveals the current photo beyond the old viewport',()=>{
 const {state,grid,paint}=gridHarness(120,119);
 paint(); assert.ok(state.layout.last<state.index);
 paint(true);
 assert.ok(grid.scrollTop>0);
 assert.ok(state.index>=state.layout.first && state.index<state.layout.last);
 assert.ok(state.layout.scrollFor(state.index+state.layout.columns)<=grid.scrollTop+grid.clientHeight);
 // Native fullscreen exit can change column count after the grid has returned.
 grid.clientWidth=600;grid.clientHeight=300;paint();
 assert.ok(state.index>=state.layout.first && state.index<state.layout.last);
 assert.ok(state.layout.scrollFor(state.index+state.layout.columns)<=grid.scrollTop+grid.clientHeight);
});

test('ordinary grid scrolling stays free to move away from the selection',()=>{
 const {grid,paint}=gridHarness(120,0);
 paint();grid.scrollTop=2000;paint();assert.equal(grid.scrollTop,2000);
});


test('fullscreen restores exact non-row-aligned position across OS resize',()=>{
 const {grid,paint,restore}=gridHarness(120,30);
 paint();restore({top:417,path:'30'});paint(true);assert.equal(grid.scrollTop,417);
 grid.clientWidth=600;grid.clientHeight=300;paint();assert.equal(grid.scrollTop,417);
});
test('fullscreen centers changed selection across OS resize',()=>{
 const {state,grid,paint,restore}=gridHarness(120,75);
 paint();restore({top:417,path:'30'});paint();
 const centered=()=>state.layout.scrollFor(75)+state.layout.rowHeight/2-grid.clientHeight/2;
 assert.equal(grid.scrollTop,centered());
 grid.clientWidth=600;paint();assert.equal(grid.scrollTop,centered());
});
