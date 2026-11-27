const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const list=require('./release/drivers.json');
const timing=require('./release/timings.cjs');
const catalogue=require('../tools/test-catalogue.cjs');
test('all release drivers have usable agent briefs, requirements and platform estimates',()=>{
  assert.equal(list.schemaVersion,2);
  for (const row of list.drivers) {
    assert.ok(typeof row.brief==='string' && row.brief.length>80,row.path);
    assert.ok(Array.isArray(row.requirements)&&row.requirements.length,row.path);
    assert.ok(row.platforms.os.length && row.platforms.os.every(p=>['win','mac','linux'].includes(p)),row.path);
    assert.ok(row.platforms.notes.length,row.path);
    for (const p of ['win','mac']) {
      assert.ok(Object.hasOwn(row.expectedMinutes,p),row.path);
      assert.ok(row.expectedMinutes[p]===null || Number.isFinite(row.expectedMinutes[p])&&row.expectedMinutes[p]>0,row.path);
    }
    assert.ok(Object.hasOwn(row,'deadlineMinutes') && (row.deadlineMinutes===null || row.deadlineMinutes>0),row.path);
  }
});
test('committed timings are valid and only reference known drivers',()=>{
  const data=timing.readTimings();
  for (const name of Object.keys(data.drivers)) assert.ok(list.drivers.some(row=>row.path===name),name);
  assert.throws(()=>timing.validateTimings({schemaVersion:1,drivers:{x:{win:{sampleSeconds:[]}}}}),/Invalid timing/);
  assert.throws(()=>timing.validateTimings({schemaVersion:2,drivers:{}}),/schema/);
});
test('test catalogue is current',()=>assert.equal(fs.readFileSync(catalogue.FILE,'utf8').replace(/\r\n/g,'\n'),catalogue.render()));
test('durable timing import is idempotent, platform isolated and ignores unsuccessful attempts',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-timings-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'timings.json');
  const record={driver:'a',revision:'abc',recordedAt:'2026-11-27T00:00:00.000Z',log:'a.log',durationSeconds:30,exitCode:0,platform:'win32'};
  const records=[record,{...record,recordedAt:'2026-11-27T00:01:00.000Z',durationSeconds:60},
    {...record,timedOut:true,durationSeconds:900},{...record,interrupted:true},{...record,partial:true},
    {...record,recordedAt:'2026-11-27T00:02:00.000Z',durationSeconds:3,exitCode:1}];
  const first=timing.updateTimings(records,file,'win32');
  assert.equal(first.drivers.a.win.sampleCount,2); assert.equal(first.drivers.a.win.medianSeconds,45);
  assert.deepEqual(timing.updateTimings(records,file,'win32'),first);
  assert.deepEqual(timing.updateTimings(records,file,'darwin'),first);
  assert.deepEqual(timing.fallbackRecords(first,'darwin'),[]);
  const fallback=timing.fallbackRecords(first,'win32');
  assert.equal(fallback[0].durationSeconds,45);
  assert.equal(require('./release/runner.cjs').attemptTimeout('a',fallback),900000);
  assert.equal(require('./release/runner.cjs').estimate([{path:'a'}],fallback).seconds,45);
});

test('a complete pass rebaselines timing data polluted by old short failures',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-timings-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'timings.json');
  const starting={schemaVersion:1,drivers:{a:{mac:{
    sampleSeconds:[3,4,5],sampleCount:3,medianSeconds:4,lastSeconds:5,revision:'old',
    date:'2026-11-27',lastSampleKey:'2026-11-27T00:00:00.000Z|a.log',exitCode:1,
    source:'release runner history (complete attempts, including failures)'
  }}}};
  fs.writeFileSync(file,JSON.stringify(starting));
  const record={driver:'a',revision:'new',recordedAt:'2026-11-27T00:01:00.000Z',log:'a.log',durationSeconds:42,exitCode:0,platform:'darwin'};
  const after=timing.updateTimings([record],file,'darwin');
  assert.deepEqual(after.drivers.a.mac.sampleSeconds,[42]);
  assert.equal(require('./release/runner.cjs').attemptTimeout('a',[],after,'darwin'),71400);
});
