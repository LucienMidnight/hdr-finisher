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
  const label = document.createElement("div");
  label.className = "control-shared-label";
  label.textContent = "HDR + SDR";
  global.append(label);
  for (const selector of ["#raw-settings-section", '[data-group="raw-highlights"]', '[data-group="geometry"]', '[data-group="perspective"]', ".lane-folder-shell"]) {
    global.append(document.querySelector(selector));
  }
  retouch.append(document.querySelector(".retouch-panel"));
  local.append(els.localAdjustmentGroup);
  els.localPanel.classList.remove("control-group-body");
  els.localEraser.remove();
  const strip = local.querySelector(".local-tool-strip");
  strip.append(els.localShowMask);
  const more = document.createElement("details");
  more.className = "local-more-menu";
  const trigger = document.createElement("summary");
  trigger.textContent = "More";
  trigger.setAttribute("aria-label", "More mask actions");
  const actions = document.createElement("div");
  actions.id = "local-more-actions";
  actions.setAttribute("role", "menu");
  more.append(trigger, actions);
  strip.append(more);
  actions.append(els.localMaskFooterActions, local.querySelector(".local-overlay-color-control"));
  local.querySelector(".local-overlay-actions").remove();
  const heading = local.querySelector(".local-stack-heading");
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
  const advanced = document.getElementById("retouch-advanced");
  advanced.querySelector("summary").setAttribute("aria-expanded", "false");
  advanced.addEventListener("toggle", () => advanced.querySelector("summary").setAttribute("aria-expanded", String(advanced.open)));
  const tabs = document.querySelector(".lane-switch");
  const row = document.createElement("div");
  row.className = "grade-folder-tabs";
  const header = rail.querySelector(":scope > .grade-header");
  const sizeTabs = () => { row.style.top = `${header.offsetHeight}px`; };
  new ResizeObserver(sizeTabs).observe(header);
  requestAnimationFrame(sizeTabs);
  tabs.before(row);
  row.append(tabs, els.sdrMatchEntireActions);
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
    label.textContent = text.textContent.trim();
    text.replaceWith(label);
  });
}

function placeGradeFolderTabs(mode) {
  const row = document.querySelector(".grade-folder-tabs");
  const folder = document.querySelector(mode === "local" ? ".local-lane-folder" : ".lane-folder-shell");
  folder.prepend(row);
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
