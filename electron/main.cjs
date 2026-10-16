const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron')
const path = require('path')
const fsp = require('fs').promises
const fsSync = require('fs')

const devServerUrl = process.env.VITE_DEV_SERVER_URL
const { autoUpdater } = require('electron-updater')

function sendUpdaterStatus(status) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('updater:status', status)
}

/* ------------------------- 文件系统 IPC 桥 ------------------------- */

// 导入外部小说时的编码探测：严格 utf-8 优先，失败回退 gb18030（国内网文 txt 绝大多数）
function decodeText(buf) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' }
  } catch {
    /* 非合法 utf-8 */
  }
  try {
    return { text: new TextDecoder('gb18030').decode(buf), encoding: 'gb18030' }
  } catch {
    return { text: buf.toString('utf8'), encoding: 'utf-8-lossy' }
  }
}

ipcMain.handle('fs:readFile', async (_e, p) => fsp.readFile(p, 'utf8'))

ipcMain.handle('fs:readText', async (_e, p) => {
  const r = decodeText(await fsp.readFile(p))
  return { path: p, text: r.text, encoding: r.encoding }
})

ipcMain.handle('fs:writeFile', async (_e, p, content) => {
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, content, 'utf8')
  return true
})

ipcMain.handle('fs:writeBinaryFile', async (_e, p, base64) => {
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, Buffer.from(base64, 'base64'))
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

ipcMain.handle('fs:unlink', async (_e, p) => {
  await fsp.unlink(p)
  return true
})

// 正文落盘的应用数据根目录（每本书一个子目录）
ipcMain.handle('app:userData', async () => app.getPath('userData'))

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
    title: '字舟 · 网文小说编辑器',
    icon: path.join(__dirname, devServerUrl ? '../public/logo.png' : '../dist/logo.png'),
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

if (app.isPackaged) {
  let manualCheck = false
  autoUpdater.on('checking-for-update', () => sendUpdaterStatus({ kind: 'checking' }))
  autoUpdater.on('update-available', (info) => sendUpdaterStatus({ kind: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => sendUpdaterStatus({ kind: 'uptodate' }))
  autoUpdater.on('download-progress', (p) => sendUpdaterStatus({ kind: 'progress', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', () => sendUpdaterStatus({ kind: 'downloaded' }))
  // 启动自动检查失败静默（占位/无网络不打扰），仅手动检查报错
  autoUpdater.on('error', (e) => {
    if (manualCheck) sendUpdaterStatus({ kind: 'error', message: String((e && e.message) || e) })
    manualCheck = false
  })
  ipcMain.handle('updater:check', async () => {
    manualCheck = true
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      sendUpdaterStatus({ kind: 'error', message: e.message })
      manualCheck = false
    }
    return true
  })
  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
    return true
  })
} else {
  ipcMain.handle('updater:check', async () => {
    sendUpdaterStatus({ kind: 'disabled' })
    return true
  })
  ipcMain.handle('updater:install', async () => false)
}

app.whenReady().then(() => {
  // 原型阶段隐藏默认菜单栏，保持沉浸写作界面
  Menu.setApplicationMenu(null)
  createWindow()
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 6000)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
