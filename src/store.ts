import { useSyncExternalStore } from 'react'
import type {
  AppState,
  Book,
  Volume,
  Chapter,
  Character,
  SettingItem,
  Foreshadow,
  ID,
} from './types'
import type { ProjectData } from './project'
import { createSeedState } from './seed'
import { countWords, todayKey, uid } from './utils'

const STORAGE_KEY = 'novel-editor-state-v1'

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (parsed && Array.isArray(parsed.books)) return parsed
    }
  } catch {
    /* ignore corrupted state */
  }
  return createSeedState()
}

let state: AppState = load()
const listeners = new Set<() => void>()

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
      chapterId: data.chapterId,
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
    const volumes: Volume[] = data.volumes.map((v) => ({ ...v, id: volMap.get(v.id)!, bookId }))
    const chapters: Chapter[] = data.chaptersMeta.map((m) => ({
      id: chMap.get(m.id)!,
      bookId,
      volumeId: volMap.get(m.volumeId) ?? volumes[0]?.id ?? uid('vol'),
      title: m.title,
      content: data.chapterContents[m.id] ?? '',
      synopsis: m.synopsis ?? '',
      order: m.order,
      status: m.status ?? 'draft',
      createdAt: now,
      updatedAt: now,
    }))
    const characters: Character[] = data.characters.map((c) => ({ ...c, id: uid('char'), bookId }))
    const settings: SettingItem[] = data.settings.map((c) => ({ ...c, id: uid('set'), bookId }))
    const foreshadows: Foreshadow[] = data.foreshadows.map((f) => ({
      ...f,
      id: uid('fs'),
      bookId,
      chapterId: f.chapterId ? chMap.get(f.chapterId) : undefined,
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
