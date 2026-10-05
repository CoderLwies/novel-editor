import type {
  AppState,
  Book,
  Volume,
  Character,
  SettingItem,
  Foreshadow,
  ChapterStatus,
  OutlineStatus,
  ChapterSnapshot,
  ID,
} from './types'
import { fsLow } from './fs'
import { encodeFrontmatter, parseFrontmatter } from './frontmatter'
import { countWords } from './utils'

export const PROJECT_FORMAT = 'zizhou-project'
/** 改名前的 format marker，读取时兼容 */
const LEGACY_PROJECT_FORMAT = 'novel-editor-project'
export const PROJECT_VERSION = 2

export interface ChapterMeta {
  id: ID
  volumeId: ID
  title: string
  order: number
  status: ChapterStatus
  synopsis: string
  file: string
  goal?: string
  conflict?: string
  turning?: string
  hook?: string
  pov?: string
  cast?: ID[]
  foreshadowIds?: ID[]
  foreshadowPayoffs?: ID[]
  outlineStatus?: OutlineStatus
}

export interface ProjectData {
  book: Book
  volumes: Volume[]
  chaptersMeta: ChapterMeta[]
  chapterContents: Record<ID, string>
  characters: Character[]
  settings: SettingItem[]
  foreshadows: Foreshadow[]
  snapshots: ChapterSnapshot[]
}

/* ------------------------------- 工具 ------------------------------- */

export function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'untitled'
  )
}

function joinPath(dir: string, ...parts: string[]): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return [dir.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

function orderedChapters(state: AppState, bookId: ID) {
  const volumes = state.volumes.filter((v) => v.bookId === bookId).sort((a, b) => a.order - b.order)
  const volIndex = new Map(volumes.map((v, i) => [v.id, i]))
  return state.chapters
    .filter((c) => c.bookId === bookId)
    .sort((a, b) => (volIndex.get(a.volumeId) ?? 0) - (volIndex.get(b.volumeId) ?? 0) || a.order - b.order)
}

/* --------------------------- 项目目录 读/写 --------------------------- */

export async function writeProjectToDir(dir: string, state: AppState, bookId: ID): Promise<string> {
  const book = state.books.find((b) => b.id === bookId)
  if (!book) throw new Error('作品不存在')

  await fsLow.mkdirp(joinPath(dir, 'chapters'))

  const chapters = orderedChapters(state, bookId)
  const chaptersMeta: ChapterMeta[] = []
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i]
    const file = `${String(i + 1).padStart(4, '0')}_${sanitizeFilename(c.title)}.md`
    chaptersMeta.push({
      id: c.id,
      volumeId: c.volumeId,
      title: c.title,
      order: c.order,
      status: c.status,
      synopsis: c.synopsis,
      file,
      goal: c.goal,
      conflict: c.conflict,
      turning: c.turning,
      hook: c.hook,
      pov: c.pov,
      cast: c.cast,
      foreshadowIds: c.foreshadowIds,
      foreshadowPayoffs: c.foreshadowPayoffs,
      outlineStatus: c.outlineStatus,
    })
    await fsLow.writeFile(
      joinPath(dir, 'chapters', file),
      encodeFrontmatter({
        title: c.title,
        status: c.status,
        outlineStatus: c.outlineStatus,
        synopsis: c.synopsis,
        goal: c.goal,
        conflict: c.conflict,
        turning: c.turning,
        hook: c.hook,
        pov: c.pov,
        cast: c.cast,
        foreshadowIds: c.foreshadowIds,
        foreshadowPayoffs: c.foreshadowPayoffs,
      }) + c.content,
    )
  }

  const historyDir = joinPath(dir, 'history')
  await fsLow.mkdirp(historyDir)
  const chIds = new Set(chaptersMeta.map((m) => m.id))
  const snaps = state.snapshots.filter((s) => chIds.has(s.chapterId))
  const snapIndex: Record<string, { chapterId: ID; at: number }> = {}
  for (const s of snaps) {
    snapIndex[s.id] = { chapterId: s.chapterId, at: s.at }
    await fsLow.writeFile(joinPath(historyDir, `${s.id}.md`), s.content)
  }
  await fsLow.writeFile(joinPath(historyDir, 'index.json'), JSON.stringify(snapIndex, null, 2))
  for (const en of await fsLow.readdir(historyDir)) {
    if (en.isDir || en.name === 'index.json') continue
    if (!snapIndex[en.name.replace(/\.md$/, '')]) await fsLow.unlink(joinPath(historyDir, en.name))
  }

  const payload = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    book,
    volumes: state.volumes.filter((v) => v.bookId === bookId),
    chaptersMeta,
    characters: state.characters.filter((c) => c.bookId === bookId),
    settings: state.settings.filter((c) => c.bookId === bookId),
    foreshadows: state.foreshadows.filter((c) => c.bookId === bookId),
  }
  await fsLow.writeFile(joinPath(dir, 'book.json'), JSON.stringify(payload, null, 2))
  return dir
}

export async function readProjectFromDir(dir: string): Promise<ProjectData> {
  const bookJsonPath = joinPath(dir, 'book.json')
  const raw = await fsLow.readFile(bookJsonPath)
  const parsed = JSON.parse(raw)
  if (parsed?.format !== PROJECT_FORMAT && parsed?.format !== LEGACY_PROJECT_FORMAT) {
    throw new Error('不是有效的字舟项目目录（缺少 book.json）')
  }

  const chapterContents: Record<ID, string> = {}
  const chaptersMeta: ChapterMeta[] = []
  for (const meta of parsed.chaptersMeta as ChapterMeta[]) {
    let raw = ''
    try {
      raw = await fsLow.readFile(joinPath(dir, 'chapters', meta.file))
    } catch {
      raw = ''
    }
    // md 头部 frontmatter 优先（外部编辑器改过的纲信息可回读）
    const { data, body } = parseFrontmatter(raw)
    chapterContents[meta.id] = body
    chaptersMeta.push({
      ...meta,
      title: data.title ?? meta.title,
      status: (data.status as ChapterStatus) ?? meta.status,
      outlineStatus: (data.outlineStatus as OutlineStatus) ?? meta.outlineStatus,
      synopsis: data.synopsis ?? meta.synopsis,
      goal: data.goal ?? meta.goal,
      conflict: data.conflict ?? meta.conflict,
      turning: data.turning ?? meta.turning,
      hook: data.hook ?? meta.hook,
      pov: data.pov ?? meta.pov,
      cast: data.cast ?? meta.cast,
      foreshadowIds: data.foreshadowIds ?? meta.foreshadowIds,
      foreshadowPayoffs: data.foreshadowPayoffs ?? meta.foreshadowPayoffs ?? [],
    })
  }

  const snapshots: ChapterSnapshot[] = []
  const historyDir = joinPath(dir, 'history')
  if (await fsLow.exists(historyDir)) {
    try {
      const idx = JSON.parse(await fsLow.readFile(joinPath(historyDir, 'index.json'))) as Record<
        string,
        { chapterId: ID; at: number }
      >
      for (const [id, meta] of Object.entries(idx)) {
        if (await fsLow.exists(joinPath(historyDir, `${id}.md`))) {
          snapshots.push({
            id,
            chapterId: meta.chapterId,
            at: meta.at,
            content: await fsLow.readFile(joinPath(historyDir, `${id}.md`)),
          })
        }
      }
    } catch {
      /* history 损坏时忽略 */
    }
  }

  return {
    book: parsed.book,
    volumes: parsed.volumes ?? [],
    chaptersMeta,
    chapterContents,
    characters: parsed.characters ?? [],
    settings: parsed.settings ?? [],
    foreshadows: parsed.foreshadows ?? [],
    snapshots,
  }
}

export async function isProjectDir(dir: string): Promise<boolean> {
  try {
    return await fsLow.exists(joinPath(dir, 'book.json'))
  } catch {
    return false
  }
}

/* --------------------------- 单文件 导出 --------------------------- */

export function exportBookTxt(state: AppState, bookId: ID): string {
  const book = state.books.find((b) => b.id === bookId)!
  const volumes = state.volumes.filter((v) => v.bookId === bookId).sort((a, b) => a.order - b.order)
  const out: string[] = [`《${book.title}》`, `作者：${book.author}`, '']

  for (const vol of volumes) {
    const chs = orderedChapters(state, bookId).filter((c) => c.volumeId === vol.id)
    if (chs.length === 0) continue
    out.push(`==== ${vol.title} ====`, '')
    for (const c of chs) {
      out.push(c.title, '', c.content.trim(), '', '')
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function exportBookMd(state: AppState, bookId: ID): string {
  const book = state.books.find((b) => b.id === bookId)!
  const volumes = state.volumes.filter((v) => v.bookId === bookId).sort((a, b) => a.order - b.order)
  const out: string[] = [`# ${book.title}`, '', `> ${book.genre} · ${book.author}`, '']
  if (book.synopsis) out.push(book.synopsis, '')

  for (const vol of volumes) {
    const chs = orderedChapters(state, bookId).filter((c) => c.volumeId === vol.id)
    if (chs.length === 0) continue
    out.push(`## ${vol.title}`, '')
    for (const c of chs) {
      out.push(`### ${c.title}`, '', c.content.trim(), '')
    }
  }
  return out.join('\n')
}

const OUTLINE_STATUS_LABEL: Record<OutlineStatus, string> = {
  plan: '计划中',
  written: '已成文',
  revised: '已修纲',
}

export function exportOutlineMd(state: AppState, bookId: ID): string {
  const book = state.books.find((b) => b.id === bookId)!
  const volumes = state.volumes.filter((v) => v.bookId === bookId).sort((a, b) => a.order - b.order)
  const chars = new Map(state.characters.filter((c) => c.bookId === bookId).map((c) => [c.id, c.name]))
  const fss = new Map(state.foreshadows.filter((f) => f.bookId === bookId).map((f) => [f.id, f.title]))

  const out: string[] = [`# ${book.title} · 全书大纲`, '', `> ${book.genre} · ${book.author}`, '']
  if (book.synopsis) out.push('## 总纲', '', book.synopsis, '')

  for (const vol of volumes) {
    const chs = orderedChapters(state, bookId).filter((c) => c.volumeId === vol.id)
    const words = chs.reduce((s, c) => s + countWords(c.content), 0)
    out.push(`## ${vol.title}`, '', `<sub>${chs.length} 章 · ${words} 字</sub>`, '')
    if (vol.synopsis) out.push(`- **卷纲**：${vol.synopsis}`)
    if (vol.goal) out.push(`- **本卷目标**：${vol.goal}`)
    if (vol.conflict) out.push(`- **核心冲突**：${vol.conflict}`)
    if (vol.synopsis || vol.goal || vol.conflict) out.push('')

    for (const c of chs) {
      out.push(`### ${c.title}`, '')
      const tags = [`纲状态：${OUTLINE_STATUS_LABEL[c.outlineStatus]}`, `字数：${countWords(c.content)}`]
      if (c.pov) tags.push(`视角：${c.pov}`)
      out.push(`<sub>${tags.join(' · ')}</sub>`, '')
      if (c.synopsis) out.push(`- **概括**：${c.synopsis}`)
      if (c.goal) out.push(`- **目标**：${c.goal}`)
      if (c.conflict) out.push(`- **冲突**：${c.conflict}`)
      if (c.turning) out.push(`- **转折**：${c.turning}`)
      if (c.hook) out.push(`- **钩子**：${c.hook}`)
      if (c.cast.length > 0) out.push(`- **登场**：${c.cast.map((id) => chars.get(id) ?? '未知角色').join('、')}`)
      if (c.foreshadowIds.length > 0 || c.foreshadowPayoffs.length > 0) {
        const parts: string[] = []
        if (c.foreshadowIds.length > 0) {
          parts.push(`埋：${c.foreshadowIds.map((id) => fss.get(id) ?? '未知伏笔').join('、')}`)
        }
        if (c.foreshadowPayoffs.length > 0) {
          parts.push(`收：${c.foreshadowPayoffs.map((id) => fss.get(id) ?? '未知伏笔').join('、')}`)
        }
        out.push(`- **伏笔**：${parts.join(' / ')}`)
      }
      out.push('')
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/* --------------------------- 单文件 导入 --------------------------- */

const CHAPTER_RE = /^第\s*[0-9一二三四五六七八九十百千两零]+\s*[章节回]/
const MD_H1 = /^#\s+(.+)/
const MD_H2 = /^#{2,}\s+(.+)/
const EN_CH = /^chapter\s+\d+/i

export function parseSingleText(rawText: string, fallbackTitle: string): ProjectData {
  const text = parseFrontmatter(rawText).body
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const volumes: Volume[] = []
  const chaptersMeta: ChapterMeta[] = []
  const contents: Record<ID, string> = {}

  let curVolId: ID | null = null
  let curChId: ID | null = null
  let lead: string[] = []
  let seq = 0

  function ensureVolume(title: string): ID {
    const existing = volumes.find((v) => v.title === title)
    if (existing) return existing.id
    const id = `imp_vol_${volumes.length}`
    volumes.push({ id, bookId: 'imp', title, order: volumes.length, synopsis: '', goal: '', conflict: '' })
    return id
  }

  function startChapter(title: string, volumeId: ID) {
    const id = `imp_ch_${seq++}`
    chaptersMeta.push({ id, volumeId, title, order: chaptersMeta.length, status: 'draft', synopsis: '', file: '' })
    contents[id] = ''
    curChId = id
  }

  for (const line of lines) {
    const h1 = line.match(MD_H1)
    const h2 = line.match(MD_H2)
    const isPlainCh = CHAPTER_RE.test(line.trim()) || EN_CH.test(line.trim())

    if (h1 && !isPlainCh) {
      // 一级标题视为分卷
      curVolId = ensureVolume(h1[1].trim())
      continue
    }
    if ((h2 || isPlainCh) && line.trim().length > 0) {
      const title = h2 ? h2[1].trim() : line.trim()
      if (!curVolId) curVolId = ensureVolume('第一卷')
      startChapter(title, curVolId)
      continue
    }
    if (curChId) contents[curChId] += line + '\n'
    else lead.push(line)
  }

  // 开头无章节归属的正文
  const leadText = lead.join('\n').trim()
  if (leadText && chaptersMeta.length > 0) {
    const id = `imp_ch_${seq++}`
    chaptersMeta.unshift({ id, volumeId: curVolId ?? ensureVolume('第一卷'), title: '引子', order: 0, status: 'draft', synopsis: '', file: '' })
    contents[id] = leadText
    // 重排 order
    chaptersMeta.forEach((m, i) => (m.order = i))
  } else if (leadText && chaptersMeta.length === 0) {
    const vid = ensureVolume('第一卷')
    startChapter(fallbackTitle || '正文', vid)
    contents[curChId!] = leadText
  }

  const book: Book = {
    id: 'imp',
    title: fallbackTitle || '导入作品',
    author: '佚名',
    genre: '玄幻奇幻',
    synopsis: '',
    coverColor: '#3aa0dd',
    status: 'ongoing',
    dailyGoal: 4000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  return { book, volumes, chaptersMeta, chapterContents: contents, characters: [], settings: [], foreshadows: [], snapshots: [] }
}

export function exportSettingsMd(state: AppState, bookId: ID): string {
  const book = state.books.find((b) => b.id === bookId)!
  const chars = state.characters.filter((c) => c.bookId === bookId)
  const sets = state.settings.filter((s) => s.bookId === bookId)
  const out: string[] = [`# ${book.title} · 设定集`, '', '## 角色', '']
  for (const c of chars) {
    out.push(`### ${c.name}${c.role ? `（${c.role}）` : ''}`)
    if (c.aliases?.length) out.push(`- 别名：${c.aliases.join('、')}`)
    if (c.status) out.push(`- 状态：${c.status}`)
    const fields: [keyof Character, string][] = [
      ['appearance', '外貌'], ['personality', '性格'], ['background', '背景'],
      ['motivation', '动机'], ['ability', '能力'],
    ]
    for (const [k, label] of fields) {
      const v = c[k]
      if (typeof v === 'string' && v.trim()) out.push(`- ${label}：${v}`)
    }
    if (c.desc) out.push(`- 备注：${c.desc}`)
    out.push('')
  }
  out.push('## 世界观设定', '')
  for (const s of sets) {
    out.push(`### [${s.category}] ${s.name}${s.status ? `（${s.status}）` : ''}`)
    if (s.desc) out.push(s.desc, '')
  }
  return out.join('\n')
}

export function exportForeshadowMd(state: AppState, bookId: ID): string {
  const book = state.books.find((b) => b.id === bookId)!
  const fss = state.foreshadows.filter((f) => f.bookId === bookId)
  const chs = state.chapters.filter((c) => c.bookId === bookId)
  const out: string[] = [`# ${book.title} · 伏笔表`, '']
  for (const f of fss) {
    const plant = chs.filter((c) => c.foreshadowIds.includes(f.id)).map((c) => c.title)
    const pay = chs.filter((c) => c.foreshadowPayoffs.includes(f.id)).map((c) => c.title)
    out.push(`## ${f.title}`)
    out.push(`- 状态：${f.status}　重要度：${f.priority ?? 'sub'}`)
    out.push(`- 埋设：${plant.join('、') || '未挂'}`)
    out.push(`- 回收：${pay.join('、') || '未收'}`)
    if (f.detail) out.push(`- 内容：${f.detail}`)
    out.push('')
  }
  return out.join('\n')
}

export function projectWordCount(p: ProjectData): number {
  return Object.values(p.chapterContents).reduce((s, t) => s + countWords(t), 0)
}
