const test = require("node:test");
const assert = require("node:assert/strict");
const lens = require("../frontend/lens-filters.js");
const golden = require("./fixtures/lens-filter-upstream.json");
function encircledLight(parts, scale, cap, radius) {
  const energy = [0, 0, 0];
  for (const [sigmaUm, red, green, blue] of parts) {
    const sigma = sigmaUm * scale;
    const extent = Math.min(cap, Math.floor(3 * sigma + .5));
    const axis = Array.from({ length: 2 * extent + 1 },
      (_, i) => Math.exp(-.5 * ((i - extent) / Math.max(sigma, 1e-6)) ** 2));
    const sum = axis.reduce((total, value) => total + value, 0);
    let inside = 0;
    for (let y = -extent; y <= extent; y++) {
      for (let x = -extent; x <= extent; x++) {
        if (x * x + y * y <= radius * radius) inside += axis[x + extent] * axis[y + extent];
      }
    }
    [red, green, blue].forEach((weight, c) => { energy[c] += weight * inside / (sum * sum); });
  }
  return energy;
}

test("compact lens point-spread preserves RGB energy and matches the upstream reference", () => {
  assert.deepEqual(lens.components[0], []);
  for (let type = 1; type < lens.names.length; type++) {
    const family = lens.names[type];
    const parts = lens.components[type];
    assert.equal(parts.length, 8);
    const compact = parts.map(([sigma, weights]) => [sigma, ...weights]);
    for (const [sigma, ...weights] of compact) {
      assert.ok(sigma >= 0 && weights.every(v => v >= 0));
    }
    const energy = encircledLight(compact, .036, 54, Infinity);
    assert.ok(energy.every(value => Math.abs(value - 1) <= 2e-9));
    for (const [scale, cap] of [[.036, 54], [.24, 64]]) {
      for (const radius of [0, 1, 2, 4, 8, 16, 32, 64]) {
        const old = encircledLight(golden[family], scale, cap, radius);
        const fitted = encircledLight(compact, scale, cap, radius);
        const scatter = lens.scatter(type, 2);
        fitted.forEach((value, c) => assert.ok(Math.abs(old[c] - value) * scatter < .01,
          `${family} radius ${radius}, channel ${c}`));
      }
    }
  }
});
test("commercial filter strength interpolates continuously in log stops",()=>{
  for (const [type,gain] of [[1,.65],[2,.75],[3,1.05],[4,1]]) {
    for (const [strength,base] of [[.125,.1],[.25,.2],[.5,.35],[1,.55],[2,.75],[2**-.5,.45]]) assert.ok(Math.abs(lens.scatter(type,strength)-base*gain)<=2e-9);
  }
  assert.equal(lens.scatter(0,2),0);
});

test("lens tile plans require their spatial halo",()=>{
  const {HDRTileScheduler}=require("../frontend/tile-scheduler.js");
  assert.equal(HDRTileScheduler.declaredHalo([{id:"lens-filter",halo:64}]),64);
  assert.throws(()=>HDRTileScheduler.declaredHalo([{id:"lens-filter"}]),/invalid halo/);
});
