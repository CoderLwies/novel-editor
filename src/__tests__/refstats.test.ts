import { describe, it, expect } from 'vitest'
import { computeStructure, stdDev, tensionSignalsPerK, endsOpen } from '../refstats'
import { COMPARE_DIMENSIONS, RHYTHM_WINDOW, SCHEMA_VERSION, BEAT_KINDS } from '../refschema'
import type { RefChapter } from '../reference'

/** 造 n 章，正文长度按 pattern 决定，便于断言统计量 */
function mkChapters(n: number, wordsEach: (i: number) => number, volumeOf: (i: number) => number): RefChapter[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    title: `第${i + 1}章`,
    content: '字'.repeat(wordsEach(i)),
    volumeIndex: volumeOf(i),
  }))
}

describe('基础统计量', () => {
  it('标准差：总体口径，单样本/空样本为 0', () => {
    expect(stdDev([])).toBe(0)
    expect(stdDev([5])).toBe(0)
    // 均值 5，离差平方和 32，32/8 = 4，√4 = 2
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6)
  })

  it('标准差不会产出 NaN（章数为 0 / 1 的空书）', () => {
    const s = computeStructure({ refId: 'r', chapters: [], volumeTitles: [] })
    expect(Number.isNaN(s.chapterWordsStdDev)).toBe(false)
    expect(s.avgChapterWords).toBe(0)
  })

  it('张力信号按千字归一', () => {
    expect(tensionSignalsPerK('')).toBe(0)
    expect(tensionSignalsPerK('？'.repeat(10))).toBe(1000)
    expect(tensionSignalsPerK('？'.repeat(5) + '字'.repeat(995))).toBe(5)
  })

  it('留白判定看结尾标点', () => {
    expect(endsOpen('他走进了屋子')).toBe(true)
    expect(endsOpen('他走进屋子。')).toBe(false)
    expect(endsOpen('他说：「走吧」')).toBe(false)
    expect(endsOpen('')).toBe(false)
  })
})

describe('computeStructure', () => {
  it('规模与卷归属正确', () => {
    const chs = mkChapters(10, () => 1000, (i) => Math.floor(i / 5))
    const s = computeStructure({ refId: 'r1', chapters: chs, volumeTitles: ['卷一', '卷二'] })
    expect(s.refId).toBe('r1')
    expect(s.schemaVersion).toBe(SCHEMA_VERSION)
    expect(s.chapterCount).toBe(10)
    expect(s.volumeCount).toBe(2)
    expect(s.wordCount).toBe(10000)
    expect(s.avgChapterWords).toBe(1000)
    expect(s.volumes.map((v) => v.chapterCount)).toEqual([5, 5])
    // 卷的章序区间
    expect(s.volumes[0].startChapter).toBe(1)
    expect(s.volumes[0].endChapter).toBe(5)
    expect(s.volumes[1].startChapter).toBe(6)
    expect(s.volumes[1].endChapter).toBe(10)
  })

  it('分位数与分章一致', () => {
    // 章长 100..110，升序
    const chs = mkChapters(11, (i) => (i + 1) * 100, () => 0)
    const s = computeStructure({ refId: 'r', chapters: chs, volumeTitles: ['卷一'] })
    expect(s.chapterWordsQuantiles.p10).toBe(200)
    expect(s.chapterWordsQuantiles.p50).toBe(600)
    expect(s.chapterWordsQuantiles.p90).toBe(1000)
    expect(s.shortestChapter).toBe(1)
    expect(s.longestChapter).toBe(11)
  })

  it('节奏窗口固定 RHYTHM_WINDOW 章一格，最后一格可为残缺', () => {
    const chs = mkChapters(45, () => 1000, () => 0)
    const s = computeStructure({ refId: 'r', chapters: chs, volumeTitles: ['卷一'] })
    expect(RHYTHM_WINDOW).toBe(20)
    expect(s.rhythm).toHaveLength(3)
    expect(s.rhythm.map((r) => [r.from, r.to])).toEqual([
      [1, 20],
      [21, 40],
      [41, 45],
    ])
  })

  it('窗口内章长波动与留白率被正确聚合', () => {
    const chs = mkChapters(20, (i) => (i % 2 === 0 ? 1000 : 2000), () => 0)
    const s = computeStructure({ refId: 'r', chapters: chs, volumeTitles: ['卷一'] })
    expect(s.rhythm[0].avgWords).toBe(1500)
    expect(s.rhythm[0].wordsStdDev).toBeGreaterThan(0)
    expect(s.rhythm[0].endsOpenRatio).toBe(1) // 全部以「字」结尾，未用句号
  })

  it('卷归属由 volumeIndex 决定，与数组顺序无关', () => {
    const chs = mkChapters(4, () => 500, (i) => (i % 2 === 1 ? 1 : 0))
    const s = computeStructure({ refId: 'r', chapters: chs, volumeTitles: ['A', 'B'] })
    expect(s.volumes[0].chapterCount).toBe(2)
    expect(s.volumes[1].chapterCount).toBe(2)
  })
})

describe('跨书可比性（schema 冻结的核心约束）', () => {
  it('所有对比维度都能在任意结构的 schema 上求值，不产生 NaN', () => {
    const cases = [
      { refId: 'a', chapters: mkChapters(1, () => 100, () => 0), volumeTitles: ['v'] },
      { refId: 'b', chapters: mkChapters(60, (i) => 2000 + i, (i) => Math.floor(i / 20)), volumeTitles: ['v1', 'v2', 'v3'] },
      { refId: 'c', chapters: [], volumeTitles: [] },
    ]
    for (const c of cases) {
      const s = computeStructure(c)
      for (const d of COMPARE_DIMENSIONS) {
        const v = d.get(s)
        expect(Number.isFinite(v), `${d.key} on ${c.refId} => ${v}`).toBe(true)
      }
    }
  })

  it('不同章数的两本书，节奏窗口粒度一致（可逐格对齐）', () => {
    const a = computeStructure({ refId: 'a', chapters: mkChapters(40, () => 1000, () => 0), volumeTitles: ['v'] })
    const b = computeStructure({ refId: 'b', chapters: mkChapters(80, () => 1000, () => 0), volumeTitles: ['v'] })
    // 每格的起止章序完全对齐，与总章数无关
    expect(a.rhythm[0].from).toBe(b.rhythm[0].from)
    expect(a.rhythm[0].to).toBe(b.rhythm[0].to)
    expect(a.rhythm[1].from).toBe(b.rhythm[1].from)
  })

  it('情节类型枚举固定为六类', () => {
    expect(BEAT_KINDS).toEqual(['setup', 'build', 'conflict', 'twist', 'payoff', 'resolve'])
    expect(new Set(BEAT_KINDS).size).toBe(BEAT_KINDS.length)
  })

  it('对比维度 key 唯一，避免同名列冲突', () => {
    const keys = COMPARE_DIMENSIONS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
