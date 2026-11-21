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
  window.HDRGradeSaving?.render();
  if (!els.badge) return;
  const projectName = state.projectPath
    ? String(state.projectPath).split(/[/\\]/).pop()
    : state.session?.source?.filename || "No project";
  els.badge.onclick = () => window.HDRGradeSaving?.reviewGradeNotice();
  els.badge.title = state.session?.grade_notice?.reason || "";
  els.badge.textContent = state.session?.grade_notice ? `${projectName} · Grade needs attention` : state.documentDirty ? `${projectName} · Unsaved` : projectName;
  els.badge.className = `badge ${state.documentDirty || state.session?.grade_notice ? "warn" : "neutral"}`;
}

function syncDesktopDocumentState() {
  syncProjectBadge();
  if (!desktop) return;
  const displayName = state.projectPath
    ? String(state.projectPath).split(/[/\\]/).pop()
    : state.session?.source?.filename || "Untitled";
  const payload = { path: state.projectPath || "", dirty: Boolean(state.documentDirty), displayName,
    sidecar: Boolean(window.HDRGradeSaving?.active()), conflict: Boolean(window.HDRGradeSaving?.conflict()) };
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

function gradeDiagnosticPhoto() {
  const source = state.editDocument?.source;
  const path = source?.durable_path || state.gradeOpen?.path;
  const id = path || state.session?.session_id;
  return id ? { id, name: path?.split(/[\\/]/).at(-1) || source?.filename || state.session?.source?.filename } : null;
}

async function openDesktopSelection(selection) {
  if (!selection) return;
  if (selection.kind === "project") {
    await openProjectFromPath(selection);
    return;
  }
  renderExperimentalDngNote(selection);
  if (selection.path === state.editDocument?.source?.durable_path && window.HDRGradeSaving?.active() && !selection.replaceSessionId && (selection.itemKey || selection.path) === window.HDRGradeSaving.item()) {
    activateWorkflowTab("grade"); return;
  }
  if (!await confirmUnsavedTransition(`opening ${selection.path?.split(/[/\\]/).pop() || "another photo"}`)) return;
  if (selection.isCurrent && !selection.isCurrent()) return;
  await openStagedDesktopSource(selection);
}

function gradeOpenStage(stage, fields = {}) {
  const open = state.gradeOpen;
  if (!open) return;
  void fetch("/api/library/stopwatch", { method: "POST", keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ stage, time: (performance.timeOrigin + performance.now()) / 1000,
      path: open.path, request: String(open.generation), duration_ms: performance.now() - open.started, ...fields }])
  }).catch(() => {});
}

// Release only the import whose pixels were actually presented. Backend
// readiness alone leaves Library work paused through upload and first draw.
const gradeOpening = window.HDRGradeOpening.create({fetch, socket:url=>new WebSocket(url),
  url:location.origin.replace(/^http/,"ws")+"/api/import-opening", current:id=>id===state.session?.session_id});
window.HDRGradeOpenPresented = sessionId => { void gradeOpening.acknowledge(sessionId); };
window.HDRGradeOpenFailed = sessionId => gradeOpening.retire(sessionId);
window.addEventListener("pagehide",()=>gradeOpening.close());
window.addEventListener("hdrfinisher:preview-presented", event => {
  if(event.detail?.generation===state.previewGeneration?.[event.detail.lane] && event.detail.lane===state.currentView)
    window.HDRGradeOpenPresented(event.detail.sessionId);
});

function finishGradeOpen() {
  state.gradeOpen = null;
  for (const panel of document.querySelectorAll(".source-rail, .grade-rail")) {
    panel.inert = state.activeWorkflow === "import";
    panel.removeAttribute("aria-busy");
  }
  renderSessionChrome();
  renderReadouts();
}

async function openStagedDesktopSource(selection) {
  const generation = claimSessionReplacement();
  const name = selection.path?.split(/[/\\]/).pop() || "photo";
  if (!selection.replaceSessionId) {
    state.gradeOpen = { generation, path: selection.path, name, started: Number.isFinite(selection.clickedAt) ? selection.clickedAt - performance.timeOrigin : performance.now(), fromLibrary: selection.fromLibrary };
    gradeOpenStage("grade_open_started");
    retireActiveSession();
    state.session = null;
    state.editDocument = null;
    state.documentDirty = false;
    state.renderCoordinator?.noteSource(null);
    state.gpuPreview?.resetSession();
    clearPreviewImage();
    clearComparisonPreview();
    drawHistogram(null);
    for (const list of [els.technicalPreviewList, els.technicalSourceList, els.sourcePreviewList, els.previewOutputList, els.metadataList]) list?.replaceChildren();
    renderSourceFilename(name);
    state.importInProgress = true;
    activateWorkflowTab("grade");
    for (const panel of document.querySelectorAll(".source-rail, .grade-rail")) { panel.inert = true; panel.setAttribute("aria-busy", "true"); }
    renderSessionChrome();
    status.post({ id: "import", severity: "progress", message: `Loading ${name}…`, progress: "indeterminate" });
    gradeOpenStage("grade_open_visible");
  }
  const diagnostics = globalThis.HDRDiagnostics;
  const action = diagnostics?.start("grade", "open_photo", { id: selection.path, name });
  const request = (url, options) => fetch(url, { ...options, headers: diagnostics?.headers(action, options?.headers) ?? options?.headers });
  if (state.gradeOpen?.generation === generation) state.gradeOpen.action = action;
  let openingJobId = null, completed = false;
  try {
    if (state.activeImportJobId) {
      await projectIo.cancelImportJob(fetch, state.activeImportJobId).catch(() => null);
    }
    if (generation !== state.importGeneration) return;
    await state.byteUploadQueue.catch(() => null);
    if (generation !== state.importGeneration) return;
    status.post({ id: "import", severity: "progress", message: `Loading ${name}…`, progress: "indeterminate" });
    state.importInProgress = true;
    updateExportAvailability();
    setIndeterminatePreviewMessage("Starting import · 0.0s elapsed");
    setImportCancelVisible(true);
    const recoveryChoice = selection.replaceSessionId ? null : await window.HDRGradeSaving.prepare(selection);
    if (generation !== state.importGeneration) return;
    const { response, payload: initialJob } = await projectIo.createImportJob(request, {
      grant: selection.grant,
      rawImportSettings: selection.rawImportSettings,
      replaceSessionId: selection.replaceSessionId,
      itemKey: selection.itemKey,
      recovery: recoveryChoice === "restore",
      openingOwner: await gradeOpening.connect(),
    });
    let job = initialJob;
    if (generation !== state.importGeneration) {
      if (job?.job_id) await projectIo.cancelImportJob(fetch, job.job_id).catch(() => null);
      return;
    }
    if (!response.ok || !job?.job_id) {
      state.importInProgress = false;
      setImportCancelVisible(false);
      throw new Error(job?.detail || "The source file could not be opened.");
    }
    openingJobId = state.activeImportJobId = job.job_id;
    const startedAt = performance.now();
    let firstPoll = true;
    while (generation === state.importGeneration && state.activeImportJobId === job.job_id) {
      const elapsed = (performance.now() - startedAt) / 1000;
      const label = job.phase_label || "Preparing source";
      const reassurance = elapsed >= 10 ? " · still working normally" : "";
      setIndeterminatePreviewMessage(`${label}${reassurance} · ${elapsed.toFixed(1)}s elapsed`);
      if (job.state === "ready" && job.session_id) {
        const { response: sessionResponse, payload } = await projectIo.fetchSession(request, job.session_id);
        if (generation !== state.importGeneration || state.activeImportJobId !== job.job_id) return;
        state.activeImportJobId = null;
        state.importInProgress = false;
        setImportCancelVisible(false);
        if (!sessionResponse.ok || !payload?.session) {
          throw new Error(payload?.detail || "The completed source session could not be opened.");
        }
        for (const phase of job.phase_history || []) gradeOpenStage("grade_open_backend_stage", {
          work_stage: phase.phase, duration_ms: phase.duration_ms,
        });
        const retainedProjectPath = selection.replaceSessionId ? state.projectPath : "";
        const gradeSession = selection.replaceSessionId ? payload.session : await window.HDRGradeSaving.open(payload.session, selection.itemKey, () => generation === state.importGeneration, recoveryChoice);
        if (generation !== state.importGeneration) return;
        gradeOpenStage("grade_open_attached");
        await activateDesktopSession(gradeSession, retainedProjectPath, generation, {openingJobId});
        if (generation !== state.importGeneration) return;
        gradeOpenStage("grade_open_controls");
        completed = true;
        finishGradeOpen();
        if (!selection.replaceSessionId) await recordSuccessfulMediaImport(selection.path);
        if (generation !== state.importGeneration) return;
        status.post({ id: "import", severity: "success", message: "Source imported." });
        return;
      }
      if (job.state === "error" || job.state === "cancelled") {
        state.activeImportJobId = null;
        state.importInProgress = false;
        setImportCancelVisible(false);
        if (job.state === "error") throw new Error(job.error || "The source file could not be opened.");
        else finishCancelledImport();
        return;
      }
      if (!firstPoll) await new Promise((resolve) => window.setTimeout(resolve, 250));
      firstPoll = false;
      const { response: poll, payload } = await projectIo.pollImportJob(request, job.job_id);
      job = payload;
      if (!poll.ok) {
        state.activeImportJobId = null;
        state.importInProgress = false;
        setImportCancelVisible(false);
        throw new Error(job?.detail || "Import progress could not be read.");
      }
    }
  } catch (error) {
    if (generation !== state.importGeneration) return;
    action?.finish("error", { level: "error", route: "refused", reason: "source_open_failed" });
    gradeOpenStage("grade_open_failed");
    if (!selection.replaceSessionId) {
      retireActiveSession();
      state.session = null;
      state.editDocument = null;
      state.documentDirty = false;
      clearPreviewImage();
      drawHistogram(null);
    }
    state.importInProgress = false;
    finishGradeOpen();
    if (selection.fromLibrary) activateWorkflowTab("import");
    showUploadError(error.message || `Could not open ${name}.`);
  } finally {
    action?.finish(completed ? "success" : "cancelled", completed ? {} : { route: "refused", reason: "source_open_cancelled" });
    if (!completed && openingJobId) void projectIo.cancelImportJob(fetch, openingJobId).catch(()=>{});
    if (generation === state.importGeneration) {
      state.importInProgress = false;
      state.activeImportJobId = null;
      setImportCancelVisible(false);
      finishGradeOpen();
      updateExportAvailability();
    }
  }
}

// stayOnTab: a background reload of the open photo (paste, outside change) keeps the current page.
async function activateDesktopSession(session, projectPath, openGeneration = null, { stayOnTab = false, openingJobId = null } = {}) {
  retireActiveSession(session.session_id);
  gradeOpening.reset(openingJobId);
  if (!stayOnTab) collapseGradeModules();
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
  if (!projectPath && !window.HDRGradeSaving?.hasGrade(session.session_id)) await applyNewSessionPreferences();
  if (openGeneration !== null && openGeneration !== state.importGeneration) return;
  state.gpuPreview?.resetSession(session.session_id);
  if(state.gpuPreview)state.gpuPreview.deferDenoiseWarm = true;
  invalidatePreview("hdr", { markDirty: false });
  invalidatePreview("sdr", { markDirty: false });
  activateWorkflowTab(stayOnTab ? state.activeWorkflow : "grade", { focus: false });
  renderSession();
  renderLocalAdjustments();
  seedExportFieldsFromSession();
  let gpuReady = await renderGpuDraft("hdr", { hideStatus: false, longEdge: settledProxyLongEdge() });
  if (openGeneration !== null && openGeneration !== state.importGeneration) return;
  // The first photo with a film stock waits for that stock's tables, and
  // their arrival re-renders the lane, superseding this draft. That is
  // cancellation, not a GPU failure: draw again on the GPU. Answering it with
  // the CPU preview took over two minutes for a 24 MP film-stock grade.
  if (!gpuReady && transientGpuRefusal()) {
    gpuReady = await renderGpuDraft("hdr", { hideStatus: false, longEdge: settledProxyLongEdge() });
    if (openGeneration !== null && openGeneration !== state.importGeneration) return;
  }
  // A second supersession means newer scheduled work will present the frame.
  const denoiseFallback = !gpuReady && !transientGpuRefusal() && state.denoise.hdr.enabled;
  if (!gpuReady && !transientGpuRefusal()) await refreshPreview({ progressSteps: [36, 76, 92], denoiseFallback });
  if (openGeneration !== null && openGeneration !== state.importGeneration) return;
  gradeOpenStage("grade_open_first_frame");
  if(state.gpuPreview)state.gpuPreview.deferDenoiseWarm = false;
  requestAnimationFrame(()=>{
    if(denoiseFallback || state.session?.session_id!==session.session_id)return;
    if(state.acceptedPresentation?.generation!==state.previewGeneration[state.currentView]
        ||state.acceptedPresentation?.lane!==state.currentView)return;
    const native = Math.max(session.source.width, session.source.height);
    void state.gpuPreview?.warmDenoiseModel?.(session.session_id, "hdr", native);
  });

  void Promise.all([
    refreshOverlay(),
    refreshScopes(scopeLongEdge("settled"), { tier: "settled" }),
  ]).catch(error => {
    if (state.session?.session_id === session.session_id) console.error("Photo analysis could not finish.", error);
  });
  if (openGeneration !== null && openGeneration !== state.importGeneration) return;
  if (!denoiseFallback && state.denoise.hdr.enabled) await recalculateDenoise();
  if (openGeneration !== null && openGeneration !== state.importGeneration) return;
  hidePreviewMessage();
  prepareInactivePreview();
  if (!denoiseFallback && previewNeedsRefinement()) debouncePreview("hdr");
  syncDesktopDocumentState();
  window.HDRGradeSaving?.activated(session, projectPath);
}

function documentTransitionToken() {
  return [
    state.session?.session_id || "",
    state.editRevision,
    state.globalEditGeneration,
    state.documentDirty ? "dirty" : "clean",
  ].join(":");
}

function rememberBrowserProject(path) {
  if (desktop) return;
  const projects = readBrowserRecentProjects().filter(item => item !== path);
  try { localStorage.setItem("hdr-finisher:recent-projects", JSON.stringify([path, ...projects].slice(0, 10))); }
  catch (error) { console.warn("The project could not be added to Recent projects.", error); }
}

function readBrowserRecentProjects() {
  try {
    const projects = JSON.parse(localStorage.getItem("hdr-finisher:recent-projects") || "[]");
    return Array.isArray(projects) ? projects.filter(path => typeof path === "string" && /\.hdrfinisher$/i.test(path)).slice(0, 10) : [];
  } catch { return []; }
}

async function showRecentProjects() {
  try {
    const projects = desktop ? await desktop.listRecentProjects() : readBrowserRecentProjects();
    const dialog = document.getElementById("recent-projects-dialog");
    const list = document.getElementById("recent-projects-list");
    list.replaceChildren();
    document.getElementById("recent-projects-empty").hidden = projects.length > 0;
    for (const path of projects) {
      const item = document.createElement("li"), button = document.createElement("button");
      button.type = "button";
      const name = document.createElement("strong"), location = document.createElement("span");
      name.textContent = path.split(/[/\\]/).pop(); location.textContent = path;
      button.append(name, location);
      button.addEventListener("click", async () => {
        dialog.close();
        try {
          const selection = desktop ? await desktop.grantProjectPath(path, "project-open") : { path };
          await openProjectFromPath(selection);
        } catch (error) { status.post({ id: "project-open", severity: "error", message: error.message }); }
      });
      item.append(button); list.append(item);
    }
    dialog.showModal();
  } catch (error) { status.post({ id: "project-open", severity: "error", message: error.message || "Recent projects could not be read." }); }
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
    const resumeGradeSaving = await window.HDRGradeSaving?.pauseForProjectOpen();
    try {
      if (openGeneration !== state.projectOpenGeneration) return;
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
      resumeGradeSaving?.();
      if (openGeneration === state.projectOpenGeneration) {
        window.clearInterval(statusTimer);
        els.projectOpen.disabled = false;
        if (!projectActivated) hidePreviewMessage();
        if (!projectActivated && status.get("project-open")?.severity === "progress") status.clear("project-open");
      }
    }
  }
  const path = desktopSelection?.path || await window.HDRDialogs.prompt(
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
  const resumeGradeSaving = await window.HDRGradeSaving?.pauseForProjectOpen();
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
    rememberBrowserProject(path);
    status.post({ id: "project-open", severity: "success", message: "Project opened." });
  } catch (error) {
    status.post({ id: "project-open", severity: "error", message: error?.message || "The project could not be opened." });
  } finally {
    resumeGradeSaving?.();
    window.clearInterval(statusTimer);
    hidePreviewMessage();
    if (status.get("project-open")?.severity === "progress") status.clear("project-open");
  }
}

async function saveProjectToPath({ saveAs = false } = {}) {
  if (!saveAs && window.HDRGradeSaving?.active()) return window.HDRGradeSaving.save();
  if (saveAs && window.HDRGradeSaving?.active()) return window.HDRGradeSaving.saveProject();
  return saveProjectFileToPath({ saveAs });
}

async function saveProjectFileToPath({ saveAs = false } = {}) {
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
  rememberBrowserProject(payload.path);
  state.editDocument = payload.document;
  loadDenoiseDocument(state.editDocument);
  state.documentDirty = false;
  syncCopySourcePathButton();
  syncProjectBadge();
  status.post({ id: "project-save", severity: "success", message: `Project saved · revision ${payload.revision}` });
  return true;
}

async function confirmUnsavedTransition(actionLabel) {
  if (window.HDRGradeSaving?.active()) return window.HDRGradeSaving.leave(actionLabel);
  return window.HDRPhotoTransition.leaveCurrentPhoto({
    dirty: Boolean(state.session && state.documentDirty),
    save: () => saveProjectToPath({ saveAs: false }),
    choose: async () => {
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
      return choice;
    },
  });
}

