const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {viewportTargets}=require('../tools/library-measure-viewport.cjs');
test('folder discovery replaces the observed screen instead of waiting on rows that moved offscreen',()=>{
 let rows=['before.dng'];const document={getElementById:()=>({getBoundingClientRect:()=>({top:0,bottom:100})}),querySelectorAll:()=>rows.map(path=>({dataset:{path},getBoundingClientRect:()=>({top:1,bottom:90})}))};
 const observe=()=>vm.runInNewContext('('+viewportTargets+')()',{document});
 assert.deepEqual(Array.from(observe()),['before.dng']);rows=['after.dng','second.dng'];assert.deepEqual(Array.from(observe()),rows);
});
