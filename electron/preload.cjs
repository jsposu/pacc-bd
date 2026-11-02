const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('paccDesktop', {
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
  getZoom: () => ipcRenderer.invoke('get-zoom'),
  setZoom: value => ipcRenderer.invoke('set-zoom', value),
})
