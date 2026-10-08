function initializeInstrumentShell() {
  initializeLayoutState();
  initializeSourceRailState();
  enhanceRangeControls();
  enhanceEditableGradeValues();
  initSplitter({
    element: els.sourceSplitter,
    stateKey: "railW",
    cssVar: "--rail-w",
    axis: "x",
    direction: 1,
  });
  initSplitter({
    element: els.gradeSplitter,
    stateKey: "gradeW",
    cssVar: "--grade-w",
    axis: "x",
    direction: -1,
  });
  initSplitter({
    element: els.dockSplitter,
    stateKey: "dockH",
    cssVar: "--dock-h",
    axis: "y",
    direction: -1,
  });
}

function initializeSourceRailState() {
  const media = typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_WORKSPACE_QUERY) : null;
  state.compactWorkspace = Boolean(media?.matches);
  state.compactSourceOpen = false;
  state.wideSourceCollapsed = false;
  applyResponsiveWorkspaceState();
  media?.addEventListener?.("change", (event) => {
    state.compactWorkspace = event.matches;
    state.compactSourceOpen = false;
    closeOverlayPopover({ restoreFocus: false });
    closePreviewPopover({ restoreFocus: false });
    applyResponsiveWorkspaceState();
    scheduleLayoutSettled();
  });
}

function applyResponsiveWorkspaceState() {
  const rail = els.sourceRailExpand.closest(".source-rail");
  const collapsed = state.compactWorkspace ? !state.compactSourceOpen : state.wideSourceCollapsed;
  els.appShell.classList.toggle("compact-workspace", state.compactWorkspace);
  rail.classList.toggle("collapsed", collapsed);
  els.appShell.classList.toggle("source-collapsed", state.compactWorkspace || collapsed);
  els.appShell.classList.toggle("source-overlay-open", state.compactWorkspace && state.compactSourceOpen);
  els.sourceRailExpand.setAttribute("aria-expanded", String(!collapsed));
  els.sourceRailExpand.setAttribute("aria-label", collapsed ? "Expand source metadata" : "Collapse source metadata");
  els.sourceRailExpand.title = collapsed ? "Expand metadata" : "Collapse metadata";
}

function toggleSourceRail() {
  if (state.compactWorkspace) state.compactSourceOpen = !state.compactSourceOpen;
  else state.wideSourceCollapsed = !state.wideSourceCollapsed;
  applyResponsiveWorkspaceState();
  scheduleLayoutSettled();
}

function revealSourceRail() {
  const collapsed = state.compactWorkspace ? !state.compactSourceOpen : state.wideSourceCollapsed;
  if (!collapsed) return;
  if (state.compactWorkspace) state.compactSourceOpen = true;
  else state.wideSourceCollapsed = false;
  applyResponsiveWorkspaceState();
  scheduleLayoutSettled();
}

function closeCompactSourceRail({ restoreFocus = false } = {}) {
  if (!state.compactWorkspace || !state.compactSourceOpen) return;
  state.compactSourceOpen = false;
  applyResponsiveWorkspaceState();
  scheduleLayoutSettled();
  if (restoreFocus) els.sourceRailExpand.focus();
}

function initializeLayoutState() {
  state.layout = { ...LAYOUT_DEFAULTS };
  applyLayoutState();
}

function applyLayoutState() {
  // Proof and export rails are fixed siblings of .app-shell. Keep layout
  // variables on the shared root so those panels track the same splitter.
  document.documentElement.style.setProperty("--rail-w", `${state.layout.railW}px`);
  document.documentElement.style.setProperty("--grade-w", `${state.layout.gradeW}px`);
  document.documentElement.style.setProperty("--dock-h", `${state.layout.dockH}px`);
  state.dockCollapsed = !state.layout.dockOpen;
  state.activeDockTab = state.layout.dockTab;
  els.analysisDock.classList.toggle("collapsed", state.dockCollapsed);
  renderDockCollapseControl();
  els.dockTabs.forEach((button) => {
    const active = button.dataset.dockTab === state.activeDockTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const technical = readoutDockTab(state.activeDockTab);
  els.scopeView.classList.toggle("hidden", technical);
  els.technicalView.classList.toggle("hidden", !technical);
  renderReadoutPanelMode(state.activeDockTab);
  if (technical) {
    els.scopeMode.value = state.activeDockTab;
  } else {
    state.scopeMode = state.activeDockTab === "vectorscope"
      ? "vectorscope"
      : state.activeDockTab === "waveform" || state.activeDockTab === "parade" ? "waveform" : "histogram";
    state.scopeChannelMode = state.activeDockTab === "parade" ? "parade" : "composite";
    els.scopeMode.value = state.scopeMode;
    els.scopeChannelMode.value = state.scopeChannelMode;
  }
  [els.scopeChannelMode, els.scopeDetail, els.scopeZoom].forEach((control) => { if (control) control.disabled = technical; });
  renderScopeControlAvailability();
  updateSplitterAria();
}

/**
 * Technical and Diagnostics are readouts, not scopes; they share one panel.
 *
 * Technical is a short
 * plain-language list that fits the panel at its minimum height. Diagnostics
 * is the full list it used to be.
 */
function readoutDockTab(tab) {
  return tab === "technical" || tab === "diagnostics";
}

function renderReadoutPanelMode(tab) {
  els.technicalSummary?.classList.toggle("hidden", tab === "diagnostics");
  els.technicalDiagnostics?.classList.toggle("hidden", tab !== "diagnostics");
}

function renderScopeControlAvailability() {
  const technical = state.scopeMode === "technical" || readoutDockTab(state.activeDockTab);
  const vectorscope = state.scopeMode === "vectorscope";
  // Channel selection and nit range do not alter a standards-based
  // vectorscope. Hide them instead of leaving controls that appear to work.
  els.scopeChannelMode?.classList.toggle("hidden", technical || vectorscope);
  if (els.scopeChannelMode) els.scopeChannelMode.disabled = technical || vectorscope;
  const rangeRelevant = !technical && !vectorscope && state.currentView === "hdr";
  els.scopeZoom?.closest(".scope-zoom-control")?.classList.toggle("hidden", !rangeRelevant);
  if (els.scopeZoom) els.scopeZoom.disabled = !rangeRelevant;
  if (els.scopeDetail) els.scopeDetail.disabled = technical;
}

function updateSplitterAria() {
  const entries = [
    [els.sourceSplitter, "railW"],
    [els.gradeSplitter, "gradeW"],
    [els.dockSplitter, "dockH"],
  ];
  entries.forEach(([element, key]) => element?.setAttribute("aria-valuenow", String(Math.round(state.layout[key]))));
}

function scheduleLayoutSettled() {
  window.clearTimeout(state.layoutSettleTimer);
  state.layoutSettleTimer = window.setTimeout(dispatchLayoutSettled, LAYOUT_SETTLE_DELAY);
}

function dispatchLayoutSettled() {
  applyZoomGeometry();
  drawHistogram(state.lastScope || []);
  drawToneEqualizerEditor();
  document.dispatchEvent(new CustomEvent("layout:settled", { detail: { ...state.layout } }));
}

function initSplitter({ element, stateKey, cssVar, axis, direction }) {
  if (!element) return;
  const [minimum, maximum] = LAYOUT_LIMITS[stateKey];
  let frame = null;
  let pendingValue = state.layout[stateKey];

  const writeValue = (requested) => {
    pendingValue = clamp(requested, minimum, maximum);
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      state.layout[stateKey] = pendingValue;
      document.documentElement.style.setProperty(cssVar, `${pendingValue}px`);
      element.setAttribute("aria-valuenow", String(Math.round(pendingValue)));
    });
  };

  const commit = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
      state.layout[stateKey] = pendingValue;
      document.documentElement.style.setProperty(cssVar, `${pendingValue}px`);
    }
    element.classList.remove("dragging");
    document.documentElement.removeAttribute("data-resizing");
    document.documentElement.style.cursor = "";
    scheduleLayoutSettled();
  };

  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const startPosition = axis === "x" ? event.clientX : event.clientY;
    const startValue = state.layout[stateKey];
    element.setPointerCapture(pointerId);
    element.classList.add("dragging");
    document.documentElement.dataset.resizing = "true";
    document.documentElement.style.cursor = axis === "x" ? "col-resize" : "row-resize";

    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const position = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
      writeValue(startValue + (position - startPosition) * direction);
    };
    const stop = (stopEvent) => {
      if (stopEvent.pointerId !== pointerId) return;
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      commit();
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  });

  element.addEventListener("dblclick", (event) => {
    event.preventDefault();
    writeValue(LAYOUT_DEFAULTS[stateKey]);
    commit();
  });

  element.addEventListener("keydown", (event) => {
    const vertical = axis === "y";
    const decreaseKey = vertical ? "ArrowDown" : "ArrowLeft";
    const increaseKey = vertical ? "ArrowUp" : "ArrowRight";
    let next = null;
    if (event.key === decreaseKey) next = state.layout[stateKey] - 8;
    if (event.key === increaseKey) next = state.layout[stateKey] + 8;
    if (event.key === "Home") next = minimum;
    if (event.key === "End") next = maximum;
    if (next === null) return;
    event.preventDefault();
    writeValue(next);
    commit();
  });
}

function initializeBoundedTooltips() {
  const selector = ".help-tip[data-tooltip], .help-tip[data-tip], .tooltip-trigger[data-tooltip], .group-toggle[data-tooltip], .disclosure-trigger[data-tooltip]";
  if (!document.querySelector(selector)) return;
  const tooltip = document.createElement("div");
  tooltip.id = "bounded-help-tooltip";
  tooltip.className = "bounded-help-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);

  let activeTrigger = null;
  let pendingTrigger = null;
  let showTimer = 0;

  const tooltipText = (trigger) => trigger?.dataset.tooltip || trigger?.dataset.tip || "";
  const hide = () => {
    window.clearTimeout(showTimer);
    showTimer = 0;
    pendingTrigger = null;
    activeTrigger = null;
    tooltip.classList.remove("visible");
    tooltip.hidden = true;
  };
  const position = () => {
    if (!activeTrigger || tooltip.hidden || !activeTrigger.isConnected) return hide();
    const visualViewport = window.visualViewport;
    const viewport = {
      left: visualViewport?.offsetLeft || 0,
      top: visualViewport?.offsetTop || 0,
      width: visualViewport?.width || window.innerWidth,
      height: visualViewport?.height || window.innerHeight,
    };
    const margin = 8;
    const gap = 7;
    const triggerRect = activeTrigger.getBoundingClientRect();
    // The stylesheet's readable measure is the cap; the viewport only narrows
    // it further. An inline viewport-wide max-width let copy run on one line.
    tooltip.style.maxWidth = `${Math.max(80, Math.min(TOOLTIP_MAX_WIDTH, viewport.width - margin * 2))}px`;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    const tooltipRect = tooltip.getBoundingClientRect();
    const minimumLeft = viewport.left + margin;
    const maximumLeft = viewport.left + viewport.width - margin - tooltipRect.width;
    const minimumTop = viewport.top + margin;
    const maximumTop = viewport.top + viewport.height - margin - tooltipRect.height;
    // Help for anything inside a side rail opens beside the rail, so it never
    // covers the neighbouring module headers or controls the user is scanning.
    const rail = activeTrigger.closest(TOOLTIP_SIDE_RAILS);
    const railRect = rail?.getBoundingClientRect();
    const besideRail = railRect && railRect.left - gap - tooltipRect.width >= minimumLeft;
    let left;
    let top;
    if (besideRail) {
      left = railRect.left - gap - tooltipRect.width;
      top = clamp(triggerRect.top, minimumTop, Math.max(minimumTop, maximumTop));
    } else {
      left = clamp(
        triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
        minimumLeft,
        Math.max(minimumLeft, maximumLeft),
      );
      const below = triggerRect.bottom + gap;
      const above = triggerRect.top - gap - tooltipRect.height;
      const preferredTop = below <= maximumTop ? below : above;
      top = clamp(preferredTop, minimumTop, Math.max(minimumTop, maximumTop));
    }
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  };
  const show = (trigger) => {
    const text = tooltipText(trigger);
    if (!text || !trigger.isConnected) return hide();
    activeTrigger = trigger;
    pendingTrigger = null;
    tooltip.textContent = text;
    tooltip.hidden = false;
    position();
    tooltip.classList.add("visible");
  };
  const schedule = (trigger) => {
    window.clearTimeout(showTimer);
    if (activeTrigger === trigger) {
      tooltip.textContent = tooltipText(trigger);
      position();
      return;
    }
    pendingTrigger = trigger;
    showTimer = window.setTimeout(() => show(trigger), 600);
  };
  const triggerFromEvent = (event) => event.target instanceof Element
    ? event.target.closest(selector)
    : null;

  document.addEventListener("pointerover", (event) => {
    const trigger = triggerFromEvent(event);
    if (trigger && !trigger.contains(event.relatedTarget)) schedule(trigger);
  });
  // Clicking is acting, not asking: any press dismisses help, including a
  // press on the trigger itself (twirling a module open changes the layout
  // the tooltip was placed against).
  document.addEventListener("pointerdown", () => {
    if (activeTrigger || pendingTrigger) hide();
  }, true);
  document.addEventListener("pointerout", (event) => {
    const trigger = triggerFromEvent(event);
    if (!trigger || trigger.contains(event.relatedTarget)) return;
    // Only keyboard focus keeps help open after the pointer leaves; a click
    // also focuses the trigger and must not pin the tooltip.
    if (trigger.matches(":focus-visible")) return;
    if (activeTrigger === trigger || pendingTrigger === trigger) hide();
  });
  document.addEventListener("focusin", (event) => {
    const trigger = triggerFromEvent(event);
    if (trigger && trigger.matches(":focus-visible")) schedule(trigger);
  });
  document.addEventListener("focusout", (event) => {
    const trigger = triggerFromEvent(event);
    if (!trigger || trigger.matches(":hover")) return;
    if (activeTrigger === trigger || pendingTrigger === trigger) hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (activeTrigger || pendingTrigger)) hide();
  });
  document.addEventListener("scroll", position, true);
  window.addEventListener("resize", position);
  window.visualViewport?.addEventListener("resize", position);
  window.visualViewport?.addEventListener("scroll", position);
}

function toggleOverlayPopover() {
  closePreviewPopover({ restoreFocus: false });
  const open = els.overlayPopover.classList.toggle("hidden") === false;
  els.overlayToggle.setAttribute("aria-expanded", String(open));
}

function closeOverlayPopover({ restoreFocus = true } = {}) {
  els.overlayPopover.classList.add("hidden");
  els.overlayToggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) els.overlayToggle.focus();
}

function togglePreviewPopover() {
  closeOverlayPopover({ restoreFocus: false });
  const open = els.previewPopover.classList.toggle("hidden") === false;
  els.previewToggle.setAttribute("aria-expanded", String(open));
}

function closePreviewPopover({ restoreFocus = true } = {}) {
  els.previewPopover.classList.add("hidden");
  els.previewToggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) els.previewToggle.focus();
}

function toggleAnalysisDock() {
  state.dockCollapsed = !state.dockCollapsed;
  state.layout.dockOpen = !state.dockCollapsed;
  els.analysisDock.classList.toggle("collapsed", state.dockCollapsed);
  renderDockCollapseControl();
  scheduleLayoutSettled();
}

function renderDockCollapseControl() {
  const expanded = !state.dockCollapsed;
  const action = expanded ? "Collapse" : "Expand";
  els.dockCollapse.setAttribute("aria-expanded", String(expanded));
  els.dockCollapse.setAttribute("aria-label", `${action} Scopes panel`);
  els.dockCollapse.title = `${action} Scopes`;
}

async function activateDockTab(tab) {
  state.activeDockTab = tab;
  state.dockCollapsed = false;
  state.layout.dockOpen = true;
  state.layout.dockTab = tab;
  els.analysisDock.classList.remove("collapsed");
  renderDockCollapseControl();
  els.dockTabs.forEach((button) => {
    const active = button.dataset.dockTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const technical = readoutDockTab(tab);
  els.scopeView.classList.toggle("hidden", technical);
  els.technicalView.classList.toggle("hidden", !technical);
  renderReadoutPanelMode(tab);
  els.scopeMode.value = technical ? tab : tab === "parade" ? "waveform" : tab;
  [els.scopeChannelMode, els.scopeDetail, els.scopeZoom].forEach((control) => { if (control) control.disabled = technical; });
  scheduleLayoutSettled();
  if (technical) return;
  state.scopeMode = tab === "vectorscope" ? "vectorscope" : tab === "waveform" || tab === "parade" ? "waveform" : "histogram";
  if (tab === "parade") state.scopeChannelMode = "parade";
  els.scopeMode.value = state.scopeMode;
  els.scopeChannelMode.value = state.scopeChannelMode;
  renderScopeControlAvailability();
  await refreshScopes();
}

function renderDockSummary() {
  const stats = state.lastScope?.stats || [];
  const wanted = stats.filter((item) => /Peak|% > 1000/.test(item.label)).slice(0, 2);
  els.dockSummary.textContent = wanted.length
    ? wanted.map((item) => `${item.label} ${item.value}`).join(" · ")
    : "Full-resolution processing stats";
}

function activateWorkflowTab(workflow, { focus = false } = {}) {
  const next = ["import", "grade", "proof", "export"].includes(workflow) ? workflow : "import";
  if (next !== "import" && !state.session) return;
  if (next !== "grade") abandonPerspectiveDraft();
  if (next !== "grade" && state.rotateDraftGeometry) closeRotateMode(false);
  if (next !== "grade" && state.cropMode) closeCropMode(true);
  state.activeWorkflow = next;
  document.body.dataset.workflow = next;
  els.workflowTabs.forEach((button) => {
    const active = button.dataset.workflowTab === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  });
  if (next === "export") prepareExportRail();
  if (next === "proof" && state.currentView !== "hdr") switchLane("hdr");
  renderWorkflowContext();
  window.HDRProofing?.render();
  window.dispatchEvent(new CustomEvent("hdrfinisher:workflowchange", { detail: { workflow: next } }));
  renderVignetteCenter();
  renderLocalMaskOverlay();
}

