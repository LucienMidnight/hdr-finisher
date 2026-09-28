const assert = require("node:assert/strict");
const { test } = require("node:test");

const { HDRMaskExpression } = require("../frontend/mask-expression.js");

test("mask leaf defaults remain complete for every authoring tool", () => {
  assert.deepEqual(HDRMaskExpression.createLeaf("brush"), {
    type: "brush", strokes: [], brush_radius: 0.025, brush_hardness: 0.75,
    brush_flow: 1, brush_opacity: 1, brush_smoothing: 0.35,
    mask_shift_edge: 0, mask_feather: 0, mask_opacity: 1,
  });
  assert.deepEqual(HDRMaskExpression.createLeaf("linear_gradient").start, { x: 0.25, y: 0.5 });
  assert.equal(HDRMaskExpression.createLeaf("luminance_range").fade_in_start_ev, -8.75);
  assert.deepEqual(HDRMaskExpression.createLeaf("path").nodes, []);
});

test("new expressions receive identity without hiding a global dependency", () => {
  const expression = HDRMaskExpression.createExpression("brush", () => "mask-1");
  assert.equal(expression.id, "mask-1");
  assert.equal(expression.operator, "leaf");
  assert.equal(expression.enabled, true);
  assert.equal(expression.inverted, false);
  assert.equal(expression.leaf.type, "brush");
});

test("sub-mask rows flatten the authored left spine in display order", () => {
  const base = HDRMaskExpression.createExpression("brush", () => "base");
  const gradient = HDRMaskExpression.createExpression("linear_gradient", () => "gradient");
  const luma = HDRMaskExpression.createExpression("luminance_range", () => "luma");
  const nested = { id: "nested", operator: "intersect", children: [base, gradient] };
  const root = { id: "root", operator: "subtract", children: [nested, luma] };
  const rows = HDRMaskExpression.subMaskRows(root);
  assert.deepEqual(rows.map(({ id, operator, expression }) => [id, operator, expression.id]), [
    ["nested", "intersect", "gradient"],
    ["root", "subtract", "luma"],
  ]);
  assert.equal(HDRMaskExpression.subMaskEntry({ mask: root }, "nested").expression, gradient);
});

test("parent and typed-first traversal find the intended leaf", () => {
  const brush = HDRMaskExpression.createExpression("brush", () => "brush");
  const path = HDRMaskExpression.createExpression("path", () => "path");
  const root = { id: "root", operator: "union", children: [brush, path] };
  assert.equal(HDRMaskExpression.parentExpression(root), brush);
  assert.equal(HDRMaskExpression.firstLeaf(root), brush.leaf);
  assert.equal(HDRMaskExpression.firstLeaf(root, "path"), path.leaf);
  assert.equal(HDRMaskExpression.firstLeaf(root, "luminance_range"), null);
});

test("replacement and identity regeneration preserve the expression shape", () => {
  const brush = HDRMaskExpression.createExpression("brush", () => "brush");
  const path = HDRMaskExpression.createExpression("path", () => "path");
  const root = { id: "root", operator: "union", children: [brush, path] };
  const replacement = HDRMaskExpression.createExpression("linear_gradient", () => "replacement");
  assert.equal(HDRMaskExpression.replaceExpression(root, "path", replacement), root);
  assert.equal(root.children[1], replacement);
  const ids = ["copy-root", "copy-brush", "copy-gradient"];
  HDRMaskExpression.regenerateIds(root, () => ids.shift());
  assert.deepEqual([root.id, root.children[0].id, root.children[1].id], ["copy-root", "copy-brush", "copy-gradient"]);
});

test("leaf spatial signatures ignore opacity but composite signatures retain it", () => {
  const leaf = HDRMaskExpression.createExpression("brush", () => "brush");
  leaf.leaf.mask_opacity = 0.2;
  assert.equal(JSON.parse(HDRMaskExpression.spatialSignature(leaf)).leaf.mask_opacity, 1);
  const composite = { id: "root", operator: "union", children: [leaf] };
  assert.equal(JSON.parse(HDRMaskExpression.spatialSignature(composite)).children[0].leaf.mask_opacity, 0.2);
});
