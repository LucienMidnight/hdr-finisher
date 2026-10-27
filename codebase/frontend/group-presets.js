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
  const groupId = ["hsl", "curves", "color-grading", "detail", "black-and-white", "film-look", "vignette", "denoise"].includes(rawGroup)
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
  initializeFilmStagePresets();
  document.getElementById("group-preset-import")?.addEventListener("click", () => void groupPresetAction(importGroupPresetFile));
  document.getElementById("group-preset-export")?.addEventListener("click", () => void groupPresetAction(exportGroupPresetFile));
  els.groupPresetClose?.addEventListener("click", closeGroupPresetDialog);
  els.groupPresetDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    const search = document.getElementById("group-preset-search");
    if (search.value) { search.value = ""; paintGroupPresetList(); search.focus(); }
    else closeGroupPresetDialog();
  });
  document.getElementById("group-preset-search").addEventListener("input", paintGroupPresetList);
  els.groupPresetDialog.addEventListener("keydown", (event) => {
    const search = document.getElementById("group-preset-search");
    const buttons = [...els.groupPresetList.querySelectorAll(".group-preset-row > .button-secondary")];
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)
      || (event.target !== search && !buttons.includes(event.target))) return;
    event.preventDefault();
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement);
    if (event.key === "Enter") (buttons[current < 0 ? 0 : current]).click();
    else buttons[current < 0 ? (event.key === "ArrowDown" ? 0 : buttons.length - 1)
      : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
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
  els.groupPresetTitle.textContent = "Adjustment Presets";
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
  document.getElementById("group-preset-search").value = "";
  document.getElementById("group-preset-search").focus();
  await renderGroupPresetList();
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
  const label = document.createElement("label"), selected = document.createElement("input");
  selected.type = "checkbox"; selected.setAttribute("aria-label", `Select ${preset.name} for export`);
  selected.addEventListener("change", () => {
    if(selected.checked) groupPresetSelection.set(preset.id,preset); else groupPresetSelection.delete(preset.id);
    document.getElementById("group-preset-export").disabled = !groupPresetSelection.size;
  });
  label.append(selected,strong); name.append(label);
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
    for (const [title, action] of [["Rename", renameGroupPreset], ["Update", updateGroupPreset]]) {
      const button=document.createElement("button");button.type="button";button.className="text-button";
      button.textContent=title;button.addEventListener("click",()=>void groupPresetAction(()=>action(preset)));
      row.append(button);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => void groupPresetAction(async () => {
      if (!await window.HDRDialogs.confirm(
        `Delete the “${preset.name}” preset?`,
        { title: "Delete preset", confirmLabel: "Delete", destructive: true },
      )) return;
      await removeGroupPreset(preset);
      await renderGroupPresetList();
      els.groupPresetName.focus();
    }));
    row.append(remove);
  }
  els.groupPresetList.append(row);
}

let groupPresetRows = { builtIns: [], saved: [] };
function paintGroupPresetList() {
  const query = document.getElementById("group-preset-search").value;
  const builtIns = HDRGradingPresetFiles.filter(groupPresetRows.builtIns, query);
  const presets = HDRGradingPresetFiles.filter(groupPresetRows.saved, query);
  groupPresetSelection.clear();
  document.getElementById("group-preset-export").disabled = true;
  els.groupPresetList.replaceChildren();
  if (builtIns.length) { appendGroupPresetSubheading("Built-in"); builtIns.forEach(appendGroupPresetRow); }
  if (presets.length) { appendGroupPresetSubheading("Saved"); presets.forEach(appendGroupPresetRow); }
  if (!presets.length && !builtIns.length) {
    const empty = document.createElement("p"); empty.className = "group-preset-empty";
    empty.textContent = query.trim() ? "No presets match your search." : "No presets saved for this group yet.";
    els.groupPresetList.append(empty);
  }
}
async function renderGroupPresetList() {
  const context = state.groupPresetContext;
  if (!context) return;
  groupPresetSelection.clear();
  document.getElementById("group-preset-export").disabled = true;
  els.groupPresetList.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "group-preset-empty";
  loading.textContent = "Loading presets…";
  els.groupPresetList.append(loading);
  try {
    const presets = await listSavedGroupPresets(context.groupId);
    const builtIns = builtInGroupPresets(context);
    if (state.groupPresetContext !== context) return;
    groupPresetRows = { builtIns, saved: presets };
    paintGroupPresetList();
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
  const values = currentGroupPresetValues(context);
  await persistGroupPreset({ groupId: context.groupId, name, recipeVersion: context.group === "film-look" ? FILM_LOOK_PRESET_RECIPE_VERSION : 1, values });
  els.groupPresetName.value = "";
  els.groupPresetStatus.textContent = `Saved “${name}”.`;
  await renderGroupPresetList();
}

const groupPresetSelection = new Map();
async function groupPresetAction(action) {
  try { await action(); } catch(error) { els.groupPresetStatus.textContent=error?.message || "Presets could not be saved."; }
}
function currentGroupPresetValues(context) {
  return Object.fromEntries(context.paths.map(path=>[path,JSON.parse(JSON.stringify(context.group === "film-look"
    ? HDRFilmCharacter.sparse(groupPresetPathValue(context,path)) : groupPresetPathValue(context,path)))]));
}
async function renameGroupPreset(preset) {
  const context=state.groupPresetContext;
  if(!context || preset.builtIn)return;
  const answer=await window.HDRDialogs.prompt("Preset name",preset.name,{title:"Rename preset",confirmLabel:"Rename"});
  if(answer===null || state.groupPresetContext!==context)return;
  const name=answer.trim().replace(/\s+/g," ");
  if(!name || name.length>80)throw Error("Preset names must contain 1 to 80 characters.");
  if(name===preset.name)return;
  const existing=[...builtInGroupPresets(context),...await listSavedGroupPresets(context.groupId)];
  if(existing.some(p=>p.id!==preset.id && p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error("That preset name is already taken.");
  const saved=await persistGroupPreset({groupId:preset.groupId,name,recipeVersion:preset.recipeVersion,values:preset.values});
  if(saved.id!==preset.id)await removeGroupPreset(preset);
  await renderGroupPresetList();els.groupPresetName.focus();els.groupPresetStatus.textContent=`Renamed to “${name}”.`;
}
async function updateGroupPreset(preset) {
  const context=state.groupPresetContext;
  if(!context || preset.builtIn)return;
  if(!await window.HDRDialogs.confirm(`Update “${preset.name}” from the current settings?`,{title:"Update preset",confirmLabel:"Update",destructive:true}) || state.groupPresetContext!==context)return;
  await persistGroupPreset({groupId:preset.groupId,name:preset.name,recipeVersion:context.group==="film-look"?FILM_LOOK_PRESET_RECIPE_VERSION:1,values:currentGroupPresetValues(context)});
  await renderGroupPresetList();els.groupPresetName.focus();
  els.groupPresetStatus.textContent=`Updated “${preset.name}”.`;
}
async function exportGroupPresetFile() {
  if(!groupPresetSelection.size)return;
  const text=HDRGradingPresetFiles.encode([...groupPresetSelection.values()]);
  if(window.hdrFinisherDesktop?.exportGradingPresetFile) {
    if(!await window.hdrFinisherDesktop.exportGradingPresetFile(text))return;
  } else {
    const url=URL.createObjectURL(new Blob([text],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download=HDRGradingPresetFiles.exportName([...groupPresetSelection.values()],state.groupPresetContext.label);link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  els.groupPresetStatus.textContent=`Exported ${groupPresetSelection.size} preset(s).`;
}
async function importGroupPresetText(text,context=state.groupPresetContext) {
  if(!context || state.groupPresetContext!==context)return;
  const imported=HDRGradingPresetFiles.decode(text);
  if(imported.some(p=>p.groupId!==context.groupId || Object.keys(p.values).some(path=>!context.paths.includes(path))))
    throw Error("This file contains presets for another adjustment group. Open that group’s presets to import it.");
  const existing=[...builtInGroupPresets(context),...await listSavedGroupPresets(context.groupId)];
  const planned=HDRGradingPresetFiles.keepBoth(imported,existing);
  for(const preset of planned)await persistGroupPreset(preset);
  await renderGroupPresetList();els.groupPresetName.focus();
  const renamed=planned.filter((p,i)=>p.name!==imported[i].name).length;
  els.groupPresetStatus.textContent=`Imported ${planned.length} preset(s).${renamed?" Name clashes kept both, labelled (imported).":""}`;
}
async function importGroupPresetFile() {
  const context=state.groupPresetContext;
  if(window.hdrFinisherDesktop?.importGradingPresetFile) {
    const text=await window.hdrFinisherDesktop.importGradingPresetFile();
    if(text!==null)await importGroupPresetText(text,context);
  } else {
    const input=document.createElement("input");input.type="file";input.accept=".json";
    input.addEventListener("change",()=>void groupPresetAction(async()=>{
      if(input.files[0])await importGroupPresetText(await input.files[0].text(),context);
    }),{once:true});input.click();
  }
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
    if (context.group === "film-look") {
      setGroupPresetPathValue(context, path, HDRFilmCharacter.expand(value));
      return;
    }
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


// Fixed stage shortcuts share the existing recipe application path.
function initializeFilmStagePresets() {
  document.querySelectorAll("[data-film-shortcuts]").forEach(box => {
    const name = box.dataset.filmShortcuts;
    const label = document.createElement("span"); label.textContent = name;
    box.append(label);
    HDRFilmCharacter.stages[name].forEach(([title], index) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "button-secondary";
      button.dataset.filmStage = name; button.dataset.filmRecipe = String(index);
      button.textContent = title.replace(/ \(.*\)$/, "").replace(/ print$/, "");
      button.title = title;
      button.addEventListener("click", () => {
        if (!state.session || button.disabled) return;
        HDRFilmCharacter.stage(state.adjustments[state.currentView].film_look, name, index);
        syncControlsFromState(); renderControlState(); invalidatePreview(state.currentView); debouncePreview(state.currentView);
      });
      box.append(button);
    });
  });
  document.querySelectorAll(".film-stage-heading").forEach(button => button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(expanded));
    document.getElementById(button.getAttribute("aria-controls")).hidden = !expanded;
  }));
  document.querySelectorAll("[data-film-push]").forEach(button => {
    button.addEventListener("click", () => {
      if (state.session) commitAdjustmentValue("current.film_look.push_pull", Number(button.dataset.filmPush), {manual:true});
    });
    button.addEventListener("keydown", event => {
      const buttons = [...button.parentElement.querySelectorAll("button")];
      const direction = {ArrowLeft:-1, ArrowUp:-1, ArrowRight:1, ArrowDown:1}[event.key];
      if (!direction && !["Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length-1 : (buttons.indexOf(button)+direction+buttons.length)%buttons.length;
      buttons[index].focus(); buttons[index].click();
    });
  });
}
