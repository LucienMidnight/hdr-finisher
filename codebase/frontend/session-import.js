function claimSessionReplacement() {
  state.projectOpenGeneration += 1;
  state.projectOpenController?.abort();
  state.projectOpenController = null;
  return ++state.importGeneration;
}

async function importByteFile(file, actionLabel = "import another source", confirmedDocument = null, ownershipGeneration = null) {
  if (confirmedDocument === null) {
    if (!await confirmUnsavedTransition(actionLabel)) return false;
    confirmedDocument = documentTransitionToken();
  } else if (documentTransitionToken() !== confirmedDocument) {
    if (!await confirmUnsavedTransition(actionLabel)) return false;
    confirmedDocument = documentTransitionToken();
  }
  return uploadFile(file, { confirmedDocument, ownershipGeneration });
}

async function uploadFile(file, { confirmedDocument = documentTransitionToken(), ownershipGeneration = null } = {}) {
  const generation = ownershipGeneration ?? claimSessionReplacement();
  if (generation !== state.importGeneration) return false;
  const activeJobId = state.activeImportJobId;
  state.activeImportJobId = null;
  if (activeJobId) await projectIo.cancelImportJob(fetch, activeJobId).catch(() => null);
  if (generation !== state.importGeneration) return false;
  const previousUpload = state.byteUploadQueue;
  let releaseUpload;
  state.byteUploadQueue = new Promise((resolve) => { releaseUpload = resolve; });
  await previousUpload.catch(() => null);
  if (generation !== state.importGeneration) {
    releaseUpload();
    return false;
  }
  if (documentTransitionToken() !== confirmedDocument && !await confirmUnsavedTransition("import another source")) {
    releaseUpload();
    return false;
  }
  renderExperimentalDngNote(file);
  const formData = new FormData();
  formData.append("file", file);
  status.post({ id: "import", severity: "progress", message: "Loading image and building session…", progress: "indeterminate" });
  state.importInProgress = true;
  updateExportAvailability();
  setPreviewMessage("Reading source file...", 8);
  const startedAt = performance.now();
  const ticker = window.setInterval(() => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const detail = elapsed >= 10
      ? "The decoder is still working; the interface remains responsive"
      : "Reading and decoding source data";
    setIndeterminatePreviewMessage(`${detail} · ${elapsed.toFixed(1)}s elapsed`);
  }, 250);
  try {
    const { response, payload } = await projectIo.uploadSource(fetch, formData);
    if (generation !== state.importGeneration) return false;
    if (!response.ok || !payload?.session) {
      const detail = payload?.detail || `Upload failed with HTTP ${response.status}.`;
      showUploadError(detail);
      return false;
    }
    retireActiveSession();
    state.session = payload.session;
    state.renderCoordinator?.noteSource(payload.session.session_id);
    if (els.rawSettingsPanel) delete els.rawSettingsPanel.dataset.initialized;
    setPreviewMessage("Source decoded. Preparing preview...", 28);
    state.adjustments = payload.session.adjustments;
    state.editDocument = payload.session.edit_document;
    loadDenoiseDocument(state.editDocument);
    state.editRevision = payload.session.edit_revision || 0;
    recordAcknowledgedLocals(state.editDocument);
    state.documentDirty = Boolean(payload.session.dirty);
    state.selectedLocalId = null;
    state.projectPath = "";
    state.currentView = "hdr";
    await applyNewSessionPreferences();
    if (generation !== state.importGeneration || state.session?.session_id !== payload.session.session_id) return false;
    activateWorkflowTab("grade", { focus: false });
    state.interpretationGateDismissed = false;
    state.gpuPreview?.resetSession(payload.session.session_id);
    invalidatePreview("hdr", { markDirty: false });
    invalidatePreview("sdr", { markDirty: false });
    renderSession();
    renderLocalAdjustments();
    seedExportFieldsFromSession();
    const gpuReady = await renderGpuDraft("hdr", { hideStatus: false, longEdge: settledProxyLongEdge() });
    if (generation !== state.importGeneration || state.session?.session_id !== payload.session.session_id) return false;
    await Promise.all([
      gpuReady ? Promise.resolve(true) : refreshPreview({ progressSteps: [36, 76, 92] }),
      refreshOverlay(),
      refreshScopes(scopeLongEdge("settled"), { tier: "settled" }),
    ]);
    if (generation !== state.importGeneration || state.session?.session_id !== payload.session.session_id) return false;
    hidePreviewMessage();
    prepareInactivePreview();
    if (previewNeedsRefinement()) debouncePreview("hdr");
    status.post({ id: "import", severity: "success", message: "Source imported." });
    return true;
  } catch (error) {
    if (generation !== state.importGeneration) return false;
    console.error(error);
    // The upload response can be lost after the backend has already activated
    // the new session. Reconcile with backend truth before reporting failure so
    // the frontend never continues editing a session whose owned source was
    // retired by a completed upload.
    const currentResult = await projectIo.fetchCurrentSession(fetch).catch(() => null);
    const currentResponse = currentResult?.response;
    const currentPayload = currentResult?.payload;
    if (
      generation === state.importGeneration
      && currentResponse?.ok
      && currentPayload?.session
      && currentPayload.session.session_id !== state.session?.session_id
    ) {
      await activateDesktopSession(currentPayload.session, "");
      hidePreviewMessage();
      return true;
    }
    showUploadError("The upload could not reach the local HDR Finisher server.");
    return false;
  } finally {
    window.clearInterval(ticker);
    releaseUpload();
    if (generation === state.importGeneration) {
      state.importInProgress = false;
      updateExportAvailability();
    }
  }
}

function showUploadError(message) {
  status.post({ id: "import", severity: "error", message });
  if (state.session) {
    hidePreviewMessage();
    renderSession();
  } else {
    setPreviewError(message);
    clearPreviewImage();
    clearPreviewOverlay();
  }
}

async function ejectCurrentSession() {
  if (!state.session) return;
  if (!await confirmUnsavedTransition("eject the current image")) return;
  const generation = claimSessionReplacement();
  const activeJobId = state.activeImportJobId;
  state.activeImportJobId = null;
  if (activeJobId) await projectIo.cancelImportJob(fetch, activeJobId).catch(() => null);
  await state.byteUploadQueue.catch(() => null);
  if (generation !== state.importGeneration) return;
  await projectIo.ejectCurrentSession(fetch).catch(() => null);
  retireActiveSession();
  state.session = null;
  state.renderCoordinator?.noteSource(null);
  renderExperimentalDngNote();
  renderRawImportControls(null);
  if (els.rawSettingsPanel) delete els.rawSettingsPanel.dataset.initialized;
  state.adjustments = defaultAdjustments();
  state.editDocument = null;
  loadDenoiseDocument(null);
  els.hdrReferenceWhite.value = String(state.appPreferences?.defaultReferenceWhiteNits || 203);
  els.hdrReferenceWhite.disabled = false;
  state.editRevision = 0;
  recordAcknowledgedLocals(null);
  state.documentDirty = false;
  state.selectedLocalId = null;
  state.projectPath = "";
  state.currentView = "hdr";
  activateWorkflowTab("import", { focus: false });
  state.interpretationGateDismissed = false;
  state.lastScope = null;
  state.lastExportPath = "";
  state.gpuPreview?.resetSession();
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
  syncProjectBadge();
  renderSourceFilename("No active image");
  syncCopySourcePathButton();
  els.metadataList.innerHTML = "";
  els.sourceSettingsPanel.classList.add("hidden");
  els.interpretationMode.value = "auto";
  els.interpretationColorSpace.value = "auto";
  els.interpretationTransfer.value = "auto";
  els.interpretationLinearReference.value = "scene_0_18";
  state.sourceSettingsOpen = true;
  state.metadataOpen = true;
  els.exportStatus.textContent = "Choose a format and destination.";
  els.exportResult.classList.add("hidden");
  els.exportFilename.value = "hdr_finisher_export";
  els.exportDirectory.value = state.defaultExportDirectory;
  syncControlsFromState();
  drawHistogram([]);
  renderReadouts();
  hidePreviewMessage();
  renderSessionChrome();
  state.selectedCurveChannel = "luma";
  state.selectedCurvePoint = Math.floor(currentCurveValues().length / 2);
  state.selectedToneEqualizerBand = 6;
  renderCurveChannelTabs();
  syncCurveControlsFromState();
  drawCurveEditor();
  drawToneEqualizerEditor();
  renderOverlayPresetNote();
  renderMetadataVisibility();
  renderInterpretationGate();
  renderLaneChrome();
  renderControlState();
  updateExportAvailability();
}

async function requestSourceImport() {
  if (!desktop) {
    els.fileInput.click();
    return;
  }
  const currentSourceDirectory = splitOutputPath(sourcePathForClipboard()).directory;
  await openMediaBrowser("source", currentSourceDirectory || state.appPreferences?.folders?.fileImport || "");
}

async function applyInterpretationOverride() {
  if (!state.session) return;
  const override = interpretationPayload();
  status.post({ id: "interpretation", severity: "progress", message: "Re-interpreting source file…", progress: "indeterminate" });
  setPreviewMessage("Re-interpreting source file...", 8);
  try {
    const response = await fetch(`/api/session/${state.session.session_id}/interpretation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(override),
    });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.session) {
      status.post({ id: "interpretation", severity: "error", message: payload?.detail || "Interpretation override failed." });
      setPreviewError(payload?.detail || "Interpretation override failed.");
      return;
    }
    state.session = payload.session;
    state.renderCoordinator?.noteSource(payload.session.session_id);
    setPreviewMessage("Interpretation applied. Preparing preview...", 28);
    state.adjustments = payload.session.adjustments;
    state.editDocument = payload.session.edit_document;
    loadDenoiseDocument(state.editDocument);
    state.editRevision = payload.session.edit_revision || 0;
    recordAcknowledgedLocals(state.editDocument);
    state.documentDirty = Boolean(payload.session.dirty);
    state.interpretationGateDismissed = false;
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    state.gpuPreview?.resetSession(payload.session.session_id);
    renderSession();
    renderLocalAdjustments();
    const gpuReady = await renderGpuDraft(state.currentView, { hideStatus: false, longEdge: settledProxyLongEdge() });
    await Promise.all([
      gpuReady ? Promise.resolve(true) : refreshPreview({ progressSteps: [36, 76, 92] }),
      refreshOverlay(),
      refreshScopes(scopeLongEdge("settled"), { tier: "settled" }),
    ]);
    hidePreviewMessage();
    prepareInactivePreview();
    if (previewNeedsRefinement()) debouncePreview(state.currentView);
    status.post({ id: "interpretation", severity: "success", message: "Source interpretation applied." });
  } catch (error) {
    console.error(error);
    const message = "Interpretation override could not reach the local HDR Finisher server.";
    status.post({ id: "interpretation", severity: "error", message });
    setPreviewError(message);
  }
}

async function resetInterpretationToAuto() {
  if (!state.session) return;
  els.interpretationMode.value = "auto";
  els.interpretationColorSpace.value = "auto";
  els.interpretationTransfer.value = "auto";
  els.interpretationLinearReference.value = "scene_0_18";
  renderSourceSettingsControls();
  await applyInterpretationOverride();
}

function setImportCancelVisible(visible) {
  state.previewCancelVisible = Boolean(visible);
  syncViewerStatusEntry();
}

function defaultInterpretationValue(session) {
  if (isDevelopedRawSession(session)) return "auto";
  const transfer = (session.source.transfer_function || "").toLowerCase();
  const colorSpace = (session.source.source_color_space || "").toLowerCase();
  if (colorSpace.includes("2020")) return "linear_bt2020";
  if (colorSpace.includes("acescg")) return "linear_acescg";
  if (colorSpace.includes("display p3") || colorSpace === "p3") return "linear_p3";
  return "linear_srgb";
}

function syncInterpretationControls(session) {
  const developedRaw = isDevelopedRawSession(session);
  const mode = session.source.interpretation_mode === "manual" ? "manual" : "auto";
  els.interpretationMode.value = mode;
  els.interpretationColorSpace.value = defaultInterpretationValue(session);
  els.interpretationTransfer.value = developedRaw ? "auto" : defaultTransferValue(session);
  els.interpretationLinearReference.value = session.source.linear_reference || "scene_0_18";
  const needsReview = session.analysis.needs_color_override && mode !== "manual";
  els.sourceSettingsNote.textContent = sourceInterpretationStatus(session);
  els.sourceSettingsNote.classList.toggle("warning", needsReview);
}

function sourceInterpretationStatus(session) {
  if (isDevelopedRawSession(session)) {
    return "Camera-native RAW developed through its camera profile into the ACEScg working space.";
  }
  if (session.source.interpretation_mode === "manual") {
    const colorSpace = session.source.source_color_space || "unknown";
    const transfer = session.source.transfer_function || "unknown";
    const reference = session.source.linear_reference === "diffuse_white_1_0"
      ? "1.0 diffuse white normalized to 0.18"
      : "0.18 scene-linear diffuse white";
    return `Manual source interpretation applied: ${colorSpace} primaries + ${transfer} transfer + ${reference}.`;
  }
  return session.analysis.needs_color_override
    ? "Auto detection found an ambiguous source interpretation."
    : "Auto detection found a consistent source interpretation.";
}

function renderSourceSettingsVisibility() {
  els.sourceSettingsPanel.classList.toggle("hidden", !state.sourceSettingsOpen || !state.session);
  els.sourceSettingsToggle.setAttribute("aria-expanded", String(state.sourceSettingsOpen && Boolean(state.session)));
}

function renderSourceSettingsControls() {
  const developedRaw = isDevelopedRawSession(state.session);
  const manual = els.interpretationMode.value === "manual" && !developedRaw;
  els.interpretationMode.disabled = developedRaw;
  els.interpretationColorSpace.disabled = !manual;
  els.interpretationTransfer.disabled = !manual;
  els.interpretationLinearReference.disabled = !manual || els.interpretationTransfer.value !== "linear";
  els.applyInterpretationButton.disabled = developedRaw;
  els.resetInterpretationButton.disabled = developedRaw;
}

function isDevelopedRawSession(session) {
  return Boolean(
    session?.metadata?.extra?.raw_input &&
      session?.metadata?.extra?.decoder_normalized_to_acescg,
  );
}

function isRawSession(session) {
  return Boolean(session && [".dng", ".arw", ".cr2", ".cr3", ".nef", ".nrw", ".raf", ".rw2", ".orf", ".ori", ".pef", ".srw"].includes(session.source.suffix));
}

function isDngImportCandidate(candidate) {
  if (!candidate) return false;
  const source = candidate.source || candidate;
  const value = source.suffix || source.path || source.name || source.filename || source.format || "";
  return String(value).toLowerCase().replace(/^dng$/, ".dng").endsWith(".dng");
}

function renderExperimentalDngNote(candidate = null) {
  els.experimentalDngNote?.classList.toggle("hidden", !isDngImportCandidate(candidate));
}

function renderRawImportControls(session) {
  const visible = isRawSession(session);
  const bridgeQualified = Boolean(
    visible &&
      session?.metadata?.extra?.raw_mosaiced !== false &&
      String(session?.metadata?.extra?.raw_pipeline || "").startsWith("camera_linear_float_bridge"),
  );
  setSourceModuleAvailability(
    els.rawSettingsSection,
    visible,
    "RAW Development is available only for RAW sources.",
  );
  setSourceModuleAvailability(
    els.rawHighlightGroup,
    bridgeQualified,
    visible
      ? "Highlight Reconstruction is unavailable for this RAW sensor or color pipeline."
      : "Highlight Reconstruction is available only for supported mosaiced RAW sources.",
  );
  if (!visible) {
    state.rawSettingsOpen = false;
    els.rawSettingsPanel?.classList.add("hidden");
    els.rawSettingsToggle?.setAttribute("aria-expanded", "false");
    return;
  }
  const settings = state.editDocument?.source?.raw_import_settings;
  const lens = settings?.lens || {};
  if (!els.rawSettingsPanel.dataset.initialized) {
    els.lensMode.value = lens.mode || (session.source.suffix === ".dng" && session.metadata.extra?.raw_mosaiced === false ? "off" : "auto");
    els.lensDistortion.checked = lens.distortion !== false;
    els.lensChromaticAberration.checked = lens.chromatic_aberration !== false;
    els.lensVignetting.checked = lens.vignetting !== false;
    els.lensFocal.value = lens.focal_length_mm || "";
    els.lensAperture.value = lens.aperture || "";
    els.lensDistance.value = lens.focus_distance_m || "";
    els.rawSettingsPanel.dataset.initialized = "true";
  }
  els.rawSettingsPanel.classList.toggle("hidden", !state.rawSettingsOpen);
  els.rawSettingsToggle.setAttribute("aria-expanded", String(state.rawSettingsOpen));
  const manual = els.lensMode.value === "manual";
  els.manualLensControls.classList.toggle("hidden", !manual);
  const applied = session.metadata.extra?.lens_correction;
  els.lensSettingsNote.dataset.tooltip = applied?.applied
    ? `Applied ${applied.profile?.lens_maker || ""} ${applied.profile?.lens_model || "selected profile"}. Re-development is required after changing these controls.`
    : applied?.warning || applied?.reason || "Auto applies only one exact profile match. Off and Manual are always available.";
  if (manual && els.lensProfile.options.length <= 1) loadLensProfiles();
  if (bridgeQualified) {
    const highlight = settings?.highlight_reconstruction || {};
    if (els.rawHighlightGroup.dataset.sessionId !== String(session.session_id)) {
      els.rawHighlightMethod.value = highlight.method || "opposed_color_v1";
      els.rawHighlightThreshold.value = String(highlight.clipping_threshold ?? 1.0);
      els.rawHighlightGroup.dataset.sessionId = String(session.session_id);
    }
    renderRawHighlightState({ enabled: highlight.enabled !== false });
  }
}

function setSourceModuleAvailability(module, available, unavailableReason) {
  if (!module) return;
  module.classList.toggle("module-unavailable", !available);
  module.setAttribute("aria-disabled", String(!available));
  module.title = available ? "" : unavailableReason;
  module.querySelectorAll("button, input, select, textarea").forEach((control) => {
    control.disabled = !available;
  });
  if (available) return;
  const toggle = module.querySelector(".group-toggle, .disclosure-trigger");
  toggle?.setAttribute("aria-expanded", "false");
  if (module.classList.contains("control-group")) module.classList.add("collapsed");
  module.querySelector(":scope > .disclosure-content")?.classList.add("hidden");
}

function renderRawHighlightState({ enabled }) {
  if (!els.rawHighlightGroup) return;
  const modified = els.rawHighlightMethod.value !== "opposed_color_v1"
    || Math.abs(Number(els.rawHighlightThreshold.value) - 1) > 1e-8;
  els.rawHighlightBypass.classList.toggle("bypassed", !enabled);
  els.rawHighlightBypass.setAttribute("aria-pressed", String(enabled));
  els.rawHighlightGroup.classList.toggle("bypassed", !enabled);
  els.rawHighlightGroup.classList.toggle("modified", modified);
  els.rawHighlightMethod.disabled = !enabled;
  els.rawHighlightThreshold.disabled = !enabled;
  els.rawHighlightThresholdValue.textContent = Number(els.rawHighlightThreshold.value).toFixed(3);
  updateRangeVisual(els.rawHighlightThreshold);
}

async function loadLensProfiles() {
  const generation = ++state.lensProfileGeneration;
  const query = els.lensProfileSearch.value.trim();
  const response = await fetch(`/api/lens-profiles?q=${encodeURIComponent(query)}&limit=250`);
  const payload = await safeJson(response);
  if (generation !== state.lensProfileGeneration) return;
  if (!response.ok) return;
  const selected = state.editDocument?.source?.raw_import_settings?.lens?.profile_id || els.lensProfile.value;
  els.lensProfile.innerHTML = "";
  const prompt = document.createElement("option");
  prompt.value = "";
  prompt.textContent = payload.profiles?.length ? "Choose a Lensfun profile" : "No matching profiles";
  els.lensProfile.append(prompt);
  for (const profile of payload.profiles || []) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.camera_maker} ${profile.camera_model} · ${profile.lens_maker} ${profile.lens_model}`.trim();
    option.title = `${profile.mount || "Unknown mount"} · ${profile.distortion ? "distortion" : "no distortion data"} · ${profile.chromatic_aberration ? "CA" : "no CA data"} · ${profile.vignetting ? "vignetting" : "no vignetting data"}`;
    els.lensProfile.append(option);
  }
  if ([...els.lensProfile.options].some((option) => option.value === selected)) els.lensProfile.value = selected;
}

function optionalPositiveNumber(element) {
  const value = Number(element.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function rawImportSettingsPayload() {
  return {
    white_balance: "as_shot",
    demosaic: "ahd",
    highlight_reconstruction: {
      enabled: els.rawHighlightBypass?.getAttribute("aria-pressed") === "true",
      method: els.rawHighlightMethod?.value || "opposed_color_v1",
      clipping_threshold: Number(els.rawHighlightThreshold?.value || 1.0),
    },
    lens: {
      mode: els.lensMode.value,
      profile_id: els.lensMode.value === "manual" ? els.lensProfile.value || null : null,
      database_version: null,
      distortion: els.lensDistortion.checked,
      chromatic_aberration: els.lensChromaticAberration.checked,
      vignetting: els.lensVignetting.checked,
      focal_length_mm: optionalPositiveNumber(els.lensFocal),
      aperture: optionalPositiveNumber(els.lensAperture),
      focus_distance_m: optionalPositiveNumber(els.lensDistance),
    },
  };
}

async function applyRawImportSettings() {
  if (!desktop || !isRawSession(state.session)) return;
  const sourcePath = sourcePathForClipboard();
  if (!sourcePath) {
    els.lensSettingsNote.dataset.tooltip = "Save or relink the durable source before re-development.";
    return;
  }
  if (els.lensMode.value === "manual" && !els.lensProfile.value) {
    els.lensSettingsNote.dataset.tooltip = "Choose a manual Lensfun profile or switch to Auto/Off.";
    return;
  }
  const selection = await desktop.grantSourcePath(sourcePath);
  if (!selection) return;
  els.applyRawSettings.disabled = true;
  try {
    await openStagedDesktopSource({
      ...selection,
      rawImportSettings: rawImportSettingsPayload(),
      replaceSessionId: state.session.session_id,
    });
  } finally {
    els.applyRawSettings.disabled = false;
  }
}

function defaultTransferValue(session) {
  const transfer = (session.source.transfer_function || "").toLowerCase();
  if (transfer.includes("pq")) return "pq";
  if (transfer.includes("hlg")) return "hlg";
  if (transfer.includes("srgb")) return "srgb";
  return "linear";
}

function interpretationPayload() {
  if (els.interpretationMode.value !== "manual") return { color_space: null, transfer_function: null, linear_reference: null };
  const mapped = interpretationPayloadFromColorSpace(els.interpretationColorSpace.value);
  const transfer = interpretationTransferPayload(els.interpretationTransfer.value, mapped.transfer_function);
  return {
    color_space: mapped.color_space,
    transfer_function: transfer,
    linear_reference: transfer === "LINEAR" ? els.interpretationLinearReference.value : null,
  };
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
  if (session.source.interpretation_mode === "manual") return sourceInterpretationStatus(session);
  const note = session.metadata.extra?.color_space_note;
  if (note) return note;
  if (session.analysis.needs_color_override) return "This file needs a color interpretation override before export decisions are trustworthy.";
  return "Auto source interpretation looks consistent.";
}

function interpretationSummary(session) {
  if (isDevelopedRawSession(session)) return "Auto: camera-native RAW profile → ACEScg working";
  const mode = session.source.interpretation_mode === "manual" ? "Manual" : "Auto";
  const colorSpace = session.source.source_color_space || "unknown primaries";
  const transfer = session.source.transfer_function || "unknown transfer";
  return `${mode}: ${colorSpace} + ${transfer}`;
}

function openManualInterpretation() {
  if (!state.session) return;
  revealSourceRail();
  state.sourceSettingsOpen = true;
  els.interpretationMode.value = "manual";
  renderSourceSettingsVisibility();
  renderSourceSettingsControls();
  els.interpretationColorSpace.focus();
}

function renderInterpretationGate() {
  const needsReview = Boolean(state.session?.analysis?.needs_color_override);
  const visible = needsReview && !state.interpretationGateDismissed;
  if (!visible) return status.clear("source-interpretation");
  status.post({
    id: "source-interpretation",
    nodeId: "interpretation-gate",
    copyId: "interpretation-gate-copy",
    severity: "attention",
    message: `Source interpretation needs review — ${overrideMessage(state.session)}`,
    persistent: true,
    actions: [
      {
        label: "Use assumption",
        id: "accept-interpretation",
        run: () => {
          state.interpretationGateDismissed = true;
          renderInterpretationGate();
          updateExportAvailability();
        },
      },
      { label: "Set manually", id: "manual-interpretation", run: openManualInterpretation },
    ],
  });
}

function retireActiveSession() {
  // End every document-owned timer, controller, selection, draft, and cache
  // before a replacement document is installed. Generations remain monotonic
  // so callbacks already queued by the browser cannot publish into the next
  // session even after their controller has been aborted.
  cancelRoiCatchUp();
  cancelRoiPanRefinement();
  clearNavigationThumbnail();
  window.clearTimeout(state.localMaskDraftTimer);
  state.localMaskDraftTimer = 0;
  state.localMaskDraftController?.abort();
  state.localMaskDraftController = null;
  state.localMaskDraftPending = null;
  state.localMaskDraftGeneration += 1;
  state.localMaskDraftDirty = false;
  for (const pending of localComparisonMaskRequests.values()) {
    window.clearTimeout(pending.timer);
    pending.controller?.abort();
  }
  for (const pending of localAuthoritativeMaskRequests.values()) pending.controller?.abort();
  localAuthoritativeMaskRequests.clear();
  localComparisonMaskRequests.clear();
  localAuthoritativeMaskCache.clear();
  localComparisonMaskCache.clear();
  localComparisonCompositeCache.clear();
  localBrushMaskCanvasCache.clear();
  if (localMaskOverlayFrame) window.cancelAnimationFrame(localMaskOverlayFrame);
  localMaskOverlayFrame = 0;
  if (pathMarchingAntFrame) window.cancelAnimationFrame(pathMarchingAntFrame);
  pathMarchingAntFrame = 0;
  window.clearTimeout(state.pathMaskProgressTimer);
  state.pathMaskProgressTimer = 0;
  state.pathMaskProgressTarget = null;
  state.pathMaskProgressStartedAt = 0;
  state.selectedLocalId = null;
  state.selectedSubMaskId = null;
  state.pendingLocalAdjustment = null;
  state.pendingSubMask = null;
  state.localTool = null;
  state.localCreationTool = null;
  state.localPointerGesture = null;
  state.localPathDraft = null;
  state.localPathCreatePendingId = null;
  state.selectedPathNode = null;
  state.hoveredPathTarget = null;
  state.localPathCursor = null;
  state.pathInvalidGesture = false;
  state.localBrushCursor = null;
  state.localBrushPreviewPinned = false;
  state.localBrushVisibleBounds = null;
  state.localAdjustmentMenuId = null;
  state.localShowMask = false;
  state.localHiddenGizmoIds.clear();
  state.denoiseNoiseView = false;
  state.localPreviewDirty = false;
  state.localMaskCommitDepth = 0;
  state.localMaskCommitRefreshPending = false;
  state.localErase = false;
  clearPreviewCache();
}

async function cancelActiveImport() {
  if (!state.importInProgress) return;
  const jobId = state.activeImportJobId;
  state.importGeneration += 1;
  state.activeImportJobId = null;
  state.importInProgress = false;
  setImportCancelVisible(false);
  setIndeterminatePreviewMessage("Cancelling import...");
  updateExportAvailability();
  if (jobId) {
    await projectIo.cancelImportJob(fetch, jobId).catch(() => null);
  }
  finishCancelledImport();
}

function finishCancelledImport() {
  state.importInProgress = false;
  setImportCancelVisible(false);
  hidePreviewMessage();
  if (!state.session) clearPreviewImage();
  status.post({
    id: "import",
    severity: "success",
    message: state.session ? "Import cancelled. Current image kept." : "Import cancelled.",
  });
  updateExportAvailability();
}

