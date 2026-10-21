const assert=require('node:assert/strict');
const test=require('node:test');
const naming=require('../frontend/export-patterns');
const photo={source_path:'D:\\original.raw',copy_name:'Copy: 2',rating:4,capture_time:'2026-10-17T01:00:00'};
test('live exported filename expands every token and sanitizes reserved characters',()=>{
  assert.equal(naming.render('{filename}_{copy}_{sequence:4}_{date:YYYYMMDD}_{rating}_{version}_{preset}',photo,7,'HDR','Delivery'),'original_Copy_ 2_0007_20261017_4_HDR_Delivery');
  assert.equal(naming.render('{date:YYYY}-{date:YYYY-MM}-{date:DD-MM-YYYY}',photo,1,'v','p'),'2026-2026-10-17-10-2026');
  assert.equal(naming.render('{filename}_{date}',{source_path:'a.raw'},1,'v','p'),'a_undated');
  assert.equal(naming.safeComponent('CON'),'_CON');
  assert.equal(naming.safeComponent('a<>:"/\\|?*. '),'a_________');
});
test('filename editor reports invalid tokens and padding',()=>{
  assert.throws(()=>naming.render('{sequence:99}',photo,1,'v','p'),/padding/);
  assert.throws(()=>naming.render('{date:unknown}',photo,1,'v','p'),/date format/);
  assert.throws(()=>naming.render('{missing}',photo,1,'v','p'),/Unknown filename token/);
});
