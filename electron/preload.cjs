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
  mkdirp: (p) => ipcRenderer.invoke('fs:mkdirp', p),
  readdir: (p) => ipcRenderer.invoke('fs:readdir', p),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
  saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
})
