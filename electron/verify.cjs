const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const os = require('os')

const outDir = path.join(__dirname, '..', '.preview')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// directory dialog is stubbed so the flow runs headlessly; value swapped per step
let stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozhang-e2e-'))

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
ipcMain.handle('dialog:openDirectory', async () => stubDir)
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
    width: 1440, height: 900, show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, backgroundThrottling: false },
  })
  const errors = []
  win.webContents.on('console-message', (_e, level, m) => { if (level >= 3) errors.push(m) })
  win.webContents.on('render-process-gone', () => errors.push('RENDERER_CRASHED'))

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await sleep(1200)
  await win.webContents.executeJavaScript('localStorage.clear()')
  await win.reload()
  await sleep(1400)
  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => {
    fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG())
    console.log('saved', name)
  }

  // 1) 新建作品并选择存储目录
  await js(`document.querySelector('button[title="返回书架"]')?.click()`)
  await sleep(500)
  await js(`[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('新建作品')).click()`)
  await sleep(400)
  await js(`(() => {
    const inp = document.querySelector('.modal input.field')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '测试新书')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await js(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent.includes('选择文件夹')).click()`)
  await sleep(400)
  await shot('10-newbook-dir.png')
  await js(`[...document.querySelectorAll('.modal-foot .btn')].find(b=>b.textContent.includes('创建并开始写作')).click()`)
  await sleep(1800)
  const created = fs.existsSync(path.join(stubDir, 'book.json'))
  const chDir = fs.existsSync(path.join(stubDir, 'chapters'))
  const badge = await js(`!!document.querySelector('.bound-badge')`)
  console.log('E2E new-book-with-dir -> book.json:', created, '| chapters dir:', chDir, '| bound badge:', badge)

  // 2) 新建章节并编辑，验证自动同步落盘
  await js(`document.querySelector('button[title="在此卷新建章节"]').click()`)
  await sleep(500)
  await js(`(() => {
    const ta = document.querySelector('.editor-textarea')
    if (!ta) return null
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '这是新建书的第一章正文，用于验证自动落盘。')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(1800)
  const files = chDir ? fs.readdirSync(path.join(stubDir, 'chapters')) : []
  const synced = files.some((f) => fs.readFileSync(path.join(stubDir, 'chapters', f), 'utf8').includes('验证自动落盘'))
  console.log('E2E autosync -> chapter files:', files, '| content synced:', synced)

  // 3) 从书架导入同一目录，验证往返
  await js(`document.querySelector('button[title="返回书架"]').click()`)
  await sleep(500)
  await js(`(() => {
    const el = [...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('导入项目目录'))
    if (el) el.click()
  })()`)
  await sleep(1200)
  await js(`document.querySelector('button[title="返回书架"]').click()`)
  await sleep(600)
  const titles = await js(`[...document.querySelectorAll('.book-cover-title')].map(e=>e.textContent).join(' | ')`)
  console.log('E2E import round-trip -> shelf:', titles)
  await shot('11-after-newbook-import.png')

  console.log('CONSOLE ERRORS:', errors.length ? errors : 'none')
  win.destroy()
  app.quit()
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1) })
