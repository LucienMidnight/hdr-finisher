async function initializeDesktopBridge() {
  els.revealExportPath?.classList.toggle("hidden", !desktop);
  els.openExportPath?.classList.toggle("hidden", !desktop);
  document.addEventListener("hdr:desktop-command", (event) => {
    void handleDesktopCommand(event.detail?.command, event.detail?.payload);
  });
  if (!desktop) return;
  desktop.onMenuCommand(({ command, payload }) => handleDesktopCommand(command, payload));
  desktop.onOpenRequest((selection) => {
    void openDesktopSelection(selection).catch((error) => {
      console.error(error);
      showUploadError(error?.message || "Could not open that source image.");
    });
  });
  desktop.onDisplayStateChanged?.((environment) => {
    state.desktopEnvironment = environment;
    state.displayInfo = buildDisplayProbe(environment);
    state.displayInfo.gpu = state.gpuPreview?.detail || "Backend fallback";
    clearGpuSurfaceHdr();
    state.gpuPreview?.invalidateSurfaces?.();
    renderReadouts();
    if (state.session) {
      invalidatePreview(state.currentView, { markDirty: false });
      settlePreview(state.currentView).catch(() => null);
    }
  });
  await desktop.rendererReady();
  state.desktopEnvironment = await desktop.environment();
  state.displayInfo = buildDisplayProbe(state.desktopEnvironment);
  state.renderingMode = ["auto", "gpu", "cpu"].includes(state.desktopEnvironment.renderingMode)
    ? state.desktopEnvironment.renderingMode
    : "auto";
}

async function handleDesktopCommand(command, payload = null) {
  if (command === "open-source") return requestSourceImport();
  if (command === "open-project") return openProjectFromPath();
  if (command === "save") return saveProjectToPath({ saveAs: false });
  if (command === "save-as") return saveProjectToPath({ saveAs: true });
  if (command === "export") return openExportSheet();
  if (command === "revert-hdr") return revertRendition("hdr");
  if (command === "revert-sdr") return revertRendition("sdr");
  if (command === "undo") return queueEditCommand("undo");
  if (command === "redo") return queueEditCommand("redo");
  if (command === "rendering-mode") {
    if (window.HDRApplicationShell) {
      window.HDRApplicationShell.setRenderingModePreference(payload?.mode);
      return true;
    }
    return applyRenderingMode(payload?.mode);
  }
  if (command === "settings") return window.HDRApplicationShell?.openSettings();
  if (command === "help") return window.HDRApplicationShell?.openHelp();
  if (command === "check-updates") {
    window.HDRApplicationShell?.openSettings("updates");
    return window.HDRApplicationShell?.checkForUpdates({ force: true, manual: true });
  }
}

function applicationCommands() {
  return [
    { id: "app.settings", label: "Open Settings", category: "Application", global: true, execute: () => window.HDRApplicationShell?.openSettings() },
    { id: "app.help", label: "Open Help", category: "Application", global: true, execute: () => window.HDRApplicationShell?.openHelp() },
    { id: "file.import", label: "Import source", category: "File", execute: () => requestSourceImport() },
    { id: "file.importQuick", label: "Import source (quick key)", category: "File", execute: () => requestSourceImport() },
    { id: "project.open", label: "Open project", category: "File", execute: () => openProjectFromPath() },
    { id: "project.save", label: "Save project", category: "File", execute: () => saveProjectToPath({ saveAs: false }) },
    { id: "project.saveAs", label: "Save project as", category: "File", execute: () => saveProjectToPath({ saveAs: true }) },
    { id: "file.export", label: "Open Export", category: "File", execute: () => openExportSheet() },
    { id: "file.exportStandard", label: "Open Export (standard)", category: "File", execute: () => openExportSheet() },
    { id: "edit.undo", label: "Undo", category: "Edit", global: true, execute: () => queueEditCommand("undo") },
    { id: "edit.redo", label: "Redo", category: "Edit", global: true, execute: () => queueEditCommand("redo") },
    { id: "edit.redoAlternate", label: "Redo (alternate)", category: "Edit", global: true, execute: () => queueEditCommand("redo") },
    { id: "edit.redoRequested", label: "Redo (Ctrl+R)", category: "Edit", global: true, execute: () => queueEditCommand("redo") },
    { id: "view.compareHold", label: "Hold to compare HDR / SDR", category: "Viewer", hold: true, execute: (_event, phase) => phase === "keyup" ? endCompareHold() : beginCompareHold() },
    { id: "view.zoomFit", label: "Zoom to fit", category: "Viewer", execute: () => setZoomMode("fit") },
    { id: "view.zoomActual", label: "Zoom to 100%", category: "Viewer", execute: () => setZoomMode("actual") },
    { id: "view.zoomIn", label: "Zoom in", category: "Viewer", repeatable: true, execute: () => stepZoom(1) },
    { id: "view.zoomOut", label: "Zoom out", category: "Viewer", repeatable: true, execute: () => stepZoom(-1) },
    { id: "view.analysis", label: "Toggle analysis panel", category: "Viewer", execute: () => toggleAnalysisDock() },
    { id: "view.overlay", label: "Cycle overlay mode", category: "Viewer", execute: () => cycleOverlayMode() },
    { id: "view.scopeRegion", label: "Toggle Scope Region", category: "Viewer", execute: () => toggleScopeRegion() },
    { id: "view.hdr", label: "Show HDR rendition", category: "Viewer", execute: () => switchLane("hdr") },
    { id: "view.sdr", label: "Show SDR rendition", category: "Viewer", execute: () => switchLane("sdr") },
    {
      id: "crop.cycleGuide",
      label: "Cycle crop guide",
      category: "Crop",
      execute: () => {
        if (!state.cropMode) return;
        const guides = ["none", "thirds", "golden", "grid", "x", "diagonals"];
        state.cropGuide = guides[(guides.indexOf(state.cropGuide) + 1) % guides.length];
        renderCropOptions();
      },
    },
    ...["import", "grade", "proof", "export"].map((workflow) => ({
      id: `workflow.${workflow}`,
      label: `Open ${workflow[0].toUpperCase()}${workflow.slice(1)} workspace`,
      category: "Workflow",
      execute: () => activateWorkflowTab(workflow, { focus: true }),
    })),
  ];
}

function adjustControlFromShortcut(path, direction, event) {
  const control = [...document.querySelectorAll('input[type="range"][data-path]')]
    .find((candidate) => candidate.dataset.path === path && !candidate.disabled);
  if (!control) return false;
  if (direction === "reset") {
    control.value = control.dataset.defaultValue ?? control.defaultValue;
  } else {
    const baseStep = Number(control.dataset.instrumentStep) || Number(control.step) || ((Number(control.max) - Number(control.min)) / 100) || 1;
    const multiplier = event?.ctrlKey ? FINE_ADJUSTMENT_SCALE : 1;
    const delta = baseStep * multiplier * (direction === "increase" ? 1 : -1);
    const value = clamp(Number(control.value) + delta, Number(control.min), Number(control.max));
    control.value = String(Math.round(value * 1e8) / 1e8);
  }
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function initializeApplicationShell() {
  if (!window.HDRApplicationShell) return;
  state.appPreferences = await window.HDRApplicationShell.init({
    desktop,
    commands: applicationCommands(),
    adjustControl: adjustControlFromShortcut,
    onPreferencesChanged: (preferences, options = {}) => {
      const oldDirectory = state.appPreferences?.folders?.fileSave || "";
      const themeChanged = !options.initial && preferences.theme !== state.appPreferences?.theme;
      state.appPreferences = preferences;
      if (themeChanged) {
        // CSS custom properties repaint immediately, but canvases (scopes,
        // curve editor, tone equalizer) only redraw when explicitly told to —
        // otherwise they keep showing colors sampled at the last draw call.
        drawHistogram(state.lastScope || []);
        if (els.curveEditor) drawCurveEditor();
        if (els.toneEqualizerEditor) drawToneEqualizerEditor("hdr");
        if (els.sdrToneEqualizerEditor) drawToneEqualizerEditor("sdr");
        if (els.highlightCompressionGraph) renderHighlightCompressionControls();
        if (els.sdrHighlightCompressionGraph) renderSdrHighlightCompressionControls();
      }
      if (preferences.folders.fileSave) {
        state.defaultExportDirectory = preferences.folders.fileSave;
        if (!els.exportDirectory.value.trim() || els.exportDirectory.value === oldDirectory) els.exportDirectory.value = preferences.folders.fileSave;
      } else if (oldDirectory) {
        state.defaultExportDirectory = "";
        if (els.exportDirectory.value === oldDirectory) els.exportDirectory.value = "";
        void loadDefaultExportDirectory();
      }
      if (!state.session) els.hdrReferenceWhite.value = String(preferences.defaultReferenceWhiteNits);
      const preferredPreviewResolution = preferences.previewResolution === "auto"
        ? "auto" : normalizedPreviewResolution(preferences.previewResolution);
      const selectablePreviewResolution = preferredPreviewResolution;
      state.fasterDragging = preferences.fasterDragging === true;
      if (els.previewFasterDragging) els.previewFasterDragging.checked = state.fasterDragging;
      if (options.initial) {
        state.previewResolutionOverride = selectablePreviewResolution !== "auto";
        if (state.previewResolutionOverride) state.previewResolution = selectablePreviewResolution;
      } else if (selectablePreviewResolution !== (state.previewResolutionOverride ? state.previewResolution : "auto")) {
        applyPreviewResolution(selectablePreviewResolution);
      }
      applyGpuMemoryBudget(preferences.maximumGpuMemoryGiB);
      applyExecutionOverride(preferences.executionOverride);
      applyRoiPreview(preferences.roiPreview);
      if (options.initial) state.renderingMode = preferences.renderingMode;
      else if (preferences.renderingMode !== state.renderingMode) void applyRenderingMode(preferences.renderingMode);
    },
  });
}

/**
 * Force one execution route, for comparing the two on the same grade.
 *
 * Diagnostic. Direct and Tiled are required to produce identical pixels, so
 * this exists to make that difference observable rather than to give the two
 * routes different jobs. Admission still refuses a forced Direct it cannot
 * hold: a diagnostic switch has no business overriding the memory guard.
 */
function applyExecutionOverride(value) {
  const setting = value === "direct" || value === "tiled" ? value : null;
  state.executionOverride = setting;
  if (state.gpuPreview) state.gpuPreview.executionOverride = setting;
  state.gpuPreview?.clearAllocationBackoff?.();
  renderReadouts();
  // Re-render so the change is visible immediately rather than at the next
  // edit, which is the whole point of a switch you flip to compare routes.
  if (state.session) {
    invalidatePreview(state.currentView, { markDirty: false });
    debouncePreview(state.currentView);
  }
}

/**
 * Limit the refinement pass to the visible region, or process the whole frame.
 *
 * Experimental and off by default. Pan and zoom are never limited, so a newly
 * exposed region always has complete pixels; this only decides whether the
 * expensive refinement pass spends its time on tiles the viewer cannot see.
 */
function applyGpuMemoryBudget(value) {
  // PRD 4.2: the budget decides Direct versus Tiled execution and cache
  // eviction. It never decides whether a resolution option is visible, so
  // nothing here touches the preview-resolution selector.
  const setting = value === "auto" || value === undefined || value === null ? "auto" : value;
  const previousBytes = state.gpuPreview?.memoryBudgetBytes?.() ?? null;
  state.gpuMemoryBudget = setting;
  const bytes = state.gpuPreview?.setMemoryBudget?.(setting)
    ?? window.HDRWebGPUPreview?.normalizeGpuBudgetBytes?.(setting)
    ?? null;
  // A larger budget can re-admit Direct execution that an earlier allocation
  // failure backed off from, so let the next render re-plan from scratch.
  state.gpuPreview?.clearAllocationBackoff?.();
  renderReadouts();
  // A new budget can change the route. Re-plan and re-render the current view
  // now, so the readout never shows a route that the next edit would change.
  if (state.session && state.gpuPreview?.available && bytes !== previousBytes) {
    invalidatePreview(state.currentView, { markDirty: false });
    debouncePreview(state.currentView);
  }
  return bytes;
}

/** Settings shows what Auto means on this machine, not a fixed number. */
function renderGpuMemoryAutoLabel() {
  const option = document.querySelector('#settings-gpu-memory-limit option[value="auto"]');
  const calibration = state.gpuPreview?.gpuBudget || null;
  if (option && calibration && window.HDRGpuBudget?.autoLabel) {
    option.textContent = window.HDRGpuBudget.autoLabel(calibration);
  }
}

async function applyNewSessionPreferences() {
  const requested = Number(state.appPreferences?.defaultReferenceWhiteNits) === 100 ? 100 : 203;
  if (!state.session || projectReferenceWhiteNits() === requested) return true;
  return queueEditCommand("set_hdr_reference_white", { hdr_reference_white_nits: requested }, null, { refreshPreview: false });
}

async function applyRenderingMode(mode) {
  if (!["auto", "gpu", "cpu"].includes(mode)) return false;
  state.renderingMode = mode;
  state.gpuPreparedLane = { hdr: false, sdr: false };
  state.gpuPreview?.resetSession(state.session?.session_id || null);
  if (state.session) {
    invalidatePreview("hdr", { markDirty: false });
    invalidatePreview("sdr", { markDirty: false });
    await settlePreview(state.currentView);
  }
  renderReadouts();
  return true;
}

async function writeClipboardText(value) {
  if (desktop?.writeClipboardText) return desktop.writeClipboardText(value);
  return navigator.clipboard.writeText(value);
}

