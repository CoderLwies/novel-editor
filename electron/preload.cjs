const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
})

contextBridge.exposeInMainWorld('fsAPI', {
  isElectron: true,
  readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
  writeFile: (p, content) => ipcRenderer.invoke('fs:writeFile', p, content),
  writeBinaryFile: (p, base64) => ipcRenderer.invoke('fs:writeBinaryFile', p, base64),
  mkdirp: (p) => ipcRenderer.invoke('fs:mkdirp', p),
  readdir: (p) => ipcRenderer.invoke('fs:readdir', p),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  unlink: (p) => ipcRenderer.invoke('fs:unlink', p),
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
  saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
})

contextBridge.exposeInMainWorld('updaterAPI', {
  check: () => ipcRenderer.invoke('updater:check'),
  install: () => ipcRenderer.invoke('updater:install'),
  onStatus: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  },
})
