import type {
  AppState,
  Book,
  Volume,
  Character,
  SettingItem,
  Foreshadow,
  ChapterStatus,
  ID,
} from './types'
import { fsLow } from './fs'
import { countWords } from './utils'

export const PROJECT_FORMAT = 'novel-editor-project'
export const PROJECT_VERSION = 1

export interface ChapterMeta {
  id: ID
  volumeId: ID
  title: string
  order: number
  status: ChapterStatus
  synopsis: string
  file: string
}

export interface ProjectData {
  book: Book
  volumes: Volume[]
  chaptersMeta: ChapterMeta[]
  chapterContents: Record<ID, string>
  characters: Character[]
  settings: SettingItem[]
  foreshadows: Foreshadow[]
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
    })
    await fsLow.writeFile(joinPath(dir, 'chapters', file), c.content)
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
  if (parsed?.format !== PROJECT_FORMAT) {
    throw new Error('不是有效的墨章项目目录（缺少 book.json）')
  }

  const chapterContents: Record<ID, string> = {}
  for (const meta of parsed.chaptersMeta as ChapterMeta[]) {
    try {
      chapterContents[meta.id] = await fsLow.readFile(joinPath(dir, 'chapters', meta.file))
    } catch {
      chapterContents[meta.id] = ''
    }
  }

  return {
    book: parsed.book,
    volumes: parsed.volumes ?? [],
    chaptersMeta: parsed.chaptersMeta ?? [],
    chapterContents,
    characters: parsed.characters ?? [],
    settings: parsed.settings ?? [],
    foreshadows: parsed.foreshadows ?? [],
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

/* --------------------------- 单文件 导入 --------------------------- */

const CHAPTER_RE = /^第\s*[0-9一二三四五六七八九十百千两零]+\s*[章节回]/
const MD_H1 = /^#\s+(.+)/
const MD_H2 = /^#{2,}\s+(.+)/
const EN_CH = /^chapter\s+\d+/i

export function parseSingleText(text: string, fallbackTitle: string): ProjectData {
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
    volumes.push({ id, bookId: 'imp', title, order: volumes.length })
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

  return { book, volumes, chaptersMeta, chapterContents: contents, characters: [], settings: [], foreshadows: [] }
}

export function projectWordCount(p: ProjectData): number {
  return Object.values(p.chapterContents).reduce((s, t) => s + countWords(t), 0)
}
