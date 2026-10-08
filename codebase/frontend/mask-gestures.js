function bindLocalMaskCanvas() {
  const canvas = els.localMaskOverlay;
  if (!canvas) return;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const local = selectedLocal();
    if (!local || state.gradeMode !== "local") return;
    if (!localGizmoVisible(local)) return;
    const leaf = selectedMaskLeaf(local);
    if (!leaf) return;
    const displayPoint = localDisplayPointerPoint(event);
    const point = leaf.type === "luminance_range"
      ? displayPoint
      : localPointerPoint(event, displayPoint);
    if (!point) return;
    if (!["brush", "linear_gradient", "luminance_range", "path"].includes(leaf.type)) return;
    // A new structural gesture supersedes any settled preview queued by the
    // preceding commit. Its overlay remains visible while the gesture is in
    // progress, and the final commit schedules the next adjusted frame.
    state.previewScheduler?.cancel();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    if (leaf.type === "brush") {
      const source = brushStrokeSettings(leaf);
      state.localBrushCursor = point;
      state.localBrushPreviewPinned = false;
      state.localPointerGesture = { type: "brush", leaf, stroke: { ...source, erase: state.localErase || event.altKey, points: [{ ...point, pressure: brushPointerPressure(event) }] } };
    } else if (leaf.type === "linear_gradient") {
      const previewRect = activePreviewElement()?.getBoundingClientRect();
      const controls = gradientControlPoints(leaf);
      const displayPoint = sourcePointToDisplay(point);
      const nearest = Object.entries(controls).reduce((best, [handle, control]) => {
        const displayControl = sourcePointToDisplay(control);
        if (!displayPoint || !displayControl) return best;
        const distance = Math.hypot(
          (displayControl.x - displayPoint.x) * Math.max(previewRect?.width || 1, 1),
          (displayControl.y - displayPoint.y) * Math.max(previewRect?.height || 1, 1),
        );
        return distance < best.distance ? { handle, distance } : best;
      }, { handle: "end", distance: Infinity });
      if (nearest.distance <= 16) {
        state.localPointerGesture = { type: "linear_gradient", leaf, handle: nearest.handle };
      } else {
        leaf.start = point;
        leaf.end = point;
        leaf.gradient_midpoint_1 = 1 / 3;
        leaf.gradient_midpoint_2 = 2 / 3;
        // The coordinates already differ from the cached authoritative mask at
        // pointerdown. Mark the handoff dirty before the synchronous render so
        // the last exact overlay remains visible until the first draft lands.
        state.localMaskDraftDirty = true;
        state.localPointerGesture = { type: "linear_gradient", leaf, handle: "end", creating: true };
      }
    } else if (leaf.type === "luminance_range") {
      state.localPointerGesture = {
        type: "luminance_sample",
        leaf,
        localId: local.id,
        remove: event.altKey,
        points: [point],
      };
    } else if (leaf.type === "path") {
      const draft = state.localPathDraft?.localId === local.id;
      const nodes = draft ? leaf.nodes : activePathNodes(leaf);
      const target = pathTargetAtPointer(event, nodes, state.selectedPathNode);
      if (draft) {
        if (target?.type === "node" && target.index === 0 && nodes.length >= 3) {
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
          void finishLocalPathDraft();
          return;
        }
        const node = { x: point.x, y: point.y, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" };
        nodes.push(node);
        state.selectedPathNode = nodes.length - 1;
        state.localPointerGesture = {
          type: "path_create_node",
          leaf,
          nodeIndex: nodes.length - 1,
          clientX: event.clientX,
          clientY: event.clientY,
          origin: { ...point },
        };
      } else if (target?.type === "handle") {
        state.selectedPathNode = target.index;
        state.localPointerGesture = {
          type: "path_handle",
          leaf,
          nodes,
          nodeIndex: target.index,
          handle: target.handle,
          before: JSON.parse(JSON.stringify(nodes)),
          changed: false,
        };
      } else if (target?.type === "node") {
        state.selectedPathNode = target.index;
        state.pathKeyboardTarget = "node";
        state.localPointerGesture = {
          type: "path_node",
          leaf,
          nodes,
          nodeIndex: target.index,
          before: JSON.parse(JSON.stringify(nodes)),
          origin: { ...nodes[target.index] },
          changed: false,
        };
        renderMaskTreeEditor(local);
      } else if (target?.type === "curve") {
        const before = JSON.parse(JSON.stringify(nodes));
        const inserted = splitPathSegment(nodes, target.segment, target.t);
        const valid = state.localPathEditMode === "feather"
          ? validFeatherGeometry(leaf.nodes, nodes)
          : validPathGeometry(leaf, nodes);
        if (!valid) nodes.splice(0, nodes.length, ...before);
        else {
          state.selectedPathNode = inserted;
          scheduleSpatialMaskPreview(local);
          renderMaskTreeEditor(local);
          commitSelectedLocal();
        }
      }
    }
    renderLocalMaskOverlay();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!localGizmoVisible()) return;
    const gesture = state.localPointerGesture;
    const point = gesture?.type === "luminance_sample"
      ? localDisplayPointerPoint(event)
      : localPointerPoint(event);
    if (!point) return;
    const hoveredPathLeaf = selectedMaskLeaf(selectedLocal(), "path");
    if (hoveredPathLeaf) state.localPathCursor = point;
    const activeLeaf = selectedMaskLeaf(selectedLocal(), "brush");
    if (activeLeaf && state.localTool === "brush") {
      state.localBrushCursor = point;
      state.localBrushPreviewPinned = false;
    }
    if (!gesture) {
      if (activeLeaf && state.localTool === "brush") queueLocalMaskOverlayRender();
      const pathLeaf = selectedMaskLeaf(selectedLocal(), "path");
      if (pathLeaf) {
        const nodes = state.localPathDraft ? pathLeaf.nodes : activePathNodes(pathLeaf);
        const hovered = pathTargetAtPointer(event, nodes, state.selectedPathNode);
        const signature = hovered ? `${hovered.type}:${hovered.index ?? hovered.segment}:${hovered.handle || ""}` : "";
        if (signature !== state.hoveredPathTarget?.signature) {
          state.hoveredPathTarget = hovered ? { ...hovered, signature } : null;
          queueLocalMaskOverlayRender();
        }
      }
      return;
    }
    if (gesture.type === "brush") appendBrushPointerPoints(gesture.stroke, event);
    else if (gesture.type === "linear_gradient") updateGradientGesture(gesture, point);
    else if (gesture.type === "luminance_sample") appendLuminanceSamplePoint(gesture, point);
    else if (gesture.type === "path_create_node") updatePathCreationGesture(gesture, event, point);
    else if (gesture.type === "path_node") updatePathNodeGesture(gesture, point);
    else if (gesture.type === "path_handle") updatePathHandleGesture(gesture, point);
    queueLocalMaskOverlayRender();
  });
  const end = async (event) => {
    const gesture = state.localPointerGesture;
    if (!gesture) return;
    state.localPointerGesture = null;
    if (gesture.type === "brush") {
      gesture.leaf.strokes.push(gesture.stroke);
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (gesture.type === "luminance_sample") {
      await finishLuminanceSampleGesture(gesture);
      return;
    }
    if (gesture.type === "path_create_node") {
      renderMaskTreeEditor(selectedLocal());
      queueLocalMaskOverlayRender();
      return;
    }
    if ((gesture.type === "path_node" || gesture.type === "path_handle") && !gesture.changed) {
      renderMaskTreeEditor(selectedLocal());
      queueLocalMaskOverlayRender();
      return;
    }
    await commitSelectedLocal();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const local = selectedLocal();
    if (!localGizmoVisible(local)) return;
    const leaf = selectedMaskLeaf(local, "path");
    if (!leaf || state.localPathDraft) return;
    const nodes = activePathNodes(leaf);
    const target = pathTargetAtPointer(event, nodes, state.selectedPathNode);
    if (target?.type !== "node" || nodes.length <= 3) return;
    const before = JSON.parse(JSON.stringify(nodes));
    nodes.splice(target.index, 1);
    const valid = state.localPathEditMode === "feather"
      ? validFeatherGeometry(leaf.nodes, nodes)
      : validPathGeometry(leaf, nodes);
    if (!valid) nodes.splice(0, nodes.length, ...before);
    else {
      state.selectedPathNode = Math.min(target.index, nodes.length - 1);
      scheduleSpatialMaskPreview(local);
      renderMaskTreeEditor(local);
      queueLocalMaskOverlayRender();
      commitSelectedLocal();
    }
  });
  canvas.addEventListener("keydown", (event) => handlePathCanvasKeydown(event));
  canvas.addEventListener("pointerleave", () => {
    if (state.localPointerGesture) return;
    if (!state.localBrushPreviewPinned) state.localBrushCursor = null;
    queueLocalMaskOverlayRender();
  });
}

function brushPointerPressure(event) {
  return event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 1;
}

function appendBrushPointerPoints(stroke, event) {
  const samples = event.getCoalescedEvents?.() || [event];
  for (const sample of samples) {
    const point = localPointerPoint(sample);
    if (!point) continue;
    const previous = stroke.points.at(-1);
    const minimumSpacing = Math.max(0.0005, Number(stroke.radius) * 0.04);
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < minimumSpacing) continue;
    stroke.points.push({ ...point, pressure: brushPointerPressure(sample) });
  }
}

// Sampling initialization is interaction state, not part of the persisted mask
// schema. Keeping it out of edit-command payloads also lets a refreshed client
// create Luma adjustments against an already-running older backend process.
const initializedLuminanceSampleLeaves = new WeakSet();

function isLuminanceSamplingInitialized(leaf) {
  if (initializedLuminanceSampleLeaves.has(leaf)) return true;
  const start = Number(leaf.full_start_ev);
  const end = Number(leaf.full_end_ev);
  const visibleMin = referenceNitsToEv(LUMA_RANGE_MIN_NITS);
  const visibleMax = referenceNitsToEv(LUMA_RANGE_MAX_NITS);
  const defaultStart = clamp(-8, visibleMin, visibleMax - 0.01);
  const defaultEnd = clamp(6, defaultStart + 0.01, visibleMax);
  const schemaDefault = Math.abs(start - defaultStart) <= 0.011 && Math.abs(end - defaultEnd) <= 0.011;
  // Range inputs quantize against a 0.01 EV step whose origin is the dynamic
  // minimum, so their full-span endpoint can differ from the analytical value
  // by up to one step.
  const visibleDefault = Math.abs(start - visibleMin) <= 0.011 && Math.abs(end - visibleMax) <= 0.011;
  return !schemaDefault && !visibleDefault;
}

function appendLuminanceSamplePoint(gesture, point) {
  const previous = gesture.points.at(-1);
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.006) return;
  if (gesture.points.length < 512) gesture.points.push(point);
}

async function finishLuminanceSampleGesture(gesture) {
  const local = selectedLocal();
  if (!state.session || !local || local.id !== gesture.localId || !gesture.points.length) return;
  // An asynchronous preview/edit refresh can replace the selected local while
  // a pointer gesture is active. Always mutate the leaf that will actually be
  // serialized, rather than the pointerdown snapshot retained by the gesture.
  const leaf = firstMaskLeaf(local.mask, "luminance_range");
  if (!leaf) return;
  try {
    const response = await fetch(`/api/session/${state.session.session_id}/local-luminance-sample`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        points: gesture.points,
        edit_revision: state.editRevision,
        long_edge: settledProxyLongEdge(),
      }),
    });
    const sample = await safeJson(response);
    if (!response.ok) throw new Error(sample.detail || "Luminance sampling failed.");
    if (!applyLuminanceSample(leaf, sample, gesture.remove)) return;
    scheduleSpatialMaskPreview(local);
    renderMaskTreeEditor(local);
    syncRangeVisuals(els.localEditor);
    queueLocalMaskOverlayRender();
    await commitSelectedLocal();
  } catch (error) {
    console.error(error);
    status.post({ id: "edit", severity: "error", message: error.message });
    queueLocalMaskOverlayRender();
  }
}

function applyLuminanceSample(leaf, sample, remove = false) {
  const sampleLow = clamp(Number(sample.low_ev), -24, 24);
  const sampleHigh = clamp(Number(sample.high_ev), sampleLow, 24);
  let fullStart = Number(leaf.full_start_ev);
  let fullEnd = Number(leaf.full_end_ev);
  if (!Number.isFinite(fullStart) || !Number.isFinite(fullEnd)) return false;
  if (!remove) {
    if (!isLuminanceSamplingInitialized(leaf)) {
      fullStart = sampleLow;
      fullEnd = sampleHigh;
    } else {
      fullStart = Math.min(fullStart, sampleLow);
      fullEnd = Math.max(fullEnd, sampleHigh);
    }
  } else {
    if (sampleHigh < fullStart || sampleLow > fullEnd) return false;
    const midpoint = (fullStart + fullEnd) * 0.5;
    if (Number(sample.center_ev) <= midpoint) fullStart = Math.min(fullEnd - 0.25, Math.max(fullStart, sampleHigh));
    else fullEnd = Math.max(fullStart + 0.25, Math.min(fullEnd, sampleLow));
  }
  fullStart = Number(clamp(fullStart, -23.75, 23.75).toFixed(2));
  fullEnd = Number(clamp(fullEnd, fullStart + 0.25, 24).toFixed(2));
  // Normalize both reference and refined bounds through the same four-decimal
  // path. Otherwise an unrounded sampled reference can sit microscopically
  // inside its rounded refined edge and fail the persisted schema invariant.
  setLuminanceReferenceRange(leaf, fullStart, fullEnd, { preserveRefinement: false });
  initializedLuminanceSampleLeaves.add(leaf);
  return true;
}

function gradientControlPoints(leaf) {
  const start = leaf.start || { x: 0.25, y: 0.5 };
  const end = leaf.end || start;
  const interpolate = (amount) => ({
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  });
  return {
    start,
    midpoint_1: interpolate(Number(leaf.gradient_midpoint_1 ?? 1 / 3)),
    midpoint_2: interpolate(Number(leaf.gradient_midpoint_2 ?? 2 / 3)),
    end,
  };
}

function updateGradientGesture(gesture, point) {
  const { leaf, handle } = gesture;
  if (handle === "start" || handle === "end") {
    leaf[handle] = point;
  } else {
    const dx = Number(leaf.end.x) - Number(leaf.start.x);
    const dy = Number(leaf.end.y) - Number(leaf.start.y);
    const denominator = Math.max(dx * dx + dy * dy, 1e-8);
    const projected = ((point.x - leaf.start.x) * dx + (point.y - leaf.start.y) * dy) / denominator;
    if (handle === "midpoint_1") {
      leaf.gradient_midpoint_1 = clamp(projected, 0.02, Number(leaf.gradient_midpoint_2 ?? 2 / 3) - 0.02);
    } else {
      leaf.gradient_midpoint_2 = clamp(projected, Number(leaf.gradient_midpoint_1 ?? 1 / 3) + 0.02, 0.98);
    }
  }
  state.localMaskDraftDirty = true;
  scheduleAuthoritativeLocalMaskDraft(selectedLocal());
}

function setSelectedPathNodeType(leaf, nodeType) {
  const nodes = activePathNodes(leaf);
  const index = state.selectedPathNode;
  const node = index === null ? null : nodes[index];
  if (!node) return;
  if (nodeType === "sharp") {
    node.node_type = "sharp";
    node.in_x = node.in_y = node.out_x = node.out_y = null;
  } else {
    const previous = nodes[(index - 1 + nodes.length) % nodes.length];
    const next = nodes[(index + 1) % nodes.length];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const inLength = Math.min(Math.hypot(node.x - previous.x, node.y - previous.y) / 3, 0.15);
    const outLength = Math.min(Math.hypot(next.x - node.x, next.y - node.y) / 3, 0.15);
    node.node_type = "smooth";
    node.in_x = clamp(node.x - ux * inLength, -1, 2);
    node.in_y = clamp(node.y - uy * inLength, -1, 2);
    node.out_x = clamp(node.x + ux * outLength, -1, 2);
    node.out_y = clamp(node.y + uy * outLength, -1, 2);
  }
  scheduleSpatialMaskPreview(selectedLocal());
  renderMaskTreeEditor(selectedLocal());
  queueLocalMaskOverlayRender();
  commitSelectedLocal();
}

function localDisplayPointerPoint(event) {
  const preview = activePreviewElement();
  if (!preview) return null;
  const rect = preview.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  const pathLeaf = selectedMaskLeaf(selectedLocal(), "path");
  // A closed Path can have legal Bezier handles outside the image even though
  // its anchors remain source-bounded. Accept pointer coordinates across the
  // larger overlay canvas so those rendered handles can be acquired; node
  // movement still applies the Path [0, 1] anchor clamp downstream. Draft
  // creation remains image-bounded so an outside click cannot create a node.
  const allowOutside = Boolean(pathLeaf && (state.localPathEditMode === "feather" || !state.localPathDraft));
  if (outside && !state.localPointerGesture && !allowOutside) return null;
  return {
    x: clamp((event.clientX - rect.left) / Math.max(rect.width, 1), allowOutside ? -1 : 0, allowOutside ? 2 : 1),
    y: clamp((event.clientY - rect.top) / Math.max(rect.height, 1), allowOutside ? -1 : 0, allowOutside ? 2 : 1),
  };
}

function localPointerPoint(event, displayPoint = null) {
  const point = displayPoint || localDisplayPointerPoint(event);
  if (!point) return null;
  const coordinateMap = currentGeometryCoordinateMap();
  if (!coordinateMap) {
    void ensureGeometryCoordinateMap();
    return null;
  }
  const source = projectivePoint(coordinateMap.outputToSource, point);
  const pathLeaf = selectedMaskLeaf(selectedLocal(), "path");
  const allowOutside = Boolean(pathLeaf && (state.localPathEditMode === "feather" || !state.localPathDraft));
  return {
    x: clamp(source.x, allowOutside ? -1 : 0, allowOutside ? 2 : 1),
    y: clamp(source.y, allowOutside ? -1 : 0, allowOutside ? 2 : 1),
  };
}

function sourcePointToDisplay(point) {
  const coordinateMap = currentGeometryCoordinateMap();
  if (!coordinateMap) {
    void ensureGeometryCoordinateMap();
    return null;
  }
  return projectivePoint(coordinateMap.sourceToOutput, point);
}

function pathTargetAtPointer(event, nodes, selectedIndex) {
  const rect = activePreviewElement()?.getBoundingClientRect();
  if (!rect || !nodes?.length) return null;
  const px = event.clientX;
  const py = event.clientY;
  const screen = (point) => {
    const display = sourcePointToDisplay(point);
    return display ? { x: rect.left + display.x * rect.width, y: rect.top + display.y * rect.height } : null;
  };
  // A visible node is the user's primary target. Check every node before the
  // selected node's Bezier handles so a handle that overlaps a neighbouring
  // node cannot keep the old Smooth node selected or make Smooth feel like a
  // persistent tool mode.
  for (let index = 0; index < nodes.length; index += 1) {
    const position = screen(nodes[index]);
    if (!position) return null;
    if (Math.hypot(px - position.x, py - position.y) <= 14) return { type: "node", index };
  }
  const selected = selectedIndex === null ? null : nodes[selectedIndex];
  if (selected) {
    for (const handle of ["in", "out"]) {
      if (selected[`${handle}_x`] === null || selected[`${handle}_x`] === undefined) continue;
      const position = screen({ x: selected[`${handle}_x`], y: selected[`${handle}_y`] });
      if (!position) return null;
      if (Math.hypot(px - position.x, py - position.y) <= 14) return { type: "handle", index: selectedIndex, handle };
    }
  }
  let nearest = null;
  for (let segment = 0; segment < nodes.length; segment += 1) {
    const first = nodes[segment];
    const second = nodes[(segment + 1) % nodes.length];
    for (let sample = 0; sample <= 32; sample += 1) {
      const t = sample / 32;
      const point = screen(cubicPathPoint(first, second, t));
      if (!point) return null;
      const distance = Math.hypot(px - point.x, py - point.y);
      if (!nearest || distance < nearest.distance) nearest = { type: "curve", segment, t, distance };
    }
  }
  return nearest?.distance <= 10 ? nearest : null;
}

function updatePathCreationGesture(gesture, event, point) {
  const node = gesture.leaf.nodes[gesture.nodeIndex];
  if (!node) return;
  const dragged = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) >= 3;
  if (!dragged) return;
  const dx = point.x - gesture.origin.x;
  const dy = point.y - gesture.origin.y;
  node.node_type = "smooth";
  node.in_x = clamp(node.x - dx, -1, 2);
  node.in_y = clamp(node.y - dy, -1, 2);
  node.out_x = clamp(node.x + dx, -1, 2);
  node.out_y = clamp(node.y + dy, -1, 2);
}

function replacePathNodes(target, source) {
  target.splice(0, target.length, ...JSON.parse(JSON.stringify(source)));
}

function updatePathNodeGesture(gesture, point) {
  const node = gesture.nodes[gesture.nodeIndex];
  if (!node) return;
  const bounds = state.localPathEditMode === "feather" ? [-1, 2] : [0, 1];
  const nextX = clamp(point.x, bounds[0], bounds[1]);
  const nextY = clamp(point.y, bounds[0], bounds[1]);
  const dx = nextX - gesture.origin.x;
  const dy = nextY - gesture.origin.y;
  const beforeNode = gesture.before[gesture.nodeIndex];
  node.x = nextX;
  node.y = nextY;
  for (const handle of ["in", "out"]) {
    if (beforeNode[`${handle}_x`] === null || beforeNode[`${handle}_x`] === undefined) continue;
    node[`${handle}_x`] = clamp(beforeNode[`${handle}_x`] + dx, -1, 2);
    node[`${handle}_y`] = clamp(beforeNode[`${handle}_y`] + dy, -1, 2);
  }
  const valid = state.localPathEditMode === "feather"
    ? validFeatherGeometry(gesture.leaf.nodes, gesture.nodes)
    : validPathGeometry(gesture.leaf, gesture.nodes);
  state.pathInvalidGesture = !valid;
  if (!valid) replacePathNodes(gesture.nodes, gesture.before);
  else {
    gesture.changed = true;
    state.localMaskDraftDirty = true;
    scheduleAuthoritativeLocalMaskDraft(selectedLocal());
  }
}

function updatePathHandleGesture(gesture, point) {
  const node = gesture.nodes[gesture.nodeIndex];
  if (!node) return;
  const handle = gesture.handle;
  const opposite = handle === "in" ? "out" : "in";
  node[`${handle}_x`] = clamp(point.x, -1, 2);
  node[`${handle}_y`] = clamp(point.y, -1, 2);
  if (node.node_type === "smooth") {
    const originalOpposite = gesture.before[gesture.nodeIndex];
    const oppositeLength = Math.hypot(
      Number(originalOpposite[`${opposite}_x`] ?? node.x) - node.x,
      Number(originalOpposite[`${opposite}_y`] ?? node.y) - node.y,
    );
    const dx = node[`${handle}_x`] - node.x;
    const dy = node[`${handle}_y`] - node.y;
    const length = Math.hypot(dx, dy) || 1;
    node[`${opposite}_x`] = clamp(node.x - dx / length * oppositeLength, -1, 2);
    node[`${opposite}_y`] = clamp(node.y - dy / length * oppositeLength, -1, 2);
  }
  const valid = state.localPathEditMode === "feather"
    ? validFeatherGeometry(gesture.leaf.nodes, gesture.nodes)
    : validPathGeometry(gesture.leaf, gesture.nodes);
  state.pathInvalidGesture = !valid;
  if (!valid) replacePathNodes(gesture.nodes, gesture.before);
  else {
    gesture.changed = true;
    state.localMaskDraftDirty = true;
    scheduleAuthoritativeLocalMaskDraft(selectedLocal());
  }
}

function handlePathCanvasKeydown(event) {
  const local = selectedLocal();
  if (!localGizmoVisible(local)) return;
  const leaf = selectedMaskLeaf(local, "path");
  if (!leaf) return;
  if (state.localPathDraft) {
    if (event.key === "Enter") { event.preventDefault(); void finishLocalPathDraft(); }
    if (event.key === "Escape") { event.preventDefault(); cancelLocalPathDraft(); }
    return;
  }
  const nodes = activePathNodes(leaf);
  if (!nodes.length) return;
  if (event.key === "[" || event.key === "]") {
    event.preventDefault();
    const direction = event.key === "]" ? 1 : -1;
    state.selectedPathNode = ((state.selectedPathNode ?? (direction > 0 ? -1 : 0)) + direction + nodes.length) % nodes.length;
    state.pathKeyboardTarget = "node";
    renderMaskTreeEditor(local);
    queueLocalMaskOverlayRender();
    return;
  }
  if (event.key.toLowerCase() === "h") {
    event.preventDefault();
    const available = ["node"];
    const selected = nodes[state.selectedPathNode ?? 0];
    if (selected?.in_x !== null && selected?.in_x !== undefined) available.push("in", "out");
    state.pathKeyboardTarget = available[(available.indexOf(state.pathKeyboardTarget) + 1) % available.length];
    return;
  }
  if (event.key.toLowerCase() === "s") { event.preventDefault(); setSelectedPathNodeType(leaf, "sharp"); return; }
  if (event.key.toLowerCase() === "m") { event.preventDefault(); setSelectedPathNodeType(leaf, "smooth"); return; }
  if (event.key === "Enter") {
    event.preventDefault();
    const index = state.selectedPathNode ?? 0;
    state.selectedPathNode = splitPathSegment(nodes, index, 0.5);
    scheduleSpatialMaskPreview(local);
    renderMaskTreeEditor(local);
    commitSelectedLocal();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (nodes.length <= 3 || state.selectedPathNode === null) return;
    event.preventDefault();
    const before = JSON.parse(JSON.stringify(nodes));
    nodes.splice(state.selectedPathNode, 1);
    const valid = state.localPathEditMode === "feather" ? validFeatherGeometry(leaf.nodes, nodes) : validPathGeometry(leaf, nodes);
    if (!valid) replacePathNodes(nodes, before);
    else {
      state.selectedPathNode = Math.min(state.selectedPathNode, nodes.length - 1);
      scheduleSpatialMaskPreview(local);
      renderMaskTreeEditor(local);
      commitSelectedLocal();
    }
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || state.selectedPathNode === null) return;
  event.preventDefault();
  const rect = activePreviewElement()?.getBoundingClientRect();
  if (!rect) return;
  const pixels = event.shiftKey ? 10 : 1;
  const node = nodes[state.selectedPathNode];
  const target = state.pathKeyboardTarget;
  const sourceTarget = target === "node"
    ? { x: node.x, y: node.y }
    : { x: node[`${target}_x`], y: node[`${target}_y`] };
  const displayTarget = sourcePointToDisplay(sourceTarget);
  const coordinateMap = currentGeometryCoordinateMap();
  if (!displayTarget || !coordinateMap) return;
  const displayDx = event.key === "ArrowLeft" ? -pixels / rect.width : event.key === "ArrowRight" ? pixels / rect.width : 0;
  const displayDy = event.key === "ArrowUp" ? -pixels / rect.height : event.key === "ArrowDown" ? pixels / rect.height : 0;
  const movedSource = projectivePoint(coordinateMap.outputToSource, {
    x: displayTarget.x + displayDx,
    y: displayTarget.y + displayDy,
  });
  const dx = movedSource.x - sourceTarget.x;
  const dy = movedSource.y - sourceTarget.y;
  if (target === "node") {
    const before = { ...node };
    node.x += dx; node.y += dy;
    for (const handle of ["in", "out"]) {
      if (node[`${handle}_x`] === null || node[`${handle}_x`] === undefined) continue;
      node[`${handle}_x`] += dx; node[`${handle}_y`] += dy;
    }
    const valid = state.localPathEditMode === "feather" ? validFeatherGeometry(leaf.nodes, nodes) : validPathGeometry(leaf, nodes);
    if (!valid) Object.assign(node, before);
  } else {
    updatePathHandleGesture({ leaf, nodes, nodeIndex: state.selectedPathNode, handle: target, before: JSON.parse(JSON.stringify(nodes)) }, { x: node[`${target}_x`] + dx, y: node[`${target}_y`] + dy });
  }
  scheduleSpatialMaskPreview(local);
  queueLocalMaskOverlayRender();
  commitSelectedLocal();
}

