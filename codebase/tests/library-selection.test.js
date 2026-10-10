const test = require("node:test");
const assert = require("node:assert/strict");
const { choose, boxIndices } = require("../frontend/library-selection.js");
const { gridLayout } = require("../frontend/library-layout.js");

test("Ctrl toggles independently and Shift keeps its anchor in both directions", () => {
  const paths = ["a", "b", "c", "d", "e"];
  let result = choose(paths, new Set(), -1, 1);
  result = choose(paths, result.selected, result.anchor, 3, "toggle");
  assert.deepEqual([...result.selected], ["b", "d"]);
  result = choose(paths, result.selected, result.anchor, 0, "range");
  assert.deepEqual([...result.selected], ["a", "b", "c", "d"]);
  assert.equal(result.anchor, 3);
  result = choose(paths, result.selected, result.anchor, 4, "range");
  assert.deepEqual([...result.selected], ["d", "e"]);
  result = choose(paths, result.selected, result.anchor, 4, "toggle");
  assert.deepEqual([...result.selected], ["d"]);
});

test("switching view preserves bulk selection and arrows clamp to the folder", () => {
  const paths = ["a", "b", "c"];
  const result = choose(paths, new Set(paths), 0, 1, "preserve");
  assert.deepEqual([...result.selected], paths);
  assert.equal(choose(paths, result.selected, 0, 99).index, 2);
  assert.equal(choose([], new Set(), -1, 0).index, -1);
});

test("box selection covers virtual rows, excludes untouched columns and clamps the last row", () => {
  const layout = gridLayout(10003, 1400, 900, 0, 190);
  const row = 500, left = 10 + layout.cellWidth;
  const selected = boxIndices(layout, 10003, { left: left + 1, right: left + layout.cellWidth - 1, top: 10 + row * layout.rowHeight + 1, bottom: 10 + (row + 3) * layout.rowHeight - 1 });
  assert.deepEqual(selected, [3501, 3508, 3515]);
  const all = boxIndices(layout, 10003, { left: -100, right: 2000, top: -100, bottom: layout.totalHeight + 100 });
  assert.equal(all.length, 10003); assert.equal(all.at(-1), 10002);
});
