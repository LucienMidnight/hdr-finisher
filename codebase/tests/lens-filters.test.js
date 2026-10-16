const test = require("node:test");
const assert = require("node:assert/strict");
const lens = require("../frontend/lens-filters.js");
const golden = require("./fixtures/lens-filter-upstream.json");
test("lens components agree with pinned upstream coefficients and preserve channel energy", () => {
  for (let type=1;type<lens.names.length;type++) {
    const components=lens.components[type], expected=golden[lens.names[type]];
    assert.equal(components.length,27);
    const energy=[0,0,0];
    components.forEach(([sigma,weights],i)=>{
      [sigma,...weights].forEach((value,j)=>assert.ok(Math.abs(value-expected[i][j])<=2e-9));
      weights.forEach((v,c)=>energy[c]+=v);
    });
    energy.forEach(v=>assert.ok(Math.abs(v-1)<=2e-9));
  }
});
test("commercial filter strength interpolates continuously in log stops",()=>{
  for (const [type,gain] of [[1,.65],[2,.75],[3,1.05],[4,1]]) {
    for (const [strength,base] of [[.125,.1],[.25,.2],[.5,.35],[1,.55],[2,.75],[2**-.5,.45]]) assert.ok(Math.abs(lens.scatter(type,strength)-base*gain)<=2e-9);
  }
  assert.equal(lens.scatter(0,2),0);
});
