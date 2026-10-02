const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const os = require('os')
const http = require('http')

const outDir = path.join(__dirname, '..', '.preview')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// directory dialog is stubbed so the flow runs headlessly; value swapped per step
let stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozhang-e2e-'))
// save dialog is stubbed too, so exports can be asserted headlessly
const stubSavePath = path.join(stubDir, 'exported-outline.md')

// loopback fake OpenAI-compatible server: canned JSON per prompt kind
function startFakeAi() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('access-control-allow-origin', '*')
      res.setHeader('access-control-allow-headers', 'content-type, authorization')
      res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
      if (req.method === 'OPTIONS') {
        res.end()
        return
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        let payload
        if (body.includes('规划 3 到 6 个新章节')) {
          payload = {
            chapters: [
              { title: '第六章 夜探', synopsis: 'AI拆纲S1', goal: 'g1', conflict: 'c1', turning: 't1', hook: 'h1', pov: '林尘' },
              { title: '第七章 反杀', synopsis: 'AI拆纲S2', goal: 'g2', conflict: 'c2', turning: 't2', hook: 'h2', pov: '林尘' },
            ],
          }
        } else if (body.includes('剧情走向分支')) {
          payload = {
            branches: [
              { label: '隐忍', synopsis: '分支B1', turning: 'tb1', hook: 'hb1' },
              { label: '摊牌', synopsis: '分支B2', turning: 'tb2', hook: 'hb2' },
            ],
          }
        } else if (body.includes('实际走向')) {
          payload = { synopsis: '回写概要E2E', turning: '回写转折E2E', hook: '回写钩子E2E' }
        } else {
          payload = { ok: true }
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }))
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}

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
ipcMain.handle('dialog:saveFile', async () => stubSavePath)

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

  // 2b) 侧栏三级大纲：填写章纲字段 + 切换纲状态，验证落盘到 book.json
  await js(`(() => {
    const ch = document.querySelector('.ol-ch:not(.open) .ol-ch-head')
    if (ch) ch.click()
  })()`)
  await sleep(400)
  await js(`(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const box = [...document.querySelectorAll('.ol-field')].find(f => f.querySelector('.lbl')?.textContent === '本章目标')
    const inp = box?.querySelector('input')
    if (!inp) return 'NO_FIELD'
    setter.call(inp, '纲目标E2E标记')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    return 'ok'
  })()`)
  await js(`[...document.querySelectorAll('.ol-seg-btn')].find(b=>b.textContent==='已成文')?.click()`)
  await sleep(1800)
  const bj = created ? JSON.parse(fs.readFileSync(path.join(stubDir, 'book.json'), 'utf8')) : null
  const meta = bj?.chaptersMeta?.find((m) => m.goal === '纲目标E2E标记')
  console.log('E2E outline fields -> persisted goal:', !!meta, '| outlineStatus:', meta?.outlineStatus)

  // 2c) 全书大纲表视图：渲染 + 纲状态下拉 + 点击回到正文
  await js(`[...document.querySelectorAll('.seg-btn')].find(b=>b.textContent.includes('大纲'))?.click()`)
  await sleep(600)
  const rows = await js(`document.querySelectorAll('.ov-row').length`)
  const hasDot = await js(`!!document.querySelector('.ov-row .os-dot')`)
  await shot('12-outline-view.png')
  await js(`(() => {
    const sel = document.querySelector('.ov-row .ov-select')
    if (!sel) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(sel, 'revised')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)
  const revised = await js(`!!document.querySelector('.ov-row .os-dot.os-revised')`)
  const coverage = await js(`document.querySelector('.statsbar')?.textContent.match(/纲覆盖\\s*(\\d+%)/)?.[1] ?? 'n/a'`)
  await js(`document.querySelector('.ov-row .ov-name')?.click()`)
  await sleep(500)
  const backToEditor = await js(`!!document.querySelector('.editor-textarea')`)
  console.log('E2E outline table -> rows:', rows, '| status dot:', hasDot, '| revised:', revised,
    '| coverage:', coverage, '| back to editor:', backToEditor)

  // 2d) 导出全书大纲 Markdown
  await js(`document.querySelector('.filemenu > button')?.click()`)
  await sleep(300)
  await js(`[...document.querySelectorAll('.menu-item')].find(b=>b.textContent.includes('导出全书大纲'))?.click()`)
  await sleep(900)
  const outlineMd = fs.existsSync(stubSavePath) ? fs.readFileSync(stubSavePath, 'utf8') : ''
  console.log('E2E outline export -> file:', !!outlineMd,
    '| has title:', outlineMd.includes('# 测试新书 · 全书大纲'),
    '| has goal:', outlineMd.includes('纲目标E2E标记'),
    '| has status:', /纲状态：(已成文|已修纲)/.test(outlineMd))

  // 2e) 章节 md 自带 frontmatter；外部编辑后导入可回读
  const chFile = path.join(stubDir, 'chapters', files[0])
  let md = fs.readFileSync(chFile, 'utf8')
  const hasFm = md.startsWith('---\n')
  const fmHasGoal = /goal: 纲目标E2E标记/.test(md)
  const version2 = bj?.version === 2
  md = md.replace(/^---\n/, '---\nsynopsis: 外部改纲E2E\n')
  md += '\n外部追加正文E2E。'
  fs.writeFileSync(chFile, md)
  console.log('E2E frontmatter write -> md has fm:', hasFm, '| fm carries goal:', fmHasGoal, '| book.json v2:', version2)

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
  const st = JSON.parse(await js(`localStorage.getItem('zizhou-state-v1')`))
  const dupBooks = st.books.filter((b) => b.title === '测试新书')
  const readback = dupBooks.some((b) => {
    const c = st.chapters.find((x) => x.bookId === b.id)
    return c?.synopsis === '外部改纲E2E' && (c?.content ?? '').includes('外部追加正文E2E') && c?.goal === '纲目标E2E标记'
  })
  console.log('E2E frontmatter readback -> external edit imported:', readback, '| copies:', dupBooks.length)
  await shot('11-after-newbook-import.png')

  // 4) v1 旧项目目录兼容：无 frontmatter、version 1 仍可导入
  const v1Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozhang-v1-'))
  fs.mkdirSync(path.join(v1Dir, 'chapters'), { recursive: true })
  fs.writeFileSync(path.join(v1Dir, 'chapters', '0001_旧章.md'), '旧版正文，无 frontmatter。')
  fs.writeFileSync(path.join(v1Dir, 'book.json'), JSON.stringify({
    format: 'novel-editor-project',
    version: 1,
    book: { id: 'v1b', title: '旧版书', author: 'a', genre: 'g', synopsis: '', coverColor: '#123456', status: 'ongoing', dailyGoal: 3000, createdAt: 1, updatedAt: 1 },
    volumes: [{ id: 'v1v', bookId: 'v1b', title: '第一卷', order: 0 }],
    chaptersMeta: [{ id: 'v1c', volumeId: 'v1v', title: '旧章', order: 0, status: 'draft', synopsis: '', file: '0001_旧章.md' }],
    characters: [], settings: [], foreshadows: [],
  }, null, 2))
  stubDir = v1Dir
  await js(`[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('导入项目目录'))?.click()`)
  await sleep(1200)
  const st2 = JSON.parse(await js(`localStorage.getItem('zizhou-state-v1')`))
  const v1Book = st2.books.find((b) => b.title === '旧版书')
  const v1Ch = st2.chapters.find((c) => c.bookId === v1Book?.id)
  console.log('E2E v1 compat -> imported:', !!v1Book,
    '| body intact:', v1Ch?.content === '旧版正文，无 frontmatter。',
    '| outlineStatus default:', v1Ch?.outlineStatus)

  // 5) Phase 3 AI：拆章纲 / 分支 / 回写 / 巡检（loopback 假服务）
  const aiSrv = await startFakeAi()
  const aiPort = aiSrv.address().port
  await js(`(() => {
    const K = 'zizhou-state-v1'
    const s = JSON.parse(localStorage.getItem(K))
    s.ai = { baseUrl: 'http://127.0.0.1:${aiPort}', apiKey: '', model: 'fake' }
    localStorage.setItem(K, JSON.stringify(s))
  })()`)
  await win.reload()
  await sleep(1400)
  await js(`document.querySelector('button[title="返回书架"]').click()`)
  await sleep(600)
  await js(`[...document.querySelectorAll('.book-card')].find(c=>c.textContent.includes('混沌神尊'))?.click()`)
  await sleep(700)

  // 5a) AI 拆章纲：预览 + 勾选创建
  await js(`document.querySelector('button[title="AI 拆章纲（依据总纲与卷纲）"]').click()`)
  await sleep(900)
  const splitItems = await js(`document.querySelectorAll('.modal .ai-item').length`)
  await shot('13-ai-split.png')
  await js(`[...document.querySelectorAll('.modal-foot .btn')].find(b=>b.textContent.includes('创建所选章节'))?.click()`)
  await sleep(700)
  const stAi = JSON.parse(await js(`localStorage.getItem('zizhou-state-v1')`))
  const s1 = stAi.chapters.find((c) => c.synopsis === 'AI拆纲S1')
  console.log('E2E ai split -> preview items:', splitItems,
    '| created:', !!s1, '| status:', s1?.outlineStatus, '| pov:', s1?.pov)

  // 5b) AI 分支：采用第一条
  await js(`(() => {
    const heads = [...document.querySelectorAll('.ol-ch-head')]
    const target = heads.find((h) => h.textContent.includes('第一章'))
    const wrap = target?.closest('.ol-ch')
    if (wrap && !wrap.classList.contains('open')) target.click()
  })()`)
  await sleep(400)
  await js(`[...document.querySelectorAll('.ol-ai-row .btn')].find(b=>b.textContent.includes('AI 分支'))?.click()`)
  await sleep(900)
  const branchItems = await js(`document.querySelectorAll('.modal .ai-item').length`)
  await js(`[...document.querySelectorAll('.modal .ai-item .btn')].find(b=>b.textContent.includes('采用'))?.click()`)
  await sleep(600)
  const stBr = JSON.parse(await js(`localStorage.getItem('zizhou-state-v1')`))
  const ch1 = stBr.chapters.find((c) => c.id === 'ch_1')
  console.log('E2E ai branch -> items:', branchItems, '| adopted synopsis:', ch1?.synopsis === '分支B1')

  // 5c) 写后回写 + 本地事实快照
  await js(`[...document.querySelectorAll('.ol-ai-row .btn')].find(b=>b.textContent.includes('回写章纲'))?.click()`)
  await sleep(1000)
  const stWb = JSON.parse(await js(`localStorage.getItem('zizhou-state-v1')`))
  const ch1w = stWb.chapters.find((c) => c.id === 'ch_1')
  console.log('E2E ai writeback -> synopsis:', ch1w?.synopsis === '回写概要E2E',
    '| turning:', ch1w?.turning === '回写转折E2E',
    '| status:', ch1w?.outlineStatus,
    '| cast snapshot has 林尘:', ch1w?.cast?.includes('char_1'))

  // 5d) 一致性巡检
  await js(`document.querySelector('button[title="一致性巡检"]').click()`)
  await sleep(500)
  const issueCount = await js(`document.querySelectorAll('.modal .ai-issue').length`)
  await shot('14-ai-check.png')
  await js(`document.querySelector('.modal-head .icon-btn')?.click()`)
  await sleep(300)

  // 5e) AI 设置弹窗
  await js(`document.querySelector('button[title="AI 接口设置"]').click()`)
  await sleep(400)
  await shot('15-ai-settings.png')
  const settingsVal = await js(`document.querySelector('.modal input.field')?.value`)
  console.log('E2E ai check -> issues:', issueCount, '| settings baseUrl shown:', settingsVal?.includes('127.0.0.1'))
  aiSrv.close()

  // 5f) 旧 localStorage 键迁移：状态搬到旧键、删新键，reload 后应自动迁回新键
  const booksBefore = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).books.length`)
  await js(`localStorage.setItem('novel-editor-state-v1', localStorage.getItem('zizhou-state-v1')); localStorage.removeItem('zizhou-state-v1')`)
  await win.reload()
  await sleep(1200)
  const migRaw = await js(`localStorage.getItem('zizhou-state-v1')`)
  const booksAfter = migRaw ? JSON.parse(migRaw).books.length : -1
  console.log('E2E legacy key migration -> new key restored:', !!migRaw, '| books kept:', booksBefore === booksAfter)

  console.log('CONSOLE ERRORS:', errors.length ? errors : 'none')
  win.destroy()
  app.quit()
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1) })
