const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(require.resolve('../frontend/library-culling'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
test('ratings appear before saving, keep their captured photo and survive older replies; errors roll back',async()=>{
 const window={};vm.runInNewContext(code,{window,structuredClone});
 const photos=['a','b'].map(path=>({path,marks:{rating:0,pick:'unmarked',label:'',tags:[]}}));
 let selected='a';const requests=[];
 const culling=window.HDRLibraryCulling.create({photos:()=>photos,selection:()=>new Set([selected]),status:()=>{},updated:()=>{},optimistic:()=>{},api:(route,body)=>new Promise((resolve,reject)=>requests.push({body,resolve,reject}))});
 culling.shortcut('3');assert.equal(photos[0].marks.rating,3);selected='b';culling.shortcut('p');assert.equal(photos[1].marks.pick,'pick');
 selected='a';culling.shortcut('5');assert.equal(photos[0].marks.rating,5);await tick();
 assert.deepEqual(Array.from(requests[0].body.paths),['a']);
 requests[0].resolve({photos:[{path:'a',marks:{...photos[0].marks,rating:3}}],warnings:[],undo_available:true});await tick();
 assert.equal(photos[0].marks.rating,5);assert.equal(photos[1].marks.pick,'pick');assert.deepEqual(Array.from(requests[1].body.paths),['b']);
 requests[1].resolve({photos:[{path:'b',marks:{...photos[1].marks}}],warnings:[],undo_available:true});await tick();
 requests[2].reject(Error('Disk unavailable'));await culling.settled();
 assert.equal(photos[0].marks.rating,3);assert.equal(photos[1].marks.pick,'pick');
});
