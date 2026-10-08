function groupPresetPaths(groupId) {
  if (controlGroups[groupId]) return [...controlGroups[groupId]];
  const separator = groupId.indexOf("-");
  const lane = groupId.slice(0, separator);
  const group = groupId.slice(separator + 1);
  if (!["hdr", "sdr"].includes(lane)) return [];
  if (group === "denoise") return [`denoise.${lane}.controls`];
  if (group === "curves") return ["luma_curve", "red_curve", "green_curve", "blue_curve"].map((key) => `${lane}.${key}`);
  if (["color-grading", "detail", "film-look", "vignette"].includes(group)) return [`${lane}.${group.replaceAll("-", "_")}`];
  return [];
}

function groupPresetContextForElement(groupElement) {
  const rawGroup = groupElement?.dataset.group || "";
  if (["geometry", "perspective", "local-adjustments"].includes(rawGroup)) return null;
  const groupId = ["curves", "color-grading", "detail", "black-and-white", "film-look", "vignette", "denoise"].includes(rawGroup)
    ? `${state.currentView}-${rawGroup}`
    : rawGroup;
  const paths = groupPresetPaths(groupId);
  if (!paths.length) return null;
  const separator = groupId.indexOf("-");
  const lane = groupId.slice(0, separator);
  const group = groupId.slice(separator + 1);
  return { groupId, lane, group, label: GROUP_PRESET_LABELS[group] || group, paths };
}

function groupPresetPathValue(context, path) {
  return context.group === "denoise" ? getValueByPath(state, path) : getValueByPath(state.adjustments, path);
}

function setGroupPresetPathValue(context, path, value) {
  if (context.group === "denoise") setValueByPath(state, path, value);
  else setValueByPath(state.adjustments, path, value);
}

function initializeGroupPresetControls() {
  document.querySelectorAll(".control-group[data-group]").forEach((groupElement) => {
    if (!groupPresetContextForElement(groupElement)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-preset text-button";
    button.textContent = "Preset";
    button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("click", () => openGroupPresetDialog(groupElement));
    const header = groupElement.querySelector(":scope > .control-group-header");
    const reset = header?.querySelector(".group-reset");
    if (header) header.insertBefore(button, reset || header.querySelector(".section-bypass"));
  });
  els.groupPresetClose?.addEventListener("click", closeGroupPresetDialog);
  els.groupPresetDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeGroupPresetDialog();
  });
  els.groupPresetSave?.addEventListener("click", saveCurrentGroupPreset);
  els.groupPresetName?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveCurrentGroupPreset();
    }
  });
}

async function openGroupPresetDialog(groupElement) {
  const context = groupPresetContextForElement(groupElement);
  if (!context) return;
  state.groupPresetContext = context;
  els.groupPresetTitle.textContent = `${context.label} Presets`;
  els.groupPresetContext.textContent = context.group === "film-look"
    ? `${context.lane.toUpperCase()} Film Look · built-ins are editable starting points; Reset returns Neutral.`
    : context.group === "black-and-white"
      ? `${context.lane.toUpperCase()} Black & White · built-ins change only the visible sliders; on/off is unchanged.`
    : context.group === "denoise"
      ? `${context.lane.toUpperCase()} Denoise · presets update cached-analysis settings and live controls; use Recalculate Denoise to rebuild analysis.`
      : `${context.lane.toUpperCase()} ${context.label} · presets affect only this adjustment group.`;
  els.groupPresetName.value = "";
  els.groupPresetStatus.textContent = "";
  if (!els.groupPresetDialog.open) els.groupPresetDialog.showModal();
  await renderGroupPresetList();
  els.groupPresetName.focus();
}

function closeGroupPresetDialog() {
  if (els.groupPresetDialog?.open) els.groupPresetDialog.close();
  state.groupPresetContext = null;
}

async function listSavedGroupPresets(groupId) {
  return window.HDRApplicationShell?.listGradingPresets(groupId) || [];
}

async function persistGroupPreset(preset) {
  return window.HDRApplicationShell?.saveGradingPreset(preset);
}

async function removeGroupPreset(preset) {
  return window.HDRApplicationShell?.deleteGradingPreset(preset);
}

function builtInGroupPresets(context) {
  if (context?.group === "denoise") {
    const defaults = defaultDenoiseDocument()[context.lane];
    return [{
      id: "built-in:default",
      groupId: context.groupId,
      name: "Default",
      builtIn: true,
      values: {
        [`denoise.${context.lane}.controls`]: JSON.parse(JSON.stringify(defaults.controls)),
      },
    }];
  }
  if (context?.group === "black-and-white") {
    return BLACK_AND_WHITE_PRESETS.map((preset) => ({
      id: `built-in:${preset.id}`,
      groupId: context.groupId,
      name: preset.name,
      description: preset.description,
      builtIn: true,
      values: { [`${context.lane}.black_and_white`]: { ...defaultBlackAndWhite(), ...preset.values } },
    }));
  }
  if (context?.group !== "film-look") return [];
  const path = `${context.lane}.film_look`;
  return FILM_LOOK_PRESETS.map((preset) => ({
    id: `built-in:${preset.id}`,
    groupId: context.groupId,
    name: preset.name,
    description: preset.description,
    recipeVersion: preset.recipeVersion,
    builtIn: true,
    values: {
      [path]: JSON.parse(JSON.stringify(preset.recipe)),
    },
  }));
}

function appendGroupPresetSubheading(label) {
  const heading = document.createElement("div");
  heading.className = "group-preset-subheading";
  heading.textContent = label;
  els.groupPresetList.append(heading);
}

function appendGroupPresetRow(preset) {
  const row = document.createElement("div");
  row.className = `group-preset-row${preset.builtIn ? " built-in" : ""}`;
  const name = document.createElement("div");
  name.className = "group-preset-name";
  const strong = document.createElement("strong");
  strong.textContent = preset.name;
  name.append(strong);
  if (preset.description) {
    const description = document.createElement("span");
    description.textContent = preset.description;
    name.append(description);
  }
  if (preset.builtIn) {
    const kind = document.createElement("small");
    kind.textContent = "Built-in";
    name.append(kind);
  }
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "button-secondary";
  apply.textContent = "Apply";
  apply.addEventListener("click", () => applyGroupPreset(preset));
  row.append(name, apply);
  if (!preset.builtIn) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!await window.HDRDialogs.confirm(
        `Delete the “${preset.name}” preset?`,
        { title: "Delete preset", confirmLabel: "Delete", destructive: true },
      )) return;
      await removeGroupPreset(preset);
      await renderGroupPresetList();
    });
    row.append(remove);
  }
  els.groupPresetList.append(row);
}

async function renderGroupPresetList() {
  const context = state.groupPresetContext;
  if (!context) return;
  els.groupPresetList.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "group-preset-empty";
  loading.textContent = "Loading presets…";
  els.groupPresetList.append(loading);
  try {
    const presets = await listSavedGroupPresets(context.groupId);
    const builtIns = builtInGroupPresets(context);
    if (state.groupPresetContext !== context) return;
    els.groupPresetList.replaceChildren();
    if (builtIns.length) {
      appendGroupPresetSubheading(context.group === "black-and-white" ? "Built-in filter presets" : "Built-in character recipes");
      builtIns.forEach(appendGroupPresetRow);
    }
    if (presets.length) {
      appendGroupPresetSubheading("Saved presets");
      presets.forEach(appendGroupPresetRow);
    } else if (!builtIns.length) {
      const empty = document.createElement("p");
      empty.className = "group-preset-empty";
      empty.textContent = "No presets saved for this group yet.";
      els.groupPresetList.append(empty);
    }
  } catch (error) {
    els.groupPresetList.replaceChildren();
    const failure = document.createElement("p");
    failure.className = "group-preset-empty";
    failure.textContent = error?.message || "Presets could not be loaded.";
    els.groupPresetList.append(failure);
  }
}

async function saveCurrentGroupPreset() {
  const context = state.groupPresetContext;
  if (!context) return;
  const name = els.groupPresetName.value.trim().replace(/\s+/g, " ");
  if (!name) {
    els.groupPresetStatus.textContent = "Enter a preset name.";
    els.groupPresetName.focus();
    return;
  }
  if (builtInGroupPresets(context).some((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    els.groupPresetStatus.textContent = "That name belongs to a built-in preset. Choose another name.";
    return;
  }
  const existing = await listSavedGroupPresets(context.groupId);
  if (existing.some((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    && !await window.HDRDialogs.confirm(
      `Replace the existing “${name}” preset?`,
      { title: "Replace preset", confirmLabel: "Replace", destructive: true },
    )) return;
  const values = Object.fromEntries(context.paths.map((path) => [path, JSON.parse(JSON.stringify(groupPresetPathValue(context, path)))]));
  await persistGroupPreset({ groupId: context.groupId, name, recipeVersion: 1, values });
  els.groupPresetName.value = "";
  els.groupPresetStatus.textContent = `Saved “${name}”.`;
  await renderGroupPresetList();
}

function applyGroupPreset(preset) {
  const context = state.groupPresetContext;
  if (!context || preset.groupId !== context.groupId || !preset.values || typeof preset.values !== "object") return;
  // A preset outlives the settings it was saved with: a setting the app no
  // longer has is left out, so an older preset still applies.
  const defaults = context.group === "denoise" ? { denoise: defaultDenoiseDocument() } : defaultAdjustments();
  context.paths.forEach((path) => {
    if (!Object.hasOwn(preset.values, path)) return;
    const value = JSON.parse(JSON.stringify(preset.values[path]));
    const known = getValueByPath(defaults, path);
    const plain = (item) => Boolean(item) && typeof item === "object" && !Array.isArray(item);
    setGroupPresetPathValue(context, path, plain(value) && plain(known)
      ? Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(known, key)))
      : value);
  });
  if (context.group === "denoise") {
    const runtime = state.denoiseRuntime[context.lane];
    runtime.dirty = true;
    runtime.status = state.denoise[context.lane].enabled ? "dirty" : "off";
    runtime.showOriginal = !state.denoise[context.lane].enabled;
    renderDenoiseControls();
    void persistDenoiseSettings();
    closeGroupPresetDialog();
    return;
  }
  syncControlsFromState();
  syncCurveControlsFromState();
  drawCurveEditor();
  drawToneEqualizerEditor(context.lane);
  renderControlState();
  renderVignetteCenter();
  invalidatePreview(context.lane);
  debouncePreview(context.lane);
  closeGroupPresetDialog();
}

