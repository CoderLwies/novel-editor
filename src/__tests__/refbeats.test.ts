import { describe, it, expect } from 'vitest'
import { BeatCollector, assembleArcs } from '../refbeats'
import { plotPrompt, arcPrompt, trimForCall, type BatchPlot, type ArcResult } from '../refprompt'
import type { PlotBeat } from '../refschema'
import { planBatches } from '../aiqueue'

const mkBeats = (beats: BatchPlot): BatchPlot => beats

describe('BeatCollector 跨批合并', () => {
  it('单批产出多拍', () => {
    const c = new BeatCollector()
    c.add(mkBeats({ beats: [
      { fromChapter: 1, toChapter: 3, kind: 'setup', title: '废柴开局', signal: '当众被贬', cost: '无硬性要求', characters: ['林渊'] },
      { fromChapter: 4, toChapter: 6, kind: 'payoff', title: '金手指觉醒', signal: '意外获得能力', cost: '能力必须有代价' },
    ] }), 1, 4)
    expect(c.length).toBe(2)
    expect(c.briefs()[1].title).toBe('金手指觉醒')
  })

  it('continuesFromPrev 把跨批的同一段情节并成一拍', () => {
    const c = new BeatCollector()
    c.add(mkBeats({ beats: [
      { fromChapter: 5, toChapter: 6, kind: 'conflict', title: '比武受辱', signal: '被当众羞辱', cost: '不能全身而退', characters: ['林渊'] },
    ] }), 5, 8)
    // 下一批开头仍在同一场冲突里
    c.add(mkBeats({ beats: [
      { fromChapter: 7, toChapter: 8, kind: 'conflict', title: '比武受辱', continuesFromPrev: true, signal: '被当众羞辱后无人出面维护，孤立无援', cost: '' },
    ] }), 9, 12)
    expect(c.length).toBe(1)
    const b = c.briefs()[0]
    expect(b.fromChapter).toBe(5)
    expect(b.toChapter).toBe(8)
    // 描述取更完整者
    expect(b.signal).toContain('孤立无援')
  })

  it('没有声明延续时不会被误并', () => {
    const c = new BeatCollector()
    c.add(mkBeats({ beats: [{ fromChapter: 1, toChapter: 4, kind: 'build', title: '铺陈A' }] }), 1, 4)
    c.add(mkBeats({ beats: [{ fromChapter: 5, toChapter: 8, kind: 'conflict', title: '冲突B' }] }), 5, 8)
    expect(c.length).toBe(2)
  })

  it('同 kind 但未声明延续 → 保持独立（宁可分开也不误并）', () => {
    const c = new BeatCollector()
    c.add(mkBeats({ beats: [{ fromChapter: 1, toChapter: 4, kind: 'payoff', title: '第一次打脸' }] }), 1, 4)
    c.add(mkBeats({ beats: [{ fromChapter: 20, toChapter: 24, kind: 'payoff', title: '第二次打脸' }] }), 21, 24)
    expect(c.length).toBe(2)
  })

  it('角色名单跨批合并去重', () => {
    const c = new BeatCollector()
    c.add(mkBeats({ beats: [{ fromChapter: 1, toChapter: 4, kind: 'conflict', title: 'A', characters: ['林渊', '周衍'] }] }), 1, 4)
    c.add(mkBeats({ beats: [{ fromChapter: 5, toChapter: 8, kind: 'conflict', title: 'A', continuesFromPrev: true, characters: ['林渊', '苏瑶'] }] }), 5, 8)
    expect(c.briefs()[0].characters.sort()).toEqual(['周衍', '林渊', '苏瑶'].sort())
  })

  it('非法 kind 或空标题被丢弃', () => {
    const c = new BeatCollector()
    c.add(mkBeats({ beats: [
      { fromChapter: 1, toChapter: 2, kind: 'unknown' as never, title: '坏类型' },
      { fromChapter: 3, toChapter: 4, kind: 'build', title: '  ' },
      { fromChapter: 5, toChapter: 6, kind: 'build', title: '好的' },
    ] }), 1, 6)
    expect(c.length).toBe(1)
    expect(c.briefs()[0].title).toBe('好的')
  })

  it('模型漏填章序时用批次范围兜底', () => {
    const c = new BeatCollector()
    c.add(mkBeats({ beats: [{ kind: 'setup', title: '开局' }] }), 1, 4)
    expect(c.briefs()[0].fromChapter).toBe(1)
    expect(c.briefs()[0].toChapter).toBe(4)
  })

  it('缺省 cost 填「无硬性要求」，不留空', () => {
    const c = new BeatCollector()
    c.add(mkBeats({ beats: [{ fromChapter: 1, toChapter: 2, kind: 'build', title: 'X', cost: '' }] }), 1, 4)
    expect(c.briefs()[0].cost).toBe('无硬性要求')
  })

  it('第一批没有前序拍时 lastBrief 为 null', () => {
    expect(new BeatCollector().lastBrief()).toBeNull()
  })

  it('从头/尾颠倒的章序会被纠正', () => {
    const c = new BeatCollector()
    c.add(mkBeats({ beats: [{ fromChapter: 8, toChapter: 3, kind: 'twist', title: '反转' }] }), 3, 8)
    expect(c.briefs()[0].fromChapter).toBe(3)
    expect(c.briefs()[0].toChapter).toBe(8)
  })

  it('72 批模拟：一段情节只产生预期数量的拍', () => {
    const c = new BeatCollector()
    const batches = planBatches('r1', 'plot', 288, 4)
    // 每 3 批一段新情节，共 24 段
    for (let bi = 0; bi < batches.length; bi++) {
      const b = batches[bi]
      const isNew = bi % 3 === 0
      c.add(mkBeats({ beats: [{
        fromChapter: b.fromChapter,
        toChapter: b.toChapter,
        kind: isNew ? 'conflict' : 'conflict',
        title: `第${Math.floor(bi / 3) + 1}段`,
        signal: 's',
        cost: 'c',
        characters: ['林渊'],
        continuesFromPrev: !isNew,
      }] }), b.fromChapter, b.toChapter)
    }
    expect(c.length).toBe(24)
    const first = c.briefs()[0]
    expect(first.fromChapter).toBe(1)
    expect(first.toChapter).toBe(12) // 3 批 × 4 章
  })
})

describe('assembleArcs 叙事线组装', () => {
  const beats: PlotBeat[] = Array.from({ length: 5 }, (_, i) => ({
    id: `b${i}`, refId: 'r1', fromChapter: i * 10 + 1, toChapter: i * 10 + 10,
    kind: 'conflict' as const, title: `拍${i}`, summary: '', signal: 's', cost: 'c', characters: [],
  }))
  const briefs = beats.map((b, i) => ({
    index: i, kind: b.kind, title: b.title, fromChapter: b.fromChapter, toChapter: b.toChapter,
    signal: b.signal, cost: b.cost, characters: [],
  }))

  it('按模型给的 beatIndexes 组装并挂上骨架', () => {
    const res: ArcResult = {
      arcs: [{
        title: '身份反转线',
        beatIndexes: [0, 1, 2],
        skeleton: {
          steps: [
            { key: 'humiliate', label: '受辱', require: '要有具体的羞辱场面' },
            { key: 'endure', label: '隐忍', require: '主角不能立刻反击' },
            { key: 'counter', label: '反打', require: '必须付出代价' },
          ],
          suggestedSpan: 20,
        },
      }],
    }
    const arcs = assembleArcs('r1', beats, res, briefs)
    expect(arcs).toHaveLength(1)
    expect(arcs[0].title).toBe('身份反转线')
    expect(arcs[0].beatIds).toEqual(['b0', 'b1', 'b2'])
    expect(arcs[0].fromChapter).toBe(1)
    expect(arcs[0].toChapter).toBe(30)
    expect(arcs[0].skeleton?.steps).toHaveLength(3)
    expect(arcs[0].skeleton?.suggestedSpan).toBe(20)
  })

  it('越界的 beatIndexes 被丢弃而不是造成错配', () => {
    const res: ArcResult = { arcs: [{ title: 'X', beatIndexes: [0, 99, -1, 2] }] }
    const arcs = assembleArcs('r1', beats, res, briefs)
    expect(arcs[0].beatIds).toEqual(['b0', 'b2'])
  })

  it('beatIndexes 全越界 → 整条线丢掉（宁可少一条也不出错线）', () => {
    const res: ArcResult = { arcs: [{ title: 'X', beatIndexes: [88, 99] }, { title: 'Y', beatIndexes: [1] }] }
    const arcs = assembleArcs('r1', beats, res, briefs)
    expect(arcs).toHaveLength(1)
    expect(arcs[0].title).toBe('Y')
  })

  it('没有骨架步骤时不给 skeleton 字段', () => {
    const res: ArcResult = { arcs: [{ title: 'X', beatIndexes: [0], skeleton: { steps: [] } }] }
    const arcs = assembleArcs('r1', beats, res, briefs)
    expect(arcs[0].skeleton).toBeUndefined()
  })

  it('步骤缺 label 的被过滤掉', () => {
    const res: ArcResult = {
      arcs: [{ title: 'X', beatIndexes: [0], skeleton: { steps: [{ key: 'a', label: '', require: 'r' }, { key: 'b', label: '留', require: 'r' }] } }],
    }
    const arcs = assembleArcs('r1', beats, res, briefs)
    expect(arcs[0].skeleton?.steps).toHaveLength(1)
    expect(arcs[0].skeleton?.steps[0].label).toBe('留')
  })

  it('模型返回空 arcs 时不崩', () => {
    expect(assembleArcs('r1', beats, {} as ArcResult, briefs)).toEqual([])
  })
})

describe('情节链 prompt', () => {
  const batch = planBatches('r1', 'plot', 20, 4)[1]

  it('给出上一拍的摘要供延续判断', () => {
    const p = plotPrompt('示例书', '玄幻', batch, [{ title: '第5章', text: '正文' }], {
      index: 0, kind: 'conflict', title: '比武受辱', fromChapter: 1, toChapter: 4, signal: '当众被羞辱', cost: '不能全身而退', characters: [],
    }, 10000)
    expect(p).toContain('上一批的最后一拍')
    expect(p).toContain('比武受辱')
    expect(p).toContain('continuesFromPrev')
    expect(p).toContain('当众被羞辱')
  })

  it('第一批说明没有前序情节', () => {
    const p = plotPrompt('示例书', '玄幻', batch, [{ title: '第5章', text: '正文' }], null, 10000)
    expect(p).toContain('这是第一批')
  })

  it('约束 signal 要可观察，cost 是硬要求', () => {
    const p = plotPrompt('示例书', '玄幻', batch, [{ title: '第5章', text: '正文' }], null, 10000)
    expect(p).toContain('可被识别的特征')
    expect(p).toContain('必须付出的代价')
    expect(p).toContain('不要把每一章都切成一拍')
    expect(p).toContain('不得虚构')
  })

  it('骨架 prompt 只含拍摘要，不含正文', () => {
    const p = arcPrompt('示例书', '玄幻', [
      { index: 0, kind: 'conflict', title: '受辱', fromChapter: 1, toChapter: 4, signal: '当众被羞辱', cost: '不能全身而退', characters: ['林渊'] },
    ])
    expect(p).toContain('#0 [conflict] 第1-4章「受辱」')
    expect(p).toContain('不含任何具体人名地名与原文')
    expect(p).toContain('suggestedSpan')
  })

  it('正文超长时仍按头尾裁剪', () => {
    const r = trimForCall(['甲'.repeat(500)], 100)
    expect(r.truncated).toBe(true)
    expect(r.text).toContain('已省略')
  })
})
