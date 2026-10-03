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

test("the frame size at a processing edge is exact or unknown, never a scaled guess", () => {
  const source = { width: 5320, height: 7968 };
  assert.deepEqual(HDRGeometryMath.frameSizeAtEdge(source, {}, 5634), { width: 3762, height: 5634 });
  assert.deepEqual(HDRGeometryMath.frameSizeAtEdge(source, {}, 16384), source);
  const perspective = { perspective_horizontal: -30, perspective_vertical: -20 };
  // Scaling the full-resolution output (4900 x 7421) gives 3464; the backend's frame is 3465 wide.
  assert.equal(HDRGeometryMath.frameSizeAtEdge(source, perspective, 5634), null);
  assert.equal(HDRGeometryMath.frameSizeAtEdge(source, perspective, 5634, { fullOutputWidth: 4900, fullOutputHeight: 7421 }), null);
  assert.deepEqual(
    HDRGeometryMath.frameSizeAtEdge(source, perspective, 5634, { outputWidth: 3465, outputHeight: 5247 }),
    { width: 3465, height: 5247 },
  );
  assert.equal(HDRGeometryMath.frameSizeAtEdge(null, {}, 5634), null);
});
