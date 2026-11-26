const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

for (const page of ["index.html", "photo-library.html", "gpu-delivery.html"]) {
  test(`${page} samples the same bounded monotone curves`, () => {
    const root = path.join(__dirname, "../frontend");
    const html = fs.readFileSync(path.join(root, page), "utf8");
    const context = vm.createContext({});
    context.window = context;
    for (const [, script] of html.matchAll(/<script src="\/static\/([^"?]+\.js)/g)) {
      if (["gpu-delivery-curves.js", "curve-editor.js"].includes(script)) {
        vm.runInContext(fs.readFileSync(path.join(root, script), "utf8"), context);
      }
    }
    const curve = [[0, 0], [.5, 1], [1, 0]];
    assert.deepEqual(JSON.parse(JSON.stringify(context.sampleCurvePoints(curve, 5))),
      [[0, 0], [.25, .625], [.5, 1], [.75, .625], [1, 0]]);
    assert.equal(context.sampleCurvePoints(curve, 1024, .25)[0][1], .625);
    const neutral = context.sampleCurvePoints([[0, 0], [1, 1]], 1024);
    assert.ok(neutral.every(([x, y]) => Math.abs(x - y) < 1e-14));
    assert.ok(context.sampleCurvePoints(curve, 1024).every(([, y]) => y >= 0 && y <= 1));
  });
}
