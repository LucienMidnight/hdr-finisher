/** The straighten/perspective map used for GPU masks against the export geometry stage (CPU only). */
const assert=require('node:assert/strict'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{test}=require('node:test');
const {HDRGeometryResample:G}=require('../frontend/geometry-resample.js');
const root=path.join(__dirname,'..');
const cases=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import base64,json,numpy as np
from backend.hdr_finisher.models import GeometryAdjustments
from backend.hdr_finisher.finishing import apply_geometry,_oriented_view,geometry_output_dimensions
rng=np.random.default_rng(7);cases=[]
recipes=[dict(straighten_angle=1.3),dict(straighten_angle=-7.25),dict(straighten_angle=31),dict(straighten_angle=-44.5),
 dict(straighten_angle=2,perspective_rotate=-.75),dict(perspective_horizontal=18),dict(perspective_vertical=-33),
 dict(perspective_horizontal=-12,perspective_vertical=9,straighten_angle=3.5),dict(perspective_vertical=60,perspective_rotate=-2),
 dict(straighten_angle=5,crop=dict(x=.11,y=.07,width=.63,height=.81)),dict(perspective_horizontal=25,crop=dict(x=.2,y=.15,width=.5,height=.7))]
for i,recipe in enumerate(recipes*3):
 w,h=[(97,61),(64,120),(233,155)][i%3]
 geometry=GeometryAdjustments(rotation=[0,90,180,270][i%4],flip_horizontal=bool(i%2),flip_vertical=bool(i%5==0),**recipe)
 source=rng.integers(0,256,(h,w)).astype(np.float32)
 if i%7==0: source=np.clip(source,40,180)
 expected=apply_geometry(source[...,None],geometry)[...,0]
 oriented=np.ascontiguousarray(_oriented_view(source,geometry))
 cases.append(dict(width=w,height=h,geometry=geometry.model_dump(),oriented=base64.b64encode(oriented.astype(np.float32).tobytes()).decode(),
  orientedShape=oriented.shape,expected=base64.b64encode(expected.astype(np.float32).tobytes()).decode(),shape=expected.shape))
sizes=[]
for w,h in [(7362,4912),(4912,7362),(9504,6336),(6000,4000)]:
 for recipe in recipes:
  geometry=GeometryAdjustments(**recipe);sizes.append(dict(width=w,height=h,geometry=geometry.model_dump(),output=geometry_output_dimensions(w,h,geometry)))
print(json.dumps(dict(cases=cases,sizes=sizes)))
`],{cwd:root,encoding:'utf8',maxBuffer:256*1024*1024}));
const floats=text=>{const bytes=Buffer.from(text,'base64');return new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);};
const cubic=(a,b,c,d,t)=>b+t*((-a+c)+t*((2*(a-b)+c-d)+t*(-a+b-c+d)));
test('the plan and Pillow bicubic reproduce the export geometry stage pixel for pixel',()=>{
 let worst=0;
 for(const item of cases.cases){
  const recipe=G.plan(item.width,item.height,item.geometry),[height,width]=item.shape,[oh,ow]=item.orientedShape;
  assert.ok(recipe,JSON.stringify(item.geometry));
  assert.deepEqual([recipe.width,recipe.height,recipe.orientedWidth,recipe.orientedHeight],[width,height,ow,oh],JSON.stringify(item.geometry));
  const source=floats(item.oriented),expected=floats(item.expected);
  let low=Infinity,high=-Infinity;for(const v of source){low=Math.min(low,v);high=Math.max(high,v);}
  const at=(x,y)=>source[Math.min(oh-1,Math.max(0,y))*ow+Math.min(ow-1,Math.max(0,x))];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   let [sx,sy]=G.sample(recipe,x,y);
   assert.ok(sx>=0&&sx<ow&&sy>=0&&sy<oh,'the safe inset keeps every sample inside the source');
   sx-=.5;sy-=.5;const fx=Math.floor(sx),fy=Math.floor(sy),rows=[-1,0,1,2].map(j=>cubic(at(fx-1,fy+j),at(fx,fy+j),at(fx+1,fy+j),at(fx+2,fy+j),sx-fx));
   const value=Math.min(high,Math.max(low,Math.fround(cubic(...rows,sy-fy))));
   worst=Math.max(worst,Math.abs(value-expected[y*width+x]));
  }
 }
 assert.ok(worst<2e-3,`worst difference ${worst} levels`);
});
test('native output dimensions match the export for straighten, perspective and crops',()=>{
 for(const item of cases.sizes){
  const recipe=G.plan(item.width,item.height,item.geometry);
  assert.deepEqual([recipe.width,recipe.height],item.output,`${item.width}x${item.height} ${JSON.stringify(item.geometry)}`);
 }
});
test('index geometry and unsupported rotations need no resampling plan',()=>{
 assert.equal(G.plan(100,80,{rotation:90,flip_horizontal:true}),null);
 assert.equal(G.plan(100,80,{rotation:45,straighten_angle:2}),null);
 assert.equal(G.plan(100,80,{straighten_angle:90}),null);
});
