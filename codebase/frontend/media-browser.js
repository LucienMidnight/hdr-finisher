async function openMediaBrowser(mode, path = "", options = {}) {
  els.directoryBrowser.dataset.mode = mode;
  delete els.directoryBrowser.dataset.selectedPath;
  const projectMode = mode === "project_open" || mode === "project_save";
  els.directoryBrowserTitle.textContent = mode === "source"
    ? "Choose a source image"
    : mode === "project_open"
      ? "Open Project"
      : mode === "project_save"
        ? "Save Project"
        : "Choose save folder";
  els.directoryBrowserSelect.textContent = mode === "source"
    ? "Open image"
    : mode === "project_open"
      ? "Open Project"
      : mode === "project_save"
        ? "Save Project"
        : "Select this folder";
  els.directoryBrowserFilenameRow.hidden = mode !== "project_save";
  els.directoryBrowserFilename.value = mode === "project_save" ? String(options.suggestedName || "Untitled.hdrfinisher") : "";
  els.directoryBrowserList.setAttribute("aria-label", projectMode ? "Folders and HDR Finisher projects" : "Folders and supported images");
  els.directoryBrowserPreview.hidden = true;
  els.directoryBrowserSelection.textContent = mode === "source"
    ? "No image selected"
    : mode === "project_open"
      ? "No project selected"
      : mode === "project_save"
        ? "Project destination"
        : "Folder selection";
  els.directoryBrowserPreviewNote.textContent = mode === "source"
    ? "Select a supported image to preview it."
    : mode === "project_open"
      ? "Select an HDR Finisher project to open."
      : mode === "project_save"
        ? "Choose a folder and enter the project file name below."
    : "Files remain visible so you can confirm the destination.";
  if (!els.directoryBrowser.open) els.directoryBrowser.showModal();
  await loadMediaDirectory(path);
}

async function chooseProjectPath(mode, path, suggestedName = "") {
  if (!desktop?.grantProjectPath) return null;
  if (state.mediaBrowserResolver) state.mediaBrowserResolver(null);
  return new Promise((resolve) => {
    state.mediaBrowserResolver = resolve;
    openMediaBrowser(mode, path, { suggestedName }).catch((error) => {
      console.error(error);
      settleMediaBrowserSelection(null);
    });
  });
}

function settleMediaBrowserSelection(selection) {
  const resolve = state.mediaBrowserResolver;
  state.mediaBrowserResolver = null;
  resolve?.(selection);
}

function updateProjectSaveBrowserAction() {
  if (els.directoryBrowser.dataset.mode !== "project_save") return;
  els.directoryBrowserSelect.disabled = !els.directoryBrowserFilename.value.trim();
}

function formatMediaBrowserSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "--";
  if (value < 1000) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value;
  let unit = "B";
  for (const candidate of units) {
    scaled /= 1000;
    unit = candidate;
    if (scaled < 1000) break;
  }
  return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)} ${unit}`;
}

function formatMediaBrowserDate(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value)) return "--";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function mediaBrowserCell(className, value) {
  const cell = document.createElement("span");
  cell.className = className;
  cell.textContent = value;
  cell.title = value;
  return cell;
}

const MEDIA_BROWSER_COLUMN_MINIMUMS = Object.freeze({ name: 120, size: 62, kind: 90, date: 120 });
const MEDIA_BROWSER_COLUMN_MAXIMUM = 640;

function sortedMediaBrowserEntries(entries) {
  const key = state.mediaBrowserSortKey;
  const direction = state.mediaBrowserSortDirection === "descending" ? -1 : 1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const valueFor = (entry) => {
    if (key === "size") return Number(entry.size ?? -1);
    if (key === "date") return Number(entry.date_added_ms ?? -1);
    if (key === "kind") return entry.kind_label || (entry.kind === "directory" ? "Folder" : "File");
    return entry.name || "";
  };
  return entries.map((entry, index) => ({ entry, index })).sort((left, right) => {
    if (left.entry.kind !== right.entry.kind) return left.entry.kind === "directory" ? -1 : 1;
    const leftValue = valueFor(left.entry);
    const rightValue = valueFor(right.entry);
    const comparison = typeof leftValue === "number"
      ? leftValue - rightValue
      : collator.compare(String(leftValue), String(rightValue));
    if (comparison) return comparison * direction;
    const nameComparison = collator.compare(left.entry.name || "", right.entry.name || "");
    return nameComparison || left.index - right.index;
  }).map(({ entry }) => entry);
}

function updateMediaBrowserSortHeaders() {
  for (const button of els.directoryBrowserSortButtons) {
    const active = button.dataset.mediaBrowserSort === state.mediaBrowserSortKey;
    const direction = active ? state.mediaBrowserSortDirection : "none";
    button.parentElement.setAttribute("aria-sort", direction);
    button.setAttribute(
      "aria-label",
      active
        ? `Sort by ${button.textContent}, currently ${direction}`
        : `Sort by ${button.textContent}`,
    );
  }
}

function sortMediaBrowserBy(key) {
  if (!MEDIA_BROWSER_COLUMN_MINIMUMS[key]) return;
  if (state.mediaBrowserSortKey === key) {
    state.mediaBrowserSortDirection = state.mediaBrowserSortDirection === "ascending" ? "descending" : "ascending";
  } else {
    state.mediaBrowserSortKey = key;
    state.mediaBrowserSortDirection = key === "date" ? "descending" : "ascending";
  }
  updateMediaBrowserSortHeaders();
  renderMediaBrowserEntries(state.mediaBrowserEntries, els.directoryBrowser.dataset.mode || "source");
}

function captureMediaBrowserColumnWidths() {
  if (state.mediaBrowserColumnWidths) return;
  state.mediaBrowserColumnWidths = Object.fromEntries(els.directoryBrowserSortButtons.map((button) => [
    button.dataset.mediaBrowserSort,
    Math.round(button.parentElement.getBoundingClientRect().width),
  ]));
  applyMediaBrowserColumnWidths();
}

function applyMediaBrowserColumnWidths() {
  if (!state.mediaBrowserColumnWidths) return;
  let trackWidth = 0;
  for (const [column, width] of Object.entries(state.mediaBrowserColumnWidths)) {
    const clamped = Math.max(MEDIA_BROWSER_COLUMN_MINIMUMS[column], Math.min(MEDIA_BROWSER_COLUMN_MAXIMUM, width));
    state.mediaBrowserColumnWidths[column] = clamped;
    els.directoryBrowserTable.style.setProperty(`--media-browser-${column}-column`, `${clamped}px`);
    trackWidth += clamped;
    const resizer = els.directoryBrowserColumnResizers.find((item) => item.dataset.mediaBrowserResize === column);
    resizer?.setAttribute("aria-valuemin", String(MEDIA_BROWSER_COLUMN_MINIMUMS[column]));
    resizer?.setAttribute("aria-valuemax", String(MEDIA_BROWSER_COLUMN_MAXIMUM));
    resizer?.setAttribute("aria-valuenow", String(clamped));
  }
  els.directoryBrowserTable.style.setProperty("--media-browser-grid-width", `${trackWidth + 68}px`);
}

function setMediaBrowserColumnWidth(column, width) {
  captureMediaBrowserColumnWidths();
  state.mediaBrowserColumnWidths[column] = width;
  applyMediaBrowserColumnWidths();
}

function beginMediaBrowserColumnResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  captureMediaBrowserColumnWidths();
  const column = event.currentTarget.dataset.mediaBrowserResize;
  state.mediaBrowserColumnResize = {
    column,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: state.mediaBrowserColumnWidths[column],
    handle: event.currentTarget,
  };
  event.currentTarget.classList.add("resizing");
  event.currentTarget.setPointerCapture(event.pointerId);
}

function continueMediaBrowserColumnResize(event) {
  const resize = state.mediaBrowserColumnResize;
  if (!resize || resize.pointerId !== event.pointerId || resize.handle !== event.currentTarget) return;
  event.preventDefault();
  setMediaBrowserColumnWidth(resize.column, resize.startWidth + event.clientX - resize.startX);
}

function endMediaBrowserColumnResize(event) {
  const resize = state.mediaBrowserColumnResize;
  if (!resize || resize.handle !== event.currentTarget) return;
  resize.handle.classList.remove("resizing");
  state.mediaBrowserColumnResize = null;
}

function handleMediaBrowserColumnResizeKeydown(event) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  captureMediaBrowserColumnWidths();
  const column = event.currentTarget.dataset.mediaBrowserResize;
  const amount = event.shiftKey ? 32 : 12;
  setMediaBrowserColumnWidth(column, state.mediaBrowserColumnWidths[column] + (event.key === "ArrowRight" ? amount : -amount));
}

function mediaBrowserPreviewWidthLimits() {
  const layoutWidth = els.directoryBrowserLayout.getBoundingClientRect().width;
  const sidebarWidth = els.directoryBrowserLayout.querySelector(".media-browser-sidebar")?.getBoundingClientRect().width || 180;
  return {
    minimum: 220,
    maximum: Math.max(220, Math.min(720, layoutWidth - sidebarWidth - 328)),
  };
}

function setMediaBrowserPreviewWidth(width) {
  const limits = mediaBrowserPreviewWidthLimits();
  const clamped = Math.round(Math.max(limits.minimum, Math.min(limits.maximum, width)));
  state.mediaBrowserPreviewWidth = clamped;
  els.directoryBrowserLayout.style.setProperty("--media-browser-preview-width", `${clamped}px`);
  els.directoryBrowserPreviewResizer.setAttribute("aria-valuemin", String(limits.minimum));
  els.directoryBrowserPreviewResizer.setAttribute("aria-valuemax", String(Math.round(limits.maximum)));
  els.directoryBrowserPreviewResizer.setAttribute("aria-valuenow", String(clamped));
}

function captureMediaBrowserPreviewWidth() {
  if (state.mediaBrowserPreviewWidth === null) {
    setMediaBrowserPreviewWidth(els.directoryBrowserPreviewPane.getBoundingClientRect().width);
  }
}

function beginMediaBrowserPreviewResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  captureMediaBrowserPreviewWidth();
  state.mediaBrowserPreviewResize = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: state.mediaBrowserPreviewWidth,
  };
  event.currentTarget.classList.add("resizing");
  event.currentTarget.setPointerCapture(event.pointerId);
}

function continueMediaBrowserPreviewResize(event) {
  const resize = state.mediaBrowserPreviewResize;
  if (!resize || resize.pointerId !== event.pointerId) return;
  event.preventDefault();
  setMediaBrowserPreviewWidth(resize.startWidth + resize.startX - event.clientX);
}

function endMediaBrowserPreviewResize(event) {
  if (!state.mediaBrowserPreviewResize) return;
  event.currentTarget.classList.remove("resizing");
  state.mediaBrowserPreviewResize = null;
}

function handleMediaBrowserPreviewResizeKeydown(event) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  captureMediaBrowserPreviewWidth();
  const amount = event.shiftKey ? 48 : 24;
  setMediaBrowserPreviewWidth(state.mediaBrowserPreviewWidth + (event.key === "ArrowLeft" ? amount : -amount));
}

function renderMediaBrowserEntries(entries, mode) {
  const selectedPath = els.directoryBrowser.dataset.selectedPath || "";
  els.directoryBrowserList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "directory-browser-empty";
    empty.textContent = "This folder is empty.";
    els.directoryBrowserList.append(empty);
    return;
  }
  sortedMediaBrowserEntries(entries).forEach((entry) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `directory-browser-entry ${entry.kind}`;
    button.mediaBrowserEntry = entry;
    button.title = entry.path;
    if (entry.path === selectedPath) button.classList.add("selected");
    button.append(
      mediaBrowserCell("directory-browser-entry-name", entry.name),
      mediaBrowserCell("directory-browser-entry-size", entry.kind === "directory" ? "--" : formatMediaBrowserSize(entry.size)),
      mediaBrowserCell("directory-browser-entry-kind", entry.kind_label || (entry.kind === "directory" ? "Folder" : "File")),
      mediaBrowserCell("directory-browser-entry-date", formatMediaBrowserDate(entry.date_added_ms)),
    );
    if (entry.kind === "directory") {
      button.addEventListener("dblclick", () => loadMediaDirectory(entry.path));
      button.addEventListener("click", () => {
        state.mediaPreviewGeneration += 1;
        clearMediaBrowserPreview();
        if (mode === "export_directory") {
          els.directoryBrowser.dataset.selectedPath = entry.path;
          els.directoryBrowserSelect.disabled = false;
        } else {
          delete els.directoryBrowser.dataset.selectedPath;
          els.directoryBrowserSelect.disabled = mode === "project_save" ? !els.directoryBrowserFilename.value.trim() : true;
        }
        els.directoryBrowserSelection.textContent = entry.name;
        els.directoryBrowserPreviewNote.textContent = "Double-click to open this folder.";
        selectMediaBrowserEntry(button);
      });
    } else if (mode === "source" && entry.supported) {
      button.classList.add("supported");
      button.addEventListener("click", () => previewMediaBrowserFile(entry, button));
      button.addEventListener("dblclick", async () => {
        previewMediaBrowserFile(entry, button);
        await confirmMediaBrowserSelection();
      });
    } else if (["project_open", "project_save"].includes(mode) && entry.supported) {
      button.classList.add("supported");
      button.addEventListener("click", () => {
        state.mediaPreviewGeneration += 1;
        clearMediaBrowserPreview();
        els.directoryBrowser.dataset.selectedPath = entry.path;
        selectMediaBrowserEntry(button);
        els.directoryBrowserSelection.textContent = entry.name;
        els.directoryBrowserPreviewNote.textContent = mode === "project_open"
          ? "HDR Finisher project selected."
          : "Saving will replace this project after confirmation.";
        if (mode === "project_save") els.directoryBrowserFilename.value = entry.name;
        els.directoryBrowserSelect.disabled = false;
      });
      button.addEventListener("dblclick", async () => {
        button.click();
        await confirmMediaBrowserSelection();
      });
    } else {
      button.disabled = true;
      button.setAttribute("aria-label", `${entry.name}, file`);
    }
    item.append(button);
    els.directoryBrowserList.append(item);
  });
}

async function loadMediaDirectory(path) {
  const generation = ++state.mediaBrowserGeneration;
  state.mediaPreviewGeneration += 1;
  clearMediaBrowserPreview();
  els.directoryBrowserStatus.textContent = "Loading folders…";
  els.directoryBrowserList.replaceChildren();
  els.directoryBrowserGo.disabled = true;
  els.directoryBrowserUp.disabled = true;
  els.directoryBrowserSelect.disabled = true;
  try {
    const mode = els.directoryBrowser.dataset.mode || "source";
    const params = new URLSearchParams({ mode });
    if (path?.trim()) params.set("path", path.trim());
    const response = await fetch(`/api/media-browser?${params}`);
    const payload = await safeJson(response);
    if (generation !== state.mediaBrowserGeneration) return;
    if (!response.ok) {
      els.directoryBrowserStatus.textContent = responseErrorMessage(payload, "Could not open that folder.");
      return;
    }

    els.directoryBrowserPath.value = payload.current;
    els.directoryBrowser.dataset.parent = payload.parent || "";
    els.directoryBrowserUp.disabled = !payload.parent;
    els.directoryBrowserSelect.disabled = mode === "source" || mode === "project_open";
    if (mode === "project_save") updateProjectSaveBrowserAction();
    delete els.directoryBrowser.dataset.selectedPath;
    renderMediaBrowserNavigation(
      payload.recents || [],
      payload.pinned || [],
      payload.locations || [],
      payload.drives || [],
    );
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    state.mediaBrowserEntries = entries;
    updateMediaBrowserSortHeaders();
    renderMediaBrowserEntries(entries, mode);
    const folderCount = entries.filter((entry) => entry.kind === "directory").length;
    const fileCount = entries.length - folderCount;
    els.directoryBrowserStatus.textContent = `${folderCount} folder${folderCount === 1 ? "" : "s"}, ${fileCount} file${fileCount === 1 ? "" : "s"}`;
  } catch (error) {
    if (generation !== state.mediaBrowserGeneration) return;
    console.error(error);
    els.directoryBrowserStatus.textContent = "Could not reach the local HDR Finisher server.";
  } finally {
    if (generation === state.mediaBrowserGeneration) els.directoryBrowserGo.disabled = false;
  }
}

function renderMediaBrowserNavigation(recents, pinned, locations, drives) {
  const render = (container, entries, removable) => {
    container.replaceChildren();
    for (const entry of entries) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.available ? entry.name : `${entry.name} · unavailable`;
      button.disabled = !entry.available;
      button.addEventListener("click", () => loadMediaDirectory(entry.path));
      item.append(button);
      if (removable) {
        button.title = entry.available ? "Open pinned folder" : "This pinned folder is currently unavailable";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "media-browser-pinned-remove";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${entry.name} from pinned folders`);
        remove.addEventListener("click", async () => {
          await fetch(`/api/media-browser/pinned?path=${encodeURIComponent(entry.path)}`, { method: "DELETE" });
          await loadMediaDirectory(els.directoryBrowserPath.value);
        });
        item.append(remove);
      }
      container.append(item);
    }
  };
  const seenLocations = new Set();
  const allLocations = [...locations, ...drives].filter((entry) => {
    if (seenLocations.has(entry.path)) return false;
    seenLocations.add(entry.path);
    return true;
  });
  render(els.directoryBrowserRecents, recents, false);
  render(els.directoryBrowserPinned, pinned, true);
  render(els.directoryBrowserLocations, allLocations, false);
}

function selectMediaBrowserEntry(button) {
  els.directoryBrowserList.querySelectorAll(".selected").forEach((entry) => entry.classList.remove("selected"));
  button.classList.add("selected");
}

function handleMediaBrowserListKeydown(event) {
  const current = event.target.closest(".directory-browser-entry:not(:disabled)");
  if (!current) return;
  if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    const entries = Array.from(els.directoryBrowserList.querySelectorAll(".directory-browser-entry:not(:disabled)"));
    const currentIndex = entries.indexOf(current);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? entries.length - 1
        : Math.max(0, Math.min(entries.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
    const next = entries[nextIndex];
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest" });
    next.click();
    return;
  }
  const entry = current.mediaBrowserEntry;
  if (event.key === "ArrowLeft" && els.directoryBrowser.dataset.parent) {
    event.preventDefault();
    loadMediaDirectory(els.directoryBrowser.dataset.parent);
  } else if ((event.key === "ArrowRight" || event.key === "Enter") && entry?.kind === "directory") {
    event.preventDefault();
    loadMediaDirectory(entry.path);
  } else if (event.key === "Enter" && entry?.supported) {
    event.preventDefault();
    if (els.directoryBrowser.dataset.mode === "source") previewMediaBrowserFile(entry, current);
    else current.click();
    confirmMediaBrowserSelection();
  }
}

function clearMediaBrowserPreview() {
  state.mediaPreviewRequest?.abort?.();
  state.mediaPreviewRequest = null;
  if (state.mediaPreviewObjectUrl) URL.revokeObjectURL(state.mediaPreviewObjectUrl);
  state.mediaPreviewObjectUrl = null;
  els.directoryBrowserPreview.onload = null;
  els.directoryBrowserPreview.onerror = null;
  els.directoryBrowserPreview.removeAttribute("src");
  els.directoryBrowserPreview.hidden = true;
  els.directoryBrowserPreviewFrame.removeAttribute("data-preview-state");
  els.directoryBrowserPreviewFrame.removeAttribute("role");
  els.directoryBrowserPreviewFrame.removeAttribute("aria-label");
}

async function previewMediaBrowserFile(entry, button) {
  const generation = ++state.mediaPreviewGeneration;
  renderExperimentalDngNote(entry);
  els.directoryBrowser.dataset.selectedPath = entry.path;
  els.directoryBrowserSelect.disabled = false;
  selectMediaBrowserEntry(button);
  clearMediaBrowserPreview();
  els.directoryBrowserSelection.textContent = entry.name;
  const hdrPossible = window.matchMedia?.("(dynamic-range: high)")?.matches && ["avif", "jxl", "exr", "dng"].includes(entry.format);
  const readyNote = `${String(entry.format || "image").toUpperCase()} · ${hdrPossible ? "HDR selected preview follows after opening" : "SDR browser thumbnail"}`;
  els.directoryBrowserPreviewNote.textContent = `${String(entry.format || "image").toUpperCase()} · Loading preview…`;

  const params = new URLSearchParams({
    path: entry.path,
    size: "512",
    key: entry.thumbnail_key || "",
    version: "natural-aspect-v4",
  });
  const previewUrl = `/api/media-browser/thumbnail?${params}`;
  const request = new AbortController();
  state.mediaPreviewRequest = request;
  const failPreview = () => {
    if (generation !== state.mediaPreviewGeneration || state.mediaPreviewRequest !== request) return;
    clearMediaBrowserPreview();
    els.directoryBrowserPreviewNote.textContent = "Preview unavailable; you can still open the source.";
  };
  try {
    const response = await fetch(previewUrl, { signal: request.signal });
    if (generation !== state.mediaPreviewGeneration || state.mediaPreviewRequest !== request) return;
    if (response.status === 409) {
      const payload = await safeJson(response);
      const detail = payload?.detail;
      if (detail?.code === "interpretation_required") {
        const profile = detail.profile_name ? ` Embedded profile: “${detail.profile_name}”.` : "";
        clearMediaBrowserPreview();
        els.directoryBrowserPreviewFrame.dataset.previewState = "interpretation-required";
        els.directoryBrowserPreviewFrame.setAttribute("role", "img");
        els.directoryBrowserPreviewFrame.setAttribute("aria-label", "Preview withheld because color interpretation is required");
        els.directoryBrowserPreviewNote.textContent = `Color interpretation required. ${detail.message}${profile} Preview withheld to avoid misleading color; open the image to review its interpretation.`;
        return;
      }
    }
    if (!response.ok) throw new Error(`Thumbnail request failed with status ${response.status}.`);
    const blob = await response.blob();
    if (generation !== state.mediaPreviewGeneration || state.mediaPreviewRequest !== request) return;
    const objectUrl = URL.createObjectURL(blob);
    state.mediaPreviewObjectUrl = objectUrl;
    els.directoryBrowserPreview.onload = () => {
      if (generation !== state.mediaPreviewGeneration || state.mediaPreviewRequest !== request) return;
      els.directoryBrowserPreview.onload = null;
      els.directoryBrowserPreview.onerror = null;
      els.directoryBrowserPreview.hidden = false;
      els.directoryBrowserPreviewNote.textContent = readyNote;
      state.mediaPreviewRequest = null;
    };
    els.directoryBrowserPreview.onerror = failPreview;
    els.directoryBrowserPreview.src = objectUrl;
    els.directoryBrowserPreview.alt = `Preview of ${entry.name}`;
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    failPreview();
  }
}

async function pinCurrentMediaFolder() {
  const path = els.directoryBrowserPath.value.trim();
  if (!path) return;
  const response = await fetch("/api/media-browser/pinned", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    els.directoryBrowserStatus.textContent = responseErrorMessage(payload, "Could not pin that folder.");
    return;
  }
  await loadMediaDirectory(path);
}

async function recordSuccessfulMediaImport(path) {
  if (!path) return;
  try {
    const response = await fetch("/api/media-browser/recents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) console.warn("The imported folder could not be added to Recents.");
  } catch (error) {
    console.warn("The imported folder could not be added to Recents.", error);
  }
}

function closeExportDirectoryBrowser() {
  if (els.directoryBrowser.open) els.directoryBrowser.close();
  settleMediaBrowserSelection(null);
}

async function confirmMediaBrowserSelection() {
  const mode = els.directoryBrowser.dataset.mode || "source";
  const selected = els.directoryBrowser.dataset.selectedPath || els.directoryBrowserPath.value.trim();
  if (!selected) return;
  if (mode === "export_directory") {
    const directory = els.directoryBrowserList.querySelector(".selected.directory")
      ? selected
      : els.directoryBrowserPath.value.trim();
    els.exportDirectory.value = directory;
    els.exportStatus.textContent = `Save folder set to ${directory}`;
    closeExportDirectoryBrowser();
    return;
  }
  if (mode === "project_open" || mode === "project_save") {
    try {
      const requestedPath = mode === "project_open"
        ? els.directoryBrowser.dataset.selectedPath
        : joinExportPath(els.directoryBrowserPath.value.trim(), sanitizeProjectFilename(els.directoryBrowserFilename.value));
      if (!requestedPath) return;
      const selection = await desktop.grantProjectPath(requestedPath, mode === "project_open" ? "project-open" : "project-save");
      if (mode === "project_save" && selection.exists) {
        const approved = await window.HDRDialogs.confirm(
          `Replace the existing project?\n\n${selection.path}`,
          { title: "Replace project", confirmLabel: "Replace", destructive: true },
        );
        if (!approved) {
          els.directoryBrowserStatus.textContent = "The existing project was left unchanged.";
          return;
        }
        selection.grant = (await desktop.grantProjectPath(selection.path, "project-save")).grant;
      }
      const resolve = state.mediaBrowserResolver;
      state.mediaBrowserResolver = null;
      if (els.directoryBrowser.open) els.directoryBrowser.close();
      resolve?.(selection);
    } catch (error) {
      status.post({
        id: mode === "project_open" ? "project-open" : "project-save",
        severity: "error",
        message: error?.message || `Could not ${mode === "project_open" ? "open" : "save"} that project.`,
      });
    }
    return;
  }
  if (!desktop) {
    closeExportDirectoryBrowser();
    els.fileInput.click();
    return;
  }
  let selection;
  try {
    selection = await desktop.grantSourcePath(selected);
  } catch (error) {
    els.directoryBrowserStatus.textContent = error?.message || "Could not open that source image.";
    return;
  }
  closeExportDirectoryBrowser();
  try {
    await openDesktopSelection({ kind: "source", ...selection });
  } catch (error) {
    console.error(error);
    showUploadError(error?.message || "Could not open that source image.");
  }
}

