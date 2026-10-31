const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MemoryMonitor}=require('../tools/library-memory-monitor.cjs');
const GB=1e9;
const sample=(at,totalBytes,availableBytes=10*GB)=>({at,totalBytes,availableBytes,systemReserveBytes:2*GB});
test('brief overrun passes and records peak, active type, duration and settling',()=>{
 const m=new MemoryMonitor(4*GB),grant={id:'a',path:'photo.avif'};
 m.sample(sample(0,3*GB));m.sample(sample(500,4.011418177*GB),[grant]);
 m.sample(sample(1000,4_100_000_000),[grant]);m.sample(sample(1500,3.8*GB));m.sample(sample(2000,3.4*GB));
 const r=m.report();assert.equal(r.memoryViolation,null);assert.equal(r.overCeilingBytes,100000000);
 assert.equal(r.overCeilingEpisodes.length,1);assert.equal(r.overCeilingEpisodes[0].durationMs,1000);
 assert.equal(r.grantsAtPeak[0].fileType,'.avif');assert.equal(r.settledUnderTarget,true);
});
test('10 percent is accepted but one byte beyond stops',()=>{
 const m=new MemoryMonitor(4*GB);m.sample(sample(0,4.4*GB));assert.equal(m.violation,null);
 m.sample(sample(500,4.4*GB+1));assert.equal(m.violation.reason,'ceiling plus 10%');
});
test('reserve remains hard even below planning ceiling',()=>{
 const m=new MemoryMonitor(4*GB);m.sample(sample(0,3*GB,2*GB));assert.equal(m.violation,null);
 m.sample(sample(500,3*GB,2*GB-1));assert.equal(m.violation.reason,'system reserve');
});
test('being below ceiling is insufficient until below target',()=>{
 const m=new MemoryMonitor(4*GB);m.sample(sample(0,3.5*GB));assert.equal(m.report().settledUnderTarget,false);
});
