(function applicationShellModule() {
  "use strict";

  const STORAGE_KEY = "hdr-finisher:application-preferences:v1";
  const PROJECT_URL = "https://github.com/LucienMidnight/hdr-finisher";
  const DEFAULT_PREFERENCES = {
    schemaVersion: 1,
    defaultReferenceWhiteNits: 203,
    renderingMode: "auto",
    folders: { projectSave: "", projectImport: "", fileSave: "", fileImport: "", presetSave: "" },
    shortcuts: {},
    shortcutPresets: {},
    gradingPresets: {},
    updates: { checkAutomatically: true, dismissedVersion: "" },
  };
  const COMMON_DEFAULT_SHORTCUTS = {
    "app.settings": "Mod+,",
    "file.import": "Mod+O",
    "project.open": "Mod+Shift+O",
    "project.save": "Mod+S",
    "project.saveAs": "Mod+Shift+S",
    "file.exportStandard": "Mod+E",
    "edit.undo": "Mod+Z",
    "edit.redo": "Mod+Shift+Z",
    "view.scopeRegion": "Shift+R",
  };
  const MACOS_RESERVED_SHORTCUTS = new Map([
    ["Mod+Shift+3", "a full-screen screenshot"],
    ["Mod+Shift+4", "a selection screenshot"],
    ["Mod+Shift+5", "Screenshot and screen recording options"],
    ["Mod+Space", "Spotlight"],
    ["Mod+Tab", "switching applications"],
    ["Mod+Alt+Esc", "Force Quit"],
    ["Mod+H", "hiding the active application"],
    ["Mod+M", "minimizing the active window"],
    ["Mod+Q", "quitting the active application"],
    ["Mod+W", "closing the active window"],
  ]);
  const FOLDER_FIELDS = [
    ["projectSave", "Project save"],
    ["projectImport", "Project import"],
    ["fileSave", "Finished file save"],
    ["fileImport", "Source file import"],
    ["presetSave", "HDRF preset library"],
  ];
  const HELP_TOPICS = [
    ["Getting started", [
      ["Quick start", "getting-started/quick-start.md"],
      ["Install and run", "getting-started/install-and-run.md"],
      ["Windows setup", "setup/windows.md"],
      ["macOS setup", "setup/macos.md"],
      ["Monitor setup", "setup/monitors.md"],
    ]],
    ["User guide", [
      ["Settings and shortcuts", "user-guide/application-settings-and-shortcuts.md"],
      ["Import", "user-guide/import.md"],
      ["Projects", "user-guide/projects.md"],
      ["Grade HDR", "user-guide/grade-hdr.md"],
      ["Grade SDR", "user-guide/grade-sdr.md"],
      ["Grading controls", "user-guide/grading-controls-reference.md"],
      ["Viewer and analysis", "user-guide/viewer-and-analysis.md"],
      ["Proof", "user-guide/proof.md"],
      ["Export", "user-guide/export.md"],
      ["HDR reference white", "user-guide/hdr-reference-white.md"],
    ]],
    ["Concepts", [
      ["HDR basics", "concepts/hdr-basics.md"],
      ["Color pipeline", "concepts/color-pipeline.md"],
      ["Gain maps and formats", "concepts/gain-maps-and-formats.md"],
      ["Glossary", "glossary.md"],
    ]],
    ["Support", [
      ["Troubleshooting", "troubleshooting.md"],
      ["Known limitations", "known-limitations.md"],
      ["Source preparation", "workflows/source-preparation.md"],
    ]],
  ];

  const shell = {
    desktop: null,
    preferences: null,
    commands: [],
    commandMap: new Map(),
    docs: new Map(),
    activeDocument: "getting-started/quick-start.md",
    recordingAction: "",
    heldActions: new Map(),
    persistChain: Promise.resolve(),
    defaultPresetDirectory: "",
    onPreferencesChanged: () => {},
    adjustControl: () => false,
  };

  const byId = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const isMacPlatform = () => navigator.platform.toLowerCase().includes("mac");
  const mergePreferences = (value = {}) => ({
    ...clone(DEFAULT_PREFERENCES),
    ...value,
    schemaVersion: 1,
    defaultReferenceWhiteNits: Number(value.defaultReferenceWhiteNits) === 100 ? 100 : 203,
    renderingMode: ["auto", "gpu", "cpu"].includes(value.renderingMode) ? value.renderingMode : "auto",
    folders: { ...DEFAULT_PREFERENCES.folders, ...(value.folders || {}) },
    shortcuts: value.shortcuts && typeof value.shortcuts === "object" ? value.shortcuts : {},
    shortcutPresets: value.shortcutPresets && typeof value.shortcutPresets === "object" ? value.shortcutPresets : {},
    gradingPresets: value.gradingPresets && typeof value.gradingPresets === "object" ? value.gradingPresets : {},
    updates: { ...DEFAULT_PREFERENCES.updates, ...(value.updates || {}) },
  });

  async function loadPreferences() {
    if (shell.desktop?.getPreferences) {
      try { return mergePreferences(await shell.desktop.getPreferences()); } catch (error) { console.warn("Could not load desktop preferences.", error); }
    }
    try { return mergePreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch { return mergePreferences(); }
  }

  function persistPreferences() {
    const snapshot = clone(shell.preferences);
    shell.persistChain = shell.persistChain.then(async () => {
      if (shell.desktop?.setPreferences) await shell.desktop.setPreferences(snapshot);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    }).catch((error) => console.warn("Could not save application preferences.", error));
    shell.onPreferencesChanged(clone(snapshot));
  }

  function shortcutFor(actionId) {
    return Object.hasOwn(shell.preferences.shortcuts, actionId)
      ? shell.preferences.shortcuts[actionId]
      : defaultShortcutFor(actionId);
  }

  function defaultShortcutFor(actionId) {
    if (actionId === "app.help") return isMacPlatform() ? "Mod+Shift+?" : "F1";
    if (actionId === "edit.redoAlternate") return isMacPlatform() ? "" : "Mod+Y";
    if (actionId === "edit.redoRequested") return isMacPlatform() ? "" : "Mod+R";
    return COMMON_DEFAULT_SHORTCUTS[actionId] || "";
  }

  function controlLabel(control) {
    const explicit = control.id ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null;
    const container = control.closest("[data-control-path], .control-row, label, fieldset");
    const label = explicit || container?.querySelector("label, legend") || control.closest("label");
    return (label?.textContent || control.getAttribute("aria-label") || control.dataset.path)
      .replace(/\s+/g, " ").trim().replace(/[-+]?\d+(?:\.\d+)?(?:%|°| EV| nit)?$/i, "").trim();
  }

  function controlCategory(path) {
    if (path.startsWith("hdr.")) return "HDR controls";
    if (path.startsWith("sdr.")) return "SDR controls";
    if (path.startsWith("current.")) return "Active rendition controls";
    return "Shared controls";
  }

  function buildControlCommands() {
    const seen = new Set();
    const commands = [];
    for (const control of document.querySelectorAll('input[type="range"][data-path]')) {
      const path = control.dataset.path;
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const label = controlLabel(control);
      for (const [direction, verb] of [["decrease", "Decrease"], ["increase", "Increase"], ["reset", "Reset"]]) {
        commands.push({
          id: `control:${path}:${direction}`,
          label: `${verb} ${label}`,
          category: controlCategory(path),
          description: path,
          repeatable: direction !== "reset",
          adjustment: true,
          execute: (event) => shell.adjustControl(path, direction, event),
        });
      }
    }
    return commands;
  }

  function normalizeKey(event) {
    const aliases = { " ": "Space", Escape: "Esc", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
    let key = aliases[event.key] || event.key;
    if (event.shiftKey && /^Digit[0-9]$/.test(event.code || "")) key = event.code.slice(5);
    if (!key || ["Control", "Meta", "Shift", "Alt"].includes(key)) return "";
    if (key.length === 1) key = key.toUpperCase();
    const parts = [];
    const mac = isMacPlatform();
    if (mac ? event.metaKey : event.ctrlKey) parts.push("Mod");
    if (mac && event.ctrlKey) parts.push("Ctrl");
    if (!mac && event.metaKey) parts.push("Meta");
    if (event.shiftKey && key !== "Shift") parts.push("Shift");
    if (event.altKey && key !== "Alt") parts.push("Alt");
    parts.push(key);
    return parts.join("+");
  }

  function displayShortcut(value) {
    if (!value) return "Not assigned";
    const mac = isMacPlatform();
    return value.split("+").map((part) => {
      if (part === "Mod") return mac ? "⌘" : "Ctrl";
      if (part === "Ctrl") return mac ? "⌃" : "Ctrl";
      if (part === "Meta") return mac ? "Meta" : "Win";
      if (part === "Shift") return mac ? "⇧" : "Shift";
      if (part === "Alt") return mac ? "⌥" : "Alt";
      return part;
    }).join(mac ? "" : "+");
  }

  function findActionForEvent(event) {
    const exact = normalizeKey(event);
    if (!exact) return undefined;
    let action = shell.commands.find((candidate) => shortcutFor(candidate.id) === exact);
    if (action) return action;
    if (event.ctrlKey) {
      const physicalKey = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
        : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5)
          : event.key;
      const relaxed = normalizeKey({
        key: physicalKey,
        ctrlKey: false,
        metaKey: event.metaKey,
        shiftKey: false,
        altKey: false,
      });
      action = shell.commands.find((candidate) => candidate.adjustment && shortcutFor(candidate.id) === relaxed);
    }
    return action;
  }

  function isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  }

  function handleShortcutKeydown(event) {
    if (shell.recordingAction || event.isComposing) return;
    if (
      event.target instanceof HTMLInputElement
      && event.target.type === "range"
      && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) return;
    const action = findActionForEvent(event);
    if (!action || (isTypingTarget(event.target) && !action.global)) return;
    if (event.repeat && !action.repeatable) return;
    event.preventDefault();
    event.stopPropagation();
    action.execute(event, "keydown");
    if (action.hold) shell.heldActions.set(event.code || event.key, action);
  }

  function handleShortcutKeyup(event) {
    const action = shell.heldActions.get(event.code || event.key);
    if (!action) return;
    shell.heldActions.delete(event.code || event.key);
    event.preventDefault();
    action.execute(event, "keyup");
  }

  function releaseHeldActions() {
    for (const action of new Set(shell.heldActions.values())) action.execute({}, "keyup");
    shell.heldActions.clear();
  }

  function openDialog(dialog, focusTarget) {
    if (!dialog?.open) dialog?.showModal();
    window.setTimeout(() => (focusTarget || dialog)?.focus(), 0);
  }

  function openSettings(tab = "general") {
    selectSettingsTab(tab);
    renderSettings();
    openDialog(byId("settings-dialog"), document.querySelector(`[data-settings-tab="${tab}"]`));
  }

  function openHelp(path = shell.activeDocument) {
    openDialog(byId("help-dialog"), byId("help-search"));
    loadDocument(path);
  }

  function selectSettingsTab(tab) {
    document.querySelectorAll("[data-settings-tab]").forEach((button) => {
      const active = button.dataset.settingsTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-settings-panel]").forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== tab; });
  }

  function renderFolderSettings() {
    const list = byId("settings-folder-list");
    list.replaceChildren();
    for (const [key, label] of FOLDER_FIELDS) {
      const row = document.createElement("div");
      row.className = "settings-folder-row";
      const fieldLabel = document.createElement("label");
      fieldLabel.textContent = label;
      fieldLabel.htmlFor = `settings-folder-${key}`;
      const input = document.createElement("input");
      input.id = `settings-folder-${key}`;
      input.type = "text";
      input.readOnly = true;
      input.placeholder = "Operating-system default";
      const effectiveDefault = key === "presetSave" ? shell.defaultPresetDirectory : "";
      input.value = shell.preferences.folders[key] || effectiveDefault;
      const actions = document.createElement("div");
      actions.className = "settings-folder-actions";
      if (key === "presetSave") {
        const reveal = document.createElement("button");
        reveal.type = "button";
        reveal.className = "button-secondary";
        reveal.textContent = "Reveal";
        reveal.disabled = !shell.desktop?.revealPreferenceDirectory;
        reveal.addEventListener("click", () => shell.desktop.revealPreferenceDirectory(key));
        actions.append(reveal);
      }
      const choose = document.createElement("button");
      choose.type = "button";
      choose.className = "button-secondary";
      choose.textContent = "Choose…";
      choose.disabled = !shell.desktop?.choosePreferenceDirectory;
      choose.title = choose.disabled ? "Folder preferences use native dialogs in the desktop app." : "";
      choose.addEventListener("click", async () => {
        const selected = await shell.desktop.choosePreferenceDirectory(key);
        if (!selected) return;
        shell.preferences.folders[key] = selected;
        input.value = selected;
        clear.disabled = false;
        persistPreferences();
      });
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "text-button";
      clear.textContent = "Clear";
      clear.disabled = !shell.preferences.folders[key];
      clear.addEventListener("click", () => {
        shell.preferences.folders[key] = "";
        input.value = effectiveDefault;
        clear.disabled = true;
        persistPreferences();
      });
      actions.append(choose, clear);
      row.append(fieldLabel, input, actions);
      list.append(row);
    }
  }

  function renderPresetOptions() {
    const select = byId("shortcut-preset");
    const selected = select.value;
    select.replaceChildren(new Option("Shortcut presets…", ""));
    for (const name of Object.keys(shell.preferences.shortcutPresets).sort((a, b) => a.localeCompare(b))) select.add(new Option(name, name));
    if (shell.preferences.shortcutPresets[selected]) select.value = selected;
  }

  function renderShortcutList() {
    const list = byId("shortcut-list");
    const query = byId("shortcut-search").value.trim().toLowerCase();
    list.replaceChildren();
    const matches = shell.commands.filter((command) => !query || `${command.label} ${command.category} ${command.description || ""}`.toLowerCase().includes(query));
    for (const command of matches) {
      const row = document.createElement("div");
      row.className = "shortcut-row";
      const name = document.createElement("div");
      name.className = "shortcut-command";
      const strong = document.createElement("strong");
      strong.textContent = command.label;
      const category = document.createElement("small");
      category.textContent = command.category;
      name.append(strong, category);
      const record = document.createElement("button");
      record.type = "button";
      record.className = "shortcut-record";
      record.dataset.shortcutAction = command.id;
      record.textContent = displayShortcut(shortcutFor(command.id));
      record.setAttribute("aria-label", `Change shortcut for ${command.label}`);
      record.addEventListener("click", () => beginRecording(command, record));
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "text-button";
      reset.textContent = "Reset";
      reset.disabled = !Object.hasOwn(shell.preferences.shortcuts, command.id);
      reset.addEventListener("click", () => {
        delete shell.preferences.shortcuts[command.id];
        persistPreferences();
        renderShortcutList();
      });
      row.append(name, record, reset);
      list.append(row);
    }
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "shortcut-empty";
      empty.textContent = "No commands match that search.";
      list.append(empty);
    }
  }

  function beginRecording(command, button) {
    shell.recordingAction = command.id;
    button.classList.add("recording");
    button.textContent = "Press shortcut…";
    const finish = () => {
      shell.recordingAction = "";
      button.classList.remove("recording");
      button.removeEventListener("keydown", capture);
      button.removeEventListener("blur", cancel);
      renderShortcutList();
    };
    const cancel = () => finish();
    const capture = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return finish();
      if (event.key === "Backspace" || event.key === "Delete") {
        shell.preferences.shortcuts[command.id] = "";
        persistPreferences();
        return finish();
      }
      const shortcut = normalizeKey(event);
      if (!shortcut) return;
      const reservation = isMacPlatform() ? MACOS_RESERVED_SHORTCUTS.get(shortcut) : "";
      if (reservation && !window.confirm(`${displayShortcut(shortcut)} is normally used by macOS for ${reservation} and may not reach HDR Finisher. Assign it anyway?`)) return;
      const conflict = shell.commands.find((candidate) => candidate.id !== command.id && shortcutFor(candidate.id) === shortcut);
      if (conflict && !window.confirm(`${displayShortcut(shortcut)} is assigned to “${conflict.label}”. Reassign it?`)) return;
      if (conflict) shell.preferences.shortcuts[conflict.id] = "";
      shell.preferences.shortcuts[command.id] = shortcut;
      persistPreferences();
      finish();
    };
    button.addEventListener("keydown", capture);
    button.addEventListener("blur", cancel);
    button.focus();
  }

  function resolvedShortcutMap() {
    return Object.fromEntries(shell.commands.map((command) => [command.id, shortcutFor(command.id)]));
  }

  function renderSettings() {
    byId("settings-rendering-mode").value = shell.preferences.renderingMode;
    byId("settings-auto-updates").checked = shell.preferences.updates.checkAutomatically;
    renderFolderSettings();
    renderPresetOptions();
    renderShortcutList();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function normalizeDocumentLink(link, currentPath) {
    if (/^https?:\/\//i.test(link)) return { href: link, external: true };
    if (link.startsWith("#")) return { href: link, external: false };
    try {
      const resolved = new URL(link, `https://docs.local/${currentPath}`);
      return { href: resolved.pathname.replace(/^\//, ""), external: false };
    } catch { return { href: "#", external: false }; }
  }

  function inlineMarkdown(value, currentPath) {
    let html = escapeHtml(value);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, link) => {
      const target = normalizeDocumentLink(link, currentPath);
      if (target.external) return `<a href="${escapeHtml(target.href)}" target="_blank" rel="noreferrer">${label}</a>`;
      if (target.href.startsWith("#")) return `<a href="${escapeHtml(target.href)}">${label}</a>`;
      return `<a href="#" data-help-document="${escapeHtml(target.href)}">${label}</a>`;
    });
    return html;
  }

  function renderMarkdown(markdown, currentPath) {
    const lines = String(markdown).replace(/\r/g, "").split("\n");
    const output = [];
    let paragraph = [];
    let listType = "";
    let code = false;
    const flushParagraph = () => {
      if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join(" "), currentPath)}</p>`);
      paragraph = [];
    };
    const closeList = () => { if (listType) output.push(`</${listType}>`); listType = ""; };
    for (const line of lines) {
      if (line.startsWith("```")) {
        flushParagraph(); closeList();
        output.push(code ? "</code></pre>" : "<pre><code>");
        code = !code;
        continue;
      }
      if (code) { output.push(`${escapeHtml(line)}\n`); continue; }
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (heading) {
        flushParagraph(); closeList();
        const level = heading[1].length;
        output.push(`<h${level}>${inlineMarkdown(heading[2], currentPath)}</h${level}>`);
      } else if (bullet || ordered) {
        flushParagraph();
        const nextType = ordered ? "ol" : "ul";
        if (listType !== nextType) { closeList(); listType = nextType; output.push(`<${listType}>`); }
        output.push(`<li>${inlineMarkdown((bullet || ordered)[1], currentPath)}</li>`);
      } else if (!line.trim()) {
        flushParagraph(); closeList();
      } else {
        paragraph.push(line.trim());
      }
    }
    flushParagraph(); closeList();
    if (code) output.push("</code></pre>");
    return output.join("\n");
  }

  async function documentText(path) {
    if (shell.docs.has(path)) return shell.docs.get(path);
    const response = await fetch(`/docs/${path}`);
    if (!response.ok) throw new Error(`Documentation returned HTTP ${response.status}.`);
    const text = await response.text();
    shell.docs.set(path, text);
    return text;
  }

  function renderHelpNavigation(query = "", matchedPaths = null) {
    const navigation = byId("help-navigation");
    navigation.replaceChildren();
    for (const [groupLabel, topics] of HELP_TOPICS) {
      const filtered = topics.filter(([title, path]) => !query || matchedPaths?.has(path) || title.toLowerCase().includes(query));
      if (!filtered.length) continue;
      const group = document.createElement("section");
      group.className = "help-nav-group";
      const heading = document.createElement("strong");
      heading.textContent = groupLabel;
      group.append(heading);
      for (const [title, path] of filtered) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = title;
        button.classList.toggle("active", path === shell.activeDocument);
        button.addEventListener("click", () => loadDocument(path));
        group.append(button);
      }
      navigation.append(group);
    }
  }

  async function loadDocument(path) {
    shell.activeDocument = path;
    renderHelpNavigation();
    const article = byId("help-document");
    article.innerHTML = "<p>Loading documentation…</p>";
    try {
      article.innerHTML = renderMarkdown(await documentText(path), path);
      article.scrollTop = 0;
      article.focus({ preventScroll: true });
    } catch (error) {
      article.innerHTML = `<h1>Documentation unavailable</h1><p>${escapeHtml(error?.message || "This topic could not be loaded.")}</p>`;
    }
  }

  async function searchHelp() {
    const query = byId("help-search").value.trim().toLowerCase();
    if (query.length < 2) { renderHelpNavigation(); return; }
    const allTopics = HELP_TOPICS.flatMap(([, topics]) => topics);
    const results = await Promise.all(allTopics.map(async ([title, path]) => {
      try {
        const text = await documentText(path);
        const index = text.toLowerCase().indexOf(query);
        if (index < 0 && !title.toLowerCase().includes(query)) return null;
        const plain = text.replace(/[#*`\[\]()]/g, " ").replace(/\s+/g, " ");
        const plainIndex = plain.toLowerCase().indexOf(query);
        const excerpt = plainIndex >= 0 ? plain.slice(Math.max(0, plainIndex - 60), plainIndex + query.length + 100) : "Matching topic";
        return { title, path, excerpt };
      } catch { return null; }
    }));
    const matches = results.filter(Boolean);
    renderHelpNavigation(query, new Set(matches.map((result) => result.path)));
    const article = byId("help-document");
    article.replaceChildren();
    const heading = document.createElement("h1");
    heading.textContent = matches.length ? `${matches.length} result${matches.length === 1 ? "" : "s"} for “${query}”` : `No results for “${query}”`;
    article.append(heading);
    const list = document.createElement("div");
    list.className = "help-search-results";
    for (const result of matches) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "help-search-result";
      const title = document.createElement("strong"); title.textContent = result.title;
      const excerpt = document.createElement("span"); excerpt.textContent = `…${result.excerpt}…`;
      button.append(title, excerpt);
      button.addEventListener("click", () => { byId("help-search").value = ""; loadDocument(result.path); });
      list.append(button);
    }
    article.append(list);
  }

  async function openProjectWebsite(url = PROJECT_URL) {
    if (shell.desktop?.openProjectWebsite) return shell.desktop.openProjectWebsite(url);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function checkForUpdates({ force = false, manual = false } = {}) {
    const status = byId("settings-update-status");
    const button = byId("settings-check-updates");
    if (!shell.desktop?.checkForUpdates) {
      if (manual) status.textContent = "Update checking is available after HDR Finisher is relaunched.";
      return null;
    }
    if (button.disabled) return null;
    if (manual) status.textContent = "Checking GitHub…";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    let timeoutId = 0;
    try {
      const timeout = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("Update check timed out.")), 12000);
      });
      const result = await Promise.race([shell.desktop.checkForUpdates({ force }), timeout]);
      if (result.status === "available") {
        status.textContent = `Version ${result.latestVersion} is available (installed: ${result.currentVersion}).`;
        const dismissed = shell.preferences.updates.dismissedVersion === result.latestVersion;
        if (manual || !dismissed) {
          byId("update-notice-detail").textContent = `Version ${result.latestVersion} is available; you have ${result.currentVersion}.`;
          byId("update-notice").dataset.version = result.latestVersion;
          byId("update-notice").dataset.url = result.releaseUrl;
          byId("update-notice").classList.remove("hidden");
        }
      } else if (result.status === "current") {
        status.textContent = `HDR Finisher ${result.currentVersion} is up to date.`;
        byId("update-notice").classList.add("hidden");
        delete byId("update-notice").dataset.version;
        delete byId("update-notice").dataset.url;
      } else {
        status.textContent = "Could not check for updates. Check your connection and try again.";
      }
      return result;
    } catch (error) {
      console.warn("GitHub update check did not complete.", error);
      status.textContent = error?.message === "Update check timed out."
        ? "Update check timed out. Relaunch HDR Finisher and try again."
        : "Could not check for updates. Check your connection and try again.";
      return null;
    } finally {
      window.clearTimeout(timeoutId);
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  function bindUi() {
    byId("settings-open").addEventListener("click", () => openSettings());
    byId("help-open").addEventListener("click", () => openHelp());
    byId("settings-close").addEventListener("click", () => byId("settings-dialog").close());
    byId("help-close").addEventListener("click", () => byId("help-dialog").close());
    for (const dialog of [byId("settings-dialog"), byId("help-dialog")]) {
      dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    }
    document.querySelectorAll("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => selectSettingsTab(button.dataset.settingsTab)));
    byId("hdr-reference-white").addEventListener("change", (event) => {
      shell.preferences.defaultReferenceWhiteNits = Number(event.target.value) === 100 ? 100 : 203;
      persistPreferences();
    });
    byId("settings-rendering-mode").addEventListener("change", (event) => {
      shell.preferences.renderingMode = event.target.value;
      persistPreferences();
    });
    byId("settings-auto-updates").addEventListener("change", (event) => {
      shell.preferences.updates.checkAutomatically = event.target.checked;
      persistPreferences();
    });
    byId("shortcut-search").addEventListener("input", renderShortcutList);
    byId("shortcuts-reset-all").addEventListener("click", () => {
      if (!window.confirm("Reset every keyboard shortcut to its default?")) return;
      shell.preferences.shortcuts = {};
      persistPreferences();
      renderShortcutList();
    });
    byId("shortcut-save-preset").addEventListener("click", () => {
      const name = window.prompt("Shortcut preset name")?.trim();
      if (!name) return;
      shell.preferences.shortcutPresets[name.slice(0, 80)] = resolvedShortcutMap();
      persistPreferences();
      renderPresetOptions();
      byId("shortcut-preset").value = name.slice(0, 80);
    });
    byId("shortcut-load-preset").addEventListener("click", () => {
      const name = byId("shortcut-preset").value;
      if (!name || !shell.preferences.shortcutPresets[name]) return;
      shell.preferences.shortcuts = clone(shell.preferences.shortcutPresets[name]);
      persistPreferences();
      renderShortcutList();
    });
    let helpTimer = 0;
    byId("help-search").addEventListener("input", () => {
      window.clearTimeout(helpTimer);
      helpTimer = window.setTimeout(searchHelp, 180);
    });
    byId("help-github").addEventListener("click", () => openProjectWebsite());
    byId("help-document").addEventListener("click", (event) => {
      const docLink = event.target.closest("[data-help-document]");
      if (docLink) { event.preventDefault(); loadDocument(docLink.dataset.helpDocument); return; }
      const external = event.target.closest('a[target="_blank"]');
      if (external && shell.desktop?.openDocumentation) {
        event.preventDefault();
        if (external.href.startsWith(PROJECT_URL)) openProjectWebsite(external.href);
        else shell.desktop.openDocumentation(external.href).catch((error) => window.alert(error?.message || "That documentation link could not be opened."));
      }
    });
    byId("settings-check-updates").addEventListener("click", () => checkForUpdates({ force: true, manual: true }));
    byId("update-notice-open").addEventListener("click", () => openProjectWebsite(byId("update-notice").dataset.url));
    byId("update-notice-dismiss").addEventListener("click", () => {
      shell.preferences.updates.dismissedVersion = byId("update-notice").dataset.version || "";
      byId("update-notice").classList.add("hidden");
      persistPreferences();
    });
    window.addEventListener("keydown", handleShortcutKeydown, true);
    window.addEventListener("keyup", handleShortcutKeyup, true);
    window.addEventListener("blur", releaseHeldActions);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) releaseHeldActions();
    });
  }

  async function init(options = {}) {
    shell.desktop = options.desktop || null;
    shell.onPreferencesChanged = options.onPreferencesChanged || (() => {});
    shell.adjustControl = options.adjustControl || (() => false);
    shell.preferences = await loadPreferences();
    if (shell.desktop?.getDefaultPresetDirectory) {
      try { shell.defaultPresetDirectory = await shell.desktop.getDefaultPresetDirectory(); } catch {}
    }
    shell.commands = [...(options.commands || []), ...buildControlCommands()];
    shell.commandMap = new Map(shell.commands.map((command) => [command.id, command]));
    bindUi();
    renderSettings();
    renderHelpNavigation();
    shell.onPreferencesChanged(clone(shell.preferences), { initial: true });
    if (shell.preferences.updates.checkAutomatically) window.setTimeout(() => checkForUpdates(), 900);
    return clone(shell.preferences);
  }

  function setRenderingModePreference(mode) {
    if (!["auto", "gpu", "cpu"].includes(mode) || !shell.preferences) return;
    shell.preferences.renderingMode = mode;
    persistPreferences();
    if (byId("settings-rendering-mode")) byId("settings-rendering-mode").value = mode;
  }

  async function listGradingPresets(groupId) {
    if (shell.desktop?.listGradingPresets) return shell.desktop.listGradingPresets(groupId);
    const presets = shell.preferences.gradingPresets[groupId];
    return Array.isArray(presets) ? clone(presets).sort((left, right) => left.name.localeCompare(right.name)) : [];
  }

  async function saveGradingPreset(preset) {
    if (shell.desktop?.saveGradingPreset) return shell.desktop.saveGradingPreset(preset);
    const group = Array.isArray(shell.preferences.gradingPresets[preset.groupId])
      ? shell.preferences.gradingPresets[preset.groupId]
      : [];
    const existing = group.findIndex((candidate) => candidate.name.toLocaleLowerCase() === preset.name.toLocaleLowerCase());
    const saved = { id: existing >= 0 ? group[existing].id : `browser-${Date.now()}`, ...clone(preset) };
    if (existing >= 0) group[existing] = saved;
    else group.push(saved);
    shell.preferences.gradingPresets[preset.groupId] = group;
    persistPreferences();
    return clone(saved);
  }

  async function deleteGradingPreset(preset) {
    if (shell.desktop?.deleteGradingPreset) return shell.desktop.deleteGradingPreset(preset.id);
    const group = shell.preferences.gradingPresets[preset.groupId] || [];
    shell.preferences.gradingPresets[preset.groupId] = group.filter((candidate) => candidate.id !== preset.id);
    persistPreferences();
    return true;
  }

  window.HDRApplicationShell = Object.freeze({
    init,
    openSettings,
    openHelp,
    checkForUpdates,
    setRenderingModePreference,
    listGradingPresets,
    saveGradingPreset,
    deleteGradingPreset,
    preferences: () => clone(shell.preferences),
  });
}());
