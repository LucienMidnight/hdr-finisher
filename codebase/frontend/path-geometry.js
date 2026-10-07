function activePathNodes(leaf) {
  if (state.localPathEditMode !== "feather") return leaf.nodes || [];
  materializeFeatherNodes(leaf);
  return leaf.feather_nodes || [];
}

function materializeFeatherNodes(leaf) {
  if (!leaf || leaf.type !== "path" || leaf.feather_nodes?.length) return;
  leaf.feather_nodes = uniformFeatherNodes(leaf.nodes || [], Number(leaf.feather || 0));
}

function pathDisplayScale() {
  // Path nodes are normalized to the uncropped, unrotated source, and the
  // backend measures Feather in that same metric (short source edge = 1). Do
  // not use the preview's DOM rectangle (it changes with zoom) or the
  // geometry output frame (crop and quarter turns change its aspect): either
  // makes the guide and outer nodes wider on some edges than the mask is.
  const width = Number(state.session?.source?.width || 1);
  const height = Number(state.session?.source?.height || 1);
  const short = Math.max(1, Math.min(width, height));
  return { x: width / short, y: height / short };
}

function pathControlPoint(node, prefix, fallback = node) {
  const x = node?.[`${prefix}_x`];
  const y = node?.[`${prefix}_y`];
  return x === null || x === undefined || y === null || y === undefined
    ? { x: Number(fallback.x), y: Number(fallback.y) }
    : { x: Number(x), y: Number(y) };
}

function pathNodeVector(nodes, index) {
  // Directions in which the two adjacent Bezier segments actually arrive at
  // and leave this node. Chords to the neighbouring nodes are only right for
  // straight segments: at a smooth node they form a false corner, and the
  // miter in pathOutwardShift then pushed the outer node up to ~1.4x the
  // Feather distance.
  const count = nodes.length;
  const node = nodes[index];
  const previous = nodes[(index - 1 + count) % count];
  const next = nodes[(index + 1) % count];
  const scale = pathDisplayScale();
  const vector = (from, to) => ({ x: (to.x - from.x) * scale.x, y: (to.y - from.y) * scale.y });
  const firstUsable = (list) => list.find((value) => Math.hypot(value.x, value.y) > 1e-9) || list[list.length - 1];
  const here = { x: Number(node.x), y: Number(node.y) };
  const before = firstUsable([
    vector(pathControlPoint(node, "in"), here),
    vector(pathControlPoint(previous, "out"), here),
    vector(previous, here),
  ]);
  const after = firstUsable([
    vector(here, pathControlPoint(node, "out")),
    vector(here, pathControlPoint(next, "in")),
    vector(here, next),
  ]);
  const normalize = (value) => {
    const length = Math.hypot(value.x, value.y) || 1;
    return { x: value.x / length, y: value.y / length };
  };
  return { before: normalize(before), after: normalize(after) };
}

function pathSignedArea(nodes) {
  const scale = pathDisplayScale();
  return nodes.reduce((sum, node, index) => {
    const next = nodes[(index + 1) % nodes.length];
    return sum + node.x * scale.x * next.y * scale.y - next.x * scale.x * node.y * scale.y;
  }, 0) * 0.5;
}

function pathOutwardShift(nodes, index, amount) {
  if (!nodes.length || amount === 0) return { x: 0, y: 0 };
  const orientation = pathSignedArea(nodes) >= 0 ? 1 : -1;
  const { before, after } = pathNodeVector(nodes, index);
  const beforeNormal = { x: orientation * before.y, y: -orientation * before.x };
  const afterNormal = { x: orientation * after.y, y: -orientation * after.x };
  let mx = beforeNormal.x + afterNormal.x;
  let my = beforeNormal.y + afterNormal.y;
  const length = Math.hypot(mx, my);
  if (length < 1e-6) {
    mx = afterNormal.x;
    my = afterNormal.y;
  } else {
    mx /= length;
    my /= length;
  }
  const projection = Math.max(0.25, mx * afterNormal.x + my * afterNormal.y);
  const distance = Math.min(Math.abs(amount) / projection, Math.abs(amount) * 4) * Math.sign(amount);
  const scale = pathDisplayScale();
  return { x: mx * distance / scale.x, y: my * distance / scale.y };
}

function translatedPathNode(node, shift) {
  const { feather: _unusedFeather, ...baseNode } = node;
  const translated = {
    ...baseNode,
    x: clamp(Number(node.x) + shift.x, -1, 2),
    y: clamp(Number(node.y) + shift.y, -1, 2),
  };
  for (const prefix of ["in", "out"]) {
    if (node[`${prefix}_x`] === null || node[`${prefix}_x`] === undefined) continue;
    translated[`${prefix}_x`] = clamp(Number(node[`${prefix}_x`]) + shift.x, -1, 2);
    translated[`${prefix}_y`] = clamp(Number(node[`${prefix}_y`]) + shift.y, -1, 2);
  }
  return translated;
}

function uniformFeatherNodes(nodes, amount) {
  if (!nodes?.length) return [];
  const shifted = nodes.map((node, index) => translatedPathNode(node, pathOutwardShift(nodes, index, amount)));
  if (!amount) return shifted;
  // Translating a curved segment's handles with its end nodes keeps the end
  // tangents right but not the curvature: on a convex curve the segment then
  // sags toward the Path between its nodes, so the band narrows there (and
  // widens on concave curves). Refit each segment's two handle lengths so the
  // outer curve tracks the true offset, `amount` from the Path along the curve
  // normal, which is what the backend's uniform Feather measures.
  const scale = pathDisplayScale();
  const toMetric = (point) => ({ x: Number(point.x) * scale.x, y: Number(point.y) * scale.y });
  const orientation = pathSignedArea(nodes) >= 0 ? 1 : -1;
  const samples = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
  for (let index = 0; index < nodes.length; index += 1) {
    const nextIndex = (index + 1) % nodes.length;
    const first = nodes[index];
    const second = nodes[nextIndex];
    const hasOut = first.out_x !== null && first.out_x !== undefined;
    const hasIn = second.in_x !== null && second.in_x !== undefined;
    if (!hasOut && !hasIn) continue;
    const p0 = toMetric(first);
    const p1 = toMetric(pathControlPoint(first, "out"));
    const p2 = toMetric(pathControlPoint(second, "in"));
    const p3 = toMetric(second);
    const q0 = toMetric(shifted[index]);
    const q3 = toMetric(shifted[nextIndex]);
    const outVector = { x: p1.x - p0.x, y: p1.y - p0.y };
    const inVector = { x: p2.x - p3.x, y: p2.y - p3.y };
    // Outer curve at t: base(t) + a(t) * alpha * outVector + b(t) * beta * inVector.
    // Least squares over the samples for alpha and beta (2x2 normal equations)
    // on the offset along the curve normal.
    let uu = 0; let uv = 0; let vv = 0; let ur = 0; let vr = 0;
    for (const t of samples) {
      const s = 1 - t;
      const point = {
        x: s ** 3 * p0.x + 3 * s * s * t * p1.x + 3 * s * t * t * p2.x + t ** 3 * p3.x,
        y: s ** 3 * p0.y + 3 * s * s * t * p1.y + 3 * s * t * t * p2.y + t ** 3 * p3.y,
      };
      const derivative = {
        x: 3 * s * s * (p1.x - p0.x) + 6 * s * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
        y: 3 * s * s * (p1.y - p0.y) + 6 * s * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
      };
      const derivativeLength = Math.hypot(derivative.x, derivative.y);
      if (derivativeLength < 1e-9) continue;
      const target = {
        x: point.x + amount * orientation * derivative.y / derivativeLength,
        y: point.y - amount * orientation * derivative.x / derivativeLength,
      };
      const startWeight = s ** 3 + 3 * s * s * t;
      const endWeight = 3 * s * t * t + t ** 3;
      const residual = {
        x: target.x - startWeight * q0.x - endWeight * q3.x,
        y: target.y - startWeight * q0.y - endWeight * q3.y,
      };
      // Only the error across the curve matters: the backend measures width
      // along the Path normal, and fitting whole points also forces a
      // parametric match along the tangent, which overshoots the offset.
      const normal = {
        x: orientation * derivative.y / derivativeLength,
        y: -orientation * derivative.x / derivativeLength,
      };
      const u = 3 * s * s * t * (outVector.x * normal.x + outVector.y * normal.y);
      const v = 3 * s * t * t * (inVector.x * normal.x + inVector.y * normal.y);
      const r = residual.x * normal.x + residual.y * normal.y;
      uu += u * u;
      uv += u * v;
      vv += v * v;
      ur += u * r;
      vr += v * r;
    }
    let alpha = 1;
    let beta = 1;
    const determinant = uu * vv - uv * uv;
    if (hasOut && hasIn && determinant > 1e-12 * Math.max(uu * vv, 1e-30)) {
      alpha = (ur * vv - vr * uv) / determinant;
      beta = (vr * uu - ur * uv) / determinant;
    } else if (hasOut && uu > 1e-18) {
      alpha = ur / uu;
    } else if (hasIn && vv > 1e-18) {
      beta = vr / vv;
    }
    alpha = clamp(alpha, 0.05, 8);
    beta = clamp(beta, 0.05, 8);
    if (hasOut) {
      shifted[index].out_x = clamp((q0.x + alpha * outVector.x) / scale.x, -1, 2);
      shifted[index].out_y = clamp((q0.y + alpha * outVector.y) / scale.y, -1, 2);
    }
    if (hasIn) {
      shifted[nextIndex].in_x = clamp((q3.x + beta * inVector.x) / scale.x, -1, 2);
      shifted[nextIndex].in_y = clamp((q3.y + beta * inVector.y) / scale.y, -1, 2);
    }
  }
  return shifted;
}

function offsetBoundaryNodes(innerNodes, boundaryNodes, previousAmount, nextAmount) {
  if (!boundaryNodes?.length || Math.abs(nextAmount - previousAmount) < 1e-9) {
    return JSON.parse(JSON.stringify(boundaryNodes || []));
  }
  if (innerNodes?.length !== boundaryNodes.length) {
    return boundaryNodes.map((node, index) => (
      translatedPathNode(node, pathOutwardShift(boundaryNodes, index, nextAmount - previousAmount))
    ));
  }
  // A global Feather change means "move farther from the Path", even after
  // the outer guide has been edited into a non-uniform shape. Apply the change
  // the uniform guide makes between the two Feather values, derived from the
  // Path's own geometry, on top of the customized guide. An untouched guide
  // therefore stays exactly uniform, and local edits are preserved.
  const before = uniformFeatherNodes(innerNodes, previousAmount);
  const after = uniformFeatherNodes(innerNodes, nextAmount);
  const hasHandle = (node, prefix) => node[`${prefix}_x`] !== null && node[`${prefix}_x`] !== undefined;
  return boundaryNodes.map((node, index) => {
    const { feather: _unusedFeather, ...moved } = node;
    const dx = after[index].x - before[index].x;
    const dy = after[index].y - before[index].y;
    moved.x = clamp(Number(node.x) + dx, -1, 2);
    moved.y = clamp(Number(node.y) + dy, -1, 2);
    for (const prefix of ["in", "out"]) {
      if (!hasHandle(node, prefix)) continue;
      const uniform = hasHandle(after[index], prefix) && hasHandle(before[index], prefix);
      const hx = uniform ? after[index][`${prefix}_x`] - before[index][`${prefix}_x`] : dx;
      const hy = uniform ? after[index][`${prefix}_y`] - before[index][`${prefix}_y`] : dy;
      moved[`${prefix}_x`] = clamp(Number(node[`${prefix}_x`]) + hx, -1, 2);
      moved[`${prefix}_y`] = clamp(Number(node[`${prefix}_y`]) + hy, -1, 2);
    }
    return moved;
  });
}

function cubicPathPoint(first, second, t) {
  const p0 = { x: Number(first.x), y: Number(first.y) };
  const p1 = { x: Number(first.out_x ?? first.x), y: Number(first.out_y ?? first.y) };
  const p2 = { x: Number(second.in_x ?? second.x), y: Number(second.in_y ?? second.y) };
  const p3 = { x: Number(second.x), y: Number(second.y) };
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x + 3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x,
    y: inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y + 3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}

function flattenPathNodes(nodes, steps = 16) {
  const points = [];
  if (!nodes?.length) return points;
  for (let index = 0; index < nodes.length; index += 1) {
    const first = nodes[index];
    const second = nodes[(index + 1) % nodes.length];
    const curved = first.out_x !== null && first.out_x !== undefined || second.in_x !== null && second.in_x !== undefined;
    const count = curved ? steps : 1;
    for (let sample = 0; sample < count; sample += 1) points.push(cubicPathPoint(first, second, sample / count));
  }
  return points;
}

function pointInsidePathPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denominator = Math.max(dx * dx + dy * dy, 1e-12);
    const projection = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator, 0, 1);
    if (Math.hypot(point.x - (a.x + projection * dx), point.y - (a.y + projection * dy)) <= 1e-6) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y + 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

function pathSegmentsIntersect(a, b, c, d) {
  const orientation = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return ((abC > 1e-8 && abD < -1e-8) || (abC < -1e-8 && abD > 1e-8))
    && ((cdA > 1e-8 && cdB < -1e-8) || (cdA < -1e-8 && cdB > 1e-8));
}

function simplePathPolygon(polygon) {
  if (polygon.length < 3) return false;
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (first === 0 && secondNext === 0) continue;
      if (pathSegmentsIntersect(polygon[first], polygon[firstNext], polygon[second], polygon[secondNext])) return false;
    }
  }
  return true;
}

function validFeatherGeometry(innerNodes, outerNodes) {
  if (!innerNodes?.length || !outerNodes?.length) return false;
  const inner = flattenPathNodes(innerNodes);
  const outer = flattenPathNodes(outerNodes);
  if (!simplePathPolygon(inner)) return false;
  // Self-overlap in the outer guide is an additive merge, not invalid Path
  // geometry. A simple guide must still contain the complete inner Path.
  return !simplePathPolygon(outer) || inner.every((point) => pointInsidePathPolygon(point, outer));
}

function validPathGeometry(leaf, nodes) {
  const polygon = flattenPathNodes(nodes);
  if (!simplePathPolygon(polygon)) return false;
  return !leaf.feather_nodes?.length || validFeatherGeometry(nodes, leaf.feather_nodes);
}

function splitPathSegment(nodes, segmentIndex, t = 0.5) {
  const first = nodes[segmentIndex];
  const nextIndex = (segmentIndex + 1) % nodes.length;
  const second = nodes[nextIndex];
  const p0 = { x: first.x, y: first.y };
  const p1 = { x: first.out_x ?? first.x, y: first.out_y ?? first.y };
  const p2 = { x: second.in_x ?? second.x, y: second.in_y ?? second.y };
  const p3 = { x: second.x, y: second.y };
  const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = lerp(p0, p1);
  const p12 = lerp(p1, p2);
  const p23 = lerp(p2, p3);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const point = lerp(p012, p123);
  const curved = Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1e-8 || Math.hypot(p2.x - p3.x, p2.y - p3.y) > 1e-8;
  if (curved) {
    first.out_x = p01.x; first.out_y = p01.y;
    second.in_x = p23.x; second.in_y = p23.y;
  }
  const inserted = curved
    ? { x: point.x, y: point.y, in_x: p012.x, in_y: p012.y, out_x: p123.x, out_y: p123.y, node_type: "smooth" }
    : { x: point.x, y: point.y, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" };
  const insertionIndex = segmentIndex + 1;
  nodes.splice(insertionIndex, 0, inserted);
  return insertionIndex;
}

