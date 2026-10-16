const assert = require("node:assert/strict");
const {test}=require("node:test");
const fs=require("node:fs");
const path=require("node:path");
const data=require("../frontend/film-character-data.js");
test('bootstrap exactly matches source metadata and every default has confidence and source', () => {
 const canonical=JSON.parse(fs.readFileSync(path.join(__dirname,'../backend/hdr_finisher/film_stocks/character.json'),'utf8'));
 assert.deepEqual(data,canonical);
 assert.equal(Object.keys(data.stocks).length,21);
 for(const record of Object.values(data.stocks)) for(const key of Object.keys(data.stocks.none.defaults)) {
  assert.ok(['Confirmed','Spektrafilm estimate','Proxy','Estimate','Missing'].includes(record.provenance[key].status));
  assert.ok(record.provenance[key].source.length>10);
 }
 const seq=['kodak_ektar_100','kodak_portra_160','kodak_portra_400','kodak_gold_200','kodak_ultramax_400','kodak_portra_800','kodak_portra_800_push1','kodak_portra_800_push2'];
 for(let i=1;i<seq.length;i++) for(const key of ['grain_amount','grain_size']) assert.ok(data.stocks[seq[i]].defaults[key]>data.stocks[seq[i-1]].defaults[key]);
});
