const { contextBridge, ipcRenderer, webUtils } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("hdrFinisherDesktop", Object.freeze({
  apiVersion: 1,
  environment: () => ipcRenderer.invoke("desktop:environment"),
  setRenderingMode: (mode) => ipcRenderer.invoke("desktop:set-rendering-mode", mode),
  writeClipboardText: (value) => ipcRenderer.invoke("desktop:write-clipboard-text", value),
  openSource: () => ipcRenderer.invoke("desktop:open-source"),
  grantSourcePath: (filePath) => ipcRenderer.invoke("desktop:grant-source-path", filePath),
  openProject: () => ipcRenderer.invoke("desktop:open-project"),
  relinkSource: () => ipcRenderer.invoke("desktop:relink-source"),
  saveProject: (options) => ipcRenderer.invoke("desktop:save-project", options),
  confirmUnsavedTransition: (options) => ipcRenderer.invoke("desktop:confirm-unsaved-transition", options),
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
  onMenuCommand: (callback) => subscribe("desktop:menu-command", callback),
  onOpenRequest: (callback) => subscribe("desktop:open-request", callback),
}));
