// The hidden worker only reports job activity; it cannot request arbitrary IPC.
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('hdrDeliveryMemory', {
  diagnosticEvent: value => ipcRenderer.send("desktop:diagnostic-event", value),
  idle: value => ipcRenderer.invoke('desktop:delivery-memory-idle', value === true),
});
