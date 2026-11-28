const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function owner(fetch){const ctx=vm.createContext({fetch});vm.runInContext(fs.readFileSync(require.resolve('../frontend/library-ram.js'),'utf8'),ctx);return ctx.HDRLibraryRAM;}
test('ready surfaces and direct scenes share one byte ceiling',()=>{
 const ram=owner();let a=300e6,b=300e6;
 ram.register('ready','sharp',()=>a,n=>{a=n;});ram.register('direct','sharp',()=>b,n=>{b=n;});
 ram.enforce();assert.equal(a+b,512e6);
 assert.equal(ram.admit('sharp',1),false);
});

test('overlapping reports send fresh byte counts in order even after a failed request',async()=>{
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 const requests=[];let sharp=300;
 const ram=owner((_url,options)=>new Promise(resolve=>requests.push({body:JSON.parse(options.body),resolve})));
 const limits=limitBytes=>({ok:true,json:async()=>({caches:{sharp:{limitBytes},thumbnails:{limitBytes}}})});
 ram.register('ready','sharp',()=>sharp,target=>{sharp=target;});
 const periodic=ram.report();await tick();assert.equal(requests[0].body.sharp,300);
 const reclaim=ram.report();await tick();assert.equal(requests.length,1);
 requests[0].resolve(limits(250));await periodic;await tick();
 assert.equal(requests[1].body.sharp,250,'report accounts for the completed trim');
 const failed=assert.rejects(reclaim,/RAM owner unavailable/);
 const next=ram.report();requests[1].resolve({ok:false});await failed;await tick();
 assert.equal(requests[2].body.sharp,250);
 requests[2].resolve(limits(200));await next;
 assert.equal(ram.limit('sharp'),200);assert.equal(sharp,200);
});
test('moderate pressure halves each share and critical pressure drops reconstructible pictures',()=>{
 const ram=owner();let a=100,b=100;
 ram.register('a','thumbnails',()=>a,n=>{a=n;});ram.register('b','sharp',()=>b,n=>{b=n;});
 ram.apply({pressure:'moderate',level:'moderate',reclaim:true,reclaimLevel:'moderate'});assert.equal(a,50);assert.equal(b,50);
 // Between trims (the main process's cool-down) pressure alone keeps the caches.
 ram.apply({pressure:'moderate',level:'moderate',reclaim:false,reclaimLevel:'none',budgetPressure:true,waiting:true});assert.equal(a,50);assert.equal(b,50);
 ram.apply({pressure:'moderate',level:'moderate',reclaim:true,reclaimLevel:'moderate'});assert.equal(a,25);assert.equal(b,25);
 ram.apply({pressure:'critical',level:'critical',reclaim:true,reclaimLevel:'critical'});assert.equal(a,0);assert.equal(b,0);
});
