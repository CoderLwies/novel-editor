/**
 * 参考库：导入他人小说 → 拆章 → 落盘成参考作品。
 *
 * 与 project.ts（自己的作品）刻意分开：参考书不建 Book，不进书架，
 * 没有日更 / 字数统计 / 章树编辑；它只产出拆章原文 + 分析产物，落盘在独立目录里。
 *
 * 目录结构（绑定后）：
 *   <dir>/reference.json          元数据 + 当前分析阶段（断点续跑靠它）
 *   <dir>/chapters/NNNN_标题.txt  拆好的原文
 *   <dir>/analysis/               分析产物（P1 写入）
 */
import type { ID, RefVolume, Reference } from './types'
import { countWords } from './utils'
import { sanitizeFilename } from './project'
import { fsLow } from './fs'

export const REFERENCE_FORMAT = 'zizhou-reference'
export const REFERENCE_VERSION = 1

/* ------------------------------ 拆章 ------------------------------ */

/** 分卷：第X卷 / 卷X / 第X部 / 第X篇 */
const RE_VOLUME = /^(?:第\s*[0-9一二三四五六七八九十百千零两]+\s*[卷部篇]|[卷部篇]\s*[0-9一二三四五六七八九十百千零两]+)/
/** 章节：第X章 / 第X回 / 第X节 / 正文 第X章 / Chapter N / 12. 标题 */
const RE_CHAPTER =
  /^(?:正文\s*)?(?:第\s*[0-9一二三四五六七八九十百千零两]+\s*[章节回]|[0-9]{1,4}[.、]\s*\S|chapter\s+\d+)/i
/** 特殊章节：序章 / 楔子 / 番外 / 尾声 … */
const RE_SPECIAL = /^(?:序章|楔子|引子|前言|序言|后记|尾声|终章|番外|外传|完结感言|epilogue|prologue)/i

const MD_HEADING = /^(#{1,3})\s+(.+)$/
/** 正文里出现「第一章」这样的短行几乎必然是标题；过长的行是正文，不误判 */
const MAX_HEADING_CHARS = 40

export interface RefChapter {
  /** 1 起 */
  index: number
  title: string
  content: string
  /** 落在 volumes 的第几个（0 起） */
  volumeIndex: number
}

export interface SplitResult {
  volumes: RefVolume[]
  chapters: RefChapter[]
}

/**
 * 把一本小说的纯文本拆成卷章。
 * 纯函数，不碰 IO，方便单测。
 *
 * 与 project.ts 的 parseSingleText 相比补齐了：卷标（原来只认 MD 的 # 一级标题）、
 * 序章/番外/后记、以及「正文 第X章」这类带前缀的写法。
 */
export function splitReferenceText(raw: string): SplitResult {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')

  const volumes: RefVolume[] = []
  const chapters: RefChapter[] = []
  let volIdx = -1
  let curTitle = ''
  let buf: string[] = []
  let inLead = true

  function startVolume(title: string) {
    const t = title.trim()
    if (volIdx >= 0 && volumes[volIdx].title === t) return
    volumes.push({ title: t, chapterCount: 0 })
    volIdx = volumes.length - 1
  }

  function push(title: string, body: string) {
    if (volIdx < 0) startVolume('正文')
    chapters.push({ index: chapters.length + 1, title: title.trim(), content: body, volumeIndex: volIdx })
    volumes[volIdx].chapterCount += 1
  }

  function flush() {
    const body = buf.join('\n').trim()
    buf = []
    // 有标题就成章，哪怕正文为空 —— 丢标题会让章数错乱，直接污染后续分析
    if (!curTitle && !body) return
    push(curTitle || `第 ${chapters.length + 1} 章`, body)
    curTitle = ''
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')
    const t = line.trim()
    if (!t) {
      buf.push(line)
      continue
    }

    // Markdown 标题：一级=卷，二三级=章
    const h = t.match(MD_HEADING)
    if (h) {
      const level = h[1].length
      const title = h[2].trim()
      if (level === 1 && !RE_CHAPTER.test(title) && !RE_SPECIAL.test(title)) {
        flush()
        startVolume(title)
        inLead = false
      } else {
        beginChapter(title)
      }
      continue
    }

    if (t.length <= MAX_HEADING_CHARS) {
      if (RE_VOLUME.test(t)) {
        flush()
        startVolume(t)
        inLead = false
        continue
      }
      if (RE_CHAPTER.test(t) || RE_SPECIAL.test(t)) {
        beginChapter(t)
        continue
      }
    }

    buf.push(line)
  }
  flush()

  // 整篇没有任何章节标记：兜底切成单章，别让导入白跑一趟
  if (!chapters.length) {
    const body = lines.join('\n').trim()
    if (body) {
      volumes.push({ title: '正文', chapterCount: 1 })
      chapters.push({ index: 1, title: '正文', content: body, volumeIndex: 0 })
    }
  }

  return { volumes, chapters }

  /** 遇到章节标题：开头无归属的内容收为「引子」 */
  function beginChapter(title: string) {
    if (inLead) {
      const body = buf.join('\n').trim()
      buf = []
      inLead = false
      if (body) push('引子', body)
    } else {
      flush()
    }
    curTitle = title
  }
}

/** 目录导入：挑出正文文件并自然排序（第1章 排在 第10章 前面） */
export function pickChapterFiles(entries: FsDirEntry[], exts = ['.txt', '.md', '.markdown']): string[] {
  return entries
    .filter((e) => !e.isDir && exts.some((x) => e.name.toLowerCase().endsWith(x)))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))
    .map((e) => e.name)
}

/* ------------------------------ 落盘 ------------------------------ */

export interface ReferenceDraft {
  title: string
  author?: string
  genre?: string
  sourceEncoding: string
  volumes: RefVolume[]
  chapters: RefChapter[]
}

function chapterFileName(ch: RefChapter): string {
  return `${String(ch.index).padStart(4, '0')}_${sanitizeFilename(ch.title)}.txt`
}

/**
 * 把拆好的原文写进参考目录，并生成 reference.json。
 * 返回补全后的 Reference 元数据（调用方负责挂到 store 上）。
 */
export async function writeReferenceToDir(
  dir: string,
  draft: ReferenceDraft,
  refId: ID,
): Promise<Reference> {
  for (const ch of draft.chapters) {
    await fsLow.writeFile(`${dir}/chapters/${chapterFileName(ch)}`, ch.content)
  }
  const now = Date.now()
  const ref: Reference = {
    id: refId,
    title: draft.title,
    author: draft.author ?? '佚名',
    genre: draft.genre ?? '未分类',
    wordCount: draft.chapters.reduce((s, c) => s + countWords(c.content), 0),
    chapterCount: draft.chapters.length,
    volumes: draft.volumes,
    dir,
    sourceEncoding: draft.sourceEncoding,
    stage: 'idle',
    createdAt: now,
    updatedAt: now,
  }
  await writeReferenceMeta(ref)
  return ref
}

/** 只更新元数据（分析阶段推进时调用，不动正文） */
export async function writeReferenceMeta(ref: Reference): Promise<void> {
  await fsLow.writeFile(
    `${ref.dir}/reference.json`,
    JSON.stringify({ format: REFERENCE_FORMAT, version: REFERENCE_VERSION, ...ref }, null, 2),
  )
}

export async function isReferenceDir(dir: string): Promise<boolean> {
  return fsLow.exists(`${dir}/reference.json`)
}

export async function readReferenceMeta(dir: string): Promise<Reference | null> {
  if (!(await fsLow.exists(`${dir}/reference.json`))) return null
  try {
    const raw = await fsLow.readFile(`${dir}/reference.json`)
    const d = JSON.parse(raw)
    if (d?.format !== REFERENCE_FORMAT) return null
    return d as Reference
  } catch {
    return null
  }
}

/** 读回拆好的原文（P1 分析与报告回读用） */
export async function readReferenceChapters(ref: Reference): Promise<RefChapter[]> {
  const entries = await fsLow.readdir(`${ref.dir}/chapters`)
  const names = pickChapterFiles(entries)
  const out: RefChapter[] = []
  for (const name of names) {
    const text = await fsLow.readFile(`${ref.dir}/chapters/${name}`)
    const m = name.match(/^(\d+)_/)
    out.push({
      index: m ? Number(m[1]) : out.length + 1,
      title: name.replace(/^\d+_/, '').replace(/\.txt$/i, ''),
      content: text,
      volumeIndex: volumeIndexOf(ref, Number(m?.[1] ?? 0)),
    })
  }
  return out
}

function volumeIndexOf(ref: Reference, chapterIndex: number): number {
  let seen = 0
  for (let i = 0; i < ref.volumes.length; i++) {
    seen += ref.volumes[i].chapterCount
    if (chapterIndex <= seen) return i
  }
  return Math.max(0, ref.volumes.length - 1)
}

/* ---------------------------- 分析产物读写 ---------------------------- */

/** analysis/ 下的产物文件名。与 schema 一一对应 */
export const ANALYSIS_FILES = {
  structure: 'structure.json',
  elements: 'elements.json',
  plot: 'plot.json',
  templates: 'templates.json',
  checklists: 'checklists.json',
} as const

export async function writeReferenceAnalysis(
  ref: Reference,
  name: keyof typeof ANALYSIS_FILES,
  data: unknown,
): Promise<void> {
  await fsLow.writeFile(
    `${ref.dir}/analysis/${ANALYSIS_FILES[name]}`,
    JSON.stringify(data, null, 2),
  )
}

export async function readReferenceAnalysis<T>(
  ref: Reference,
  name: keyof typeof ANALYSIS_FILES,
): Promise<T | null> {
  const p = `${ref.dir}/analysis/${ANALYSIS_FILES[name]}`
  if (!(await fsLow.exists(p))) return null
  try {
    return JSON.parse(await fsLow.readFile(p)) as T
  } catch {
    return null
  }
}

/** 目录存在性体检：给导入向导用 */
export function describeImport(
  split: SplitResult,
  encoding: string,
): { volumes: number; chapters: number; words: number; encoding: string } {
  return {
    volumes: split.volumes.length,
    chapters: split.chapters.length,
    words: split.chapters.reduce((s, c) => s + countWords(c.content), 0),
    encoding,
  }
}
