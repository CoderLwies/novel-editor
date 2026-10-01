const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron')
const path = require('path')
const fsp = require('fs').promises
const fsSync = require('fs')

const devServerUrl = process.env.VITE_DEV_SERVER_URL

/* ------------------------- 文件系统 IPC 桥 ------------------------- */

ipcMain.handle('fs:readFile', async (_e, p) => fsp.readFile(p, 'utf8'))

ipcMain.handle('fs:writeFile', async (_e, p, content) => {
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, content, 'utf8')
  return true
})

ipcMain.handle('fs:mkdirp', async (_e, p) => {
  await fsp.mkdir(p, { recursive: true })
  return p
})

ipcMain.handle('fs:readdir', async (_e, p) => {
  const entries = await fsp.readdir(p, { withFileTypes: true })
  return entries.map((x) => ({ name: x.name, isDir: x.isDirectory() }))
})

ipcMain.handle('fs:exists', async (_e, p) => fsSync.existsSync(p))

ipcMain.handle('dialog:openDirectory', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('dialog:openFile', async (_e, filters) => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: filters || undefined })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('dialog:saveFile', async (_e, opts) => {
  const r = await dialog.showSaveDialog(opts || {})
  return r.canceled ? null : r.filePath
})

/* ------------------------------ 窗口 ------------------------------ */

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: '墨章 · 网文小说编辑器',
    backgroundColor: '#16161b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (devServerUrl) {
    win.loadURL(devServerUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  // 原型阶段隐藏默认菜单栏，保持沉浸写作界面
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
