function renderMaskTreeEditor(local) {
  const leaf = selectedMaskLeaf(local);
  els.localMaskFooterActions?.append(els.localInvert);
  els.localMaskTreeSummary.textContent = "";
  if (els.localGradientControls) {
    els.localGradientControls.textContent = "";
    els.localGradientControls.classList.add("hidden");
  }
  if (state.selectedSubMaskId) appendLocalMaskComparisonLegend();
  if (!leaf) return;
  if (leaf.type === "luminance_range") {
    const panel = createLocalMaskSubpanel("Luma Controls", "Scene luminance range");
    const helper = document.createElement("p");
    helper.className = "luma-sampling-hint";
    helper.textContent = "Choose a false-color band or sample the image. Presets and samples reset refinement; Alt-sampling removes tones.";
    panel.append(helper, createLuminanceRangeControl(local, leaf));
    [
      { name: "mask_feather", label: "Feather", min: 0, max: 100, step: 1, value: Number(leaf.mask_feather || 0) * 2000, defaultValue: 0, display: (value) => `${Math.round(value)}%`, store: (value) => value / 2000 },
      { name: "mask_opacity", label: "Opacity", min: 0, max: 100, step: 1, value: Number(leaf.mask_opacity ?? 1) * 100, defaultValue: 100, display: (value) => `${Math.round(value)}%`, store: (value) => value / 100 },
    ].forEach((definition) => appendLocalMaskSlider(panel, leaf, definition, { authoritativePreview: true }));
    els.localMaskTreeSummary.append(panel);
  } else if (leaf.type === "linear_gradient") {
    renderGradientControls(local, leaf);
  } else if (leaf.type === "brush") {
    const settings = brushSettings(leaf);
    const hasStrokes = Boolean((leaf.strokes || []).length);
    const brushPanel = createLocalMaskSubpanel("Brush Controls", "New strokes");
    [
      { name: "brush_radius", label: "Size", min: 0.002, max: 0.2, step: 0.001, value: settings.radius, defaultValue: 0.025, display: (value) => `${(value * 200).toFixed(1)}%` },
      { name: "brush_hardness", label: "Feather", min: 0, max: 100, step: 1, value: (1 - settings.hardness) * 100, defaultValue: 25, display: (value) => `${Math.round(value)}%`, store: (value) => 1 - value / 100 },
      { name: "brush_flow", label: "Flow", min: 1, max: 100, step: 1, value: settings.flow * 100, defaultValue: 100, display: (value) => `${Math.round(value)}%`, store: (value) => value / 100 },
      { name: "brush_opacity", label: "Density", min: 1, max: 100, step: 1, value: settings.opacity * 100, defaultValue: 100, display: (value) => `${Math.round(value)}%`, store: (value) => value / 100 },
    ].forEach((definition) => appendLocalMaskSlider(brushPanel, leaf, definition, {
      commit: () => commitSelectedLocal({ refreshPreview: false }),
      previewBrush: true,
    }));

    const maskPanel = createLocalMaskSubpanel("Mask Controls", hasStrokes ? "All strokes" : "Paint to enable");
    [
      { name: "mask_opacity", label: "Opacity", min: 0, max: 100, step: 1, value: Number(leaf.mask_opacity ?? 1) * 100, defaultValue: 100, display: (value) => `${Math.round(value)}%`, store: (value) => value / 100 },
      { name: "mask_shift_edge", label: "Shift Edge", min: -100, max: 100, step: 1, value: Number(leaf.mask_shift_edge || 0) * 2000, defaultValue: 0, display: (value) => `${value > 0 ? "+" : ""}${Math.round(value)}%`, store: (value) => value / 2000 },
      { name: "mask_feather", label: "Feather", min: 0, max: 100, step: 1, value: Number(leaf.mask_feather || 0) * 2000, defaultValue: 0, display: (value) => `${Math.round(value)}%`, store: (value) => value / 2000 },
    ].forEach((definition) => appendLocalMaskSlider(maskPanel, leaf, definition, {
      disabled: !hasStrokes,
      hideBrushPreview: true,
    }));
    const actions = document.createElement("div");
    actions.className = "local-brush-actions";
    const undoStroke = document.createElement("button");
    undoStroke.type = "button";
    undoStroke.textContent = "Undo stroke";
    undoStroke.disabled = !hasStrokes;
    undoStroke.addEventListener("click", () => {
      leaf.strokes.pop();
      commitSelectedLocal();
    });
    const clearStrokes = document.createElement("button");
    clearStrokes.type = "button";
    clearStrokes.textContent = "Clear brush";
    clearStrokes.disabled = !hasStrokes;
    clearStrokes.addEventListener("click", () => {
      leaf.strokes = [];
      commitSelectedLocal();
    });
    actions.append(clearStrokes, undoStroke);
    els.localInvert.textContent = selectedMaskExpression(local)?.inverted ? "Restore Mask" : "Invert Mask";
    els.localInvert.disabled = !hasStrokes;
    maskPanel.append(actions);
    els.localMaskTreeSummary.append(brushPanel, maskPanel);
  } else if (leaf.type === "path") {
    renderPathControls(local, leaf);
  }
}

function renderPathControls(local, leaf) {
  const panel = createLocalMaskSubpanel("Path Controls", state.localPathDraft ? "Click for corners · drag for curves" : "Edit one boundary at a time");
  const modeSwitch = document.createElement("div");
  modeSwitch.className = "path-edit-mode";
  modeSwitch.setAttribute("role", "group");
  modeSwitch.setAttribute("aria-label", "Path boundary to edit");
  for (const mode of ["path", "feather"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "path-mode-button";
    button.textContent = mode === "path" ? "Path" : "Feather";
    button.classList.toggle("active", state.localPathEditMode === mode);
    button.setAttribute("aria-pressed", String(state.localPathEditMode === mode));
    button.disabled = Boolean(state.localPathDraft && mode === "feather");
    button.addEventListener("click", async () => {
      if (mode === "feather") {
        if (leaf.feather_mode !== "outer_boundary") leaf.feather_mode = "outer_boundary";
        materializeFeatherNodes(leaf);
      }
      state.localPathEditMode = mode;
      state.selectedPathNode = null;
      state.pathKeyboardTarget = "node";
      renderMaskTreeEditor(local);
      queueLocalMaskOverlayRender();
      if (mode === "feather") await commitSelectedLocal();
    });
    modeSwitch.append(button);
  }
  panel.append(modeSwitch);

  if (!state.localPathDraft) {
    const nodes = activePathNodes(leaf);
    const selected = state.selectedPathNode === null ? null : nodes[state.selectedPathNode];
    const status = document.createElement("p");
    status.className = "path-node-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = selected
      ? `${state.localPathEditMode === "path" ? "Path" : "Feather"} node ${state.selectedPathNode + 1} of ${nodes.length} · ${selected.node_type}`
      : "Select a node to edit its profile.";
    panel.append(status);

    const nodeModes = document.createElement("div");
    nodeModes.className = "path-node-modes";
    nodeModes.setAttribute("role", "group");
    nodeModes.setAttribute("aria-label", "Selected node profile");
    for (const nodeType of ["sharp", "smooth"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `path-node-mode path-node-mode-${nodeType}`;
      button.disabled = !selected;
      button.classList.toggle("active", selected?.node_type === nodeType);
      button.setAttribute("aria-pressed", String(selected?.node_type === nodeType));
      button.title = nodeType === "sharp" ? "Retract handles and make a sharp corner" : "Create a continuous smooth tangent";
      const icon = document.createElement("span");
      icon.className = "path-node-mode-icon";
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = nodeType === "sharp" ? "Sharp" : "Smooth";
      button.append(icon, label);
      button.addEventListener("click", () => setSelectedPathNodeType(leaf, nodeType));
      nodeModes.append(button);
    }
    panel.append(nodeModes);
  }

  panel.append(createPathFeatherControl(local, leaf));
  appendLocalMaskSlider(panel, leaf, {
    name: "feather_softness",
    label: "Softness",
    min: 0,
    max: 100,
    step: 1,
    value: Number(leaf.feather_softness || 0) * 100,
    defaultValue: 0,
    display: (value) => `${Math.round(value)}%`,
    store: (value) => value / 100,
  }, { authoritativePreview: true });
  appendLocalMaskSlider(panel, leaf, {
    name: "mask_opacity",
    label: "Opacity",
    min: 0,
    max: 100,
    step: 1,
    value: Number(leaf.mask_opacity ?? 1) * 100,
    defaultValue: 100,
    display: (value) => `${Math.round(value)}%`,
    store: (value) => value / 100,
  });
  const actions = document.createElement("div");
  actions.className = "path-feather-actions";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset feather shape";
  reset.disabled = state.localPathDraft || leaf.feather_mode !== "outer_boundary";
  reset.addEventListener("click", () => {
    leaf.feather_nodes = uniformFeatherNodes(leaf.nodes, Number(leaf.feather || 0));
    state.localPathEditMode = "feather";
    state.selectedPathNode = null;
    scheduleSpatialMaskPreview(local);
    renderMaskTreeEditor(local);
    queueLocalMaskOverlayRender();
    commitSelectedLocal();
  });
  actions.append(reset);
  panel.append(actions);
  els.localMaskTreeSummary.append(panel);
}

function createPathFeatherControl(local, leaf) {
  const label = document.createElement("label");
  label.className = "local-brush-control control-row instrument-slider-control";
  const heading = document.createElement("span");
  heading.className = "instrument-control-label";
  heading.textContent = "Feather";
  const output = document.createElement("output");
  output.textContent = `${Math.round(Number(leaf.feather || 0) * 200)}%`;
  const input = document.createElement("input");
  Object.assign(input, { type: "range", min: "0", max: "100", step: "1", value: String(Number(leaf.feather || 0) * 200) });
  input.dataset.defaultValue = "4";
  const status = document.createElement("span");
  status.className = "path-feather-status";
  status.setAttribute("aria-live", "polite");
  const updateStatus = (message = "") => {
    const outer = flattenPathNodes(leaf.feather_nodes || []);
    const merging = outer.length >= 3 && !simplePathPolygon(outer);
    status.textContent = message || (merging ? "Feather regions are merging." : "");
    status.classList.toggle("merging", merging && !message);
    status.classList.toggle("blocking", Boolean(message));
  };
  updateStatus();
  input.addEventListener("input", () => {
    const previous = Number(leaf.feather || 0);
    const next = Number(input.value) / 200;
    if (leaf.feather_nodes?.length) {
      const proposed = offsetBoundaryNodes(leaf.nodes, leaf.feather_nodes, previous, next);
      if (!validFeatherGeometry(leaf.nodes, proposed)) {
        input.value = String(previous * 200);
        state.pathInvalidGesture = true;
        updateStatus("Feather stopped because the guide crossed inside the Path.");
        queueLocalMaskOverlayRender();
        return;
      }
      leaf.feather_nodes = proposed;
    }
    leaf.feather = next;
    output.textContent = `${Math.round(Number(input.value))}%`;
    state.pathInvalidGesture = false;
    updateStatus();
    scheduleSpatialMaskPreview(local);
    queueLocalMaskOverlayRender();
  });
  input.addEventListener("change", () => commitSelectedLocal());
  bindLocalPreviewInteraction(input);
  label.append(heading, input, output, status);
  enhanceRangeControl(input);
  return label;
}

function createLuminanceRangeControl(local, leaf) {
  const minEv = referenceNitsToEv(LUMA_RANGE_MIN_NITS);
  const maxEv = referenceNitsToEv(LUMA_RANGE_MAX_NITS);
  const initialReferenceStart = leaf.reference_start_ev !== null && leaf.reference_start_ev !== undefined && Number.isFinite(Number(leaf.reference_start_ev))
    ? Number(leaf.reference_start_ev)
    : Number(leaf.full_start_ev);
  const initialReferenceEnd = leaf.reference_end_ev !== null && leaf.reference_end_ev !== undefined && Number.isFinite(Number(leaf.reference_end_ev))
    ? Number(leaf.reference_end_ev)
    : Number(leaf.full_end_ev);
  leaf.reference_start_ev = clamp(initialReferenceStart, minEv, maxEv - 0.01);
  leaf.reference_end_ev = clamp(initialReferenceEnd, leaf.reference_start_ev + 0.01, maxEv);
  setLuminanceRefinedRange(
    leaf,
    clamp(Number(leaf.full_start_ev), leaf.reference_start_ev, leaf.reference_end_ev - 0.01),
    clamp(Number(leaf.full_end_ev), leaf.reference_start_ev + 0.01, leaf.reference_end_ev),
  );

  const section = document.createElement("section");
  section.className = "luma-range-control";
  const presetHeading = document.createElement("div");
  presetHeading.className = "luma-range-heading";
  const presetTitle = document.createElement("span");
  presetTitle.textContent = "Quick range";
  const presetSummary = document.createElement("output");
  presetHeading.append(presetTitle, presetSummary);

  const presetGrid = document.createElement("div");
  presetGrid.className = "luma-preset-grid";
  presetGrid.setAttribute("role", "group");
  presetGrid.setAttribute("aria-label", "False-color luminance ranges");
  const bands = falseColorBands();

  const rangeHeading = document.createElement("div");
  rangeHeading.className = "luma-range-heading luma-nit-range-heading";
  const rangeTitle = document.createElement("span");
  rangeTitle.textContent = "Reference range";
  const rangeSummary = document.createElement("output");
  rangeHeading.append(rangeTitle, rangeSummary);

  const slider = document.createElement("div");
  slider.className = "luma-nit-range luma-reference-range";
  const rail = document.createElement("span");
  rail.className = "luma-nit-range-rail";
  const fill = document.createElement("span");
  fill.className = "luma-nit-range-fill";
  slider.append(rail, fill);

  const fields = ["reference_start_ev", "reference_end_ev"];
  const labels = ["Lower reference-nit edge", "Upper reference-nit edge"];
  const inputs = fields.map((field, index) => {
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: String(minEv), max: String(maxEv), step: "0.01", value: String(clamp(Number(leaf[field]), minEv, maxEv)) });
    input.dataset.rangeHandle = String(index);
    input.setAttribute("aria-label", labels[index]);
    input.addEventListener("input", () => {
      const gap = 0.01;
      let start = Number(inputs[0].value);
      let end = Number(inputs[1].value);
      if (index === 0) start = Math.min(start, end - gap);
      else end = Math.max(end, start + gap);
      setLuminanceReferenceRange(leaf, start, end, { preserveRefinement: true });
      initializedLuminanceSampleLeaves.add(leaf);
      updateLuminanceRangeControl();
      scheduleSpatialMaskPreview(local);
      queueLocalMaskOverlayRender();
    });
    input.addEventListener("change", () => commitSelectedLocal());
    bindLocalPreviewInteraction(input);
    slider.append(input);
    return input;
  });

  const values = document.createElement("div");
  values.className = "luma-nit-range-values";
  const valueOutputs = labels.map((label) => {
    const output = document.createElement("output");
    output.title = label;
    values.append(output);
    return output;
  });
  const scale = document.createElement("div");
  scale.className = "luma-range-scale luma-nit-range-scale";
  scale.innerHTML = `<span>0.1 nit</span><span>${projectReferenceWhiteNits()} nit · 0 EV</span><span>10,000 nit</span>`;

  const refineHeading = document.createElement("div");
  refineHeading.className = "luma-range-heading luma-refine-range-heading";
  const refineTitle = document.createElement("span");
  refineTitle.textContent = "Refine range";
  const refineSummary = document.createElement("output");
  refineHeading.append(refineTitle, refineSummary);

  const refineSlider = document.createElement("div");
  refineSlider.className = "luma-nit-range luma-refine-range";
  const refineRail = document.createElement("span");
  refineRail.className = "luma-nit-range-rail";
  const refineFill = document.createElement("span");
  refineFill.className = "luma-nit-range-fill";
  refineSlider.append(refineRail, refineFill);
  const refineInputs = ["Lower refined edge", "Upper refined edge"].map((label, index) => {
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: "0", max: "1", step: "0.001", value: index ? "1" : "0" });
    input.dataset.rangeHandle = String(index);
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => {
      const gap = 0.001;
      let start = Number(refineInputs[0].value);
      let end = Number(refineInputs[1].value);
      if (index === 0) start = Math.min(start, end - gap);
      else end = Math.max(end, start + gap);
      const referenceStart = Number(leaf.reference_start_ev);
      const referenceSpan = Math.max(Number(leaf.reference_end_ev) - referenceStart, 0.01);
      setLuminanceRefinedRange(
        leaf,
        referenceStart + start * referenceSpan,
        referenceStart + end * referenceSpan,
      );
      updateLuminanceRangeControl();
      scheduleSpatialMaskPreview(local);
      queueLocalMaskOverlayRender();
    });
    input.addEventListener("change", () => commitSelectedLocal());
    bindLocalPreviewInteraction(input);
    refineSlider.append(input);
    return input;
  });
  const refineValues = document.createElement("div");
  refineValues.className = "luma-nit-range-values luma-refine-range-values";
  const refineValueOutputs = ["Refined lower bound", "Refined upper bound"].map((label) => {
    const output = document.createElement("output");
    output.title = label;
    refineValues.append(output);
    return output;
  });

  const bandButtons = bands.map(({ lower, upper, paletteIndex }, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "luma-preset-button";
    button.dataset.bandIndex = String(index);
    const swatch = document.createElement("i");
    swatch.className = "false-color-key-swatch";
    swatch.style.backgroundColor = exposureBandColor(paletteIndex);
    const label = document.createElement("span");
    label.textContent = lumaBandLabel(lower, upper);
    button.append(swatch, label);
    button.addEventListener("click", async () => {
      const start = referenceNitsToEv(lower ?? LUMA_RANGE_MIN_NITS);
      const end = referenceNitsToEv(upper ?? LUMA_RANGE_MAX_NITS);
      setLuminanceReferenceRange(leaf, start, end, { preserveRefinement: false });
      initializedLuminanceSampleLeaves.add(leaf);
      updateLuminanceRangeControl();
      scheduleSpatialMaskPreview(local);
      queueLocalMaskOverlayRender();
      await commitSelectedLocal();
    });
    presetGrid.append(button);
    return button;
  });

  function updateLuminanceRangeControl() {
    const start = clamp(Number(leaf.reference_start_ev), minEv, maxEv);
    const end = clamp(Number(leaf.reference_end_ev), minEv, maxEv);
    inputs[0].value = String(start);
    inputs[1].value = String(end);
    const startPosition = ((start - minEv) / (maxEv - minEv)) * 100;
    const endPosition = ((end - minEv) / (maxEv - minEv)) * 100;
    slider.style.setProperty("--luma-range-start", `${startPosition}%`);
    slider.style.setProperty("--luma-range-end", `${endPosition}%`);
    const lowerNits = evToReferenceNits(start);
    const upperNits = evToReferenceNits(end);
    valueOutputs[0].textContent = formatReferenceNits(lowerNits);
    valueOutputs[1].textContent = formatReferenceNits(upperNits);
    rangeSummary.textContent = `${formatReferenceNits(lowerNits)} - ${formatReferenceNits(upperNits)}`;
    const referenceSpan = Math.max(end - start, 0.01);
    const refineStart = clamp((Number(leaf.full_start_ev) - start) / referenceSpan, 0, 1);
    const refineEnd = clamp((Number(leaf.full_end_ev) - start) / referenceSpan, refineStart, 1);
    refineInputs[0].value = String(refineStart);
    refineInputs[1].value = String(refineEnd);
    refineSlider.style.setProperty("--luma-range-start", `${refineStart * 100}%`);
    refineSlider.style.setProperty("--luma-range-end", `${refineEnd * 100}%`);
    const refinedLowerNits = evToReferenceNits(leaf.full_start_ev);
    const refinedUpperNits = evToReferenceNits(leaf.full_end_ev);
    refineValueOutputs[0].textContent = formatReferenceNits(refinedLowerNits);
    refineValueOutputs[1].textContent = formatReferenceNits(refinedUpperNits);
    refineSummary.textContent = `${formatReferenceNits(refinedLowerNits)} - ${formatReferenceNits(refinedUpperNits)}`;
    let selectedLabel = "Custom";
    bandButtons.forEach((button, index) => {
      const band = bands[index];
      const bandStart = referenceNitsToEv(band.lower ?? LUMA_RANGE_MIN_NITS);
      const bandEnd = referenceNitsToEv(band.upper ?? LUMA_RANGE_MAX_NITS);
      const active = Math.abs(start - bandStart) < 0.015 && Math.abs(end - bandEnd) < 0.015;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active) selectedLabel = lumaBandLabel(band.lower, band.upper);
    });
    presetSummary.textContent = selectedLabel;
  }

  section.append(presetHeading, presetGrid, rangeHeading, slider, values, scale, refineHeading, refineSlider, refineValues);
  updateLuminanceRangeControl();
  return section;
}

function setLuminanceReferenceRange(leaf, startEv, endEv, { preserveRefinement = true } = {}) {
  const start = Number(clamp(startEv, -24, 23.99).toFixed(4));
  const end = Number(clamp(endEv, start + 0.01, 24).toFixed(4));
  const previousStart = leaf.reference_start_ev !== null && leaf.reference_start_ev !== undefined && Number.isFinite(Number(leaf.reference_start_ev)) ? Number(leaf.reference_start_ev) : Number(leaf.full_start_ev);
  const previousEnd = leaf.reference_end_ev !== null && leaf.reference_end_ev !== undefined && Number.isFinite(Number(leaf.reference_end_ev)) ? Number(leaf.reference_end_ev) : Number(leaf.full_end_ev);
  const previousSpan = Math.max(previousEnd - previousStart, 0.01);
  const refinedStart = preserveRefinement ? clamp((Number(leaf.full_start_ev) - previousStart) / previousSpan, 0, 1) : 0;
  const refinedEnd = preserveRefinement ? clamp((Number(leaf.full_end_ev) - previousStart) / previousSpan, refinedStart, 1) : 1;
  leaf.reference_start_ev = start;
  leaf.reference_end_ev = end;
  const span = end - start;
  setLuminanceRefinedRange(leaf, start + refinedStart * span, start + refinedEnd * span);
}

function setLuminanceRefinedRange(leaf, startEv, endEv) {
  const referenceStart = leaf.reference_start_ev !== null && leaf.reference_start_ev !== undefined && Number.isFinite(Number(leaf.reference_start_ev)) ? Number(leaf.reference_start_ev) : -24;
  const referenceEnd = leaf.reference_end_ev !== null && leaf.reference_end_ev !== undefined && Number.isFinite(Number(leaf.reference_end_ev)) ? Number(leaf.reference_end_ev) : 24;
  const start = clamp(Number(clamp(startEv, referenceStart, referenceEnd - 0.01).toFixed(4)), referenceStart, referenceEnd - 0.01);
  const end = clamp(Number(clamp(endEv, start + 0.01, referenceEnd).toFixed(4)), start + 0.01, referenceEnd);
  leaf.full_start_ev = start;
  leaf.full_end_ev = end;
  leaf.fade_in_start_ev = Number(clamp(start - LUMA_TONAL_RAMP_EV, -24, start).toFixed(4));
  leaf.fade_out_end_ev = Number(clamp(end + LUMA_TONAL_RAMP_EV, end, 24).toFixed(4));
}

function renderGradientControls(local, leaf) {
  if (!els.localGradientControls) return;
  els.localGradientControls.classList.remove("hidden");
  const panel = createLocalMaskSubpanel("Gradient Controls", "Spatial and content range");
  [
    { name: "mask_opacity", label: "Opacity", min: 0, max: 100, step: 1, value: Number(leaf.mask_opacity ?? 1) * 100, defaultValue: 100, display: (value) => `${Math.round(value)}%`, store: (value) => value / 100 },
    { name: "gradient_fan", label: "Fan", min: -100, max: 100, step: 1, value: Number(leaf.gradient_fan || 0) * 100, defaultValue: 0, display: (value) => `${value > 0 ? "+" : ""}${Math.round(value)}%`, store: (value) => value / 100 },
  ].forEach((definition) => appendLocalMaskSlider(panel, leaf, definition, { authoritativePreview: true }));
  panel.append(createGradientLuminanceRange(local, leaf));
  els.localGradientControls.append(panel);
}

function createGradientLuminanceRange(local, leaf) {
  const section = document.createElement("section");
  section.className = "gradient-luma-control";
  const heading = document.createElement("div");
  heading.className = "gradient-luma-heading";
  const title = document.createElement("span");
  title.textContent = "Luminance range";
  const toggleLabel = document.createElement("label");
  toggleLabel.className = "gradient-luma-toggle";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = Boolean(leaf.gradient_luma_enabled);
  const toggleCopy = document.createElement("span");
  toggleCopy.textContent = "Enable";
  toggleLabel.append(toggle, toggleCopy);
  heading.append(title, toggleLabel);

  const ramp = document.createElement("div");
  ramp.className = "gradient-luma-ramp";
  const fields = ["fade_in_start_ev", "full_start_ev", "full_end_ev", "fade_out_end_ev"];
  const defaults = [-12, -8, 6, 10];
  const handleLabels = ["Dark fade", "Dark full", "Light full", "Light fade"];
  const track = document.createElement("span");
  track.className = "gradient-luma-track";
  const fadeInRegion = document.createElement("span");
  fadeInRegion.className = "gradient-luma-region gradient-luma-region-fade-in";
  const fullRegion = document.createElement("span");
  fullRegion.className = "gradient-luma-region gradient-luma-region-full";
  const fadeOutRegion = document.createElement("span");
  fadeOutRegion.className = "gradient-luma-region gradient-luma-region-fade-out";
  track.append(fadeInRegion, fullRegion, fadeOutRegion);
  ramp.append(track);
  const inputs = fields.map((field, index) => {
    if (!Number.isFinite(Number(leaf[field]))) leaf[field] = defaults[index];
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: "-24", max: "24", step: "0.1", value: String(leaf[field]) });
    input.dataset.defaultValue = String(defaults[index]);
    input.dataset.rangeHandle = String(index);
    input.setAttribute("aria-label", handleLabels[index]);
    input.addEventListener("input", () => {
      const lower = index === 0 ? -24 : Number(leaf[fields[index - 1]]);
      const upper = index === fields.length - 1 ? 24 : Number(leaf[fields[index + 1]]);
      leaf[field] = Number(clamp(Number(input.value), lower, upper).toFixed(2));
      leaf.gradient_luma_enabled = true;
      updateGradientLuminanceRamp();
      state.localMaskDraftDirty = true;
      scheduleAuthoritativeLocalMaskDraft(local);
      scheduleLocalPreview({ spatialMaskChanged: true });
      queueLocalMaskOverlayRender();
    });
    input.addEventListener("change", () => commitSelectedLocal());
    bindLocalPreviewInteraction(input);
    ramp.append(input);
    return input;
  });
  const values = document.createElement("div");
  values.className = "gradient-luma-values";
  const valueOutputs = handleLabels.map((label) => {
    const output = document.createElement("output");
    output.title = label;
    values.append(output);
    return output;
  });
  const signedEv = (value) => `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(1)}`;
  function updateGradientLuminanceRamp() {
    const positions = fields.map((field, index) => {
      const value = clamp(Number(leaf[field]), -24, 24);
      inputs[index].value = String(value);
      inputs[index].setAttribute("aria-valuetext", `${signedEv(value)} EV`);
      valueOutputs[index].textContent = signedEv(value);
      return (value + 24) / 48 * 100;
    });
    ramp.style.setProperty("--gradient-luma-fade-in-start", `${positions[0]}%`);
    ramp.style.setProperty("--gradient-luma-full-start", `${positions[1]}%`);
    ramp.style.setProperty("--gradient-luma-full-end", `${positions[2]}%`);
    ramp.style.setProperty("--gradient-luma-fade-out-end", `${positions[3]}%`);
    ramp.classList.toggle("enabled", Boolean(leaf.gradient_luma_enabled));
    toggle.checked = Boolean(leaf.gradient_luma_enabled);
  }
  toggle.addEventListener("change", () => {
    leaf.gradient_luma_enabled = toggle.checked;
    updateGradientLuminanceRamp();
    state.localMaskDraftDirty = true;
    scheduleAuthoritativeLocalMaskDraft(local);
    scheduleLocalPreview({ spatialMaskChanged: true });
    queueLocalMaskOverlayRender();
    commitSelectedLocal();
  });
  bindLocalPreviewInteraction(toggle);
  const scale = document.createElement("div");
  scale.className = "gradient-luma-scale";
  scale.innerHTML = "<span>Blacks</span><span>Midtones</span><span>Highlights</span>";
  updateGradientLuminanceRamp();
  section.append(heading, ramp, values, scale);
  return section;
}

function createLocalMaskSubpanel(title, note) {
  const panel = document.createElement("section");
  panel.className = "local-mask-subpanel";
  const heading = document.createElement("div");
  heading.className = "local-mask-subpanel-heading";
  const label = document.createElement("strong");
  label.textContent = title;
  const hint = document.createElement("span");
  hint.textContent = note;
  heading.append(label, hint);
  panel.append(heading);
  return panel;
}

function appendLocalMaskSlider(panel, leaf, definition, options = {}) {
  const { name, label: labelText, min, max, step, value, defaultValue = value, display, store = (next) => next } = definition;
  const label = document.createElement("label");
  label.className = "local-brush-control control-row instrument-slider-control";
  const heading = document.createElement("span");
  heading.className = "instrument-control-label";
  heading.textContent = labelText;
  const output = document.createElement("output");
  output.textContent = display(value);
  const input = document.createElement("input");
  Object.assign(input, { type: "range", min: String(min), max: String(max), step: String(step), value: String(value), disabled: Boolean(options.disabled) });
  input.dataset.localMaskParam = name;
  input.dataset.defaultValue = String(defaultValue);
  if (options.previewBrush) {
    input.addEventListener("focus", () => showBrushSettingsPreview(leaf));
    input.addEventListener("pointerdown", () => showBrushSettingsPreview(leaf));
  }
  if (options.hideBrushPreview) {
    input.addEventListener("focus", hideBrushSettingsPreview);
    input.addEventListener("pointerdown", hideBrushSettingsPreview);
  }
  input.addEventListener("input", () => {
    const next = Number(input.value);
    leaf[name] = store(next);
    const influenceOnly = name === "mask_opacity";
    const spatialMaskChanged = !influenceOnly && (name.startsWith("mask_") || options.authoritativePreview);
    if (spatialMaskChanged) {
      scheduleSpatialMaskPreview(selectedLocal());
    } else if (influenceOnly) {
      scheduleLocalPreview();
    }
    output.textContent = display(next);
    if (options.previewBrush) showBrushSettingsPreview(leaf);
    if (options.hideBrushPreview) hideBrushSettingsPreview();
    queueLocalMaskOverlayRender();
  });
  input.addEventListener("change", () => {
    if (options.commit) options.commit();
    else commitSelectedLocal({ refreshPreview: name !== "mask_opacity" });
  });
  bindLocalPreviewInteraction(input);
  label.append(heading, input, output);
  panel.append(label);
  enhanceRangeControl(input);
}

function brushSettings(leaf) {
  const fallback = leaf?.strokes?.at(-1) || {};
  return {
    radius: Number(leaf?.brush_radius ?? fallback.radius ?? 0.025),
    hardness: Number(leaf?.brush_hardness ?? fallback.hardness ?? 0.75),
    flow: Number(leaf?.brush_flow ?? fallback.flow ?? 1),
    opacity: Number(leaf?.brush_opacity ?? fallback.opacity ?? 1),
    smoothing: Number(leaf?.brush_smoothing ?? fallback.smoothing ?? 0.35),
  };
}

function brushStrokeSettings(leaf) {
  const settings = brushSettings(leaf);
  const feather = brushFeatherExtent(settings.hardness);
  const radius = settings.radius * (1 + feather);
  return {
    ...settings,
    radius,
    hardness: settings.radius / Math.max(radius, 1e-6),
  };
}

function brushFeatherExtent(hardness) {
  const amount = 1 - clamp(Number(hardness), 0, 1);
  // A perceptual curve keeps the first few slider points precise while still
  // reaching the full outer falloff at 100%. The result is strictly monotonic.
  return Math.pow(amount, 1.6);
}

function showBrushSettingsPreview(leaf) {
  const settings = brushSettings(leaf);
  const featherRadius = settings.radius * (1 + brushFeatherExtent(settings.hardness));
  state.localBrushCursor = {
    x: clamp(1 - featherRadius - 0.012, featherRadius, 1 - featherRadius),
    y: clamp(0.5, featherRadius, 1 - featherRadius),
  };
  state.localBrushPreviewPinned = true;
  queueLocalMaskOverlayRender();
}

function hideBrushSettingsPreview() {
  state.localBrushPreviewPinned = false;
  state.localBrushCursor = null;
  queueLocalMaskOverlayRender();
}

