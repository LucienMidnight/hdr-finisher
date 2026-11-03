// Independent whole-app acceptance accounting. All values are decimal bytes.
const path = require('node:path');
class MemoryMonitor {
 constructor(ceiling) { this.ceiling=ceiling; this.peakBytes=0; this.episodes=[]; this.active=null; this.violation=null; this.last=null; }
 sample(sample, grants=[]) {
  this.last=sample;
  const ceiling=this.ceiling;
  const activeGrants=grants.map(g=>({...g,fileType:path.extname(g.path||'').toLowerCase()}));
  if(sample.totalBytes>this.peakBytes) { this.peakBytes=sample.totalBytes; this.peakSample=sample; this.grantsAtPeak=activeGrants; }
  if(sample.totalBytes>ceiling) {
   if(!this.active) { this.active={start:sample.at,ceilingBytes:ceiling,peakBytes:sample.totalBytes,grantsAtPeak:activeGrants}; this.episodes.push(this.active); }
   if(sample.totalBytes>this.active.peakBytes) Object.assign(this.active,{peakBytes:sample.totalBytes,grantsAtPeak:activeGrants});
   this.active.overBytes=this.active.peakBytes-this.active.ceilingBytes;
   this.active.observedThrough=sample.at;
   this.active.durationMs=sample.at-this.active.start;
  } else if(this.active) {
   Object.assign(this.active,{end:sample.at,durationMs:sample.at-this.active.start}); this.active=null;
  }
  const reserve=sample.systemReserveBytes;
  const reserveBreach=Number.isFinite(sample.availableBytes)&&Number.isFinite(reserve)&&sample.availableBytes<reserve;
  if(!this.violation&&(sample.totalBytes>ceiling*1.1||reserveBreach))
   this.violation={reason:reserveBreach?'system reserve':'ceiling plus 10%',sample,grants:activeGrants,ceilingBytes:ceiling};
 }
 failures() {
  const errors=[];
  if(this.violation)errors.push('Whole-app memory: '+this.violation.reason);
  if(!this.report().settledUnderTarget)errors.push('Whole-app memory did not settle below ceiling minus 600 MB');
  return errors;
 }
 report() { return {peakBytes:this.peakBytes,peakSample:this.peakSample,grantsAtPeak:this.grantsAtPeak,overCeilingBytes:Math.max(0,this.peakBytes-this.ceiling),overCeilingEpisodes:this.episodes,memoryViolation:this.violation,settledUnderTarget:!!this.last&&this.last.totalBytes<=this.ceiling-600_000_000}; }
}
module.exports={MemoryMonitor};
