import { useSyncExternalStore } from 'react'
import type {
  AppState,
  Book,
  Volume,
  Chapter,
  Character,
  SettingItem,
  Foreshadow,
  ForeshadowStatus,
  ChapterSnapshot,
  AIConfig,
  Reference,
  ID,
} from './types'
import type { ProjectData } from './project'
import { writeChapterFile, writeBookMeta, writeProjectToDir, stripContent, hydrateContent } from './project'
import { supportsFileStorage, getUserDataDir } from './fs'
import { analyzeStructure, runElementExtraction, runPlotExtraction, clearFailedBatches, rebuildFromRaw } from './refanalysis'
import type { RefStructure, RefElements, RefPlot } from './refschema'
import type { QueueProgress, AiStage, ScopeSpec } from './aiqueue'
import type { RunResult } from './aiqueue-runner'
import { aiReady, chatJSONWithUsage, SYS_PLANNER } from './ai'
import { SYS_CHECKLIST, type ChecklistResult, diffInsightPrompt, type DiffInsight } from './refprompt'
import {
  locatePrompt,
  normalizeLocate,
  checkRegression,
  rankCandidates,
  SYS_LOCATOR,
  type CandidateBeat,
  type LocateResult,
} from './reflocate'
import { createSeedState } from './seed'

/** 定位时送进 prompt 的候选上限。候选过多时按二元组重合度粗排 */
const MAX_LOCATE_CANDIDATES = 40

/** 定位结果：命中的候选拍 + 是否倒退提示 */
export interface LocatedBeat {
  result: LocateResult
  /** 命中的候选；未命中时为 null */
  picked: CandidateBeat | null
  /** 实际送进 prompt 的候选（粗排后的顺序） */
  candidates: CandidateBeat[]
  regression: { regressed: boolean; note?: string }
}
import { DEFAULT_AI_BASE_URL, AI_MODEL } from './ai'
import { countWords, todayKey, uid } from './utils'

const STORAGE_KEY = 'zizhou-state-v1'
const LEGACY_STORAGE_KEY = 'novel-editor-state-v1'

function load(): AppState {
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (raw) localStorage.setItem(STORAGE_KEY, raw)
    }
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (parsed && Array.isArray(parsed.books)) {
        const migrated = migrate(parsed)
        // 启动恒落书架，不恢复上次会话打开的书
        return { ...migrated, ui: { ...migrated.ui, lastBookId: null } }
      }
    }
  } catch {
    /* ignore corrupted state */
  }
  return createSeedState()
}

/** 旧版本 localStorage / 项目文件缺少大纲字段时补默认值 */
export function migrate(raw: AppState): AppState {
  const volumes = raw.volumes.map((v) => {
    const old = v as Partial<Volume>
    return { ...v, synopsis: old.synopsis ?? '', goal: old.goal ?? '', conflict: old.conflict ?? '' }
  })
  const chapters = raw.chapters.map((c) => {
    const old = c as Partial<Chapter>
    return {
      ...c,
      goal: old.goal ?? '',
      conflict: old.conflict ?? '',
      turning: old.turning ?? '',
      hook: old.hook ?? '',
      pov: old.pov ?? '',
      cast: old.cast ?? [],
      foreshadowIds: old.foreshadowIds ?? [],
      foreshadowPayoffs: old.foreshadowPayoffs ?? [],
      outlineStatus: old.outlineStatus ?? (countWords(old.content ?? '') > 0 ? 'written' : 'plan'),
    }
  })
  // 旧伏笔的 chapterId 为登记章死字段，迁移时剥离；其余可选字段（重要度/关联角色/关联设定）必须原样保留
  const foreshadows = raw.foreshadows.map((f) => {
    const { chapterId: _legacy, ...rest } = f as Foreshadow & { chapterId?: ID }
    return { ...rest, detail: f.detail ?? '', status: f.status ?? ('planted' as ForeshadowStatus) }
  })
  const ai = raw.ai
  return {
    ...raw,
    volumes,
    chapters,
    foreshadows,
    snapshots: raw.snapshots ?? [],
    references: raw.references ?? [],
    ui: { ...raw.ui, jump: null, lastGoalToastDate: raw.ui.lastGoalToastDate ?? '', onboarded: raw.ui.onboarded ?? true, recentBookIds: raw.ui.recentBookIds ?? [] },
    // 模型固定为 deepseek-flash；baseUrl 沿用用户已填值，否则回落到官方端点
    ai: {
      baseUrl: ai?.baseUrl?.trim() ? ai.baseUrl : DEFAULT_AI_BASE_URL,
      apiKey: ai?.apiKey ?? '',
      model: ai?.model?.trim() ? ai.model : AI_MODEL,
    },
  }
}

let state: AppState = load()
let hadStorageAtLoad = false
try {
  hadStorageAtLoad = localStorage.getItem(STORAGE_KEY) !== null
} catch {
  /* no storage */
}
const listeners = new Set<() => void>()

/** 每章快照上限 10 个，超出丢弃最旧 */
function pushCapped(list: ChapterSnapshot[], snap: ChapterSnapshot, chapterId: ID): ChapterSnapshot[] {
  const mine = list.filter((x) => x.chapterId === chapterId)
  const keep = mine.length >= 10 ? mine.slice(mine.length - 9) : mine
  const others = list.filter((x) => x.chapterId !== chapterId)
  return [...others, ...keep, snap]
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 正文有变化的章 → 落盘时只重写这些文件，不动全书 */
const dirtyChapters = new Set<ID>()
/** 元数据（书/卷/章纲/角色/设定/伏笔）有变化 → 需要重写 book.json */
let dirtyMeta = false
/** 文件写入进行中；避免并发 flush 打乱顺序 */
let flushing = false
let flushQueued = false
/** 正文是否已从磁盘回填完毕；false 时工作台需要显示载入态 */
let contentHydrated = false
const hydrateListeners = new Set<() => void>()

function notifyHydrated() {
  hydrateListeners.forEach((l) => l())
}

/** 正文回填进度。工作台据此显示载入态，避免 hydrate 覆盖用户刚输入的字 */
export function useContentHydrated(): boolean {
  return useSyncExternalStore(
    (cb) => {
      hydrateListeners.add(cb)
      return () => hydrateListeners.delete(cb)
    },
    () => contentHydrated,
    () => true,
  )
}

/**
 * 正文是否已落盘（该书绑定了目录）。
 * 未落盘的作品（浏览器端、或迁移前）正文仍留在 localStorage。
 */
function contentOnDisk(bookId: ID): boolean {
  return !!state.books.find((b) => b.id === bookId)?.projectPath
}

/**
 * 写入 localStorage。
 * 已落盘的作品剥离正文（容量问题的关键）；但**始终保留当前编辑章的正文**，
 * 因为 beforeunload 时异步文件写可能来不及，留它兜底防丢字。
 */
function writeNow() {
  try {
    const keep = state.ui.lastChapterId
    const meta = stripContent(state, (c) =>
      keep && c.id === keep && !!state.books.find((b) => b.id === c.bookId)?.projectPath ? c.content : '',
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta))
  } catch {
    /* storage full or unavailable */
  }
}

/** 真正把脏数据落盘；文件写入失败不阻断 localStorage 兜底 */
async function flushOnce() {
  if (supportsFileStorage) {
    for (const id of Array.from(dirtyChapters)) {
      const ch = state.chapters.find((c) => c.id === id)
      if (!ch || !contentOnDisk(ch.bookId)) continue
      try {
        await writeChapterFile(state, id)
        dirtyChapters.delete(id)
      } catch {
        /* 目录不可写时保留在 dirty，下轮重试；本轮仍写 localStorage 兜底 */
      }
    }
    if (dirtyMeta) {
      for (const b of state.books) {
        if (!b.projectPath) continue
        try {
          await writeBookMeta(state, b.id)
        } catch {
          /* 同上 */
        }
      }
      dirtyMeta = false
    }
  }
  writeNow()
}

function flushAsync() {
  if (flushing) {
    flushQueued = true
    return
  }
  flushing = true
  void (async () => {
    try {
      do {
        flushQueued = false
        await flushOnce()
      } while (flushQueued)
    } finally {
      flushing = false
    }
  })()
}

/** 防抖落盘：连续 set（如输入）合并为一次 */
function persist() {
  if (typeof window === 'undefined') return
  if (persistTimer !== null) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    flushAsync()
  }, 200)
}

export function flushPersist() {
  // 仅补写防抖未及的尾写；无待写不碰存储，避免覆盖外部对存储的直接修改
  if (persistTimer === null) return
  clearTimeout(persistTimer)
  persistTimer = null
  // 启动时存储有值、现被外部清空（如测试重置）：不复活内存旧数据
  if (hadStorageAtLoad) {
    try {
      if (localStorage.getItem(STORAGE_KEY) === null) return
    } catch {
      return
    }
  }
  // 卸载时刻必须同步兜底：文件写入是异步的，等不起
  writeNow()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPersist)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersist()
  })
}

const OUTLINE_KEYS = [
  'title',
  'synopsis',
  'goal',
  'conflict',
  'turning',
  'hook',
  'pov',
  'outlineStatus',
  'volumeId',
  'order',
  'status',
] as const

function set(updater: (s: AppState) => AppState) {
  const prev = state
  const next = updater(state)
  state = next

  if (prev.chapters !== next.chapters) {
    const prevById = new Map(prev.chapters.map((c) => [c.id, c]))
    let outlineChanged = false
    for (const c of next.chapters) {
      const p = prevById.get(c.id)
      if (!p) {
        dirtyChapters.add(c.id)
        outlineChanged = true
        continue
      }
      if (p.content !== c.content) dirtyChapters.add(c.id)
      if (OUTLINE_KEYS.some((k) => p[k] !== c[k])) outlineChanged = true
      // 挂接类字段变化也要反映到 book.json 的章纲里
      if (
        p.cast !== c.cast ||
        p.settingIds !== c.settingIds ||
        p.foreshadowIds !== c.foreshadowIds ||
        p.foreshadowPayoffs !== c.foreshadowPayoffs
      ) {
        outlineChanged = true
      }
    }
    if (outlineChanged) dirtyMeta = true
  }
  if (
    prev.books !== next.books ||
    prev.volumes !== next.volumes ||
    prev.characters !== next.characters ||
    prev.settings !== next.settings ||
    prev.foreshadows !== next.foreshadows
  ) {
    dirtyMeta = true
  }

  persist()
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function useStore(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * 启动引导：为未绑定目录的作品分配应用数据目录并把正文落盘，
 * 再把已落盘的正文回填回内存。浏览器端无此能力，直接跳过（正文留在 localStorage）。
 *
 * 幂等：每次启动都跑，已迁移过的书有 projectPath，不会重复分配。
 */
export async function bootstrapStorage(): Promise<void> {
  if (!supportsFileStorage) {
    contentHydrated = true
    notifyHydrated()
    return
  }
  try {
    const root = await getUserDataDir()

    // 1) 迁移：localStorage 里还带着正文、但没绑目录的作品，先落盘保住数据
    const needDir = state.books.filter(
      (b) => !b.projectPath && state.chapters.some((c) => c.bookId === b.id && c.content),
    )
    if (needDir.length) {
      const paths = new Map(needDir.map((b) => [b.id, `${root}/books/${b.id}`]))
      set((s) => ({
        ...s,
        books: s.books.map((b) => (paths.has(b.id) ? { ...b, projectPath: paths.get(b.id) } : b)),
      }))
      for (const b of needDir) {
        await writeProjectToDir(paths.get(b.id)!, state, b.id)
      }
    }

    // 2) 回填：localStorage 已剥离正文的作品，从 chapters/*.md 读回来
    state = await hydrateContent(state)
  } catch (e) {
    // 落盘不可用时保持 localStorage 全量模式，不能把 UI 卡在载入态
    console.warn('[字舟] 正文落盘不可用，本次退回 localStorage 全量模式：', e)
  } finally {
    contentHydrated = true
    listeners.forEach((l) => l())
    notifyHydrated()
  }
}

/* ------------------------------- actions ------------------------------- */

export const actions = {
  // Book
  createBook(data: Partial<Book>): Book {
    const book: Book = {
      id: uid('book'),
      title: data.title || '未命名作品',
      author: data.author || '佚名',
      genre: data.genre || '玄幻奇幻',
      synopsis: data.synopsis || '',
      coverColor: data.coverColor || randomCover(),
      status: data.status || 'ongoing',
      dailyGoal: data.dailyGoal ?? 4000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const vol: Volume = {
      id: uid('vol'),
      bookId: book.id,
      title: '第一卷',
      order: 0,
      synopsis: '',
      goal: '',
      conflict: '',
    }
    set((s) => ({
      ...s,
      books: [book, ...s.books],
      volumes: [...s.volumes, vol],
      ui: { ...s.ui, lastBookId: book.id, lastChapterId: null },
    }))
    return book
  },

  updateBook(id: ID, patch: Partial<Book>) {
    set((s) => ({
      ...s,
      books: s.books.map((b) => (b.id === id ? { ...b, ...patch, updatedAt: Date.now() } : b)),
    }))
  },

  deleteBook(id: ID) {
    set((s) => ({
      ...s,
      books: s.books.filter((b) => b.id !== id),
      volumes: s.volumes.filter((v) => v.bookId !== id),
      chapters: s.chapters.filter((c) => c.bookId !== id),
      characters: s.characters.filter((c) => c.bookId !== id),
      settings: s.settings.filter((c) => c.bookId !== id),
      foreshadows: s.foreshadows.filter((c) => c.bookId !== id),
      ui: {
        ...s.ui,
        lastBookId: s.ui.lastBookId === id ? null : s.ui.lastBookId,
        lastChapterId: null,
      },
    }))
  },

  setProjectPath(id: ID, projectPath: string | undefined) {
    set((s) => ({
      ...s,
      books: s.books.map((b) => (b.id === id ? { ...b, projectPath, updatedAt: Date.now() } : b)),
    }))
  },

  // Volume
  createVolume(bookId: ID, title: string): Volume {
    const vol: Volume = {
      id: uid('vol'),
      bookId,
      title: title || '新分卷',
      order: 0,
      synopsis: '',
      goal: '',
      conflict: '',
    }
    set((s) => {
      const order = s.volumes.filter((v) => v.bookId === bookId).length
      return { ...s, volumes: [...s.volumes, { ...vol, order }] }
    })
    return vol
  },

  updateVolume(id: ID, patch: Partial<Volume>) {
    set((s) => ({ ...s, volumes: s.volumes.map((v) => (v.id === id ? { ...v, ...patch } : v)) }))
  },

  deleteVolume(id: ID) {
    set((s) => ({
      ...s,
      volumes: s.volumes.filter((v) => v.id !== id),
      chapters: s.chapters.filter((c) => c.volumeId !== id),
    }))
  },

  // Chapter
  createChapter(bookId: ID, volumeId: ID, title = '新章节'): Chapter {
    const ch: Chapter = {
      id: uid('ch'),
      bookId,
      volumeId,
      title,
      content: '',
      synopsis: '',
      order: 0,
      status: 'draft',
      goal: '',
      conflict: '',
      turning: '',
      hook: '',
      pov: '',
      cast: [],
      foreshadowIds: [],
      foreshadowPayoffs: [],
      outlineStatus: 'plan',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    let created = ch
    set((s) => {
      const order = s.chapters.filter((c) => c.volumeId === volumeId).length
      created = { ...ch, order }
      return {
        ...s,
        chapters: [...s.chapters, created],
        ui: { ...s.ui, lastChapterId: created.id, lastBookId: bookId },
      }
    })
    return created
  },

  updateChapter(id: ID, patch: Partial<Chapter>) {
    set((s) => {
      const prev = s.chapters.find((c) => c.id === id)
      let dailyLog = s.dailyLog
      // 仅当正文字数增长时，累加到今日码字量
      if (prev && patch.content !== undefined) {
        const delta = countWords(patch.content) - countWords(prev.content)
        if (delta > 0) {
          const key = todayKey()
          dailyLog = { ...s.dailyLog, [key]: (s.dailyLog[key] ?? 0) + delta }
        }
      }
      return {
        ...s,
        dailyLog,
        chapters: s.chapters.map((c) =>
          c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c,
        ),
      }
    })
  },

  deleteChapter(id: ID) {
    set((s) => ({
      ...s,
      chapters: s.chapters.filter((c) => c.id !== id),
      ui: { ...s.ui, lastChapterId: s.ui.lastChapterId === id ? null : s.ui.lastChapterId },
    }))
  },

  /** 拖拽排序/跨卷移动：把章节放到目标卷的第 index 位 */
  moveChapter(id: ID, volumeId: ID, index: number) {
    set((s) => {
      const moving = s.chapters.find((c) => c.id === id)
      if (!moving) return s
      const rest = s.chapters
        .filter((c) => c.volumeId === volumeId && c.id !== id)
        .sort((a, b) => a.order - b.order)
      const at = Math.max(0, Math.min(index, rest.length))
      rest.splice(at, 0, moving)
      const orderOf = new Map(rest.map((c, i) => [c.id, i]))
      return {
        ...s,
        chapters: s.chapters.map((c) => {
          if (c.id === id) return { ...c, volumeId, order: orderOf.get(id)!, updatedAt: Date.now() }
          if (c.volumeId === volumeId && orderOf.has(c.id)) return { ...c, order: orderOf.get(c.id)! }
          return c
        }),
      }
    })
  },

  // Characters
  createCharacter(bookId: ID, data: Partial<Character>): Character {
    const c: Character = {
      id: uid('char'),
      bookId,
      name: data.name || '新角色',
      role: data.role || '',
      desc: data.desc || '',
    }
    set((s) => ({ ...s, characters: [...s.characters, c] }))
    return c
  },
  updateCharacter(id: ID, patch: Partial<Character>) {
    set((s) => ({ ...s, characters: s.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  },
  deleteCharacter(id: ID) {
    set((s) => ({ ...s, characters: s.characters.filter((c) => c.id !== id) }))
  },

  // Settings
  createSetting(bookId: ID, data: Partial<SettingItem>): SettingItem {
    const it: SettingItem = {
      id: uid('set'),
      bookId,
      category: data.category || 'rule',
      name: data.name || '新设定',
      desc: data.desc || '',
    }
    set((s) => ({ ...s, settings: [...s.settings, it] }))
    return it
  },
  updateSetting(id: ID, patch: Partial<SettingItem>) {
    set((s) => ({ ...s, settings: s.settings.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  },
  deleteSetting(id: ID) {
    set((s) => ({ ...s, settings: s.settings.filter((c) => c.id !== id) }))
  },

  // Foreshadows
  createForeshadow(bookId: ID, data: Partial<Foreshadow>): Foreshadow {
    const f: Foreshadow = {
      id: uid('fs'),
      bookId,
      title: data.title || '新伏笔',
      detail: data.detail || '',
      status: data.status || 'planted',
    }
    set((s) => ({ ...s, foreshadows: [...s.foreshadows, f] }))
    return f
  },
  updateForeshadow(id: ID, patch: Partial<Foreshadow>) {
    set((s) => ({
      ...s,
      foreshadows: s.foreshadows.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
  },
  deleteForeshadow(id: ID) {
    set((s) => ({ ...s, foreshadows: s.foreshadows.filter((c) => c.id !== id) }))
  },

  // UI
  setTheme(theme: 'light' | 'dark') {
    set((s) => ({ ...s, ui: { ...s.ui, theme } }))
  },
  setAiConfig(patch: Partial<AIConfig>) {
    set((s) => ({ ...s, ai: { ...s.ai, ...patch } }))
  },
  saveSnapshot(chapterId: ID) {
    set((s) => {
      const ch = s.chapters.find((c) => c.id === chapterId)
      if (!ch) return s
      const snap = { id: uid(), chapterId, at: Date.now(), content: ch.content }
      return { ...s, snapshots: pushCapped(s.snapshots, snap, chapterId) }
    })
  },
  restoreSnapshot(snapshotId: ID) {
    set((s) => {
      const snap = s.snapshots.find((x) => x.id === snapshotId)
      const ch = snap && s.chapters.find((c) => c.id === snap.chapterId)
      if (!snap || !ch) return s
      const backup = { id: uid(), chapterId: ch.id, at: Date.now(), content: ch.content }
      return {
        ...s,
        snapshots: pushCapped(s.snapshots, backup, ch.id),
        chapters: s.chapters.map((c) =>
          c.id === ch.id ? { ...c, content: snap.content, updatedAt: Date.now() } : c,
        ),
      }
    })
  },
  requestJump(chapterId: ID, index: number, length: number) {
    set((s) => ({
      ...s,
      ui: { ...s.ui, jump: { chapterId, index, length, nonce: (s.ui.jump?.nonce ?? 0) + 1 } },
    }))
  },
  setGoalToastDate(d: string) {
    set((s) => ({ ...s, ui: { ...s.ui, lastGoalToastDate: d } }))
  },
  setOnboarded(v: boolean) {
    set((s) => ({ ...s, ui: { ...s.ui, onboarded: v } }))
  },
  syncForeshadowStatus(fsId: ID) {
    set((s) => {
      const planted = s.chapters.some((c) => c.foreshadowIds.includes(fsId))
      const paid = s.chapters.some((c) => c.foreshadowPayoffs.includes(fsId))
      return {
        ...s,
        foreshadows: s.foreshadows.map((f) => {
          if (f.id !== fsId) return f
          if (paid && f.status !== 'resolved') return { ...f, status: 'resolved' as ForeshadowStatus }
          if (!paid && f.status === 'resolved') {
            return { ...f, status: (planted ? 'progressing' : 'planted') as ForeshadowStatus }
          }
          return f
        }),
      }
    })
  },
  setFontSize(fontSize: number) {
    set((s) => ({ ...s, ui: { ...s.ui, fontSize: Math.min(28, Math.max(13, fontSize)) } }))
  },
  openBook(bookId: ID, chapterId: ID | null = null) {
    set((s) => ({
      ...s,
      ui: {
        ...s.ui,
        lastBookId: bookId,
        lastChapterId: chapterId,
        recentBookIds: [bookId, ...(s.ui.recentBookIds ?? []).filter((x) => x !== bookId)].slice(0, 8),
      },
    }))
  },
  selectChapter(chapterId: ID) {
    set((s) => ({ ...s, ui: { ...s.ui, lastChapterId: chapterId } }))
  },
  closeBook() {
    set((s) => ({ ...s, ui: { ...s.ui, lastBookId: null, lastChapterId: null } }))
  },

  /** 合并导入的项目数据（重排 id 防冲突），返回新建的作品 */
  importProject(data: ProjectData, projectPath?: string): Book {
    const bookId = uid('book')
    const now = Date.now()
    const volMap = new Map<ID, ID>()
    const chMap = new Map<ID, ID>()
    data.volumes.forEach((v) => volMap.set(v.id, uid('vol')))
    data.chaptersMeta.forEach((m) => chMap.set(m.id, uid('ch')))

    const book: Book = {
      ...data.book,
      id: bookId,
      projectPath,
      createdAt: now,
      updatedAt: now,
    }
    const volumes: Volume[] = data.volumes.map((v) => ({
      ...v,
      id: volMap.get(v.id)!,
      bookId,
      synopsis: v.synopsis ?? '',
      goal: v.goal ?? '',
      conflict: v.conflict ?? '',
    }))
    const chapters: Chapter[] = data.chaptersMeta.map((m) => ({
      id: chMap.get(m.id)!,
      bookId,
      volumeId: volMap.get(m.volumeId) ?? volumes[0]?.id ?? uid('vol'),
      title: m.title,
      content: data.chapterContents[m.id] ?? '',
      synopsis: m.synopsis ?? '',
      order: m.order,
      status: m.status ?? 'draft',
      goal: m.goal ?? '',
      conflict: m.conflict ?? '',
      turning: m.turning ?? '',
      hook: m.hook ?? '',
      pov: m.pov ?? '',
      cast: m.cast ?? [],
      foreshadowIds: m.foreshadowIds ?? [],
      foreshadowPayoffs: m.foreshadowPayoffs ?? [],
      outlineStatus: m.outlineStatus ?? 'plan',
      createdAt: now,
      updatedAt: now,
    }))
    const characters: Character[] = data.characters.map((c) => ({ ...c, id: uid('char'), bookId }))
    const settings: SettingItem[] = data.settings.map((c) => ({ ...c, id: uid('set'), bookId }))
    const foreshadows: Foreshadow[] = data.foreshadows.map((f) => ({
      ...f,
      id: uid('fs'),
      bookId,
    }))
    const importedSnaps = (data.snapshots ?? [])
      .filter((sp) => chMap.has(sp.chapterId))
      .map((sp) => ({ ...sp, chapterId: chMap.get(sp.chapterId)! }))

    set((s) => ({
      ...s,
      books: [book, ...s.books],
      volumes: [...s.volumes, ...volumes],
      chapters: [...s.chapters, ...chapters],
      characters: [...s.characters, ...characters],
      settings: [...s.settings, ...settings],
      foreshadows: [...s.foreshadows, ...foreshadows],
      snapshots: [...s.snapshots.filter((x) => !importedSnaps.some((y) => y.id === x.id)), ...importedSnaps],
      ui: { ...s.ui, lastBookId: bookId, lastChapterId: chapters[0]?.id ?? null },
    }))
    return book
  },

  /** 新增一部参考作品（原文已由调用方落盘到 ref.dir） */
  addReference(ref: Reference) {
    set((s) => ({ ...s, references: [ref, ...s.references] }))
    return ref
  },

  /** 推进分析阶段（P1 流水线写回；此处只更轻量元数据，不碰正文） */
  updateReference(id: ID, patch: Partial<Reference>) {
    set((s) => ({
      ...s,
      references: s.references.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r)),
    }))
  },

  /**
   * 阶段一：结构与节奏统计。纯本地计算，不调 AI，可重复跑。
   * 返回统计结果，失败时抛出由调用方处理。
   */
  async analyzeStructure(id: ID): Promise<RefStructure> {
    const ref = state.references.find((r) => r.id === id)
    if (!ref) throw new Error('参考作品不存在')
    actions.updateReference(id, { stage: 'scanning' })
    try {
      const { structure, stage } = await analyzeStructure(ref)
      actions.updateReference(id, { stage })
      return structure
    } catch (e) {
      actions.updateReference(id, { stage: 'idle' })
      throw e
    }
  },

  /**
   * 阶段二：要素抽取（需 AI）。内部走队列，支持中断与断点续跑。
   * retryFailed=true 时只重跑上次失败的批次（对应 UI 的「重跑失败批次」）。
   */
  async extractElements(
    id: ID,
    opts: { onProgress?: (p: QueueProgress) => void; signal?: AbortSignal; retryFailed?: boolean; scope?: ScopeSpec } = {},
  ): Promise<{ elements: RefElements; run: RunResult }> {
    const ref = state.references.find((r) => r.id === id)
    if (!ref) throw new Error('参考作品不存在')
    if (!aiReady(state.ai)) throw new Error('尚未配置 AI 接口，请先在顶栏「AI 接口设置」里填好 Base URL 与 Key')

    if (opts.retryFailed) await clearFailedBatches(ref, 'elements')

    const { elements, run } = await runElementExtraction(ref, {
      ai: state.ai,
      onProgress: opts.onProgress,
      signal: opts.signal,
    })
    actions.updateReference(id, { stage: run.checkpoint.status === 'done' ? 'done' : 'scanned' })
    return { elements, run }
  },

  /** 阶段三：情节链拆解。需先有结构统计（拿到章序），但不必等要素抽取完成 */
  async extractPlot(
    id: ID,
    opts: { onProgress?: (p: QueueProgress) => void; signal?: AbortSignal; retryFailed?: boolean; scope?: ScopeSpec } = {},
  ): Promise<{ plot: RefPlot; run: RunResult; arcError: string | null }> {
    const ref = state.references.find((r) => r.id === id)
    if (!ref) throw new Error('参考作品不存在')
    if (!aiReady(state.ai)) throw new Error('尚未配置 AI 接口，请先在顶栏「AI 接口设置」里填好 Base URL 与 Key')

    if (opts.retryFailed) await clearFailedBatches(ref, 'plot')

    const { plot, run, arcError } = await runPlotExtraction(ref, {
      ai: state.ai,
      onProgress: opts.onProgress,
      signal: opts.signal,
    })
    actions.updateReference(id, { stage: run.checkpoint.status === 'done' ? 'done' : 'scanned' })
    return { plot, run, arcError }
  },

  /**
   * 按已写内容定位当前情节链。
   * 只做一次轻量调用（输入当前章 + 候选拍特征），不重跑分析。
   */
  async locateBeat(input: {
    chapterTitle: string
    content: string
    candidates: CandidateBeat[]
    previous?: { pickedIndex: number; title: string } | null
  }): Promise<LocatedBeat> {
    if (!aiReady(state.ai)) throw new Error('尚未配置 AI 接口，无法定位')
    const ranked = rankCandidates(input.candidates, input.content, MAX_LOCATE_CANDIDATES)
    if (!ranked.length) throw new Error('没有可用的候选情节拍，请先对参考书跑一次「情节链拆解」')

    const prompt = locatePrompt(input.chapterTitle, input.content, ranked, input.previous ?? null, 8000)
    const { data } = await chatJSONWithUsage<LocateResult>(state.ai, SYS_LOCATOR, prompt, 60000)
    const normalized = normalizeLocate(data, ranked)
    const picked = normalized.pickedIndex >= 0 ? ranked[normalized.pickedIndex] : null
    const regression = checkRegression(input.previous ?? null, normalized)
    return { result: normalized, picked, candidates: ranked, regression }
  },

  /** 单次轻量调用：归纳要素清单。刻意不走队列 —— 这不是批量任务 */
  async checklistOnce(prompt: string): Promise<ChecklistResult> {
    if (!aiReady(state.ai)) throw new Error('尚未配置 AI 接口')
    const { data } = await chatJSONWithUsage<ChecklistResult>(state.ai, SYS_CHECKLIST, prompt, 60000)
    return data
  },

  /**
   * 差异解读：输入是**已经算好的确定性统计**，模型只负责组织语言与指出取舍。
   * 不喂正文，所以它无从虚构事实。
   */
  async diffInsight(rows: string): Promise<DiffInsight> {
    if (!aiReady(state.ai)) throw new Error('尚未配置 AI 接口')
    const { data } = await chatJSONWithUsage<DiffInsight>(state.ai, SYS_PLANNER, diffInsightPrompt(rows), 60000)
    return data
  },

  /**
   * 从 raw/ 缓存重建产物 —— **不调用模型，零成本**。
   * 跑一本书 token 花费不小，任何环节失败都不该让已付费的成果不可见。
   */
  async rebuildFromCache(id: ID, stage: AiStage): Promise<{ ok: boolean; reason?: string; batches?: number }> {
    const ref = state.references.find((r) => r.id === id)
    if (!ref) throw new Error('参考作品不存在')
    const r = await rebuildFromRaw(ref, stage)
    if (r.ok) {
      actions.updateReference(id, { stage: stage === 'plot' ? 'done' : ref.stage === 'idle' ? 'scanned' : ref.stage })
    }
    return r
  },

  removeReference(id: ID) {
    set((s) => ({ ...s, references: s.references.filter((r) => r.id !== id) }))
  },

  resetDemo() {
    state = createSeedState()
    persist()
    listeners.forEach((l) => l())
  },
}

const COVER_COLORS = ['#6d5efc', '#f2762e', '#22b07d', '#e0467c', '#3aa0dd', '#8a63d2']
function randomCover() {
  return COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)]
}

/* ------------------------------ selectors ------------------------------ */

export function bookWordCount(s: AppState, bookId: ID): number {
  return s.chapters
    .filter((c) => c.bookId === bookId)
    .reduce((sum, c) => sum + countWords(c.content), 0)
}

export function chaptersOf(s: AppState, volumeId: ID): Chapter[] {
  return s.chapters.filter((c) => c.volumeId === volumeId).sort((a, b) => a.order - b.order)
}

export function volumesOf(s: AppState, bookId: ID): Volume[] {
  return s.volumes.filter((v) => v.bookId === bookId).sort((a, b) => a.order - b.order)
}
