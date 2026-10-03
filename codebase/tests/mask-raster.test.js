const test=require('node:test'),assert=require('node:assert/strict');
const {HDRMaskRaster:r}=require('../frontend/mask-raster');
const brush={operator:'leaf',leaf:{type:'brush',strokes:[]}};
const path={operator:'leaf',leaf:{type:'path',nodes:[{x:.1,y:.1},{x:.9,y:.1},{x:.5,y:.9}]}};
test('only geometry and feather forms with an exact tile contract are admitted',()=>{
  assert.ok(r.eligible(brush,'{}'));assert.ok(r.eligible(path,'{}'));
  for(const geometry of [{rotation:90},{rotation:270,flip_horizontal:true,flip_vertical:true}])assert.ok(r.eligible(brush,JSON.stringify(geometry)));
  for(const geometry of [{rotation:45},{crop:{x:.1,width:.9}},{straighten_angle:1},{perspective_horizontal:.1}])assert.equal(r.eligible(brush,JSON.stringify(geometry)),false);
  for(const leaf of [{...brush.leaf,mask_feather:.001},{...brush.leaf,mask_shift_edge:.001}])assert.equal(r.eligible({operator:'leaf',leaf},'{}'),false);
  assert.ok(r.eligible({operator:'leaf',leaf:{...path.leaf,feather_mode:'outer_boundary',feather:.1}},'{}'));
  assert.equal(r.eligible({operator:'union',children:[brush,path]},'{}'),false);
});
test('tile packing culls remote strokes and keeps overlapping stroke order and pressure',()=>{
  const stroke=(x,erase=false)=>({points:[{x,y:.5,pressure:.4}],radius:.1,hardness:.5,flow:.3,opacity:.8,erase});
  const expression={operator:'leaf',inverted:true,leaf:{type:'brush',strokes:[stroke(.1),stroke(.5),stroke(.5,true),stroke(.5)]}};
  const p=r.parameters(expression,{x:40,y:20,width:20,height:20},100,60);
  assert.equal(p[5],1);assert.equal(p[7],3);assert.equal(p[14],0);assert.equal(p[29],1);assert.equal(p[44],0);
  assert.ok(Math.abs(p[24]-.04)<1e-7);
});
test('oversized intersecting geometry declines before allocating GPU resources',()=>{
  const stroke={radius:.2,points:Array.from({length:2050},(_,i)=>({x:.4+(i%2)*.1,y:.5})),hardness:.5};
  assert.equal(r.parameters({operator:'leaf',leaf:{type:'brush',strokes:[stroke]}},{x:0,y:0,width:100,height:60},100,60),null);
});

test('quarter-turn packing culls in source space and retains source brush pitch',()=>{
  const expression={operator:'leaf',leaf:{type:'brush',strokes:[{points:[{x:.1,y:.5}],radius:.1}]}};
  const geometry=JSON.stringify({rotation:90});
  const visible=r.parameters(expression,{x:25,y:5,width:10,height:10},60,100,geometry);
  const remote=r.parameters(expression,{x:25,y:85,width:10,height:10},60,100,geometry);
  assert.deepEqual(Array.from(visible.slice(3,5)),[100,60]);
  assert.equal(visible[7],1);assert.equal(remote[7],0);assert.equal(visible[9],1);
  assert.ok(Math.abs(visible[24]-.1)<1e-7);
});
