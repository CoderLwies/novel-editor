import { describe, it, expect } from 'vitest'
import { migrate } from '../store'
import type { AppState } from '../types'

describe('migrate', () => {
  const raw = {
    books: [],
    volumes: [],
    chapters: [
      { id: 'c', bookId: 'b', volumeId: 'v', title: 't', content: '有正文', synopsis: '', order: 0, status: 'draft', createdAt: 1, updatedAt: 1 },
    ],
    characters: [],
    settings: [],
    foreshadows: [{ id: 'f', bookId: 'b', title: 't', detail: '', status: 'planted', chapterId: 'c' }],
    dailyLog: {},
    ui: { theme: 'dark', fontSize: 16, lastBookId: 'b', lastChapterId: 'c' },
  } as unknown as AppState

  it('补默认字段、剥离死字段、回落 AI 默认', () => {
    const m = migrate(raw)
    expect(m.chapters[0].outlineStatus).toBe('written')
    expect(m.chapters[0].cast).toEqual([])
    expect(m.chapters[0].foreshadowPayoffs).toEqual([])
    expect((m.foreshadows[0] as { chapterId?: string }).chapterId).toBeUndefined()
    expect(m.ai.model).toBe('deepseek-flash')
    expect(m.ai.baseUrl).toBe('https://api.deepseek.com')
    expect(m.snapshots).toEqual([])
    expect(m.ui.jump).toBeNull()
    expect(m.ui.lastGoalToastDate).toBe('')
  })

  it('保留用户已填的 baseUrl 与 model', () => {
    const withAi = { ...raw, ai: { baseUrl: 'http://x.test/v1', apiKey: 'k', model: 'my-model' } } as unknown as AppState
    const m = migrate(withAi)
    expect(m.ai.baseUrl).toBe('http://x.test/v1')
    expect(m.ai.model).toBe('my-model')
  })

  it('伏笔的可选字段（重要度/关联角色/关联设定）不被迁移清掉', () => {
    const st = {
      ...raw,
      foreshadows: [
        { id: 'f', bookId: 'b', title: 't', detail: '', status: 'planted', chapterId: 'c', priority: 'main', characterIds: ['c1'], settingIds: ['s1'] },
      ],
    } as unknown as AppState
    const m = migrate(st)
    expect(m.foreshadows[0].priority).toBe('main')
    expect(m.foreshadows[0].characterIds).toEqual(['c1'])
    expect(m.foreshadows[0].settingIds).toEqual(['s1'])
    expect((m.foreshadows[0] as { chapterId?: string }).chapterId).toBeUndefined()
  })
})
