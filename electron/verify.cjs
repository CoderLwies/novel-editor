const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const os = require('os')

const outDir = path.join(__dirname, '..', '.preview')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozhang-e2e-'))

// mirror of main.cjs IPC bridge; directory dialog is stubbed to a temp dir so
// the flow can run headlessly
ipcMain.handle('fs:readFile', async (_e, p) => fsp.readFile(p, 'utf8'))
ipcMain.handle('fs:writeFile', async (_e, p, content) => {
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, content, 'utf8')
  return true
})
ipcMain.handle('fs:mkdirp', async (_e, p) => { await fsp.mkdir(p, { recursive: true }); return p })
ipcMain.handle('fs:readdir', async (_e, p) =>
  (await fsp.readdir(p, { withFileTypes: true })).map((x) => ({ name: x.name, isDir: x.isDirectory() })))
ipcMain.handle('fs:exists', async (_e, p) => fs.existsSync(p))
ipcMain.handle('dialog:openDirectory', async () => projDir)
ipcMain.handle('dialog:openFile', async (_e, filters) => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: filters || undefined })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('dialog:saveFile', async (_e, opts) => {
  const r = await dialog.showSaveDialog(opts || {})
  return r.canceled ? null : r.filePath
})

async function main() {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })
  const errors = []
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message) })
  win.webContents.on('render-process-gone', () => errors.push('RENDERER_CRASHED'))

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await sleep(1200)
  // deterministic start: wipe any state left by previous runs
  await win.webContents.executeJavaScript('localStorage.clear()')
  await win.reload()
  await sleep(1400)
  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => {
    const buf = (await win.webContents.capturePage()).toPNG()
    fs.writeFileSync(path.join(outDir, name), buf)
    console.log('saved', name)
  }

  // 1) bind directory via the real UI menu
  await js(`[...document.querySelectorAll('.icon-btn')].find(b=>b.textContent.includes('文件')).click()`)
  await sleep(300)
  const bindClicked = await js(`(() => {
    const el = [...document.querySelectorAll('.menu-item')].find(b=>b.textContent.includes('绑定目录并自动同步'))
    if (!el) return 'NOT_FOUND'
    el.click()
    return 'OK'
  })()`)
  console.log('bind menu click:', bindClicked)
  await sleep(1800)
  const onDisk = fs.existsSync(path.join(projDir, 'book.json'))
    ? fs.readdirSync(path.join(projDir, 'chapters')).length
    : -1
  console.log('E2E bind+autosync -> chapters on disk:', onDisk)
  await shot('08-bound-badge.png')

  // 2) edit a chapter, confirm auto-sync writes it back
  await js(`(() => {
    const ta = document.querySelector('.editor-textarea')
    if (!ta) return null
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ta.value + '\\n新增的一行测试文字。')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(1800)
  const chFiles = fs.readdirSync(path.join(projDir, 'chapters'))
  const edited = chFiles.filter((f) =>
    fs.readFileSync(path.join(projDir, 'chapters', f), 'utf8').includes('新增的一行测试文字'))
  console.log('E2E autosync after edit -> files containing new line:', edited)

  // 3) import the same project dir back from the bookshelf
  await js(`document.querySelector('button[title="返回书架"]').click()`)
  await sleep(500)
  const importClicked = await js(`(() => {
    const el = [...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('导入项目目录'))
    if (!el) return 'NOT_FOUND'
    el.click()
    return 'OK'
  })()`)
  console.log('import menu click:', importClicked)
  await sleep(1200)
  await js(`document.querySelector('button[title="返回书架"]').click()`)
  await sleep(600)
  const bookCount = await js(`document.querySelectorAll('.book-card').length`)
  const titles = await js(`[...document.querySelectorAll('.book-cover-title')].map(e=>e.textContent).join(' | ')`)
  console.log('E2E import -> book cards on shelf:', bookCount, '|', titles)
  await shot('09-after-import.png')

  console.log('CONSOLE ERRORS:', errors.length ? errors : 'none')
  win.destroy()
  app.quit()
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1) })
