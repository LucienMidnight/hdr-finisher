function bindToneEqualizerEditor() {
  bindToneEqualizerEditorForLane("hdr");
  bindToneEqualizerEditorForLane("sdr");
  els.sdrMatchHdrBands?.addEventListener("click", matchHdrBandsToSdr);
}

function bindToneEqualizerEditorForLane(lane) {
  const ui = toneEqualizerUi(lane);
  const canvas = ui.editor;
  const beginDrag = (startEvent, bandIndex) => {
    if (!state.session) return;
    const { clientX, clientY, pointerId } = startEvent;
    state.previewScheduler?.beginInteraction();
    const rect = canvas.getBoundingClientRect();
    state.activeToneEqualizerBand = bandIndex;
    state.selectedToneEqualizerBand = state.activeToneEqualizerBand;
    const startingNodes = currentToneEqualizerNodes(lane).map((node) => ({ ...node }));
    const pointerDelta = createPrecisionPointerDelta(startEvent);
    drawToneEqualizerEditor(lane);
    let stopped = false;
    if (pointerId !== null && canvas.setPointerCapture) {
      try { canvas.setPointerCapture(pointerId); } catch {}
    }
    const move = (event) => {
      if (pointerId !== null && event.pointerId !== pointerId) return;
      event.preventDefault();
      const delta = pointerDelta.update(event);
      updateToneEqualizerFromPointer(clientX + delta.x, clientY + delta.y, rect, startingNodes, lane);
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
      state.activeToneEqualizerBand = null;
      renderControlState();
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
    const bandIndex = toneEqualizerNodeIndexAtPointer(event.clientX, event.clientY, rect, lane);
    if (bandIndex !== null) {
      beginDrag(event, bandIndex);
      return;
    }
    const curveHit = toneEqualizerCurveHitAtPointer(event.clientX, event.clientY, rect, lane);
    if (!curveHit) return;
    const insertedIndex = addToneEqualizerNode(curveHit.inputEv, lane);
    if (insertedIndex === null) return;
    beginDrag(event, insertedIndex);
  });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!state.session) return;
    const bandIndex = toneEqualizerNodeIndexAtPointer(event.clientX, event.clientY, canvas.getBoundingClientRect(), lane);
    if (bandIndex === null) return;
    state.selectedToneEqualizerBand = bandIndex;
    removeToneEqualizerNode(bandIndex, lane);
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (!state.session) return;
    changeToneEqualizerRadius(event.deltaY < 0 ? 0.25 : -0.25, lane);
  }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    if (!state.session) return;
    const index = state.selectedToneEqualizerBand;
    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      changeToneEqualizerRadius(event.key === "]" ? 0.25 : -0.25, lane);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      moveToneEqualizerNodeHorizontally(index, event.key === "ArrowRight" ? 0.1 : -0.1, lane);
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      removeToneEqualizerNode(null, lane);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const nodes = currentToneEqualizerNodes(lane);
      if (event.key === "ArrowLeft") state.selectedToneEqualizerBand = Math.max(0, index - 1);
      if (event.key === "ArrowRight") state.selectedToneEqualizerBand = Math.min(nodes.length - 1, index + 1);
      if (event.key === "Home") state.selectedToneEqualizerBand = 0;
      if (event.key === "End") state.selectedToneEqualizerBand = nodes.length - 1;
      syncToneEqualizerControls(lane);
      drawToneEqualizerEditor(lane);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step = event.ctrlKey ? 0.01 : 0.05;
    const direction = event.key === "ArrowUp" ? 1 : -1;
    setToneEqualizerBand(index, currentToneEqualizerNodes(lane)[index].adjustment_ev + direction * step, lane);
    renderControlState();
  });

  ui.bandValue.addEventListener("input", () => {
    if (!state.session) return;
    setToneEqualizerBand(state.selectedToneEqualizerBand, Number(ui.bandValue.value), lane);
  });
  ui.bandValue.addEventListener("pointerdown", () => state.previewScheduler?.beginInteraction());
  ["pointerup", "pointercancel"].forEach((eventName) => {
    ui.bandValue.addEventListener(eventName, () => state.previewScheduler?.endInteraction());
  });
  ui.bandValue.addEventListener("change", () => {
    renderControlState();
  });
  ui.add.addEventListener("click", () => addToneEqualizerNode(null, lane));
  ui.remove.addEventListener("click", () => removeToneEqualizerNode(null, lane));
  ui.radiusDown.addEventListener("click", () => changeToneEqualizerRadius(-0.25, lane));
  ui.radiusUp.addEventListener("click", () => changeToneEqualizerRadius(0.25, lane));
}

function updateToneEqualizerFromPointer(clientX, clientY, rect, startingNodes, lane = state.currentView) {
  const layout = toneEqualizerEditorLayout();
  const paddingTop = layout.top / Math.max(rect.height, 1);
  const paddingBottom = layout.bottom / Math.max(rect.height, 1);
  const normalizedY = clamp((clientY - rect.top) / rect.height, paddingTop, 1 - paddingBottom);
  const graphY = (normalizedY - paddingTop) / Math.max(1 - paddingTop - paddingBottom, 1e-6);
  const value = TONE_EQUALIZER_MAX_ADJUSTMENT_EV - graphY * TONE_EQUALIZER_MAX_ADJUSTMENT_EV * 2;
  const index = state.activeToneEqualizerBand ?? state.selectedToneEqualizerBand;
  const nodes = startingNodes.map((node) => ({ ...node }));
  const selected = nodes[index];
  const radius = Number(state.adjustments[lane].tone_equalizer_influence_radius || 1.5);
  const delta = value - selected.adjustment_ev;
  nodes.forEach((node, nodeIndex) => {
    const distance = Math.abs(node.input_ev - selected.input_ev);
    const local = clamp(1 - distance / Math.max(radius, 0.25), 0, 1);
    const weight = local * local * (3 - 2 * local);
    node.adjustment_ev = clamp(node.adjustment_ev + delta * weight, -2, 2);
    if (nodeIndex === index && nodeIndex > 0 && nodeIndex < nodes.length - 1) {
      node.input_ev = clamp(
        toneEqualizerEvFromPointer(clientX, rect),
        nodes[nodeIndex - 1].input_ev + 0.1,
        nodes[nodeIndex + 1].input_ev - 0.1,
      );
    }
  });
  state.adjustments[lane].tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  syncControlsFromState();
  drawToneEqualizerEditor(lane);
  invalidatePreview(lane);
  debouncePreview(lane);
}

function toneEqualizerPointerPosition(clientX, clientY, rect) {
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function toneEqualizerCanvasPosition(inputEv, adjustmentEv, lane = state.currentView) {
  const canvas = toneEqualizerUi(lane).editor;
  const { width, height } = canvasLogicalSize(canvas);
  const { left, right, top, bottom } = toneEqualizerEditorLayout();
  return {
    x: left + ((inputEv - TONE_EQUALIZER_MIN_EV) / (toneEqualizerPqMaxEv() - TONE_EQUALIZER_MIN_EV)) * (width - left - right),
    y: top + ((TONE_EQUALIZER_MAX_ADJUSTMENT_EV - adjustmentEv) / (TONE_EQUALIZER_MAX_ADJUSTMENT_EV * 2)) * (height - top - bottom),
  };
}

function toneEqualizerNodeIndexAtPointer(clientX, clientY, rect, lane = state.currentView) {
  const pointer = toneEqualizerPointerPosition(clientX, clientY, rect);
  let nearestIndex = null;
  let nearestDistance = 10 ** 2;
  currentToneEqualizerNodes(lane).forEach((node, index) => {
    const position = toneEqualizerCanvasPosition(node.input_ev, node.adjustment_ev, lane);
    const distance = ((position.x - pointer.x) ** 2) + ((position.y - pointer.y) ** 2);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function toneEqualizerCurveHitAtPointer(clientX, clientY, rect, lane = state.currentView) {
  const pointer = toneEqualizerPointerPosition(clientX, clientY, rect);
  const inputEv = toneEqualizerEvFromPointer(clientX, rect);
  const adjustmentEv = sampleToneEqualizerAdjustment(
    inputEv,
    currentToneEqualizerNodes(lane),
    Number(state.adjustments[lane].tone_equalizer_smoothing || 0.5),
  );
  const curvePosition = toneEqualizerCanvasPosition(inputEv, adjustmentEv, lane);
  return Math.abs(curvePosition.y - pointer.y) <= 8 ? { inputEv, adjustmentEv } : null;
}

function setToneEqualizerBand(index, requestedValue, lane = state.currentView) {
  const nodes = currentToneEqualizerNodes(lane);
  const [minimum, maximum] = toneEqualizerBandLimits(index, nodes);
  const rounded = Math.round(clamp(Number(requestedValue) || 0, minimum, maximum) * 100) / 100;
  nodes[index].adjustment_ev = clamp(rounded, Math.ceil(minimum * 100) / 100, Math.floor(maximum * 100) / 100);
  state.adjustments[lane].tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  state.selectedToneEqualizerBand = index;
  syncControlsFromState();
  drawToneEqualizerEditor(lane);
  invalidatePreview(lane);
  debouncePreview(lane);
}

function toneEqualizerBandLimits(index, nodes = currentToneEqualizerNodes()) {
  const inputEv = nodes[index].input_ev;
  let minimum = -TONE_EQUALIZER_MAX_ADJUSTMENT_EV;
  let maximum = TONE_EQUALIZER_MAX_ADJUSTMENT_EV;
  if (index > 0) {
    const previousTarget = nodes[index - 1].input_ev + nodes[index - 1].adjustment_ev;
    minimum = Math.max(minimum, previousTarget + TONE_EQUALIZER_MIN_TARGET_STEP - inputEv);
  }
  if (index < nodes.length - 1) {
    const nextTarget = nodes[index + 1].input_ev + nodes[index + 1].adjustment_ev;
    maximum = Math.min(maximum, nextTarget - TONE_EQUALIZER_MIN_TARGET_STEP - inputEv);
  }
  return [minimum, Math.max(minimum, maximum)];
}

function syncToneEqualizerControls(lane = state.currentView) {
  const ui = toneEqualizerUi(lane);
  const nodes = currentToneEqualizerNodes(lane);
  const index = clamp(state.selectedToneEqualizerBand ?? 2, 0, nodes.length - 1);
  state.selectedToneEqualizerBand = index;
  const inputEv = nodes[index].input_ev;
  const value = nodes[index].adjustment_ev;
  const [minimum, maximum] = toneEqualizerBandLimits(index, nodes);
  const legalMinimum = Math.ceil(minimum * 100) / 100;
  const legalMaximum = Math.floor(maximum * 100) / 100;
  ui.bandValue.min = String(legalMinimum);
  ui.bandValue.max = String(Math.max(legalMinimum, legalMaximum));
  ui.bandValue.setAttribute("aria-valuemin", ui.bandValue.min);
  ui.bandValue.setAttribute("aria-valuemax", ui.bandValue.max);
  ui.bandValue.value = String(value);
  updateRangeVisual(ui.bandValue);
  ui.bandLabel.textContent = lane === "hdr"
    ? `${formatSignedEv(inputEv, 0)} · ${formatToneBandNits(100 * (2 ** inputEv))}`
    : `${formatSignedEv(inputEv, 0)} · ${formatSdrBandLevel(0.18 * (2 ** inputEv))}`;
  if (ui.bandOutput.dataset.editing !== "true") {
    ui.bandOutput.textContent = formatSignedEv(value, 2);
  }
  if (ui.radius.dataset.editing !== "true") {
    ui.radius.textContent = `Influence ${Number(state.adjustments[lane].tone_equalizer_influence_radius || 1.5).toFixed(2)} EV`;
  }
  ui.remove.disabled = nodes.length <= TONE_EQUALIZER_MIN_NODE_COUNT || index === 0 || index === nodes.length - 1;
  ui.add.disabled = nodes.length >= TONE_EQUALIZER_MAX_NODE_COUNT;
}

function drawToneEqualizerEditor(lane = state.currentView) {
  const canvas = toneEqualizerUi(lane).editor;
  const surface = resizeCanvasSurface(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  const { left, right, top, bottom } = toneEqualizerEditorLayout();
  const graphWidth = width - left - right;
  const graphHeight = height - top - bottom;
  const nodes = currentToneEqualizerNodes(lane);
  const smoothing = clamp(Number(state.adjustments[lane]?.tone_equalizer_smoothing ?? 0.5), 0, 1);
  const enabled = state.adjustments[lane]?.tone_equalizer_section_enabled !== false;
  const xForEv = (inputEv) => left + ((inputEv - TONE_EQUALIZER_MIN_EV) / (toneEqualizerPqMaxEv() - TONE_EQUALIZER_MIN_EV)) * graphWidth;
  const yForAdjustment = (value) => top + ((TONE_EQUALIZER_MAX_ADJUSTMENT_EV - value) / (TONE_EQUALIZER_MAX_ADJUSTMENT_EV * 2)) * graphHeight;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = uiToken("--app");
  ctx.fillRect(0, 0, width, height);
  ctx.font = '9px "Space Mono", "Cascadia Mono", monospace';
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let adjustment = -2; adjustment <= 2; adjustment += 1) {
    const y = yForAdjustment(adjustment);
    ctx.strokeStyle = adjustment === 0 ? uiToken("--equalizer-grid-strong") : uiToken("--equalizer-grid");
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.fillStyle = uiToken("--quiet");
    ctx.fillText(formatSignedEv(adjustment, 0), left - 5, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let inputEv = TONE_EQUALIZER_MIN_EV; inputEv <= TONE_EQUALIZER_MAX_EV; inputEv += 1) {
    const x = xForEv(inputEv);
    ctx.strokeStyle = inputEv === 0 ? uiToken("--equalizer-zero") : uiToken("--equalizer-grid");
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, height - bottom);
    ctx.stroke();
    if (inputEv % 2 === 0) {
      ctx.fillStyle = inputEv === 0 ? uiToken("--equalizer-axis") : uiToken("--quiet");
      ctx.fillText(formatSignedEv(inputEv, 0), x, height - bottom + 7);
    }
  }
  const outputBoundaryEv = lane === "hdr" ? toneEqualizerPqMaxEv() : Math.log2(1 / 0.18);
  const pqX = xForEv(outputBoundaryEv);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = uiToken("--equalizer-pq");
  ctx.beginPath();
  ctx.moveTo(pqX, top);
  ctx.lineTo(pqX, height - bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = uiToken("--attention");
  ctx.textAlign = "right";
  ctx.fillText(lane === "hdr" ? "10K" : "100%", pqX, 3);

  ctx.strokeStyle = enabled ? uiToken("--equalizer-curve") : uiToken("--equalizer-disabled");
  ctx.lineWidth = uiNumberToken("--equalizer-line-width", 2.25);
  ctx.beginPath();
  for (let sample = 0; sample < 180; sample += 1) {
    const inputEv = TONE_EQUALIZER_MIN_EV + (sample / 179) * (toneEqualizerPqMaxEv() - TONE_EQUALIZER_MIN_EV);
    const adjustment = sampleToneEqualizerAdjustment(inputEv, nodes, smoothing);
    const x = xForEv(inputEv);
    const y = yForAdjustment(adjustment);
    if (sample === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const selectedNode = nodes[state.selectedToneEqualizerBand];
  if (selectedNode) {
    const radius = Number(state.adjustments[lane]?.tone_equalizer_influence_radius || 1.5);
    const start = xForEv(Math.max(TONE_EQUALIZER_MIN_EV, selectedNode.input_ev - radius));
    const end = xForEv(Math.min(TONE_EQUALIZER_MAX_EV, selectedNode.input_ev + radius));
    ctx.fillStyle = uiToken("--equalizer-influence-wash");
    ctx.fillRect(start, top, end - start, graphHeight);
  }
  nodes.forEach((node, index) => {
    const inputEv = node.input_ev;
    const selected = index === state.selectedToneEqualizerBand;
    const radius = selected
      ? uiNumberToken("--equalizer-selected-radius", 5.5)
      : uiNumberToken("--equalizer-node-radius", 4);
    ctx.fillStyle = selected
      ? uiToken("--equalizer-selected")
      : enabled
        ? uiToken("--equalizer-node")
        : uiToken("--equalizer-disabled");
    ctx.beginPath();
    const x = xForEv(inputEv);
    const y = yForAdjustment(node.adjustment_ev);
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    drawGraphHomeCue(ctx, x, y, radius, node.adjustment_ev);
  });
  syncToneEqualizerControls(lane);
}

function sampleToneEqualizerAdjustment(inputEv, values, smoothing) {
  const nodes = normalizeToneEqualizerNodes(values);
  if (inputEv <= nodes[0].input_ev) return nodes[0].adjustment_ev;
  if (inputEv >= nodes.at(-1).input_ev) return nodes.at(-1).adjustment_ev;
  const targets = nodes.map((node) => node.input_ev + node.adjustment_ev);
  const widths = nodes.slice(1).map((node, index) => Math.max(node.input_ev - nodes[index].input_ev, 0.001));
  const deltas = targets.slice(1).map((value, index) => (value - targets[index]) / widths[index]);
  const slopes = targets.map((_, index) => {
    if (index === 0) return deltas[0];
    if (index === targets.length - 1) return deltas.at(-1);
    const previous = deltas[index - 1];
    const following = deltas[index];
    return previous <= 0 || following <= 0 ? 0 : (2 * previous * following) / (previous + following);
  });
  const segment = Math.min(nodes.findIndex((node) => node.input_ev > inputEv) - 1, nodes.length - 2);
  const local = (inputEv - nodes[segment].input_ev) / widths[segment];
  const local2 = local * local;
  const local3 = local2 * local;
  const y0 = targets[segment];
  const y1 = targets[segment + 1];
  const cubic = ((2 * local3) - (3 * local2) + 1) * y0
    + (local3 - (2 * local2) + local) * slopes[segment] * widths[segment]
    + ((-2 * local3) + (3 * local2)) * y1
    + (local3 - local2) * slopes[segment + 1] * widths[segment];
  const linear = y0 + (y1 - y0) * local;
  return ((linear * (1 - smoothing)) + (cubic * smoothing)) - inputEv;
}

function normalizeToneEqualizerNodes(values) {
  const source = Array.isArray(values) && values.length >= 2 ? values : defaultToneEqualizerNodes();
  const nodes = source.slice(0, 16).map((node, index) => ({
    input_ev: Number.isFinite(Number(node?.input_ev)) ? clamp(Number(node.input_ev), -6, 6) : -6 + index,
    adjustment_ev: Number.isFinite(Number(node?.adjustment_ev)) ? clamp(Number(node.adjustment_ev), -2, 2) : 0,
  })).sort((left, right) => left.input_ev - right.input_ev);
  nodes[0].input_ev = -6;
  nodes[nodes.length - 1].input_ev = 6;
  const targets = nodes.map((node) => node.input_ev + node.adjustment_ev);
  for (let index = 1; index < targets.length; index += 1) {
    targets[index] = Math.max(targets[index], targets[index - 1] + TONE_EQUALIZER_MIN_TARGET_STEP);
  }
  nodes.forEach((node, index) => { node.adjustment_ev = clamp(targets[index] - node.input_ev, -2, 2); });
  return nodes;
}

function toneEqualizerUi(lane = state.currentView) {
  if (lane === "sdr") return {
    editor: els.sdrToneEqualizerEditor,
    bandValue: els.sdrToneEqualizerBandValue,
    bandLabel: els.sdrToneEqualizerBandLabel,
    bandOutput: els.sdrToneEqualizerBandOutput,
    add: els.sdrToneEqualizerAdd,
    remove: els.sdrToneEqualizerRemove,
    radiusDown: els.sdrToneEqualizerRadiusDown,
    radiusUp: els.sdrToneEqualizerRadiusUp,
    radius: els.sdrToneEqualizerRadius,
  };
  return {
    editor: els.toneEqualizerEditor,
    bandValue: els.toneEqualizerBandValue,
    bandLabel: els.toneEqualizerBandLabel,
    bandOutput: els.toneEqualizerBandOutput,
    add: els.toneEqualizerAdd,
    remove: els.toneEqualizerRemove,
    radiusDown: els.toneEqualizerRadiusDown,
    radiusUp: els.toneEqualizerRadiusUp,
    radius: els.toneEqualizerRadius,
  };
}

function currentToneEqualizerNodes(lane = state.currentView) {
  return normalizeToneEqualizerNodes(state.adjustments[lane]?.tone_equalizer_nodes).map((node) => ({ ...node }));
}

function toneEqualizerEvFromPointer(clientX, rect) {
  const layout = toneEqualizerEditorLayout();
  const paddingLeft = layout.left / Math.max(rect.width, 1);
  const paddingRight = layout.right / Math.max(rect.width, 1);
  const normalizedX = clamp((clientX - rect.left) / rect.width, paddingLeft, 1 - paddingRight);
  const graphX = (normalizedX - paddingLeft) / Math.max(1 - paddingLeft - paddingRight, 1e-6);
  return TONE_EQUALIZER_MIN_EV + graphX * (toneEqualizerPqMaxEv() - TONE_EQUALIZER_MIN_EV);
}

function addToneEqualizerNode(preferredEv = null, lane = state.currentView) {
  const nodes = currentToneEqualizerNodes(lane);
  if (nodes.length >= TONE_EQUALIZER_MAX_NODE_COUNT) return null;
  let inputEv = preferredEv;
  if (inputEv == null) {
    let widest = -1;
    let insertion = 1;
    for (let index = 0; index < nodes.length - 1; index += 1) {
      const gap = nodes[index + 1].input_ev - nodes[index].input_ev;
      if (gap > widest) { widest = gap; insertion = index + 1; }
    }
    inputEv = (nodes[insertion - 1].input_ev + nodes[insertion].input_ev) / 2;
  }
  inputEv = clamp(inputEv, -5.9, 5.9);
  if (nodes.some((node) => Math.abs(node.input_ev - inputEv) < 0.1)) return null;
  const adjustmentEv = sampleToneEqualizerAdjustment(inputEv, nodes, Number(state.adjustments[lane].tone_equalizer_smoothing || 0.5));
  nodes.push({ input_ev: inputEv, adjustment_ev: adjustmentEv });
  nodes.sort((left, right) => left.input_ev - right.input_ev);
  state.selectedToneEqualizerBand = nodes.findIndex((node) => node.input_ev === inputEv);
  state.adjustments[lane].tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  drawToneEqualizerEditor(lane);
  renderControlState();
  invalidatePreview(lane);
  debouncePreview(lane);
  return state.selectedToneEqualizerBand;
}

function removeToneEqualizerNode(requestedIndex = null, lane = state.currentView) {
  const nodes = currentToneEqualizerNodes(lane);
  const index = requestedIndex ?? state.selectedToneEqualizerBand;
  if (nodes.length <= TONE_EQUALIZER_MIN_NODE_COUNT || index <= 0 || index >= nodes.length - 1) return;
  nodes.splice(index, 1);
  state.selectedToneEqualizerBand = Math.min(index, nodes.length - 2);
  state.adjustments[lane].tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  drawToneEqualizerEditor(lane);
  renderControlState();
  invalidatePreview(lane);
  debouncePreview(lane);
}

function changeToneEqualizerRadius(delta, lane = state.currentView) {
  const current = Number(state.adjustments[lane].tone_equalizer_influence_radius || 1.5);
  state.adjustments[lane].tone_equalizer_influence_radius = clamp(Math.round((current + delta) * 4) / 4, 0.25, 12);
  syncToneEqualizerControls(lane);
  drawToneEqualizerEditor(lane);
  renderControlState();
}

function moveToneEqualizerNodeHorizontally(index, delta, lane = state.currentView) {
  const nodes = currentToneEqualizerNodes(lane);
  if (index <= 0 || index >= nodes.length - 1) return;
  nodes[index].input_ev = clamp(nodes[index].input_ev + delta, nodes[index - 1].input_ev + 0.1, nodes[index + 1].input_ev - 0.1);
  state.adjustments[lane].tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  drawToneEqualizerEditor(lane);
  invalidatePreview(lane);
  debouncePreview(lane);
}

function formatSignedEv(value, digits) {
  const numeric = Math.abs(value) < 0.0005 ? 0 : Number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)} EV`;
}

function formatToneBandNits(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k nit`;
  if (value >= 10) return `${Math.round(value)} nit`;
  return `${value.toFixed(1)} nit`;
}

function toneEqualizerEditorLayout() {
  return { left: 34, right: 14, top: 16, bottom: 28 };
}

function defaultToneEqualizerNodes() {
  return [-6, -3, 0, 3, 6].map((inputEv) => ({ input_ev: inputEv, adjustment_ev: 0 }));
}

function formatSdrBandLevel(value) {
  return `${Math.round(value * 100)}%`;
}

function matchHdrBandsToSdr() {
  if (!state.session) return;
  state.adjustments.sdr.tone_equalizer_nodes = currentToneEqualizerNodes("hdr");
  state.adjustments.sdr.tone_equalizer_influence_radius = state.adjustments.hdr.tone_equalizer_influence_radius;
  state.adjustments.sdr.tone_equalizer_smoothing = state.adjustments.hdr.tone_equalizer_smoothing;
  state.adjustments.sdr.tone_equalizer_section_enabled = true;
  syncToneEqualizerControls("sdr");
  drawToneEqualizerEditor("sdr");
  renderControlState();
  invalidatePreview("sdr");
  debouncePreview("sdr");
}

