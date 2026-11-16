const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('macDesktop', {
  isElectron: true,
  platform: process.platform,
  openEpubDialog: () => ipcRenderer.invoke('mac:open-epub-dialog'),
  onEpubOpenedFromMenu: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('epub:opened-from-mac', handler);
    return () => ipcRenderer.removeListener('epub:opened-from-mac', handler);
  },
});
