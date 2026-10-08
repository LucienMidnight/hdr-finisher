function renderSession() {
  const session = state.session;
  els.hdrReferenceWhite.value = String(projectReferenceWhiteNits());
  els.hdrReferenceWhite.disabled = false;
  renderExperimentalDngNote(session);
  renderSourceFilename(session.source.filename);
  clearPreviewOverlay();
  syncProjectBadge();
  syncCopySourcePathButton();
  syncInterpretationControls(session);
  renderRawImportControls(session);
  applyLatitudePresets(session.analysis.source_latitude);
  renderSourceSettingsVisibility();
  renderSourceSettingsControls();
  renderMetadata(session);
  renderReadouts();
  syncControlsFromState();
  syncCurveControlsFromState();
  renderSessionChrome();
  drawCurveEditor();
  drawToneEqualizerEditor();
  renderOverlayPresetNote();
  renderMetadataVisibility();
  renderInterpretationGate();
  renderLaneChrome();
  renderControlState();
  updateExportAvailability();
  window.HDRProofing?.reset();
}

function formatFocalLength(value) {
  const text = String(value ?? "").trim();
  if (!text) return "n/a";
  if (/mm\b/i.test(text)) return text;
  const numeric = Number(text);
  return `${Number.isFinite(numeric) ? numeric : text} mm`;
}

function formatAperture(value) {
  const text = String(value ?? "").trim();
  if (!text) return "n/a";
  if (/^f\s*\//i.test(text)) return text;
  const numeric = Number(text);
  return `f/${Number.isFinite(numeric) ? numeric : text}`;
}

function renderMetadata(session) {
  const entries = [
    ["Size", `${session.source.width} x ${session.source.height}`],
    ["Current Preview Size", currentPreviewSizeLabel()],
    ["Format", session.source.suffix],
    ["Working space", session.source.working_space],
    ["Source space", session.source.source_color_space || "unknown"],
    ["Transfer", session.source.transfer_function || "unknown"],
    ["Interpretation", session.source.interpretation_mode || "auto"],
    ["Confidence", session.source.color_space_confident ? "confirmed" : "review"],
    ["Bit depth", session.metadata.bit_depth || "unknown"],
    ["Camera make", session.metadata.camera_maker || "n/a"],
    ["Camera model", session.metadata.camera_model || "n/a"],
    ["Lens make", session.metadata.lens_maker || "n/a"],
    ["Lens model", session.metadata.lens || "n/a"],
    ["ISO", session.metadata.iso || "n/a"],
    ["Shutter", session.metadata.shutter_speed || "n/a"],
    ["Focal length", formatFocalLength(session.metadata.focal_length_mm)],
    ["Aperture", formatAperture(session.metadata.aperture)],
  ];
  if (session.metadata.extra?.experimental_dng_import === "True") {
    entries.push(
      ["DNG status", session.metadata.extra.experimental_dng_label || "Experimental DNG Import"],
      ["DNG route", session.metadata.extra.dng_route || "unknown"],
      ["DNG color path", session.metadata.extra.dng_color_path || "unknown"],
      ["DNG operations", session.metadata.extra.dng_operations || "none"],
      ["DNG warnings", session.metadata.extra.dng_warnings || "none"],
    );
  }
  if (session.metadata.extra?.raw_pipeline) {
    entries.push(["RAW pipeline", session.metadata.extra.raw_pipeline]);
  }
  if (session.metadata.extra?.raw_fallback_reason) {
    entries.push(["RAW compatibility fallback", session.metadata.extra.raw_fallback_reason]);
  }
  els.metadataList.innerHTML = "";
  for (const [key, value] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (key === "Current Preview Size") dd.id = "metadata-current-preview-size";
    els.metadataList.append(dt, dd);
  }
}

function currentPreviewSizeLabel() {
  const target = previewResolutionLabel(state.previewResolutionOverride ? state.previewResolution : "display");
  const presentation = state.acceptedPresentation;
  if (!presentation?.width || !presentation?.height || presentation.lane !== state.currentView) return `${target} · Waiting`;
  // A presentation that is not yet the selected tier says so. Reporting the
  // selected tier next to a smaller pixel count is the exact misreport the
  // stable-tier contract exists to prevent.
  const qualifier = presentation.exact ? "" : " · placeholder";
  return `${target} · ${presentation.width} × ${presentation.height}${qualifier}`;
}

function renderCurrentPreviewSize(options) {
  const value = document.getElementById("metadata-current-preview-size");
  if (value) value.textContent = currentPreviewSizeLabel(options);
}

function renderReadouts() {
  renderPresentationCapability();
  if (els.technicalPreviewList) {
    const technical = technicalSummaryEntries();
    renderKeyValueList(els.technicalPreviewList, technical.preview);
    renderKeyValueList(els.technicalDisplayList, technical.display);
    renderKeyValueList(els.technicalSourceList, technical.source);
  }
  renderKeyValueList(els.previewOutputList, previewOutputEntries());
  renderKeyValueList(els.displayInfoList, displayProbeEntries());
  renderKeyValueList(els.sourcePreviewList, sourceInterpretationEntries());
  renderWorkflowContext();
}

function technicalSummaryEntries() {
  const viewer = viewerState();
  const accepted = state.acceptedPresentation;
  const lane = state.currentView === "sdr" ? "SDR" : "HDR";
  const zoom = state.zoomMode === "fit" ? "Fit" : `${Math.round(state.zoomPercent)}%`;
  const status = viewer.status === "ready" ? "Ready"
    : viewer.status === "unavailable" ? `Unavailable${viewer.detail ? ` — ${viewer.detail}` : ""}`
      : viewer.coarse ? "Coarse — sharpening"
        : viewer.status === "updating" ? "Updating" : "Preparing";
  const detail = !state.session || !accepted ? "Waiting"
    : accepted.exact ? "Full detail"
      : accepted.coarse ? "Softer while dragging" : "Placeholder";
  const setting = state.fasterDragging ? " · faster dragging on" : "";
  const execution = previewExecutionMode();
  const route = execution === "direct-cpu" ? "On the processor (CPU)" : execution === "tiled-gpu" ? "In tiles" : "Whole image";
  const memory = state.gpuMemoryBudget === "auto" || state.gpuMemoryBudget === undefined
    ? (window.HDRGpuBudget?.autoLabel?.(state.gpuPreview?.gpuBudget) || "Auto")
    : `${state.gpuMemoryBudget} GiB`;
  const presentation = state.presentationCapability || presentationCapabilityState();
  const display = state.desktopEnvironment?.currentDisplay;
  const preview = [
    ["View", `${lane} · ${zoom}`],
    ["Status", status],
    ["Detail", `${detail}${setting}`],
    ["Processing", `${route} · memory ${memory}`],
  ];
  const displayRows = [
    ["HDR on this display", presentation.qualified ? "Yes" : "No · SDR simulation"],
    ["Monitor", display?.label || "This display"],
  ];
  if (!state.session) {
    return { preview, display: displayRows, source: [
      ["File", "No image open"], ["Interpretation", "—"], ["Encoding", "—"], ["Signal", "—"],
      ["Source peak", "—"], ["Reference white", `${projectReferenceWhiteNits()} nit`], ["Bit depth", "—"],
    ] };
  }
  const source = state.session.source;
  const luminance = state.editDocument?.source?.luminance || {};
  const mode = source.interpretation_mode === "manual" ? "Manual" : "Auto";
  return {
    preview,
    display: displayRows,
    source: [
      ["File", source.filename || source.suffix || "—"],
      ["Interpretation", isDevelopedRawSession(state.session) ? `${mode} · camera RAW profile` : mode],
      ["Encoding", source.source_color_space || source.transfer_function
        ? `${source.source_color_space || "Unknown colours"} · ${source.transfer_function || "unknown curve"}`
        : "Not declared by the file"],
      ["Signal", {
        HDR_TRUE: "HDR",
        HDR_ENCODED: "HDR-encoded file",
        HDR_LINEAR_UNCONFIRMED: "Linear, HDR not confirmed",
        SDR_ONLY: "SDR",
      }[state.session.analysis?.classification] || state.session.analysis?.classification || "—"],
      ["Source peak", luminance.source_peak_nits ? `${luminance.source_peak_nits} nit` : "Not declared"],
      ["Reference white", `${projectReferenceWhiteNits()} nit`],
      ["Bit depth", String(state.session.metadata?.bit_depth || "Unknown")],
    ],
  };
}

function previewOutputEntries() {
  const target = previewResolutionDimensions();
  const live = state.acceptedPresentation?.execution === "tiled"
    ? state.gpuPreview?.tiledExecutionMetrics || null : null;
  const viewport = state.renderCoordinator?.state(state.currentView)?.viewport || null;
  return [
    ["View", state.currentView.toUpperCase()],
    ["Rendering", state.renderingMode === "cpu" ? "CPU Compatibility" : state.renderingMode === "gpu" ? "GPU Preferred" : "Auto"],
    ["Preview Target", `${previewResolutionLabel(state.previewResolutionOverride ? state.previewResolution : "display")} · ${target.width} × ${target.height}`],
    ["Faster dragging", state.fasterDragging ? "On · softer while dragging" : "Off · full detail while dragging"],
    ["Legacy override", state.previewResolutionOverride ? previewResolutionLabel() : "Off"],
    ["Controller", JSON.stringify(state.previewLatencyController?.snapshot()?.decisions || {})],
    ["Viewport", viewport ? `${viewport.x},${viewport.y} · ${viewport.width} × ${viewport.height}` : "Fit"],
    ["Processing scale", live?.processingScale ?? (state.session
      ? (requiredProcessingLongEdge() / Math.max(state.session.source.width, state.session.source.height)).toFixed(3) : "Waiting")],
    ["Source mip", `${state.acceptedPresentation?.processedLongEdge || target.longEdge}px`],
    ["Generation", `${state.acceptedPresentation?.generation ?? "—"} / ${state.previewGeneration[state.currentView]}`],
    ["Detail cache", live ? `${live.detailCacheHits} hits · ${live.detailCacheMisses} misses` : "Direct / waiting"],
    ["GPU working", live ? `${(live.workingSetBytes / 1048576).toFixed(1)} MiB` : "Direct / waiting"],
    ["Presented", state.acceptedPresentation?.longEdge
      ? `${state.acceptedPresentation.tier ? previewResolutionLabel(state.acceptedPresentation.tier) : "Placeholder"} · ${state.acceptedPresentation.longEdge}px · ${state.acceptedPresentation.transport}`
      : "Waiting"],
    ["Status", viewerStatusLabel()],
    ["Execution", previewExecutionLabel()],
    ["Scope", els.scopeFreshness?.textContent || "Waiting"],
    ["Transport", state.previewInfo.transport],
    ["Media", state.previewInfo.mediaType],
    ["Space", state.previewInfo.colorSpace],
    ["Transfer", state.previewInfo.transfer],
    ["Bit Depth", state.previewInfo.bitDepth],
    ["Notes", state.previewInfo.notes],
  ];
}

function displayProbeEntries() {
  const display = state.desktopEnvironment?.currentDisplay;
  const presentation = state.presentationCapability || presentationCapabilityState();
  return [
    ["HDR Presentation", presentation.qualified ? "Qualified" : "SDR simulation"],
    ["Session", state.desktopEnvironment?.nativeWayland ? "Native Wayland" : state.desktopEnvironment?.sessionType || "Browser"],
    ["Display", display?.label || "Current browser display"],
    ["Output Space", display?.colorSpace || "unknown"],
    ["Component Depth", display?.depthPerComponent ? `${display.depthPerComponent}-bit` : "unknown"],
    ["Dynamic Range", state.displayInfo.dynamicRange],
    ["Color Gamut", state.displayInfo.colorGamut],
    ["Pixel Ratio", state.displayInfo.pixelRatio],
    ["Screen Depth", state.displayInfo.screenDepth],
    ["Browser", state.displayInfo.browser],
    ["GPU Preview", state.displayInfo.gpu || "Backend fallback"],
  ];
}

function presentationCapabilityState() {
  const environment = state.desktopEnvironment;
  const onLinux = environment?.platform === "linux";
  const reasons = [];
  if (onLinux && !environment.nativeWayland) reasons.push("native Wayland is not active");
  if (!mediaQueryMatch("(dynamic-range: high)")) reasons.push("the current display does not report high dynamic range");
  if (!state.gpuPreview?.available || state.renderingMode === "cpu") reasons.push("WebGPU is unavailable or CPU preview is selected");
  if (state.gpuPreview?.adapterInfo?.fallback) reasons.push("WebGPU is using a software fallback adapter");
  if (!state.gpuSurfaceHdr) reasons.push("the extended rgba16float canvas is not active");
  return {
    qualified: Boolean((!onLinux || environment.nativeWayland) && reasons.length === 0),
    reasons,
    nativeWayland: Boolean(environment?.nativeWayland),
    browserDynamicRange: mediaQueryMatch("(dynamic-range: high)"),
    browserGamut: state.displayInfo.colorGamut,
    extendedSurface: Boolean(state.gpuSurfaceHdr),
    softwareFallback: Boolean(state.gpuPreview?.adapterInfo?.fallback),
    display: environment?.currentDisplay || null,
    exactHeadroomAvailable: false,
  };
}

function renderPresentationCapability() {
  state.presentationCapability = presentationCapabilityState();
  if (!els.hdrPresentationWarning) return;
  const show = state.desktopEnvironment?.platform === "linux" && !state.presentationCapability.qualified;
  els.hdrPresentationWarning.classList.toggle("hidden", !show);
  if (show) {
    const reason = state.presentationCapability.reasons.join("; ");
    els.hdrPresentationWarningCopy.textContent = `${reason}. Editing, scopes, and export remain accurate; visible HDR brightness is an SDR simulation.`;
  }
}

function renderWorkflowContext() {
  if (!els.workflowContextList) return;
  const selectedDisplay = (state.displayTelemetry?.displays || [])
    .find((display) => display.id === state.proofDisplayId);
  const proofFormat = {
    avif_gain_map: "AVIF + gain map",
    jpeg_ultrahdr: "JPEG Ultra HDR",
    jpegxl_hdr: "JPEG XL HDR",
  }[state.proofFormat] || "Unknown";
  const exportFormat = {
    avif_gain_map: "AVIF + gain map",
    jpeg_ultrahdr: "JPEG Ultra HDR",
    jpegxl_hdr: "JPEG XL HDR",
    sdr_jpegxl: "JPEG XL (SDR)",
    sdr_jpeg: "JPEG (SDR)",
    sdr_png: "PNG (SDR)",
  }[els.exportFormat?.value] || "Not selected";
  const proofStatus = !state.proofReconstruction
    ? "Not built"
    : state.proofDirty ? "Stale" : "Current";
  const entriesByWorkflow = {
    grade: [
      ["Stage", "Grade"],
      ["View", state.currentView === "sdr" ? "SDR fallback" : "HDR grade"],
      ["Format", state.session?.source?.suffix || "n/a"],
    ],
    proof: [
      ["Stage", "Chromium Proof"],
      ["Status", proofStatus],
      ["Format", proofFormat],
      ["Size", !state.proofArtifact
        ? (state.proofSize === "full" ? "Full size" : "Reduced")
        : `${state.proofArtifact.full_size ? "Full size" : "Reduced"} · ${state.proofArtifact.width} × ${state.proofArtifact.height}`],
      ["Display ID", selectedDisplay?.id || state.proofDisplayId || "Unavailable"],
    ],
    export: [
      ["Stage", "Export"],
      ["Format", exportFormat],
      ["Proof", proofStatus],
      ["Display ID", selectedDisplay?.id || state.proofDisplayId || "Unavailable"],
    ],
  };
  renderKeyValueList(els.workflowContextList, entriesByWorkflow[state.activeWorkflow] || entriesByWorkflow.grade);
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

  const luminance = state.editDocument?.source?.luminance || {};
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
    ["Source diffuse white", luminance.source_diffuse_white_nits ? `${luminance.source_diffuse_white_nits} nit` : "not declared"],
    ["Source peak", luminance.source_peak_nits ? `${luminance.source_peak_nits} nit` : "measured separately"],
    ["Project reference white", `${projectReferenceWhiteNits()} nit`],
  ];
}

function renderKeyValueList(container, entries) {
  container.innerHTML = "";
  for (const [key, value] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    // A narrow column may shorten a long value; the full text is on hover.
    dd.title = String(value ?? "");
    container.append(dt, dd);
  }
}

function renderSessionChrome() {
  const hasSession = Boolean(state.session);
  els.ejectButton.disabled = !hasSession;
  els.workflowTabs.forEach((button) => {
    button.disabled = button.dataset.workflowTab !== "import" && !hasSession;
  });
  els.emptyImportButton.disabled = hasSession;
  document.querySelectorAll("#grade-workflow-panel input, #grade-workflow-panel select, #grade-workflow-panel button").forEach((control) => {
    if (control.matches("[data-local-tool], #grade-mode-local")) {
      control.disabled = false;
    } else {
      const unavailableModule = control.closest(".module-unavailable");
      const bypassedRawHighlightControl = control.matches("#raw-highlight-method, #raw-highlight-threshold")
        && els.rawHighlightBypass?.getAttribute("aria-pressed") !== "true";
      control.disabled = !hasSession || Boolean(unavailableModule) || bypassedRawHighlightControl
        || (control.id === "film-grain-chroma" && filmGrainChromaInactive());
    }
  });
  els.viewButtons.forEach((button) => {
    button.disabled = !hasSession;
  });
  [els.toneEqualizerEditor, els.sdrToneEqualizerEditor].forEach((editor) => {
    editor.setAttribute("aria-disabled", String(!hasSession));
    editor.tabIndex = hasSession ? 0 : -1;
  });
  [els.zoomOut, els.zoomIn, els.zoomSlider, els.zoomReadout, els.zoomFit, els.zoomActual].forEach((control) => {
    control.disabled = !hasSession;
  });
  updateLocalToolState();
  window.HDRProofing?.render();
}

function buildDisplayProbe(environment = null) {
  const display = environment?.currentDisplay;
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
    screenDepth: display?.colorDepth ? `${display.colorDepth}-bit output` : `${window.screen?.colorDepth || "?"}-bit browser`,
    browser: navigator.userAgentData?.brands?.map((brand) => brand.brand).join(", ") || navigator.userAgent,
  };
}

function mediaQueryMatch(query) {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function renderMetadataVisibility() {
  const open = state.metadataOpen && Boolean(state.session);
  els.metadataPanel.classList.toggle("hidden", !open);
  els.metadataToggle.setAttribute("aria-expanded", String(open));
}

