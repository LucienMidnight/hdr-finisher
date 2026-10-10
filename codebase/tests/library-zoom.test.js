const test = require("node:test"), assert = require("node:assert/strict");
const { center, click } = require("../frontend/library-zoom.js");
test("Fit clicks account for letterboxing and stay on the photo", () => {
 assert.deepEqual(click(500, 500, 1000, 1000, 2000, 1000), { x: .5, y: .5 });
 assert.deepEqual(click(750, 375, 1000, 1000, 2000, 1000), { x: .75, y: .25 });
 assert.deepEqual(click(100, 0, 1000, 1000, 2000, 1000), { x: .1, y: 0 });
});
test("Native viewport centers stay inside source edges and center small pictures", () => {
 assert.deepEqual(center(0, 1, 3000, 2000, 1000, 500), { x: 1/6, y: .875 });
 assert.deepEqual(center(.8, .2, 200, 100, 1000, 500), { x: .5, y: .5 });
});
