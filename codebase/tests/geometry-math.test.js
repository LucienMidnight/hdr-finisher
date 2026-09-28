const assert = require("node:assert/strict");
const { test } = require("node:test");

const { HDRGeometryMath } = require("../frontend/geometry-math.js");

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

test("neutral geometry is decided from geometry alone", () => {
  const neutral = { rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } };
  assert.equal(HDRGeometryMath.geometryTransformIsNeutral(neutral), true);
  assert.equal(HDRGeometryMath.geometryTransformIsNeutral({ ...neutral, flip_horizontal: true }), false);
  assert.equal(HDRGeometryMath.geometryTransformIsNeutral({ ...neutral, straighten_angle: 0.001 }), false);
  assert.equal(HDRGeometryMath.geometryTransformIsNeutral({ ...neutral, crop: { ...neutral.crop, width: 0.9 } }), false);
});

test("projective points reject a point at infinity", () => {
  assert.deepEqual(HDRGeometryMath.projectivePoint(identity, { x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 });
  const projected = HDRGeometryMath.projectivePoint([2, 0, 1, 0, 3, -1, 0, 0, 1], { x: 2, y: 2 });
  assert.deepEqual(projected, { x: 5, y: 5 });
  const infinite = HDRGeometryMath.projectivePoint([1, 0, 0, 0, 1, 0, 1, 0, -1], { x: 1, y: 2 });
  assert.equal(Number.isNaN(infinite.x), true);
  assert.equal(Number.isNaN(infinite.y), true);
});

test("frame dimensions apply rotation, safe straighten, crop, and authoritative maps", () => {
  const source = { width: 6000, height: 4000 };
  const rotated = HDRGeometryMath.sourcePixelFrameDimensions(source, {
    rotation: 90,
    crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
  });
  assert.deepEqual(rotated, { width: 2000, height: 6000 });
  const straightened = HDRGeometryMath.sourcePixelFrameDimensions(source, {
    rotation: 0,
    straighten_angle: 10,
    crop: { x: 0, y: 0, width: 1, height: 1 },
  });
  assert.ok(straightened.width < source.width);
  assert.ok(straightened.height < source.height);
  assert.deepEqual(
    HDRGeometryMath.sourcePixelFrameDimensions(source, {}, { fullOutputWidth: 1234, fullOutputHeight: 789 }),
    { width: 1234, height: 789 },
  );
});

test("crop aspect ratios use explicit geometry and source", () => {
  const source = { width: 6000, height: 4000 };
  assert.equal(HDRGeometryMath.cropAspectRatio({ ratio_mode: "free" }, source), null);
  assert.equal(HDRGeometryMath.cropAspectRatio({ ratio_mode: "original", rotation: 0 }, source), 1.5);
  assert.equal(HDRGeometryMath.cropAspectRatio({ ratio_mode: "original", rotation: 90 }, source), 2 / 3);
  assert.equal(HDRGeometryMath.cropAspectRatio({ ratio_mode: "custom", custom_ratio: { width: 5, height: 4 } }, source), 1.25);
  assert.equal(HDRGeometryMath.cropAspectRatio({ ratio_mode: "16:9" }, source), 16 / 9);
});

test("mask projection preserves absent path handles and recursively maps leaves", () => {
  const matrix = [2, 0, 0.1, 0, 2, 0.2, 0, 0, 1];
  const expression = {
    operator: "add",
    children: [
      { operator: "leaf", leaf: { type: "linear_gradient", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } },
      {
        operator: "leaf",
        leaf: {
          type: "path",
          nodes: [{ x: 0.25, y: 0.5, in_x: null, in_y: null, out_x: 0.5, out_y: 0.75 }],
          feather_nodes: [],
        },
      },
    ],
  };
  const projected = HDRGeometryMath.projectMaskExpressionToOutput(expression, matrix);
  assert.deepEqual(projected.children[0].leaf.start, { x: 0.1, y: 0.2 });
  assert.deepEqual(projected.children[0].leaf.end, { x: 2.1, y: 2.2 });
  assert.equal(projected.children[1].leaf.nodes[0].in_x, null);
  assert.equal(projected.children[1].leaf.nodes[0].in_y, null);
  assert.equal(projected.children[1].leaf.nodes[0].out_x, 1.1);
  assert.equal(projected.children[1].leaf.nodes[0].out_y, 1.7);
  assert.equal(HDRGeometryMath.projectiveMatrixIsAffine(matrix), true);
  assert.equal(HDRGeometryMath.projectiveMatrixIsAffine([1, 0, 0, 0, 1, 0, 0.1, 0, 1]), false);
});
