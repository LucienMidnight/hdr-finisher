(function () {
  'use strict';
  // Compact geometry only: masks are rasterized at the requested tile's
  // native pixel centres. Export remains the reference for unsupported forms.
  function eligible(expression, geometrySignature) {
    if (expression?.operator !== 'leaf' || expression.children?.length) return false;
    let geometry;
    try { geometry = JSON.parse(geometrySignature); } catch { return false; }
    const crop = geometry?.crop || {};
    if (Number(geometry?.rotation || 0) || geometry?.flip_horizontal || geometry?.flip_vertical
      || Number(geometry?.straighten_angle || 0) || Number(geometry?.perspective_rotate || 0)
      || Number(geometry?.perspective_horizontal || 0) || Number(geometry?.perspective_vertical || 0)
      || Number(crop.x || 0) || Number(crop.y || 0)
      || Number(crop.width ?? 1) !== 1 || Number(crop.height ?? 1) !== 1) return false;
    const leaf = expression.leaf;
    if (leaf?.type === 'brush') return !Number(leaf.mask_feather || 0) && !Number(leaf.mask_shift_edge || 0);
    return leaf?.type === 'path' && (leaf.feather_mode !== 'outer_boundary'
      || (!leaf.feather_nodes?.length && !Number(leaf.feather || 0)));
  }

  function flatten(nodes = []) {
    // Export evaluates each Bezier term in float32, including its partial
    // sums. Rounding only the final vertex moves native curved edges.
    const f = Math.fround, mul = (a,b) => f(a*b);
    const result = [];
    nodes.forEach((first, i) => {
      const second = nodes[(i + 1) % nodes.length];
      const curved = [['out', first], ['in', second]].some(([handle, node]) =>
        ['x','y'].some(axis => node[`${handle}_${axis}`] != null && node[`${handle}_${axis}`] !== node[axis]));
      const count = curved ? 12 : 1;
      const a = [first.x, first.y].map(f), b = [first.out_x ?? first.x, first.out_y ?? first.y].map(f);
      const c = [second.in_x ?? second.x, second.in_y ?? second.y].map(f), d = [second.x, second.y].map(f);
      for (let j = 0; j < count; j++) {
        const t = f(j / count), u = f(1 - t);
        const weights = [f(u**3), mul(mul(3,f(u**2)),t), mul(mul(3,u),f(t**2)), f(t**3)];
        result.push([0,1].map(axis => f(f(f(mul(weights[0],a[axis]) + mul(weights[1],b[axis]))
          + mul(weights[2],c[axis])) + mul(weights[3],d[axis]))));
      }
    });
    return result;
  }

  function parameters(expression, rect, width, height) {
    const leaf = expression.leaf, brush = leaf.type === 'brush';
    const header = [brush ? 0 : 1, rect.x, rect.y, width, height,
      expression.inverted ? 1 : 0, expression.enabled === false ? 0 : 1, 0, Number(leaf.feather || 0), 0];
    const values = [];
    if (!brush) {
      if ((leaf.nodes || []).length > 2048) return null;
      const vertices = flatten(leaf.nodes);
      if (vertices.length > 2048) return null;
      header[7] = vertices.length;
      vertices.forEach(vertex => values.push(...vertex));
    } else {
      const aspect = height / width;
      let segments = 0;
      for (const stroke of leaf.strokes || []) {
        const points = stroke.points || [], shapes = [];
        if (points.length > 2049) return null;
        if (points.length === 1) {
          const p = points[0]; shapes.push([p.x, p.y*aspect, p.x, p.y*aspect, stroke.radius*(p.pressure ?? 1)]);
        } else for (let i = 1; i < points.length; i++) {
          const a = points[i-1], b = points[i];
          shapes.push([a.x,a.y*aspect,b.x,b.y*aspect,stroke.radius*Math.max(.05,((a.pressure ?? 1)+(b.pressure ?? 1))*.5)]);
        }
        if (!shapes.length) continue;
        const minX = Math.min(...shapes.map(s=>Math.min(s[0],s[2])-s[4]));
        const maxX = Math.max(...shapes.map(s=>Math.max(s[0],s[2])+s[4]));
        const minY = Math.min(...shapes.map(s=>Math.min(s[1],s[3])-s[4]));
        const maxY = Math.max(...shapes.map(s=>Math.max(s[1],s[3])+s[4]));
        const bounds = [Math.max(0,Math.floor(minX*width-.5)-1),Math.max(0,Math.floor(minY*width-.5)-1),
          Math.min(width,Math.ceil(maxX*width-.5)+2),Math.min(height,Math.ceil(maxY*width-.5)+2)];
        if (bounds[2] <= rect.x || bounds[3] <= rect.y || bounds[0] >= rect.x+rect.width || bounds[1] >= rect.y+rect.height) continue;
        segments += shapes.length;
        if (segments > 2048) return null;
        header[7]++;
        values.push(shapes.length,Number(stroke.hardness ?? .75),Number(stroke.flow ?? 1),Number(stroke.opacity ?? 1),stroke.erase?1:0,...bounds,0);
        shapes.forEach(shape=>values.push(...shape));
      }
    }
    return new Float32Array([...header,...values]);
  }
  const HDRMaskRaster = Object.freeze({eligible,flatten,parameters});
  if (typeof window !== 'undefined') window.HDRMaskRaster = HDRMaskRaster;
  if (typeof module !== 'undefined' && module.exports) module.exports = {HDRMaskRaster};
})();
