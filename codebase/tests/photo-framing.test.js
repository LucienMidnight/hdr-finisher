const test=require('node:test'),assert=require('node:assert/strict');
const frame=require('../frontend/photo-framing'),zoom=require('../frontend/library-zoom');
test('viewer framing keeps photo pixels and independent per-side layers',()=>{
 const s=frame.defaults();s.enabled=true;s.frame.value=5;s.border.unit='px';s.border.value=3;
 assert.deepEqual(frame.layout(601,401,s),{width:647,height:447,frame:20,border:3,photo:[23,23,601,401]});
 s.frame.enabled=false;assert.deepEqual(frame.layout(601,401,s).photo,[3,3,601,401]);
 s.enabled=false;assert.deepEqual(frame.layout(601,401,s).photo,[0,0,601,401]);
});
test('unit changes preserve thickness over repeated conversions',()=>{
 let value=5.125;
 for(let i=0;i<1000;i++){value=frame.convert(value,'percent','px',601,401);value=frame.convert(value,'px','percent',601,401);}
 assert(Math.abs(value-5.125)<1e-12);
});
test('Library fits the outer assembly and permits panning to the outer margin',()=>{
 assert.equal(zoom.fitScale(600,400,640,480,20),1);
 const edge=zoom.center(0,0,600,400,300,200,20);
 assert.deepEqual(edge,{x:130/600,y:80/400});
 const from={x:.5,y:.5},next=zoom.anchor(from.x,from.y,400,250,640,480,600,400,1,2,20);
 assert(Math.abs(next.x+(400-320)/(600*2)-(.5+80/600))<1e-12);
});

test('decimal half-pixel ties match persisted source geometry and unit switches',()=>{
 const s=frame.defaults();s.enabled=true;s.frame.value=1.005;s.border.value=0;
 assert.equal(frame.layout(10000,10000,s).frame,101);
 s.frame.value=frame.convert(s.frame.value,'percent','px',10000,10000);s.frame.unit='px';
 assert.equal(s.frame.value,100.5);assert.equal(frame.layout(10000,10000,s).frame,101);
});
