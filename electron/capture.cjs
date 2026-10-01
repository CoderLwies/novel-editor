const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const outDir = path.join(__dirname, '..', '.preview')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await sleep(1500)

  const shot = async (name) => {
    const img = await win.webContents.capturePage()
    const buf = img.toPNG()
    fs.writeFileSync(path.join(outDir, name), buf)
    console.log('saved', name, buf.length, 'bytes')
  }

  const js = (code) => win.webContents.executeJavaScript(code)

  // 1) 工作台 - 大纲侧栏（默认）
  await shot('01-workspace-outline.png')

  // 2) 工作台 - 角色侧栏
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='角色').click()`)
  await sleep(450)
  await shot('02-workspace-characters.png')

  // 3) 工作台 - 伏笔侧栏
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='伏笔').click()`)
  await sleep(450)
  await shot('03-workspace-foreshadow.png')

  // 4) 书架页
  await js(`document.querySelector('button[title="返回书架"]').click()`)
  await sleep(600)
  await shot('04-bookshelf.png')

  // 5) 明亮主题工作台
  await js(`document.querySelector('.book-card').click()`)
  await sleep(500)
  await js(`document.querySelector('button[title^="切换到"]').click()`)
  await sleep(500)
  await shot('05-light-theme.png')

  win.destroy()
  app.quit()
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1) })
