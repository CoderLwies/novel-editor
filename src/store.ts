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
  ID,
} from './types'
import type { ProjectData } from './project'
import { createSeedState } from './seed'
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
function migrate(raw: AppState): AppState {
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
  // 旧伏笔的 chapterId 为登记章死字段，迁移时剥离
  const foreshadows = raw.foreshadows.map((f) => ({
    id: f.id,
    bookId: f.bookId,
    title: f.title,
    detail: f.detail ?? '',
    status: f.status ?? ('planted' as ForeshadowStatus),
  }))
  const ai = raw.ai
  return {
    ...raw,
    volumes,
    chapters,
    foreshadows,
    snapshots: raw.snapshots ?? [],
    ui: { ...raw.ui, jump: null, lastGoalToastDate: raw.ui.lastGoalToastDate ?? '' },
    // 模型固定为 deepseek-flash；baseUrl 沿用用户已填值，否则回落到官方端点
    ai: {
      baseUrl: ai?.baseUrl?.trim() ? ai.baseUrl : DEFAULT_AI_BASE_URL,
      apiKey: ai?.apiKey ?? '',
      model: ai?.model?.trim() ? ai.model : AI_MODEL,
    },
  }
}

let state: AppState = load()
const listeners = new Set<() => void>()

/** 每章快照上限 10 个，超出丢弃最旧 */
function pushCapped(list: ChapterSnapshot[], snap: ChapterSnapshot, chapterId: ID): ChapterSnapshot[] {
  const mine = list.filter((x) => x.chapterId === chapterId)
  const keep = mine.length >= 10 ? mine.slice(mine.length - 9) : mine
  const others = list.filter((x) => x.chapterId !== chapterId)
  return [...others, ...keep, snap]
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* storage full or unavailable */
  }
}

function set(updater: (s: AppState) => AppState) {
  state = updater(state)
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

  reorderVolumes(bookId: ID, orderedIds: ID[]) {
    set((s) => ({
      ...s,
      volumes: s.volumes.map((v) => {
        if (v.bookId !== bookId) return v
        const idx = orderedIds.indexOf(v.id)
        return idx === -1 ? v : { ...v, order: idx }
      }),
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
    set((s) => ({ ...s, ui: { ...s.ui, lastBookId: bookId, lastChapterId: chapterId } }))
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

    set((s) => ({
      ...s,
      books: [book, ...s.books],
      volumes: [...s.volumes, ...volumes],
      chapters: [...s.chapters, ...chapters],
      characters: [...s.characters, ...characters],
      settings: [...s.settings, ...settings],
      foreshadows: [...s.foreshadows, ...foreshadows],
      ui: { ...s.ui, lastBookId: bookId, lastChapterId: chapters[0]?.id ?? null },
    }))
    return book
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
