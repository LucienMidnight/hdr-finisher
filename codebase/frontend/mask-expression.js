(function () {
  "use strict";

  function createLeaf(type) {
    if (type === "brush") {
      return {
        type,
        strokes: [],
        brush_radius: 0.025,
        brush_hardness: 0.75,
        brush_flow: 1,
        brush_opacity: 1,
        brush_smoothing: 0.35,
        mask_shift_edge: 0,
        mask_feather: 0,
        mask_opacity: 1,
      };
    }
    if (type === "linear_gradient") {
      return {
        type,
        start: { x: 0.25, y: 0.5 },
        end: { x: 0.75, y: 0.5 },
        gradient_midpoint_1: 1 / 3,
        gradient_midpoint_2: 2 / 3,
        gradient_fan: 0,
        gradient_luma_enabled: false,
        fade_in_start_ev: -12,
        full_start_ev: -8,
        full_end_ev: 6,
        fade_out_end_ev: 10,
        mask_opacity: 1,
      };
    }
    if (type === "luminance_range") {
      return {
        type,
        fade_in_start_ev: -8.75,
        reference_start_ev: -8,
        full_start_ev: -8,
        full_end_ev: 6,
        reference_end_ev: 6,
        fade_out_end_ev: 6.75,
        mask_feather: 0,
        mask_opacity: 1,
      };
    }
    return {
      type: "path",
      nodes: [],
      feather: 0.02,
      feather_softness: 0,
      feather_mode: "outer_boundary",
      feather_nodes: [],
      mask_opacity: 1,
    };
  }

  function createExpression(type, createId) {
    return {
      id: createId(),
      enabled: true,
      operator: "leaf",
      leaf: createLeaf(type),
      children: [],
      inverted: false,
    };
  }

  function subMaskRows(expression, rows = []) {
    if (!expression || expression.operator === "leaf") return rows;
    const children = expression.children || [];
    if (children[0]) subMaskRows(children[0], rows);
    children.slice(1).forEach((child, index) => {
      rows.push({
        id: expression.id || `${rows.length}:${index}`,
        container: expression,
        expression: child,
        operator: expression.operator,
      });
    });
    return rows;
  }

  function subMaskEntry(local, id) {
    if (!local || !id) return null;
    return subMaskRows(local.mask).find((entry) => entry.id === id) || null;
  }

  function parentExpression(expression) {
    let current = expression;
    while (current && current.operator !== "leaf" && current.children?.[0]) current = current.children[0];
    return current || null;
  }

  function firstLeaf(expression, type = null) {
    if (!expression) return null;
    if (expression.operator === "leaf") return !type || expression.leaf?.type === type ? expression.leaf : null;
    for (const child of expression.children || []) {
      const found = firstLeaf(child, type);
      if (found) return found;
    }
    return null;
  }

  function replaceExpression(expression, targetId, replacement) {
    if (!expression) return expression;
    if (expression.id === targetId) return replacement;
    if (expression.operator === "leaf") return expression;
    expression.children = (expression.children || []).map((child) => replaceExpression(child, targetId, replacement));
    return expression;
  }

  function regenerateIds(expression, createId) {
    if (!expression) return;
    expression.id = createId();
    (expression.children || []).forEach((child) => regenerateIds(child, createId));
  }

  function spatialSignature(expression) {
    if (expression?.operator !== "leaf" || !expression.leaf) return JSON.stringify(expression);
    return JSON.stringify({
      ...expression,
      leaf: { ...expression.leaf, mask_opacity: 1 },
    });
  }

  const HDRMaskExpression = Object.freeze({
    createLeaf,
    createExpression,
    subMaskRows,
    subMaskEntry,
    parentExpression,
    firstLeaf,
    replaceExpression,
    regenerateIds,
    spatialSignature,
  });

  if (typeof window !== "undefined") window.HDRMaskExpression = HDRMaskExpression;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRMaskExpression };
})();
