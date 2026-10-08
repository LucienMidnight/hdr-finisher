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
      const verticalStep = step * Math.min(1, curveVerticalAdjustmentScale(index, curve.length) / 0.35);
      if (event.key === "ArrowLeft" && !isLockedCurveEndpoint(index)) {
        point[0] = clamp(point[0] - step, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
      }
      if (event.key === "ArrowRight" && !isLockedCurveEndpoint(index)) {
        point[0] = clamp(point[0] + step, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
      }
      if (event.key === "ArrowUp") point[1] = clamp(point[1] + verticalStep, 0, 1);
      if (event.key === "ArrowDown") point[1] = clamp(point[1] - verticalStep, 0, 1);
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
  const direct = curvePointerPosition(clientX, clientY, rect);
  const directX = direct.x;
  const directY = direct.y;
  const normalizedX = dragOrigin
    ? dragOrigin.point[0] + (clientX - dragOrigin.clientX) / Math.max(rect.width, 1)
    : directX;
  const verticalScale = curveVerticalAdjustmentScale(index, curve.length);
  const normalizedY = dragOrigin
    ? dragOrigin.point[1] - ((clientY - dragOrigin.clientY) / Math.max(rect.height, 1)) * verticalScale
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

function curveVerticalAdjustmentScale(index, pointCount) {
  if (currentCurveLane() !== "hdr" || state.selectedCurveChannel !== "luma") return 1;
  // The endpoints alter the black floor and highlight ceiling, so give them
  // roughly twice the precision of the broad middle-tone control.
  return index === 0 || index === pointCount - 1 ? 0.18 : 0.35;
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
  ctx.fillStyle = uiToken("--app");
  ctx.fillRect(0, 0, width, height);

  if (currentCurveLane() === "hdr") {
    drawCurveExposureBands(ctx, layout, width, height);
  }

  ctx.strokeStyle = uiToken("--curve-grid");
  ctx.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const x = plotLeft + (plotWidth * step) / 4;
    const y = plotTop + (plotHeight * step) / 4;
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

  curve.forEach(([xValue, yValue], index) => {
    const x = plotLeft + xValue * plotWidth;
    const y = plotBottom - yValue * plotHeight;
    const selected = index === state.selectedCurvePoint;
    ctx.fillStyle = currentCurveLane() === "hdr"
      ? curveExposureColorAt(xValue)
      : selected
        ? uiToken("--curve-selected")
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
    const end = curveDomainPositionForNits(upper ?? 10000);
    ctx.fillStyle = exposureBandColor(paletteIndex);
    ctx.fillRect(plotLeft + start * plotWidth, plotTop, Math.max(0, (end - start) * plotWidth), plotHeight);
  });
  ctx.restore();

  const levels = falseColorLevels();
  const labelValues = [...new Set([
    0,
    ...bands.flatMap(({ lower, upper }) => [lower, upper]),
    10000,
  ].filter((value) => value !== null && value >= 0 && value <= 10000))].sort((a, b) => a - b);

  ctx.save();
  ctx.font = '9px "Space Mono", "Cascadia Mono", Consolas';
  ctx.textBaseline = "top";
  const lastLabelRight = [-Infinity, -Infinity];
  labelValues.forEach((nits) => {
    const normalized = curveDomainPositionForNits(nits);
    const x = plotLeft + normalized * plotWidth;
    const boundaryBand = bands.find(({ upper }) => upper !== null && Math.abs(upper - nits) < 0.001);
    const boundaryColor = boundaryBand ? exposureBandColor(boundaryBand.paletteIndex) : uiToken("--quiet");
    ctx.strokeStyle = nits === levels.referenceWhite ? uiToken("--curve-reference-line") : `${boundaryColor}80`;
    ctx.lineWidth = nits === levels.referenceWhite ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();

    const label = compactCurveNitLabel(nits);
    const labelWidth = ctx.measureText(label).width;
    const labelX = clamp(x, plotLeft + labelWidth / 2, plotRight - labelWidth / 2);
    const leftEdge = labelX - labelWidth / 2;
    const row = lastLabelRight.findIndex((rightEdge) => leftEdge >= rightEdge + 5);
    if (row < 0) return;
    ctx.fillStyle = nits === levels.referenceWhite ? uiToken("--equalizer-axis") : uiToken("--curve-axis-label");
    ctx.textAlign = "center";
    ctx.fillText(label, labelX, plotBottom + 5 + row * 10);
    lastLabelRight[row] = labelX + labelWidth / 2;
  });
  ctx.restore();
}

function curveExposureGradient(ctx, plotLeft, plotRight) {
  const gradient = ctx.createLinearGradient(plotLeft, 0, plotRight, 0);
  falseColorBands().forEach(({ lower, upper, paletteIndex }) => {
    const start = curveDomainPositionForNits(lower ?? 0);
    const end = curveDomainPositionForNits(upper ?? 10000);
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

function curveDomainPositionForNits(value) {
  const nits = clamp(Number(value) || 0, 0, 10000);
  if (nits <= 100) return 0.5 * ((nits / 100) ** (1 / Math.log(100)));
  return clamp(0.5 + 0.5 * Math.log2(nits / 100) / Math.log2(100), 0, 1);
}

function curveDomainNitsForPosition(value) {
  const normalized = clamp(Number(value) || 0, 0, 1);
  if (normalized <= 0.5) return 100 * ((normalized * 2) ** Math.log(100));
  return 100 * (2 ** ((normalized - 0.5) * 2 * Math.log2(100)));
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
  return { left: 18, right: 14, top: 14, bottom: 34 };
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

function sampleCurvePoints(points, samples, forcedX = null) {
  const sampleX = forcedX === null
    ? Array.from({ length: samples }, (_, index) => samples <= 1 ? 0 : index / (samples - 1))
    : [forcedX];
  const sampleY = monotoneCurveValues(points, sampleX);
  return sampleX.map((x, index) => [x, sampleY[index]]);
}

function monotoneCurveValues(points, sampleX) {
  const x = points.map((point) => point[0]);
  const y = points.map((point) => point[1]);
  const h = x.slice(1).map((value, index) => Math.max(value - x[index], 1e-6));
  const delta = y.slice(1).map((value, index) => (value - y[index]) / h[index]);
  const slopes = y.map(() => 0);
  slopes[0] = delta[0];
  slopes[slopes.length - 1] = delta[delta.length - 1];

  for (let index = 1; index < y.length - 1; index += 1) {
    if (delta[index - 1] === 0 || delta[index] === 0 || Math.sign(delta[index - 1]) !== Math.sign(delta[index])) {
      slopes[index] = 0;
    } else {
      const w1 = 2 * h[index] + h[index - 1];
      const w2 = h[index] + 2 * h[index - 1];
      slopes[index] = (w1 + w2) / ((w1 / delta[index - 1]) + (w2 / delta[index]));
    }
  }

  return sampleX.map((sample) => {
    let segmentIndex = 0;
    while (segmentIndex < x.length - 2 && sample > x[segmentIndex + 1]) segmentIndex += 1;
    const x0 = x[segmentIndex];
    const x1 = x[segmentIndex + 1];
    const y0 = y[segmentIndex];
    const y1 = y[segmentIndex + 1];
    const m0 = slopes[segmentIndex];
    const m1 = slopes[segmentIndex + 1];
    const segment = Math.max(x1 - x0, 1e-6);
    const t = clamp((sample - x0) / segment, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = (2 * t3) - (3 * t2) + 1;
    const h10 = t3 - (2 * t2) + t;
    const h01 = (-2 * t3) + (3 * t2);
    const h11 = t3 - t2;
    return clamp((h00 * y0) + (h10 * segment * m0) + (h01 * y1) + (h11 * segment * m1), 0, 1);
  });
}

