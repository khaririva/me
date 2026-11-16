const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('macDesktop', {
  isElectron: true,
  platform: process.platform,
  openEpubDialog: () => ipcRenderer.invoke('mac:open-epub-dialog'),
  isFullScreen: () => ipcRenderer.invoke('mac:is-fullscreen'),
  onFullScreenChanged: (callback) => {
    const handler = (_event, isFullScreen) => callback(Boolean(isFullScreen));
    ipcRenderer.on('window:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler);
  },
  onEpubOpenedFromMenu: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('epub:opened-from-mac', handler);
    return () => ipcRenderer.removeListener('epub:opened-from-mac', handler);
  },
});
