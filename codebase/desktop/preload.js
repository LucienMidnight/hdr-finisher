const { contextBridge, ipcRenderer, webUtils } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("hdrFinisherDesktop", Object.freeze({
  apiVersion: 2,
  startupTheme: process.argv.find(value => value.startsWith("--hdr-finisher-theme="))?.split("=")[1] || "default-dark",
  platform: process.platform,
  environment: () => ipcRenderer.invoke("desktop:environment"),
  videoMemory: () => ipcRenderer.invoke("desktop:video-memory"),
  rendererReady: () => ipcRenderer.invoke("desktop:renderer-ready"),
  getPreferences: () => ipcRenderer.invoke("desktop:get-preferences"),
  getDefaultPresetDirectory: () => ipcRenderer.invoke("desktop:get-default-preset-directory"),
  listGradingPresets: (groupId) => ipcRenderer.invoke("desktop:list-grading-presets", groupId),
  saveGradingPreset: (preset) => ipcRenderer.invoke("desktop:save-grading-preset", preset),
  deleteGradingPreset: (presetId) => ipcRenderer.invoke("desktop:delete-grading-preset", presetId),
  setPreferences: (preferences) => ipcRenderer.invoke("desktop:set-preferences", preferences),
  chooseLibraryCacheDirectory: () => ipcRenderer.invoke("desktop:choose-library-cache-directory"),
  libraryCacheOptions: () => ipcRenderer.invoke("desktop:library-cache-options"),
  revealLibraryCacheDirectory: (folder) => ipcRenderer.invoke("desktop:reveal-library-cache-directory", folder),
  choosePreferenceDirectory: (key) => ipcRenderer.invoke("desktop:choose-preference-directory", key),
  revealPreferenceDirectory: (key) => ipcRenderer.invoke("desktop:reveal-preference-directory", key),
  checkForUpdates: (options) => ipcRenderer.invoke("desktop:check-for-updates", options),
  openProjectWebsite: (url) => ipcRenderer.invoke("desktop:open-project-website", url),
  openDocumentation: (url) => ipcRenderer.invoke("desktop:open-documentation", url),
  setRenderingMode: (mode) => ipcRenderer.invoke("desktop:set-rendering-mode", mode),
  writeClipboardText: (value) => ipcRenderer.invoke("desktop:write-clipboard-text", value),
  openSource: () => ipcRenderer.invoke("desktop:open-source"),
  popOutLibrary: (state) => ipcRenderer.invoke("desktop:pop-out-library", state),
  getLibraryWindow: () => ipcRenderer.invoke("desktop:get-library-window"),
  dockLibrary: (state) => ipcRenderer.invoke("desktop:dock-library", state),
  focusLibrary: () => ipcRenderer.invoke("desktop:focus-library"),
  prepareLibraryPaste: (paths) => ipcRenderer.invoke("desktop:prepare-library-paste", paths),
  completeLibraryPaste: (requestId, allowed) => ipcRenderer.invoke("desktop:complete-library-paste", requestId, allowed),
  forwardLibraryAction: (action, detail) => ipcRenderer.invoke("desktop:forward-library-action", action, detail),
  setLibraryCommandState: (state) => ipcRenderer.invoke("desktop:set-library-command-state", state),
  sendLibraryCommand: (command) => ipcRenderer.invoke("desktop:send-library-command", command),
  chooseBatchExportDirectory: (initialPath) => ipcRenderer.invoke("desktop:choose-batch-export-directory", initialPath),
  chooseSourceInMain: () => ipcRenderer.invoke("desktop:choose-source-in-main"),
  onLibraryWindowChanged: (callback) => subscribe("desktop:library-window", callback),
  openDroppedFileInMain: async (file) => {
    let filePath = "";
    try { filePath = webUtils.getPathForFile(file); } catch {}
    return ipcRenderer.invoke("desktop:open-drop-in-main", filePath
      ? { path: filePath } : { name: file.name, bytes: await file.arrayBuffer() });
  },
  openSourceInMain: (filePath, itemKey) => ipcRenderer.invoke("desktop:open-source-in-main", filePath, itemKey),
  grantSourcePath: (filePath) => ipcRenderer.invoke("desktop:grant-source-path", filePath),
  grantProjectPath: (filePath, intent) => ipcRenderer.invoke("desktop:grant-project-path", filePath, intent),
  listRecentProjects: () => ipcRenderer.invoke("desktop:recent-projects"),
  openProject: () => ipcRenderer.invoke("desktop:open-project"),
  relinkSource: () => ipcRenderer.invoke("desktop:relink-source"),
  saveProject: (options) => ipcRenderer.invoke("desktop:save-project", options),
  confirmUnsavedTransition: (options) => ipcRenderer.invoke("desktop:confirm-unsaved-transition", options),
  completePhotoClose: (allowed) => ipcRenderer.invoke("desktop:complete-photo-close", allowed),
  chooseExportPath: (options) => ipcRenderer.invoke("desktop:choose-export-path", options),
  chooseExportDirectory: (initialPath) => ipcRenderer.invoke("desktop:choose-export-directory", initialPath),
  resolveDroppedFile: async (file) => {
    let filePath = "";
    try { filePath = webUtils.getPathForFile(file); } catch {}
    if (!filePath) return null;
    const [selection] = await ipcRenderer.invoke("desktop:resolve-dropped-files", [filePath]);
    return selection || null;
  },
  revealPath: (filePath) => ipcRenderer.invoke("desktop:reveal-path", filePath),
  openPath: (filePath) => ipcRenderer.invoke("desktop:open-path", filePath),
  openProofExternally: (url) => ipcRenderer.invoke("desktop:open-proof", url),
  setDocumentState: (state) => ipcRenderer.invoke("desktop:set-document-state", state),
  setOperationProgress: (progress) => ipcRenderer.send("desktop:set-operation-progress", progress),
  performWindowAction: (action) => ipcRenderer.invoke("desktop:perform-window-action", action),
  getWindowState: () => ipcRenderer.invoke("desktop:get-window-state"),
  performNativeEdit: (action) => ipcRenderer.invoke("desktop:perform-native-edit", action),
  performShellAction: (action) => ipcRenderer.invoke("desktop:perform-shell-action", action),
  onMenuCommand: (callback) => subscribe("desktop:menu-command", callback),
  onWindowStateChanged: (callback) => subscribe("desktop:window-state", callback),
  onDisplayStateChanged: (callback) => subscribe("desktop:display-state", callback),
  onOpenRequest: (callback) => subscribe("desktop:open-request", callback),
}));
