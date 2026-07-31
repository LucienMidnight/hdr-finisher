const latitudePresets = {
  WIDE: {
    "hdr.exposure": [-4, 4, 0.05],
    "hdr.highlight_rolloff": [0, 2, 0.01],
    "hdr.shadow_lift": [-0.5, 0.5, 0.005],
    "hdr.lift": [-0.5, 0.5, 0.005],
    "hdr.gamma": [-1, 1, 0.005],
    "hdr.gain": [-0.5, 0.5, 0.005],
    "hdr.contrast": [-1, 1, 0.001],
    "hdr.contrast_pivot": [0.02, 1, 0.0005],
    "sdr.exposure": [-4, 4, 0.05],
    "sdr.highlight_recovery": [0, 2, 0.01],
    "sdr.tone_contrast": [0.5, 1.5, 0.01],
    "sdr.tone_skew": [-1, 1, 0.01],
    "sdr.shadow": [-1, 1, 0.01],
    "sdr.lift": [-0.5, 0.5, 0.002],
    "sdr.gamma": [-1, 1, 0.005],
    "sdr.gain": [-0.5, 0.5, 0.005],
    "sdr.contrast": [-1, 1, 0.001],
    "sdr.contrast_pivot": [0.02, 0.98, 0.005],
  },
  MEDIUM: {
    "hdr.exposure": [-3, 3, 0.05],
    "hdr.highlight_rolloff": [0, 1.5, 0.01],
    "hdr.shadow_lift": [-0.3, 0.3, 0.005],
    "hdr.lift": [-0.35, 0.35, 0.005],
    "hdr.gamma": [-0.75, 0.75, 0.005],
    "hdr.gain": [-0.35, 0.35, 0.005],
    "hdr.contrast": [-0.75, 0.75, 0.001],
    "hdr.contrast_pivot": [0.02, 0.75, 0.0005],
    "sdr.exposure": [-3, 3, 0.05],
    "sdr.highlight_recovery": [0, 1.5, 0.01],
    "sdr.tone_contrast": [0.5, 1.5, 0.01],
    "sdr.tone_skew": [-1, 1, 0.01],
    "sdr.shadow": [-0.5, 0.5, 0.01],
    "sdr.lift": [-0.35, 0.35, 0.002],
    "sdr.gamma": [-0.75, 0.75, 0.005],
    "sdr.gain": [-0.35, 0.35, 0.005],
    "sdr.contrast": [-0.75, 0.75, 0.001],
    "sdr.contrast_pivot": [0.05, 0.95, 0.005],
  },
  NARROW: {
    "hdr.exposure": [-2, 2, 0.05],
    "hdr.highlight_rolloff": [0, 1, 0.01],
    "hdr.shadow_lift": [-0.2, 0.2, 0.005],
    "hdr.lift": [-0.25, 0.25, 0.005],
    "hdr.gamma": [-0.5, 0.5, 0.005],
    "hdr.gain": [-0.25, 0.25, 0.005],
    "hdr.contrast": [-0.5, 0.5, 0.001],
    "hdr.contrast_pivot": [0.02, 0.5, 0.0005],
    "sdr.exposure": [-2, 2, 0.05],
    "sdr.highlight_recovery": [0, 1, 0.01],
    "sdr.tone_contrast": [0.5, 1.5, 0.01],
    "sdr.tone_skew": [-1, 1, 0.01],
    "sdr.shadow": [-0.3, 0.3, 0.01],
    "sdr.lift": [-0.25, 0.25, 0.002],
    "sdr.gamma": [-0.5, 0.5, 0.005],
    "sdr.gain": [-0.25, 0.25, 0.005],
    "sdr.contrast": [-0.5, 0.5, 0.001],
    "sdr.contrast_pivot": [0.05, 0.95, 0.005],
  },
};

const state = {
  session: null,
  capabilities: {},
  currentView: "hdr",
  scopeMode: "histogram",
  scopeChannelMode: "composite",
  sourceSettingsOpen: false,
  metadataOpen: false,
  interpretationGateDismissed: false,
  zoomMode: "fit",
  activeDockTab: "histogram",
  dockCollapsed: false,
  lastScope: null,
  lastExportPath: "",
  compareHoldTimer: null,
  compareHeld: false,
  comparePeekActive: false,
  previewGeneration: { hdr: 0, sdr: 0 },
  previewCache: { hdr: null, sdr: null },
  previewControllers: { hdr: null, sdr: null },
  previewInfoByLane: {
    hdr: {
      mediaType: "n/a",
      transport: "n/a",
      colorSpace: "n/a",
      transfer: "n/a",
      bitDepth: "n/a",
      notes: "No preview yet",
    },
    sdr: {
      mediaType: "n/a",
      transport: "n/a",
      colorSpace: "n/a",
      transfer: "n/a",
      bitDepth: "n/a",
      notes: "No preview yet",
    },
  },
  adjustments: {
    hdr: {
      exposure: 0,
      highlight_rolloff: 0.25,
      shadow_lift: 0,
      lift: 0,
      gamma: 0,
      gain: 0,
      contrast: 0,
      contrast_pivot: 0.1845,
      white_balance_kelvin: 6500,
      tint: 0,
      curves_enabled: false,
      luma_curve: defaultCurvePoints(),
      red_curve: defaultCurvePoints(),
      green_curve: defaultCurvePoints(),
      blue_curve: defaultCurvePoints(),
    },
    sdr: {
      exposure: 0,
      highlight_recovery: 0.6,
      tone_contrast: 1,
      tone_skew: 0,
      shadow: 0,
      lift: 0,
      gamma: 0,
      gain: 0,
      contrast: 0,
      contrast_pivot: 0.5,
      tone_mapper: "filmic",
      curves_enabled: false,
      luma_curve: defaultCurvePoints(),
      red_curve: defaultCurvePoints(),
      green_curve: defaultCurvePoints(),
      blue_curve: defaultCurvePoints(),
    },
    shared: {
      active_focus: "hdr",
      curves_enabled: false,
      overlay_mode: "off",
      overlay_preset: "web_1000_100",
      overlay_opacity: 0.72,
      overlay_threshold: 1,
    },
  },
  selectedCurveChannel: "luma",
  activeCurvePoint: null,
  selectedCurvePoint: 2,
  previewAbortController: null,
  overlayAbortController: null,
  refreshTimer: null,
  previewInfo: {
    mediaType: "n/a",
    transport: "n/a",
    colorSpace: "n/a",
    transfer: "n/a",
    bitDepth: "n/a",
    notes: "No preview yet",
  },
  displayInfo: buildDisplayProbe(),
};

let scopeResizeObserver = null;
let scopeResizeFrame = null;

const defaultAdjustments = () => ({
  hdr: {
    exposure: 0,
    highlight_rolloff: 0.25,
    shadow_lift: 0,
    lift: 0,
    gamma: 0,
    gain: 0,
    contrast: 0,
    contrast_pivot: 0.1845,
    white_balance_kelvin: 6500,
    tint: 0,
    curves_enabled: false,
    luma_curve: defaultCurvePoints(),
    red_curve: defaultCurvePoints(),
    green_curve: defaultCurvePoints(),
    blue_curve: defaultCurvePoints(),
  },
  sdr: {
    exposure: 0,
    highlight_recovery: 0.6,
    tone_contrast: 1,
    tone_skew: 0,
    shadow: 0,
    lift: 0,
    gamma: 0,
    gain: 0,
    contrast: 0,
    contrast_pivot: 0.5,
    tone_mapper: "filmic",
    curves_enabled: false,
    luma_curve: defaultCurvePoints(),
    red_curve: defaultCurvePoints(),
    green_curve: defaultCurvePoints(),
    blue_curve: defaultCurvePoints(),
  },
  shared: {
    active_focus: state.currentView,
    curves_enabled: false,
    overlay_mode: "off",
    overlay_preset: "web_1000_100",
    overlay_opacity: 0.72,
    overlay_threshold: 1,
  },
});

const els = {
  fileInput: document.getElementById("file-input"),
  dropzone: document.getElementById("dropzone"),
  importButton: document.getElementById("import-button"),
  emptyImportButton: document.getElementById("empty-import-button"),
  ejectButton: document.getElementById("eject-button"),
  badge: document.getElementById("badge"),
  fileSummary: document.getElementById("file-summary"),
  sourceConfidence: document.getElementById("source-confidence"),
  sourceRailExpand: document.getElementById("source-rail-expand"),
  capabilitySummary: document.getElementById("capability-summary"),
  overrideWarning: document.getElementById("override-warning"),
  overrideMessage: document.getElementById("override-message"),
  attentionFix: document.getElementById("attention-fix"),
  sourceSettingsToggle: document.getElementById("source-settings-toggle"),
  sourceSettingsPanel: document.getElementById("source-settings-panel"),
  interpretationSummary: document.getElementById("interpretation-summary"),
  interpretationMode: document.getElementById("interpretation-mode"),
  interpretationColorSpace: document.getElementById("interpretation-color-space"),
  interpretationTransfer: document.getElementById("interpretation-transfer"),
  sourceSettingsNote: document.getElementById("source-settings-note"),
  applyInterpretationButton: document.getElementById("apply-interpretation"),
  resetInterpretationButton: document.getElementById("reset-interpretation"),
  metadataToggle: document.getElementById("metadata-toggle"),
  metadataPanel: document.getElementById("metadata-panel"),
  interpretationGate: document.getElementById("interpretation-gate"),
  interpretationGateCopy: document.getElementById("interpretation-gate-copy"),
  acceptInterpretation: document.getElementById("accept-interpretation"),
  manualInterpretation: document.getElementById("manual-interpretation"),
  curvesEnabled: document.getElementById("curves-enabled"),
  curveEditor: document.getElementById("curve-editor"),
  curveStatus: document.getElementById("curve-status"),
  overlayPresetNote: document.getElementById("overlay-preset-note"),
  curveReset: document.getElementById("curve-reset"),
  curveAdd: document.getElementById("curve-add"),
  curveRemove: document.getElementById("curve-remove"),
  curveChannelButtons: [...document.querySelectorAll("[data-curve-channel]")],
  metadataList: document.getElementById("metadata-list"),
  previewOutputList: document.getElementById("preview-output-list"),
  displayInfoList: document.getElementById("display-info-list"),
  sourcePreviewList: document.getElementById("source-preview-list"),
  sessionName: document.getElementById("session-name"),
  previewImage: document.getElementById("preview-image"),
  previewOverlay: document.getElementById("preview-overlay"),
  emptyState: document.getElementById("empty-state"),
  previewStatus: document.getElementById("preview-status"),
  falseColorLegend: document.getElementById("false-color-legend"),
  viewerLaneLabel: document.getElementById("viewer-lane-label"),
  viewerBranchNote: document.getElementById("viewer-branch-note"),
  laneNote: document.getElementById("lane-note"),
  compareButton: document.getElementById("compare-button"),
  compareStatus: document.getElementById("compare-status"),
  zoomFit: document.getElementById("zoom-fit"),
  zoomActual: document.getElementById("zoom-actual"),
  zoomReadout: document.getElementById("zoom-readout"),
  overlayToggle: document.getElementById("overlay-toggle"),
  overlayClose: document.getElementById("overlay-close"),
  overlayPopover: document.getElementById("overlay-popover"),
  probeReadout: document.getElementById("probe-readout"),
  scopeTitle: document.getElementById("scope-title"),
  scopeNote: document.getElementById("scope-note"),
  scopeKindLabel: document.getElementById("scope-kind-label"),
  scopeMode: document.getElementById("scope-mode"),
  scopeChannelMode: document.getElementById("scope-channel-mode"),
  scopeStats: document.getElementById("scope-stats"),
  histogram: document.getElementById("histogram"),
  analysisDock: document.getElementById("analysis-dock"),
  dockCollapse: document.getElementById("dock-collapse"),
  dockSummary: document.getElementById("dock-summary"),
  dockTabs: [...document.querySelectorAll("[data-dock-tab]")],
  scopeView: document.getElementById("scope-view"),
  technicalView: document.getElementById("technical-view"),
  exportButton: document.getElementById("export-button"),
  exportSheet: document.getElementById("export-sheet"),
  exportClose: document.getElementById("export-close"),
  exportConfirmButton: document.getElementById("export-confirm-button"),
  exportStatus: document.getElementById("export-status"),
  exportFilename: document.getElementById("export-filename"),
  exportDirectory: document.getElementById("export-directory"),
  exportDirectoryBrowse: document.getElementById("export-directory-browse"),
  exportFormat: document.getElementById("export-format"),
  exportQuality: document.getElementById("export-quality"),
  exportQualityValue: document.getElementById("export-quality-value"),
  exportResult: document.getElementById("export-result"),
  exportResultPath: document.getElementById("export-result-path"),
  copyExportPath: document.getElementById("copy-export-path"),
  exportFormatChoices: [...document.querySelectorAll('input[name="export-format-choice"]')],
  formatCards: [...document.querySelectorAll("[data-format-card]")],
  preflightItems: [...document.querySelectorAll("[data-preflight]")],
  viewButtons: [...document.querySelectorAll("[data-kind]")],
  controls: [...document.querySelectorAll("[data-path]")],
  valueOutputs: [...document.querySelectorAll("[data-value-path]")],
  lanePanels: [...document.querySelectorAll("[data-lane-panel]")],
  groupToggles: [...document.querySelectorAll(".group-toggle")],
  groupResets: [...document.querySelectorAll("[data-reset-group]")],
  controlRows: [...document.querySelectorAll("[data-control-path]")],
  modifiedCounts: [...document.querySelectorAll("[data-modified-count]")],
  gradeModifiedSummary: document.getElementById("grade-modified-summary"),
  curveGroupState: document.getElementById("curve-group-state"),
};

const overlayPresetNotes = {
  web_1000_100: "Built for web-HDR finishing with 100 nit diffuse white and a 1000 nit highlight ceiling. Best default for AVIF gain-map work and common consumer HDR displays.",
  bt2408_1000_203: "Uses the ITU-R BT.2408 style 203 nit HDR reference white with a 1000 nit peak target. Useful when you want false color to align with PQ/HLG reference-white practice.",
  bt2408_4000_203: "Keeps the 203 nit BT.2408 reference white but stretches warning bands toward a 4000 nit mastering ceiling. Good for checking very bright highlight intent.",
  sdr_100: "Treats 100 nits as both white and ceiling. Handy when judging the SDR fallback or when you want the overlay to behave like an SDR exposure aid.",
};

const controlGroups = {
  "hdr-tone": ["hdr.exposure", "hdr.highlight_rolloff", "hdr.contrast", "hdr.contrast_pivot", "hdr.shadow_lift"],
  "hdr-color": ["hdr.white_balance_kelvin", "hdr.tint"],
  "hdr-zones": ["hdr.lift", "hdr.gamma", "hdr.gain"],
  "sdr-base": ["sdr.tone_mapper", "sdr.tone_contrast", "sdr.tone_skew"],
  "sdr-tone": ["sdr.exposure", "sdr.highlight_recovery", "sdr.contrast", "sdr.contrast_pivot", "sdr.shadow"],
  "sdr-zones": ["sdr.lift", "sdr.gamma", "sdr.gain"],
};

const branchCopy = {
  hdr: "Graded HDR rendition. Exported as the PQ HDR image.",
  sdr: "Independent fallback baked into the gain map. This is what viewers without HDR gain-map support will see.",
};

const capabilityForFormat = {
  avif_gain_map: "avif_gain_map_encoder",
  jpeg_ultrahdr: "ultrahdr_encoder",
  sdr_png: "pillow",
};

boot();

async function boot() {
  bindEvents();
  await loadCapabilities().catch(() => {
    els.capabilitySummary.textContent = "Encoder status unavailable";
    els.capabilitySummary.className = "capability-chip attention";
  });
  renderReadouts();
  drawCurveEditor();
  renderOverlayPresetNote();
  renderLaneChrome();
  renderControlState();
  renderCapabilities();
  renderExportPreflight();
  window.addEventListener("resize", syncOverlayPlacement);
  window.addEventListener("resize", updateZoomReadout);
  observeScopeSize();
}

function observeScopeSize() {
  if (!window.ResizeObserver) {
    window.addEventListener("resize", () => drawHistogram(state.lastScope || []));
    return;
  }
  scopeResizeObserver = new ResizeObserver(() => {
    if (scopeResizeFrame !== null) cancelAnimationFrame(scopeResizeFrame);
    scopeResizeFrame = requestAnimationFrame(() => {
      scopeResizeFrame = null;
      drawHistogram(state.lastScope || []);
    });
  });
  scopeResizeObserver.observe(els.histogram);
}

function bindEvents() {
  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) await uploadFile(file);
    event.target.value = "";
  });
  els.importButton.addEventListener("click", () => els.fileInput.click());
  els.emptyImportButton.addEventListener("click", () => els.fileInput.click());
  els.sourceRailExpand.addEventListener("click", () => {
    const rail = els.sourceRailExpand.closest(".source-rail");
    const expanded = rail.classList.toggle("pinned-open");
    els.sourceRailExpand.setAttribute("aria-expanded", String(expanded));
    els.sourceRailExpand.textContent = expanded ? "Close" : "Source";
    if (!expanded) els.sourceRailExpand.blur();
  });
  els.sourceSettingsToggle.addEventListener("click", () => {
    state.sourceSettingsOpen = !state.sourceSettingsOpen;
    renderSourceSettingsVisibility();
  });
  els.metadataToggle.addEventListener("click", () => {
    state.metadataOpen = !state.metadataOpen;
    renderMetadataVisibility();
  });
  els.attentionFix.addEventListener("click", openManualInterpretation);
  els.acceptInterpretation.addEventListener("click", () => {
    state.interpretationGateDismissed = true;
    els.overrideWarning.classList.add("hidden");
    els.sourceConfidence.textContent = "Assumption accepted";
    els.interpretationSummary.textContent = "Auto assumption";
    renderInterpretationGate();
    renderExportPreflight();
  });
  els.manualInterpretation.addEventListener("click", openManualInterpretation);
  els.interpretationMode.addEventListener("change", () => {
    renderSourceSettingsControls();
  });
  els.scopeMode.addEventListener("change", async () => {
    state.scopeMode = els.scopeMode.value;
    await refreshScopes();
  });
  els.scopeChannelMode.addEventListener("change", async () => {
    state.scopeChannelMode = els.scopeChannelMode.value;
    await refreshScopes();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("drag-active");
    });
  });
  ["dragleave", "dragend"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, () => {
      els.dropzone.classList.remove("drag-active");
    });
  });
  els.dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("drag-active");
    const [file] = event.dataTransfer.files;
    if (file) await uploadFile(file);
  });

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      await switchLane(button.dataset.kind);
    });
  });

  els.controls.forEach((control) => {
    control.addEventListener("input", () => {
      const value = control.type === "range" ? Number(control.value) : control.type === "checkbox" ? control.checked : control.value;
      setValueByPath(state.adjustments, control.dataset.path, value);
      const path = control.dataset.path;
      if (path === "shared.overlay_preset") renderOverlayPresetNote();
      updateControlReadouts();
      renderControlState();
      if (path.startsWith("shared.overlay_")) {
        debounceOverlayAndScopes();
      } else {
        const lane = path.startsWith("sdr.") ? "sdr" : "hdr";
        invalidatePreview(lane);
        debouncePreview(lane);
      }
    });
  });
  bindRangeResetControls();

  els.curvesEnabled.addEventListener("input", () => {
    setValueByPath(state.adjustments, curveEnabledPath(), els.curvesEnabled.checked);
    drawCurveEditor();
    renderReadouts();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });

  els.curveChannelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCurveChannel = button.dataset.curveChannel;
      renderCurveChannelTabs();
      drawCurveEditor();
    });
  });
  els.curveReset.addEventListener("click", () => {
    setValueByPath(state.adjustments, curveEnabledPath(), false);
    ["luma", "red", "green", "blue"].forEach((channel) => {
      setCurveValues(channel, defaultCurvePoints());
    });
    state.selectedCurvePoint = 2;
    syncCurveControlsFromState();
    drawCurveEditor();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
  els.curveAdd.addEventListener("click", () => {
    addCurvePoint();
    drawCurveEditor();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
  els.curveRemove.addEventListener("click", () => {
    removeCurvePoint();
    drawCurveEditor();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
  bindCurveEditor();

  els.exportButton.addEventListener("click", openExportSheet);
  els.exportClose.addEventListener("click", closeExportSheet);
  els.exportConfirmButton.addEventListener("click", exportCurrentSession);
  els.exportDirectoryBrowse.addEventListener("click", chooseExportDirectory);
  els.applyInterpretationButton.addEventListener("click", applyInterpretationOverride);
  els.resetInterpretationButton.addEventListener("click", resetInterpretationToAuto);
  els.ejectButton.addEventListener("click", ejectCurrentSession);
  els.copyExportPath.addEventListener("click", copyLastExportPath);

  els.groupToggles.forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.closest(".control-group");
      const collapsed = group.classList.toggle("collapsed");
      button.setAttribute("aria-expanded", String(!collapsed));
    });
  });
  els.groupResets.forEach((button) => {
    button.addEventListener("click", () => resetControlGroup(button.dataset.resetGroup));
  });

  els.zoomFit.addEventListener("click", () => setZoomMode("fit"));
  els.zoomActual.addEventListener("click", () => setZoomMode("actual"));
  els.overlayToggle.addEventListener("click", toggleOverlayPopover);
  els.overlayClose.addEventListener("click", closeOverlayPopover);
  els.dockCollapse.addEventListener("click", toggleAnalysisDock);
  els.dockTabs.forEach((button) => {
    button.addEventListener("click", () => activateDockTab(button.dataset.dockTab));
  });
  els.exportFormatChoices.forEach((choice) => {
    choice.addEventListener("change", () => {
      if (!choice.checked) return;
      els.exportFormat.value = choice.value;
      renderFormatCards();
      renderExportPreflight();
    });
  });
  els.exportQuality.addEventListener("input", () => {
    els.exportQualityValue.textContent = els.exportQuality.value;
  });

  bindCompareControl();
  bindKeyboardShortcuts();
  els.dropzone.addEventListener("mousemove", updateProbeReadout);
  els.dropzone.addEventListener("mouseleave", () => {
    els.probeReadout.textContent = "Move over the image for pixel coordinates";
  });

  if (window.matchMedia) {
    ["(dynamic-range: high)", "(color-gamut: p3)", "(color-gamut: rec2020)"].forEach((query) => {
      const media = window.matchMedia(query);
      media.addEventListener?.("change", () => {
        state.displayInfo = buildDisplayProbe();
        renderReadouts();
      });
    });
  }
}

async function loadCapabilities() {
  const response = await fetch("/api/capabilities");
  const data = await response.json();
  state.capabilities = data.capabilities;
}

function bindRangeResetControls() {
  document.querySelectorAll('input[type="range"]').forEach((control) => {
    control.addEventListener("dblclick", (event) => {
      event.preventDefault();
      control.value = control.defaultValue;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  els.badge.textContent = "Loading image and building session...";
  setPreviewMessage("Preparing session...");
  try {
    const response = await fetch("/api/session", { method: "POST", body: formData });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.session) {
      const detail = payload?.detail || `Upload failed with HTTP ${response.status}.`;
      showUploadError(detail);
      return;
    }
    state.session = payload.session;
    state.adjustments = payload.session.adjustments;
    state.currentView = "hdr";
    state.adjustments.shared.active_focus = "hdr";
    state.interpretationGateDismissed = false;
    clearPreviewCache();
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    renderSession();
    seedExportFieldsFromSession();
    await refreshPreview();
    await refreshOverlay();
    await refreshScopes();
    prepareInactivePreview();
  } catch (error) {
    console.error(error);
    showUploadError("The upload could not reach the local HDR Finisher server.");
  }
}

function showUploadError(message) {
  els.badge.textContent = message;
  els.badge.className = "badge bad";
  setPreviewError(message);
  clearPreviewImage();
  clearPreviewOverlay();
}

async function ejectCurrentSession() {
  if (!state.session) return;
  await fetch("/api/session/current", { method: "DELETE" }).catch(() => null);
  state.session = null;
  state.adjustments = defaultAdjustments();
  state.currentView = "hdr";
  state.adjustments.shared.active_focus = "hdr";
  state.interpretationGateDismissed = false;
  state.lastScope = null;
  state.lastExportPath = "";
  clearPreviewCache();
  state.previewInfo = {
    mediaType: "n/a",
    transport: "n/a",
    colorSpace: "n/a",
    transfer: "n/a",
    bitDepth: "n/a",
    notes: "No preview yet",
  };
  clearPreviewImage();
  clearPreviewOverlay();
  els.badge.textContent = "No file loaded.";
  els.badge.className = "badge neutral";
  els.sessionName.textContent = "No active image";
  els.fileSummary.textContent = "Import one HDR-capable source to begin";
  els.sourceConfidence.textContent = "Waiting";
  els.metadataList.innerHTML = "";
  els.overrideWarning.classList.add("hidden");
  els.sourceSettingsPanel.classList.add("hidden");
  els.interpretationMode.value = "auto";
  els.interpretationColorSpace.value = "auto";
  els.interpretationTransfer.value = "auto";
  state.sourceSettingsOpen = false;
  els.exportStatus.textContent = "Choose a format and destination.";
  els.exportResult.classList.add("hidden");
  els.exportFilename.value = "hdr_finisher_export";
  els.exportDirectory.value = "";
  syncControlsFromState();
  drawHistogram([]);
  renderReadouts();
  hidePreviewMessage();
  renderSessionChrome();
  state.selectedCurveChannel = "luma";
  state.selectedCurvePoint = 2;
  renderCurveChannelTabs();
  syncCurveControlsFromState();
  drawCurveEditor();
  renderOverlayPresetNote();
  renderMetadataVisibility();
  renderInterpretationGate();
  renderLaneChrome();
  renderControlState();
  renderExportPreflight();
}

function renderSession() {
  const session = state.session;
  els.sessionName.textContent = session.source.filename;
  clearPreviewOverlay();
  setPreviewMessage(`Rendering ${state.currentView.toUpperCase()} preview...`);
  els.badge.textContent = session.analysis.badge_message;
  els.badge.className = badgeClass(session.analysis.classification);
  els.overrideWarning.classList.toggle("hidden", !session.analysis.needs_color_override);
  els.overrideMessage.textContent = overrideMessage(session);
  els.interpretationSummary.textContent = interpretationSummary(session);
  els.sourceConfidence.textContent = session.source.color_space_confident ? "Confirmed" : "Review";
  els.fileSummary.textContent = `${session.source.suffix.toUpperCase()} · ${session.source.width} × ${session.source.height} · ${session.source.working_space}`;
  syncInterpretationControls(session);
  applyLatitudePresets(session.analysis.source_latitude);
  renderSourceSettingsVisibility();
  renderSourceSettingsControls();
  renderMetadata(session);
  renderReadouts();
  syncControlsFromState();
  syncCurveControlsFromState();
  renderSessionChrome();
  drawCurveEditor();
  renderOverlayPresetNote();
  renderMetadataVisibility();
  renderInterpretationGate();
  renderLaneChrome();
  renderControlState();
  renderExportPreflight();
}

function renderMetadata(session) {
  const entries = [
    ["Size", `${session.source.width} x ${session.source.height}`],
    ["Format", session.source.suffix],
    ["Working space", session.source.working_space],
    ["Source space", session.source.source_color_space || "unknown"],
    ["Transfer", session.source.transfer_function || "unknown"],
    ["Interpretation", session.source.interpretation_mode || "auto"],
    ["Confidence", session.source.color_space_confident ? "confirmed" : "review"],
    ["Bit depth", session.metadata.bit_depth || "unknown"],
    ["Camera", session.metadata.camera_model || "n/a"],
    ["Lens", session.metadata.lens || "n/a"],
  ];
  els.metadataList.innerHTML = "";
  for (const [key, value] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    els.metadataList.append(dt, dd);
  }
}

function renderReadouts() {
  renderKeyValueList(els.previewOutputList, previewOutputEntries());
  renderKeyValueList(els.displayInfoList, displayProbeEntries());
  renderKeyValueList(els.sourcePreviewList, sourceInterpretationEntries());
  const lane = currentCurveLane().toUpperCase();
  const enabled = getValueByPath(state.adjustments, curveEnabledPath()) ? "enabled" : "disabled";
  els.curveStatus.textContent = `${lane} curves are ${enabled}. Curve edits affect only the ${lane} preview/export branch.`;
}

function renderOverlayPresetNote() {
  const preset = state.adjustments.shared.overlay_preset || "web_1000_100";
  els.overlayPresetNote.textContent = overlayPresetNotes[preset] || overlayPresetNotes.web_1000_100;
  const mode = state.adjustments.shared.overlay_mode || "off";
  const label = mode === "false_color" ? "False color" : mode === "zebra" ? "Zebra" : "Off";
  els.overlayToggle.textContent = `Overlays: ${label}`;
  els.falseColorLegend.classList.toggle("hidden", mode !== "false_color" || !state.session);
}

function previewOutputEntries() {
  return [
    ["View", state.currentView.toUpperCase()],
    ["Transport", state.previewInfo.transport],
    ["Media", state.previewInfo.mediaType],
    ["Space", state.previewInfo.colorSpace],
    ["Transfer", state.previewInfo.transfer],
    ["Bit Depth", state.previewInfo.bitDepth],
    ["Notes", state.previewInfo.notes],
  ];
}

function displayProbeEntries() {
  return [
    ["Dynamic Range", state.displayInfo.dynamicRange],
    ["Color Gamut", state.displayInfo.colorGamut],
    ["Pixel Ratio", state.displayInfo.pixelRatio],
    ["Screen Depth", state.displayInfo.screenDepth],
    ["Browser", state.displayInfo.browser],
  ];
}

function sourceInterpretationEntries() {
  if (!state.session) {
    return [
      ["Format", "n/a"],
      ["Source Space", "n/a"],
      ["Transfer", "n/a"],
      ["Working", "n/a"],
      ["Signal", "n/a"],
    ];
  }

  return [
    ["Format", state.session.source.suffix],
    ["Source Space", state.session.source.source_color_space || "unknown"],
    ["Transfer", state.session.source.transfer_function || "unknown"],
    ["Summary", interpretationSummary(state.session)],
    ["Interpretation", state.session.source.interpretation_mode || "auto"],
    ["Working", state.session.source.working_space || "ACEScg"],
    ["Signal", state.session.analysis.classification],
    ["Latitude", state.session.analysis.source_latitude],
    ["Source Depth", state.session.metadata.bit_depth || "unknown"],
  ];
}

function renderKeyValueList(container, entries) {
  container.innerHTML = "";
  for (const [key, value] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    container.append(dt, dd);
  }
}

function applyLatitudePresets(latitude) {
  const preset = latitudePresets[latitude] || latitudePresets.MEDIUM;
  Object.entries(preset).forEach(([path, [min, max, step]]) => {
    const control = document.querySelector(`[data-path="${path}"]`);
    if (control) {
      control.min = min;
      control.max = max;
      control.step = step;
    }
  });
}

function debouncePreview(lane = state.currentView) {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(async () => {
    if (lane === state.currentView) {
      await refreshPreview();
      await refreshOverlay();
      await refreshScopes();
      prepareInactivePreview();
    } else {
      await renderPreviewForLane(lane, false);
    }
  }, 180);
}

function debounceOverlayAndScopes() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(async () => {
    renderOverlayPresetNote();
    await refreshOverlay();
    await refreshScopes();
  }, 120);
}

async function refreshPreview() {
  return renderPreviewForLane(state.currentView, true);
}

async function renderPreviewForLane(lane, displayWhenReady) {
  if (!state.session) return false;
  const cached = state.previewCache[lane];
  const generation = state.previewGeneration[lane];
  if (cached?.generation === generation) {
    if (displayWhenReady && state.currentView === lane && !state.comparePeekActive) showCachedPreview(lane);
    renderCompareStatus();
    return true;
  }

  state.previewControllers[lane]?.abort();
  const controller = new AbortController();
  state.previewControllers[lane] = controller;
  if (displayWhenReady) setPreviewMessage(`Rendering ${lane.toUpperCase()} preview...`);

  const response = await fetch(`/api/session/${state.session.session_id}/preview/${lane}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustments: state.adjustments }),
    signal: controller.signal,
  }).catch((error) => {
    if (error.name === "AbortError") return { aborted: true };
    console.error(error);
    return null;
  });
  if (!response || response.aborted) return;
  if (response.status === 409) {
    if (displayWhenReady) setPreviewMessage("A newer adjustment replaced this render.");
    return false;
  }
  if (!response.ok) {
    const payload = await safeJson(response);
    if (displayWhenReady) {
      setPreviewError(payload?.detail || "Preview failed to render.");
      clearPreviewImage();
      clearPreviewOverlay();
    }
    return false;
  }

  const previewInfo = previewInfoFromResponse(response, lane);
  const blob = await response.blob();
  if (generation !== state.previewGeneration[lane]) return false;
  const url = URL.createObjectURL(blob);
  const previous = state.previewCache[lane];
  if (previous?.url) URL.revokeObjectURL(previous.url);
  state.previewCache[lane] = { url, generation };
  state.previewInfoByLane[lane] = previewInfo;
  if (displayWhenReady && state.currentView === lane && !state.comparePeekActive) {
    await applyPreviewUrl(url);
    state.previewInfo = previewInfo;
    els.scopeKindLabel.textContent = lane.toUpperCase();
    renderReadouts();
  }
  renderCompareStatus();
  return true;
}

async function refreshOverlay() {
  if (!state.session) return;
  if (state.adjustments.shared.overlay_mode === "off") {
    clearPreviewOverlay();
    return;
  }
  if (state.overlayAbortController) state.overlayAbortController.abort();
  state.overlayAbortController = new AbortController();
  const response = await fetch(`/api/session/${state.session.session_id}/overlay/${state.currentView}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustments: state.adjustments }),
    signal: state.overlayAbortController.signal,
  }).catch((error) => {
    if (error.name === "AbortError") return { aborted: true };
    console.error(error);
    return null;
  });
  if (!response || response.aborted) return;
  if (response.status === 204) {
    clearPreviewOverlay();
    return;
  }
  if (!response.ok) {
    clearPreviewOverlay();
    return;
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  await applyOverlayUrl(url);
}

async function refreshScopes() {
  if (!state.session) return;
  const response = await fetch(`/api/session/${state.session.session_id}/scopes?kind=${state.currentView}&mode=${state.scopeMode}`);
  if (!response.ok) return;
  const payload = await response.json();
  state.lastScope = payload;
  drawHistogram(payload);
  renderDockSummary();
  renderExportPreflight();
}

function drawHistogram(scope) {
  const canvas = els.histogram;
  const surface = resizeScopeCanvas(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#090b0c";
  ctx.fillRect(0, 0, width, height);
  if (!scope?.channels?.length) {
    els.scopeTitle.textContent = "Histogram";
    els.scopeNote.textContent = "Reference scopes will appear here after a preview is rendered.";
    els.scopeStats.innerHTML = "";
    state.lastScope = null;
    renderDockSummary();
    return;
  }
  els.scopeTitle.textContent = scopeTitleFor(scope);
  canvas.setAttribute("aria-label", els.scopeTitle.textContent);
  els.scopeNote.textContent = scope.preview_kind === "hdr"
    ? scope.scope_type.includes("waveform")
      ? "HDR waveform plots horizontal image position against reference nits. Reference nits use the app's internal model: 0.18 scene-linear equals 100 nits."
      : "HDR histogram plots reference luminance from left to right on a logarithmic nit scale. Density is log-scaled to retain fine tonal detail."
    : scope.scope_type.includes("waveform")
      ? "SDR waveform plots horizontal image position against normalized tone-mapped output."
      : "SDR histogram plots display-safe values from black to white. Density is log-scaled so small tonal populations remain visible.";
  renderKeyValueList(els.scopeStats, (scope.stats || []).map((item) => [item.label, item.value]));

  const channels = filteredScopeChannels(scope.channels);
  const palette = { R: "#ff5b61", G: "#55e579", B: "#4d9cff", Y: "#d8dddf" };
  const isWaveform = scope.scope_type.includes("waveform");
  const plotLeft = isWaveform ? 52 : 14;
  const plotRight = 10;
  const plotTop = 8;
  const plotBottom = 22;
  const plotWidth = Math.max(1, width - plotLeft - plotRight);
  const plotHeight = Math.max(1, height - plotTop - plotBottom);

  ctx.font = '11px "IBM Plex Mono", "Cascadia Mono", Consolas';
  ctx.textBaseline = "middle";
  drawScopeGrid(ctx, scope, isWaveform, plotLeft, plotTop, plotWidth, plotHeight, height);

  if (scope.scope_type.includes("waveform")) drawWaveform(ctx, scope, channels, palette, plotLeft, plotTop, plotWidth, plotHeight);
  else drawResolveHistogram(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight);
}

function resizeScopeCanvas(canvas) {
  const width = Math.round(canvas.clientWidth);
  const height = Math.round(canvas.clientHeight);
  if (width < 2 || height < 2) return null;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const bitmapWidth = Math.round(width * dpr);
  const bitmapHeight = Math.round(height * dpr);
  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
    canvas.width = bitmapWidth;
    canvas.height = bitmapHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  return { ctx, width, height };
}

function drawScopeGrid(ctx, scope, isWaveform, plotLeft, plotTop, plotWidth, plotHeight, canvasHeight) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(224, 232, 235, 0.08)";
  [0, 0.25, 0.5, 0.75, 1].forEach((position) => {
    const y = plotTop + plotHeight - position * plotHeight;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotLeft + plotWidth, y);
    ctx.stroke();
  });

  const labeledGuides = scopeGuidesForDisplay(scope);
  (scope.guides || []).forEach((guide) => {
    const normalized = guidePosition(scope, guide.value);
    const showLabel = labeledGuides.has(Number(guide.value));
    ctx.strokeStyle = showLabel ? "rgba(224, 232, 235, 0.17)" : "rgba(224, 232, 235, 0.08)";
    ctx.fillStyle = "rgba(224, 232, 235, 0.62)";
    if (isWaveform) {
      const y = plotTop + plotHeight - normalized * plotHeight;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotLeft + plotWidth, y);
      ctx.stroke();
      if (showLabel) {
        ctx.textAlign = "left";
        ctx.fillText(guide.label, 2, y);
      }
    } else {
      const x = plotLeft + normalized * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotTop + plotHeight);
      ctx.stroke();
      if (showLabel) {
        ctx.textAlign = normalized <= 0.02 ? "left" : normalized >= 0.98 ? "right" : "center";
        ctx.fillText(guide.label, x, canvasHeight - 7);
      }
    }
  });
  ctx.restore();
}

function scopeGuidesForDisplay(scope) {
  if (scope.preview_kind === "hdr") return new Set([1, 10, 100, 203, 1000, 4000]);
  return new Set([0.18, 0.5, 1]);
}

function guidePosition(scope, value) {
  if (scope.preview_kind === "hdr") {
    const min = Math.log10(1);
    const max = Math.log10(4000);
    return (Math.log10(Math.max(value, 1)) - min) / (max - min);
  }
  return Math.min(1, Math.max(0, value));
}

function drawResolveHistogram(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  if (state.scopeChannelMode === "parade") {
    drawHistogramParade(ctx, channels.filter((channel) => channel.name !== "Y"), palette, plotLeft, plotTop, plotWidth, plotHeight);
    return;
  }
  const peak = robustHistogramPeak(channels);
  ctx.save();
  ctx.globalCompositeOperation = channels.length > 1 ? "lighter" : "source-over";
  channels.forEach((channel) => {
    drawHistogramTrace(ctx, channel, palette[channel.name], peak, plotLeft, plotTop, plotWidth, plotHeight);
  });
  ctx.restore();
}

function robustHistogramPeak(channels) {
  const populations = channels
    .flatMap((channel) => channel.bins || [])
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!populations.length) return 1;
  return Math.max(1, populations[Math.floor((populations.length - 1) * 0.985)]);
}

function histogramHeight(value, peak) {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(Math.max(peak, 1)));
}

function drawHistogramTrace(ctx, channel, color, peak, plotLeft, plotTop, plotWidth, plotHeight) {
  const bins = channel.bins || [];
  if (!bins.length) return;
  const baseline = plotTop + plotHeight;
  const colorRgb = hexToRgb(color);
  const points = bins.map((value, index) => ({
    x: plotLeft + (index / Math.max(bins.length - 1, 1)) * plotWidth,
    y: baseline - histogramHeight(value, peak) * plotHeight,
  }));

  ctx.beginPath();
  ctx.moveTo(points[0].x, baseline);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, baseline);
  ctx.closePath();
  ctx.fillStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.22)`;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.9)`;
  ctx.lineWidth = 1.15;
  ctx.stroke();
}

function drawWaveform(ctx, scope, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  if (state.scopeChannelMode === "parade") {
    drawWaveformParade(ctx, channels.filter((channel) => channel.name !== "Y"), palette, plotLeft, plotTop, plotWidth, plotHeight);
    return;
  }
  const columnCount = Math.max(1, channels[0]?.grid?.[0]?.length || 0);
  const rowCount = Math.max(1, channels[0]?.grid?.length || 0);
  const maxValue = Math.max(1, ...channels.flatMap((channel) => channel.grid.flat()));
  channels.forEach((channel) => {
    const color = hexToRgb(palette[channel.name]);
    channel.grid.forEach((row, rowIndex) => {
      const y = plotTop + plotHeight - (rowIndex / Math.max(rowCount - 1, 1)) * plotHeight;
      row.forEach((value, columnIndex) => {
        if (value <= 0) return;
        const x = plotLeft + (columnIndex / Math.max(columnCount - 1, 1)) * plotWidth;
        const alpha = Math.min(0.9, value / maxValue);
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
        ctx.fillRect(x, y, Math.max(1, plotWidth / columnCount), Math.max(1, plotHeight / rowCount));
      });
    });
  });
}

function drawHistogramParade(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  const laneWidth = plotWidth / Math.max(channels.length, 1);
  channels.forEach((channel, laneIndex) => {
    const laneLeft = plotLeft + laneIndex * laneWidth + 4;
    drawHistogramTrace(
      ctx,
      channel,
      palette[channel.name],
      robustHistogramPeak([channel]),
      laneLeft,
      plotTop,
      Math.max(1, laneWidth - 8),
      plotHeight,
    );
  });
}

function drawWaveformParade(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  const laneWidth = plotWidth / Math.max(channels.length, 1);
  channels.forEach((channel, laneIndex) => {
    const maxValue = Math.max(1, ...channel.grid.flat());
    const color = hexToRgb(palette[channel.name]);
    const columnCount = Math.max(1, channel.grid?.[0]?.length || 0);
    const rowCount = Math.max(1, channel.grid?.length || 0);
    channel.grid.forEach((row, rowIndex) => {
      const y = plotTop + plotHeight - (rowIndex / Math.max(rowCount - 1, 1)) * plotHeight;
      row.forEach((value, columnIndex) => {
        if (value <= 0) return;
        const x = plotLeft + laneIndex * laneWidth + (columnIndex / Math.max(columnCount - 1, 1)) * (laneWidth - 6);
        const alpha = Math.min(0.9, value / maxValue);
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
        ctx.fillRect(x, y, Math.max(1, (laneWidth - 6) / columnCount), Math.max(1, plotHeight / rowCount));
      });
    });
  });
}

function filteredScopeChannels(channels) {
  if (state.scopeChannelMode === "luma") {
    return channels.filter((channel) => channel.name === "Y");
  }
  if (state.scopeChannelMode === "parade") {
    return channels.filter((channel) => channel.name === "R" || channel.name === "G" || channel.name === "B");
  }
  return channels.filter((channel) => channel.name === "R" || channel.name === "G" || channel.name === "B");
}

function scopeTitleFor(scope) {
  const suffix = state.scopeChannelMode === "luma" ? " Luma" : state.scopeChannelMode === "parade" ? " Parade" : "";
  if (scope.scope_type === "reference_nits_waveform") return `HDR Reference Waveform${suffix}`;
  if (scope.scope_type === "normalized_waveform") return `SDR Waveform${suffix}`;
  if (scope.scope_type === "reference_nits_histogram") return `Reference Nit Histogram${suffix}`;
  return `SDR Histogram${suffix}`;
}

function hexToRgb(value) {
  const normalized = value.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function syncOverlayPlacement() {
  if (els.previewImage.style.display === "none" || els.previewOverlay.style.display === "none") return;
  const frameRect = els.dropzone.getBoundingClientRect();
  const imageRect = els.previewImage.getBoundingClientRect();
  if (!imageRect.width || !imageRect.height) return;
  els.previewOverlay.style.left = `${imageRect.left - frameRect.left}px`;
  els.previewOverlay.style.top = `${imageRect.top - frameRect.top}px`;
  els.previewOverlay.style.width = `${imageRect.width}px`;
  els.previewOverlay.style.height = `${imageRect.height}px`;
}

function seedExportFieldsFromSession() {
  if (!state.session) return;
  const sourceName = state.session.source.filename.replace(/\.[^.]+$/, "");
  if (!els.exportFilename.value || els.exportFilename.value === "hdr_finisher_export") {
    els.exportFilename.value = `${sourceName}_finished`;
  }
}

function buildExportOutputPath() {
  const filename = sanitizeFilename(els.exportFilename.value || "hdr_finisher_export");
  const extension = exportExtensionForFormat(els.exportFormat.value);
  const directory = (els.exportDirectory.value || "").trim();
  return joinExportPath(directory, `${filename}${extension}`);
}

function joinExportPath(directory, filename) {
  if (!directory) return filename;
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return `${directory.replace(/[\\/]$/, "")}${separator}${filename}`;
}

function sanitizeFilename(value) {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "hdr_finisher_export";
}

function exportExtensionForFormat(format) {
  if (format === "sdr_png") return ".png";
  if (format === "jpeg_ultrahdr") return ".jpg";
  if (format === "jpegxl_gain_map") return ".jxl";
  return ".avif";
}

function splitOutputPath(path) {
  const normalized = String(path || "");
  const separator = normalized.includes("\\") && !normalized.includes("/") ? "\\" : "/";
  const parts = normalized.split(/[/\\]/);
  const filename = parts.pop() || "";
  return {
    filename: filename.replace(/\.[^.]+$/, ""),
    directory: parts.join(separator),
  };
}

async function exportCurrentSession() {
  if (!state.session) return;
  const outputPath = buildExportOutputPath();
  els.exportConfirmButton.disabled = true;
  els.exportStatus.textContent = "Encoding and validating the finished file…";
  els.exportResult.classList.add("hidden");
  try {
    const response = await fetch(`/api/session/${state.session.session_id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: els.exportFormat.value,
        quality: Number(els.exportQuality.value),
        output_path: outputPath,
      }),
    });
    const payload = await safeJson(response);
    if (!response.ok) {
      els.exportStatus.textContent = payload?.detail || "Export failed.";
      return;
    }
    els.exportStatus.textContent = payload.message || "Export request finished.";
    if (payload.output_path) {
      const parsed = splitOutputPath(payload.output_path);
      els.exportFilename.value = parsed.filename;
      els.exportDirectory.value = parsed.directory;
      state.lastExportPath = payload.output_path;
      els.exportResultPath.textContent = payload.output_path;
      els.exportResult.classList.remove("hidden");
    }
  } catch (error) {
    console.error(error);
    els.exportStatus.textContent = "Export could not reach the local HDR Finisher server.";
  } finally {
    els.exportConfirmButton.disabled = false;
  }
}

async function chooseExportDirectory() {
  els.exportDirectoryBrowse.disabled = true;
  els.exportStatus.textContent = "Opening folder picker...";
  try {
    const response = await fetch("/api/export-directory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initial_directory: els.exportDirectory.value || null }),
    });
    const payload = await safeJson(response);
    if (!response.ok) {
      els.exportStatus.textContent = payload?.detail || "Folder picker failed.";
      return;
    }
    if (payload?.directory) {
      els.exportDirectory.value = payload.directory;
      els.exportStatus.textContent = `Save folder set to ${payload.directory}`;
      return;
    }
    els.exportStatus.textContent = "Folder selection cancelled.";
  } catch (error) {
    console.error(error);
    els.exportStatus.textContent = "Folder picker could not reach the local HDR Finisher server.";
  } finally {
    els.exportDirectoryBrowse.disabled = false;
  }
}

async function applyInterpretationOverride() {
  if (!state.session) return;
  const override = interpretationPayload();
  els.badge.textContent = "Re-interpreting source file...";
  setPreviewMessage("Rebuilding preview with the new interpretation...");
  try {
    const response = await fetch(`/api/session/${state.session.session_id}/interpretation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(override),
    });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.session) {
      els.badge.textContent = payload?.detail || "Interpretation override failed.";
      els.badge.className = "badge bad";
      setPreviewError(payload?.detail || "Interpretation override failed.");
      return;
    }
    state.session = payload.session;
    state.adjustments = payload.session.adjustments;
    state.interpretationGateDismissed = false;
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    renderSession();
    await refreshPreview();
    await refreshOverlay();
    await refreshScopes();
    prepareInactivePreview();
  } catch (error) {
    console.error(error);
    els.badge.textContent = "Interpretation override could not reach the local HDR Finisher server.";
    els.badge.className = "badge bad";
    setPreviewError(els.badge.textContent);
  }
}

async function resetInterpretationToAuto() {
  if (!state.session) return;
  els.interpretationMode.value = "auto";
  els.interpretationColorSpace.value = "auto";
  els.interpretationTransfer.value = "auto";
  renderSourceSettingsControls();
  await applyInterpretationOverride();
}

function badgeClass(classification) {
  if (classification === "HDR_TRUE") return "badge good";
  if (classification === "HDR_ENCODED" || classification === "HDR_LINEAR_UNCONFIRMED") return "badge warn";
  return "badge bad";
}

function setValueByPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]];
  cursor[parts.at(-1)] = value;
}

function getValueByPath(target, path) {
  return path.split(".").reduce((cursor, key) => cursor?.[key], target);
}

function syncControlsFromState() {
  els.controls.forEach((control) => {
    const value = getValueByPath(state.adjustments, control.dataset.path);
    if (value === undefined) return;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = String(value);
  });
  updateControlReadouts();
}

function syncCurveControlsFromState() {
  els.curvesEnabled.checked = Boolean(getValueByPath(state.adjustments, curveEnabledPath()));
  els.curveRemove.disabled = currentCurveValues().length <= 2 || isLockedCurveEndpoint(state.selectedCurvePoint);
}

function renderSessionChrome() {
  const hasSession = Boolean(state.session);
  els.ejectButton.disabled = !hasSession;
  els.exportButton.disabled = !hasSession;
  els.emptyImportButton.disabled = hasSession;
  document.querySelectorAll(".grade-rail input, .grade-rail select, .grade-rail button").forEach((control) => {
    control.disabled = !hasSession;
  });
  els.viewButtons.forEach((button) => {
    button.disabled = !hasSession;
  });
}

function renderCurveChannelTabs() {
  els.curveChannelButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.curveChannel === state.selectedCurveChannel);
  });
}

function bindCurveEditor() {
  const canvas = els.curveEditor;
  const beginDrag = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    state.activeCurvePoint = nearestCurvePointIndex(clientX, clientY, rect);
    state.selectedCurvePoint = state.activeCurvePoint;
    updateCurveFromPointer(clientX, clientY);
    const move = (event) => {
      event.preventDefault();
      updateCurveFromPointer(event.clientX, event.clientY);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      state.activeCurvePoint = null;
      syncCurveControlsFromState();
      invalidatePreview(state.currentView);
      renderControlState();
      debouncePreview(state.currentView);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  canvas.addEventListener("pointerdown", (event) => {
    beginDrag(event.clientX, event.clientY);
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
      const step = event.shiftKey ? 0.05 : 0.01;
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

function updateCurveFromPointer(clientX, clientY) {
  const rect = els.curveEditor.getBoundingClientRect();
  const index = state.activeCurvePoint ?? nearestCurvePointIndex(clientX, clientY, rect);
  const normalizedX = clamp((clientX - rect.left) / rect.width, 0, 1);
  const normalizedY = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
  const curve = currentCurveValues();
  const point = [...curve[index]];
  if (index === 0) point[0] = 0;
  else if (index === curve.length - 1) point[0] = 1;
  else point[0] = clamp(normalizedX, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
  point[1] = clamp(normalizedY, 0, 1);
  curve[index] = point;
  state.selectedCurvePoint = index;
  setCurveValues(state.selectedCurveChannel, curve);
  drawCurveEditor();
}

function drawCurveEditor() {
  const canvas = els.curveEditor;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 18;
  const curve = currentCurveValues();
  const curveSamples = sampleCurvePoints(curve, 96);
  const channelColor = curveColor(state.selectedCurveChannel);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#101010";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const x = padding + ((width - padding * 2) * step) / 4;
    const y = padding + ((height - padding * 2) * step) / 4;
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, height - padding);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(236,233,223,0.18)";
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, padding);
  ctx.stroke();

  ctx.strokeStyle = channelColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  curveSamples.forEach(([xValue, yValue], index) => {
    const x = padding + xValue * (width - padding * 2);
    const y = height - padding - yValue * (height - padding * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  curve.forEach(([xValue, yValue], index) => {
    const x = padding + xValue * (width - padding * 2);
    const y = height - padding - yValue * (height - padding * 2);
    ctx.fillStyle = index === state.selectedCurvePoint ? "#efbb55" : index === 0 || index === curve.length - 1 ? "#7f7a6f" : "#ece9df";
    ctx.beginPath();
    ctx.arc(x, y, index === state.selectedCurvePoint ? 6 : index === 0 || index === curve.length - 1 ? 4 : 5, 0, Math.PI * 2);
    ctx.fill();
  });
  syncCurveControlsFromState();
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

function curveEnabledPath() {
  return `${currentCurveLane()}.curves_enabled`;
}

function currentCurveLane() {
  return state.currentView === "sdr" ? "sdr" : "hdr";
}

function nearestCurvePointIndex(clientX, clientY, rect) {
  const normalizedX = clamp((clientX - rect.left) / rect.width, 0, 1);
  const normalizedY = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
  const curve = currentCurveValues();
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  curve.forEach(([x, y], index) => {
    const distance = ((x - normalizedX) ** 2) + ((y - normalizedY) ** 2);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function addCurvePoint() {
  const curve = currentCurveValues();
  if (curve.length >= 16) return;
  let insertIndex = 1;
  let widestGap = -1;
  for (let index = 0; index < curve.length - 1; index += 1) {
    const gap = curve[index + 1][0] - curve[index][0];
    if (gap > widestGap) {
      widestGap = gap;
      insertIndex = index + 1;
    }
  }
  const x = curve[insertIndex - 1][0] + widestGap / 2;
  const [[, y]] = sampleCurvePoints(curve, 1, x);
  curve.splice(insertIndex, 0, [x, y]);
  state.selectedCurvePoint = insertIndex;
  setCurveValues(state.selectedCurveChannel, curve);
}

function removeCurvePoint() {
  const curve = currentCurveValues();
  const index = state.selectedCurvePoint ?? Math.floor(curve.length / 2);
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
  if (channel === "red") return "#ff8585";
  if (channel === "green") return "#7fe6a8";
  if (channel === "blue") return "#7db8ff";
  return "#ece9df";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function defaultCurvePoints() {
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

async function applyPreviewUrl(url) {
  try {
    await new Promise((resolve, reject) => {
      els.previewImage.onload = () => resolve();
      els.previewImage.onerror = () => reject(new Error("Image element could not load preview data."));
      els.previewImage.src = url;
    });
  } catch (error) {
    setPreviewError(error.message || "Preview image failed to decode.");
    return;
  } finally {
    els.previewImage.onload = null;
    els.previewImage.onerror = null;
  }

  els.previewImage.style.display = "block";
  els.emptyState.style.display = "none";
  setZoomMode(state.zoomMode);
  syncOverlayPlacement();
  updateZoomReadout();
  hidePreviewMessage();
}

async function applyOverlayUrl(url) {
  const previousUrl = els.previewOverlay.dataset.objectUrl;
  try {
    await new Promise((resolve, reject) => {
      els.previewOverlay.onload = () => resolve();
      els.previewOverlay.onerror = () => reject(new Error("Overlay image failed to decode."));
      els.previewOverlay.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    clearPreviewOverlay();
    return;
  } finally {
    els.previewOverlay.onload = null;
    els.previewOverlay.onerror = null;
  }

  if (previousUrl) URL.revokeObjectURL(previousUrl);
  els.previewOverlay.dataset.objectUrl = url;
  els.previewOverlay.style.display = "block";
  syncOverlayPlacement();
}

function clearPreviewImage() {
  els.previewImage.removeAttribute("src");
  els.previewImage.style.display = "none";
  els.emptyState.style.display = "grid";
  clearPreviewOverlay();
}

function clearPreviewOverlay() {
  const previousUrl = els.previewOverlay.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  delete els.previewOverlay.dataset.objectUrl;
  els.previewOverlay.removeAttribute("src");
  els.previewOverlay.style.display = "none";
  els.previewOverlay.style.left = "";
  els.previewOverlay.style.top = "";
  els.previewOverlay.style.width = "";
  els.previewOverlay.style.height = "";
}

function setPreviewMessage(message) {
  els.previewStatus.textContent = message;
  els.previewStatus.classList.remove("hidden", "error");
}

function setPreviewError(message) {
  els.previewStatus.textContent = message;
  els.previewStatus.classList.remove("hidden");
  els.previewStatus.classList.add("error");
}

function hidePreviewMessage() {
  els.previewStatus.textContent = "";
  els.previewStatus.classList.add("hidden");
  els.previewStatus.classList.remove("error");
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function defaultInterpretationValue(session) {
  const transfer = (session.source.transfer_function || "").toLowerCase();
  const colorSpace = (session.source.source_color_space || "").toLowerCase();
  if (colorSpace.includes("2020")) return "linear_bt2020";
  if (colorSpace.includes("acescg")) return "linear_acescg";
  if (colorSpace.includes("display p3") || colorSpace === "p3") return "linear_p3";
  return "linear_srgb";
}

function syncInterpretationControls(session) {
  const mode = session.source.interpretation_mode === "manual" ? "manual" : "auto";
  els.interpretationMode.value = mode;
  els.interpretationColorSpace.value = defaultInterpretationValue(session);
  els.interpretationTransfer.value = defaultTransferValue(session);
  els.sourceSettingsNote.textContent = session.analysis.needs_color_override
    ? "Auto detection found an ambiguous source interpretation. Manual override is recommended before trusting export decisions."
    : "Color Primaries controls gamut. Transfer Function controls encoding. Use Manual only when the file metadata is missing, wrong, or you know the render pipeline better than the file does.";
}

function renderSourceSettingsVisibility() {
  els.sourceSettingsPanel.classList.toggle("hidden", !state.sourceSettingsOpen || !state.session);
  els.sourceSettingsToggle.setAttribute("aria-expanded", String(state.sourceSettingsOpen && Boolean(state.session)));
}

function renderSourceSettingsControls() {
  const manual = els.interpretationMode.value === "manual";
  els.interpretationColorSpace.disabled = !manual;
  els.interpretationTransfer.disabled = !manual;
}

function defaultTransferValue(session) {
  const transfer = (session.source.transfer_function || "").toLowerCase();
  if (transfer.includes("pq")) return "pq";
  if (transfer.includes("hlg")) return "hlg";
  if (transfer.includes("srgb")) return "srgb";
  return "linear";
}

function interpretationPayload() {
  if (els.interpretationMode.value !== "manual") return { color_space: null, transfer_function: null };
  const mapped = interpretationPayloadFromColorSpace(els.interpretationColorSpace.value);
  const transfer = interpretationTransferPayload(els.interpretationTransfer.value, mapped.transfer_function);
  return { color_space: mapped.color_space, transfer_function: transfer };
}

function interpretationPayloadFromColorSpace(value) {
  if (value === "auto") return { color_space: null, transfer_function: null };
  return interpretationPayloadLegacy(value);
}

function interpretationTransferPayload(value, fallback) {
  if (value === "auto") return fallback ?? null;
  if (value === "pq") return "PQ";
  if (value === "hlg") return "HLG";
  if (value === "srgb") return "sRGB";
  return "LINEAR";
}

function interpretationPayloadLegacy(value) {
  if (value === "linear_acescg") return { color_space: "ACEScg", transfer_function: "LINEAR" };
  if (value === "linear_bt2020") return { color_space: "BT.2020", transfer_function: "LINEAR" };
  if (value === "linear_p3") return { color_space: "Display P3", transfer_function: "LINEAR" };
  return { color_space: "sRGB", transfer_function: "LINEAR" };
}

function overrideMessage(session) {
  const note = session.metadata.extra?.color_space_note;
  if (note) return note;
  if (session.analysis.needs_color_override) return "This file needs a color interpretation override before export decisions are trustworthy.";
  return "Auto source interpretation looks consistent.";
}

function interpretationSummary(session) {
  const mode = session.source.interpretation_mode === "manual" ? "Manual" : "Auto";
  const colorSpace = session.source.source_color_space || "unknown primaries";
  const transfer = session.source.transfer_function || "unknown transfer";
  return `${mode}: ${colorSpace} + ${transfer}`;
}

function buildDisplayProbe() {
  return {
    dynamicRange: mediaQueryMatch("(dynamic-range: high)") ? "high" : "standard/unknown",
    colorGamut: mediaQueryMatch("(color-gamut: rec2020)")
      ? "rec2020"
      : mediaQueryMatch("(color-gamut: p3)")
        ? "p3"
        : mediaQueryMatch("(color-gamut: srgb)")
          ? "srgb"
          : "unknown",
    pixelRatio: String(window.devicePixelRatio || 1),
    screenDepth: `${window.screen?.colorDepth || "?"}-bit`,
    browser: navigator.userAgentData?.brands?.map((brand) => brand.brand).join(", ") || navigator.userAgent,
  };
}

function mediaQueryMatch(query) {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function previewInfoFromResponse(response, kind) {
  const mediaType = response.headers.get("content-type") || "unknown";
  if (kind === "hdr") {
    return {
      mediaType,
      transport: "AVIF",
      colorSpace: "BT.2020",
      transfer: "PQ",
      bitDepth: "10-bit 4:4:4",
      notes: "Browser-decoded HDR preview",
    };
  }
  return {
    mediaType,
    transport: "PNG",
    colorSpace: "sRGB",
    transfer: "sRGB",
    bitDepth: "8-bit",
    notes: "Embedded or derived SDR fallback",
  };
}

function renderMetadataVisibility() {
  const open = state.metadataOpen && Boolean(state.session);
  els.metadataPanel.classList.toggle("hidden", !open);
  els.metadataToggle.setAttribute("aria-expanded", String(open));
}

function openManualInterpretation() {
  if (!state.session) return;
  state.sourceSettingsOpen = true;
  els.interpretationMode.value = "manual";
  renderSourceSettingsVisibility();
  renderSourceSettingsControls();
  els.interpretationColorSpace.focus();
}

function renderInterpretationGate() {
  const needsReview = Boolean(state.session?.analysis?.needs_color_override);
  const visible = needsReview && !state.interpretationGateDismissed;
  els.interpretationGate.classList.toggle("hidden", !visible);
  if (needsReview) {
    els.interpretationGateCopy.textContent = overrideMessage(state.session);
  }
}

async function switchLane(lane) {
  if (!["hdr", "sdr"].includes(lane)) return;
  if (state.currentView === lane && cacheReady(lane)) {
    renderLaneChrome();
    return;
  }
  state.currentView = lane;
  state.adjustments.shared.active_focus = lane;
  state.selectedCurvePoint = Math.min(state.selectedCurvePoint ?? 0, currentCurveValues().length - 1);
  renderLaneChrome();
  syncCurveControlsFromState();
  renderCurveChannelTabs();
  drawCurveEditor();
  renderReadouts();
  if (cacheReady(lane)) await showCachedPreview(lane);
  else await refreshPreview();
  await refreshOverlay();
  await refreshScopes();
  prepareInactivePreview();
}

function renderLaneChrome() {
  const lane = state.currentView;
  const label = lane === "hdr" ? "HDR Grade" : "SDR Fallback";
  document.body.dataset.activeLane = lane;
  els.viewButtons.forEach((button) => button.classList.toggle("active", button.dataset.kind === lane));
  els.lanePanels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.lanePanel !== lane));
  els.viewerLaneLabel.textContent = label;
  els.viewerBranchNote.textContent = branchCopy[lane];
  els.laneNote.textContent = branchCopy[lane];
  els.scopeKindLabel.textContent = lane.toUpperCase();
  state.previewInfo = state.previewInfoByLane[lane];
  renderCompareStatus();
  updateControlReadouts();
  renderControlState();
}

function invalidatePreview(lane) {
  state.previewGeneration[lane] += 1;
  renderCompareStatus();
  renderExportPreflight();
}

function clearPreviewCache() {
  for (const lane of ["hdr", "sdr"]) {
    state.previewControllers[lane]?.abort();
    state.previewControllers[lane] = null;
    const cached = state.previewCache[lane];
    if (cached?.url) URL.revokeObjectURL(cached.url);
    state.previewCache[lane] = null;
    state.previewGeneration[lane] = 0;
  }
  state.comparePeekActive = false;
  clearPreviewImage();
}

function cacheReady(lane) {
  const cached = state.previewCache[lane];
  return Boolean(cached?.url && cached.generation === state.previewGeneration[lane]);
}

async function showCachedPreview(lane) {
  const cached = state.previewCache[lane];
  if (!cached?.url) return;
  await applyPreviewUrl(cached.url);
  state.previewInfo = state.previewInfoByLane[lane];
  renderReadouts();
}

function prepareInactivePreview() {
  if (!state.session) return;
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  if (cacheReady(other)) {
    renderCompareStatus();
    return;
  }
  window.setTimeout(() => {
    renderPreviewForLane(other, false).catch(() => null);
  }, 80);
}

function renderCompareStatus() {
  if (!state.session) {
    els.compareStatus.textContent = "No comparison";
    els.compareButton.disabled = true;
    return;
  }
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  const ready = cacheReady(other);
  els.compareButton.disabled = !ready;
  els.compareStatus.textContent = ready ? `${other.toUpperCase()} ready` : `Preparing ${other.toUpperCase()}…`;
}

function bindCompareControl() {
  els.compareButton.addEventListener("click", async () => {
    const other = state.currentView === "hdr" ? "sdr" : "hdr";
    if (cacheReady(other)) await switchLane(other);
  });
}

function beginCompareHold() {
  if (!state.session || state.compareHoldTimer || state.comparePeekActive) return;
  state.compareHeld = true;
  state.compareHoldTimer = window.setTimeout(async () => {
    state.compareHoldTimer = null;
    if (!state.compareHeld) return;
    await peekOtherLane();
  }, 180);
}

async function endCompareHold() {
  if (!state.compareHeld) return;
  state.compareHeld = false;
  if (state.compareHoldTimer) {
    window.clearTimeout(state.compareHoldTimer);
    state.compareHoldTimer = null;
    const other = state.currentView === "hdr" ? "sdr" : "hdr";
    if (cacheReady(other)) await switchLane(other);
    return;
  }
  if (state.comparePeekActive) await restoreActiveLane();
}

async function peekOtherLane() {
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  if (!cacheReady(other)) {
    els.compareStatus.textContent = `Preparing ${other.toUpperCase()}…`;
    return;
  }
  state.comparePeekActive = true;
  clearPreviewOverlay();
  await showCachedPreview(other);
  els.viewerLaneLabel.textContent = `${other.toUpperCase()} peek · release V`;
}

async function restoreActiveLane() {
  state.comparePeekActive = false;
  await showCachedPreview(state.currentView);
  renderLaneChrome();
  await refreshOverlay();
}

function bindKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (event.repeat || isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "v") {
      event.preventDefault();
      beginCompareHold();
    } else if (key === "f") {
      event.preventDefault();
      setZoomMode("fit");
    } else if (key === "a") {
      event.preventDefault();
      setZoomMode("actual");
    } else if (key === "s") {
      event.preventDefault();
      toggleAnalysisDock();
    } else if (key === "c") {
      event.preventDefault();
      cycleOverlayMode();
    } else if (key === "d") {
      event.preventDefault();
      els.fileInput.click();
    } else if (key === "x") {
      event.preventDefault();
      openExportSheet();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.key.toLowerCase() === "v" && !isTypingTarget(event.target)) {
      event.preventDefault();
      endCompareHold();
    }
  });
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function setZoomMode(mode) {
  state.zoomMode = mode === "actual" ? "actual" : "fit";
  const actual = state.zoomMode === "actual";
  els.previewImage.classList.toggle("zoom-actual", actual);
  els.dropzone.classList.toggle("zoom-actual", actual);
  els.zoomFit.classList.toggle("active", !actual);
  els.zoomActual.classList.toggle("active", actual);
  updateZoomReadout();
  window.setTimeout(syncOverlayPlacement, 0);
}

function updateZoomReadout() {
  if (!state.session || els.previewImage.style.display === "none") {
    els.zoomReadout.textContent = state.zoomMode === "actual" ? "1:1" : "Fit";
    return;
  }
  if (state.zoomMode === "actual") {
    els.zoomReadout.textContent = "100%";
    return;
  }
  const sourceWidth = Math.max(1, state.session.source.width);
  const percent = Math.round((els.previewImage.getBoundingClientRect().width / sourceWidth) * 100);
  els.zoomReadout.textContent = `Fit ${Math.max(1, percent)}%`;
}

function toggleOverlayPopover() {
  const open = els.overlayPopover.classList.toggle("hidden") === false;
  els.overlayToggle.setAttribute("aria-expanded", String(open));
}

function closeOverlayPopover() {
  els.overlayPopover.classList.add("hidden");
  els.overlayToggle.setAttribute("aria-expanded", "false");
  els.overlayToggle.focus();
}

function cycleOverlayMode() {
  const order = ["off", "false_color", "zebra"];
  const current = state.adjustments.shared.overlay_mode || "off";
  const next = order[(order.indexOf(current) + 1) % order.length];
  state.adjustments.shared.overlay_mode = next;
  const control = document.querySelector('[data-path="shared.overlay_mode"]');
  if (control) control.value = next;
  renderOverlayPresetNote();
  refreshOverlay();
}

function toggleAnalysisDock() {
  state.dockCollapsed = !state.dockCollapsed;
  els.analysisDock.classList.toggle("collapsed", state.dockCollapsed);
  els.dockCollapse.textContent = state.dockCollapsed ? "Open" : "Collapse";
  els.dockCollapse.setAttribute("aria-expanded", String(!state.dockCollapsed));
}

async function activateDockTab(tab) {
  state.activeDockTab = tab;
  state.dockCollapsed = false;
  els.analysisDock.classList.remove("collapsed");
  els.dockCollapse.textContent = "Collapse";
  els.dockCollapse.setAttribute("aria-expanded", "true");
  els.dockTabs.forEach((button) => {
    const active = button.dataset.dockTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const technical = tab === "technical";
  els.scopeView.classList.toggle("hidden", technical);
  els.technicalView.classList.toggle("hidden", !technical);
  if (technical) return;
  state.scopeMode = tab === "waveform" || tab === "parade" ? "waveform" : "histogram";
  state.scopeChannelMode = tab === "parade" ? "parade" : "composite";
  els.scopeMode.value = state.scopeMode;
  els.scopeChannelMode.value = state.scopeChannelMode;
  await refreshScopes();
}

function renderDockSummary() {
  const stats = state.lastScope?.stats || [];
  const wanted = stats.filter((item) => /Peak|% > 1000/.test(item.label)).slice(0, 2);
  els.dockSummary.textContent = wanted.length
    ? wanted.map((item) => `${item.label} ${item.value}`).join(" · ")
    : "Full-resolution processing stats";
}

function updateControlReadouts() {
  els.valueOutputs.forEach((output) => {
    const path = output.dataset.valuePath;
    const value = getValueByPath(state.adjustments, path);
    if (value === undefined) return;
    const text = formatControlValue(path, value);
    output.textContent = text;
    const control = document.querySelector(`[data-path="${path}"]`);
    if (control) control.setAttribute("aria-valuetext", text);
  });
}

function formatControlValue(path, value) {
  const numeric = Number(value);
  if (path.endsWith("white_balance_kelvin")) return `${Math.round(numeric)} K`;
  if (path.endsWith(".exposure")) return `${numeric.toFixed(2)} EV`;
  if (path === "shared.overlay_opacity") return `${Math.round(numeric * 100)}%`;
  if (path === "shared.overlay_threshold") return `${Math.round(numeric * 100)} nit`;
  if (path === "sdr.tone_contrast") return numeric.toFixed(2);
  if (path === "sdr.tone_skew") return numeric > 0 ? `+${numeric.toFixed(2)}` : numeric.toFixed(2);
  if (path.endsWith("contrast_pivot")) return numeric.toFixed(path.startsWith("hdr.") ? 4 : 3);
  if (path.endsWith("contrast") || path.endsWith("lift") || path.endsWith("gain") || path.endsWith("gamma") || path.endsWith("shadow_lift")) return numeric.toFixed(3);
  return numeric.toFixed(2);
}

function renderControlState() {
  const defaults = defaultAdjustments();
  const filmicEnabled = state.adjustments.sdr?.tone_mapper === "filmic";
  document.querySelectorAll("[data-filmic-control]").forEach((row) => {
    row.classList.toggle("control-disabled", !filmicEnabled);
    row.querySelectorAll("input").forEach((input) => {
      input.disabled = !filmicEnabled;
    });
  });
  els.controlRows.forEach((row) => {
    row.classList.toggle("modified", isPathModified(row.dataset.controlPath, defaults));
  });
  for (const [group, paths] of Object.entries(controlGroups)) {
    const count = paths.filter((path) => isPathModified(path, defaults)).length;
    const output = document.querySelector(`[data-modified-count="${group}"]`);
    if (output) output.textContent = count ? `${count} modified` : "Default";
  }
  for (const lane of ["hdr", "sdr"]) {
    const keys = Object.keys(defaults[lane]).filter((key) => !key.endsWith("_curve"));
    const modified = keys.some((key) => !valuesEqual(state.adjustments[lane]?.[key], defaults[lane][key]))
      || laneCurvesModified(lane, defaults);
    const button = els.viewButtons.find((item) => item.dataset.kind === lane);
    button?.classList.toggle("modified", modified);
  }
  const currentLaneDefaults = defaults[state.currentView];
  const modifiedCount = Object.keys(currentLaneDefaults).filter((key) => !valuesEqual(state.adjustments[state.currentView]?.[key], currentLaneDefaults[key])).length;
  els.gradeModifiedSummary.textContent = modifiedCount ? `${modifiedCount} modified` : "Default";
  els.curveGroupState.textContent = laneCurvesModified(state.currentView, defaults) ? "Modified" : "Default";
}

function isPathModified(path, defaults = defaultAdjustments()) {
  return !valuesEqual(getValueByPath(state.adjustments, path), getValueByPath(defaults, path));
}

function valuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right);
  return left === right;
}

function laneCurvesModified(lane, defaults = defaultAdjustments()) {
  return ["curves_enabled", "luma_curve", "red_curve", "green_curve", "blue_curve"]
    .some((key) => !valuesEqual(state.adjustments[lane]?.[key], defaults[lane][key]));
}

function resetControlGroup(group) {
  const paths = controlGroups[group] || [];
  if (!paths.length) return;
  const defaults = defaultAdjustments();
  paths.forEach((path) => setValueByPath(state.adjustments, path, getValueByPath(defaults, path)));
  syncControlsFromState();
  invalidatePreview(group.startsWith("sdr-") ? "sdr" : "hdr");
  renderControlState();
  debouncePreview(group.startsWith("sdr-") ? "sdr" : "hdr");
}

function openExportSheet() {
  if (!state.session) return;
  renderCapabilities();
  renderFormatCards();
  renderExportPreflight();
  els.exportStatus.textContent = "Choose a format and destination.";
  if (typeof els.exportSheet.showModal === "function") els.exportSheet.showModal();
  else els.exportSheet.setAttribute("open", "");
}

function closeExportSheet() {
  if (typeof els.exportSheet.close === "function") els.exportSheet.close();
  else els.exportSheet.removeAttribute("open");
  els.exportButton.focus();
}

function renderCapabilities() {
  const keys = ["avif_gain_map_encoder", "ultrahdr_encoder", "jpegxl_encoder"];
  const available = keys.filter((key) => state.capabilities[key]?.status === "available").length;
  els.capabilitySummary.textContent = `${available}/3 encoders ready`;
  els.capabilitySummary.className = `capability-chip ${available >= 2 ? "ready" : "attention"}`;

  document.querySelectorAll("[data-capability-for]").forEach((element) => {
    const capability = state.capabilities[element.dataset.capabilityFor];
    const ready = capability?.status === "available";
    element.textContent = ready ? "Ready" : capability?.status === "unverified" ? "Unverified" : "Unavailable";
    element.className = ready ? "ready" : "attention";
    element.title = capability?.detail || "Capability status unavailable.";
  });

  const jxl = state.capabilities.jpegxl_encoder;
  document.getElementById("jxl-capability").textContent = jxl?.status === "available"
    ? "JPEG XL encoder detected · gain-map export is not enabled in this build"
    : "JPEG XL · not in this build";

  els.formatCards.forEach((card) => {
    const format = card.dataset.formatCard;
    const capability = state.capabilities[capabilityForFormat[format]];
    const availableForExport = capability?.status === "available";
    card.classList.toggle("unavailable", !availableForExport);
    const radio = card.querySelector("input");
    radio.disabled = !availableForExport;
    card.title = availableForExport ? "" : capability?.detail || "This export path is unavailable.";
  });

  const selected = els.exportFormatChoices.find((choice) => choice.checked && !choice.disabled);
  if (!selected) {
    const fallback = els.exportFormatChoices.find((choice) => !choice.disabled);
    if (fallback) {
      fallback.checked = true;
      els.exportFormat.value = fallback.value;
    }
  }
}

function renderFormatCards() {
  els.formatCards.forEach((card) => {
    card.classList.toggle("selected", card.dataset.formatCard === els.exportFormat.value);
  });
}

function renderExportPreflight() {
  const needsOverride = Boolean(state.session?.analysis?.needs_color_override);
  const sourceReady = Boolean(state.session) && (!needsOverride || state.interpretationGateDismissed);
  const encoderKey = capabilityForFormat[els.exportFormat.value];
  const encoderReady = state.capabilities[encoderKey]?.status === "available";
  setPreflight(
    "source",
    sourceReady,
    sourceReady ? "Source interpretation confirmed" : "Source interpretation needs confirmation",
  );
  setPreflight("hdr", cacheReady("hdr"), cacheReady("hdr") ? "HDR branch ready" : "HDR preview preparing");
  setPreflight("sdr", cacheReady("sdr"), cacheReady("sdr") ? "SDR fallback ready" : "SDR fallback preparing");
  setPreflight("encoder", encoderReady, encoderReady ? "Encoder available" : "Encoder unavailable");
  els.exportConfirmButton.disabled = !state.session || !sourceReady || !encoderReady;
}

function setPreflight(name, pass, label) {
  const item = els.preflightItems.find((element) => element.dataset.preflight === name);
  if (!item) return;
  item.textContent = label;
  item.classList.toggle("pass", pass);
  item.classList.toggle("warn", !pass);
}

async function copyLastExportPath() {
  if (!state.lastExportPath) return;
  try {
    await navigator.clipboard.writeText(state.lastExportPath);
    els.copyExportPath.textContent = "Copied";
  } catch {
    els.copyExportPath.textContent = "Copy failed";
  }
}

function updateProbeReadout(event) {
  if (!state.session || els.previewImage.style.display === "none") return;
  const rect = els.previewImage.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
    els.probeReadout.textContent = "Move over the image for pixel coordinates";
    return;
  }
  const normalizedX = (event.clientX - rect.left) / Math.max(1, rect.width);
  const normalizedY = (event.clientY - rect.top) / Math.max(1, rect.height);
  const x = Math.min(state.session.source.width - 1, Math.max(0, Math.floor(normalizedX * state.session.source.width)));
  const y = Math.min(state.session.source.height - 1, Math.max(0, Math.floor(normalizedY * state.session.source.height)));
  els.probeReadout.textContent = `x ${x} · y ${y} · ${state.currentView.toUpperCase()} preview`;
}

renderSessionChrome();
renderCurveChannelTabs();
