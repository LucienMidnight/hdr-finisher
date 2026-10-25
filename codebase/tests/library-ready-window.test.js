const {test}=require('node:test'), assert=require('node:assert/strict');
const {create}=require('../frontend/library-ready-window');
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
test('ready pictures reuse only their exact photo, grade, source and display identity',async()=>{
  for (const field of ['path','grade','source','display']) {
    const photo={path:'a',grade:1,source:1,display:1}, blocked=gate(),disposed=[];
    let calls=0;
    const window=create({key:p=>JSON.stringify(p),load:async p=>{calls++;const image={...p};if(calls===1)await blocked.promise;return image;},dispose:v=>disposed.push(v)});
    const obsolete=window.get(photo);const rejected=assert.rejects(obsolete,{name:'AbortError'});
    await Promise.resolve();photo[field]=field==='path'?'b':2;
    window.update(photo,[]);const correct=await window.get(photo);blocked.resolve();await rejected;
    assert.deepEqual(correct,photo);assert.equal(await window.get(photo),correct);assert.equal(calls,2);
    assert.equal(disposed.length,1);assert.notDeepEqual(disposed[0],correct);
    window.invalidate();assert.equal(window.size(),0);assert.equal(disposed.length,2);
  }
});
test('navigation keeps finished neighbours and cancels unfinished superseded draws',async()=>{
  const a={path:'a'},b={path:'b'},c={path:'c'},blocked=gate();let cancelled=false;
  const window=create({key:p=>p.path,load:async(p,signal)=>{if(p===b){signal.addEventListener('abort',()=>{cancelled=true;});await blocked.promise;}return p;},dispose:()=>{}});
  await window.get(a);const old=window.get(b);const rejected=assert.rejects(old,{name:'AbortError'});await Promise.resolve();
  window.update(c,[a,b]);assert.equal(cancelled,true);assert.equal(await window.get(c),c);assert.equal(await window.get(a),a);
  blocked.resolve();await rejected;
});
