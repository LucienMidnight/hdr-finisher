function appendLocalMaskComparisonLegend() {
  const legend = document.createElement("div");
  legend.className = "local-mask-comparison-legend";
  legend.setAttribute("aria-label", "Mask comparison colors");
  [
    ["parent", "Parent"],
    ["child", "Child"],
    ["overlap", "Overlap"],
  ].forEach(([role, label]) => {
    const item = document.createElement("span");
    item.innerHTML = `<i class="${role}" aria-hidden="true"></i>${label}`;
    legend.append(item);
  });
  els.localMaskTreeSummary.append(legend);
}

function syncLocalMaskOverlayViewport() {
  const canvas = els.localMaskOverlay;
  const pane = els.previewPrimaryPane;
  const viewport = els.dropzone;
  if (!canvas || !pane || !viewport) return;
  // During a crop/rotate handoff the overlay intentionally transforms with the
  // old bitmap. Keep its full-pane box until the authoritative frame arrives.
  if (["--interactive-rotate-angle", "--interactive-straighten-angle", "--interactive-flip-x", "--interactive-flip-y"]
    .some((property) => canvas.style.getPropertyValue(property))) {
    Object.assign(canvas.style, { inset: "0", width: "100%", height: "100%" });
    return;
  }
  const paneRect = pane.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const left = Math.max(0, viewportRect.left - paneRect.left);
  const top = Math.max(0, viewportRect.top - paneRect.top);
  const right = Math.min(paneRect.width, viewportRect.right - paneRect.left);
  const bottom = Math.min(paneRect.height, viewportRect.bottom - paneRect.top);
  Object.assign(canvas.style, {
    inset: "auto",
    left: `${left}px`,
    top: `${top}px`,
    right: "auto",
    bottom: "auto",
    width: `${Math.max(1, right - left)}px`,
    height: `${Math.max(1, bottom - top)}px`,
  });
}

function beginPathMaskProgress(local) {
  if (!local || local.mask?.leaf?.type !== "path") return;
  state.pathMaskProgressTarget = {
    localId: local.id,
    maskSignature: JSON.stringify(local.mask),
    spatialSignature: localMaskSpatialSignature(local.mask),
  };
  if (state.pathMaskProgressTimer || status.get("path-mask")?.severity === "progress") return;
  state.pathMaskProgressStartedAt = performance.now();
  state.pathMaskProgressTimer = window.setTimeout(() => {
    state.pathMaskProgressTimer = 0;
    if (!state.pathMaskProgressTarget) return;
    status.post({
      id: "path-mask",
      nodeId: "path-mask-progress",
      copyId: "path-mask-progress-copy",
      severity: "progress",
      message: "Updating feather…",
      progress: "indeterminate",
    });
  }, 400);
}

function finishPathMaskProgress(localId, signature, spatialOnly = false) {
  const target = state.pathMaskProgressTarget;
  if (!target || target.localId !== localId) return;
  if (signature !== (spatialOnly ? target.spatialSignature : target.maskSignature)) return;
  window.clearTimeout(state.pathMaskProgressTimer);
  state.pathMaskProgressTimer = 0;
  state.pathMaskProgressTarget = null;
  status.clear("path-mask");
  if (window.HDRFinisherPerformance) {
    window.HDRFinisherPerformance.pathMaskLatencyMs = performance.now() - state.pathMaskProgressStartedAt;
  }
}

function cancelPathMaskProgress() {
  window.clearTimeout(state.pathMaskProgressTimer);
  state.pathMaskProgressTimer = 0;
  state.pathMaskProgressTarget = null;
  status.clear("path-mask");
}

function failPathMaskProgress(localId) {
  if (state.pathMaskProgressTarget?.localId !== localId) return;
  window.clearTimeout(state.pathMaskProgressTimer);
  state.pathMaskProgressTimer = 0;
  status.post({
    id: "path-mask",
    nodeId: "path-mask-progress",
    copyId: "path-mask-progress-copy",
    severity: "error",
    message: "Feather preview could not be updated.",
  });
}

function renderLocalMaskOverlay() {
  const canvas = els.localMaskOverlay;
  if (!canvas) return;
  const local = selectedLocal();
  if (state.pathMaskProgressTarget && state.pathMaskProgressTarget.localId !== local?.id) {
    cancelPathMaskProgress();
  }
  // The mask gizmo belongs to the Grade stage only. Proof and Export show the
  // same preview element, so a stale gizmo would otherwise stay drawn over it.
  const active = state.activeWorkflow === "grade"
    && state.gradeMode === "local"
    && Boolean(local)
    && local.enabled !== false;
  const gizmoVisible = localGizmoVisible(local);
  canvas.classList.toggle("editing", active && gizmoVisible);
  syncLocalMaskOverlayViewport();
  const rect = canvas.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;
  const deviceRatio = window.devicePixelRatio || 1;
  // The canvas covers only the visible viewer intersection, so it can render at
  // device resolution without allocating a 30k-wide bitmap at extreme zoom.
  const ratio = deviceRatio;
  const bitmapWidth = Math.max(1, Math.round(rect.width * ratio));
  const bitmapHeight = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
  if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  if (!active) return;
  const preview = activePreviewElement();
  const imageRect = preview?.getBoundingClientRect();
  if (!imageRect) return;
  const offsetX = imageRect.left - rect.left;
  const offsetY = imageRect.top - rect.top;
  const gradeEdge = els.gradeSplitter?.getBoundingClientRect().left;
  state.localBrushVisibleBounds = {
    left: 0,
    top: 0,
    right: Math.min(rect.width, Number.isFinite(gradeEdge) ? gradeEdge - rect.left : rect.width),
    bottom: rect.height,
  };
  const x = (value) => offsetX + value * imageRect.width;
  const y = (value) => offsetY + value * imageRect.height;
  const childParts = selectedChildMaskParts(local);
  if (childParts) {
    renderChildMaskComparisonOverlay(context, local, childParts, x, y, imageRect, rect);
    return;
  }
  const editorExpression = selectedMaskExpression(local);
  const maskSignature = JSON.stringify(local.mask);
  const spatialSignature = localMaskSpatialSignature(local.mask);
  const authoritative = localAuthoritativeMaskCache.get(local.id);
  const authoritativeGeometryCurrent = authoritative?.geometrySignature === geometrySignature();
  const authoritativeCurrent = Boolean(authoritative
    && authoritativeGeometryCurrent
    && authoritative.signature === (authoritative.spatialOnly ? spatialSignature : maskSignature));
  // The exact response may precede the progress target's final signature
  // update. Settlement is also true when that already-cached frame is drawn.
  if (authoritativeCurrent) {
    finishPathMaskProgress(local.id, authoritative.signature, authoritative.spatialOnly);
  }
  const needsAuthoritativeOverlay = local.mask?.operator !== "leaf"
    || ["linear_gradient", "luminance_range"].includes(local.mask?.leaf?.type);
  const drawOptions = {
    localId: local.id,
    maskSignature,
    spatialSignature,
    // Gradient and luminance masks have no client-side mask rasterizer. Keep
    // their most recent exact frame visible across both the draft and commit
    // handoffs, then replace it atomically when the current exact frame lands.
    // Brush masks can instead fall back to their current local stroke raster.
    authoritative: authoritativeGeometryCurrent && (
      state.localMaskDraftDirty
      || needsAuthoritativeOverlay
      || authoritative.signature === (authoritative.spatialOnly ? spatialSignature : maskSignature)
    )
      ? authoritative
      : null,
    authoritativeCurrent,
    exactMaskPending: state.localMaskDraftDirty,
    gpuLumaOverlay: gpuLumaMaskPreviewActive(local),
    pathCursor: state.localPathCursor,
  };
  if (local.mask?.operator !== "leaf" && authoritativeCurrent && state.localShowMask) {
    drawAuthoritativeMaskOverlay(context, authoritative.canvas, x, y, 1);
  } else {
    drawMaskExpression(context, local.mask, x, y, { ...drawOptions, renderPhase: "mask" });
  }
  const coordinateMap = currentGeometryCoordinateMap();
  if (coordinateMap) {
    if (gizmoVisible && projectiveMatrixIsAffine(coordinateMap.sourceToOutput)) {
      context.save();
      applySourceGeometryCanvasTransform(context, imageRect, rect, coordinateMap.sourceToOutput);
      drawMaskExpression(context, editorExpression, x, y, { ...drawOptions, renderPhase: "gizmo", skipBrush: true });
      context.restore();
    } else if (gizmoVisible) {
      drawMaskExpression(
        context,
        projectMaskExpressionToOutput(editorExpression, coordinateMap.sourceToOutput),
        x,
        y,
        {
          ...drawOptions,
          renderPhase: "gizmo",
          skipBrush: true,
          // Projective Path geometry is drawn after its nodes have been
          // converted into output space. Keep the live draft endpoint in that
          // same space or the guide visibly falls behind the pointer.
          pathCursor: state.localPathCursor
            ? projectivePoint(coordinateMap.sourceToOutput, state.localPathCursor)
            : null,
        },
      );
    }
    drawBrushExpressionOutputSpace(
      context,
      editorExpression,
      x,
      y,
      { ...drawOptions, suppressGizmo: !gizmoVisible },
      brushOutputSpaceMapper(imageRect, coordinateMap.sourceToOutput),
    );
  } else if (!coordinateMap) {
    void ensureGeometryCoordinateMap();
  }
  if (!gpuLumaMaskPreviewActive(local)) void queueAuthoritativeLocalMask(local);
}

function renderChildMaskComparisonOverlay(context, local, parts, x, y, imageRect, paneRect) {
  const parentEntry = localComparisonMaskEntry(local, parts.id, "parent");
  const childEntry = parts.child ? localComparisonMaskEntry(local, parts.id, "child") : null;
  if (state.localShowMask && parentEntry) {
    drawLocalMaskComparison(context, parentEntry, childEntry, x, y);
  }
  void queueLocalComparisonMask(local, parts.id, "parent", parts.parent);
  if (parts.child) void queueLocalComparisonMask(local, parts.id, "child", parts.child);
  if (!parts.child) return;

  const maskSignature = JSON.stringify(parts.child);
  const spatialSignature = localMaskSpatialSignature(parts.child);
  const drawOptions = {
    localId: `${local.id}:${parts.id}:child`,
    maskSignature,
    spatialSignature,
    authoritative: childEntry,
    authoritativeCurrent: Boolean(childEntry?.signature === spatialSignature),
    exactMaskPending: false,
    gpuLumaOverlay: false,
    overlayColor: "#2675ff",
    pathCursor: state.localPathCursor,
  };
  const coordinateMap = currentGeometryCoordinateMap();
  if (coordinateMap) {
    const gizmoVisible = localGizmoVisible(local);
    if (gizmoVisible && projectiveMatrixIsAffine(coordinateMap.sourceToOutput)) {
      context.save();
      applySourceGeometryCanvasTransform(context, imageRect, paneRect, coordinateMap.sourceToOutput);
      drawMaskExpression(context, parts.child, x, y, { ...drawOptions, renderPhase: "gizmo", skipBrush: true });
      context.restore();
    } else if (gizmoVisible) {
      drawMaskExpression(
        context,
        projectMaskExpressionToOutput(parts.child, coordinateMap.sourceToOutput),
        x,
        y,
        {
          ...drawOptions,
          renderPhase: "gizmo",
          skipBrush: true,
          pathCursor: state.localPathCursor
            ? projectivePoint(coordinateMap.sourceToOutput, state.localPathCursor)
            : null,
        },
      );
    }
    drawBrushExpressionOutputSpace(
      context,
      parts.child,
      x,
      y,
      { ...drawOptions, suppressGizmo: !gizmoVisible },
      brushOutputSpaceMapper(imageRect, coordinateMap.sourceToOutput),
    );
  } else {
    void ensureGeometryCoordinateMap();
  }
}

function projectiveMatrixIsAffine(matrix) {
  return geometryMath.projectiveMatrixIsAffine(matrix);
}

function projectPathNodeToOutput(node, matrix) {
  return geometryMath.projectPathNodeToOutput(node, matrix);
}

function projectMaskExpressionToOutput(expression, matrix) {
  return geometryMath.projectMaskExpressionToOutput(expression, matrix);
}

function applySourceGeometryCanvasTransform(context, imageRect, paneRect, matrix) {
  const width = Math.max(imageRect.width, 1);
  const height = Math.max(imageRect.height, 1);
  const offsetX = imageRect.left - paneRect.left;
  const offsetY = imageRect.top - paneRect.top;
  const normalization = Number(matrix[8]) || 1;
  const a = matrix[0] / normalization;
  const b = matrix[3] / normalization * height / width;
  const c = matrix[1] / normalization * width / height;
  const d = matrix[4] / normalization;
  const e = offsetX - a * offsetX - c * offsetY + matrix[2] / normalization * width;
  const f = offsetY - b * offsetX - d * offsetY + matrix[5] / normalization * height;
  context.transform(a, b, c, d, e, f);
}

function queueLocalMaskOverlayRender() {
  if (localMaskOverlayFrame) return;
  localMaskOverlayFrame = window.requestAnimationFrame(() => {
    localMaskOverlayFrame = 0;
    renderLocalMaskOverlay();
  });
}

function localMaskSpatialSignature(expression) {
  return maskExpression.spatialSignature(expression);
}

function localComparisonMaskSlot(localId, childId, role) {
  return `${localId}:${childId}:${role}`;
}

function localComparisonMaskEntry(local, childId, role) {
  const entry = localComparisonMaskCache.get(localComparisonMaskSlot(local.id, childId, role)) || null;
  return entry?.geometrySignature === geometrySignature() ? entry : null;
}

/**
 * The size the mask overlay asks for. At a magnified view the renderer draws
 * soft masks from the bitmap the Fit view compiled, so the overlay asks for
 * that same bitmap instead of having a third size compiled beside it.
 */
function maskOverviewLongEdge() {
  const settled = settledProxyLongEdge();
  const shared = window.HDRWholeImagePreviewPipe.edgeFor("maskOverview", settled);
  return shared === settled || !(state.fitProcessingLongEdge > 0)
    ? shared
    : window.HDRWholeImagePreviewPipe.edgeFor("maskOverview", state.fitProcessingLongEdge);
}

function queueLocalComparisonMask(local, childId, role, expression) {
  if (!state.session || !local || !expression) return;
  const sessionId = state.session.session_id;
  const slot = localComparisonMaskSlot(local.id, childId, role);
  const signature = localMaskSpatialSignature(expression);
  const longEdge = maskOverviewLongEdge();
  const requestedGeometrySignature = geometrySignature();
  const key = `${sessionId}:${slot}:${longEdge}:${requestedGeometrySignature}:${signature}`;
  if (localComparisonMaskCache.get(slot)?.key === key) return;
  const previous = localComparisonMaskRequests.get(slot);
  if (previous?.key === key) return;
  if (previous) {
    window.clearTimeout(previous.timer);
    previous.controller?.abort();
  }
  const pending = {
    key,
    signature,
    expression: JSON.parse(JSON.stringify(expression)),
    longEdge,
    requestedGeometrySignature,
    sessionId,
    controller: null,
    timer: 0,
  };
  pending.timer = window.setTimeout(() => loadLocalComparisonMask(local, childId, role, slot, pending), 70);
  localComparisonMaskRequests.set(slot, pending);
}

async function loadLocalComparisonMask(local, childId, role, slot, pending) {
  if (localComparisonMaskRequests.get(slot) !== pending || state.session?.session_id !== pending.sessionId) return;
  const controller = new AbortController();
  pending.controller = controller;
  try {
    const response = await fetch(
      `/api/session/${pending.sessionId}/local-mask/${encodeURIComponent(local.id)}/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mask: pending.expression,
          adjustments: state.adjustments,
          edit_revision: state.editRevision,
          long_edge: pending.longEdge,
        }),
      },
    );
    if (!response.ok || localComparisonMaskRequests.get(slot) !== pending || state.session?.session_id !== pending.sessionId) return;
    const width = Number(response.headers.get("X-Image-Width"));
    const height = Number(response.headers.get("X-Image-Height"));
    const alpha = new Uint8Array(await response.arrayBuffer());
    if (localComparisonMaskRequests.get(slot) !== pending || state.session?.session_id !== pending.sessionId) return;
    const currentLocal = selectedLocal();
    const currentParts = selectedChildMaskParts(currentLocal);
    const currentExpression = role === "parent" ? currentParts?.parent : currentParts?.child;
    if (
      currentLocal?.id !== local.id
      || currentParts?.id !== childId
      || pending.requestedGeometrySignature !== geometrySignature()
      || pending.signature !== localMaskSpatialSignature(currentExpression)
    ) return;
    localComparisonMaskCache.set(slot, {
      key: pending.key,
      signature: pending.signature,
      geometrySignature: pending.requestedGeometrySignature,
      canvas: alphaMaskCanvas(alpha, width, height),
    });
    while (localComparisonMaskCache.size > 12) {
      localComparisonMaskCache.delete(localComparisonMaskCache.keys().next().value);
    }
    localComparisonCompositeCache.clear();
    queueLocalMaskOverlayRender();
  } catch (error) {
    if (error?.name !== "AbortError") console.warn("Local mask comparison could not be loaded.", error);
  } finally {
    if (localComparisonMaskRequests.get(slot) === pending) localComparisonMaskRequests.delete(slot);
  }
}

function drawLocalMaskComparison(context, parentEntry, childEntry, x, y) {
  const compositeKey = `${parentEntry.key}:${childEntry?.key || "no-child"}`;
  let composite = localComparisonCompositeCache.get(compositeKey);
  if (!composite) {
    const width = parentEntry.canvas.width;
    const height = parentEntry.canvas.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const canvasContext = canvas.getContext("2d");
    const parentPixels = parentEntry.canvas.getContext("2d").getImageData(0, 0, width, height).data;
    let childPixels = null;
    if (childEntry) {
      const childCanvas = document.createElement("canvas");
      childCanvas.width = width;
      childCanvas.height = height;
      childCanvas.getContext("2d").drawImage(childEntry.canvas, 0, 0, width, height);
      childPixels = childCanvas.getContext("2d").getImageData(0, 0, width, height).data;
    }
    const output = canvasContext.createImageData(width, height);
    const parentColor = LOCAL_COMPARISON_COLORS.parent;
    const childColor = LOCAL_COMPARISON_COLORS.child;
    const overlapColor = LOCAL_COMPARISON_COLORS.overlap;
    for (let index = 0; index < output.data.length; index += 4) {
      const parentAmount = parentPixels[index + 3] / 255;
      const childAmount = childPixels ? childPixels[index + 3] / 255 : 0;
      const parentOnly = parentAmount * (1 - childAmount);
      const childOnly = childAmount * (1 - parentAmount);
      const overlap = parentAmount * childAmount;
      const coverage = parentOnly + childOnly + overlap;
      if (coverage <= 0.0001) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[index + channel] = Math.round((
          parentOnly * parentColor[channel]
          + childOnly * childColor[channel]
          + overlap * overlapColor[channel]
        ) / coverage);
      }
      output.data[index + 3] = Math.round(255 * 0.58 * coverage);
    }
    canvasContext.putImageData(output, 0, 0);
    composite = canvas;
    localComparisonCompositeCache.set(compositeKey, composite);
    while (localComparisonCompositeCache.size > 8) {
      localComparisonCompositeCache.delete(localComparisonCompositeCache.keys().next().value);
    }
  }
  const left = x(0);
  const top = y(0);
  const width = Math.max(1, Math.round(x(1) - left));
  const height = Math.max(1, Math.round(y(1) - top));
  context.drawImage(composite, left, top, width, height);
}

function drawMaskExpression(context, expression, x, y, options = {}) {
  if (expression.operator !== "leaf") {
    const children = expression.enabled === false
      ? (expression.children || []).slice(0, 1)
      : (expression.children || []).filter((child) => child.enabled !== false);
    children.forEach((child) => drawMaskExpression(context, child, x, y, options));
    return;
  }
  if (expression.enabled === false) return;
  const leaf = expression.leaf;
  if (!leaf) return;
  const renderMask = options.renderPhase !== "gizmo";
  const renderGizmo = options.renderPhase !== "mask";
  context.save();
  context.strokeStyle = "rgba(238, 252, 255, .98)";
  context.fillStyle = overlayColorWithAlpha(0.22, options.overlayColor);
  context.lineWidth = 2;
  if (leaf.type === "linear_gradient") {
    if (renderMask && state.localShowMask && options.authoritative) {
      drawAuthoritativeMaskOverlay(context, options.authoritative.canvas, x, y, options.authoritative.spatialOnly ? leaf.mask_opacity : 1);
    }
    if (renderGizmo) drawLinearGradientGizmo(context, leaf, x, y);
  } else if (leaf.type === "brush" && !options.skipBrush) {
    const gesture = state.localPointerGesture;
    const activeStroke = gesture?.type === "brush" && gesture.leaf === leaf ? gesture.stroke : null;
    // Authoritative mask rasters are already in post-geometry output space,
    // while the client fallback is rebuilt from source-anchored stroke points.
    // Draw only the former in the untransformed mask phase. The latter must
    // share the source-to-output transform used by the cursor, active stroke,
    // and Path gizmos or a crop/rotate makes settled paint jump away from the
    // pointer until the authoritative mask request completes.
    if (renderMask && state.localShowMask && options.authoritative) {
      drawBrushMaskOverlay(context, leaf, null, x, y, expression.inverted, options);
    }
    if (renderGizmo && state.localShowMask && !options.authoritative) {
      drawBrushMaskOverlay(context, leaf, null, x, y, expression.inverted, options);
    }
    if (renderGizmo && state.localShowMask && activeStroke) {
      drawActiveBrushStrokeOverlay(context, activeStroke, x, y, null, options.overlayColor);
    }
    const cursor = state.localBrushCursor || activeStroke?.points?.at(-1);
    if (renderGizmo && cursor) drawBrushGizmo(context, cursor, brushSettings(leaf), x, y);
  } else if (leaf.type === "luminance_range") {
    if (renderMask && state.localShowMask && options.authoritative && !options.gpuLumaOverlay) {
      drawAuthoritativeMaskOverlay(context, options.authoritative.canvas, x, y, options.authoritative.spatialOnly ? leaf.mask_opacity : 1);
    }
    const samplingGesture = state.localPointerGesture;
    if (renderMask && samplingGesture?.type === "luminance_sample" && samplingGesture.leaf === leaf) {
      drawLuminanceSamplingGesture(context, samplingGesture, x, y);
    }
  } else if (leaf.type === "path") {
    const currentAuthoritative = options.authoritativeCurrent ? options.authoritative : null;
    if (renderMask && state.localShowMask && currentAuthoritative) {
      drawAuthoritativeMaskOverlay(context, currentAuthoritative.canvas, x, y, currentAuthoritative.spatialOnly ? leaf.mask_opacity : 1);
    }
    if (renderGizmo) drawPathMaskGizmo(context, leaf, x, y, {
      drawFill: !currentAuthoritative,
      pathCursor: options.pathCursor,
    });
  }
  context.restore();
}

function brushOutputSpaceMapper(imageRect, matrix) {
  const width = Math.max(Number(imageRect?.width) || 0, 1);
  const height = Math.max(Number(imageRect?.height) || 0, 1);
  const mappedRadius = (radius, point = { x: 0.5, y: 0.5 }) => {
    const center = projectivePoint(matrix, point);
    const edge = projectivePoint(matrix, { x: Number(point.x) + Number(radius), y: Number(point.y) });
    return Math.hypot((edge.x - center.x) * width, (edge.y - center.y) * height) / width;
  };
  return {
    signature: `${matrix.join(",")}:${(width / height).toFixed(8)}`,
    point: (point) => projectivePoint(matrix, point),
    radius: mappedRadius,
    stroke: (stroke, points = stroke.points || []) => {
      const radiusPoint = points[Math.floor(points.length / 2)] || stroke.points?.[0] || { x: 0.5, y: 0.5 };
      return {
        ...stroke,
        radius: mappedRadius(stroke.radius, radiusPoint),
        points: points.map((point) => ({ ...projectivePoint(matrix, point), pressure: point.pressure })),
      };
    },
  };
}

function drawBrushExpressionOutputSpace(context, expression, x, y, options, mapper) {
  if (expression.operator !== "leaf") {
    const children = expression.enabled === false
      ? (expression.children || []).slice(0, 1)
      : (expression.children || []).filter((child) => child.enabled !== false);
    children.forEach((child) =>
      drawBrushExpressionOutputSpace(context, child, x, y, options, mapper));
    return;
  }
  if (expression.enabled === false) return;
  const leaf = expression.leaf;
  if (leaf?.type !== "brush") return;
  const gesture = state.localPointerGesture;
  const activeStroke = gesture?.type === "brush" && gesture.leaf === leaf ? gesture.stroke : null;
  const transformedLeaf = {
    ...leaf,
    strokes: (leaf.strokes || []).map((stroke) => mapper.stroke(stroke)),
  };
  const outputOptions = {
    ...options,
    spatialSignature: `${options.spatialSignature}:${mapper.signature}`,
  };
  if (state.localShowMask && !options.authoritative) {
    drawBrushMaskOverlay(context, transformedLeaf, null, x, y, expression.inverted, outputOptions);
  }
  if (!options.suppressGizmo && state.localShowMask && activeStroke) {
    drawActiveBrushStrokeOverlay(context, activeStroke, x, y, mapper, options.overlayColor);
  }
  const cursor = state.localBrushCursor || activeStroke?.points?.at(-1);
  if (!options.suppressGizmo && cursor) {
    const settings = brushSettings(leaf);
    drawBrushGizmo(context, mapper.point(cursor), { ...settings, radius: mapper.radius(settings.radius, cursor) }, x, y);
  }
}

function drawBrushMaskOverlay(context, leaf, activeStroke, x, y, inverted = false, options = {}) {
  const left = x(0);
  const top = y(0);
  const displayWidth = Math.max(1, Math.round(x(1) - left));
  const displayHeight = Math.max(1, Math.round(y(1) - top));
  const strokes = leaf.strokes || [];
  const authoritativeCanvas = options.authoritative?.canvas || null;
  const interactionLongEdge = Math.max(256, Math.min(1600, settledProxyLongEdge()));
  const fallbackScale = Math.min(1, interactionLongEdge / Math.max(displayWidth, displayHeight));
  const width = authoritativeCanvas?.width || Math.max(1, Math.round(displayWidth * fallbackScale));
  const height = authoritativeCanvas?.height || Math.max(1, Math.round(displayHeight * fallbackScale));
  const signature = `${width}x${height}:${options.spatialSignature || options.maskSignature || JSON.stringify(strokes)}`;
  const cacheKey = options.localId || leaf;
  let cached = null;
  if (!authoritativeCanvas) {
    cached = localBrushMaskCanvasCache.get(cacheKey);
    if (cached) {
      localBrushMaskCanvasCache.delete(cacheKey);
      localBrushMaskCanvasCache.set(cacheKey, cached);
    }
    if (!cached || cached.signature !== signature) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const canvasContext = canvas.getContext("2d");
      let eraseAttenuation = null;
      for (const stroke of strokes) {
        if (stroke.erase) {
          if (!eraseAttenuation) eraseAttenuation = opaqueBrushMaskCanvas(width, height);
          drawBrushMaskStroke(eraseAttenuation.getContext("2d"), stroke, width, height);
        } else {
          drawBrushMaskStroke(canvasContext, stroke, width, height);
          if (eraseAttenuation) drawBrushMaskStroke(eraseAttenuation.getContext("2d"), stroke, width, height);
        }
      }
      // Cache the fully processed fallback too, since several overlay renders
      // can occur while the authoritative mask request is in flight after
      // pointer-up. Ordered attenuation lets paint restore an earlier erase.
      const processedCanvas = postProcessBrushMaskPreviewWithErase(
        canvas,
        eraseAttenuation,
        leaf,
        width,
        height,
        inverted,
      );
      cached = { signature, processedCanvas };
      localBrushMaskCanvasCache.set(cacheKey, cached);
      while (localBrushMaskCanvasCache.size > LOCAL_BRUSH_MASK_CACHE_LIMIT) {
        localBrushMaskCanvasCache.delete(localBrushMaskCanvasCache.keys().next().value);
      }
    }
  }
  let maskCanvas = authoritativeCanvas
    ? authoritativeCanvas
    : cached.processedCanvas;
  if (activeStroke) {
    const baseKey = `${signature}:${options.authoritative?.key || "draft"}`;
    let gestureCanvas = localBrushGestureCanvasCache.get(activeStroke);
    if (!gestureCanvas || gestureCanvas.baseKey !== baseKey) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(maskCanvas, 0, 0, width, height);
      gestureCanvas = { baseKey, canvas, renderedPointCount: 0 };
      localBrushGestureCanvasCache.set(activeStroke, gestureCanvas);
    }
    const firstNewPoint = Math.max(0, gestureCanvas.renderedPointCount - 1);
    const pendingPoints = activeStroke.points.slice(firstNewPoint);
    if (pendingPoints.length && (gestureCanvas.renderedPointCount === 0 || pendingPoints.length > 1)) {
      const draftStroke = {
        ...activeStroke,
        points: pendingPoints,
        opacity: Number(activeStroke.opacity),
      };
      drawBrushMaskStroke(gestureCanvas.canvas.getContext("2d"), draftStroke, width, height);
      gestureCanvas.renderedPointCount = activeStroke.points.length;
    }
    maskCanvas = gestureCanvas.canvas;
  }
  // Shift/Feather generate alpha outside the painted source. Colorize only
  // after those operations so newly covered pixels cannot retain black RGB.
  maskCanvas = tintedBrushMaskCanvas(maskCanvas, !activeStroke, options.overlayColor);
  context.save();
  const influenceOpacity = options.authoritative?.spatialOnly === false
    ? 1
    : clamp(Number(leaf.mask_opacity ?? 1), 0, 1);
  context.globalAlpha = 0.52 * influenceOpacity;
  context.drawImage(maskCanvas, left, top, displayWidth, displayHeight);
  context.restore();
}

async function queueAuthoritativeLocalMask(local) {
  if (!state.session || !local || !local.mask) return;
  if (state.localPathDraft?.localId === local.id) return;
  if (state.localPathCreatePendingId === local.id) return;
  if (state.localMaskCommitDepth > 0) return;
  if (local.mask.operator === "leaf" && local.mask.leaf?.type === "brush" && !(local.mask.leaf.strokes || []).length) return;
  if (state.localMaskDraftDirty) return;
  const signature = localMaskSpatialSignature(local.mask);
  const longEdge = maskOverviewLongEdge();
  const revision = state.editRevision;
  const requestedGeometrySignature = geometrySignature();
  const sessionId = state.session.session_id;
  const key = `${sessionId}:${local.id}:${longEdge}:${requestedGeometrySignature}:${signature}`;
  const cached = localAuthoritativeMaskCache.get(local.id);
  if (cached?.key === key || localAuthoritativeMaskRequests.has(key)) return;
  const controller = new AbortController();
  const request = fetch(`/api/session/${sessionId}/local-mask/${encodeURIComponent(local.id)}?long_edge=${longEdge}&edit_revision=${revision}&geometry_signature=${encodeURIComponent(requestedGeometrySignature)}&spatial_only=true`, { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok || state.session?.session_id !== sessionId) return;
      if (response.headers.get("X-Geometry-Signature") !== requestedGeometrySignature) return;
      const width = Number(response.headers.get("X-Image-Width"));
      const height = Number(response.headers.get("X-Image-Height"));
      const alpha = new Uint8Array(await response.arrayBuffer());
      if (
        state.session?.session_id !== sessionId
        || localAuthoritativeMaskRequests.get(key)?.request !== request
        || signature !== localMaskSpatialSignature(selectedLocal()?.mask)
        || requestedGeometrySignature !== geometrySignature()
      ) return;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let sourceIndex = 0, targetIndex = 0; sourceIndex < alpha.length; sourceIndex += 1, targetIndex += 4) {
        pixels[targetIndex + 3] = alpha[sourceIndex];
      }
      canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
      localAuthoritativeMaskCache.set(local.id, {
        key,
        signature,
        geometrySignature: requestedGeometrySignature,
        canvas,
        spatialOnly: true,
      });
      finishPathMaskProgress(local.id, signature, true);
      while (localAuthoritativeMaskCache.size > 8) {
        localAuthoritativeMaskCache.delete(localAuthoritativeMaskCache.keys().next().value);
      }
      queueLocalMaskOverlayRender();
    })
    .catch((error) => {
      if (error?.name !== "AbortError") console.warn("Authoritative local mask could not be loaded.", error);
    })
    .finally(() => {
      if (localAuthoritativeMaskRequests.get(key)?.request === request) localAuthoritativeMaskRequests.delete(key);
    });
  localAuthoritativeMaskRequests.set(key, { controller, request, sessionId });
  await request;
}

function scheduleAuthoritativeLocalMaskDraft(local) {
  if (!state.session || !local || !local.mask) return;
  if (state.localPathDraft?.localId === local.id) return;
  if (state.localPathCreatePendingId === local.id) return;
  const leaf = selectedMaskLeaf(local);
  if (!leaf) return;
  if (leaf.type === "brush" && local.mask.operator === "leaf" && !(leaf.strokes || []).length) return;
  const signature = JSON.stringify(local.mask);
  state.localMaskDraftPending = {
    sessionId: state.session.session_id,
    localId: local.id,
    mask: JSON.parse(signature),
    signature,
    revision: state.editRevision,
    longEdge: maskOverviewLongEdge(),
    adjustments: JSON.parse(JSON.stringify(state.adjustments)),
    geometrySignature: geometrySignature(),
    generation: ++state.localMaskDraftGeneration,
  };
  if (state.localMaskDraftController) {
    return;
  }
  window.clearTimeout(state.localMaskDraftTimer);
  state.localMaskDraftTimer = window.setTimeout(flushAuthoritativeLocalMaskDraft, 90);
}

function flushAuthoritativeLocalMaskDraft() {
  state.localMaskDraftTimer = 0;
  if (state.localMaskDraftController || !state.localMaskDraftPending) return;
  const pending = state.localMaskDraftPending;
  state.localMaskDraftPending = null;
  void loadAuthoritativeLocalMaskDraft(
    pending.localId,
    pending.mask,
    pending.signature,
    pending.revision,
    pending.longEdge,
    pending.adjustments,
    pending.geometrySignature,
    pending.generation,
    pending.sessionId,
  );
}

function drawActiveBrushStrokeOverlay(context, stroke, x, y, mapper = null, color = state.localOverlayColor) {
  const left = x(0);
  const top = y(0);
  const displayWidth = Math.max(1, Math.round(x(1) - left));
  const displayHeight = Math.max(1, Math.round(y(1) - top));
  const longEdge = Math.max(256, Math.min(1600, settledProxyLongEdge()));
  const scale = Math.min(1, longEdge / Math.max(displayWidth, displayHeight));
  const width = Math.max(1, Math.round(displayWidth * scale));
  const height = Math.max(1, Math.round(displayHeight * scale));
  let gesture = localBrushGestureCanvasCache.get(stroke);
  if (!gesture || gesture.width !== width || gesture.height !== height) {
    const canvas = document.createElement("canvas");
    const tinted = document.createElement("canvas");
    canvas.width = tinted.width = width;
    canvas.height = tinted.height = height;
    gesture = { canvas, tinted, width, height, renderedPointCount: 0 };
    localBrushGestureCanvasCache.set(stroke, gesture);
  }
  const firstNewPoint = Math.max(0, gesture.renderedPointCount - 1);
  const pendingPoints = stroke.points.slice(firstNewPoint);
  if (pendingPoints.length && (gesture.renderedPointCount === 0 || pendingPoints.length > 1)) {
    const pendingStroke = mapper
      ? mapper.stroke(stroke, pendingPoints)
      : { ...stroke, points: pendingPoints };
    drawBrushMaskStroke(gesture.canvas.getContext("2d"), pendingStroke, width, height);
    gesture.renderedPointCount = stroke.points.length;
  }
  if (gesture.color !== color || pendingPoints.length) {
    const tintedContext = gesture.tinted.getContext("2d");
    tintedContext.clearRect(0, 0, width, height);
    tintedContext.drawImage(gesture.canvas, 0, 0);
    tintBrushMask(tintedContext, width, height, color);
    gesture.color = color;
  }
  context.save();
  context.globalAlpha = 0.52;
  context.drawImage(gesture.tinted, left, top, displayWidth, displayHeight);
  context.restore();
}

async function loadAuthoritativeLocalMaskDraft(
  localId,
  mask,
  signature,
  revision,
  longEdge,
  adjustments,
  requestedGeometrySignature,
  generation,
  sessionId,
) {
  if (state.session?.session_id !== sessionId) return;
  const controller = new AbortController();
  state.localMaskDraftController = controller;
  const requestedAt = performance.now();
  try {
    const response = await fetch(
      `/api/session/${sessionId}/local-mask/${encodeURIComponent(localId)}/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ mask, adjustments, edit_revision: revision, long_edge: longEdge }),
      },
    );
    if (!response.ok || state.session?.session_id !== sessionId) return;
    const width = Number(response.headers.get("X-Image-Width"));
    const height = Number(response.headers.get("X-Image-Height"));
    const alpha = new Uint8Array(await response.arrayBuffer());
    if (state.session?.session_id !== sessionId) return;
    const selected = selectedLocal();
    const currentMaskMatch = Boolean(selected?.mask)
      && localId === selected.id
      && signature === JSON.stringify(selected.mask)
      && requestedGeometrySignature === geometrySignature();
    if (
      (!currentMaskMatch && (generation !== state.localMaskDraftGeneration || revision !== state.editRevision))
      || requestedGeometrySignature !== geometrySignature()
      || localId !== state.selectedLocalId
      || signature !== JSON.stringify(selected?.mask)
    ) {
      state.previewScheduler?.recordStaleResult();
      return;
    }
    const canvas = alphaMaskCanvas(alpha, width, height);
    localAuthoritativeMaskCache.set(localId, {
      key: `draft:${revision}:${longEdge}:${requestedGeometrySignature}:${signature}`,
      signature,
      geometrySignature: requestedGeometrySignature,
      canvas,
      spatialOnly: false,
    });
    finishPathMaskProgress(localId, signature, false);
    trimAuthoritativeLocalMaskCache();
    if (state.rotateDraftGeometry && requestedGeometrySignature === geometrySignature()) {
      [els.previewOverlay, els.localMaskOverlay].forEach((overlay) => {
        overlay?.style.removeProperty("--interactive-rotate-angle");
        overlay?.style.removeProperty("--interactive-flip-x");
        overlay?.style.removeProperty("--interactive-flip-y");
        overlay?.style.removeProperty("--interactive-straighten-angle");
        overlay?.style.removeProperty("--interactive-straighten-scale");
      });
    }
    queueLocalMaskOverlayRender();
    requestAnimationFrame((presentedAt) => {
      window.dispatchEvent(new CustomEvent("hdrfinisher:mask-presented", {
        detail: {
          localId,
          generation,
          longEdge,
          requestedAt,
          presentedAt,
          cpuMaskMs: Number(response.headers.get("X-CPU-Mask-Ms")) || null,
          byteLength: alpha.byteLength,
        },
      }));
    });
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("Authoritative local mask draft could not be loaded.", error);
      failPathMaskProgress(localId);
    }
  } finally {
    if (state.localMaskDraftController === controller) state.localMaskDraftController = null;
    if (state.localMaskDraftPending && state.localMaskDraftDirty && !state.localMaskDraftTimer) {
      state.localMaskDraftTimer = window.setTimeout(flushAuthoritativeLocalMaskDraft, 90);
    }
  }
}

function alphaMaskCanvas(alpha, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < alpha.length; sourceIndex += 1, targetIndex += 4) {
    pixels[targetIndex + 3] = alpha[sourceIndex];
  }
  canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
}

function trimAuthoritativeLocalMaskCache() {
  while (localAuthoritativeMaskCache.size > 8) {
    localAuthoritativeMaskCache.delete(localAuthoritativeMaskCache.keys().next().value);
  }
}

function postProcessBrushMaskPreview(source, leaf, width, height) {
  let result = source;
  const shift = clamp(Number(leaf.mask_shift_edge || 0), -0.05, 0.05);
  if (Math.abs(shift) > 0) {
    const blurred = document.createElement("canvas");
    blurred.width = width;
    blurred.height = height;
    const blurredContext = blurred.getContext("2d");
    // Radii are fractions of the long edge, as in the backend.
    blurredContext.filter = `blur(${Math.max(0.25, Math.abs(shift) * Math.max(width, height))}px)`;
    blurredContext.drawImage(result, 0, 0);
    const sourcePixels = result.getContext("2d").getImageData(0, 0, width, height);
    const shiftedPixels = blurredContext.getImageData(0, 0, width, height);
    const threshold = shift > 0 ? 0.158655 : 0.841345;
    const halfBand = 0.035;
    for (let index = 3; index < shiftedPixels.data.length; index += 4) {
      let level = clamp((shiftedPixels.data[index] / 255 - threshold + halfBand) / (halfBand * 2), 0, 1);
      level = level * level * (3 - 2 * level);
      const shiftedAlpha = Math.round(level * 255);
      shiftedPixels.data[index] = shift > 0
        ? Math.max(sourcePixels.data[index], shiftedAlpha)
        : Math.min(sourcePixels.data[index], shiftedAlpha);
    }
    blurredContext.filter = "none";
    blurredContext.putImageData(shiftedPixels, 0, 0);
    result = blurred;
  }

  const featherAmount = clamp(Number(leaf.mask_feather || 0) / 0.05, 0, 1);
  if (featherAmount <= 0) return result;
  const softened = document.createElement("canvas");
  softened.width = width;
  softened.height = height;
  const softenedContext = softened.getContext("2d");
  const sourcePixels = result.getContext("2d").getImageData(0, 0, width, height);
  const featherRadius = 0.18 * Math.pow(featherAmount, 0.75);
  softenedContext.filter = `blur(${Math.max(0.25, featherRadius * Math.max(width, height))}px)`;
  softenedContext.drawImage(result, 0, 0);
  const outputPixels = softenedContext.getImageData(0, 0, width, height);
  let sourcePeak = 0;
  let blurredPeak = 0;
  for (let index = 3; index < outputPixels.data.length; index += 4) {
    sourcePeak = Math.max(sourcePeak, sourcePixels.data[index]);
    blurredPeak = Math.max(blurredPeak, outputPixels.data[index]);
  }
  // Keep the painted density stable while replacing the hard boundary with a
  // real Gaussian transition. This avoids the old solid edge plus faint halo.
  const peakScale = blurredPeak > 0 ? sourcePeak / blurredPeak : 0;
  for (let index = 3; index < outputPixels.data.length; index += 4) {
    outputPixels.data[index] = Math.min(sourcePeak, Math.round(outputPixels.data[index] * peakScale));
  }
  softenedContext.filter = "none";
  softenedContext.putImageData(outputPixels, 0, 0);
  return softened;
}

function opaqueBrushMaskCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  return canvas;
}

function postProcessBrushMaskPreviewWithErase(paintedSource, eraseAttenuation, leaf, width, height, inverted = false) {
  const processed = postProcessBrushMaskPreview(paintedSource, leaf, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(processed, 0, 0, width, height);
  const output = context.getImageData(0, 0, width, height);
  const attenuation = eraseAttenuation?.getContext("2d").getImageData(0, 0, width, height).data || null;
  for (let index = 3; index < output.data.length; index += 4) {
    const alpha = inverted ? 255 - output.data[index] : output.data[index];
    output.data[index] = attenuation
      ? Math.round(alpha * attenuation[index] / 255)
      : alpha;
  }
  context.putImageData(output, 0, 0);
  return canvas;
}

function tintedBrushMaskCanvas(maskCanvas, cacheable = false, color = state.localOverlayColor) {
  const cached = cacheable ? localTintedMaskCanvasCache.get(maskCanvas) : null;
  if (cached?.color === color) return cached.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = maskCanvas.width;
  canvas.height = maskCanvas.height;
  const context = canvas.getContext("2d");
  context.drawImage(maskCanvas, 0, 0);
  tintBrushMask(context, canvas.width, canvas.height, color);
  if (cacheable) localTintedMaskCanvasCache.set(maskCanvas, { color, canvas });
  return canvas;
}

function tintBrushMask(context, width, height, color = state.localOverlayColor) {
  context.save();
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function overlayColorWithAlpha(alpha, color = state.localOverlayColor) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return `rgba(255, 38, 61, ${alpha})`;
  return `rgba(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}, ${alpha})`;
}

function drawAuthoritativeMaskOverlay(context, maskCanvas, x, y, influenceOpacity = 1) {
  const left = x(0);
  const top = y(0);
  const width = Math.max(1, Math.round(x(1) - left));
  const height = Math.max(1, Math.round(y(1) - top));
  const tinted = tintedBrushMaskCanvas(maskCanvas, true);
  context.save();
  context.globalAlpha = 0.52 * clamp(Number(influenceOpacity), 0, 1);
  context.drawImage(tinted, left, top, width, height);
  context.restore();
}

function drawBrushMaskStroke(context, stroke, width, height) {
  const points = stroke.points || [];
  if (!points.length) return;
  const baseRadius = Math.max(1, Number(stroke.radius) * width);
  const hardness = clamp(Number(stroke.hardness), 0, 1);
  const flow = clamp(Number(stroke.flow), 0, 1);
  const opacity = clamp(Number(stroke.opacity), 0, 1);
  const maximumRadius = baseRadius;
  const pointXs = points.map((point) => Number(point.x) * width);
  const pointYs = points.map((point) => Number(point.y) * height);
  const roiLeft = Math.max(0, Math.floor(Math.min(...pointXs) - maximumRadius));
  const roiRight = Math.min(width - 1, Math.ceil(Math.max(...pointXs) + maximumRadius));
  const roiTop = Math.max(0, Math.floor(Math.min(...pointYs) - maximumRadius));
  const roiBottom = Math.min(height - 1, Math.ceil(Math.max(...pointYs) + maximumRadius));
  const roiWidth = roiRight - roiLeft + 1;
  const roiHeight = roiBottom - roiTop + 1;
  if (roiWidth <= 0 || roiHeight <= 0) return;
  const strokeMask = new Float32Array(roiWidth * roiHeight);

  const applyCapsule = (first, second, pressure) => {
    const radius = Math.max(1, baseRadius * clamp(Number(pressure), 0.05, 1));
    const inner = radius * hardness;
    const featherWidth = Math.max(radius - inner, 1e-6);
    const x0 = Number(first.x) * width;
    const y0 = Number(first.y) * height;
    const x1 = Number(second.x) * width;
    const y1 = Number(second.y) * height;
    const left = Math.max(0, Math.floor(Math.min(x0, x1) - radius));
    const right = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + radius));
    const top = Math.max(0, Math.floor(Math.min(y0, y1) - radius));
    const bottom = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + radius));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const denominator = Math.max(dx * dx + dy * dy, 1e-8);
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        const projection = clamp(((column - x0) * dx + (row - y0) * dy) / denominator, 0, 1);
        const nearestX = x0 + projection * dx;
        const nearestY = y0 + projection * dy;
        const distance = Math.hypot(column - nearestX, row - nearestY);
        if (distance >= radius) continue;
        const coverage = distance <= inner ? 1 : 1 - (distance - inner) / featherWidth;
        const index = (row - roiTop) * roiWidth + column - roiLeft;
        strokeMask[index] = Math.max(strokeMask[index], coverage);
      }
    }
  };

  if (points.length === 1) {
    applyCapsule(points[0], points[0], points[0].pressure ?? 1);
  } else {
    for (let index = 1; index < points.length; index += 1) {
      const first = points[index - 1];
      const second = points[index];
      applyCapsule(first, second, (Number(first.pressure ?? 1) + Number(second.pressure ?? 1)) * 0.5);
    }
  }

  const image = context.getImageData(roiLeft, roiTop, roiWidth, roiHeight);
  for (let index = 0; index < strokeMask.length; index += 1) {
    const coverage = strokeMask[index];
    if (coverage <= 0) continue;
    const alphaIndex = index * 4 + 3;
    const existing = image.data[alphaIndex] / 255;
    const next = stroke.erase
      ? existing * (1 - Math.min(opacity, coverage * flow))
      : Math.max(existing, Math.min(opacity, existing + coverage * flow));
    image.data[alphaIndex - 3] = 0;
    image.data[alphaIndex - 2] = 0;
    image.data[alphaIndex - 1] = 0;
    image.data[alphaIndex] = Math.round(next * 255);
  }
  context.putImageData(image, roiLeft, roiTop);
}

function tracePathBoundary(context, nodes, x, y, closed = true) {
  context.beginPath();
  if (!nodes?.length) return;
  context.moveTo(x(nodes[0].x), y(nodes[0].y));
  const segmentCount = closed ? nodes.length : Math.max(0, nodes.length - 1);
  for (let index = 0; index < segmentCount; index += 1) {
    const first = nodes[index];
    const second = nodes[(index + 1) % nodes.length];
    context.bezierCurveTo(
      x(first.out_x ?? first.x), y(first.out_y ?? first.y),
      x(second.in_x ?? second.x), y(second.in_y ?? second.y),
      x(second.x), y(second.y),
    );
  }
  if (closed) context.closePath();
}

function drawPathNode(context, node, index, x, y, selected, hovered, closeTarget = false) {
  const centerX = x(node.x);
  const centerY = y(node.y);
  const radius = selected ? 7 : 5;
  withScreenSpaceCanvas(context, centerX, centerY, (screenX, screenY) => {
    context.lineWidth = selected ? 2.5 : 2;
    context.strokeStyle = closeTarget ? uiToken("--ready") : selected ? uiToken("--curve-selected-ring") : uiToken("--accent");
    context.fillStyle = selected ? uiToken("--curve-selected") : uiToken("--raised");
    context.shadowColor = "rgba(0, 0, 0, .95)";
    context.shadowBlur = 3;
    context.beginPath();
    if (node.node_type === "sharp") context.rect(screenX - radius, screenY - radius, radius * 2, radius * 2);
    else context.arc(screenX, screenY, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (hovered) {
      context.beginPath();
      context.arc(screenX, screenY, radius + 4, 0, Math.PI * 2);
      context.strokeStyle = uiToken("--text");
      context.lineWidth = 1;
      context.stroke();
    }
  });
}

function drawSelectedPathHandles(context, node, nodeIndex, x, y) {
  if (!node) return;
  context.save();
  context.strokeStyle = uiToken("--accent");
  context.lineWidth = 2;
  for (const handle of ["in", "out"]) {
    if (node[`${handle}_x`] === null || node[`${handle}_x`] === undefined) continue;
    const hx = x(node[`${handle}_x`]);
    const hy = y(node[`${handle}_y`]);
    context.beginPath();
    context.moveTo(x(node.x), y(node.y));
    context.lineTo(hx, hy);
    context.strokeStyle = uiToken("--accent");
    context.lineWidth = 1.25;
    context.stroke();
    withScreenSpaceCanvas(context, hx, hy, (screenX, screenY) => {
      context.beginPath();
      context.arc(screenX, screenY, 6, 0, Math.PI * 2);
      context.fillStyle = uiToken("--raised");
      context.fill();
      context.strokeStyle = uiToken("--text");
      context.lineWidth = 2;
      context.stroke();
      if (state.hoveredPathTarget?.type === "handle" && state.hoveredPathTarget.index === nodeIndex && state.hoveredPathTarget.handle === handle) {
        context.beginPath();
        context.arc(screenX, screenY, 10, 0, Math.PI * 2);
        context.strokeStyle = uiToken("--curve-selected");
        context.lineWidth = 2;
        context.stroke();
      }
    });
  }
  context.restore();
}

function interpolatePathNodes(inner, outer, amount) {
  if (!inner?.length || inner.length !== outer?.length) return [];
  return inner.map((node, index) => {
    const target = outer[index];
    const mixed = { ...node };
    for (const key of ["x", "y", "in_x", "in_y", "out_x", "out_y"]) {
      const axis = key.endsWith("_y") || key === "y" ? "y" : "x";
      const start = Number(node[key] ?? node[axis]);
      const end = Number(target[key] ?? target[axis]);
      mixed[key] = start + (end - start) * amount;
    }
    return mixed;
  });
}

function drawPathFeatherDraftFill(context, inner, outer, x, y, opacity) {
  if (!outer.length || inner.length !== outer.length) return;
  // The exact feather raster arrives asynchronously. These nested contours
  // provide an immediate, progressively fading preview so dragging a feather
  // node or slider never looks as though it failed to apply.
  for (let step = 8; step >= 1; step -= 1) {
    tracePathBoundary(context, interpolatePathNodes(inner, outer, step / 8), x, y, true);
    context.fillStyle = overlayColorWithAlpha(0.028 * opacity);
    context.fill();
  }
}

function drawPathMaskGizmo(context, leaf, x, y, { drawFill = true, pathCursor = state.localPathCursor } = {}) {
  const draft = Boolean(state.localPathDraft && state.localPathDraft.localId === selectedLocal()?.id);
  const inner = leaf.nodes || [];
  const closed = !draft && inner.length >= 3;
  const outer = leaf.feather_mode === "outer_boundary" && inner.length >= 3
    ? (leaf.feather_nodes?.length ? leaf.feather_nodes : uniformFeatherNodes(inner, Number(leaf.feather || 0)))
    : [];
  const innerPath = () => tracePathBoundary(context, inner, x, y, closed);
  if (drawFill && closed && state.localShowMask) {
    drawPathFeatherDraftFill(
      context,
      inner,
      outer,
      x,
      y,
      clamp(Number(leaf.mask_opacity ?? 1), 0, 1),
    );
    innerPath();
    context.fillStyle = overlayColorWithAlpha(0.22 * clamp(Number(leaf.mask_opacity ?? 1), 0, 1));
    context.fill();
  }
  if (inner.length) {
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = state.pathInvalidGesture ? uiToken("--blocking") : uiToken("--accent");
    context.lineWidth = 1.25;
    innerPath();
    context.stroke();
    context.restore();
  }
  if (draft && inner.length && pathCursor) {
    const liveSegment = () => {
      context.beginPath();
      context.moveTo(x(inner.at(-1).x), y(inner.at(-1).y));
      context.lineTo(x(pathCursor.x), y(pathCursor.y));
    };
    drawLocalGizmoStroke(context, liveSegment, 1.75, uiToken("--accent"));
  }
  if (outer.length) {
    context.save();
    const reducedPathMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const outerPath = () => tracePathBoundary(context, outer, x, y, true);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "rgba(0, 0, 0, .82)";
    context.lineWidth = 3.5;
    outerPath(); context.stroke();
    context.strokeStyle = state.pathInvalidGesture
      ? "rgba(255, 92, 92, .95)"
      : state.localPathEditMode === "feather"
        ? uiToken("--accent")
        : "rgba(218, 229, 232, .78)";
    context.lineWidth = 1.5;
    context.setLineDash([5, 5]);
    context.lineDashOffset = reducedPathMotion ? 0 : -performance.now() / 70;
    outerPath(); context.stroke();
    context.restore();
    if (!reducedPathMotion && !pathMarchingAntFrame) {
      pathMarchingAntFrame = window.requestAnimationFrame(() => {
        pathMarchingAntFrame = 0;
        if (selectedMaskLeaf(selectedLocal(), "path")) queueLocalMaskOverlayRender();
      });
    }
  }

  const active = draft || state.localPathEditMode === "path" ? inner : outer;
  const selectedIndex = draft ? state.selectedPathNode : state.selectedPathNode;
  if (!draft) drawSelectedPathHandles(context, selectedIndex === null ? null : active[selectedIndex], selectedIndex, x, y);
  active.forEach((node, index) => {
    const hovered = state.hoveredPathTarget?.type === "node" && state.hoveredPathTarget.index === index;
    const closeTarget = draft && index === 0 && inner.length >= 3 && hovered;
    drawPathNode(context, node, index, x, y, index === selectedIndex, hovered, closeTarget);
  });
}

function drawLocalGizmoStroke(context, path, width = 2, color = "rgba(238, 252, 255, .98)") {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(0, 0, 0, .88)";
  context.lineWidth = width + 3;
  path();
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = width;
  path();
  context.stroke();
  context.restore();
}

function drawLocalGizmoHandle(context, centerX, centerY, radius = 7) {
  withScreenSpaceCanvas(context, centerX, centerY, (screenX, screenY) => {
    context.beginPath();
    context.arc(screenX, screenY, radius + 2, 0, Math.PI * 2);
    context.fillStyle = "rgba(0, 0, 0, .88)";
    context.fill();
    context.beginPath();
    context.arc(screenX, screenY, radius, 0, Math.PI * 2);
    context.fillStyle = "#142226";
    context.fill();
    context.strokeStyle = "#74e5ee";
    context.lineWidth = 2;
    context.stroke();
    context.beginPath();
    context.arc(screenX, screenY, 2, 0, Math.PI * 2);
    context.fillStyle = "#ffffff";
    context.fill();
  });
}

function withScreenSpaceCanvas(context, x, y, draw) {
  const transform = context.getTransform();
  const rect = context.canvas.getBoundingClientRect();
  const ratio = rect.width > 0
    ? Math.max(context.canvas.width / rect.width, 1e-6)
    : Math.max(window.devicePixelRatio || 1, 1e-6);
  const screenX = (transform.a * x + transform.c * y + transform.e) / ratio;
  const screenY = (transform.b * x + transform.d * y + transform.f) / ratio;
  context.save();
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw(screenX, screenY);
  context.restore();
}

function drawLinearGradientGizmo(context, leaf, x, y) {
  const start = { x: x(leaf.start.x), y: y(leaf.start.y) };
  const end = { x: x(leaf.end.x), y: y(leaf.end.y) };
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.max(1, Math.hypot(deltaX, deltaY));
  const normalX = -deltaY / length;
  const normalY = deltaX / length;
  const boundaryLength = Math.max(80, Math.min(Math.abs(x(1) - x(0)), Math.abs(y(1) - y(0))) * .32);
  const boundary = (point) => {
    context.beginPath();
    context.moveTo(point.x - normalX * boundaryLength, point.y - normalY * boundaryLength);
    context.lineTo(point.x + normalX * boundaryLength, point.y + normalY * boundaryLength);
  };
  const fanBoundary = () => {
    context.beginPath();
    for (let index = 0; index <= 32; index += 1) {
      const offset = -boundaryLength + (boundaryLength * 2 * index) / 32;
      const normalized = Math.tanh(offset / length);
      const scale = clamp(1 + Number(leaf.gradient_fan || 0) * 0.8 * normalized * normalized, 0.2, 1.8);
      const pointX = start.x + (deltaX * scale) + normalX * offset;
      const pointY = start.y + (deltaY * scale) + normalY * offset;
      if (index) context.lineTo(pointX, pointY);
      else context.moveTo(pointX, pointY);
    }
  };
  context.save();
  context.setLineDash([7, 6]);
  drawLocalGizmoStroke(context, () => boundary(start), 1.5, "rgba(238, 252, 255, .82)");
  drawLocalGizmoStroke(context, fanBoundary, 1.5, "rgba(238, 252, 255, .82)");
  context.restore();
  drawLocalGizmoStroke(context, () => {
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  }, 2);
  const controls = gradientControlPoints(leaf);
  drawLocalGizmoHandle(context, start.x, start.y);
  drawLocalGizmoHandle(context, x(controls.midpoint_1.x), y(controls.midpoint_1.y), 5);
  drawLocalGizmoHandle(context, x(controls.midpoint_2.x), y(controls.midpoint_2.y), 5);
  drawLocalGizmoHandle(context, end.x, end.y);
}

function drawBrushGizmo(context, point, stroke, x, y) {
  const radius = Math.max(2, Math.abs(x(stroke.radius) - x(0)));
  const feather = brushFeatherExtent(stroke.hardness);
  const featherRadius = radius * (1 + feather);
  let centerX = x(point.x);
  let centerY = y(point.y);
  if (state.localBrushPreviewPinned) {
    const scale = Math.max(context.getTransform().a, 1e-6);
    const bounds = state.localBrushVisibleBounds || { left: 0, top: 0, right: context.canvas.width / scale, bottom: context.canvas.height / scale };
    const visibleLeft = Math.max(bounds.left, Math.min(x(0), x(1)));
    const visibleRight = Math.min(bounds.right, Math.max(x(0), x(1)));
    const visibleTop = Math.max(bounds.top, Math.min(y(0), y(1)));
    const visibleBottom = Math.min(bounds.bottom, Math.max(y(0), y(1)));
    centerX = visibleRight - featherRadius - 3;
    centerY = clamp(centerY, visibleTop + featherRadius + 3, visibleBottom - featherRadius - 3);
    if (visibleRight - visibleLeft < featherRadius * 2 + 6) centerX = (visibleLeft + visibleRight) / 2;
    if (visibleBottom - visibleTop < featherRadius * 2 + 6) centerY = (visibleTop + visibleBottom) / 2;
  }
  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.strokeStyle = "rgba(218, 222, 223, .94)";
  context.lineWidth = 1;
  context.stroke();
  if (feather > 0.001) {
    const dashOffset = -((performance.now() / 70) % 12);
    context.beginPath();
    context.setLineDash([6, 6]);
    context.lineDashOffset = dashOffset;
    context.arc(centerX, centerY, featherRadius, 0, Math.PI * 2);
    context.strokeStyle = "rgba(8, 10, 11, .94)";
    context.lineWidth = 1.5;
    context.stroke();
    context.beginPath();
    context.lineDashOffset = dashOffset + 6;
    context.arc(centerX, centerY, featherRadius, 0, Math.PI * 2);
    context.strokeStyle = "rgba(245, 247, 247, .94)";
    context.lineWidth = 1.5;
    context.stroke();
    context.setLineDash([]);
    queueLocalMaskOverlayRender();
  }
  context.beginPath();
  context.arc(centerX, centerY, 1.5, 0, Math.PI * 2);
  context.fillStyle = stroke.erase ? "#ff6b72" : "rgba(235, 238, 239, .96)";
  context.fill();
  context.restore();
}

function drawLuminanceSamplingGesture(context, gesture, x, y) {
  const points = gesture.points || [];
  if (!points.length) return;
  const color = gesture.remove ? "#ff8a91" : "#74e5ee";
  context.save();
  drawLocalGizmoStroke(context, () => {
    context.beginPath();
    points.forEach((point, index) => index
      ? context.lineTo(x(point.x), y(point.y))
      : context.moveTo(x(point.x), y(point.y)));
  }, 2, color);
  for (const point of [points[0], points.at(-1)]) {
    context.beginPath();
    context.arc(x(point.x), y(point.y), 8, 0, Math.PI * 2);
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
    context.beginPath();
    context.moveTo(x(point.x) - 12, y(point.y));
    context.lineTo(x(point.x) + 12, y(point.y));
    context.moveTo(x(point.x), y(point.y) - 12);
    context.lineTo(x(point.x), y(point.y) + 12);
    context.stroke();
  }
  context.restore();
}

