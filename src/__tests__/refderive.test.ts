import { describe, it, expect } from 'vitest'
import { volumeMixFrom, mixBar, BEAT_COLOR, coverChecklist, groupBySubtype, subtypeLabel } from '../refderive'
import { sysChecklistPrompt, SYS_CHECKLIST, type ChecklistResult } from '../refprompt'
import { BEAT_KINDS } from '../refschema'
import type { RefStructure, RefPlot, RefElements } from '../refschema'

const mkStructure = (): RefStructure => ({
  refId: 'r1', schemaVersion: 1, computedAt: 1,
  chapterCount: 20, volumeCount: 2, wordCount: 20000, avgChapterWords: 1000, chapterWordsStdDev: 100,
  chapterWordsQuantiles: { p10: 800, p50: 1000, p90: 1200 },
  volumes: [
    { index: 0, title: '卷一', chapterCount: 10, wordCount: 10000, avgChapterWords: 1000, startChapter: 1, endChapter: 10 },
    { index: 1, title: '卷二', chapterCount: 10, wordCount: 10000, avgChapterWords: 1000, startChapter: 11, endChapter: 20 },
  ],
  rhythm: [], shortestChapter: 1, longestChapter: 2,
})

const mkPlot = (beats: RefPlot['beats']): RefPlot => ({
  schemaVersion: 1, refId: 'r1', computedAt: 1, beats,
  arcs: beats.map((b, i) => ({ id: `a${i}`, refId: 'r1', title: `线${i}`, beatIds: [b.id], fromChapter: b.fromChapter, toChapter: b.toChapter })),
})

const beat = (id: string, kind: (typeof BEAT_KINDS)[number], from: number, to: number) =>
  ({ id, refId: 'r1', fromChapter: from, toChapter: to, kind, title: id, summary: '', signal: '', cost: '', characters: [] })

describe('volumeMixFrom 卷配比', () => {
  it('按 kind 统计每卷覆盖的章数', () => {
    const mix = volumeMixFrom(mkStructure(), mkPlot([
      beat('b1', 'setup', 1, 3),
      beat('b2', 'conflict', 4, 6),
      beat('b3', 'payoff', 7, 9),
      beat('b4', 'conflict', 12, 14),
    ]))
    expect(mix).toHaveLength(2)
    expect(mix[0].counts.setup).toBe(3)
    expect(mix[0].counts.conflict).toBe(3)
    expect(mix[0].counts.payoff).toBe(3)
    expect(mix[1].counts.conflict).toBe(3)
  })

  it('占比之和不超过 1（拍可嵌套，不重复计数同一章的类型）', () => {
    const mix = volumeMixFrom(mkStructure(), mkPlot([beat('b1', 'conflict', 1, 10)]))
    const sum = BEAT_KINDS.reduce((s, k) => s + mix[0].ratios[k], 0)
    expect(sum).toBeLessThanOrEqual(1.0001)
    expect(mix[0].ratios.conflict).toBe(1)
  })

  it('跨卷的拍只计入各自卷内的部分', () => {
    // 一拍横跨两卷边界（8-15）
    const mix = volumeMixFrom(mkStructure(), mkPlot([beat('b1', 'twist', 8, 15)]))
    expect(mix[0].counts.twist).toBe(3) // 第 8、9、10 章
    expect(mix[1].counts.twist).toBe(5) // 第 11–15 章
  })

  it('没有 beats 时全为 0 而不是崩', () => {
    const mix = volumeMixFrom(mkStructure(), mkPlot([]))
    expect(mix[0].counts.setup).toBe(0)
    expect(Object.values(mix[0].ratios).every((r) => r === 0)).toBe(true)
  })

  it('plot 缺失时退化为空数组', () => {
    const mix = volumeMixFrom(mkStructure(), null as never)
    expect(Array.isArray(mix)).toBe(true)
  })

  it('mixBar 过滤掉占比为 0 的类型', () => {
    const mix = volumeMixFrom(mkStructure(), mkPlot([beat('b1', 'setup', 1, 10)]))
    const bar = mixBar(mix[0])
    expect(bar).toHaveLength(1)
    expect(bar[0].kind).toBe('setup')
  })

  it('六种情节类型都有配色', () => {
    for (const k of BEAT_KINDS) expect(BEAT_COLOR[k]).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('coverChecklist 缺口判定', () => {
  const items = [
    { key: 'patron', label: '明面靠山', why: '没有它势力一夜塌', keywords: ['靠山', '兵部', '挂靠'] },
    { key: 'constraint', label: '不可撕破的约束', why: '没它想输都输不掉', keywords: ['祖制', '密旨', '人质'] },
  ]

  it('命中关键词算已覆盖', () => {
    const r = coverChecklist({ desc: '挂靠兵部，掌北境三镇调防', status: '活跃' }, items)
    expect(r[0].hit).toBe(true)
    expect(r[0].matchedKeyword).toBe('兵部')
    expect(r[1].hit).toBe(false)
  })

  it('状态字段也参与匹配', () => {
    const r = coverChecklist({ desc: '', status: '受祖制限制' }, items)
    expect(r[1].hit).toBe(true)
  })

  it('全都不沾 → 全部算缺失', () => {
    const r = coverChecklist({ desc: '掌京城北防务', status: '' }, items)
    expect(r.every((x) => !x.hit)).toBe(true)
  })

  it('空描述不崩', () => {
    expect(coverChecklist({}, items)).toHaveLength(2)
  })

  it('无关键词的项永远算缺失（不该被误判为已有）', () => {
    const r = coverChecklist({ desc: '任何内容' }, [{ key: 'x', label: 'L', why: 'w', keywords: [] }])
    expect(r[0].hit).toBe(false)
  })
})

describe('groupBySubtype 同类设定分组', () => {
  const els = (settings: RefElements['settings'], title: string, refId: string) =>
    ({ refId, refTitle: title, elements: { schemaVersion: 1, refId, computedAt: 1, characters: [], settings, foreshadows: [] } as RefElements })

  it('按 category + subtype 分组，跨书合并', () => {
    const groups = groupBySubtype(
      [
        els([{ id: 's1', category: 'faction', name: '镇北司', desc: '', status: '', subtype: 'sect', chapters: [], provenance: { refId: 'r1', fromChapter: 1, toChapter: 1 } }], '书A', 'r1'),
        els([{ id: 's2', category: 'faction', name: '东宫', desc: '', status: '', subtype: 'sect', chapters: [], provenance: { refId: 'r2', fromChapter: 1, toChapter: 1 } }], '书B', 'r2'),
        els([{ id: 's3', category: 'faction', name: '青云宗', desc: '', status: '', subtype: 'sect', chapters: [], provenance: { refId: 'r2', fromChapter: 1, toChapter: 1 } }], '书B', 'r2'),
        els([{ id: 's4', category: 'item', name: '灵剑', desc: '', status: '', subtype: '', chapters: [], provenance: { refId: 'r2', fromChapter: 1, toChapter: 1 } }], '书B', 'r2'),
      ],
      'faction',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].subtype).toBe('sect')
    expect(groups[0].items).toHaveLength(3)
    expect(groups[0].items.map((i) => i.refTitle)).toContain('书A')
  })

  it('只取指定 category', () => {
    const groups = groupBySubtype(
      [els([{ id: 's1', category: 'item', name: '剑', desc: '', status: '', subtype: '', chapters: [], provenance: { refId: 'r', fromChapter: 1, toChapter: 1 } }], 'A', 'r')],
      'faction',
    )
    expect(groups).toHaveLength(0)
  })

  it('空 subtype 归入「未分类」而非被丢掉', () => {
    const groups = groupBySubtype(
      [els([{ id: 's1', category: 'faction', name: 'X', desc: '', status: '', subtype: '', chapters: [], provenance: { refId: 'r', fromChapter: 1, toChapter: 1 } }], 'A', 'r')],
      'faction',
    )
    expect(groups[0].subtype).toBe('未分类')
  })

  it('子类型显示名，未知的原样返回', () => {
    expect(subtypeLabel('sect')).toBe('宗门')
    expect(subtypeLabel('dynasty')).toBe('王朝')
    expect(subtypeLabel('外星组织')).toBe('外星组织')
  })
})

describe('要素清单 prompt', () => {
  const items = [
    { name: '镇北司', desc: '挂靠兵部，祖制不得调兵入京', status: '活跃', refTitle: '书A' },
    { name: '东宫', desc: '受密旨约束，不能公开动刑', status: '', refTitle: '书B' },
  ]

  it('带上同类设定原文与来源', () => {
    const p = sysChecklistPrompt('势力', '宗门', items)
    expect(p).toContain('镇北司')
    expect(p).toContain('挂靠兵部')
    expect(p).toContain('《书A》')
    expect(p).toContain('why')
    expect(p).toContain('keywords')
  })

  it('要求关键词可判定，且不要通用词', () => {
    const p = sysChecklistPrompt('势力', '宗门', items)
    expect(p).toContain('有没有被写到')
    expect(p).toContain('不要取太通用的词')
  })

  it('反幻觉约束在 system 里', () => {
    expect(SYS_CHECKLIST).toContain('只输出符合 schema 的 JSON')
    expect(SYS_CHECKLIST).toContain('不得凭空发明')
  })

  it('空列表不崩', () => {
    expect(() => sysChecklistPrompt('势力', '宗门', [])).not.toThrow()
  })

  it('ChecklistResult 结构可空', () => {
    const r: ChecklistResult = {}
    expect(r.items).toBeUndefined()
  })
})
