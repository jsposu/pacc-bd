const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('paccDesktop', {
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
})
