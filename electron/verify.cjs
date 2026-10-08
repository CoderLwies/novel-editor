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
        } else if (body.includes('续写 200 到 400 字')) {
          payload = { text: '续写E2E' }
        } else if (body.includes('润色以下网文段落')) {
          payload = { text: '润色E2E' }
        } else if (body.includes('网文编辑视角审查')) {
          payload = { issues: ['节奏偏慢E2E'] }
        } else if (body.includes('口头禅或语言习惯')) {
          payload = { appearance: 'AI外貌E2E', personality: 'AI性格E2E', speech: 'AI口头禅E2E' }
        } else if (body.includes('补充 3 到 6 条设定')) {
          payload = {
            settings: [
              { name: 'AI灵脉E2E', category: 'rule', status: '活跃', desc: '天地灵脉设定E2E' },
              { name: 'AI黑市E2E', category: 'faction', status: '隐匿', desc: '地下交易势力E2E' },
            ],
          }
        } else if (body.includes('归纳该设定')) {
          payload = { desc: 'AI设定描述E2E', status: 'AI状态E2E' }
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
ipcMain.handle('fs:writeBinaryFile', async (_e, p, base64) => {
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, Buffer.from(base64, 'base64'))
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
ipcMain.handle('updater:check', async () => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('updater:status', { kind: 'disabled' })
  return true
})
ipcMain.handle('updater:install', async () => false)

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
  // 新手引导（首次 seed 未 onboarded）跳过，避免遮挡后续断言
  await js(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent.includes('跳过'))?.click()`)
  await sleep(300)
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
  const book1Dir = stubDir

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
  await js(`document.querySelector('button[title="返回书架"]')?.click()`)
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

  // 6) A 组：搜索跳转 / 全部替换 / 快照回滚 / 撤销重做 / 专注模式
  await js(`[...document.querySelectorAll('.book-card')].find(c=>c.textContent.includes('混沌神尊'))?.click()`)
  await sleep(700)
  const setField = (sel, val) => js(`(() => {
    const inp = ${sel}
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, ${JSON.stringify(val)})
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const setTa = (val) => js(`(() => {
    const ta = document.querySelector('.editor-textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(val)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)

  // 6a 搜索 + 跳转定位
  await js(`document.querySelector('button[title="全文搜索 / 替换"]').click()`)
  await sleep(400)
  await setField(`document.querySelector('.modal input.field')`, '林尘')
  await sleep(400)
  const hitCount = await js(`document.querySelectorAll('.modal .ai-item').length`)
  await js(`document.querySelector('.modal .ai-item .ai-item-body')?.click()`)
  await sleep(700)
  const selText = await js(`(() => { const ta = document.querySelector('.editor-textarea'); return ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : null })()`)
  console.log('E2E search -> hits:', hitCount, '| jump selects keyword:', selText === '林尘')

  // 6b 全部替换
  await js(`document.querySelector('button[title="全文搜索 / 替换"]').click()`)
  await sleep(400)
  await setField(`document.querySelectorAll('.modal input.field')[0]`, '林尘')
  await sleep(300)
  await setField(`document.querySelectorAll('.modal input.field')[1]`, '林尘E2E')
  await sleep(300)
  await js(`[...document.querySelectorAll('.modal-foot .btn')].find(b=>b.textContent.includes('全部替换'))?.click()`)
  await sleep(700)
  const replaced = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).chapters.some(c=>c.content.includes('林尘E2E'))`)
  console.log('E2E replace-all -> persisted:', replaced)
  await js(`[...document.querySelectorAll('.modal-foot .btn')].find(b=>b.textContent.includes('完成'))?.click()`)
  await sleep(400)

  // 6c 快照 + 回滚
  await js(`[...document.querySelectorAll('.editor-sub .icon-btn')].find(b=>(b.title||'').includes('版本历史'))?.click()`)
  await sleep(400)
  await js(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent.includes('为当前内容存快照'))?.click()`)
  await sleep(400)
  await setTa('快照前标记内容。')
  await sleep(300)
  await js(`[...document.querySelectorAll('.editor-sub .icon-btn')].find(b=>(b.title||'').includes('版本历史'))?.click()`)
  await sleep(400)
  await js(`[...document.querySelectorAll('.modal .ai-item .btn')].find(b=>b.textContent.includes('回滚'))?.click()`)
  await sleep(500)
  const rolledBack = await js(`!document.querySelector('.editor-textarea').value.includes('快照前标记')`)
  console.log('E2E snapshot rollback ->', rolledBack)

  // 6d 撤销 / 重做
  await setTa('撤销测试第一版')
  await sleep(800)
  await setTa('撤销测试第二版')
  await sleep(300)
  await js(`[...document.querySelectorAll('.editor-sub .icon-btn')].find(b=>(b.title||'').includes('撤销'))?.click()`)
  await sleep(300)
  const undone = await js(`document.querySelector('.editor-textarea').value === '撤销测试第一版'`)
  await js(`[...document.querySelectorAll('.editor-sub .icon-btn')].find(b=>(b.title||'').includes('重做'))?.click()`)
  await sleep(300)
  const redone = await js(`document.querySelector('.editor-textarea').value === '撤销测试第二版'`)
  console.log('E2E undo/redo ->', undone, redone)

  // 6e 专注模式
  await js(`document.querySelector('button[title^="专注模式"]').click()`)
  await sleep(400)
  const focused = await js(`!!document.querySelector('.workspace.focus .editor-pane.focus')`)
  await shot('16-focus-mode.png')
  await js(`document.querySelector('button[title^="退出专注模式"]').click()`)
  await sleep(300)
  console.log('E2E focus mode ->', focused)

  // 7) P0 伏笔：三态 chips 循环、埋收链路、时间线
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='大纲').click()`)
  await sleep(400)
  await js(`(() => {
    const w = document.querySelector('.ol-ch.cur') || document.querySelector('.ol-ch')
    if (w && !w.classList.contains('open')) w.querySelector('.ol-ch-head').click()
  })()`)
  await sleep(400)
  const chipLabel = () => js(`[...document.querySelectorAll('.ol-chip')].find(b=>b.textContent.includes('父亲的失踪'))?.textContent ?? ''`)
  const l1 = (await chipLabel()).trim()
  await js(`[...document.querySelectorAll('.ol-chip')].find(b=>b.textContent.includes('父亲的失踪'))?.click()`)
  await sleep(400)
  const l2 = (await chipLabel()).trim()
  const autoStatus = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).foreshadows.find(f=>f.title==='父亲的失踪')?.status`)
  console.log('E2E fs chip cycle -> label changed:', l1 !== l2, '|', l1, '->', l2, '| status now:', autoStatus)
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='伏笔').click()`)
  await sleep(400)
  const tlRows = await js(`document.querySelectorAll('.fs-tl-row').length`)
  const linkShown = await js(`document.querySelectorAll('.fs-link-label').length >= 2`)
  await shot('17-foreshadow-timeline.png')
  console.log('E2E fs timeline -> rows:', tlRows, '| plant/pay links shown:', linkShown)

  // 8) P1 设定体系：角色出场 chips、设定状态字段、出现章节、搜索过滤
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='角色').click()`)
  await sleep(400)
  const castChips = await js(`document.querySelectorAll('.side .fs-appear .ol-chip').length`)
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='设定').click()`)
  await sleep(400)
  const statusInputs = await js(`document.querySelectorAll('.side input[placeholder^="当前状态"]').length`)
  const setAppear = await js(`document.querySelectorAll('.side .fs-appear .ol-chip').length`)
  const cardsBefore = await js(`document.querySelectorAll('.side .card').length`)
  await js(`(() => {
    const inp = document.querySelector('.side .side-scroll input.field')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, 'zzz不存在关键词')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(400)
  const cardsFiltered = await js(`document.querySelectorAll('.side .card').length`)
  console.log('E2E settings P1 -> cast chips:', castChips, '| status inputs:', statusInputs,
    '| setting appear chips:', setAppear, '| filter cards:', cardsBefore, '->', cardsFiltered)
  // 侧栏过滤词为全局受控，清空以免影响后续 tab 断言
  await js(`(() => {
    const inp = document.querySelector('.side .side-scroll input.field')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(300)

  // 9) P0 角色卡：状态 / 别名 / 折叠详细字段
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='角色').click()`)
  await sleep(400)
  await js(`(() => {
    const sel = document.querySelector('.side .card select.field')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(sel, 'dead')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)
  const charStatus = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).characters[0]?.status`)
  await js(`(() => {
    const inp = [...document.querySelectorAll('.side .card input.inline-edit')].find(i=>(i.placeholder||'').includes('别名'))
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '林少爷, 少主')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(400)
  const aliases = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).characters[0]?.aliases`)
  await js(`[...document.querySelectorAll('.side .card .btn')].find(b=>b.textContent.includes('详细设定'))?.click()`)
  await sleep(300)
  const fieldCount = await js(`document.querySelectorAll('.side .card .ol-field textarea').length`)
  await shot('18-character-card.png')
  console.log('E2E char P0 -> status:', charStatus, '| aliases:', JSON.stringify(aliases), '| detail fields:', fieldCount)

  // 10) 块2：角色关系/出场统计、伏笔重要度+关联角色、设定集/伏笔表导出
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='角色').click()`)
  await sleep(400)
  const statLine = await js(`[...document.querySelectorAll('.side .card')][0]?.textContent.includes('出场 ')`)
  await js(`[...document.querySelectorAll('.side .card .btn')].find(b=>b.textContent.trim().startsWith('详细设定'))?.click()`)
  await sleep(300)
  await js(`[...document.querySelectorAll('.side .card .btn')].find(b=>b.textContent.includes('添加关系'))?.click()`)
  await sleep(400)
  const relCount = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).characters[0]?.relations?.length`)
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='伏笔').click()`)
  await sleep(400)
  const prioSelects = await js(`[...document.querySelectorAll('.side select.field')].filter(s=>[...s.options].some(o=>o.value==='main')).length`)
  const relChips = await js(`[...document.querySelectorAll('.side .fs-appear .ol-chip')].length`)
  await js(`document.querySelector('.filemenu > button')?.click()`)
  await sleep(300)
  await js(`[...document.querySelectorAll('.menu-item')].find(b=>b.textContent.includes('导出设定集'))?.click()`)
  await sleep(900)
  const setMd = fs.existsSync(stubSavePath) ? fs.readFileSync(stubSavePath, 'utf8') : ''
  await js(`document.querySelector('.filemenu > button')?.click()`)
  await sleep(300)
  await js(`[...document.querySelectorAll('.menu-item')].find(b=>b.textContent.includes('导出伏笔表'))?.click()`)
  await sleep(900)
  const fsMd = fs.existsSync(stubSavePath) ? fs.readFileSync(stubSavePath, 'utf8') : ''
  console.log('E2E block2 -> stat line:', statLine, '| relations:', relCount, '| priority selects:', prioSelects,
    '| char chips in fs:', relChips, '| settings md:', setMd.includes('设定集'), '| foreshadow md:', fsMd.includes('伏笔表'))

  // 11) 块3：选中文本 AI 续写/审查、多模型预设、别名混用巡检
  const aiSrv2 = await startFakeAi()
  const port2 = aiSrv2.address().port
  await js(`(() => {
    const K = 'zizhou-state-v1'
    const s = JSON.parse(localStorage.getItem(K))
    s.ai = { baseUrl: 'http://127.0.0.1:${port2}', apiKey: '', model: 'deepseek-flash' }
    localStorage.setItem(K, JSON.stringify(s))
  })()`)
  await win.reload()
  await sleep(1400)
  await js(`[...document.querySelectorAll('.book-card')].find(c=>c.textContent.includes('混沌神尊'))?.click()`)
  await sleep(700)
  await js(`(() => {
    const ta = document.querySelector('.editor-textarea')
    ta.focus()
    ta.setSelectionRange(0, 4)
    ta.dispatchEvent(new Event('select', { bubbles: true }))
  })()`)
  await sleep(400)
  const toolBtns = await js(`[...document.querySelectorAll('.editor-sub .btn')].map(b=>b.textContent).join('|')`)
  await js(`[...document.querySelectorAll('.editor-sub .btn')].find(b=>b.textContent.includes('续写'))?.click()`)
  await sleep(900)
  await js(`[...document.querySelectorAll('.modal-foot .btn')].find(b=>b.textContent.includes('采用'))?.click()`)
  await sleep(500)
  const continued = await js(`document.querySelector('.editor-textarea').value.includes('续写E2E')`)
  await js(`document.querySelector('button[title="AI 接口设置"]').click()`)
  await sleep(400)
  const modelChips = await js(`[...document.querySelectorAll('.modal .ol-chip')].map(b=>b.textContent).join('|')`)
  await js(`[...document.querySelectorAll('.modal .ol-chip')].find(b=>b.textContent.includes('deepseek-chat'))?.click()`)
  await sleep(300)
  const modelNow = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).ai.model`)
  await js(`document.querySelector('.modal-head .icon-btn')?.click()`)
  await sleep(300)
  await js(`(() => {
    const ta = document.querySelector('.editor-textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ta.value + '\\n林尘与林少爷对峙。')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(600)
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='大纲').click()`)
  await sleep(300)
  await js(`document.querySelector('button[title="一致性巡检"]').click()`)
  await sleep(500)
  const mixedIssue = await js(`[...document.querySelectorAll('.modal .ai-issue')].map(e=>e.textContent).join('|').includes('混用称呼')`)
  await shot('19-ai-text-ops.png')
  await js(`document.querySelector('.modal-head .icon-btn')?.click()`)
  aiSrv2.close()
  console.log('E2E block3 -> sel tools:', toolBtns.includes('续写'), '| continued:', continued,
    '| model chips:', modelChips.includes('deepseek-chat'), '| model now:', modelNow, '| mixed-name issue:', mixedIssue)

  // 12) EPUB 导出：zip 结构 / mimetype / OPF 标题与章节数
  await js(`document.querySelector('.filemenu > button')?.click()`)
  await sleep(300)
  await js(`[...document.querySelectorAll('.menu-item')].find(b=>b.textContent.includes('导出 EPUB'))?.click()`)
  await sleep(1500)
  const epubBuf = fs.existsSync(stubSavePath) ? fs.readFileSync(stubSavePath) : null
  let epubMime = false
  let epubTitle = false
  let epubChapters = 0
  if (epubBuf && epubBuf.slice(0, 2).toString() === 'PK') {
    const JSZip = require('jszip')
    const z = await JSZip.loadAsync(epubBuf)
    epubMime = (await z.file('mimetype').async('string')) === 'application/epub+zip'
    epubTitle = (await z.file('OEBPS/content.opf').async('string')).includes('混沌神尊')
    epubChapters = Object.keys(z.files).filter((k) => /^OEBPS\/ch\d+\.xhtml$/.test(k)).length
  }
  console.log('E2E epub -> zip:', !!epubBuf, '| mimetype:', epubMime, '| title:', epubTitle, '| chapter files:', epubChapters)

  // 13) 快照落盘：绑定书存快照 → history 目录 → 重导入回读
  await js(`document.querySelector('button[title="返回书架"]').click()`)
  await sleep(500)
  await js(`[...document.querySelectorAll('.book-card')].find(c=>c.textContent.includes('测试新书'))?.click()`)
  await sleep(700)
  await js(`[...document.querySelectorAll('.editor-sub .icon-btn')].find(b=>(b.title||'').includes('版本历史'))?.click()`)
  await sleep(400)
  await js(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent.includes('为当前内容存快照'))?.click()`)
  await sleep(1800)
  const histIndex = fs.existsSync(path.join(book1Dir, 'history', 'index.json'))
    ? JSON.parse(fs.readFileSync(path.join(book1Dir, 'history', 'index.json'), 'utf8'))
    : null
  const histCount = histIndex ? Object.keys(histIndex).length : 0
  await js(`document.querySelector('button[title="返回书架"]').click()`)
  await sleep(400)
  stubDir = book1Dir
  await js(`[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('导入项目目录'))?.click()`)
  await sleep(1400)
  const stSnap = JSON.parse(await js(`localStorage.getItem('zizhou-state-v1')`))
  const snapBack = stSnap.books.some((b) =>
    b.title === '测试新书' &&
    stSnap.snapshots.some((sp) => stSnap.chapters.some((c) => c.bookId === b.id && c.id === sp.chapterId)),
  )
  console.log('E2E snapshot disk -> history entries:', histCount, '| readback after reimport:', snapBack)

  // 14) 自动更新：dev 模式检查更新降级提示
  await js(`document.querySelector('.filemenu > button')?.click()`)
  await sleep(300)
  await js(`[...document.querySelectorAll('.menu-item')].find(b=>b.textContent.includes('检查更新'))?.click()`)
  await sleep(600)
  const updToast = await js(`document.querySelector('.toast')?.textContent ?? ''`)
  console.log('E2E updater -> dev disabled toast:', updToast.includes('开发模式'))

  // 15) 统一搜索 Ctrl+K + 侧栏联动 + 帮助页
  await js(`document.querySelector('button[title="返回书架"]').click()`)
  await sleep(500)
  await js(`[...document.querySelectorAll('.book-card')].find(c=>c.textContent.includes('混沌神尊'))?.click()`)
  await sleep(700)
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))`)
  await sleep(400)
  const paletteOpen = await js(`!!document.querySelector('.modal')`)
  await js(`(() => {
    const inp = document.querySelector('.modal input.field')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '林尘')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(400)
  await js(`[...document.querySelectorAll('.modal .ai-item-body')].find(b=>b.textContent.trim().startsWith('林尘'))?.click()`)
  await sleep(500)
  const sideFilterVal = await js(`document.querySelector('.side .side-scroll input.field')?.value`)
  const sideTabActive = await js(`document.querySelector('.side-tab.active')?.textContent`)
  await js(`document.querySelector('button[title="帮助与快捷键"]').click()`)
  await sleep(400)
  const helpOk = await js(`document.querySelector('.modal')?.textContent.includes('快捷键') ?? false`)
  await shot('20-help.png')
  await js(`document.querySelector('.modal-head .icon-btn')?.click()`)
  await sleep(300)
  console.log('E2E unified search -> palette:', paletteOpen, '| side filter:', sideFilterVal,
    '| tab:', sideTabActive, '| help:', helpOk)

  // 16) AI 角色卡补全：草稿弹窗 + 填入空缺
  const aiSrv3 = await startFakeAi()
  const port3 = aiSrv3.address().port
  await js(`(() => {
    const K = 'zizhou-state-v1'
    const s = JSON.parse(localStorage.getItem(K))
    s.ai = { baseUrl: 'http://127.0.0.1:${port3}', apiKey: '', model: 'deepseek-flash' }
    localStorage.setItem(K, JSON.stringify(s))
  })()`)
  await win.reload()
  await sleep(1400)
  await js(`[...document.querySelectorAll('.book-card')].find(c=>c.textContent.includes('混沌神尊'))?.click()`)
  await sleep(700)
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='角色').click()`)
  await sleep(400)
  await js(`[...document.querySelectorAll('.side .card .icon-btn')].find(b=>(b.title||'').includes('AI 补全角色卡'))?.click()`)
  await sleep(900)
  const draftShown = await js(`document.querySelector('.modal')?.textContent.includes('AI 角色卡补全') ?? false`)
  await js(`[...document.querySelectorAll('.modal-foot .btn')].find(b=>b.textContent.includes('填入空缺'))?.click()`)
  await sleep(500)
  const cardAi = await js(`(() => { const s = JSON.parse(localStorage.getItem('zizhou-state-v1')); const c = s.characters[0]; return { a: c.appearance, s: c.speech } })()`)
  aiSrv3.close()
  console.log('E2E char card ai -> draft:', draftShown, '| appearance:', cardAi.a, '| speech:', cardAi.s)

  // 17) 成长弧线 / 关系图 / 伏笔设定互挂 / 故事时间巡检
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='角色').click()`)
  await sleep(400)
  await js(`[...document.querySelectorAll('.side .card .btn')].find(b=>b.textContent.trim().startsWith('详细设定'))?.click()`)
  await sleep(300)
  await js(`[...document.querySelectorAll('.side .card .btn')].find(b=>b.textContent.includes('添加阶段'))?.click()`)
  await sleep(400)
  const arcCount = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).characters[0]?.arc?.length`)
  await js(`[...document.querySelectorAll('.side .btn')].find(b=>b.textContent.includes('关系图'))?.click()`)
  await sleep(400)
  const graphNodes = await js(`document.querySelectorAll('.modal svg circle').length`)
  await shot('21-relation-graph.png')
  await js(`document.querySelector('.modal-head .icon-btn')?.click()`)
  await sleep(300)
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='伏笔').click()`)
  await sleep(400)
  await js(`(() => {
    const lbl = [...document.querySelectorAll('.side .fs-link-label')].find(l=>l.textContent==='设定')
    lbl?.parentElement?.querySelector('.ol-chip')?.click()
  })()`)
  await sleep(400)
  const fsSetting = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).foreshadows[0]?.settingIds?.length`)
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='大纲').click()`)
  await sleep(400)
  const setDay = (title, day) => js(`(() => {
    const w = [...document.querySelectorAll('.ol-ch')].find(x=>x.querySelector('.ol-ch-title')?.textContent.includes('${title}'))
    if (!w) return 'NO_CH'
    if (!w.classList.contains('open')) w.querySelector('.ol-ch-head').click()
    return 'opened'
  })()`)
  await setDay('第一章', 5)
  await sleep(300)
  await js(`(() => {
    const w = [...document.querySelectorAll('.ol-ch')].find(x=>x.querySelector('.ol-ch-title')?.textContent.includes('第一章'))
    const box = [...w.querySelectorAll('.ol-field')].find(f=>f.querySelector('.lbl')?.textContent.includes('故事时间'))
    const inp = box?.querySelector('input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '5')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(300)
  await setDay('第二章', 3)
  await sleep(300)
  await js(`(() => {
    const w = [...document.querySelectorAll('.ol-ch')].find(x=>x.querySelector('.ol-ch-title')?.textContent.includes('第二章'))
    const box = [...w.querySelectorAll('.ol-field')].find(f=>f.querySelector('.lbl')?.textContent.includes('故事时间'))
    const inp = box?.querySelector('input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '3')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(500)
  await js(`document.querySelector('button[title="一致性巡检"]').click()`)
  await sleep(500)
  const dayIssue = await js(`[...document.querySelectorAll('.modal .ai-issue')].map(e=>e.textContent).join('|').includes('故事时间')`)
  await js(`document.querySelector('.modal-head .icon-btn')?.click()`)
  console.log('E2E block4 -> arc:', arcCount, '| graph nodes:', graphNodes, '| fs settingIds:', fsSetting, '| storyday issue:', dayIssue)

  // 18) 设定手动挂接：章纲 chips + 设定卡反向挂接
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='大纲').click()`)
  await sleep(400)
  await js(`(() => {
    const w = [...document.querySelectorAll('.ol-ch')].find(x=>x.querySelector('.ol-ch-title')?.textContent.includes('第一章'))
    if (w && !w.classList.contains('open')) w.querySelector('.ol-ch-head').click()
  })()`)
  await sleep(300)
  await js(`(() => {
    const lbl = [...document.querySelectorAll('.ol-chips-block .lbl')].find(l=>l.textContent.includes('本章挂接设定'))
    lbl?.parentElement?.querySelector('.ol-chip')?.click()
  })()`)
  await sleep(800)
  const hooked = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).chapters.find(c=>c.title.includes('第一章'))?.settingIds?.length`)
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='设定').click()`)
  await sleep(400)
  const hookChips = await js(`[...document.querySelectorAll('.side .fs-link-label')].filter(l=>l.textContent==='挂接').length`)
  console.log('E2E setting hook -> chapter settingIds:', hooked, '| setting hooked chips:', hookChips)

  // 19) 最近打开列表
  await js(`document.querySelector('button[title="返回书架"]').click()`)
  await sleep(600)
  const recentChips = await js(`[...document.querySelectorAll('.recent-row .ol-chip')].length`)
  const recentFirst = await js(`document.querySelector('.recent-row .ol-chip')?.textContent ?? ''`)
  console.log('E2E recent open -> chips:', recentChips, '| first:', recentFirst)

  // 20) 设定 AI：生成采纳 + 单卡补全
  const aiSrv4 = await startFakeAi()
  const port4 = aiSrv4.address().port
  await js(`(() => {
    const K = 'zizhou-state-v1'
    const s = JSON.parse(localStorage.getItem(K))
    s.ai = { baseUrl: 'http://127.0.0.1:${port4}', apiKey: '', model: 'deepseek-flash' }
    localStorage.setItem(K, JSON.stringify(s))
  })()`)
  await win.reload()
  await sleep(1400)
  await js(`[...document.querySelectorAll('.book-card')].find(c=>c.textContent.includes('混沌神尊'))?.click()`)
  await sleep(700)
  await js(`[...document.querySelectorAll('.side-tab')].find(t=>t.textContent==='设定').click()`)
  await sleep(400)
  await js(`[...document.querySelectorAll('.side .btn')].find(b=>b.textContent.includes('AI 生成设定'))?.click()`)
  await sleep(900)
  const genItems = await js(`document.querySelectorAll('.modal .ai-item').length`)
  await js(`[...document.querySelectorAll('.modal-foot .btn')].find(b=>b.textContent.includes('创建所选设定'))?.click()`)
  await sleep(600)
  const genCreated = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).settings.some(s=>s.name==='AI灵脉E2E')`)
  await js(`[...document.querySelectorAll('.side .card .icon-btn')].find(b=>(b.title||'').includes('AI 补全设定'))?.click()`)
  await sleep(900)
  await js(`[...document.querySelectorAll('.modal-foot .btn')].find(b=>b.textContent.includes('填入空缺'))?.click()`)
  await sleep(500)
  const setStatus = await js(`JSON.parse(localStorage.getItem('zizhou-state-v1')).settings.find(s=>s.name==='青云镇')?.status`)
  aiSrv4.close()
  console.log('E2E setting ai -> gen items:', genItems, '| created:', genCreated, '| card status filled:', setStatus)

  console.log('CONSOLE ERRORS:', errors.length ? errors : 'none')
  win.destroy()
  app.quit()
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1) })
