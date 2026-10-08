function markGlobalEditDirty() {
  if (!state.session) return;
  state.globalEditDirty = true;
  state.globalEditGeneration += 1;
  state.documentDirty = true;
  syncProjectBadge();
  updateExportAvailability();
}

function beginGlobalEditGesture(control) {
  if (!state.session || control?.dataset.historyGestureActive === "true") return;
  if (control) control.dataset.historyGestureActive = "true";
  state.globalEditHistorySequence += 1;
  state.globalEditHistoryGroup = `slider-${state.globalEditHistorySequence}`;
}

function endGlobalEditGesture(control) {
  if (control?.dataset.historyGestureActive !== "true") return;
  delete control.dataset.historyGestureActive;
  const group = state.globalEditHistoryGroup;
  // Flush the final optimistic value while the group is still attached. Any
  // settled syncs emitted during this drag and this final sync collapse into
  // one backend HistoryEntry.
  void syncGlobalEditState().finally(() => {
    if (state.globalEditHistoryGroup === group) state.globalEditHistoryGroup = null;
  });
}

function recordAcknowledgedLocals(documentState) {
  const signatures = new Map();
  const signature = window.HDRWebGPUPreview?.spatialMaskSignature;
  if (signature) {
    const visit = (localId, expression, path) => {
      if (!expression) return;
      signatures.set(`${localId}|${path}`, signature(expression));
      (expression.children || []).forEach((child, index) => visit(localId, child, path ? `${path}.${index}` : String(index)));
    };
    for (const local of documentState?.local_adjustments || []) visit(local.id, local.mask, "");
  }
  state.acknowledgedMaskSignatures = signatures;
}

/** Acknowledged spatial signature, null for a local the backend has not seen. */
function acknowledgedMaskSignature(localId, maskPath = "") {
  if (!state.acknowledgedMaskSignatures) return undefined;
  return state.acknowledgedMaskSignatures.get(`${localId}|${maskPath || ""}`) ?? null;
}

function stablePreviewJson(value) {
  return JSON.stringify(value ?? null, (key, entry) => (entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((name) => [name, entry[name]]))
    : entry));
}

/**
 * `refreshPreview` is true (always re-render on success), false, or
 * "if-changed": re-render only when the acknowledged document changes what the
 * preview draws. The optimistic edit already rendered its own values, so an
 * acknowledgement that matches them has nothing new to show.
 */
function queueEditCommand(commandType, payload = {}, targetId = null, { refreshPreview = true, globalEditGeneration = null, historyGroup = null } = {}) {
  const sessionId = state.session?.session_id;
  if (commandType !== "set_global_adjustments" && state.globalEditDirty) {
    return syncGlobalEditState().then((applied) => state.session?.session_id === sessionId && applied && !state.globalEditDirty
      ? queueEditCommand(commandType, payload, targetId, { refreshPreview, globalEditGeneration, historyGroup })
      : false);
  }
  state.editCommandQueue = (state.editCommandQueue || Promise.resolve()).then(async () => {
    if (!sessionId || state.session?.session_id !== sessionId) return false;
    const response = await fetch(`/api/session/${state.session.session_id}/edit-commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [{ expected_revision: state.editRevision, command_type: commandType, target_id: targetId, history_group: historyGroup, payload }] }),
    });
    const result = await safeJson(response);
    if (state.session?.session_id !== sessionId) return false;
    if (response.status === 409) {
      await refreshEditState();
      throw new Error(result?.detail?.message || "The edit state changed in another request.");
    }
    if (!response.ok) throw new Error(result?.detail || "The local edit was rejected.");
    // Do not replace the object graph that a newer optimistic stroke is still
    // mutating. A response for an earlier queued commit otherwise detaches the
    // active gesture and can make its erase disappear on pointerup.
    const optimisticLocals = (state.localMaskCommitDepth > 0 || state.localPointerGesture)
      ? state.editDocument?.local_adjustments
      : null;
    const preserveNewerGlobalEdit = globalEditGeneration !== null
      && globalEditGeneration !== state.globalEditGeneration;
    const optimisticAdjustments = preserveNewerGlobalEdit ? state.adjustments : null;
    const draftGeometry = geometryDraftActive() ? state.adjustments.shared.geometry : null;
    const shownInputs = refreshPreview === "if-changed"
      ? stablePreviewJson([state.adjustments, state.editDocument?.local_adjustments]) : null;
    state.editRevision = result.revision;
    state.editDocument = result.document;
    recordAcknowledgedLocals(result.document);
    if (commandType === "replace_document") loadDenoiseDocument(state.editDocument);
    if (optimisticLocals) state.editDocument.local_adjustments = optimisticLocals;
    if (optimisticAdjustments) state.editDocument.global_adjustments = optimisticAdjustments;
    state.documentDirty = preserveNewerGlobalEdit || Boolean(result.dirty);
    state.adjustments = optimisticAdjustments || result.document.global_adjustments;
    if (draftGeometry) state.adjustments.shared.geometry = draftGeometry;
    if (state.geometryTransformHandoffSignature
      && state.geometryTransformHandoffSignature !== geometrySignature()) {
      state.geometryTransformHandoffSignature = null;
      clearRotateDraftTransformProperties();
      clearInteractiveStraightenPreview();
    }
    renderLocalAdjustments();
    if (commandType === "undo" || commandType === "redo" || commandType === "revert_rendition") {
      // History and revert responses replace the complete serialized edit document. Keep
      // the visible controls in the same transaction as the state and preview;
      // otherwise the pixels move while sliders retain their pre-history values.
      loadDenoiseDocument(state.editDocument);
      if (!localAdjustments().some((local) => local.id === state.selectedLocalId)) {
        state.selectedLocalId = localAdjustments()[0]?.id || null;
        renderLocalAdjustments();
      }
      els.hdrReferenceWhite.value = String(projectReferenceWhiteNits());
      renderLaneChrome();
      syncCurveControlsFromState();
      drawCurveEditor();
      drawToneEqualizerEditor(state.currentView);
      renderOverlayPresetNote();
      updateExportAvailability();
    }
    // A global-edit save used to
    // start a new render generation for values already on screen, both during
    // a drag (the scope pass saves) and after release, where it cost a
    // duplicate render and the settle debounce before the settled pass.
    const previewInputsChanged = refreshPreview === "if-changed"
      ? stablePreviewJson([state.adjustments, state.editDocument?.local_adjustments]) !== shownInputs
      : refreshPreview;
    if (previewInputsChanged) {
      invalidatePreview("hdr", { local: true });
      invalidatePreview("sdr", { local: true });
      debouncePreview(state.currentView);
    }
    if (status.get("edit")?.severity === "error") {
      status.post({ id: "edit", severity: "success", message: "Edits saved." });
    }
    return true;
  }).catch((error) => {
    console.error(error);
    status.post({ id: "edit", severity: "error", message: error.message });
    return false;
  });
  return state.editCommandQueue;
}

async function syncGlobalEditState() {
  if (!state.session) return true;
  const sessionId = state.session.session_id;
  // Perspective owns a transaction-local copy represented in the shared
  // adjustment object for transient previews. Never persist it before Apply.
  if (geometryDraftActive()) return true;
  if (!state.globalEditDirty) {
    const pending = state.globalEditSyncPending;
    if (!pending) return true;
    const applied = await pending;
    if (state.session?.session_id !== sessionId) return false;
    if (!applied) return false;
    return state.globalEditDirty || state.globalEditSyncPending ? syncGlobalEditState() : true;
  }
  state.globalEditDirty = false;
  const generation = state.globalEditGeneration;
  const historyGroup = state.globalEditHistoryGroup;
  const adjustments = JSON.parse(JSON.stringify(state.adjustments));
  // A plain global save only re-renders if the backend's document differs from
  // the optimistic values already drawn.
  const pending = queueEditCommand("set_global_adjustments", { adjustments }, null, {
    globalEditGeneration: generation, historyGroup, refreshPreview: "if-changed",
  });
  state.globalEditSyncPending = pending;
  const applied = await pending;
  if (state.session?.session_id !== sessionId) return false;
  if (state.globalEditSyncPending === pending) state.globalEditSyncPending = null;
  if (!applied) state.globalEditDirty = true;
  if (!applied && state.perspectiveApplyOperation?.signature === geometrySignature()) {
    setPerspectiveStatus("Perspective changes could not be saved. Try Reset again or review the edit error.", "failed");
  }
  if (!applied) return false;
  return state.globalEditDirty || state.globalEditSyncPending ? syncGlobalEditState() : true;
}

async function refreshEditState({ preserveLocalDraft = false } = {}) {
  if (!state.session) return;
  const sessionId = state.session.session_id;
  const optimisticLocals = preserveLocalDraft
    ? state.editDocument?.local_adjustments
    : null;
  const response = await fetch(`/api/session/${state.session.session_id}/edit-state`);
  const result = await safeJson(response);
  if (!response.ok || state.session?.session_id !== sessionId) return;
  const draftGeometry = geometryDraftActive() ? state.adjustments.shared.geometry : null;
  state.editRevision = result.revision;
  state.editDocument = result.document;
  recordAcknowledgedLocals(result.document);
  loadDenoiseDocument(state.editDocument);
  if (optimisticLocals) state.editDocument.local_adjustments = optimisticLocals;
  state.documentDirty = state.globalEditDirty || Boolean(result.dirty);
  state.adjustments = result.document.global_adjustments;
  if (draftGeometry) state.adjustments.shared.geometry = draftGeometry;
  // Rebuilding the active range input releases pointer capture. Keep the
  // existing control alive while its optimistic local object is still in use.
  if (!preserveLocalDraft) renderLocalAdjustments();
}

