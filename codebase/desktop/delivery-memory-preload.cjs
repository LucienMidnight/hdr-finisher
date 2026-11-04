// The hidden worker only reports job activity; it cannot request arbitrary IPC.
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('hdrDeliveryMemory', {
  idle: value => ipcRenderer.send('desktop:delivery-memory-idle', value === true),
});
