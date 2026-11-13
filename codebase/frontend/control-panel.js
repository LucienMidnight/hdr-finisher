const controlPanelFoldouts = new Map();

/* Session-only Control Panel organization; existing controls retain their listeners. */
function initializeControlPanel() {
  const rail = document.getElementById("grade-workflow-panel");
  const makePanel = mode => {
    const panel = document.createElement("div");
    panel.id = `control-mode-${mode}`;
    panel.dataset.controlPanel = mode;
    panel.setAttribute("role", "tabpanel");
    panel.tabIndex = 0;
    panel.setAttribute("aria-labelledby", `grade-mode-${mode}`);
    panel.hidden = mode !== "global";
    rail.append(panel);
    return panel;
  };
  const global = makePanel("global"), local = makePanel("local"), retouch = makePanel("retouch");
  for (const selector of ["#raw-settings-section", '[data-group="raw-highlights"]', '[data-group="geometry"]', '[data-group="perspective"]', ".lane-folder-shell"]) {
    global.append(document.querySelector(selector));
  }
  const label = text => {
    const node = document.createElement("div");
    node.className = "control-shared-label";
    node.textContent = text;
    return node;
  };
  retouch.append(document.querySelector(".retouch-panel"));
  const repairContent = retouch.querySelector(".retouch-content");
  const repairNote = document.createElement("p");
  repairNote.className = "helper retouch-shared-note";
  repairNote.textContent = "Repairs apply to both renditions, before crop.";
  repairContent.prepend(repairNote, label("Repair tool"), retouch.querySelector(".retouch-mode-switch"));
  local.append(els.localAdjustmentGroup);
  els.localPanel.classList.remove("control-group-body");
  els.localEraser.remove();
  const strip = local.querySelector(".local-tool-strip");
  const actions = document.createElement("div");
  actions.id = "local-mask-actions";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Mask actions");
  actions.append(els.localMaskFooterActions, els.localShowMask, local.querySelector(".local-overlay-color-control"));
  local.querySelector(".local-overlay-actions").remove();
  const stack = local.querySelector(".local-stack-surface");
  stack.after(actions);
  const newLabel = local.querySelector(".control-shared-label");
  const maskNote = document.createElement("p");
  maskNote.className = "helper retouch-shared-note";
  maskNote.textContent = "Masks apply to both renditions; HDR and SDR keep their own settings.";
  strip.before(maskNote, newLabel);
  const heading = local.querySelector(".local-stack-heading");
  heading.querySelector("span").textContent = "Masks";
  heading.append(local.querySelector(".local-stack-primary-actions"), document.getElementById("local-adjustments-bypass"));
  for (const section of local.querySelectorAll(".local-grade-section")) {
    const name = section.dataset.localGradeSection;
    const title = name === "hsl" ? "HSL" : name[0].toUpperCase() + name.slice(1);
    const details = createControlFoldout(`local-grade-${name}`, title, "Default", name === "light");
    const oldHeading = section.querySelector(".local-mask-subpanel-heading");
    section.removeAttribute("aria-labelledby");
    oldHeading?.remove();
    if (name === "hsl") section.querySelector("h4")?.remove();
    details.append(...section.childNodes);
    section.append(details);
  }
  const tabs = document.querySelector(".lane-switch");
  const row = document.createElement("div");
  row.className = "grade-folder-tabs";
  const header = rail.querySelector(":scope > .grade-header");
  const sizeTabs = () => { row.style.top = `${header.offsetHeight}px`; };
  new ResizeObserver(sizeTabs).observe(header);
  requestAnimationFrame(sizeTabs);
  tabs.before(row);
  row.append(tabs);
  const matchCopy = document.createElement("span");
  matchCopy.className = "sdr-match-copy";
  matchCopy.textContent = "Start the SDR grade from your HDR grade.";
  els.sdrMatchEntireActions.prepend(matchCopy);
  row.after(els.sdrMatchEntireActions);
  els.sdrMatchEntire.classList.replace("button-primary", "button-secondary");
  document.querySelectorAll("[data-control-mode]").forEach(button => {
    button.addEventListener("click", () => setGradeMode(button.dataset.controlMode));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...document.querySelectorAll("[data-control-mode]")];
      const index = buttons.indexOf(button);
      const next = event.key === "Home" ? buttons[0] : event.key === "End" ? buttons.at(-1)
        : buttons[(index + (event.key === "ArrowRight" ? 1 : 2)) % 3];
      next.focus();
      next.click();
    });
  });
  // Labels need their own flex item so long section names can ellipsize.
  document.querySelectorAll(".group-toggle").forEach(button => {
    const text = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (!text) return;
    const label = document.createElement("span");
    label.className = "control-group-name";
    const names = { "Highlight Reconstruction": "Highlight reconstruction", "Crop & Rotate": "Crop & rotate", "Exposure Bands": "Exposure bands", "Highlight Compression": "Highlight compression", "Black & White": "Black & white", "Film Look": "Film look" };
    label.textContent = names[text.textContent.trim()] || text.textContent.trim();
    text.replaceWith(label);
  });
}

// A newly opened photo starts with every Grade module and the RAW settings closed.
function collapseGradeModules() {
  document.querySelectorAll(".control-group:not(.collapsed)").forEach(group => {
    group.classList.add("collapsed");
    group.querySelector(":scope > .control-group-header > .group-toggle")?.setAttribute("aria-expanded", "false");
  });
  state.rawSettingsOpen = false;
}

function placeGradeFolderTabs(mode) {
  const row = document.querySelector(".grade-folder-tabs");
  const folder = document.querySelector(mode === "local" ? ".local-lane-folder" : ".lane-folder-shell");
  if (row.parentElement !== folder) folder.prepend(row);
  if (mode !== "local") row.after(els.sdrMatchEntireActions);
}

function createControlFoldout(key, title, hint, open = false) {
  const details = document.createElement("details");
  details.className = "control-foldout";
  details.open = controlPanelFoldouts.get(key) ?? open;
  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.textContent = title;
  const note = document.createElement("span");
  note.className = "foldout-summary";
  note.textContent = hint;
  note.title = hint;
  summary.append(label, note);
  summary.setAttribute("aria-expanded", String(details.open));
  details.append(summary);
  details.addEventListener("toggle", () => {
    controlPanelFoldouts.set(key, details.open);
    summary.setAttribute("aria-expanded", String(details.open));
  });
  return details;
}
