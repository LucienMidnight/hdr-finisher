const test = require("node:test");
const assert = require("node:assert/strict");
const { clampWindowBounds } = require("../lib/window-bounds");

test("oversized saved bounds are clamped into the current display work area", () => {
  assert.deepEqual(
    clampWindowBounds(
      { x: -400, y: 80, width: 1800, height: 1200 },
      { x: 0, y: 24, width: 1406, height: 818 },
    ),
    { x: 0, y: 24, width: 1406, height: 818 },
  );
});

test("missing positions center the default window and preserve supported minimums", () => {
  assert.deepEqual(
    clampWindowBounds(
      { width: 1100, height: 720 },
      { x: 100, y: 40, width: 1366, height: 728 },
    ),
    { x: 233, y: 44, width: 1100, height: 720 },
  );
});

test("very small work areas remain fully occupied instead of restoring offscreen", () => {
  assert.deepEqual(
    clampWindowBounds(
      { x: 5000, y: 5000, width: 1440, height: 940 },
      { x: -1280, y: 0, width: 1024, height: 700 },
    ),
    { x: -1280, y: 0, width: 1024, height: 700 },
  );
});
