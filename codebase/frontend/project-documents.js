function sanitizeProjectFilename(value) {
  const base = (String(value || "Untitled").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "Untitled").replace(/[. ]+$/, "");
  const stem = base.replace(/\.hdrfinisher$/i, "").split(".", 1)[0];
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
    throw new Error(`“${stem}” is a reserved Windows filename. Choose another project name.`);
  }
  return base.toLowerCase().endsWith(".hdrfinisher") ? base : `${base}.hdrfinisher`;
}

function projectOpenNeedsSourceRelink(payload) {
  return projectIo.needsSourceRelink(payload);
}

function beginProjectOpenStatus(label) {
  status.post({
    id: "project-open",
    severity: "progress",
    message: `Opening project · ${label}`,
    progress: "indeterminate",
  });
  return 0;
}

function syncProjectBadge() {
  if (!els.badge) return;
  const projectName = state.projectPath
    ? String(state.projectPath).split(/[/\\]/).pop()
    : state.session?.source?.filename || "No project";
  els.badge.textContent = state.documentDirty ? `${projectName} · Unsaved` : projectName;
  els.badge.className = `badge ${state.documentDirty ? "warn" : "neutral"}`;
}

function syncDesktopDocumentState() {
  syncProjectBadge();
  if (!desktop) return;
  const displayName = state.projectPath
    ? String(state.projectPath).split(/[/\\]/).pop()
    : state.session?.source?.filename || "Untitled";
  const payload = { path: state.projectPath || "", dirty: Boolean(state.documentDirty), displayName };
  const key = JSON.stringify(payload);
  if (key === state.desktopDocumentStateKey) return;
  state.desktopDocumentStateKey = key;
  desktop.setDocumentState(payload).catch((error) => {
    state.desktopDocumentStateKey = "";
    console.error("Desktop document state could not be synchronized.", error);
  });
}

function sourcePathForClipboard() {
  return state.editDocument?.source?.durable_path || null;
}

function syncCopySourcePathButton() {
  const sourcePath = sourcePathForClipboard();
  els.copySourcePath.disabled = !sourcePath;
  els.copySourcePath.textContent = "Copy path";
  els.copySourcePath.title = sourcePath
    ? "Copy the full source path"
    : "The original path is unavailable for browser-uploaded files";
}

async function copySourcePath() {
  const sourcePath = sourcePathForClipboard();
  if (!sourcePath) return;
  try {
    await writeClipboardText(sourcePath);
    els.copySourcePath.textContent = "Copied";
  } catch {
    els.copySourcePath.textContent = "Copy failed";
  }
}

function renderSourceFilename(filename) {
  els.sessionName.textContent = filename;
  els.sessionNameTooltip.textContent = filename;
  requestAnimationFrame(syncSourceFilenameOverflow);
}

function syncSourceFilenameOverflow() {
  const overflowed = els.sessionName.scrollHeight > els.sessionName.clientHeight + 1;
  els.sessionNameWrap.classList.toggle("has-overflow", overflowed);
  if (overflowed) {
    els.sessionName.tabIndex = 0;
    els.sessionName.setAttribute("aria-describedby", "session-name-tooltip");
  } else {
    els.sessionName.removeAttribute("tabindex");
    els.sessionName.removeAttribute("aria-describedby");
  }
}

async function openDesktopSelection(selection) {
  if (!selection) return;
  if (selection.kind === "project") {
    await openProjectFromPath(selection);
    return;
  }
  renderExperimentalDngNote(selection);
  if (!await confirmUnsavedTransition("import another source")) return;
  await openStagedDesktopSource(selection);
}

async function openStagedDesktopSource(selection) {
  const generation = claimSessionReplacement();
  if (state.activeImportJobId) {
    await projectIo.cancelImportJob(fetch, state.activeImportJobId).catch(() => null);
  }
  if (generation !== state.importGeneration) return;
  await state.byteUploadQueue.catch(() => null);
  if (generation !== state.importGeneration) return;
  status.post({ id: "import", severity: "progress", message: "Loading image and building session…", progress: "indeterminate" });
  state.importInProgress = true;
  updateExportAvailability();
  setIndeterminatePreviewMessage("Starting import · 0.0s elapsed");
  setImportCancelVisible(true);
  const { response, payload: initialJob } = await projectIo.createImportJob(fetch, {
    grant: selection.grant,
    rawImportSettings: selection.rawImportSettings,
    replaceSessionId: selection.replaceSessionId,
  });
  let job = initialJob;
  if (generation !== state.importGeneration) {
    if (job?.job_id) await projectIo.cancelImportJob(fetch, job.job_id).catch(() => null);
    return;
  }
  if (!response.ok || !job?.job_id) {
    state.importInProgress = false;
    setImportCancelVisible(false);
    showUploadError(job?.detail || "The source file could not be opened.");
    return;
  }
  state.activeImportJobId = job.job_id;
  const startedAt = performance.now();
  while (generation === state.importGeneration && state.activeImportJobId === job.job_id) {
    const elapsed = (performance.now() - startedAt) / 1000;
    const label = job.phase_label || "Preparing source";
    const reassurance = elapsed >= 10 ? " · still working normally" : "";
    setIndeterminatePreviewMessage(`${label}${reassurance} · ${elapsed.toFixed(1)}s elapsed`);
    if (job.state === "ready" && job.session_id) {
      const { response: sessionResponse, payload } = await projectIo.fetchSession(fetch, job.session_id);
      if (generation !== state.importGeneration || state.activeImportJobId !== job.job_id) return;
      state.activeImportJobId = null;
      state.importInProgress = false;
      setImportCancelVisible(false);
      if (!sessionResponse.ok || !payload?.session) {
        showUploadError(payload?.detail || "The completed source session could not be opened.");
        return;
      }
      const retainedProjectPath = selection.replaceSessionId ? state.projectPath : "";
      await activateDesktopSession(payload.session, retainedProjectPath);
      if (!selection.replaceSessionId) await recordSuccessfulMediaImport(selection.path);
      status.post({ id: "import", severity: "success", message: "Source imported." });
      return;
    }
    if (job.state === "error" || job.state === "cancelled") {
      state.activeImportJobId = null;
      state.importInProgress = false;
      setImportCancelVisible(false);
      if (job.state === "error") showUploadError(job.error || "The source file could not be opened.");
      else finishCancelledImport();
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const { response: poll, payload } = await projectIo.pollImportJob(fetch, job.job_id);
    job = payload;
    if (!poll.ok) {
      state.activeImportJobId = null;
      state.importInProgress = false;
      setImportCancelVisible(false);
      showUploadError(job?.detail || "Import progress could not be read.");
      return;
    }
  }
}

async function activateDesktopSession(session, projectPath) {
  retireActiveSession();
  state.session = session;
  state.renderCoordinator?.noteSource(session.session_id);
  state.importInProgress = false;
  if (els.rawSettingsPanel) delete els.rawSettingsPanel.dataset.initialized;
  state.adjustments = session.adjustments;
  state.editDocument = session.edit_document;
  loadDenoiseDocument(state.editDocument);
  state.editRevision = session.edit_revision || 0;
  recordAcknowledgedLocals(state.editDocument);
  state.documentDirty = Boolean(session.dirty);
  state.selectedLocalId = state.editDocument.local_adjustments[0]?.id || null;
  state.projectPath = projectPath || "";
  state.currentView = "hdr";
  // A source replacement starts as a new viewing task. Carrying an Actual or
  // custom zoom across differently-sized files makes the first authoritative
  // frame arrive cropped or far off-screen, so every import begins at Fit.
  state.zoomMode = "fit";
  state.zoomPercent = 100;
  state.zoomReferenceFrame = null;
  if (!projectPath) await applyNewSessionPreferences();
  state.interpretationGateDismissed = false;
  state.gpuPreview?.resetSession(session.session_id);
  if (state.gpuPreview?.warmDenoiseModel) {
    const native = Math.max(session.source.width, session.source.height);
    void state.gpuPreview.warmDenoiseModel(session.session_id, "hdr", native);
  }
  invalidatePreview("hdr", { markDirty: false });
  invalidatePreview("sdr", { markDirty: false });
  activateWorkflowTab("grade", { focus: false });
  renderSession();
  renderLocalAdjustments();
  seedExportFieldsFromSession();
  const gpuReady = await renderGpuDraft("hdr", { hideStatus: false, longEdge: settledProxyLongEdge() });
  await Promise.all([
    gpuReady ? Promise.resolve(true) : refreshPreview({ progressSteps: [36, 76, 92] }),
    refreshOverlay(),
    refreshScopes(scopeLongEdge("settled"), { tier: "settled" }),
  ]);
  if (state.denoise.hdr.enabled) await recalculateDenoise();
  hidePreviewMessage();
  prepareInactivePreview();
  if (previewNeedsRefinement()) debouncePreview("hdr");
  syncDesktopDocumentState();
}

function documentTransitionToken() {
  return [
    state.session?.session_id || "",
    state.editRevision,
    state.globalEditGeneration,
    state.documentDirty ? "dirty" : "clean",
  ].join(":");
}

async function openProjectFromPath(desktopSelection = null) {
  if (!await confirmUnsavedTransition("open another project")) return;
  const confirmedDocument = documentTransitionToken();
  if (desktop) {
    const selection = desktopSelection || await chooseProjectPath(
      "project_open",
      state.appPreferences?.folders?.projectImport || "",
    );
    if (!selection) return;
    if (documentTransitionToken() !== confirmedDocument && !await confirmUnsavedTransition("open another project")) return;
    const replacementGeneration = ++state.importGeneration;
    const activeJobId = state.activeImportJobId;
    state.activeImportJobId = null;
    if (activeJobId) await projectIo.cancelImportJob(fetch, activeJobId).catch(() => null);
    await state.byteUploadQueue.catch(() => null);
    if (replacementGeneration !== state.importGeneration) return;
    const openGeneration = ++state.projectOpenGeneration;
    state.projectOpenController?.abort();
    const controller = new AbortController();
    state.projectOpenController = controller;
    let projectActivated = false;
    els.projectOpen.disabled = true;
    const statusTimer = beginProjectOpenStatus(selection.path?.split(/[\\/]/).pop() || "loading source");
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    try {
      let result = await projectIo.openDesktopProject(fetch, {
        projectGrant: selection.grant,
        signal: controller.signal,
      }).catch((error) => error.name === "AbortError" ? null : Promise.reject(error));
      if (!result || openGeneration !== state.projectOpenGeneration) return;
      let { response, payload } = result;
      if (openGeneration !== state.projectOpenGeneration) return;
      if (!response.ok && projectOpenNeedsSourceRelink(payload)) {
        const source = await desktop.relinkSource();
        if (!source || openGeneration !== state.projectOpenGeneration) {
          status.clear("project-open");
          return;
        }
        result = await projectIo.openDesktopProject(fetch, {
          projectGrant: selection.grant,
          sourceGrant: source.grant,
          signal: controller.signal,
        }).catch((error) => error.name === "AbortError" ? null : Promise.reject(error));
        if (!result || openGeneration !== state.projectOpenGeneration) return;
        ({ response, payload } = result);
      }
      if (openGeneration !== state.projectOpenGeneration) return;
      if (!response.ok || !payload?.session) {
        status.post({
          id: "project-open",
          severity: "error",
          message: responseErrorMessage(payload, "The project could not be opened."),
        });
        return;
      }
      await activateDesktopSession(payload.session, selection.path);
      projectActivated = true;
      status.post({ id: "project-open", severity: "success", message: "Project opened." });
      return;
    } catch (error) {
      if (error?.name !== "AbortError") {
        status.post({ id: "project-open", severity: "error", message: error?.message || "The project could not be opened." });
      }
      return;
    } finally {
      if (openGeneration === state.projectOpenGeneration) {
        window.clearInterval(statusTimer);
        els.projectOpen.disabled = false;
        if (!projectActivated) hidePreviewMessage();
        if (!projectActivated && status.get("project-open")?.severity === "progress") status.clear("project-open");
      }
    }
  }
  const path = await window.HDRDialogs.prompt(
    "Path to a .hdrfinisher project", state.projectPath || "",
    { title: "Open project", confirmLabel: "Open" },
  );
  if (!path) return;
  const replacementGeneration = ++state.importGeneration;
  await state.byteUploadQueue.catch(() => null);
  if (replacementGeneration !== state.importGeneration) return;
  const statusTimer = beginProjectOpenStatus(path.split(/[\\/]/).pop() || "loading source");
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  let sourcePath = null;
  try {
    let result = await projectIo.openPathProject(fetch, { path });
    let { response, payload } = result;
    if (!response.ok && projectOpenNeedsSourceRelink(payload)) {
      sourcePath = await window.HDRDialogs.prompt(
        "The saved source is unavailable or changed. Select the matching original source path.",
        "", { title: "Relink source" },
      );
      if (!sourcePath) {
        status.clear("project-open");
        return;
      }
      result = await projectIo.openPathProject(fetch, { path, sourcePath });
      ({ response, payload } = result);
    }
    if (!response.ok || !payload?.session) {
      status.post({
        id: "project-open",
        severity: "error",
        message: responseErrorMessage(payload, "The project could not be opened."),
      });
      return;
    }
    await activateDesktopSession(payload.session, path);
    status.post({ id: "project-open", severity: "success", message: "Project opened." });
  } catch (error) {
    status.post({ id: "project-open", severity: "error", message: error?.message || "The project could not be opened." });
  } finally {
    window.clearInterval(statusTimer);
    hidePreviewMessage();
    if (status.get("project-open")?.severity === "progress") status.clear("project-open");
  }
}

async function saveProjectToPath({ saveAs = false } = {}) {
  if (!state.session) return false;
  const pendingApplied = await (state.editCommandQueue || Promise.resolve(true));
  const globalsApplied = pendingApplied === false ? false : await syncGlobalEditState();
  if (globalsApplied === false) {
    status.post({ id: "project-save", severity: "error", message: "The project could not be saved because the latest edit failed." });
    return false;
  }
  if (desktop) {
    const suggestedName = `${state.session.source.filename.replace(/\.[^.]+$/, "")}.hdrfinisher`;
    let selection = null;
    try {
      if (!saveAs && state.projectPath) {
        selection = await desktop.grantProjectPath(state.projectPath, "project-save");
      } else {
        const existing = splitOutputPath(state.projectPath);
        const initialDirectory = state.projectPath
          ? existing.directory
          : state.appPreferences?.folders?.projectSave || "";
        selection = await chooseProjectPath(
          "project_save",
          initialDirectory,
          state.projectPath ? `${existing.filename}.hdrfinisher` : suggestedName,
        );
      }
    } catch (error) {
      status.post({ id: "project-save", severity: "error", message: error?.message || "The project could not be saved." });
      return false;
    }
    if (!selection) return false;
    status.post({ id: "project-save", severity: "progress", message: "Saving project…", progress: "indeterminate" });
    let response;
    let payload;
    try {
      ({ response, payload } = await projectIo.saveDesktopProject(fetch, {
        sessionId: state.session.session_id,
        projectGrant: selection.grant,
      }));
    } catch (error) {
      status.post({ id: "project-save", severity: "error", message: error?.message || "The project could not be saved." });
      return false;
    }
    if (!response.ok) {
      status.post({
        id: "project-save",
        severity: "error",
        message: responseErrorMessage(payload, "The project could not be saved."),
      });
      return false;
    }
    state.projectPath = payload.path;
    state.editDocument = payload.document;
    loadDenoiseDocument(state.editDocument);
    state.documentDirty = false;
    syncCopySourcePathButton();
    syncDesktopDocumentState();
    syncProjectBadge();
    status.post({ id: "project-save", severity: "success", message: `Project saved · revision ${payload.revision}` });
    return true;
  }
  const path = await window.HDRDialogs.prompt(
    "Save project path", state.projectPath || `${state.session.source.filename}.hdrfinisher`,
    { title: "Save project", confirmLabel: "Save" },
  );
  if (!path) return false;
  let sourcePath = state.editDocument?.source?.durable_path || null;
  if (!sourcePath) {
    sourcePath = await window.HDRDialogs.prompt(
      "Path to the durable original source (the project stores no source pixels)",
      "", { title: "Durable source path" },
    );
    if (!sourcePath) return false;
  }
  status.post({ id: "project-save", severity: "progress", message: "Saving project…", progress: "indeterminate" });
  let response;
  let payload;
  try {
    ({ response, payload } = await projectIo.savePathProject(fetch, {
      sessionId: state.session.session_id,
      path,
      sourcePath,
    }));
  } catch (error) {
    status.post({ id: "project-save", severity: "error", message: error?.message || "The project could not be saved." });
    return false;
  }
  if (!response.ok) {
    status.post({
      id: "project-save",
      severity: "error",
      message: responseErrorMessage(payload, "The project could not be saved."),
    });
    return false;
  }
  state.projectPath = payload.path;
  state.editDocument = payload.document;
  loadDenoiseDocument(state.editDocument);
  state.documentDirty = false;
  syncCopySourcePathButton();
  syncProjectBadge();
  status.post({ id: "project-save", severity: "success", message: `Project saved · revision ${payload.revision}` });
  return true;
}

async function confirmUnsavedTransition(actionLabel) {
  if (!state.session || !state.documentDirty) return true;
  let choice = "cancel";
  if (desktop?.confirmUnsavedTransition) {
    choice = await desktop.confirmUnsavedTransition({ actionLabel });
  } else {
    // One three-way question, not two yes-or-no ones. Asking "save?" and then
    // "discard?" makes Cancel the answer to a question the user was never
    // shown, and it put two native modals in a row on the path that broke the
    // renderer's <select> handling.
    choice = await window.HDRDialogs.choose(
      `Save changes before you ${actionLabel}?`,
      [
        { label: "Cancel", value: "cancel", cancel: true },
        { label: "Discard", value: "discard", destructive: true },
        { label: "Save", value: "save", primary: true },
      ],
      { title: "Unsaved changes" },
    ) || "cancel";
  }
  if (choice === "discard") return true;
  if (choice === "save") return await saveProjectToPath({ saveAs: false });
  return false;
}

