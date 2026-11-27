function renderCurveChannelTabs() {
  els.curveChannelButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.curveChannel === state.selectedCurveChannel);
  });
}

function bindCurveEditor() {
  const canvas = els.curveEditor;
  const beginDrag = (startEvent, pointIndex) => {
    if (!state.session) return;
    const { clientX, clientY, pointerId } = startEvent;
    state.previewScheduler?.beginInteraction();
    state.activeCurvePoint = pointIndex;
    state.selectedCurvePoint = state.activeCurvePoint;
    const dragOrigin = {
      clientX,
      clientY,
      point: [...currentCurveValues()[state.activeCurvePoint]],
    };
    const pointerDelta = createPrecisionPointerDelta(startEvent);
    let dragged = false;
    drawCurveEditor();
    let stopped = false;
    if (pointerId !== null && canvas.setPointerCapture) {
      try { canvas.setPointerCapture(pointerId); } catch {}
    }
    const move = (event) => {
      if (pointerId !== null && event.pointerId !== pointerId) return;
      event.preventDefault();
      dragged ||= Math.hypot(event.clientX - clientX, event.clientY - clientY) >= 3;
      if (!dragged) return;
      const delta = pointerDelta.update(event);
      updateCurveFromPointer(clientX + delta.x, clientY + delta.y, dragOrigin);
    };
    const stop = (event) => {
      if (stopped || (pointerId !== null && event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
      stopped = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      canvas.removeEventListener("lostpointercapture", stop);
      if (pointerId !== null && canvas.hasPointerCapture?.(pointerId)) {
        try { canvas.releasePointerCapture(pointerId); } catch {}
      }
      state.activeCurvePoint = null;
      drawCurveEditor();
      syncCurveControlsFromState();
      invalidatePreview(state.currentView);
      renderControlState();
      debouncePreview(state.currentView);
      state.previewScheduler?.endInteraction();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    canvas.addEventListener("lostpointercapture", stop);
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.session) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const pointIndex = curvePointIndexAtPointer(event.clientX, event.clientY, rect);
    if (pointIndex !== null) {
      beginDrag(event, pointIndex);
      return;
    }
    const curveHit = curveHitAtPointer(event.clientX, event.clientY, rect);
    if (!curveHit) return;
    const insertedIndex = addCurvePoint(curveHit.x);
    if (insertedIndex === null) return;
    beginDrag(event, insertedIndex);
  });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!state.session) return;
    const pointIndex = curvePointIndexAtPointer(event.clientX, event.clientY, canvas.getBoundingClientRect());
    if (pointIndex === null || isLockedCurveEndpoint(pointIndex)) return;
    state.selectedCurvePoint = pointIndex;
    removeCurvePoint(pointIndex);
    drawCurveEditor();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
  canvas.addEventListener("keydown", (event) => {
    const curve = currentCurveValues();
    const index = state.selectedCurvePoint ?? Math.floor(curve.length / 2);
    if (event.key === "Enter") {
      event.preventDefault();
      addCurvePoint();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeCurvePoint();
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const point = [...curve[index]];
      const step = event.ctrlKey ? 0.001 : 0.01;
      if (event.key === "ArrowLeft" && !isLockedCurveEndpoint(index)) {
        point[0] = clamp(point[0] - step, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
      }
      if (event.key === "ArrowRight" && !isLockedCurveEndpoint(index)) {
        point[0] = clamp(point[0] + step, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
      }
      if (event.key === "ArrowUp") point[1] = clamp(point[1] + step, 0, 1);
      if (event.key === "ArrowDown") point[1] = clamp(point[1] - step, 0, 1);
      curve[index] = point;
      setCurveValues(state.selectedCurveChannel, curve);
    } else {
      return;
    }
    drawCurveEditor();
    syncCurveControlsFromState();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
}

function updateCurveFromPointer(clientX, clientY, dragOrigin = null) {
  const rect = els.curveEditor.getBoundingClientRect();
  const index = state.activeCurvePoint;
  if (index === null) return;
  const curve = currentCurveValues();
  const point = [...curve[index]];
  const layout = curveEditorLayout();
  const direct = curvePointerPosition(clientX, clientY, rect);
  const directX = direct.x;
  const directY = direct.y;
  const normalizedX = dragOrigin
    ? dragOrigin.point[0] + (clientX - dragOrigin.clientX) / Math.max(rect.width - layout.left - layout.right, 1)
    : directX;
  const normalizedY = dragOrigin
    ? dragOrigin.point[1] - (clientY - dragOrigin.clientY) / Math.max(rect.height - layout.top - layout.bottom, 1)
    : directY;
  if (index === 0) point[0] = 0;
  else if (index === curve.length - 1) point[0] = 1;
  else point[0] = clamp(normalizedX, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
  point[1] = clamp(normalizedY, 0, 1);
  curve[index] = point;
  state.selectedCurvePoint = index;
  setCurveValues(state.selectedCurveChannel, curve);
  drawCurveEditor();
  invalidatePreview(state.currentView);
  debouncePreview(state.currentView);
}

function drawCurveEditor() {
  const canvas = els.curveEditor;
  const surface = resizeCanvasSurface(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  const layout = curveEditorLayout();
  const plotLeft = layout.left;
  const plotTop = layout.top;
  const plotRight = width - layout.right;
  const plotBottom = height - layout.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const curve = currentCurveValues();
  const curveSamples = sampleCurvePoints(curve, 96);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = uiToken("--viewer");
  ctx.fillRect(plotLeft, plotTop, plotWidth, plotHeight);

  if (currentCurveLane() === "hdr") {
    drawCurveExposureBands(ctx, layout, width, height);
  } else {
    const white = plotLeft + curveDomainEncode(CURVE_SDR_WHITE) * plotWidth;
    ctx.fillStyle = uiToken("--scope-guide-line");
    ctx.fillRect(white, plotTop, plotRight - white, plotHeight);
    drawCurveWhiteGuide(ctx, white, plotTop, plotBottom);
    ctx.save();
    ctx.font = HDRAppearance.font("min");
    ctx.fillStyle = uiToken("--curve-axis-label");
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("Headroom", plotRight - 4, plotTop + 4);
    ctx.textAlign = "center";
    ctx.fillText("SDR white", white, plotBottom + 4);
    ctx.restore();
  }

  ctx.strokeStyle = uiToken("--curve-grid");
  ctx.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const x = graphLinePosition(plotLeft + (plotWidth * step) / 4);
    const y = graphLinePosition(plotTop + (plotHeight * step) / 4);
    if (currentCurveLane() !== "hdr") {
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
  }

  ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, plotTop, plotWidth, plotHeight); ctx.clip();
  ctx.strokeStyle = uiToken("--curve-identity");
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotBottom);
  ctx.lineTo(plotRight, plotTop);
  ctx.stroke();

  ctx.strokeStyle = currentCurveLane() === "hdr" && state.selectedCurveChannel === "luma"
    ? curveExposureGradient(ctx, plotLeft, plotRight)
    : curveColor(state.selectedCurveChannel);
  ctx.lineWidth = uiNumberToken("--curve-line-width", 2.5);
  ctx.beginPath();
  curveSamples.forEach(([xValue, yValue], index) => {
    const x = plotLeft + xValue * plotWidth;
    const y = plotBottom - yValue * plotHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.restore(); drawGraphFrame(ctx, plotLeft, plotTop, plotWidth, plotHeight);
  curve.forEach(([xValue, yValue], index) => {
    const x = plotLeft + xValue * plotWidth;
    const y = plotBottom - yValue * plotHeight;
    const selected = index === state.selectedCurvePoint;
    ctx.fillStyle = currentCurveLane() === "hdr"
      ? curveExposureColorAt(xValue)
      : selected
        ? uiToken("--graph-selected")
        : index === 0 || index === curve.length - 1
          ? uiToken("--curve-endpoint")
          : uiToken("--curve-neutral");
    ctx.beginPath();
    const radius = selected
      ? uiNumberToken("--curve-selected-radius", 6)
      : index === 0 || index === curve.length - 1
        ? uiNumberToken("--curve-endpoint-radius", 4)
        : uiNumberToken("--curve-node-radius", 5);
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = uiToken("--curve-selected-ring");
      ctx.lineWidth = uiNumberToken("--curve-selected-ring-width", 1.5);
      ctx.stroke();
    }
    drawGraphHomeCue(ctx, x, y, radius, yValue - xValue);
  });
  syncCurveControlsFromState();
}

function drawGraphHomeCue(ctx, x, y, radius, deviation) {
  if (Math.abs(deviation) < uiNumberToken("--graph-home-epsilon", 0.006)) return;
  const towardIdentity = deviation > 0 ? 1 : -1;
  const gap = uiNumberToken("--graph-home-cue-gap", 1.5);
  const length = uiNumberToken("--graph-home-cue-length", 6);
  const startY = y + towardIdentity * (radius + gap);
  const capY = startY + towardIdentity * 3;
  ctx.save();
  ctx.globalAlpha = uiNumberToken("--graph-home-cue-opacity", 0.62);
  ctx.strokeStyle = uiToken("--graph-home-cue-color");
  ctx.lineWidth = uiNumberToken("--graph-home-cue-width", 1);
  ctx.beginPath();
  ctx.moveTo(x, startY);
  ctx.lineTo(x, capY);
  ctx.moveTo(x - length / 2, capY);
  ctx.lineTo(x + length / 2, capY);
  ctx.stroke();
  ctx.restore();
}

function drawCurveExposureBands(ctx, layout, width, height) {
  const plotLeft = layout.left;
  const plotTop = layout.top;
  const plotRight = width - layout.right;
  const plotBottom = height - layout.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const bands = falseColorBands();

  ctx.save();
  ctx.globalAlpha = uiNumberToken("--curve-band-opacity", 0.1);
  bands.forEach(({ lower, upper, paletteIndex }) => {
    const start = curveDomainPositionForNits(lower ?? 0);
    const end = upper === null ? 1 : curveDomainPositionForNits(upper);
    ctx.fillStyle = exposureBandColor(paletteIndex);
    ctx.fillRect(plotLeft + start * plotWidth, plotTop, Math.max(0, (end - start) * plotWidth), plotHeight);
  });
  ctx.restore();

  const referenceWhite = projectReferenceWhiteNits();
  const chartMaxNits = CURVE_VMAX * referenceWhite / CURVE_REFERENCE_WHITE;
  const labelValues = [...new Set([
    0,
    ...bands.flatMap(({ lower, upper }) => [lower, upper]),
    referenceWhite,
    chartMaxNits,
  ].filter((value) => value !== null && value >= 0 && value <= chartMaxNits))].sort((a, b) => a - b);

  ctx.save();
  ctx.font = HDRAppearance.font("min");
  ctx.textBaseline = "top";
  const lastLabelRight = [-Infinity, -Infinity];
  const labelMetrics = ctx.measureText("0");
  const labelRowPitch = Math.ceil(labelMetrics.fontBoundingBoxAscent + labelMetrics.fontBoundingBoxDescent) + 1;
  labelValues.forEach((nits) => {
    const normalized = curveDomainPositionForNits(nits);
    const x = plotLeft + normalized * plotWidth;
    if (nits === referenceWhite) {
      drawCurveWhiteGuide(ctx, x, plotTop, plotBottom);
    } else {
      ctx.strokeStyle = uiToken("--curve-grid");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
    }

    const label = compactCurveNitLabel(nits);
    const labelWidth = ctx.measureText(label).width;
    const labelX = clamp(x, labelWidth / 2 + 1, width - labelWidth / 2 - 1);
    const leftEdge = labelX - labelWidth / 2;
    const row = lastLabelRight.findIndex((rightEdge) => leftEdge >= rightEdge + 3);
    if (row < 0) return;
    ctx.fillStyle = nits === referenceWhite ? uiToken("--equalizer-axis") : uiToken("--curve-axis-label");
    ctx.textAlign = "center";
    ctx.fillText(label, labelX, plotBottom + 4 + row * labelRowPitch);
    lastLabelRight[row] = labelX + labelWidth / 2;
  });
  ctx.restore();
}

function curveExposureGradient(ctx, plotLeft, plotRight) {
  const gradient = ctx.createLinearGradient(plotLeft, 0, plotRight, 0);
  falseColorBands().forEach(({ lower, upper, paletteIndex }) => {
    const start = curveDomainPositionForNits(lower ?? 0);
    const end = upper === null ? 1 : curveDomainPositionForNits(upper);
    if (end <= start) return;
    gradient.addColorStop(start, exposureBandColor(paletteIndex));
    gradient.addColorStop(Math.max(start, end - 0.0001), exposureBandColor(paletteIndex));
  });
  return gradient;
}

function curveExposureColorAt(normalized) {
  const nits = curveDomainNitsForPosition(normalized);
  const band = falseColorBands().find(({ upper }) => upper === null || nits < upper);
  return exposureBandColor(band?.paletteIndex ?? falseColorPaletteTokens.length - 1);
}

function drawCurveWhiteGuide(ctx, x, top, bottom) {
  ctx.strokeStyle = uiToken("--curve-reference-line");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
}

// The same scene-relative domain as adjustments.py and webgpu-shaders.js.
const CURVE_C = 0.004;
const CURVE_VMAX = 3.6;
const CURVE_LN_SPAN = Math.log1p(CURVE_VMAX / CURVE_C);
const CURVE_REFERENCE_WHITE = 0.18;
const CURVE_SDR_WHITE = CURVE_REFERENCE_WHITE * 203 / 100;

function curveDomainEncode(scene) {
  return Math.log1p(scene / CURVE_C) / CURVE_LN_SPAN;
}

function curveDomainPositionForNits(nits) {
  const scene = Math.max(Number(nits) || 0, 0) * CURVE_REFERENCE_WHITE / projectReferenceWhiteNits();
  return clamp(curveDomainEncode(scene), 0, 1);
}

function curveDomainNitsForPosition(value) {
  const normalized = clamp(Number(value) || 0, 0, 1);
  const scene = CURVE_C * Math.expm1(normalized * CURVE_LN_SPAN);
  return scene * projectReferenceWhiteNits() / CURVE_REFERENCE_WHITE;
}

function compactCurveNitLabel(value) {
  if (value >= 1000) return `${Number((value / 1000).toFixed(value % 1000 === 0 ? 0 : 1))}K`;
  if (value >= 10) return `${Math.round(value)}`;
  return `${Number(value.toFixed(1))}`;
}

function currentCurveValues() {
  const path = curvePath(state.selectedCurveChannel);
  const values = getValueByPath(state.adjustments, path) || defaultCurvePoints();
  return values.map(([x, y]) => [x, y]);
}

function setCurveValues(channel, values) {
  const normalized = normalizeCurvePoints(values);
  state.selectedCurvePoint = Math.min(state.selectedCurvePoint ?? 0, normalized.length - 1);
  setValueByPath(state.adjustments, curvePath(channel), normalized);
}

function curvePath(channel) {
  return `${currentCurveLane()}.${channel}_curve`;
}

function currentCurveLane() {
  return state.currentView === "sdr" ? "sdr" : "hdr";
}

function curveEditorLayout() {
  return { left: 10, right: 10, top: 14, bottom: 34 };
}

function canvasLogicalSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width >= 2 && rect.height >= 2) return { width: rect.width, height: rect.height };
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  return { width: canvas.width / dpr, height: canvas.height / dpr };
}

function curvePointerPosition(clientX, clientY, rect) {
  const layout = curveEditorLayout();
  const canvasX = clientX - rect.left;
  const canvasY = clientY - rect.top;
  return {
    canvasX,
    canvasY,
    x: clamp((canvasX - layout.left) / Math.max(rect.width - layout.left - layout.right, 1), 0, 1),
    y: 1 - clamp((canvasY - layout.top) / Math.max(rect.height - layout.top - layout.bottom, 1), 0, 1),
  };
}

function curvePointCanvasPosition([x, y]) {
  const canvas = els.curveEditor;
  const { width, height } = canvasLogicalSize(canvas);
  const layout = curveEditorLayout();
  return {
    x: layout.left + x * (width - layout.left - layout.right),
    y: height - layout.bottom - y * (height - layout.top - layout.bottom),
  };
}

function curvePointIndexAtPointer(clientX, clientY, rect) {
  const pointer = curvePointerPosition(clientX, clientY, rect);
  const curve = currentCurveValues();
  let nearestIndex = null;
  let nearestDistance = 10 ** 2;
  curve.forEach((point, index) => {
    const position = curvePointCanvasPosition(point);
    const distance = ((position.x - pointer.canvasX) ** 2) + ((position.y - pointer.canvasY) ** 2);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function curveHitAtPointer(clientX, clientY, rect) {
  const pointer = curvePointerPosition(clientX, clientY, rect);
  const [[, curveY]] = sampleCurvePoints(currentCurveValues(), 1, pointer.x);
  const curvePosition = curvePointCanvasPosition([pointer.x, curveY]);
  if (Math.abs(curvePosition.y - pointer.canvasY) > 8) return null;
  return { x: pointer.x, y: curveY };
}

function addCurvePoint(requestedX = null) {
  const curve = currentCurveValues();
  if (curve.length >= 16) return null;
  let insertIndex = 1;
  let widestGap = -1;
  if (requestedX === null) {
    for (let index = 0; index < curve.length - 1; index += 1) {
      const gap = curve[index + 1][0] - curve[index][0];
      if (gap > widestGap) {
        widestGap = gap;
        insertIndex = index + 1;
      }
    }
  } else {
    insertIndex = curve.findIndex(([x]) => x > requestedX);
    if (insertIndex <= 0) return null;
    widestGap = curve[insertIndex][0] - curve[insertIndex - 1][0];
  }
  const x = requestedX === null ? curve[insertIndex - 1][0] + widestGap / 2 : requestedX;
  if (x - curve[insertIndex - 1][0] < 0.02 || curve[insertIndex][0] - x < 0.02) return null;
  const [[, y]] = sampleCurvePoints(curve, 1, x);
  curve.splice(insertIndex, 0, [x, y]);
  state.selectedCurvePoint = insertIndex;
  setCurveValues(state.selectedCurveChannel, curve);
  return insertIndex;
}

function removeCurvePoint(requestedIndex = null) {
  const curve = currentCurveValues();
  const index = requestedIndex ?? state.selectedCurvePoint ?? Math.floor(curve.length / 2);
  if (curve.length <= 2 || isLockedCurveEndpoint(index)) return;
  curve.splice(index, 1);
  state.selectedCurvePoint = Math.min(index, curve.length - 2);
  setCurveValues(state.selectedCurveChannel, curve);
}

function isLockedCurveEndpoint(index) {
  const curve = currentCurveValues();
  return index <= 0 || index >= curve.length - 1;
}

function normalizeCurvePoints(points) {
  const sorted = points
    .map(([x, y]) => [clamp(Number(x), 0, 1), clamp(Number(y), 0, 1)])
    .sort((a, b) => a[0] - b[0])
    .slice(0, 16);
  if (sorted.length < 2) return defaultCurvePoints();
  sorted[0][0] = 0;
  sorted[sorted.length - 1][0] = 1;
  for (let index = 1; index < sorted.length - 1; index += 1) {
    sorted[index][0] = clamp(sorted[index][0], sorted[index - 1][0] + 0.02, sorted[index + 1][0] - 0.02);
  }
  return sorted;
}

function curveColor(channel) {
  if (channel === "red") return uiToken("--curve-red");
  if (channel === "green") return uiToken("--curve-green");
  if (channel === "blue") return uiToken("--curve-blue");
  return uiToken("--curve-neutral");
}

function defaultCurvePoints() {
  // Keep three editable controls between the fixed black and white anchors.
  return [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]];
}

