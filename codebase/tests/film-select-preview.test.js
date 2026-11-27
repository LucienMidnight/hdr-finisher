const {test}=require('node:test');
const assert=require('node:assert/strict');
const {transaction}=require('../frontend/film-select-preview.js');

function setup(flush=()=>true) {
  const state={value:'original', saved:'original', history:[], redo:[], generation:0, indicators:'original'};
  const t=transaction({flush,read:()=>({value:state.saved}),
    preview:(_,value)=>{state.value=value;state.generation++;},
    restore:base=>{state.value=base.value;state.generation++;},
    commit:value=>{state.history.push(state.saved);state.saved=state.value=state.indicators=value;},
  });
  return {t,state};
}
test('arrows are temporary; a changed commit makes exactly one undo to the opening value',async()=>{
  const {t,state}=setup(); await Promise.resolve();
  t.choose('first'); const oldGeneration=state.generation;
  t.choose('second');t.choose('final');
  assert.equal(state.saved,'original');assert.equal(state.indicators,'original');assert.deepEqual(state.history,[]);
  assert.notEqual(oldGeneration,state.generation,'older render generation is retired');
  await t.close(true);
  assert.deepEqual(state.history,['original']);assert.equal(state.saved,'final');
  state.redo.push(state.saved);state.saved=state.history.pop();assert.equal(state.saved,'original');
  state.saved=state.redo.pop();assert.equal(state.saved,'final');
});
for(const cancel of [true,false]) test(cancel?'Escape leaves history, redo and save untouched':'committing original after previewing others creates no edit',async()=>{
  const {t,state}=setup();await Promise.resolve();state.redo.push('previous-redo');
  t.choose('other'); if(!cancel)t.choose('original');await t.close(!cancel);
  assert.equal(state.value,'original');assert.equal(state.saved,'original');
  assert.deepEqual(state.history,[]);assert.deepEqual(state.redo,['previous-redo']);assert.equal(state.indicators,'original');
});
test('fast arrows and commit while baseline save is pending use the latest choice only',async()=>{
  let resolve;const {t,state}=setup(()=>new Promise(r=>{resolve=r;}));
  t.choose('old');t.choose('latest');const closed=t.close(true);t.choose('too-late');
  assert.equal(state.value,'original');resolve(true);await closed;
  assert.equal(state.saved,'latest');assert.deepEqual(state.history,['original']);
});
test('failed baseline flush never previews or persists an option',async()=>{
  const {t,state}=setup(()=>false);t.choose('other');await assert.rejects(t.close(true));
  assert.equal(state.saved,'original');assert.deepEqual(state.history,[]);
});


test('Escape while the opening save is pending never applies a transient value',async()=>{
 let resolve;const {t,state}=setup(()=>new Promise(r=>{resolve=r;}));
 t.choose('other');const closed=t.close(false);resolve(true);await closed;
 assert.equal(state.value,'original');assert.equal(state.saved,'original');assert.deepEqual(state.history,[]);
});
