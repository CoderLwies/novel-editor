import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * localStorage 落盘策略。
 *
 * store 模块在 import 时就会读 localStorage 并注册 beforeunload，
 * 所以这里的桩必须在 import 之前就位。
 */
const mem = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => mem.clear(),
})
vi.stubGlobal('window', { addEventListener: () => {} })
vi.stubGlobal('document', { addEventListener: () => {} })

const { actions, getState } = await import('../store')

const KEY = 'zizhou-state-v1'

/** 等 persist 的 200ms 防抖 + 异步 flush 走完 */
const settle = () => new Promise((r) => setTimeout(r, 350))

function savedState() {
  const raw = mem.get(KEY)
  expect(raw).toBeTruthy()
  return JSON.parse(raw!) as {
    chapters: { id: string; content: string }[]
  }
}

describe('localStorage 落盘策略', () => {
  beforeEach(() => {
    mem.clear()
  })

  it('未落盘作品（浏览器版唯一副本）必须保留正文，不能被剥掉', async () => {
    const book = actions.createBook({ title: '浏览器版书' })
    const vol = getState().volumes.find((v) => v.bookId === book.id)!
    const ch = actions.createChapter(book.id, vol.id, '第一章')
    actions.updateChapter(ch.id, { content: '这一段正文不能丢' })

    await settle()

    // 浏览器版没有 chapters/*.md 兜底，剥掉就是永久丢失
    const saved = savedState()
    expect(saved.chapters.find((c) => c.id === ch.id)!.content).toBe('这一段正文不能丢')
  })

  it('已落盘作品仍只保留当前编辑章正文（容量优化不能被破坏）', async () => {
    const book = actions.createBook({ title: '已落盘书' })
    actions.setProjectPath(book.id, 'D:/fake-dir')
    const vol = getState().volumes.find((v) => v.bookId === book.id)!
    const ch1 = actions.createChapter(book.id, vol.id, '第一章')
    const ch2 = actions.createChapter(book.id, vol.id, '第二章')
    actions.updateChapter(ch1.id, { content: '第一章正文' })
    actions.updateChapter(ch2.id, { content: '第二章正文' })
    actions.selectChapter(ch1.id)

    await settle()

    const saved = savedState()
    // 当前编辑章留作 beforeunload 兜底
    expect(saved.chapters.find((c) => c.id === ch1.id)!.content).toBe('第一章正文')
    // 其余正文在磁盘上，localStorage 不再重复存
    expect(saved.chapters.find((c) => c.id === ch2.id)!.content).toBe('')
  })
})
