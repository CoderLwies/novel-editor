import { describe, it, expect } from 'vitest'
import { cacheMatches, remapArcs } from '../refanalysis'
import type { RawManifest } from '../reference'
import type { ChapterScope } from '../aiqueue'
import { planBatches } from '../aiqueue'
import type { PlotArc, PlotBeat, RefPlot } from '../refschema'

/**
 * 缓存对不上时宁可重跑，也不能静默串档。
 * 这是「换分析范围后结果错乱」那一类问题的唯一防线。
 */
describe('cacheMatches 档位校验', () => {
  const manifest = (over: Partial<RawManifest> = {}): RawManifest => ({
    stage: 'elements',
    batchChapters: 4,
    chapterCount: 100,
    scopeLabel: '每卷前 20 章',
    scopeRanges: [
      { from: 1, to: 20 },
      { from: 41, to: 60 },
    ],
    totalBatches: 10,
    batches: [],
    ...over,
  })
  const scope = (ranges: { from: number; to: number }[], total = 100): ChapterScope => ({
    label: 'x',
    ranges,
    totalChapters: total,
  })

  it('没有清单时视为可用（首次运行）', () => {
    expect(cacheMatches(null, 4, 100, scope([{ from: 1, to: 100 }]))).toBe(true)
  })

  it('同范围同批大小同章数 → 可续跑', () => {
    const s = scope([
      { from: 1, to: 20 },
      { from: 41, to: 60 },
    ])
    expect(cacheMatches(manifest(), 4, 100, s)).toBe(true)
  })

  it('换成全书 → 旧缓存作废', () => {
    expect(cacheMatches(manifest(), 4, 100, scope([{ from: 1, to: 100 }]))).toBe(false)
  })

  it('批大小或章节数变了 → 作废', () => {
    const s = scope([
      { from: 1, to: 20 },
      { from: 41, to: 60 },
    ])
    expect(cacheMatches(manifest(), 8, 100, s)).toBe(false)
    expect(cacheMatches(manifest(), 4, 99, s)).toBe(false)
  })

  it('旧缓存没有档位记录：只有全书才认', () => {
    const old = manifest({ scopeRanges: undefined })
    expect(cacheMatches(old, 4, 100, scope([{ from: 1, to: 100 }]))).toBe(true)
    expect(cacheMatches(old, 4, 100, scope([{ from: 1, to: 20 }]))).toBe(false)
  })
})

describe('remapArcs 重建时接回骨架', () => {
  const beat = (id: string, from: number, to: number): PlotBeat => ({
    id,
    refId: 'r1',
    fromChapter: from,
    toChapter: to,
    kind: 'build',
    title: id,
    summary: '',
    signal: '',
    cost: '',
    characters: [],
  })
  const arc = (ids: string[]): PlotArc => ({
    id: 'a1',
    refId: 'r1',
    title: '主线',
    beatIds: ids,
    fromChapter: 1,
    toChapter: 4,
    skeleton: { steps: [{ key: 's1', label: '起', require: '必须' }], suggestedSpan: 4 },
  })

  it('拍数与顺序一致时按位置重映射并保留骨架', () => {
    const old: RefPlot = {
      schemaVersion: 1, refId: 'r1', computedAt: 1,
      beats: [beat('old1', 1, 2), beat('old2', 3, 4)],
      arcs: [arc(['old1', 'old2'])],
    }
    const next = remapArcs(old, [beat('new1', 1, 2), beat('new2', 3, 4)])
    expect(next).toHaveLength(1)
    expect(next[0].beatIds).toEqual(['new1', 'new2'])
    expect(next[0].fromChapter).toBe(1)
    expect(next[0].toChapter).toBe(4)
    expect(next[0].skeleton?.steps[0].label).toBe('起')
  })

  it('拍数对不上就不接 —— 错位骨架比没有更糟', () => {
    const old: RefPlot = {
      schemaVersion: 1, refId: 'r1', computedAt: 1,
      beats: [beat('old1', 1, 2)],
      arcs: [arc(['old1'])],
    }
    expect(remapArcs(old, [beat('a', 1, 1), beat('b', 2, 2)])).toEqual([])
  })

  it('没有旧产物时返回空而不是抛错', () => {
    expect(remapArcs(null, [beat('a', 1, 1)])).toEqual([])
  })
})

describe('批次划分与档位（回归）', () => {
  it('每卷前 20 章的批次序号与全书**不**一一对应', () => {
    const perVolume = planBatches('r1', 'elements', {
      label: '每卷前 20 章',
      ranges: [{ from: 1, to: 20 }, { from: 41, to: 60 }],
      totalChapters: 100,
    }, 4)
    const all = planBatches('r1', 'elements', { label: '全书', ranges: [{ from: 1, to: 100 }], totalChapters: 100 }, 4)
    // 第 5 批开始就指向不同章节 —— 所以只按序号复用缓存一定会串
    expect(perVolume[5].fromChapter).toBe(41)
    expect(all[5].fromChapter).toBe(21)
  })
})
