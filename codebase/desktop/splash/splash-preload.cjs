const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hdrSplash", {
  onStep: (callback) => ipcRenderer.on("splash:step", (_event, step) => callback(step)),
});
