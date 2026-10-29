const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function owner(){const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../frontend/library-ram.js'),'utf8'),ctx);return ctx.HDRLibraryRAM;}
test('ready surfaces and direct scenes share one byte ceiling',()=>{
 const ram=owner();let a=300e6,b=300e6;
 ram.register('ready','sharp',()=>a,n=>{a=n;});ram.register('direct','sharp',()=>b,n=>{b=n;});
 ram.enforce();assert.equal(a+b,512e6);
 assert.equal(ram.admit('sharp',1),false);
});
test('moderate pressure halves each share and critical pressure drops reconstructible pictures',()=>{
 const ram=owner();let a=100,b=100;
 ram.register('a','thumbnails',()=>a,n=>{a=n;});ram.register('b','sharp',()=>b,n=>{b=n;});
 ram.apply({pressure:'moderate',reclaim:true,budgetPressure:false});assert.equal(a,50);assert.equal(b,50);
 ram.apply({pressure:'moderate',reclaim:true,budgetPressure:false});assert.equal(a,50);assert.equal(b,50);
 ram.apply({pressure:'moderate',reclaim:true,budgetPressure:true});assert.equal(a,25);assert.equal(b,25);
 ram.apply({pressure:'critical'});assert.equal(a,0);assert.equal(b,0);
});
