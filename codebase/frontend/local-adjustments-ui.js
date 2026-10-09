function defaultLocalGrade() {
  return {
    enabled: true,
    exposure: 0,
    highlights: 0,
    midtones: 0,
    shadows: 0,
    blacks: 0,
    contrast: 0,
    contrast_pivot: 0.18,
    white_balance_kelvin: 6500,
    tint: 0,
    saturation: 0,
    vibrance: 0,
    luma_curve: defaultCurvePoints(),
    red_curve: defaultCurvePoints(),
    green_curve: defaultCurvePoints(),
    blue_curve: defaultCurvePoints(),
    color_grading: defaultColorGrading(),
    detail: { texture_amount: 0, clarity_amount: 0, clarity_radius_percent: 0.75, sharpen_amount: 0, sharpen_radius_px: 0.8, sharpen_threshold: 10 },
  };
}

function newMaskLeaf(type) {
  return maskExpression.createLeaf(type);
}

function newMaskExpression(type) {
  return maskExpression.createExpression(type, () => crypto.randomUUID());
}

function newLocalAdjustment(type, pending = null) {
  const number = (state.editDocument?.local_adjustments?.length || 0) + 1;
  return {
    id: pending?.id || crypto.randomUUID(),
    name: pending?.name || `Local Adjustment ${number}`,
    enabled: true,
    opacity: 1,
    mask: newMaskExpression(type),
    hdr_grade: defaultLocalGrade(),
    sdr_grade: defaultLocalGrade(),
  };
}

function localGizmoVisible(local = selectedLocal()) {
  return Boolean(local && !state.localHiddenGizmoIds.has(local.id));
}

function showLocalGizmo(local = selectedLocal()) {
  if (local) state.localHiddenGizmoIds.delete(local.id);
}

async function finishLocalPathDraft() {
  const draft = state.localPathDraft;
  if (!draft || draft.finishing) return false;
  const local = localAdjustments().find((item) => item.id === draft.localId);
  const leaf = selectedMaskLeaf(local, "path");
  if (!local || !leaf || leaf.nodes.length < 3) {
    cancelLocalPathDraft();
    return false;
  }
  draft.finishing = true;
  state.localPathCreatePendingId = local.id;
  state.localPathDraft = null;
  state.selectedPathNode = 0;
  renderLocalAdjustments();
  const created = draft.command === "update"
    ? await commitSelectedLocal()
    : await queueEditCommand("create_local", { local: JSON.parse(JSON.stringify(local)) });
  state.localPathCreatePendingId = null;
  if (!created) {
    if (draft.command === "update" && draft.previousMask) {
      local.mask = draft.previousMask;
      state.selectedSubMaskId = null;
    } else {
      const index = localAdjustments().findIndex((item) => item.id === local.id);
      if (index >= 0) localAdjustments().splice(index, 1);
      state.selectedLocalId = localAdjustments().at(-1)?.id || null;
    }
    renderLocalAdjustments();
  }
  return created;
}

function cancelLocalPathDraft() {
  const draft = state.localPathDraft;
  if (!draft) return;
  const local = localAdjustments().find((item) => item.id === draft.localId);
  if (draft.command === "update" && local && draft.previousMask) {
    local.mask = draft.previousMask;
    state.selectedSubMaskId = null;
  } else {
    const index = localAdjustments().findIndex((item) => item.id === draft.localId);
    if (index >= 0) localAdjustments().splice(index, 1);
    state.selectedLocalId = localAdjustments().at(-1)?.id || null;
  }
  state.localPathDraft = null;
  state.localPointerGesture = null;
  state.selectedPathNode = null;
  renderLocalAdjustments();
}

function beginPendingLocalAdjustment() {
  if (state.pendingLocalAdjustment) return state.pendingLocalAdjustment;
  const currentLocal = selectedLocal();
  const number = localAdjustments().length + 1;
  state.pendingLocalAdjustment = {
    id: crypto.randomUUID(),
    name: `Local Adjustment ${number}`,
  };
  state.pendingSubMask = null;
  // Keep the existing editor mounted while the new row waits for a mask
  // choice. Collapsing it makes the entire grade rail jump to a new scroll
  // position even though only the adjustment stack changed.
  if (!currentLocal) state.selectedLocalId = state.pendingLocalAdjustment.id;
  state.selectedSubMaskId = null;
  state.localTool = null;
  return state.pendingLocalAdjustment;
}

function beginPendingSubMask(local) {
  if (!local) return null;
  const ordinal = subMaskRows(local.mask).length + 1;
  state.pendingSubMask = {
    id: crypto.randomUUID(),
    parentLocalId: local.id,
    name: `Sub-mask ${ordinal}`,
  };
  state.pendingLocalAdjustment = null;
  state.selectedLocalId = local.id;
  state.selectedSubMaskId = state.pendingSubMask.id;
  state.localCreationTool = null;
  state.localTool = null;
  renderLocalAdjustments();
  return state.pendingSubMask;
}

async function assignToolToPending(type) {
  if (!state.editDocument) await refreshEditState();
  if (!state.editDocument) return false;
  state.localCreationTool = null;
  state.localTool = type;
  state.localErase = false;
  if (["brush", "linear_gradient", "luminance_range"].includes(type)) state.localShowMask = true;

  if (state.pendingSubMask) {
    const pending = state.pendingSubMask;
    const local = localAdjustments().find((item) => item.id === pending.parentLocalId);
    if (!local) return false;
    const previousMask = JSON.parse(JSON.stringify(local.mask));
    const expression = newMaskExpression(type);
    const wrapper = {
      id: pending.id,
      enabled: true,
      operator: "union",
      leaf: null,
      children: [local.mask, expression],
      inverted: false,
    };
    local.mask = wrapper;
    state.pendingSubMask = null;
    state.selectedLocalId = local.id;
    showLocalGizmo(local);
    state.selectedSubMaskId = wrapper.id;
    if (type === "path") {
      state.localPathDraft = { localId: local.id, command: "update", previousMask, finishing: false };
      state.localPathEditMode = "path";
      state.selectedPathNode = null;
      state.localShowMask = true;
      renderLocalAdjustments();
      els.localMaskOverlay?.focus({ preventScroll: true });
      return true;
    }
    renderLocalAdjustments();
    await commitSelectedLocal();
    return true;
  }

  const pending = state.pendingLocalAdjustment || beginPendingLocalAdjustment();
  const local = newLocalAdjustment(type, pending);
  state.pendingLocalAdjustment = null;
  state.selectedLocalId = local.id;
  showLocalGizmo(local);
  state.selectedSubMaskId = null;
  setGradeMode("local");
  if (type === "path") {
    state.editDocument.local_adjustments.push(local);
    state.localPathDraft = { localId: local.id, command: "create", finishing: false };
    state.localPathEditMode = "path";
    state.selectedPathNode = null;
    state.localShowMask = true;
    renderLocalAdjustments();
    els.localMaskOverlay?.focus({ preventScroll: true });
    return true;
  }
  const created = await queueEditCommand("create_local", { local });
  if (!created) state.selectedLocalId = localAdjustments()[0]?.id || null;
  renderLocalAdjustments();
  return created;
}

function bindLocalAdjustmentEvents() {
  els.gradeModeGlobal?.addEventListener("click", () => setGradeMode("global"));
  els.localToolButtons.forEach((button) => button.addEventListener("click", async () => {
    if (state.localPathDraft) await finishLocalPathDraft();
    if (!state.session) {
      status.post({ id: "edit", severity: "attention", message: "Load an image before creating a local adjustment." });
      if (els.localEmpty) els.localEmpty.textContent = "Load an image, then choose a mask tool to create the first local adjustment.";
      updateLocalToolState();
      return;
    }
    const type = button.dataset.localTool;
    if (state.pendingLocalAdjustment || state.pendingSubMask) {
      await assignToolToPending(type);
      return;
    }
    state.localCreationTool = type;
    state.localErase = false;
    updateLocalToolState();
  }));
  els.localEraser?.addEventListener("click", () => {
    if (els.localEraser.disabled) return;
    state.localErase = !state.localErase;
    updateLocalToolState();
  });
  els.localGizmoToggle?.addEventListener("click", () => {
    const local = selectedLocal();
    if (!local) return;
    if (localGizmoVisible(local)) {
      state.localHiddenGizmoIds.add(local.id);
      state.localPointerGesture = null;
      state.localBrushCursor = null;
      state.localPathCursor = null;
      state.hoveredPathTarget = null;
    } else {
      showLocalGizmo(local);
    }
    renderLocalAdjustments();
  });
  els.localAdjustmentList?.addEventListener("click", async (event) => {
    const bypassButton = event.target.closest("button[data-local-bypass-id]");
    if (bypassButton) {
      const local = localAdjustments().find((item) => item.id === bypassButton.dataset.localBypassId);
      if (!local) return;
      local.enabled = !local.enabled;
      renderLocalAdjustments();
      queueLocalMaskOverlayRender();
      // Bypass changes graph participation, not mask pixels. Present the GPU
      // change immediately and persist it in parallel instead of making the
      // viewer wait for the edit-command round trip first.
      scheduleLocalPreview();
      const committed = await queueEditCommand(
        "update_local",
        { local: JSON.parse(JSON.stringify(local)) },
        local.id,
        { refreshPreview: false },
      );
      if (committed) state.localPreviewDirty = false;
      return;
    }
    const subMaskBypassButton = event.target.closest("button[data-sub-mask-bypass-id]");
    if (subMaskBypassButton) {
      const local = localAdjustments().find((item) => item.id === subMaskBypassButton.dataset.localId);
      const entry = subMaskEntry(local, subMaskBypassButton.dataset.subMaskBypassId);
      if (!local || !entry) return;
      entry.container.enabled = entry.container.enabled === false;
      state.selectedLocalId = local.id;
      state.selectedSubMaskId = entry.id;
      renderLocalAdjustments();
      queueLocalMaskOverlayRender();
      await commitSelectedLocal();
      return;
    }
    const menuAction = event.target.closest("button[data-local-menu-action]");
    if (menuAction) {
      state.selectedLocalId = menuAction.dataset.localId;
      state.selectedSubMaskId = menuAction.dataset.subMaskId || null;
      state.localAdjustmentMenuId = null;
      renderLocalAdjustments();
      if (menuAction.dataset.localMenuAction === "add-sub-mask") beginPendingSubMask(selectedLocal());
      if (menuAction.dataset.localMenuAction === "set-sub-mask-blend") {
        const entry = subMaskEntry(selectedLocal(), menuAction.dataset.subMaskId);
        if (entry) {
          entry.container.operator = menuAction.dataset.blendMode;
          await commitSelectedLocal();
        }
      }
      return;
    }
    const menuButton = event.target.closest("button[data-local-menu-id]");
    if (menuButton) {
      const localId = menuButton.dataset.localMenuId;
      state.selectedLocalId = localId;
      state.selectedSubMaskId = menuButton.dataset.subMaskId || null;
      state.localCreationTool = null;
      state.localTool = selectedMaskLeaf()?.type || null;
      const menuId = state.selectedSubMaskId || localId;
      state.localAdjustmentMenuId = state.localAdjustmentMenuId === menuId ? null : menuId;
      renderLocalAdjustments();
      return;
    }
    const button = event.target.closest("button[data-local-id]");
    if (!button) return;
    const localId = button.dataset.localId;
    const subMaskId = button.dataset.subMaskId || null;
    const selectionChanged = state.selectedLocalId !== localId || state.selectedSubMaskId !== subMaskId;
    state.selectedLocalId = localId;
    state.selectedSubMaskId = subMaskId;
    state.localCreationTool = null;
    state.localTool = selectedMaskLeaf()?.type || null;
    state.localAdjustmentMenuId = null;
    if (!subMaskId && event.detail >= 2 && localAdjustments().some((item) => item.id === localId)) {
      state.localRenameId = localId;
      renderLocalAdjustments();
      return;
    }
    state.localRenameId = null;
    if (selectionChanged) renderLocalAdjustments();
  });
  els.localAdjustmentList?.addEventListener("dblclick", (event) => {
    if (event.target.closest("input, .local-adjustment-bypass, .local-adjustment-menu-button")) return;
    const button = event.target.closest("button[data-local-id]:not([data-sub-mask-id])");
    if (!button || !localAdjustments().some((item) => item.id === button.dataset.localId)) return;
    state.selectedLocalId = button.dataset.localId;
    state.selectedSubMaskId = null;
    state.localRenameId = button.dataset.localId;
    renderLocalAdjustments();
  });
  document.addEventListener("pointerdown", (event) => {
    if (state.localPathDraft && !event.target.closest("#local-mask-overlay")) void finishLocalPathDraft();
    if (!state.localAdjustmentMenuId || event.target.closest(".local-adjustment-menu, .local-adjustment-menu-button")) return;
    state.localAdjustmentMenuId = null;
    renderLocalAdjustments();
  });
  document.addEventListener("keydown", (event) => {
    if (state.localPathDraft && event.key === "Escape") {
      event.preventDefault();
      cancelLocalPathDraft();
      return;
    }
    if (state.localPathDraft && event.key === "Enter") {
      event.preventDefault();
      void finishLocalPathDraft();
      return;
    }
    if (event.key !== "Escape" || !state.localAdjustmentMenuId) return;
    state.localAdjustmentMenuId = null;
    renderLocalAdjustments();
  });
  els.localLaneButtons.forEach((button) => button.addEventListener("click", () => {
    void switchLane(button.dataset.localLane);
  }));
  els.localOpacity?.addEventListener("input", () => {
    const local = selectedLocal();
    if (!local) return;
    local.opacity = Number(els.localOpacity.value);
    els.localOpacityValue.textContent = `${Math.round(local.opacity * 100)}%`;
    els.localOpacity.closest(".control-row")?.classList.toggle("modified", Math.abs(local.opacity - 1) > 1e-8);
    scheduleLocalPreview();
  });
  els.localOpacity?.addEventListener("change", () => commitSelectedLocal({ refreshPreview: false }));
  bindLocalPreviewInteraction(els.localOpacity);
  els.localGradeControls.forEach((control) => {
    control.addEventListener("input", () => {
      const local = selectedLocal();
      if (!local) return;
      setValueByPath(local[`${state.currentView}_grade`], control.dataset.localGrade, Number(control.value));
      updateLocalGradeOutput(control.dataset.localGrade, Number(control.value));
      hideLocalMaskOverlayForGradePreview();
      scheduleLocalPreview();
    });
    control.addEventListener("change", () => commitSelectedLocal({ refreshPreview: false }));
    bindLocalPreviewInteraction(control);
  });
  els.localDuplicate?.addEventListener("click", async () => {
    const local = selectedLocal();
    if (!local) return;
    const copy = JSON.parse(JSON.stringify(local));
    copy.id = crypto.randomUUID();
    regenerateMaskExpressionIds(copy.mask);
    copy.name = `${local.name} copy`;
    const index = localAdjustments().findIndex((item) => item.id === local.id) + 1;
    state.selectedLocalId = copy.id;
    await queueEditCommand("create_local", { local: copy, index });
  });
  els.localAddAdjustment?.addEventListener("click", async () => {
    if (!state.session) return;
    const gradeRail = els.localPanel?.closest(".grade-rail");
    const scrollTop = gradeRail?.scrollTop ?? 0;
    beginPendingLocalAdjustment();
    const type = state.localCreationTool;
    if (type) await assignToolToPending(type);
    renderLocalAdjustments();
    const restoreScroll = () => {
      if (gradeRail) gradeRail.scrollTop = scrollTop;
    };
    restoreScroll();
    requestAnimationFrame(() => {
      restoreScroll();
      requestAnimationFrame(restoreScroll);
    });
  });
  els.localInvert?.addEventListener("click", () => {
    const local = selectedLocal();
    if (!local) return;
    const expression = selectedMaskExpression(local);
    if (!expression) return;
    expression.inverted = !expression.inverted;
    if (gpuLumaMaskPreviewActive(local)) scheduleLocalPreview();
    commitSelectedLocal();
  });
  els.localDelete?.addEventListener("click", async () => {
    if (state.pendingLocalAdjustment) {
      state.pendingLocalAdjustment = null;
      if (!selectedLocal()) state.selectedLocalId = localAdjustments()[0]?.id || null;
      renderLocalAdjustments();
      return;
    }
    if (state.pendingSubMask && state.selectedSubMaskId === state.pendingSubMask.id) {
      state.pendingSubMask = null;
      state.selectedSubMaskId = null;
      renderLocalAdjustments();
      return;
    }
    const local = selectedLocal();
    if (!local) return;
    if (state.selectedSubMaskId) {
      const entry = subMaskEntry(local, state.selectedSubMaskId);
      if (!entry) return;
      local.mask = replaceMaskExpression(local.mask, entry.container.id, entry.container.children[0]);
      state.selectedSubMaskId = null;
      state.localTool = firstMaskLeaf(local.mask)?.type || null;
      renderLocalAdjustments();
      await commitSelectedLocal();
      return;
    }
    localBrushMaskCanvasCache.delete(local.id);
    localBrushMaskCanvasCache.delete(local.mask);
    localAuthoritativeMaskCache.delete(local.id);
    for (const [key, pending] of localAuthoritativeMaskRequests) {
      if (!key.includes(`:${local.id}:`)) continue;
      pending.controller?.abort();
      localAuthoritativeMaskRequests.delete(key);
    }
    for (const [slot, pending] of localComparisonMaskRequests) {
      if (!slot.startsWith(`${local.id}:`)) continue;
      window.clearTimeout(pending.timer);
      pending.controller?.abort();
      localComparisonMaskRequests.delete(slot);
    }
    for (const slot of localComparisonMaskCache.keys()) {
      if (slot.startsWith(`${local.id}:`)) localComparisonMaskCache.delete(slot);
    }
    localComparisonCompositeCache.clear();
    await queueEditCommand("delete_local", {}, local.id);
    state.selectedLocalId = localAdjustments()[0]?.id || null;
    state.selectedSubMaskId = null;
    renderLocalAdjustments();
  });
  els.localMoveUp?.addEventListener("click", () => moveSelectedLocal(-1));
  els.localMoveDown?.addEventListener("click", () => moveSelectedLocal(1));
  els.localShowMask?.addEventListener("click", () => {
    state.localShowMask = !state.localShowMask;
    if (gpuLumaMaskPreviewActive()) scheduleLocalPreview();
    renderLocalAdjustments();
  });
  els.localOverlayColorButton?.addEventListener("click", () => {
    if (typeof els.localOverlayColorInput?.showPicker === "function") els.localOverlayColorInput.showPicker();
    else els.localOverlayColorInput?.click();
  });
  els.localOverlayColorInput?.addEventListener("input", () => {
    state.localOverlayColor = els.localOverlayColorInput.value.toLowerCase();
    if (els.localOverlayColorSwatch) els.localOverlayColorSwatch.style.backgroundColor = state.localOverlayColor;
    if (gpuLumaMaskPreviewActive()) scheduleLocalPreview();
    queueLocalMaskOverlayRender();
  });
  bindLocalMaskCanvas();
}

function setGradeMode(mode) {
  state.gradeMode = mode === "local" ? "local" : "global";
  document.body.dataset.gradeMode = state.gradeMode;
  els.gradeModeGlobal?.classList.toggle("active", state.gradeMode === "global");
  els.gradeModeLocal?.classList.toggle("active", state.gradeMode === "local");
  els.gradeModeGlobal?.setAttribute("aria-pressed", String(state.gradeMode === "global"));
  if (els.localAdjustmentGroup) {
    const localActive = state.gradeMode === "local";
    els.localAdjustmentGroup.classList.toggle("collapsed", !localActive);
    els.gradeModeLocal?.setAttribute("aria-expanded", String(localActive));
  }
  if (state.gradeMode === "local") void ensureGeometryCoordinateMap();
  renderLocalMaskOverlay();
}

function updateLocalToolState() {
  const local = selectedLocal();
  const assignedType = selectedMaskLeaf(local)?.type || null;
  const displayedType = state.localCreationTool || assignedType;
  const brushSelected = assignedType === "brush";
  const toolLocked = Boolean(assignedType && !state.pendingLocalAdjustment && !state.pendingSubMask);
  els.localToolButtons.forEach((button) => {
    const active = button.dataset.localTool === displayedType;
    button.classList.toggle("active", active);
    button.classList.toggle("queued", Boolean(state.localCreationTool && active));
    button.setAttribute("aria-pressed", String(active));
    button.disabled = toolLocked;
    if (!button.dataset.creationTitle) button.dataset.creationTitle = button.title;
    button.title = toolLocked
      ? (active
        ? `${localMaskTypeLabel(assignedType)} is locked to this mask`
        : `Create a new adjustment or sub-mask to use ${localMaskTypeLabel(button.dataset.localTool)}`)
      : button.dataset.creationTitle;
  });
  if (els.localEraser) {
    els.localEraser.disabled = !brushSelected;
    if (!brushSelected) state.localErase = false;
    els.localEraser.classList.toggle("active", state.localErase);
    els.localEraser.setAttribute("aria-pressed", String(state.localErase));
  }
}

function localAdjustments() {
  return state.editDocument?.local_adjustments || [];
}

function selectedLocal() {
  return localAdjustments().find((item) => item.id === state.selectedLocalId) || null;
}

function subMaskRows(expression, rows = []) {
  return maskExpression.subMaskRows(expression, rows);
}

function subMaskEntry(local, id) {
  return maskExpression.subMaskEntry(local, id);
}

function selectedChildMaskParts(local = selectedLocal()) {
  if (!local || !state.selectedSubMaskId) return null;
  if (state.pendingSubMask?.id === state.selectedSubMaskId) {
    return {
      id: state.pendingSubMask.id,
      parent: local.mask,
      child: null,
    };
  }
  const entry = subMaskEntry(local, state.selectedSubMaskId);
  if (!entry) return null;
  return {
    id: entry.id,
    parent: entry.container.children?.[0] || null,
    child: entry.expression,
  };
}

function selectedMaskExpression(local = selectedLocal()) {
  if (!local) return null;
  if (state.selectedSubMaskId) return subMaskEntry(local, state.selectedSubMaskId)?.expression || null;
  return parentMaskExpression(local.mask);
}

function parentMaskExpression(expression) {
  return maskExpression.parentExpression(expression);
}

function selectedMaskLeaf(local = selectedLocal(), type = null) {
  return firstMaskLeaf(selectedMaskExpression(local), type);
}

function replaceMaskExpression(expression, targetId, replacement) {
  return maskExpression.replaceExpression(expression, targetId, replacement);
}

function regenerateMaskExpressionIds(expression) {
  maskExpression.regenerateIds(expression, () => crypto.randomUUID());
}

function finishInlineLocalRename(local, input, { cancel = false } = {}) {
  if (!local || input.dataset.finished === "true") return;
  input.dataset.finished = "true";
  const name = input.value.trim();
  state.localRenameId = null;
  if (!cancel && name && name !== local.name) {
    local.name = name;
    renderLocalAdjustments();
    void commitSelectedLocal();
    return;
  }
  renderLocalAdjustments();
}

function createLocalAdjustmentCopy({ title, subtitle }) {
  const copy = document.createElement("span");
  copy.className = "local-adjustment-copy";
  const name = document.createElement("span");
  name.textContent = title;
  copy.append(name);
  const detail = document.createElement("small");
  detail.textContent = subtitle;
  copy.append(detail);
  return copy;
}

function appendInlineLocalRenameEditor(item, local) {
  if (!item || !local || state.localRenameId !== local.id) return;
  const input = document.createElement("input");
  input.className = "local-adjustment-name-input";
  input.type = "text";
  input.value = local.name;
  input.setAttribute("aria-label", "Local adjustment name");
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("dblclick", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finishInlineLocalRename(local, input);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishInlineLocalRename(local, input, { cancel: true });
    }
  });
  input.addEventListener("blur", () => finishInlineLocalRename(local, input));
  item.append(input);
  requestAnimationFrame(() => {
    if (!input.isConnected) return;
    input.focus({ preventScroll: true });
    input.select();
  });
}

function renderLocalAdjustments() {
  if (!els.localAdjustmentList) return;
  const locals = localAdjustments();
  if (!state.selectedLocalId && locals.length) state.selectedLocalId = locals[0].id;
  const validMenuIds = new Set(locals.flatMap((local) => [local.id, ...subMaskRows(local.mask).map((entry) => entry.id)]));
  if (state.localAdjustmentMenuId && !validMenuIds.has(state.localAdjustmentMenuId)) {
    state.localAdjustmentMenuId = null;
  }
  if (state.localRenameId && !locals.some((local) => local.id === state.localRenameId)) {
    state.localRenameId = null;
  }
  els.localAdjustmentList.innerHTML = "";
  const appendRow = (local, { subMask = null, pending = null } = {}) => {
    let openMenu = null;
    const item = document.createElement("li");
    item.className = "local-adjustment-item";
    item.classList.toggle("is-sub-mask", Boolean(subMask || pending?.parentLocalId));
    item.classList.toggle("is-pending", Boolean(pending));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "local-adjustment-select";
    button.dataset.localId = local?.id || pending?.id;
    if (subMask) button.dataset.subMaskId = subMask.id;
    if (pending?.parentLocalId) {
      button.dataset.localId = pending.parentLocalId;
      button.dataset.subMaskId = pending.id;
    }
    const active = pending
      ? (pending.parentLocalId ? state.selectedSubMaskId === pending.id : state.pendingLocalAdjustment?.id === pending.id)
      : local?.id === state.selectedLocalId
        && !(!subMask && state.pendingLocalAdjustment)
        && (subMask ? subMask.id === state.selectedSubMaskId : !state.selectedSubMaskId);
    button.classList.toggle("active", active);
    const leaf = subMask ? firstMaskLeaf(subMask.expression) : firstMaskLeaf(local?.mask);
    const title = pending?.name || (subMask ? `Sub-mask ${subMaskRows(local.mask).findIndex((entry) => entry.id === subMask.id) + 1}` : local.name);
    const subtitle = pending ? "Pick a tool" : localMaskTypeLabel(leaf?.type || "mask");
    button.append(createLocalAdjustmentCopy({ title, subtitle }));
    if (pending) {
      els.localAdjustmentList.append(item);
      item.append(button);
      return;
    }
    const bypassButton = document.createElement("button");
    bypassButton.type = "button";
    bypassButton.className = "local-adjustment-bypass";
    const enabled = subMask ? subMask.container.enabled !== false : local.enabled !== false;
    bypassButton.classList.toggle("bypassed", !enabled);
    bypassButton.dataset.localId = local.id;
    if (subMask) bypassButton.dataset.subMaskBypassId = subMask.id;
    else bypassButton.dataset.localBypassId = local.id;
    bypassButton.setAttribute("aria-label", `${enabled ? "Bypass" : "Show"} ${title}`);
    bypassButton.setAttribute("aria-pressed", String(!enabled));
    bypassButton.title = `${enabled ? "Bypass" : "Show"} ${title}`;
    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "local-adjustment-menu-button";
    menuButton.dataset.localMenuId = local.id;
    if (subMask) menuButton.dataset.subMaskId = subMask.id;
    menuButton.setAttribute("aria-label", `More actions for ${title}`);
    menuButton.setAttribute("aria-haspopup", "menu");
    const menuId = subMask?.id || local.id;
    menuButton.setAttribute("aria-expanded", String(state.localAdjustmentMenuId === menuId));
    menuButton.title = `More actions for ${title}`;
    menuButton.textContent = "⋯";
    item.append(button, bypassButton, menuButton);
    if (!subMask) appendInlineLocalRenameEditor(item, local);
    if (state.localAdjustmentMenuId === menuId) {
      const menu = document.createElement("div");
      menu.className = "local-adjustment-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", `Actions for ${title}`);
      if (subMask) {
        [
          ["union", "Union"],
          ["intersect", "Intersection"],
          ["subtract", "Subtract"],
        ].forEach(([mode, label]) => {
          const action = document.createElement("button");
          action.type = "button";
          action.setAttribute("role", "menuitemradio");
          action.setAttribute("aria-checked", String(subMask.container.operator === mode));
          action.dataset.localMenuAction = "set-sub-mask-blend";
          action.dataset.localId = local.id;
          action.dataset.subMaskId = subMask.id;
          action.dataset.blendMode = mode;
          action.textContent = label;
          menu.append(action);
        });
      } else {
        const addMask = document.createElement("button");
        addMask.type = "button";
        addMask.setAttribute("role", "menuitem");
        addMask.dataset.localMenuAction = "add-sub-mask";
        addMask.dataset.localId = local.id;
        addMask.textContent = "Create sub-mask";
        menu.append(addMask);
      }
      item.append(menu);
      openMenu = menu;
    }
    els.localAdjustmentList.append(item);
    if (openMenu) positionLocalAdjustmentMenu(openMenu, menuButton);
  };
  locals.forEach((local) => {
    appendRow(local);
    subMaskRows(local.mask).forEach((subMask) => appendRow(local, { subMask }));
    if (state.pendingSubMask?.parentLocalId === local.id) appendRow(local, { pending: state.pendingSubMask });
  });
  if (state.pendingLocalAdjustment) appendRow(null, { pending: state.pendingLocalAdjustment });
  const local = selectedLocal();
  const hasRows = Boolean(locals.length || state.pendingLocalAdjustment);
  els.localEmpty?.classList.toggle("hidden", hasRows);
  if (!hasRows && els.localEmpty) {
    els.localEmpty.textContent = state.session
      ? "Choose a mask tool, then press + — or press + first and pick a tool."
      : "Load an image to create the first local adjustment.";
  }
  const pendingSelected = state.pendingLocalAdjustment?.id === state.selectedLocalId
    || state.pendingSubMask?.id === state.selectedSubMaskId;
  els.localEditor?.classList.toggle("hidden", !local || pendingSelected);
  els.localMaskFooterActions?.classList.toggle("hidden", !local || pendingSelected);
  const selectedIndex = local ? locals.findIndex((item) => item.id === local.id) : -1;
  if (els.localAddAdjustment) els.localAddAdjustment.disabled = !state.session;
  if (els.localDuplicate) els.localDuplicate.disabled = !local || Boolean(state.selectedSubMaskId);
  if (els.localDelete) els.localDelete.disabled = !local && !pendingSelected;
  if (els.localMoveUp) els.localMoveUp.disabled = !local || Boolean(state.selectedSubMaskId) || selectedIndex <= 0;
  if (els.localMoveDown) els.localMoveDown.disabled = !local || Boolean(state.selectedSubMaskId) || selectedIndex >= locals.length - 1;
  if (els.projectSave) {
    els.projectSave.disabled = !state.session;
    els.projectSave.textContent = state.documentDirty ? "Save project *" : "Save project";
  }
  syncDesktopDocumentState();
  if (local && !pendingSelected) {
    const gizmoVisible = localGizmoVisible(local);
    if (els.localGizmoToggle) {
      els.localGizmoToggle.textContent = gizmoVisible ? "Hide gizmo" : "Show gizmo to edit";
      els.localGizmoToggle.setAttribute("aria-pressed", String(!gizmoVisible));
    }
    els.localOpacity.value = String(local.opacity);
    els.localOpacityValue.textContent = `${Math.round(local.opacity * 100)}%`;
    els.localOpacity.closest(".control-row")?.classList.toggle("modified", Math.abs(Number(local.opacity) - 1) > 1e-8);
    const expression = selectedMaskExpression(local);
    const brushLeaf = firstMaskLeaf(expression, "brush");
    els.localInvert.setAttribute("aria-pressed", String(Boolean(expression?.inverted)));
    els.localInvert.textContent = expression?.inverted ? "Restore mask" : "Invert mask";
    els.localInvert.disabled = Boolean(brushLeaf && !(brushLeaf.strokes || []).length);
    syncLocalMaskOverlayControl();
    els.localLaneButtons.forEach((button) => {
      const active = button.dataset.localLane === state.currentView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const grade = local[`${state.currentView}_grade`];
    els.localGradeControls.forEach((control) => {
      control.value = String(getValueByPath(grade, control.dataset.localGrade));
      updateLocalGradeOutput(control.dataset.localGrade, Number(control.value));
    });
    renderMaskTreeEditor(local);
  } else if (els.localMaskTreeSummary) {
    els.localMaskTreeSummary.textContent = "";
    if (els.localGradientControls) {
      els.localGradientControls.textContent = "";
      els.localGradientControls.classList.add("hidden");
    }
  }
  // Selection and HDR/SDR lane changes assign range values programmatically.
  // Keep the shared track/fill component attached to the native thumb instead
  // of retaining the previous local adjustment's visual position.
  syncRangeVisuals(els.localEditor);
  bindSliderReadouts(els.localAdjustmentGroup);
  updateLocalToolState();
  renderLocalMaskOverlay();
}

function positionLocalAdjustmentMenu(menu, anchor) {
  if (!menu?.isConnected || !anchor?.isConnected) return;
  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const viewportPadding = 8;
  const gap = 4;
  const left = clamp(
    anchorRect.right - menuRect.width,
    viewportPadding,
    Math.max(viewportPadding, window.innerWidth - menuRect.width - viewportPadding),
  );
  const spaceBelow = window.innerHeight - anchorRect.bottom - viewportPadding;
  const top = spaceBelow >= menuRect.height + gap
    ? anchorRect.bottom + gap
    : Math.max(viewportPadding, anchorRect.top - menuRect.height - gap);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function localMaskTypeLabel(type) {
  return ({
    brush: "Brush",
    linear_gradient: "Linear gradient",
    luminance_range: "Luma range",
    path: "Path",
  })[type] || type.replaceAll("_", " ");
}

function updateLocalGradeOutput(name, value) {
  const control = els.localGradeControls.find((candidate) => candidate.dataset.localGrade === name);
  let output = els.localGradeOutputs.find((candidate) => candidate.dataset.localGradeOutput === name);
  if (!output) {
    const heading = control?.closest(".control-row")?.querySelector(".control-heading");
    if (!heading) return;
    output = document.createElement("output");
    output.dataset.localGradeOutput = name;
    heading.append(output);
    els.localGradeOutputs.push(output);
  }
  if (name === "exposure") output.textContent = `${value.toFixed(2)} EV`;
  else if (name === "white_balance_kelvin") output.textContent = `${Math.round(value)} K`;
  else if (name.endsWith("clarity_radius_percent")) output.textContent = `${value.toFixed(2)}%`;
  else if (name.endsWith("sharpen_radius_px")) output.textContent = `${value.toFixed(2)} px`;
  else output.textContent = Math.abs(value) < 0.005 ? "0" : value.toFixed(2);
  const defaultValue = Number(control?.dataset.defaultValue ?? control?.defaultValue);
  control?.closest(".control-row")?.classList.toggle(
    "modified",
    Number.isFinite(defaultValue) && Math.abs(value - defaultValue) > 1e-8,
  );
}

function syncLocalMaskOverlayControl() {
  if (!els.localShowMask) return;
  const available = selectedLocal()?.enabled !== false;
  const visible = state.localShowMask && available;
  els.localShowMask.disabled = !available;
  els.localShowMask.setAttribute("aria-pressed", String(visible));
  els.localShowMask.innerHTML = `<span class="local-overlay-icon" aria-hidden="true"></span><span>${visible ? "Hide overlay" : "Show overlay"}</span>`;
}

function hideLocalMaskOverlayForGradePreview() {
  if (!state.localShowMask) return;
  state.localShowMask = false;
  syncLocalMaskOverlayControl();
  if (gpuLumaMaskPreviewActive()) scheduleLocalPreview();
  queueLocalMaskOverlayRender();
}

function bindLocalPreviewInteraction(control) {
  if (!control || control.dataset.previewInteractionBound === "true") return;
  control.dataset.previewInteractionBound = "true";
  control.addEventListener("pointerdown", () => {
    beginLocalDetailInteraction(control);
    state.previewScheduler?.beginInteraction();
  });
  ["pointerup", "pointercancel", "change"].forEach((eventName) => {
    control.addEventListener(eventName, () => state.previewScheduler?.endInteraction());
  });
  control.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      beginLocalDetailInteraction(control);
      state.previewScheduler?.beginInteraction();
    }
  });
  control.addEventListener("keyup", () => state.previewScheduler?.endInteraction());
}

function scheduleLocalPreview({ spatialMaskChanged = false } = {}) {
  if (!state.session) return;
  state.localPreviewDirty = true;
  invalidatePreview("hdr", { local: true });
  invalidatePreview("sdr", { local: true });
  // Structural mask drafts keep the previous image until an exact current mask
  // exists, but still use the shared scheduler for live reduced scopes.
  if (spatialMaskChanged) state.localMaskDraftDirty = true;
  debouncePreview(state.currentView);
}

function gpuLumaMaskPreviewActive(local = selectedLocal()) {
  return Boolean(
    state.gpuPreview?.available
    && local?.mask?.operator === "leaf"
    && local.mask.leaf?.type === "luminance_range"
    && (!local.mask.children || local.mask.children.length === 0)
    && valuesEqual(state.adjustments.shared?.geometry, defaultGeometry()),
  );
}

function scheduleSpatialMaskPreview(local) {
  if (gpuLumaMaskPreviewActive(local)) {
    scheduleLocalPreview();
    return;
  }
  if (!state.selectedSubMaskId && state.gpuPreview?.supportsLiveGradientMask?.(local?.mask, geometrySignature())) {
    // Analytic gradients use the current local document on the GPU and need
    // no backend revision or bitmap verdict. Keep overlay drafts independent
    // of picture feedback while the slider is held.
    scheduleAuthoritativeLocalMaskDraft(local);
    scheduleLocalPreview();
    return;
  }
  state.localMaskDraftDirty = true;
  const selectedLeaf = selectedMaskLeaf(local);
  if (selectedLeaf?.type === "path") beginPathMaskProgress(local);
  if (state.selectedSubMaskId) {
    const parts = selectedChildMaskParts(local);
    if (parts?.parent) queueLocalComparisonMask(local, parts.id, "parent", parts.parent);
    if (parts?.child) queueLocalComparisonMask(local, parts.id, "child", parts.child);
  } else {
    scheduleAuthoritativeLocalMaskDraft(local);
  }
  scheduleLocalPreview({ spatialMaskChanged: true });
}

function gpuLumaMaskOverlayOptions() {
  const local = selectedLocal();
  if (
    state.gradeMode !== "local"
    || !state.localShowMask
    || local?.enabled === false
    || state.selectedSubMaskId
    || !gpuLumaMaskPreviewActive(local)
  ) return null;
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(state.localOverlayColor);
  const color = match
    ? [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255]
    : [1, 38 / 255, 61 / 255];
  return { localId: local.id, color };
}

function firstMaskLeaf(expression, type = null) {
  return maskExpression.firstLeaf(expression, type);
}

async function moveSelectedLocal(direction) {
  const locals = localAdjustments();
  const index = locals.findIndex((item) => item.id === state.selectedLocalId);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= locals.length) return;
  const order = locals.map((item) => item.id);
  [order[index], order[next]] = [order[next], order[index]];
  await queueEditCommand("reorder_locals", { order });
}

async function commitSelectedLocal({ refreshPreview = true } = {}) {
  const local = selectedLocal();
  if (!local) return false;
  let committed = false;
  state.localMaskCommitDepth += 1;
  state.localMaskCommitRefreshPending ||= refreshPreview;
  try {
    // Local strokes are optimistic and may overlap a previous commit. Hold the
    // adjusted preview until the last queued commit so it cannot render an
    // intermediate mask between strokes.
    committed = await queueEditCommand("update_local", { local: JSON.parse(JSON.stringify(local)) }, local.id, { refreshPreview: false });
    if (committed) {
      window.clearTimeout(state.localMaskDraftTimer);
      state.localMaskDraftTimer = 0;
      // Let an in-flight draft finish quietly. The generation bump below makes
      // its response ineligible, while avoiding a browser-level request failure
      // at the end of a fast gradient gesture.
      state.localMaskDraftController = null;
      state.localMaskDraftPending = null;
      state.localMaskDraftGeneration += 1;
      state.localMaskDraftDirty = false;
      state.localPreviewDirty = false;
    }
  } finally {
    state.localMaskCommitDepth = Math.max(0, state.localMaskCommitDepth - 1);
    if (state.localMaskCommitDepth === 0 && state.localMaskCommitRefreshPending && !state.localPointerGesture) {
      state.localMaskCommitRefreshPending = false;
      invalidatePreview("hdr", { local: true });
      invalidatePreview("sdr", { local: true });
      debouncePreview(state.currentView);
    } else if (committed && !refreshPreview && state.localMaskCommitDepth === 0 && !state.localPointerGesture) {
      // `input` already invalidated and scheduled the visual update, so these
      // controls intentionally avoid a duplicate generation on `change`.
      // Re-arm that generation after persistence completes, though: Full
      // tiled interaction skips its draft by design and needs a guaranteed
      // post-commit settled pass.
      state.previewScheduler?.endInteraction();
    }
    queueLocalMaskOverlayRender();
  }
  return committed;
}

function beginLocalDetailInteraction(control) {
  if (!String(control?.dataset?.localGrade || "").startsWith("detail.")) {
    state.detailInteractionRestore = null;
    return;
  }
  state.detailInteractionRestore = {
    lane: state.currentView,
    longEdge: residentAuthoringLongEdge(),
  };
}

