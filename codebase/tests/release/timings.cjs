// Portable full-run timings feed the existing estimate and deadline policies. They never certify a pass.
const fs = require('node:fs');
const path = require('node:path');
const FILE = path.join(__dirname, 'timings.json');
const COMPLETE_SUCCESS = 'complete successful release-driver attempts';
const platformKey = value => ({win32:'win', darwin:'mac', win:'win', mac:'mac'})[value];
function validateTimings(data) {
  if (data.schemaVersion !== 1 || !data.drivers || Array.isArray(data.drivers)) throw Error('Invalid timings schema');
  for (const [driver, platforms] of Object.entries(data.drivers)) {
    if (!platforms || typeof platforms !== 'object') throw Error(`Invalid timing: ${driver}`);
    for (const [platform, row] of Object.entries(platforms)) {
      if (!['win','mac'].includes(platform) || !row || !Array.isArray(row.sampleSeconds)
        || !row.sampleSeconds.length || row.sampleSeconds.length > 31
        || row.sampleCount !== row.sampleSeconds.length
        || !row.sampleSeconds.every(n => Number.isFinite(n) && n > 0)
        || ![row.medianSeconds,row.lastSeconds].every(n => Number.isFinite(n) && n > 0)
        || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.revision || !row.source || !row.lastSampleKey
        || !(row.exitCode === null || Number.isInteger(row.exitCode))) throw Error(`Invalid timing: ${driver}/${platform}`);
      const sorted = [...row.sampleSeconds].sort((a,b)=>a-b), mid = Math.floor(sorted.length/2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
      if (Math.abs(median-row.medianSeconds)>0.000001 || row.lastSeconds !== row.sampleSeconds.at(-1)) throw Error(`Invalid timing statistics: ${driver}/${platform}`);
    }
  }
  return data;
}
function readTimings(file = FILE) {
  return fs.existsSync(file) ? validateTimings(JSON.parse(fs.readFileSync(file,'utf8'))) : {schemaVersion:1, drivers:{}};
}
function usable(row) {
  return !row.interrupted && !row.timedOut && !row.partial && !row.error && !row.signal
    && row.exitCode === 0
    && Number.isFinite(row.durationSeconds) && row.durationSeconds >= 1;
}
function updateTimings(records, file = FILE, platform = process.platform) {
  const data = readTimings(file), key = platformKey(platform);
  if (!key) return data;
  const dated = records.filter(usable).map(row => {
    const date = row.recordedAt || row.run?.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/)?.[0]?.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
    return {...row, date, key: date ? `${date}|${path.basename(row.log || '')}` : null};
  }).filter(row => row.key && (!row.platform || platformKey(row.platform) === key)).sort((a,b)=>a.key.localeCompare(b.key));
  for (const row of dated) {
    const previous = data.drivers[row.driver]?.[key];
    if (previous && row.key <= previous.lastSampleKey) continue;
    // A three-second setup error cannot time a complete matrix. Do not
    // carry mixed legacy samples forward on the first verified full pass.
    const priorSuccesses = previous?.source === COMPLETE_SUCCESS ? previous.sampleSeconds : [];
    const samples = [...priorSuccesses,row.durationSeconds].slice(-31);
    const sorted = [...samples].sort((a,b)=>a-b), mid = Math.floor(samples.length/2);
    (data.drivers[row.driver] ||= {})[key] = {medianSeconds: samples.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2,
      lastSeconds: row.durationSeconds, sampleCount:samples.length, sampleSeconds:samples,
      revision:row.revision || 'unrecorded', date:row.date.slice(0,10), exitCode:row.exitCode,
      source:COMPLETE_SUCCESS, lastSampleKey:row.key};
  }
  data.drivers = Object.fromEntries(Object.entries(data.drivers).sort(([a],[b])=>a.localeCompare(b)));
  for (const driver of Object.keys(data.drivers)) data.drivers[driver] = Object.fromEntries(Object.entries(data.drivers[driver]).sort(([a],[b])=>a.localeCompare(b)));
  validateTimings(data);
  const text = JSON.stringify(data,null,2)+'\n';
  if (!fs.existsSync(file) || fs.readFileSync(file,'utf8') !== text) {
    fs.writeFileSync(file+'.tmp',text); fs.renameSync(file+'.tmp',file);
  }
  return data;
}
function fallbackRecords(data = readTimings(), platform = process.platform) {
  const key = platformKey(platform);
  return Object.entries(data.drivers).flatMap(([driver, platforms])=>platforms[key] ? [{driver,
    durationSeconds:platforms[key].medianSeconds, exitCode:platforms[key].exitCode,
    partial:true, source:`committed ${key} timing median (${platforms[key].date}); estimate only`}] : []);
}
module.exports = {validateTimings, readTimings, updateTimings, fallbackRecords, usable};
