const state = {
  session: null,
  capabilities: {},
  currentView: "hdr",
  scopeMode: "histogram",
  scopeChannelMode: "composite",
  sourceSettingsOpen: false,
  adjustments: {
    hdr: { exposure: 0, highlight_rolloff: 0.25, shadow_lift: 0, white_balance_kelvin: 6500, tint: 0 },
    sdr: { exposure: 0, highlight_recovery: 0.25, shadow: 0, contrast: 0, tone_mapper: "aces" },
    shared: {
      active_focus: "hdr",
      curves_enabled: false,
      overlay_mode: "off",
      overlay_preset: "web_1000_100",
      overlay_opacity: 0.72,
      overlay_threshold: 1,
      luma_curve: defaultCurvePoints(),
      red_curve: defaultCurvePoints(),
      green_curve: defaultCurvePoints(),
      blue_curve: defaultCurvePoints(),
    },
  },
  selectedCurveChannel: "luma",
  activeCurvePoint: null,
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

const defaultAdjustments = () => ({
  hdr: { exposure: 0, highlight_rolloff: 0.25, shadow_lift: 0, white_balance_kelvin: 6500, tint: 0 },
  sdr: { exposure: 0, highlight_recovery: 0.25, shadow: 0, contrast: 0, tone_mapper: "aces" },
  shared: {
    active_focus: state.currentView,
    curves_enabled: false,
    overlay_mode: "off",
    overlay_preset: "web_1000_100",
    overlay_opacity: 0.72,
    overlay_threshold: 1,
    luma_curve: defaultCurvePoints(),
    red_curve: defaultCurvePoints(),
    green_curve: defaultCurvePoints(),
    blue_curve: defaultCurvePoints(),
  },
});

const els = {
  fileInput: document.getElementById("file-input"),
  dropzone: document.getElementById("dropzone"),
  importButton: document.getElementById("import-button"),
  ejectButton: document.getElementById("eject-button"),
  badge: document.getElementById("badge"),
  overrideWarning: document.getElementById("override-warning"),
  overrideMessage: document.getElementById("override-message"),
  sourceSettingsToggle: document.getElementById("source-settings-toggle"),
  sourceSettingsPanel: document.getElementById("source-settings-panel"),
  interpretationMode: document.getElementById("interpretation-mode"),
  interpretationColorSpace: document.getElementById("interpretation-color-space"),
  interpretationTransfer: document.getElementById("interpretation-transfer"),
  sourceSettingsNote: document.getElementById("source-settings-note"),
  applyInterpretationButton: document.getElementById("apply-interpretation"),
  resetInterpretationButton: document.getElementById("reset-interpretation"),
  curvesEnabled: document.getElementById("curves-enabled"),
  curveEditor: document.getElementById("curve-editor"),
  curveStatus: document.getElementById("curve-status"),
  overlayPresetNote: document.getElementById("overlay-preset-note"),
  curveReset: document.getElementById("curve-reset"),
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
  scopeTitle: document.getElementById("scope-title"),
  scopeNote: document.getElementById("scope-note"),
  scopeKindLabel: document.getElementById("scope-kind-label"),
  scopeMode: document.getElementById("scope-mode"),
  scopeChannelMode: document.getElementById("scope-channel-mode"),
  scopeStats: document.getElementById("scope-stats"),
  histogram: document.getElementById("histogram"),
  exportButton: document.getElementById("export-button"),
  exportStatus: document.getElementById("export-status"),
  exportFilename: document.getElementById("export-filename"),
  exportDirectory: document.getElementById("export-directory"),
  exportFormat: document.getElementById("export-format"),
  exportQuality: document.getElementById("export-quality"),
  viewButtons: [...document.querySelectorAll(".segmented button")],
  controls: [...document.querySelectorAll("[data-path]")],
};

boot();

async function boot() {
  bindEvents();
  renderReadouts();
  drawCurveEditor();
  renderOverlayPresetNote();
  window.addEventListener("resize", syncOverlayPlacement);
}

const overlayPresetNotes = {
  web_1000_100: "Built for web-HDR finishing with 100 nit diffuse white and a 1000 nit highlight ceiling. Best default for AVIF gain-map work and common consumer HDR displays.",
  bt2408_1000_203: "Uses the ITU-R BT.2408 style 203 nit HDR reference white with a 1000 nit peak target. Useful when you want false color to align with PQ/HLG reference-white practice.",
  bt2408_4000_203: "Keeps the 203 nit BT.2408 reference white but stretches warning bands toward a 4000 nit mastering ceiling. Good for checking very bright highlight intent.",
  sdr_100: "Treats 100 nits as both white and ceiling. Handy when judging the SDR fallback or when you want the overlay to behave like an SDR exposure aid.",
};

function bindEvents() {
  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) await uploadFile(file);
    event.target.value = "";
  });
  els.importButton.addEventListener("click", () => els.fileInput.click());
  els.sourceSettingsToggle.addEventListener("click", () => {
    state.sourceSettingsOpen = !state.sourceSettingsOpen;
    renderSourceSettingsVisibility();
  });
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
      els.viewButtons.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.currentView = button.dataset.kind;
      state.adjustments.shared.active_focus = state.currentView;
      renderReadouts();
      await refreshPreview();
      await refreshOverlay();
      await refreshScopes();
    });
  });

  els.controls.forEach((control) => {
    control.addEventListener("input", () => {
      const value = control.type === "range" ? Number(control.value) : control.type === "checkbox" ? control.checked : control.value;
      setValueByPath(state.adjustments, control.dataset.path, value);
      if (control.dataset.path === "shared.curves_enabled") drawCurveEditor();
      if (control.dataset.path === "shared.overlay_preset") renderOverlayPresetNote();
      debouncePreview();
    });
  });

  els.curveChannelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCurveChannel = button.dataset.curveChannel;
      renderCurveChannelTabs();
      drawCurveEditor();
    });
  });
  els.curveReset.addEventListener("click", () => {
    setCurveValues(state.selectedCurveChannel, defaultCurvePoints());
    drawCurveEditor();
    debouncePreview();
  });
  bindCurveEditor();

  els.exportButton.addEventListener("click", exportCurrentSession);
  els.applyInterpretationButton.addEventListener("click", applyInterpretationOverride);
  els.resetInterpretationButton.addEventListener("click", resetInterpretationToAuto);
  els.ejectButton.addEventListener("click", ejectCurrentSession);

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

async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  els.badge.textContent = "Loading image and building session...";
  setPreviewMessage("Preparing session...");
  const response = await fetch("/api/session", { method: "POST", body: formData });
  const payload = await response.json();
  if (!response.ok) {
    els.badge.textContent = payload.detail || "Upload failed.";
    els.badge.className = "badge bad";
    setPreviewError("Upload failed before a preview could be created.");
    clearPreviewImage();
    clearPreviewOverlay();
    return;
  }
  state.session = payload.session;
  state.adjustments = payload.session.adjustments;
  renderSession();
  seedExportFieldsFromSession();
  await refreshPreview();
  await refreshOverlay();
  await refreshScopes();
}

async function ejectCurrentSession() {
  if (!state.session) return;
  await fetch("/api/session/current", { method: "DELETE" }).catch(() => null);
  state.session = null;
  state.adjustments = defaultAdjustments();
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
  els.sessionName.textContent = "No active session";
  els.metadataList.innerHTML = "";
  els.overrideWarning.classList.add("hidden");
  els.sourceSettingsPanel.classList.add("hidden");
  els.interpretationMode.value = "auto";
  els.interpretationColorSpace.value = "auto";
  els.interpretationTransfer.value = "auto";
  state.sourceSettingsOpen = false;
  els.exportStatus.textContent = "Export backends are capability-gated in this milestone.";
  els.exportFilename.value = "hdr_finisher_export";
  els.exportDirectory.value = "";
  syncControlsFromState();
  drawHistogram([]);
  renderReadouts();
  hidePreviewMessage();
  renderSessionChrome();
  state.selectedCurveChannel = "luma";
  renderCurveChannelTabs();
  drawCurveEditor();
  renderOverlayPresetNote();
}

function renderSession() {
  const session = state.session;
  els.sessionName.textContent = session.source.filename;
  clearPreviewImage();
  clearPreviewOverlay();
  setPreviewMessage(`Rendering ${state.currentView.toUpperCase()} preview...`);
  els.badge.textContent = session.analysis.badge_message;
  els.badge.className = badgeClass(session.analysis.classification);
  els.overrideWarning.classList.toggle("hidden", !session.analysis.needs_color_override);
  els.overrideMessage.textContent = overrideMessage(session);
  syncInterpretationControls(session);
  state.sourceSettingsOpen = state.sourceSettingsOpen || session.analysis.needs_color_override;
  renderSourceSettingsVisibility();
  renderSourceSettingsControls();
  renderMetadata(session);
  renderReadouts();
  syncControlsFromState();
  renderSessionChrome();
  drawCurveEditor();
  renderOverlayPresetNote();
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
  els.curveStatus.textContent = `Curves apply to the currently active preview side: ${state.adjustments.shared.active_focus.toUpperCase()}.`;
}

function renderOverlayPresetNote() {
  const preset = state.adjustments.shared.overlay_preset || "web_1000_100";
  els.overlayPresetNote.textContent = overlayPresetNotes[preset] || overlayPresetNotes.web_1000_100;
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

function debouncePreview() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(async () => {
    await refreshPreview();
    await refreshOverlay();
    await refreshScopes();
  }, 180);
}

async function refreshPreview() {
  if (!state.session) return;
  if (state.previewAbortController) state.previewAbortController.abort();
  state.previewAbortController = new AbortController();
  setPreviewMessage(`Rendering ${state.currentView.toUpperCase()} preview...`);
  const response = await fetch(`/api/session/${state.session.session_id}/preview/${state.currentView}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustments: state.adjustments }),
    signal: state.previewAbortController.signal,
  }).catch((error) => {
    if (error.name === "AbortError") return { aborted: true };
    console.error(error);
    return null;
  });
  if (!response || response.aborted) return;
  if (response.status === 409) {
    setPreviewMessage("Dropped a stale preview request. Refreshing...");
    return;
  }
  if (!response.ok) {
    const payload = await safeJson(response);
    setPreviewError(payload?.detail || "Preview failed to render.");
    clearPreviewImage();
    clearPreviewOverlay();
    return;
  }

  state.previewInfo = previewInfoFromResponse(response, state.currentView);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  await applyPreviewUrl(url);
  els.scopeKindLabel.textContent = state.currentView.toUpperCase();
  renderReadouts();
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
  drawHistogram(payload);
}

function drawHistogram(scope) {
  const canvas = els.histogram;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f0f0f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!scope?.channels?.length) {
    els.scopeTitle.textContent = "Histogram";
    els.scopeNote.textContent = "Reference scopes will appear here after a preview is rendered.";
    els.scopeStats.innerHTML = "";
    return;
  }
  els.scopeTitle.textContent = scopeTitleFor(scope);
  els.scopeNote.textContent = scope.preview_kind === "hdr"
    ? scope.scope_type.includes("waveform")
      ? "HDR waveform plots horizontal image position against reference nits. Reference nits use the app's internal model: 0.18 scene-linear equals 100 nits."
      : "Reference nits use the app's internal HDR model: 0.18 scene-linear equals 100 nits. Actual playback brightness still depends on browser and display."
    : scope.scope_type.includes("waveform")
      ? "SDR waveform plots horizontal image position against normalized tone-mapped output."
      : "SDR histogram shows normalized display-safe values from 0 to 1 after tone mapping.";
  renderKeyValueList(els.scopeStats, (scope.stats || []).map((item) => [item.label, item.value]));

  const channels = filteredScopeChannels(scope.channels);
  const palette = { R: "#ff6b6b", G: "#5cd6b3", B: "#5fa8ff", Y: "#ece9df" };
  const maxValue = Math.max(1, ...channels.flatMap((channel) => channel.bins));
  const plotLeft = scope.preview_kind === "hdr" ? 52 : 14;
  const plotRight = 10;
  const plotTop = 8;
  const plotBottom = 20;
  const plotWidth = canvas.width - plotLeft - plotRight;
  const plotHeight = canvas.height - plotTop - plotBottom;

  ctx.font = "11px Consolas";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(236, 233, 223, 0.72)";
  ctx.strokeStyle = "rgba(236, 233, 223, 0.18)";
  ctx.lineWidth = 1;
  (scope.guides || []).forEach((guide) => {
    const normalized = guidePosition(scope, guide.value);
    if (scope.preview_kind === "hdr") {
      const y = plotTop + plotHeight - normalized * plotHeight;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotLeft + plotWidth, y);
      ctx.stroke();
      ctx.fillText(guide.label, 2, y);
    } else {
      const x = plotLeft + normalized * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotTop + plotHeight);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(guide.label, x, canvas.height - 6);
      ctx.textAlign = "start";
    }
  });

  if (scope.scope_type.includes("waveform")) drawWaveform(ctx, scope, channels, palette, plotLeft, plotTop, plotWidth, plotHeight);
  else if (scope.preview_kind === "hdr") drawHdrReferenceScope(ctx, channels, palette, maxValue, plotLeft, plotTop, plotWidth, plotHeight);
  else drawSdrHistogram(ctx, channels, palette, maxValue, plotLeft, plotTop, plotWidth, plotHeight);
}

function guidePosition(scope, value) {
  if (scope.preview_kind === "hdr") {
    const min = Math.log10(1);
    const max = Math.log10(4000);
    return (Math.log10(Math.max(value, 1)) - min) / (max - min);
  }
  return Math.min(1, Math.max(0, value));
}

function drawHdrReferenceScope(ctx, channels, palette, maxValue, plotLeft, plotTop, plotWidth, plotHeight) {
  if (state.scopeChannelMode === "parade") {
    drawHistogramParade(ctx, channels.filter((channel) => channel.name !== "Y"), palette, maxValue, plotLeft, plotTop, plotWidth, plotHeight);
    return;
  }
  channels.forEach((channel) => {
    ctx.beginPath();
    ctx.strokeStyle = palette[channel.name];
    ctx.lineWidth = 1.75;
    channel.bins.forEach((value, index) => {
      const normalizedIndex = index / (channel.bins.length - 1);
      const x = plotLeft + (value / maxValue) * plotWidth;
      const y = plotTop + plotHeight - normalizedIndex * plotHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

function drawSdrHistogram(ctx, channels, palette, maxValue, plotLeft, plotTop, plotWidth, plotHeight) {
  if (state.scopeChannelMode === "parade") {
    drawHistogramParade(ctx, channels.filter((channel) => channel.name !== "Y"), palette, maxValue, plotLeft, plotTop, plotWidth, plotHeight);
    return;
  }
  channels.forEach((channel) => {
    ctx.beginPath();
    ctx.strokeStyle = palette[channel.name];
    ctx.lineWidth = 2;
    channel.bins.forEach((value, index) => {
      const x = plotLeft + (index / (channel.bins.length - 1)) * plotWidth;
      const y = plotTop + plotHeight - (value / maxValue) * plotHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
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

function drawHistogramParade(ctx, channels, palette, maxValue, plotLeft, plotTop, plotWidth, plotHeight) {
  const laneWidth = plotWidth / Math.max(channels.length, 1);
  channels.forEach((channel, laneIndex) => {
    ctx.beginPath();
    ctx.strokeStyle = palette[channel.name];
    ctx.lineWidth = 1.8;
    channel.bins.forEach((value, index) => {
      const laneLeft = plotLeft + laneIndex * laneWidth;
      const x = laneLeft + (index / Math.max(channel.bins.length - 1, 1)) * (laneWidth - 8);
      const y = plotTop + plotHeight - (value / maxValue) * plotHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
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
  return "SDR Histogram";
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
  return directory ? `${directory}\\${filename}${extension}` : `${filename}${extension}`;
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
  const parts = normalized.split(/[/\\]/);
  const filename = parts.pop() || "";
  return {
    filename: filename.replace(/\.[^.]+$/, ""),
    directory: parts.join("\\"),
  };
}

async function exportCurrentSession() {
  if (!state.session) return;
  const outputPath = buildExportOutputPath();
  const response = await fetch(`/api/session/${state.session.session_id}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: els.exportFormat.value,
      quality: Number(els.exportQuality.value),
      output_path: outputPath,
    }),
  });
  const payload = await response.json();
  els.exportStatus.textContent = payload.message || "Export request finished.";
  if (payload.output_path) {
    const parsed = splitOutputPath(payload.output_path);
    els.exportFilename.value = parsed.filename;
    els.exportDirectory.value = parsed.directory;
  }
}

async function applyInterpretationOverride() {
  if (!state.session) return;
  const override = interpretationPayload();
  els.badge.textContent = "Re-interpreting source file...";
  setPreviewMessage("Rebuilding preview with the new interpretation...");
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
  renderSession();
  await refreshPreview();
  await refreshOverlay();
  await refreshScopes();
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
}

function renderSessionChrome() {
  els.ejectButton.disabled = !state.session;
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
      debouncePreview();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  canvas.addEventListener("pointerdown", (event) => {
    beginDrag(event.clientX, event.clientY);
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
    ctx.fillStyle = index === 0 || index === curve.length - 1 ? "#7f7a6f" : "#ece9df";
    ctx.beginPath();
    ctx.arc(x, y, index === 0 || index === curve.length - 1 ? 4 : 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function currentCurveValues() {
  const path = curvePath(state.selectedCurveChannel);
  return getValueByPath(state.adjustments, path).map(([x, y]) => [x, y]);
}

function setCurveValues(channel, values) {
  setValueByPath(state.adjustments, curvePath(channel), values);
}

function curvePath(channel) {
  return `shared.${channel}_curve`;
}

function curvePointCount() {
  return currentCurveValues().length;
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

function sampleCurvePoints(points, samples) {
  const sampleX = Array.from({ length: samples }, (_, index) => index / (samples - 1));
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
  const previousUrl = els.previewImage.dataset.objectUrl;
  try {
    await new Promise((resolve, reject) => {
      els.previewImage.onload = () => resolve();
      els.previewImage.onerror = () => reject(new Error("Image element could not load preview data."));
      els.previewImage.src = url;
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    setPreviewError(error.message || "Preview image failed to decode.");
    clearPreviewImage();
    return;
  } finally {
    els.previewImage.onload = null;
    els.previewImage.onerror = null;
  }

  if (previousUrl) URL.revokeObjectURL(previousUrl);
  els.previewImage.dataset.objectUrl = url;
  els.previewImage.style.display = "block";
  els.emptyState.style.display = "none";
  syncOverlayPlacement();
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
  const previousUrl = els.previewImage.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  delete els.previewImage.dataset.objectUrl;
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

renderSessionChrome();
renderCurveChannelTabs();
