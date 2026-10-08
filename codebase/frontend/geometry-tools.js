function geometrySignature() {
  return JSON.stringify(state.adjustments.shared?.geometry || defaultGeometry());
}

const IDENTITY_GEOMETRY_COORDINATE_MAP = Object.freeze({
  outputToSource: Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  sourceToOutput: Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]),
});

function geometryTransformIsNeutral(geometry = state.adjustments.shared?.geometry) {
  return geometryMath.geometryTransformIsNeutral(geometry);
}

function geometryCoordinateMapKey(signature = geometrySignature(), longEdge = settledProxyLongEdge()) {
  return `${state.session?.session_id || "none"}:${longEdge}:${signature}`;
}

function currentGeometryCoordinateMap() {
  if (geometryTransformIsNeutral()) return IDENTITY_GEOMETRY_COORDINATE_MAP;
  return geometryCoordinateMapCache.get(geometryCoordinateMapKey()) || null;
}

function projectivePoint(matrix, point) {
  return geometryMath.projectivePoint(matrix, point);
}

async function ensureGeometryCoordinateMap(longEdge = settledProxyLongEdge()) {
  if (!state.session || geometryTransformIsNeutral()) return IDENTITY_GEOMETRY_COORDINATE_MAP;
  const sessionId = state.session.session_id;
  const signature = geometrySignature();
  const key = geometryCoordinateMapKey(signature, longEdge);
  const cached = geometryCoordinateMapCache.get(key);
  if (cached) return cached;
  const inflight = geometryCoordinateMapRequests.get(key);
  if (inflight) return inflight;
  const adjustments = JSON.parse(JSON.stringify(state.adjustments));
  const request = fetch(`/api/session/${state.session.session_id}/geometry-map`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustments, edit_revision: state.editRevision, long_edge: longEdge }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Geometry coordinate map failed (${response.status}).`);
    const payload = await response.json();
    if (state.session?.session_id !== sessionId || signature !== geometrySignature()) return null;
    const result = {
      outputToSource: payload.output_to_source,
      sourceToOutput: payload.source_to_output,
      outputWidth: payload.output_width,
      outputHeight: payload.output_height,
      fullOutputWidth: payload.full_output_width,
      fullOutputHeight: payload.full_output_height,
    };
    geometryCoordinateMapCache.set(key, result);
    geometryFullOutputFrames.set(`${sessionId}:${signature}`, result);
    while (geometryFullOutputFrames.size > 12) {
      geometryFullOutputFrames.delete(geometryFullOutputFrames.keys().next().value);
    }
    while (geometryCoordinateMapCache.size > 12) {
      geometryCoordinateMapCache.delete(geometryCoordinateMapCache.keys().next().value);
    }
    queueLocalMaskOverlayRender();
    applyZoomGeometry();
    if (state.cropMode) constrainCropToRatio();
    return result;
  }).catch((error) => {
    console.warn("Source-anchored editor geometry is unavailable.", error);
    return null;
  }).finally(() => geometryCoordinateMapRequests.delete(key));
  geometryCoordinateMapRequests.set(key, request);
  return request;
}

function bindCropEditor() {
  els.cropToolToggle?.addEventListener("click", async () => {
    abandonPerspectiveDraft();
    if (state.rotateDraftGeometry) closeRotateMode(false);
    if (state.geometryTool === "crop") {
      closeCropMode(true);
      return;
    }
    if (state.cropMode) closeCropMode(true);
    state.geometryTool = "crop";
    await openCropMode();
  });
  els.rotateToolToggle?.addEventListener("click", () => {
    abandonPerspectiveDraft();
    if (state.cropMode) closeCropMode(true);
    if (state.geometryTool === "rotate") {
      closeRotateMode(false);
      return;
    }
    openRotateMode();
  });
  els.cropDone?.addEventListener("click", () => closeCropMode(true));
  els.cropCancel?.addEventListener("click", () => closeCropMode(false));
  els.cropResetFrame?.addEventListener("click", () => {
    if (!state.cropDraftGeometry) return;
    state.cropDraftGeometry.crop = { x: 0, y: 0, width: 1, height: 1 };
    constrainCropToRatio();
    renderCropFrame();
    renderGeometryResetState();
  });
  els.cropGuide?.addEventListener("change", () => {
    state.cropGuide = els.cropGuide.value;
    renderCropOptions();
    drawCropGuide();
  });
  els.cropGridDensity?.addEventListener("input", () => {
    state.cropGridDensity = Number(els.cropGridDensity.value);
    renderCropOptions();
    drawCropGuide();
  });
  els.rotateLeft?.addEventListener("click", () => rotateGeometry(-90));
  els.rotateRight?.addEventListener("click", () => rotateGeometry(90));
  els.flipHorizontal?.addEventListener("click", () => updateRotateDraft("flip_horizontal"));
  els.flipVertical?.addEventListener("click", () => updateRotateDraft("flip_vertical"));
  els.rotateApply?.addEventListener("click", () => closeRotateMode(true));
  els.rotateCancel?.addEventListener("click", () => closeRotateMode(false));
  els.swapCustomRatio?.addEventListener("click", () => {
    const ratio = state.cropDraftGeometry?.custom_ratio;
    if (!ratio) return;
    [ratio.width, ratio.height] = [ratio.height, ratio.width];
    renderCropOptions();
    constrainCropToRatio();
    renderGeometryResetState();
  });
  els.cropBox?.addEventListener("pointerdown", beginCropDrag);
  window.addEventListener("pointermove", moveCropDrag);
  window.addEventListener("pointerup", endCropDrag);
  window.addEventListener("pointercancel", endCropDrag);
  els.cropStraighten?.addEventListener("pointerdown", beginStraightenGesture);
  els.cropStraighten?.addEventListener("keydown", beginStraightenGesture);
  ["pointerup", "pointercancel", "change", "keyup"].forEach((eventName) => {
    els.cropStraighten?.addEventListener(eventName, finishStraightenGesture);
  });
  renderGeometryToolState();
}

function bindPerspectiveEditor() {
  const activateTool = (orientation) => {
    if (state.perspectiveApplyOperation?.saving) return;
    openPerspectiveMode();
    state.perspectiveTool = state.perspectiveTool === orientation ? null : orientation;
    renderPerspectiveControls();
    renderPerspectiveGuides();
  };
  els.perspectiveVerticalTool?.addEventListener("click", () => activateTool("vertical"));
  els.perspectiveHorizontalTool?.addEventListener("click", () => activateTool("horizontal"));
  const sliderInput = (key, control) => {
    if (state.perspectiveApplyOperation?.saving) return;
    const value = Number(control.value);
    openPerspectiveMode();
    state.adjustments.shared.geometry[key] = value;
    setPerspectiveStatus("Unapplied perspective draft. Apply to keep it; leaving this module cancels it.", "unapplied");
    renderPerspectiveControls();
    schedulePerspectiveDraftPreview();
  };
  els.perspectiveHorizontal?.addEventListener("input", () => sliderInput("perspective_horizontal", els.perspectiveHorizontal));
  els.perspectiveVertical?.addEventListener("input", () => sliderInput("perspective_vertical", els.perspectiveVertical));
  els.perspectiveRotate?.addEventListener("input", () => sliderInput("perspective_rotate", els.perspectiveRotate));
  els.perspectiveGuideApply?.addEventListener("click", () => void applyPerspectiveGuides());
  els.perspectiveApply?.addEventListener("click", () => void commitPerspectiveMode());
  els.perspectiveCancel?.addEventListener("click", () => closePerspectiveMode(false));
  els.perspectiveGuideHandles?.addEventListener("pointerdown", beginPerspectiveGuideDrag);
  els.perspectiveGuideHandles?.addEventListener("keydown", movePerspectiveGuideWithKeyboard);
  window.addEventListener("pointermove", movePerspectiveGuideDrag);
  window.addEventListener("pointerup", endPerspectiveGuideDrag);
  window.addEventListener("pointercancel", endPerspectiveGuideDrag);
  window.addEventListener("resize", renderPerspectiveGuides);
  // Other modules may already be expanded. Release preview ownership before
  // their handlers change values, including keyboard and programmatic input.
  const leaveForControl = (event) => {
    const group = event.target.closest?.(".control-group");
    if (group && group.dataset.group !== "perspective") abandonPerspectiveDraft();
  };
  for (const event of ["pointerdown", "keydown", "input", "change", "click"]) {
    document.addEventListener(event, leaveForControl, true);
  }
  renderPerspectiveControls();
}

function setPerspectiveStatus(message, phase = state.perspectivePhase) {
  state.perspectivePhase = phase;
  if (els.perspectiveStatus) els.perspectiveStatus.textContent = message;
  if (els.perspectiveApplyStatus) {
    els.perspectiveApplyStatus.textContent = ({ unapplied: "Unapplied", preparing: "Preparing draft",
      applying: "Applying…", applied: "Applied", failed: "Apply failed", previewFailed: "Preview failed" })[phase] || "";
    els.perspectiveApplyStatus.dataset.phase = phase;
  }
  const reset = els.groupResets?.find((button) => button.dataset.resetGroup === "perspective");
  const resetRetry = phase === "failed" && Boolean(state.perspectiveApplyOperation?.signature) && state.globalEditDirty;
  reset?.classList.toggle("perspective-reset-retry", resetRetry);
  if (reset) reset.textContent = resetRetry ? "Retry Reset" : "Reset";
  if (phase === "failed" || phase === "previewFailed") {
    status.post({ id: "perspective", severity: "error", message });
  } else status.clear("perspective");
  renderViewerStatus();
}

function clearPerspectiveGpuDraft() {
  state.perspectiveGpuDraft?.destroy();
  state.perspectiveGpuDraft = null;
  state.perspectiveGpuDraftPromise = null;
  state.perspectiveGpuDraftFailed = false;
  state.perspectiveDraftFrame = null;
}

function defaultPerspectiveGuides() {
  return {
    vertical: [
      { start: { x: 1 / 3, y: 0.15 }, end: { x: 1 / 3, y: 0.85 } },
      { start: { x: 2 / 3, y: 0.15 }, end: { x: 2 / 3, y: 0.85 } },
    ],
    horizontal: [
      { start: { x: 0.15, y: 1 / 3 }, end: { x: 0.85, y: 1 / 3 } },
      { start: { x: 0.15, y: 2 / 3 }, end: { x: 0.85, y: 2 / 3 } },
    ],
  };
}

function openPerspectiveMode() {
  if (!state.session || state.perspectiveMode) return;
  if (state.cropMode) closeCropMode(true);
  if (state.rotateDraftGeometry) closeRotateMode(false);
  state.perspectiveMode = true;
  state.perspectiveApplyOperation = null;
  clearPerspectiveGpuDraft();
  suspendGeometryPreviewWork();
  state.perspectiveDraftGeometry = JSON.parse(JSON.stringify(state.adjustments.shared.geometry));
  state.perspectiveGuides = defaultPerspectiveGuides();
  state.perspectiveGuidesTouched = { vertical: false, horizontal: false };
  state.perspectiveGuidesDirty = false;
  state.perspectiveTool = null;
  if (state.perspectiveFailedDraft) {
    const failed = state.perspectiveFailedDraft;
    Object.assign(state.adjustments.shared.geometry, failed.geometry);
    state.perspectiveGuides = failed.guides;
    state.perspectiveGuidesTouched = failed.touched;
    state.perspectiveGuidesDirty = failed.dirty;
    state.perspectiveTool = failed.tool;
    state.perspectiveFailedDraft = null;
  }
  if (state.gradeMode === "local") setGradeMode("global");
  setPerspectiveStatus("Unapplied perspective draft. Apply to keep it; leaving this module cancels it.", "unapplied");
  renderPerspectiveControls();
}

function geometryDraftActive() {
  return Boolean(state.perspectiveMode || state.rotateDraftGeometry);
}

function suspendGeometryPreviewWork() {
  // Retire ordinary preview work, including frames already decoding or waiting
  // on a GPU proxy, before this transaction can change the geometry.
  state.previewScheduler?.cancel();
  window.clearTimeout(state.settleTimer);
  state.settleTimer = null;
  // The coordinator cancels the in-flight tokens and any pending intent, which
  // is what makes a render already past its entry checks stop at its next
  // boundary. The serial bump retires the presentation record of one that had
  // already presented.
  state.renderCoordinator?.cancelLane("hdr", "geometry-suspend");
  state.renderCoordinator?.cancelLane("sdr", "geometry-suspend");
  state.gpuRenderSerial += 1;
  for (const lane of ["hdr", "sdr"]) {
    state.previewControllers[lane]?.abort();
    state.previewControllers[lane] = null;
  }
}

function openRotateMode() {
  if (!state.session || state.rotateDraftGeometry) return;
  state.rotateDraftGeometry = JSON.parse(JSON.stringify(state.adjustments.shared.geometry));
  state.geometryTool = "rotate";
  suspendGeometryPreviewWork();
  renderRotateDraftTransform();
  renderGeometryToolState();
}

function closePerspectiveMode(commit, { saved = false } = {}) {
  if (!state.perspectiveMode) return;
  const original = state.perspectiveDraftGeometry;
  const changed = original && !valuesEqual(original, state.adjustments.shared.geometry);
  state.perspectiveSolveController?.abort();
  state.perspectiveSolveController = null;
  state.perspectivePreviewController?.abort();
  state.perspectivePreviewController = null;
  window.clearTimeout(state.perspectivePreviewTimer);
  state.perspectivePreviewTimer = 0;
  state.perspectiveMode = false;
  clearPerspectiveGpuDraft();
  state.perspectiveTool = null;
  state.perspectiveGuideDrag = null;
  state.perspectiveGuides = null;
  state.perspectiveGuidesDirty = false;
  state.perspectiveDraftGeometry = null;
  els.perspectiveEditorOverlay?.classList.add("hidden");
  els.perspectiveEditorOverlay?.setAttribute("aria-hidden", "true");
  if (!commit && original) {
    // This module owns only its three values. Preserve independent crop/roll
    // changes made while its draft was open.
    for (const key of ["perspective_horizontal", "perspective_vertical", "perspective_rotate"]) {
      state.adjustments.shared.geometry[key] = original[key];
    }
    state.perspectiveApplyOperation = null;
    state.perspectiveFailedDraft = null;
    setPerspectiveStatus("Unapplied perspective changes cancelled.", "");
  }
  if (state.perspectivePreviewUrl) {
    URL.revokeObjectURL(state.perspectivePreviewUrl);
    state.perspectivePreviewUrl = null;
  }
  renderPerspectiveControls();
  renderControlState();
  if (commit && changed) {
    state.geometryTransformHandoffSignature = geometrySignature();
    state.geometryPresentationPending = true;
    state.gpuPreparedLane = { hdr: false, sdr: false };
    invalidatePreview("hdr", { markDirty: !saved });
    invalidatePreview("sdr", { markDirty: !saved });
    debouncePreview(state.currentView);
  } else {
    if (state.globalEditDirty || state.geometryPresentationPending) {
      debouncePreview(state.currentView);
      return;
    }
    void showCachedPreview(state.currentView).then((shown) => {
      if (!shown) debouncePreview(state.currentView);
    });
  }
}

function abandonPerspectiveDraft() {
  if (!state.perspectiveMode) return;
  const operation = state.perspectiveApplyOperation;
  if (operation?.saving) { operation.leaveRequested = true; return; }
  const failed = operation?.failed ? {
    geometry: Object.fromEntries(["perspective_horizontal", "perspective_vertical", "perspective_rotate"]
      .map((key) => [key, state.adjustments.shared.geometry[key]])),
    guides: JSON.parse(JSON.stringify(state.perspectiveGuides)),
    touched: { ...state.perspectiveGuidesTouched }, dirty: state.perspectiveGuidesDirty, tool: state.perspectiveTool,
  } : null;
  closePerspectiveMode(false);
  if (failed) {
    state.perspectiveFailedDraft = failed;
    setPerspectiveStatus("Perspective could not be applied. Reopen Perspective to retry your draft.", "failed");
  }
}

function failPerspectiveApply(operation, message) {
  operation.saving = false;
  operation.failed = true;
  setPerspectiveStatus(message, "failed");
  renderPerspectiveControls();
  if (operation.leaveRequested) abandonPerspectiveDraft();
}

function renderPerspectiveControls() {
  const geometry = state.adjustments?.shared?.geometry || defaultGeometry();
  if (els.perspectiveHorizontal) els.perspectiveHorizontal.value = String(Math.round(Number(geometry.perspective_horizontal) || 0));
  if (els.perspectiveVertical) els.perspectiveVertical.value = String(Math.round(Number(geometry.perspective_vertical) || 0));
  if (els.perspectiveRotate) els.perspectiveRotate.value = String(Number(geometry.perspective_rotate) || 0);
  if (els.perspectiveHorizontalValue) els.perspectiveHorizontalValue.textContent = `${Number(geometry.perspective_horizontal) > 0 ? "+" : ""}${Math.round(Number(geometry.perspective_horizontal) || 0)}`;
  if (els.perspectiveVerticalValue) els.perspectiveVerticalValue.textContent = `${Number(geometry.perspective_vertical) > 0 ? "+" : ""}${Math.round(Number(geometry.perspective_vertical) || 0)}`;
  if (els.perspectiveRotateValue) els.perspectiveRotateValue.textContent = `${Number(geometry.perspective_rotate) > 0 ? "+" : ""}${(Number(geometry.perspective_rotate) || 0).toFixed(1)}°`;
  // Setting .value directly (Reset, Cancel, a solved guide Apply) doesn't fire
  // the "input" event that keeps the fill-bar CSS vars attached to the handle,
  // so refresh them explicitly whenever we render from state.
  [els.perspectiveHorizontal, els.perspectiveVertical, els.perspectiveRotate].forEach((control) => {
    if (control) updateRangeVisual(control);
  });
  for (const [orientation, button] of [["vertical", els.perspectiveVerticalTool], ["horizontal", els.perspectiveHorizontalTool]]) {
    const active = state.perspectiveMode && state.perspectiveTool === orientation;
    button?.classList.toggle("active", active);
    button?.setAttribute("aria-pressed", String(active));
  }
  const saving = Boolean(state.perspectiveApplyOperation?.saving);
  if (els.perspectiveApply) els.perspectiveApply.disabled = !state.perspectiveMode || saving;
  if (els.perspectiveCancel) els.perspectiveCancel.disabled = !state.perspectiveMode || saving;
  if (els.perspectiveGuideApply) els.perspectiveGuideApply.disabled = !state.perspectiveGuidesDirty || saving;
  for (const control of [els.perspectiveHorizontal, els.perspectiveVertical, els.perspectiveRotate,
    els.perspectiveVerticalTool, els.perspectiveHorizontalTool]) {
    if (control) control.disabled = !state.session || saving;
  }
  const reset = els.groupResets.find((button) => button.dataset.resetGroup === "perspective");
  if (reset) reset.disabled = !state.session || saving;
}

function renderPerspectiveGuides() {
  const overlay = els.perspectiveEditorOverlay;
  const svg = els.perspectiveGuideSvg;
  const handles = els.perspectiveGuideHandles;
  const preview = activePreviewElement();
  const paneRect = els.previewPrimaryPane?.getBoundingClientRect();
  const imageRect = preview?.getBoundingClientRect();
  const orientation = state.perspectiveTool;
  if (!overlay || !svg || !handles || !orientation || !state.perspectiveGuides || !paneRect || !imageRect?.width || !imageRect?.height) {
    overlay?.classList.add("hidden");
    overlay?.setAttribute("aria-hidden", "true");
    return;
  }
  Object.assign(overlay.style, {
    left: `${imageRect.left - paneRect.left}px`, top: `${imageRect.top - paneRect.top}px`,
    width: `${imageRect.width}px`, height: `${imageRect.height}px`, right: "auto", bottom: "auto",
  });
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  svg.replaceChildren();
  const existingHandles = [...handles.children];
  const reuseHandles = existingHandles.length === 4
    && existingHandles.every((handle) => handle.dataset.orientation === orientation);
  if (!reuseHandles) handles.replaceChildren();
  state.perspectiveGuides[orientation].forEach((guide, guideIndex) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", `${guide.start.x * 100}%`); line.setAttribute("y1", `${guide.start.y * 100}%`);
    line.setAttribute("x2", `${guide.end.x * 100}%`); line.setAttribute("y2", `${guide.end.y * 100}%`);
    svg.append(line);
    for (const pointName of ["start", "end"]) {
      const point = guide[pointName];
      const handle = reuseHandles
        ? existingHandles[guideIndex * 2 + (pointName === "end" ? 1 : 0)]
        : document.createElement("button");
      handle.type = "button";
      handle.className = "perspective-guide-handle";
      handle.dataset.orientation = orientation;
      handle.dataset.guideIndex = String(guideIndex);
      handle.dataset.guidePoint = pointName;
      handle.style.left = `${point.x * 100}%`;
      handle.style.top = `${point.y * 100}%`;
      handle.setAttribute("aria-label", `${orientation} guide ${guideIndex + 1} ${pointName}. Use arrow keys to move; Shift moves ten pixels.`);
      if (!reuseHandles) handles.append(handle);
    }
  });
}

function beginPerspectiveGuideDrag(event) {
  const handle = event.target.closest?.(".perspective-guide-handle");
  if (!handle) return;
  event.preventDefault();
  handle.setPointerCapture?.(event.pointerId);
  state.perspectiveGuideDrag = {
    orientation: handle.dataset.orientation,
    guideIndex: Number(handle.dataset.guideIndex),
    pointName: handle.dataset.guidePoint,
    pointerId: event.pointerId,
  };
}

function movePerspectiveGuideDrag(event) {
  const drag = state.perspectiveGuideDrag;
  const rect = els.perspectiveEditorOverlay?.getBoundingClientRect();
  if (!drag || event.pointerId !== drag.pointerId || !rect?.width || !rect?.height) return;
  const point = state.perspectiveGuides?.[drag.orientation]?.[drag.guideIndex]?.[drag.pointName];
  if (!point) return;
  point.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  point.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  renderPerspectiveGuides();
}

function endPerspectiveGuideDrag(event) {
  const drag = state.perspectiveGuideDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  state.perspectiveGuideDrag = null;
  markPerspectiveGuidesDirty(drag.orientation);
}

function movePerspectiveGuideWithKeyboard(event) {
  const handle = event.target.closest?.(".perspective-guide-handle");
  if (!handle || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const rect = els.perspectiveEditorOverlay?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;
  const orientation = handle.dataset.orientation;
  const point = state.perspectiveGuides?.[orientation]?.[Number(handle.dataset.guideIndex)]?.[handle.dataset.guidePoint];
  if (!point) return;
  const pixels = event.shiftKey ? 10 : 1;
  point.x = clamp(point.x + (event.key === "ArrowLeft" ? -pixels / rect.width : event.key === "ArrowRight" ? pixels / rect.width : 0), 0, 1);
  point.y = clamp(point.y + (event.key === "ArrowUp" ? -pixels / rect.height : event.key === "ArrowDown" ? pixels / rect.height : 0), 0, 1);
  renderPerspectiveGuides();
  markPerspectiveGuidesDirty(orientation);
}

function markPerspectiveGuidesDirty(orientation) {
  state.perspectiveGuidesTouched[orientation] = true;
  state.perspectiveGuidesDirty = true;
  setPerspectiveStatus("Guide placement changed. Click Apply Guides to solve the correction.", "unapplied");
  renderPerspectiveControls();
}

async function applyPerspectiveGuides() {
  if (!state.perspectiveGuidesDirty) return true;
  return solvePerspectiveGuides();
}

function transformPerspectiveGuide(guide, matrix) {
  const start = projectivePoint(matrix, guide.start);
  const end = projectivePoint(matrix, guide.end);
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return null;
  // A safe-area crop can move an endpoint outside the corrected image. Clip
  // the segment, rather than clamping X/Y independently and bending the line.
  let near = 0;
  let far = 1;
  for (const axis of ["x", "y"]) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-12) {
      if (start[axis] < 0 || start[axis] > 1) return null;
      continue;
    }
    const a = -start[axis] / delta;
    const b = (1 - start[axis]) / delta;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  if (near > far) return null;
  const point = (t) => ({ x: clamp(start.x + t * (end.x - start.x), 0, 1),
    y: clamp(start.y + t * (end.y - start.y), 0, 1) });
  const clipped = { start: point(near), end: point(far) };
  return Math.hypot(clipped.end.x - clipped.start.x, clipped.end.y - clipped.start.y) >= 0.05
    ? clipped : null;
}

async function solvePerspectiveGuides() {
  if (!state.session || !state.perspectiveMode) return false;
  const vertical = state.perspectiveGuidesTouched.vertical ? state.perspectiveGuides.vertical : [];
  const horizontal = state.perspectiveGuidesTouched.horizontal ? state.perspectiveGuides.horizontal : [];
  if (!vertical.length && !horizontal.length) return false;
  state.perspectiveSolveController?.abort();
  const controller = new AbortController();
  state.perspectiveSolveController = controller;
  const sessionId = state.session.session_id;
  const draft = state.perspectiveDraftGeometry;
  const signature = JSON.stringify([state.adjustments.shared.geometry, state.perspectiveGuides, state.perspectiveGuidesTouched]);
  const isCurrent = () => state.perspectiveMode && state.perspectiveDraftGeometry === draft
    && state.session?.session_id === sessionId && controller === state.perspectiveSolveController
    && signature === JSON.stringify([state.adjustments.shared.geometry, state.perspectiveGuides, state.perspectiveGuidesTouched]);
  els.perspectiveStatus.textContent = "Solving guided correction…";
  const response = await fetch(`/api/session/${state.session.session_id}/perspective-solve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustments: state.adjustments, vertical_guides: vertical, horizontal_guides: horizontal, edit_revision: state.editRevision }),
    signal: controller.signal,
  }).catch(() => null);
  if (!isCurrent()) return false;
  if (!response?.ok) {
    const payload = response ? await safeJson(response) : null;
    if (!isCurrent()) return false;
    els.perspectiveStatus.textContent = responseErrorMessage(payload, "The selected guides could not be solved.");
    return false;
  }
  const solved = await response.json();
  if (!isCurrent()) return false;
  const geometry = state.adjustments.shared.geometry;
  geometry.perspective_horizontal = solved.perspective_horizontal;
  geometry.perspective_vertical = solved.perspective_vertical;
  geometry.perspective_rotate = solved.perspective_rotate;
  let guidesOutsideFrame = false;
  if (solved.guide_transform) {
    for (const orientation of ["vertical", "horizontal"]) {
      if (!state.perspectiveGuidesTouched[orientation]) continue;
      const guides = state.perspectiveGuides[orientation].map((guide) => transformPerspectiveGuide(guide, solved.guide_transform));
      if (guides.every(Boolean)) state.perspectiveGuides[orientation] = guides;
      else {
        state.perspectiveGuides[orientation] = defaultPerspectiveGuides()[orientation];
        state.perspectiveGuidesTouched[orientation] = false;
        guidesOutsideFrame = true;
      }
    }
  }
  state.perspectiveGuidesDirty = false;
  els.perspectiveStatus.textContent = `Guides aligned within ${Number(solved.residual_degrees).toFixed(2)}°.`;
  if (guidesOutsideFrame) els.perspectiveStatus.textContent += " Some guides fell outside the corrected image; place those guides again before another solve.";
  renderPerspectiveControls();
  renderPerspectiveGuides();
  schedulePerspectiveDraftPreview();
  return true;
}

async function commitPerspectiveMode() {
  if (!state.perspectiveMode || state.perspectiveApplyOperation?.saving) return false;
  const draft = state.perspectiveDraftGeometry;
  const sessionId = state.session.session_id;
  const operation = { sessionId, saving: true, signature: null };
  state.perspectiveApplyOperation = operation;
  setPerspectiveStatus("Applying perspective…", "applying");
  renderPerspectiveControls();
  if (state.perspectiveGuidesDirty && !await applyPerspectiveGuides()) {
    if (state.perspectiveApplyOperation === operation) {
      failPerspectiveApply(operation, els.perspectiveStatus.textContent || "Perspective guides could not be solved. Try again.");
    }
    return false;
  }
  if (!state.perspectiveMode || state.perspectiveDraftGeometry !== draft
    || state.session?.session_id !== sessionId || state.perspectiveApplyOperation !== operation) return false;
  const adjustments = JSON.parse(JSON.stringify(state.adjustments));
  const dirtyBefore = state.globalEditDirty;
  const generation = state.globalEditGeneration;
  state.globalEditDirty = false;
  const saved = await queueEditCommand("set_global_adjustments", { adjustments }, null,
    { globalEditGeneration: generation, refreshPreview: false });
  if (state.session?.session_id !== sessionId || state.perspectiveApplyOperation !== operation) return false;
  operation.saving = false;
  if (!saved) {
    state.globalEditDirty ||= dirtyBefore;
    failPerspectiveApply(operation, "Perspective could not be saved. Your draft is still here; try Apply again or Cancel.");
    return false;
  }
  operation.signature = geometrySignature();
  setPerspectiveStatus("Perspective saved. Preparing the corrected preview…", "applying");
  closePerspectiveMode(true, { saved: true });
  // A no-change Apply needs no new frame; an already accepted matching one
  // can complete immediately. Changed geometry completes in acceptPresentation.
  finishPerspectivePresentation();
  return true;
}

function finishPerspectivePresentation() {
  const operation = state.perspectiveApplyOperation;
  const accepted = state.acceptedPresentation;
  if (!operation || operation.saving || !operation.signature || state.perspectiveMode
    || operation.sessionId !== state.session?.session_id || operation.signature !== geometrySignature()) return;
  if (accepted?.lane === state.currentView && accepted.geometrySignature === operation.signature
    && accepted.generation === state.previewGeneration[state.currentView] && accepted.exact) {
    state.perspectiveApplyOperation = null;
    setPerspectiveStatus("Perspective applied.", "applied");
  }
}

function schedulePerspectiveDraftPreview() {
  window.clearTimeout(state.perspectivePreviewTimer);
  // A warm GPU draft draws on the next frame. CPU fallback stays debounced.
  state.perspectivePreviewTimer = window.setTimeout(renderPerspectiveDraftPreview,
    state.gpuPreview?.available && state.renderingMode !== "cpu" ? 0 : 90);
}

function perspectiveDraftLongEdge() {
  // Keep the reusable GPU base and CPU fallback bounded during the draft.
  // Apply renders the authoritative graph at the selected authoring tier.
  return Math.min(previewTargetLongEdge(), 1024);
}

async function renderPerspectiveGpuDraft() {
  const draft = state.perspectiveDraftGeometry;
  const sessionId = state.session.session_id;
  const lane = state.currentView;
  const signature = geometrySignature();
  const isCurrent = () => state.perspectiveMode && state.perspectiveDraftGeometry === draft
    && state.session?.session_id === sessionId && state.currentView === lane;
  try {
    if (!state.perspectiveGpuDraft && !state.perspectiveGpuDraftPromise) {
      if (!state.perspectiveApplyOperation?.saving) setPerspectiveStatus("Preparing the GPU perspective draft…", "preparing");
      state.perspectiveGpuDraftPromise = window.HDRPerspectiveDraft.prepare(state.gpuPreview,
        sessionId, lane, state.adjustments, sampleCurvePoints, perspectiveDraftLongEdge(),
        state.compareWithoutLocals ? [] : JSON.parse(JSON.stringify(localAdjustments())), state.editRevision,
        projectReferenceWhiteNits(), state.session.source, isCurrent).then((prepared) => {
          if (!isCurrent()) { prepared?.destroy(); return null; }
          state.perspectiveGpuDraft = prepared;
          return prepared;
        });
    }
    const prepared = state.perspectiveGpuDraft || await state.perspectiveGpuDraftPromise;
    if (!isCurrent() || signature !== geometrySignature()) return true;
    if (!prepared) { state.perspectiveGpuDraftFailed = true; return false; }
    const result = prepared.draw(state.adjustments.shared.geometry, els.previewCanvas);
    if (!result) { clearPerspectiveGpuDraft(); state.perspectiveGpuDraftFailed = true; return false; }
    state.perspectiveDraftFrame = { ...result, signature: geometrySignature() };
    els.previewImage.style.display = "none";
    els.previewCanvas.style.display = "block";
    els.emptyState.style.display = "none";
    setGpuSurfaceHdr(lane, result.hdr);
    setZoomMode(state.zoomMode);
    syncOverlayPlacement();
    hidePreviewMessage();
    renderPerspectiveGuides();
    renderControlState();
    if (!state.perspectiveApplyOperation?.saving) {
      setPerspectiveStatus("GPU perspective draft. Apply to keep it; leaving this module cancels it.", "unapplied");
    }
    return true;
  } catch (error) {
    if (!isCurrent()) return true;
    console.warn("Perspective GPU draft unavailable; using CPU preview.", error);
    clearPerspectiveGpuDraft();
    state.perspectiveGpuDraftFailed = true;
    return false;
  }
}

async function renderPerspectiveDraftPreview() {
  if (!state.session || !state.perspectiveMode) return;
  if (state.gpuPreview?.available && state.renderingMode !== "cpu" && !state.perspectiveGpuDraftFailed) {
    if (await renderPerspectiveGpuDraft() || !state.perspectiveMode) return;
  }
  state.perspectivePreviewController?.abort();
  const controller = new AbortController();
  state.perspectivePreviewController = controller;
  const sessionId = state.session.session_id;
  const lane = state.currentView;
  const signature = JSON.stringify(state.adjustments.shared.geometry);
  const isCurrent = () => state.perspectiveMode && controller === state.perspectivePreviewController
    && state.session?.session_id === sessionId && state.currentView === lane
    && signature === JSON.stringify(state.adjustments.shared.geometry);
  let response;
  try {
    response = await fetch(`/api/session/${state.session.session_id}/preview/${state.currentView}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adjustments: state.adjustments,
        transient_adjustments: true,
        edit_revision: state.editRevision,
        include_locals: !state.compareWithoutLocals,
        local_adjustments: state.compareWithoutLocals ? [] : localAdjustments(),
        long_edge: perspectiveDraftLongEdge(),
        hdr_display: mediaQueryMatch("(dynamic-range: high)"),
        tier: "interactive",
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError" || !isCurrent()) return;
    console.error(error);
    setPerspectiveStatus(error?.message || "Perspective preview failed.", "previewFailed");
    return;
  }
  if (!response || !isCurrent()) return;
  if (!response.ok) {
    const payload = await safeJson(response);
    if (!isCurrent()) return;
    setPerspectiveStatus(responseErrorMessage(payload, "Perspective preview failed."), "previewFailed");
    return;
  }
  const blob = await response.blob();
  if (!isCurrent()) return;
  const url = URL.createObjectURL(blob);
  const applied = await applyPreviewUrl(url, isCurrent);
  if (!applied) { URL.revokeObjectURL(url); return; }
  const previous = state.perspectivePreviewUrl;
  state.perspectivePreviewUrl = url;
  if (previous) URL.revokeObjectURL(previous);
  if (!state.perspectiveApplyOperation?.saving) {
    setPerspectiveStatus("Perspective draft (CPU preview). Apply to keep it; leaving this module cancels it.", "unapplied");
  }
  renderPerspectiveGuides();
  renderControlState();
  void ensureGeometryCoordinateMap();
}

function openCropMode() {
  if (!state.session || state.cropMode) return;
  state.geometryTool = "crop";
  state.cropMode = true;
  state.cropDraftGeometry = JSON.parse(JSON.stringify(state.adjustments.shared.geometry));
  state.cropEditBaseCrop = { ...state.cropDraftGeometry.crop };
  // The preview already represents the committed crop. Author the next frame
  // relative to that visible image, then compose it back into source space on
  // Apply; reusing source-relative coordinates here double-crops the frame.
  state.cropDraftGeometry.crop = { x: 0, y: 0, width: 1, height: 1 };
  els.cropEditorOverlay?.classList.remove("hidden");
  els.cropEditorOverlay?.setAttribute("aria-hidden", "false");
  renderGeometryToolState();
  renderCropOptions();
  void ensureGeometryCoordinateMap();
}

function responseErrorMessage(payload, fallback) {
  return projectIo.responseErrorMessage(payload, fallback);
}

function closeCropMode(commit) {
  if (!state.cropMode) return;
  const draft = state.cropDraftGeometry;
  const baseCrop = state.cropEditBaseCrop;
  state.cropMode = false;
  state.cropDraftGeometry = null;
  state.cropEditBaseCrop = null;
  state.cropDrag = null;
  state.geometryTool = null;
  els.cropEditorOverlay?.classList.add("hidden");
  els.cropEditorOverlay?.setAttribute("aria-hidden", "true");
  if (commit && draft) {
    if (baseCrop) {
      draft.crop = {
        x: baseCrop.x + draft.crop.x * baseCrop.width,
        y: baseCrop.y + draft.crop.y * baseCrop.height,
        width: draft.crop.width * baseCrop.width,
        height: draft.crop.height * baseCrop.height,
      };
    }
    state.adjustments.shared.geometry = JSON.parse(JSON.stringify(draft));
    // Crop can be committed while a preceding rotation is still represented
    // by a CSS transform on the old bitmap. Carry that atomic handoff forward
    // to the combined rotation + crop signature; otherwise edit-state sync
    // clears the transform before the matching geometry proxy is ready.
    if (state.geometryTransformHandoffSignature) {
      state.geometryTransformHandoffSignature = geometrySignature();
    }
    // Keep the mounted, pre-crop frame at its current display geometry until a
    // frame for the committed crop is actually presented. Recomputing zoom in
    // this gap uses stale bitmap dimensions and produces a brief zoom jump.
    state.geometryPresentationPending = true;
  }
  syncControlsFromState();
  renderGeometryToolState();
  renderLocalAdjustments();
  if (commit && draft) {
    state.gpuPreparedLane = { hdr: false, sdr: false };
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  }
}

function renderGeometryToolState() {
  const cropActive = state.geometryTool === "crop";
  const rotateActive = state.geometryTool === "rotate";
  els.cropToolToggle?.classList.toggle("active", cropActive);
  els.cropToolToggle?.setAttribute("aria-pressed", String(cropActive));
  els.rotateToolToggle?.classList.toggle("active", rotateActive);
  els.rotateToolToggle?.setAttribute("aria-pressed", String(rotateActive));
  els.cropToolSettings?.classList.toggle("hidden", !cropActive);
  els.rotateToolSettings?.classList.toggle("hidden", !rotateActive);
}

function beginStraightenGesture(event = null) {
  if (event?.type === "keydown" && !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
  if (!state.session || state.straightenGestureActive) return;
  state.straightenGestureActive = true;
  if (state.straightenPreviewBaseAngle === null) {
    state.straightenPreviewBaseAngle = Number(state.adjustments.shared.geometry.straighten_angle) || 0;
  }
  showStraightenGrid();
  if (state.rotateDraftGeometry) {
    // The scheduler deliberately retains its last task so ordinary controls
    // can request another settled pass on pointer-up. Straighten is owned by
    // the rotate transaction, so discard that resident task before it can be
    // re-armed with unapplied geometry.
    state.previewScheduler?.cancel();
    window.clearTimeout(state.settleTimer);
    state.settleTimer = null;
  }
  // Make any older authoritative geometry response stale without scheduling a
  // replacement until this gesture finishes.
  if (!state.rotateDraftGeometry) {
    invalidatePreview("hdr");
    invalidatePreview("sdr");
  }
}

function updateStraightenInteractive(value) {
  if (!state.session) return;
  if (!state.straightenGestureActive) beginStraightenGesture();
  const angle = clamp(Number(value) || 0, -45, 45);
  state.adjustments.shared.geometry.straighten_angle = angle;
  syncRangeControlFromState("shared.geometry.straighten_angle", els.cropStraighten);
  updateControlReadouts();
  renderControlState();
  const delta = angle - (state.straightenPreviewBaseAngle ?? angle);
  // Keep the image at its current viewer scale while the user straightens it.
  // The fixed grid is the authoring reference and the image moves behind it;
  // the authoritative render applies the largest valid-pixel crop on release.
  // Scaling to cover the old frame here made portrait images appear to zoom by
  // 25% or more and did not match the backend's variable-aspect safe crop.
  [els.previewImage, els.previewCanvas, els.previewOverlay, els.localMaskOverlay, els.chromeProofImage].forEach((preview) => {
    preview?.style.setProperty("--interactive-straighten-angle", `${-delta}deg`);
    preview?.style.setProperty("--interactive-straighten-scale", "1");
    if (preview) preview.style.clipPath = "";
  });
}

function finishStraightenGesture() {
  if (!state.straightenGestureActive) return;
  state.straightenGestureActive = false;
  hideStraightenGrid();
  if (!state.rotateDraftGeometry) {
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  } else {
    // A settled frame that was already in flight may present immediately after
    // pointer-up. Reassert the transaction's visual transform until Apply or
    // Cancel resolves the draft.
    renderRotateDraftTransform();
  }
}

function showStraightenGrid() {
  const canvas = els.straightenGridOverlay;
  const preview = activePreviewElement();
  const paneRect = els.previewPrimaryPane?.getBoundingClientRect();
  const imageRect = preview?.getBoundingClientRect();
  if (!canvas || !paneRect || !imageRect?.width || !imageRect?.height) return;
  state.straightenPreviewFrameRect = {
    left: imageRect.left,
    top: imageRect.top,
    width: imageRect.width,
    height: imageRect.height,
  };
  Object.assign(canvas.style, {
    left: `${imageRect.left - paneRect.left}px`,
    top: `${imageRect.top - paneRect.top}px`,
    width: `${imageRect.width}px`,
    height: `${imageRect.height}px`,
  });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(imageRect.width * dpr));
  canvas.height = Math.max(1, Math.round(imageRect.height * dpr));
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  const drawLines = (strokeStyle, lineWidth) => {
    context.beginPath();
    for (let index = 1; index < 6; index += 1) {
      const x = Math.round(canvas.width * index / 6) + 0.5;
      const y = Math.round(canvas.height * index / 6) + 0.5;
      context.moveTo(x, 0); context.lineTo(x, canvas.height);
      context.moveTo(0, y); context.lineTo(canvas.width, y);
    }
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth * dpr;
    context.stroke();
  };
  drawLines("rgba(0, 0, 0, .78)", 2.5);
  drawLines("rgba(255, 255, 255, .88)", 1);
  const drawBorder = (strokeStyle, lineWidth) => {
    const inset = lineWidth * dpr / 2;
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth * dpr;
    context.strokeRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2);
  };
  drawBorder("rgba(0, 0, 0, .9)", 4);
  drawBorder("rgba(255, 255, 255, .95)", 1.5);
  canvas.classList.remove("hidden");
}

function hideStraightenGrid() {
  els.straightenGridOverlay?.classList.add("hidden");
}

function clearInteractiveStraightenPreview() {
  if (state.straightenGestureActive || state.straightenPreviewBaseAngle === null) return;
  // A committed rotation can still be represented by a transform on the old
  // bitmap while its authoritative frame is rendering. Clearing straighten
  // here would partially dismantle that atomic geometry handoff.
  if (state.geometryTransformHandoffSignature) return;
  if (state.rotateDraftGeometry) {
    renderRotateDraftTransform();
    return;
  }
  state.straightenPreviewBaseAngle = null;
  state.straightenPreviewFrameRect = null;
  [els.previewImage, els.previewCanvas, els.previewOverlay, els.localMaskOverlay, els.chromeProofImage].forEach((preview) => {
    preview?.style.removeProperty("--interactive-straighten-angle");
    preview?.style.removeProperty("--interactive-straighten-scale");
    if (preview) preview.style.clipPath = "";
  });
}

function rotateGeometry(delta) {
  const geometry = state.adjustments.shared.geometry;
  geometry.rotation = (geometry.rotation + delta + 360) % 360;
  geometry.crop = { x: 0, y: 0, width: 1, height: 1 };
  syncControlsFromState();
  renderRotateDraftTransform({ reflow: true });
  renderGeometryResetState();
  if (!state.rotateDraftGeometry) {
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  }
}

function updateRotateDraft(key) {
  if (!state.rotateDraftGeometry) return;
  state.adjustments.shared.geometry[key] = !state.adjustments.shared.geometry[key];
  syncControlsFromState();
  renderRotateDraftTransform();
  renderControlState();
}

function renderRotateDraftTransform({ reflow = false } = {}) {
  if (!state.rotateDraftGeometry) return;
  const original = state.rotateDraftGeometry;
  const current = state.adjustments.shared.geometry;
  const visualBase = original;
  const delta = ((Number(current.rotation) || 0) - (Number(visualBase.rotation) || 0) + 360) % 360;
  const flipX = Boolean(current.flip_horizontal) === Boolean(visualBase.flip_horizontal) ? 1 : -1;
  const flipY = Boolean(current.flip_vertical) === Boolean(visualBase.flip_vertical) ? 1 : -1;
  const straightenDelta = (Number(current.straighten_angle) || 0) - (Number(visualBase.straighten_angle) || 0);
  const neutralDraft = delta === 0 && flipX === 1 && flipY === 1 && Math.abs(straightenDelta) < 1e-9;
  if (neutralDraft && !state.geometryTransformHandoffSignature) {
    clearRotateDraftTransformProperties();
    if (reflow) applyZoomGeometry();
    return;
  }
  [els.previewImage, els.previewCanvas, els.chromeProofImage].forEach((preview) => {
    preview?.style.setProperty("--interactive-rotate-angle", `${delta}deg`);
    preview?.style.setProperty("--interactive-flip-x", String(flipX));
    preview?.style.setProperty("--interactive-flip-y", String(flipY));
    preview?.style.setProperty("--interactive-straighten-angle", `${-straightenDelta}deg`);
    preview?.style.setProperty("--interactive-straighten-scale", "1");
    if (preview) preview.style.clipPath = "";
  });
  applySourceOverlayGeometryTransform(original, current);
  // Quarter-turn buttons change the draft's layout bounds and need a fit
  // recalculation. Straighten and flip only move the already-sized bitmap; a
  // recalculation on pointer release would size from the proxy rather than the
  // source frame and make the image appear to zoom far out.
  if (reflow) applyZoomGeometry();
}

function applySourceOverlayGeometryTransform(original, current) {
  const delta = ((Number(current.rotation) || 0) - (Number(original.rotation) || 0) + 360) % 360;
  const flipX = Boolean(current.flip_horizontal) === Boolean(original.flip_horizontal) ? 1 : -1;
  const flipY = Boolean(current.flip_vertical) === Boolean(original.flip_vertical) ? 1 : -1;
  const straightenDelta = (Number(current.straighten_angle) || 0) - (Number(original.straighten_angle) || 0);
  [els.previewOverlay, els.localMaskOverlay].forEach((overlay) => {
    overlay?.style.setProperty("--interactive-rotate-angle", `${delta}deg`);
    overlay?.style.setProperty("--interactive-flip-x", String(flipX));
    overlay?.style.setProperty("--interactive-flip-y", String(flipY));
    overlay?.style.setProperty("--interactive-straighten-angle", `${-straightenDelta}deg`);
    overlay?.style.setProperty("--interactive-straighten-scale", "1");
    if (overlay) overlay.style.clipPath = "";
  });
}

function clearRotateDraftTransformProperties() {
  [els.previewImage, els.previewCanvas, els.previewOverlay, els.localMaskOverlay, els.chromeProofImage].forEach((preview) => {
    preview?.style.removeProperty("--interactive-rotate-angle");
    preview?.style.removeProperty("--interactive-flip-x");
    preview?.style.removeProperty("--interactive-flip-y");
    preview?.style.removeProperty("--interactive-straighten-angle");
    preview?.style.removeProperty("--interactive-straighten-scale");
    if (preview) preview.style.clipPath = "";
  });
}

function closeRotateMode(commit) {
  if (!state.rotateDraftGeometry) return;
  const original = state.rotateDraftGeometry;
  const changed = !valuesEqual(original, state.adjustments.shared.geometry);
  state.rotateDraftGeometry = null;
  state.straightenGestureActive = false;
  hideStraightenGrid();
  state.geometryTool = null;
  if (!commit) state.adjustments.shared.geometry = original;
  // If the current bitmap is still the pre-rotation frame, keep its draft
  // transform in place until the matching authoritative frame presents. This
  // prevents Rotate -> Crop from visibly undoing and then redoing rotation
  // while Crop waits for the committed geometry render.
  if (commit && changed) {
    state.geometryTransformHandoffSignature = geometrySignature();
    // The mounted bitmap still represents the geometry from before this
    // transaction. Keep both its CSS size and visual transform atomic until a
    // frame for the committed geometry is actually accepted. This also stops
    // an unrelated adjustment made during the handoff from exposing the old
    // pre-rotation bitmap.
    state.geometryPresentationPending = true;
  } else {
    state.geometryTransformHandoffSignature = null;
    clearRotateDraftTransformProperties();
    clearInteractiveStraightenPreview();
    applyZoomGeometry();
  }
  syncControlsFromState();
  renderGeometryToolState();
  renderControlState();
  if (commit && changed) {
    state.gpuPreparedLane = { hdr: false, sdr: false };
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  } else if (state.globalEditDirty || state.geometryPresentationPending) {
    debouncePreview(state.currentView);
  }
}

function renderCropOptions() {
  if (!els.cropGuide) return;
  const geometry = activeCropGeometry();
  els.cropGuide.value = state.cropGuide;
  els.cropGridDensity.value = String(state.cropGridDensity);
  els.cropGridDensityValue.textContent = `${state.cropGridDensity}\u00d7${state.cropGridDensity}`;
  els.cropGridDensityRow.classList.toggle("hidden", state.cropGuide !== "grid");
  els.cropRatio.value = geometry.ratio_mode;
  els.cropCustomRatioWidth.value = String(geometry.custom_ratio.width);
  els.cropCustomRatioHeight.value = String(geometry.custom_ratio.height);
  els.customRatioFields?.classList.toggle("hidden", geometry.ratio_mode !== "custom");
  renderCropFrame();
}

function renderCropFrame() {
  if (!state.cropMode || !els.cropBox) return;
  const crop = activeCropGeometry().crop;
  Object.assign(els.cropBox.style, { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` });
  requestAnimationFrame(drawCropGuide);
}

function activeCropGeometry() {
  return state.cropMode && state.cropDraftGeometry
    ? state.cropDraftGeometry
    : state.adjustments.shared.geometry;
}

function isCropDraftControl(path) {
  return path === "shared.geometry.ratio_mode" || path?.startsWith("shared.geometry.custom_ratio.");
}

function updateCropDraftControl(path, value) {
  if (!state.cropDraftGeometry) return;
  const relativePath = path.replace("shared.geometry.", "");
  setValueByPath(state.cropDraftGeometry, relativePath, value);
  if (relativePath.startsWith("custom_ratio.")) {
    const key = relativePath.endsWith("width") ? "width" : "height";
    state.cropDraftGeometry.custom_ratio[key] = Math.max(0.01, Number(value) || 0.01);
  }
  renderCropOptions();
  constrainCropToRatio();
  renderGeometryResetState();
}

function cropAspectRatio() {
  return geometryMath.cropAspectRatio(activeCropGeometry(), state.session?.source);
}

function cropAuthoringFrameAspect() {
  const geometry = activeCropGeometry();
  const map = currentGeometryCoordinateMap();
  if (map?.fullOutputWidth && map?.fullOutputHeight) return map.fullOutputWidth / map.fullOutputHeight;
  const source = state.session?.source;
  if (!source?.width || !source?.height) {
    return Math.max(0.01, els.cropEditorOverlay.clientWidth / Math.max(1, els.cropEditorOverlay.clientHeight));
  }
  let width = Number(source.width);
  let height = Number(source.height);
  if ([90, 270].includes(geometry.rotation)) [width, height] = [height, width];
  const angle = Math.abs((Number(geometry.straighten_angle) || 0) + (Number(geometry.perspective_rotate) || 0)) * Math.PI / 180;
  const sine = Math.abs(Math.sin(angle));
  const cosine = Math.abs(Math.cos(angle));
  if (sine >= 1e-9) {
    const widthIsLonger = width >= height;
    const sideLong = widthIsLonger ? width : height;
    const sideShort = widthIsLonger ? height : width;
    let safeWidth;
    let safeHeight;
    if (sideShort <= 2 * sine * cosine * sideLong || Math.abs(sine - cosine) < 1e-9) {
      const halfShort = 0.5 * sideShort;
      safeWidth = widthIsLonger ? halfShort / sine : halfShort / cosine;
      safeHeight = widthIsLonger ? halfShort / cosine : halfShort / sine;
    } else {
      const cosineDouble = cosine * cosine - sine * sine;
      safeWidth = (width * cosine - height * sine) / cosineDouble;
      safeHeight = (height * cosine - width * sine) / cosineDouble;
    }
    width = Math.max(1, Math.floor(Math.abs(safeWidth)) - 4);
    height = Math.max(1, Math.floor(Math.abs(safeHeight)) - 4);
  }
  const baseCrop = state.cropEditBaseCrop || geometry.crop || { width: 1, height: 1 };
  return Math.max(0.01, (width * baseCrop.width) / Math.max(1e-6, height * baseCrop.height));
}

function sourcePixelFrameDimensions(geometry = state.adjustments?.shared?.geometry) {
  const source = state.session?.source;
  // Not the map of the current processing size: a zoom changes that size, and
  // until its own map arrived the frame fell back to arithmetic that knows
  // nothing of perspective, so the picture was laid out at the wrong size and
  // jumped when the map landed.
  const map = geometryFullOutputFrames.get(`${state.session?.session_id || "none"}:${JSON.stringify(geometry)}`);
  return geometryMath.sourcePixelFrameDimensions(source, geometry, map);
}

/**
 * Source long edge over the long edge of the frame a geometry produces.
 *
 * Mask radii (luma feather) are fractions of the uncropped source, because
 * the backend builds every mask in source space and crops it afterwards. The
 * GPU draws its masks in the cropped, straightened frame, so it scales them by
 * this ratio: 2 under a 50% crop.
 */
function maskFeatherReferenceScale(signature) {
  const source = state.session?.source;
  let geometry = null;
  try { geometry = JSON.parse(signature); } catch { return 1; }
  const frame = sourcePixelFrameDimensions(geometry);
  if (!source?.width || !source?.height || !frame) return 1;
  return Math.max(source.width, source.height) / Math.max(frame.width, frame.height);
}

function constrainCropToRatio() {
  const ratio = cropAspectRatio();
  if (!ratio) return renderCropFrame();
  const crop = activeCropGeometry().crop;
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  const normalizedRatio = ratio / cropAuthoringFrameAspect();
  let width = crop.width;
  let height = width / normalizedRatio;
  if (height > crop.height) {
    height = crop.height;
    width = height * normalizedRatio;
  }
  const scale = Math.min(1, 1 / Math.max(width, height));
  width *= scale;
  height *= scale;
  crop.width = Math.max(0.02, width);
  crop.height = Math.max(0.02, height);
  crop.x = clamp(centerX - crop.width / 2, 0, 1 - crop.width);
  crop.y = clamp(centerY - crop.height / 2, 0, 1 - crop.height);
  renderCropFrame();
}

function beginCropDrag(event) {
  if (!state.cropMode || event.button !== 0) return;
  event.preventDefault();
  const rect = els.cropEditorOverlay.getBoundingClientRect();
  state.cropDrag = { handle: event.target.dataset.cropHandle || "move", startX: event.clientX, startY: event.clientY, rect, crop: { ...activeCropGeometry().crop } };
  els.cropBox.setPointerCapture?.(event.pointerId);
}

function moveCropDrag(event) {
  const drag = state.cropDrag;
  if (!drag) return;
  const dx = (event.clientX - drag.startX) / Math.max(1, drag.rect.width);
  const dy = (event.clientY - drag.startY) / Math.max(1, drag.rect.height);
  const next = { ...drag.crop };
  if (drag.handle === "move") {
    next.x = Math.max(0, Math.min(1 - next.width, drag.crop.x + dx));
    next.y = Math.max(0, Math.min(1 - next.height, drag.crop.y + dy));
  } else {
    if (drag.handle.includes("w")) { const right = drag.crop.x + drag.crop.width; next.x = Math.max(0, Math.min(right - 0.02, drag.crop.x + dx)); next.width = right - next.x; }
    if (drag.handle.includes("e")) next.width = Math.max(0.02, Math.min(1 - drag.crop.x, drag.crop.width + dx));
    if (drag.handle.includes("n")) { const bottom = drag.crop.y + drag.crop.height; next.y = Math.max(0, Math.min(bottom - 0.02, drag.crop.y + dy)); next.height = bottom - next.y; }
    if (drag.handle.includes("s")) next.height = Math.max(0.02, Math.min(1 - drag.crop.y, drag.crop.height + dy));
    const ratio = cropAspectRatio();
    if (ratio) constrainDraggedCrop(next, drag, ratio);
  }
  if (!state.cropDraftGeometry) return;
  state.cropDraftGeometry.crop = next;
  renderCropFrame();
  renderGeometryResetState();
}

function endCropDrag() { state.cropDrag = null; }

function constrainDraggedCrop(next, drag, ratio) {
  const normalizedRatio = ratio / cropAuthoringFrameAspect();
  const source = drag.crop;
  const anchorX = drag.handle.includes("w") ? source.x + source.width : source.x;
  const anchorY = drag.handle.includes("n") ? source.y + source.height : source.y;
  let width = next.width;
  let height = width / normalizedRatio;
  if (!drag.handle.includes("e") && !drag.handle.includes("w")) {
    height = next.height;
    width = height * normalizedRatio;
  }
  width = Math.max(0.02, Math.min(width, drag.handle.includes("w") ? anchorX : 1 - anchorX));
  height = Math.max(0.02, Math.min(height, drag.handle.includes("n") ? anchorY : 1 - anchorY));
  if (height * normalizedRatio > width) height = width / normalizedRatio;
  else width = height * normalizedRatio;
  next.width = width;
  next.height = height;
  next.x = drag.handle.includes("w") ? anchorX - width : anchorX;
  next.y = drag.handle.includes("n") ? anchorY - height : anchorY;
}

function drawCropGuide() {
  if (!state.cropMode || !els.cropGuideCanvas) return;
  const canvas = els.cropGuideCanvas;
  const width = Math.max(1, Math.round(els.cropBox.clientWidth * (window.devicePixelRatio || 1)));
  const height = Math.max(1, Math.round(els.cropBox.clientHeight * (window.devicePixelRatio || 1)));
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height); context.strokeStyle = "rgba(255,255,255,.82)"; context.lineWidth = window.devicePixelRatio || 1;
  const line = (x1, y1, x2, y2) => { context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke(); };
  if (state.cropGuide === "x") { line(0, 0, width, height); line(width, 0, 0, height); return; }
  if (state.cropGuide === "diagonals") {
    const short = Math.min(width, height);
    line(0, 0, short, short); line(width, 0, width - short, short);
    line(0, height, short, height - short); line(width, height, width - short, height - short);
    return;
  }
  let positions = [];
  if (state.cropGuide === "thirds") positions = [1 / 3, 2 / 3];
  if (state.cropGuide === "golden") positions = [0.382, 0.618];
  if (state.cropGuide === "grid") positions = Array.from({ length: state.cropGridDensity - 1 }, (_, index) => (index + 1) / state.cropGridDensity);
  positions.forEach((position) => { line(position * width, 0, position * width, height); line(0, position * height, width, position * height); });
}

function cropRotateGeometryModified(geometry, defaults) {
  return controlGroups.geometry.some((path) => {
    const key = path.split(".").pop();
    return !valuesEqual(geometry?.[key], defaults[key]);
  });
}

function renderGeometryResetState(defaults = defaultAdjustments()) {
  const geometryReset = els.groupResets.find((button) => button.dataset.resetGroup === "geometry");
  if (!geometryReset) return;
  const hasDraft = Boolean(state.cropDraftGeometry || state.rotateDraftGeometry);
  const displayedGeometry = state.cropDraftGeometry || state.adjustments.shared.geometry;
  const geometryModified = cropRotateGeometryModified(displayedGeometry, defaults.shared.geometry)
    || Boolean(state.rotateDraftGeometry && cropRotateGeometryModified(state.adjustments.shared.geometry, defaults.shared.geometry));
  geometryReset.closest(".control-group")?.classList.toggle("modified", geometryModified);
  geometryReset.disabled = !hasDraft && !geometryModified;
  geometryReset.title = "Reset all Crop & Rotate values";
  geometryReset.setAttribute("aria-label", "Reset all Crop & Rotate values");
}

// Black-and-white film has one silver layer and so no color grain.
