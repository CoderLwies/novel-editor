import { describe, it, expect } from 'vitest'
import { parseJsonLoose, snapshotCast, consistencyCheck, charNames } from '../ai'
import type { AppState, Chapter, Character, Foreshadow } from '../types'

describe('parseJsonLoose', () => {
  it('解析纯 JSON / 代码块 / 前后杂文 / 数组', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonLoose('```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(parseJsonLoose('好的：{"a":3} 完毕')).toEqual({ a: 3 })
    expect(parseJsonLoose('[1,2]')).toEqual([1, 2])
  })

  it('非法输入抛错', () => {
    expect(() => parseJsonLoose('没有 json')).toThrow()
  })
})

describe('snapshotCast / charNames', () => {
  const chars = [
    { id: 'c1', bookId: 'b', name: '林尘', role: '', desc: '', aliases: ['林少爷'] },
    { id: 'c2', bookId: 'b', name: '苏瑶', role: '', desc: '' },
  ] as Character[]

  it('别名计入名字集合', () => {
    expect(charNames(chars[0])).toEqual(['林尘', '林少爷'])
  })

  it('名字与别名均命中且去重保序', () => {
    expect(snapshotCast('林少爷登场', chars, [])).toEqual(['c1'])
    expect(snapshotCast('苏瑶与林尘', chars, ['c2'])).toEqual(['c2', 'c1'])
  })
})

function mkState(opts: { chapters?: Partial<Chapter>[]; foreshadows?: Partial<Foreshadow>[]; characters?: Partial<Character>[] } = {}): AppState {
  return {
    books: [{ id: 'b', title: 'T', author: 'a', genre: 'g', synopsis: '', coverColor: '#000000', status: 'ongoing', dailyGoal: 1, createdAt: 1, updatedAt: 1 }],
    volumes: [{ id: 'v', bookId: 'b', title: 'V', order: 0, synopsis: '', goal: '', conflict: '' }],
    chapters: (opts.chapters ?? []).map((c, i) => ({
      id: `ch${i}`, bookId: 'b', volumeId: 'v', title: `第${i}章`, content: '', synopsis: '', order: i,
      status: 'draft', goal: '', conflict: '', turning: '', hook: '', pov: '', cast: [],
      foreshadowIds: [], foreshadowPayoffs: [], outlineStatus: 'plan', createdAt: 1, updatedAt: 1, ...c,
    })) as Chapter[],
    characters: (opts.characters ?? []) as Character[],
    settings: [],
    foreshadows: (opts.foreshadows ?? []) as Foreshadow[],
    dailyLog: {},
    ui: { theme: 'dark', fontSize: 16, lastBookId: null, lastChapterId: null, jump: null, lastGoalToastDate: '' },
    ai: { baseUrl: '', apiKey: '', model: '' },
    snapshots: [],
    references: [],
  } as AppState
}

describe('consistencyCheck', () => {
  it('有正文仍为计划中告警', () => {
    const issues = consistencyCheck(mkState({ chapters: [{ content: '正文内容' }] }), 'b')
    expect(issues.some((i) => i.level === 'warn' && i.text.includes('计划中'))).toBe(true)
  })

  it('挂角正文未出现与别名混用', () => {
    const st = mkState({
      chapters: [{ content: '林少爷来了', cast: ['c1'] }],
      characters: [{ id: 'c1', bookId: 'b', name: '林尘', role: '', desc: '', aliases: ['林少爷'] }],
    })
    const issues = consistencyCheck(st, 'b')
    expect(issues.some((i) => i.text.includes('未出现'))).toBe(false)
    const mixed = mkState({
      chapters: [{ content: '林尘与林少爷对峙', cast: ['c1'] }],
      characters: [{ id: 'c1', bookId: 'b', name: '林尘', role: '', desc: '', aliases: ['林少爷'] }],
    })
    expect(consistencyCheck(mixed, 'b').some((i) => i.text.includes('混用称呼'))).toBe(true)
  })

  it('伏笔埋设超十章未回收告警', () => {
    const chapters = Array.from({ length: 13 }, (_, i) => ({
      content: i === 0 ? '' : '正文'.repeat(10),
      foreshadowIds: i === 0 ? ['f1'] : [],
    }))
    const st = mkState({ chapters, foreshadows: [{ id: 'f1', bookId: 'b', title: '伏', detail: '', status: 'planted' }] })
    expect(consistencyCheck(st, 'b').some((i) => i.text.includes('仍未回收'))).toBe(true)
  })

  it('回收早于埋设与状态不符', () => {
    const st = mkState({
      chapters: [{ foreshadowPayoffs: ['f1'] }, { foreshadowIds: ['f1'] }],
      foreshadows: [{ id: 'f1', bookId: 'b', title: '伏', detail: '', status: 'planted' }],
    })
    const issues = consistencyCheck(st, 'b')
    expect(issues.some((i) => i.text.includes('早于埋设章'))).toBe(true)
    expect(issues.some((i) => i.text.includes('状态未同步'))).toBe(true)
  })

  it('已死亡角色仍挂接最新章告警', () => {
    const st = mkState({
      chapters: [{ content: 'x' }, { content: 'y', cast: ['c1'] }],
      characters: [{ id: 'c1', bookId: 'b', name: '亡者', role: '', desc: '', status: 'dead' }],
    })
    expect(consistencyCheck(st, 'b').some((i) => i.text.includes('已标记死亡'))).toBe(true)
  })
})
