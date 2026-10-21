const test = require("node:test"), assert = require("node:assert/strict");
const { center, click, fitScale, wheel, anchor } = require("../frontend/library-zoom.js");
test("Fit clicks account for letterboxing and stay on the photo", () => {
 assert.deepEqual(click(500, 500, 1000, 1000, 2000, 1000), { x: .5, y: .5 });
 assert.deepEqual(click(750, 375, 1000, 1000, 2000, 1000), { x: .75, y: .25 });
 assert.deepEqual(click(100, 0, 1000, 1000, 2000, 1000), { x: .1, y: 0 });
});
test("Native viewport centers stay inside source edges and center small pictures", () => {
 assert.deepEqual(center(0, 1, 3000, 2000, 1000, 500), { x: 1/6, y: .875 });
 assert.deepEqual(center(.8, .2, 200, 100, 1000, 500), { x: .5, y: .5 });
});
test("Wheel zoom stays between fit and 400% and stops once at 100%", () => {
 const fit = fitScale(6000, 4000, 1500, 1000);
 assert.equal(fit, .25);
 assert.ok(wheel(fit, -100, fit) > fit);
 assert.equal(wheel(fit, 100, fit), fit);
 assert.equal(wheel(.95, -100, fit), 1);
 assert.equal(wheel(1.05, 100, fit), 1);
 assert.equal(wheel(3.9, -1000, fit), 4);
});
test("Wheel zoom keeps the point under the pointer still", () => {
 const sourceWidth = 6000, sourceHeight = 4000, width = 1500, height = 1000, from = .5, to = 1;
 const start = { x: .5, y: .5 }, pointer = { x: 1200, y: 300 };
 const next = anchor(start.x, start.y, pointer.x, pointer.y, width, height, sourceWidth, sourceHeight, from, to);
 const under = (c, scale) => [c.x + (pointer.x - width / 2) / (sourceWidth * scale), c.y + (pointer.y - height / 2) / (sourceHeight * scale)];
 const [ax, ay] = under(start, from), [bx, by] = under(next, to);
 assert.ok(Math.abs(ax - bx) < 1e-12 && Math.abs(ay - by) < 1e-12);
 // Zooming out at an edge is held inside the photo instead of showing empty space.
 const edge = anchor(.95, .5, 0, 500, width, height, sourceWidth, sourceHeight, 1, .3);
 assert.equal(edge.x, 1 - width / (sourceWidth * .3) / 2);
});
