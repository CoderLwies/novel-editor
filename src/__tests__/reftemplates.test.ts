import { describe, it, expect } from 'vitest'
import {
  plotTemplates,
  settingTemplates,
  structureTemplates,
  buildTemplates,
  markCrossBook,
  buildComparison,
  bestOf,
  diffSummary,
  COMPARE_DIMS,
  type RefAnalysisBundle,
} from '../reftemplates'
import type { RefStructure, RefPlot, RefElements } from '../refschema'
import type { ChecklistItem } from '../refderive'
import { diffInsightPrompt, templateSummaryPrompt } from '../refprompt'

const ref = (id: string, title: string, genre = '玄幻奇幻') =>
  ({ id, title, author: 'x', genre, wordCount: 0, chapterCount: 0, volumes: [], dir: '', sourceEncoding: 'utf-8', stage: 'done', createdAt: 1, updatedAt: 1 }) as any

const structure = (vols = 2): RefStructure => ({
  refId: 'r1', schemaVersion: 1, computedAt: 1, chapterCount: 20, volumeCount: vols,
  wordCount: 60000, avgChapterWords: 3000, chapterWordsStdDev: 420,
  chapterWordsQuantiles: { p10: 2600, p50: 3000, p90: 3500 },
  volumes: Array.from({ length: vols }, (_, i) => ({
    index: i, title: `卷${i + 1}`, chapterCount: 20 / vols, wordCount: 30000,
    avgChapterWords: 3000, startChapter: i * (20 / vols) + 1, endChapter: (i + 1) * (20 / vols),
  })),
  rhythm: [{ from: 1, to: 20, avgWords: 3000, wordsStdDev: 420, tensionSignalsPerK: 12, endsOpenRatio: 0.87 }],
  shortestChapter: 1, longestChapter: 2,
})

const plot = (arcs: { title: string; steps: { key: string; label: string; require: string }[]; span: number; from: number; to: number }[]): RefPlot => {
  const beats = arcs.flatMap((a) =>
    a.steps.map((s, i) => ({
      id: `${a.title}-${i}`, refId: 'r1', fromChapter: a.from + i, toChapter: a.from + i,
      kind: 'conflict' as const, title: s.label, summary: '', signal: 'sig', cost: s.require, characters: [],
    })),
  )
  return {
    schemaVersion: 1, refId: 'r1', computedAt: 1, beats,
    arcs: arcs.map((a, i) => ({
      id: `arc${i}`, refId: 'r1', title: a.title,
      beatIds: a.steps.map((_, j) => `${a.title}-${j}`),
      fromChapter: a.from, toChapter: a.to,
      skeleton: { steps: a.steps, suggestedSpan: a.span },
    })),
  }
}

const items: ChecklistItem[] = [
  { key: 'patron', label: '明面靠山', why: '没它势力一夜塌', keywords: ['靠山'] },
  { key: 'constraint', label: '不可撕破的约束', why: '没它打不起来', keywords: ['祖制'] },
]

const bundle = (over: Partial<RefAnalysisBundle> = {}): RefAnalysisBundle => ({
  ref: ref('r1', '书一'), structure: null, plot: null, elements: null, checklists: {}, ...over,
})

/** 简化步骤：只关心 label 是否一致 */
const step = (label: string) => ({ key: label, label, require: '' })

describe('情节模板（本地转换，零成本）', () => {
  it('从 skeleton 直接转成模板', () => {
    const ts = plotTemplates(bundle({
      plot: plot([{ title: '身份反转', steps: [{ key: 'a', label: '受辱', require: '要有具体羞辱场面' }, { key: 'b', label: '反打', require: '必须付代价' }], span: 20, from: 1, to: 21 }]),
    }))
    expect(ts).toHaveLength(1)
    expect(ts[0].kind).toBe('plot')
    expect(ts[0].title).toBe('身份反转')
    expect(ts[0].steps.map((s) => s.label)).toEqual(['受辱', '反打'])
    expect(ts[0].steps[0].require).toBe('要有具体羞辱场面')
    expect(ts[0].summary).toContain('受辱 → 反打')
  })

  it('没有骨架的线不产模板', () => {
    const p = plot([{ title: '过渡', steps: [], span: 5, from: 1, to: 5 }])
    expect(plotTemplates(bundle({ plot: p }))).toHaveLength(0)
  })

  it('溯源指向原书的章区间', () => {
    const ts = plotTemplates(bundle({ plot: plot([{ title: 'L', steps: [{ key: 'a', label: 'x', require: 'y' }], span: 3, from: 7, to: 10 }]) }))
    expect(ts[0].sources[0]).toMatchObject({ refId: 'r1', fromChapter: 7, toChapter: 10 })
  })
})

describe('设定模板', () => {
  it('清单转为模板，why 成为 require', () => {
    const ts = settingTemplates(bundle({ checklists: { 'faction:sect': items } }))
    expect(ts).toHaveLength(1)
    expect(ts[0].kind).toBe('setting')
    expect(ts[0].title).toContain('宗门')
    expect(ts[0].steps[0]).toMatchObject({ key: 'patron', label: '明面靠山', require: '没它势力一夜塌' })
  })

  it('空清单不产模板', () => {
    expect(settingTemplates(bundle({ checklists: { 'faction:sect': [] } }))).toHaveLength(0)
  })
})

describe('结构模板', () => {
  it('按每卷主导情节类型命名', () => {
    const ts = structureTemplates(bundle({
      structure: structure(2),
      plot: plot([{ title: '开篇', steps: [{ key: 'a', label: 'x', require: '' }], span: 2, from: 1, to: 2 }]),
    }))
    expect(ts).toHaveLength(2)
    expect(ts[0].title).toMatch(/第1卷 · .*型/)
  })

  it('缺 structure 或 plot 时不产出', () => {
    expect(structureTemplates(bundle({ plot: plot([{ title: 'x', steps: [{ key: 'a', label: 'y', require: '' }], span: 1, from: 1, to: 1 }]) }))).toHaveLength(0)
  })
})

describe('跨书共性标记', () => {
  it('步骤完全一致的多本计为共性，bookCount 提升', () => {
    const t1 = plotTemplates(bundle({ ref: ref('r1', '书一'), plot: plot([{ title: '同名线', steps: [step('受辱'), step('反打')], span: 20, from: 1, to: 21 }]) }))
    const t2 = plotTemplates(bundle({ ref: ref('r2', '书二'), plot: plot([{ title: '同名线', steps: [step('受辱'), step('反打')], span: 18, from: 1, to: 19 }]) }))
    const all = markCrossBook([...t1, ...t2])
    expect(all[0].bookCount).toBe(2)
    expect(all[1].bookCount).toBe(2)
  })

  it('步骤不同则不合并（不造谁也不适用的模板）', () => {
    const t1 = plotTemplates(bundle({ ref: ref('r1', 'A'), plot: plot([{ title: 'X', steps: [step('受辱'), step('反打')], span: 20, from: 1, to: 21 }]) }))
    const t2 = plotTemplates(bundle({ ref: ref('r2', 'B'), plot: plot([{ title: 'X', steps: [step('受辱'), step('翻盘')], span: 20, from: 1, to: 21 }]) }))
    const all = markCrossBook([...t1, ...t2])
    expect(all[0].bookCount).toBe(1)
    expect(all[1].bookCount).toBe(1)
  })

  it('单本模板 bookCount 为 1', () => {
    const ts = plotTemplates(bundle({ plot: plot([{ title: 'L', steps: [step('a')], span: 1, from: 1, to: 1 }]) }))
    expect(ts[0].bookCount).toBe(1)
  })

  it('buildTemplates 汇总三类', () => {
    const all = buildTemplates([
      bundle({
        ref: ref('r1', '书一'), structure: structure(2),
        plot: plot([{ title: 'L', steps: [step('a'), step('b')], span: 2, from: 1, to: 2 }]),
        checklists: { 'rule:x': items },
      }),
    ])
    expect(all.filter((t) => t.kind === 'plot')).toHaveLength(1)
    expect(all.filter((t) => t.kind === 'setting')).toHaveLength(1)
    expect(all.filter((t) => t.kind === 'structure').length).toBeGreaterThan(0)
  })

  it('空输入不崩', () => {
    expect(buildTemplates([])).toEqual([])
  })
})

describe('竞品对比', () => {
  const els = (n: number, fs = 0): RefElements => ({
    schemaVersion: 1, refId: 'r1', computedAt: 1,
    characters: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `c${i}`, aliases: [], role: '', appearance: '', personality: '', background: '', motivation: '', ability: '', speech: '', firstChapter: 1, lastChapter: 2, provenance: { refId: 'r1', fromChapter: 1, toChapter: 2 } })),
    settings: [],
    foreshadows: Array.from({ length: fs }, (_, i) => ({ id: `f${i}`, title: `f${i}`, detail: '', plantChapter: 1, payoffChapter: i % 2 ? 40 : 0, span: i % 2 ? 40 : 0, provenance: { refId: 'r1', fromChapter: 1, toChapter: 1 } })),
  })

  const cols = buildComparison([
    bundle({ ref: ref('r1', '书一'), structure: structure(2), plot: plot([{ title: 'L', steps: [step('a'), step('b')], span: 2, from: 1, to: 2 }]), elements: els(20, 10) }),
    bundle({ ref: ref('r2', '书二'), structure: { ...structure(4), volumeCount: 4, chapterCount: 40 }, elements: els(35, 4) }),
  ])

  it('每列都能算出全部维度且无 NaN', () => {
    expect(cols).toHaveLength(2)
    for (const d of COMPARE_DIMS) {
      for (const c of cols) expect(Number.isFinite(c.values[d.key]), `${d.key}/${c.title}`).toBe(true)
    }
  })

  it('缺分析产物时维度退化为 0 而不是崩', () => {
    const c = buildComparison([bundle()])[0]
    expect(c.values.chapters).toBe(0)
    expect(c.values.characters).toBe(0)
  })

  it('维度 key 唯一', () => {
    expect(new Set(COMPARE_DIMS.map((d) => d.key)).size).toBe(COMPARE_DIMS.length)
  })

  it('标注了哪些维度是弱信号', () => {
    expect(COMPARE_DIMS.filter((d) => d.weak).map((d) => d.key)).toContain('tension')
    expect(COMPARE_DIMS.filter((d) => d.weak).every((d) => !d.better)).toBe(true)
  })

  it('当前没有「越大越好」的维度，故不标最优', () => {
    // 章节数多只是连载长，不代表更好；标「最优」会误导作者去追一个中性指标
    expect(COMPARE_DIMS.every((d) => !d.better)).toBe(true)
    for (const d of COMPARE_DIMS) expect(bestOf(cols, d)).toEqual([])
  })

  it('bestOf 在有方向且多列时仍能正确选出', () => {
    const dim = { ...COMPARE_DIMS.find((d) => d.key === 'chapters')!, better: 'high' as const }
    expect(bestOf(cols, dim)).toEqual(['r2'])
    expect(bestOf([cols[0]], dim)).toEqual([]) // 单列不比较
    expect(bestOf(cols, { ...dim, better: 'low' })).toEqual(['r1'])
  })

  it('diffSummary 只含非弱信号维度且可读', () => {
    const s = diffSummary(cols)
    expect(s).toContain('章节数')
    expect(s).toContain('书一')
    expect(s).not.toContain('张力标点密度')
  })

  it('最长情节链按 arc 内 beat 的跨度算', () => {
    expect(cols[0].values.longestArc).toBe(2)
  })

  it('已回收伏笔数只统计有回收章的', () => {
    // 10 条里偶数索引(5条)有回收
    expect(cols[0].values.paidForeshadows).toBe(5)
    expect(cols[1].values.paidForeshadows).toBe(2)
  })
})

describe('提示词', () => {
  it('差异解读只喂统计、不含正文', () => {
    const p = diffInsightPrompt('章节数：书一 286 / 书二 412')
    expect(p).toContain('确定性统计')
    expect(p).toContain('不要编造数字')
    expect(p).toContain('schema')
  })

  it('模板润色只喂骨架', () => {
    const p = templateSummaryPrompt('情节', [{ label: '受辱', require: '要有具体场面' }])
    expect(p).toContain('受辱')
    expect(p).toContain('不提任何具体作品、人名、地名')
  })
})
