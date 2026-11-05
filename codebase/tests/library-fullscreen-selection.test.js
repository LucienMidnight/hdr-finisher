const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');

// Runs the real setReview from photo-library.js with small stand-ins.
function load(selection,index){
 const source=fs.readFileSync(require.resolve('../frontend/photo-library'),'utf8');
 const fn=source.slice(source.indexOf('  function setReview(review)'),source.indexOf('  function openGrade()'));
 const photos=['a','b','c'].map(path=>({path}));
 const state={photos,index,selection:new Set(selection),anchor:0,view:'grid',review:false,zoom:false};
 const context={state,selected:()=>state.photos[state.index],library:{classList:{toggle(){}}},
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
