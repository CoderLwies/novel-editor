import { describe, it, expect, beforeEach } from 'vitest'
import { actions, getState, migrate } from '../store'
import { resolveWorkspaceView } from '../route'
import { OS_META } from '../constants/outline'
import type { AppState } from '../types'

const legacy = {
  books: [],
  volumes: [],
  chapters: [],
  characters: [],
  settings: [],
  foreshadows: [],
  dailyLog: {},
  ui: { theme: 'dark', fontSize: 16, lastBookId: null, lastChapterId: null },
} as unknown as AppState

describe('工作台视图路由', () => {
  beforeEach(() => {
    actions.closeBook()
  })

  it('migrate 给旧数据补 view=write，并强制退出专注模式', () => {
    const m = migrate(legacy)
    expect(m.ui.view).toBe('write')
    expect(m.ui.focusMode).toBe(false)

    // 专注模式每次启动都要重置，即便旧数据里存着 true
    const stale = migrate({ ...legacy, ui: { ...legacy.ui, focusMode: true } })
    expect(stale.ui.focusMode).toBe(false)
  })

  it('旧数据里的 outline（旧大纲模式）迁移成规划台', () => {
    const old = migrate({ ...legacy, ui: { ...legacy.ui, view: 'outline' } as never })
    expect(old.ui.view).toBe('plan')
  })

  it('从书架进书一律落在正文台', () => {
    const book = actions.createBook({ title: '测试书' })
    actions.setView('plan')
    expect(getState().ui.view).toBe('plan')

    // 这条保证 E2E 里「导入项目后打开书 → 断言编辑器」不会落在规划台
    actions.openBook(book.id)
    expect(getState().ui.view).toBe('write')
    expect(getState().ui.lastBookId).toBe(book.id)
  })

  it('工作台内切视图不影响章节选中态', () => {
    const book = actions.createBook({ title: '测试书' })
    const vol = getState().volumes.find((v) => v.bookId === book.id)!
    const ch = actions.createChapter(book.id, vol.id, '第一章')

    actions.setView('plan')
    expect(getState().ui.view).toBe('plan')
    expect(getState().ui.lastChapterId).toBe(ch.id)

    actions.setView('write')
    expect(getState().ui.lastChapterId).toBe(ch.id)
  })

  it('openChapter 一并切回正文台', () => {
    const book = actions.createBook({ title: '测试书' })
    const vol = getState().volumes.find((v) => v.bookId === book.id)!
    const ch = actions.createChapter(book.id, vol.id, '第一章')

    actions.setView('plan')
    actions.openChapter(ch.id)
    expect(getState().ui.view).toBe('write')
    expect(getState().ui.lastChapterId).toBe(ch.id)
  })

  it('切到规划台自动退出专注模式（规划台没有退出入口）', () => {
    actions.setFocusMode(true)
    actions.setView('plan')
    expect(getState().ui.focusMode).toBe(false)
  })

  it('路由决策：view=plan 走规划台，其余走正文台', () => {
    const book = actions.createBook({ title: '测试书' })
    actions.openBook(book.id)
    expect(resolveWorkspaceView(getState())).toBe('write')

    actions.setView('plan')
    expect(resolveWorkspaceView(getState())).toBe('plan')
  })

  it('关书回到书架并重置视图', () => {
    actions.createBook({ title: '测试书' })
    actions.setView('plan')
    actions.closeBook()

    expect(getState().ui.lastBookId).toBeNull()
    expect(getState().ui.view).toBe('write')
  })
})

describe('OS_META 是纲状态的唯一来源', () => {
  it('目录树 / 大纲表 / 侧栏 / Markdown 导出共用同一份标签与色类', () => {
    expect(Object.keys(OS_META)).toEqual(['plan', 'written', 'revised'])
    expect(OS_META.plan.label).toBe('计划中')
    expect(OS_META.written.label).toBe('已成文')
    expect(OS_META.revised.label).toBe('已修纲')
    expect(OS_META.plan.cls).toBe('os-plan')
  })
})
