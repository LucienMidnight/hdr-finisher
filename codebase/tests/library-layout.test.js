const test = require("node:test");
const assert = require("node:assert/strict");
const { gridLayout } = require("../frontend/library-layout.js");

test("large folders keep only intersecting rows in the virtual grid", () => {
  const view = gridLayout(10000, 1400, 900, 0, 190);
  assert.equal(view.columns, 7);
  assert.equal(view.first, 0);
  assert.ok(view.last < 60);
  assert.ok(view.totalHeight > 100000);
  const next = gridLayout(10000, 1400, 900, 15000, 190);
  assert.ok(next.first > view.last);
  assert.ok(next.last - next.first < 60);
});

test("last row and narrow empty views never point outside the photo list", () => {
  const empty = gridLayout(0, 10, 50, 0, 190);
  assert.equal(empty.first, 0); assert.equal(empty.last, 0); assert.equal(empty.columns, 1);
  const initial = gridLayout(13, 1400, 100, 0, 190);
  const bottom = gridLayout(13, 1400, 100, initial.totalHeight - 100, 190);
  assert.equal(bottom.last, 13); assert.ok(bottom.first >= 0);
});
