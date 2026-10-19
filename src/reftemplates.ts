/**
 * 借鉴模板库：把各参考书的分析产物汇成一套可迁移的方法。
 *
 * 设计要点：**模板主体是本地转换出来的，不调模型。**
 * 情节骨架本来就在 plot.json 的 skeleton 里，要素清单本来就在 checklists.json 里，
 * 卷配比本来就能从 beats 算出来 —— 这些都已经是"结构化方法"了，
 * 再让模型重述一遍只会花钱并引入偏差。模型只在可选的 summary 润色时出手一次。
 */
import { uid } from './utils'
import type { Reference } from './types'
import type {
  RefTemplate,
  TemplateKind,
  RefPlot,
  RefStructure,
  RefElements,
} from './refschema'
import { BEAT_KINDS, BEAT_KIND_LABEL } from './refschema'
import type { ChecklistItem } from './refderive'
import { volumeMixFrom, BEAT_COLOR, subtypeLabel } from './refderive'

export interface RefAnalysisBundle {
  ref: Reference
  structure: RefStructure | null
  plot: RefPlot | null
  elements: RefElements | null
  /** 该书各类别的要素清单：key 为 `${category}:${subtype}` */
  checklists: Record<string, ChecklistItem[]>
}

/* ============================== 情节模板 ============================== */

/** 从 plot.json 的骨架直接转成本地可用的模板 —— 零成本 */
export function plotTemplates(b: RefAnalysisBundle): RefTemplate[] {
  const out: RefTemplate[] = []
  for (const arc of b.plot?.arcs ?? []) {
    const steps = (arc.skeleton?.steps ?? []).filter((s) => s.label)
    if (!steps.length) continue
    out.push({
      id: uid('tpl'),
      kind: 'plot',
      title: arc.title || steps[0].label,
      // 本地拼一句可读的概述：列出步骤即可，不臆造评价
      summary: `${steps.length} 步 · 建议跨度 ${arc.skeleton?.suggestedSpan ?? arc.toChapter - arc.fromChapter + 1} 章。${steps.map((s) => s.label).join(' → ')}`,
      steps,
      genres: b.ref.genre ? [b.ref.genre] : [],
      sources: [{ refId: b.ref.id, fromChapter: arc.fromChapter, toChapter: arc.toChapter }],
      bookCount: 1,
    })
  }
  return out
}

/* ============================== 设定模板 ============================== */

/** 从要素清单转模板 —— 零成本。清单本就带 why，比任何摘要都有用 */
export function settingTemplates(b: RefAnalysisBundle): RefTemplate[] {
  const out: RefTemplate[] = []
  for (const [key, items] of Object.entries(b.checklists ?? {})) {
    if (!items?.length) continue
    const [category, subtype] = key.split(':')
    out.push({
      id: uid('tpl'),
      kind: 'setting',
      title: `${subtypeLabel(subtype || category)} · ${items.length} 项要素`,
      summary: `这一类${category}要立得住，必须具备这 ${items.length} 项。缺任何一项都会导致它「用不了」或「打不动」。`,
      steps: items.map((i, k) => ({ key: i.key || `s${k}`, label: i.label, require: i.why })),
      genres: b.ref.genre ? [b.ref.genre] : [],
      sources: [{ refId: b.ref.id, fromChapter: 0, toChapter: 0 }],
      bookCount: 1,
    })
  }
  return out
}

/* ============================== 结构模板 ============================== */

/**
 * 结构模板 = 每一卷的功能定位。
 * 用规则命名（按主导情节类型组合），不调模型 —— 数字本身已经是结论。
 */
export function structureTemplates(b: RefAnalysisBundle): RefTemplate[] {
  const s = b.structure
  const p = b.plot
  if (!s || !p) return []
  // 空卷不生成模板：0 章的「过渡型」卡片只会稀释模板库
  const mix = volumeMixFrom(s, p).filter((m) => m.chapterCount > 0 && m.endChapter >= m.startChapter)
  if (!mix.length) return []

  const total = mix.reduce((n, m) => n + m.chapterCount, 0) || 1
  return mix.map((m) => {
    // 主导类型取占比前二，其余归为「其他」
    const top = Object.entries(m.ratios)
      .filter(([, v]) => v > 0)
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, 2)
    const name = top.length
      ? top.map(([k]) => BEAT_KIND_LABEL[k as keyof typeof BEAT_KIND_LABEL]).join('+')
      : '过渡'
    const share = Math.round((m.chapterCount / total) * 100)
    return {
      id: uid('tpl'),
      kind: 'structure' as TemplateKind,
      title: `第${m.index + 1}卷 · ${name}型`,
      summary:
        `本卷 ${m.chapterCount} 章（占全书 ${share}%），` +
        `情节以${top.map(([k, v]) => `${BEAT_KIND_LABEL[k as keyof typeof BEAT_KIND_LABEL]} ${Math.round(v * 100)}%`).join('、') || '过渡'}为主。`,
      steps: top.length
        ? top.map(([k, v]) => ({
            key: k,
            label: `${BEAT_KIND_LABEL[k as keyof typeof BEAT_KIND_LABEL]} ${Math.round(v * 100)}%`,
            require: `本卷 ${Math.round(m.ratios[k as keyof typeof m.ratios] * m.chapterCount)} 章承担这一功能`,
          }))
        : [],
      genres: b.ref.genre ? [b.ref.genre] : [],
      sources: [{ refId: b.ref.id, fromChapter: m.startChapter, toChapter: m.endChapter }],
      bookCount: 1,
    }
  })
}

/* ============================== 汇总 ============================== */

export function buildTemplates(bundles: RefAnalysisBundle[]): RefTemplate[] {
  const all = bundles.flatMap((b) => [...structureTemplates(b), ...plotTemplates(b), ...settingTemplates(b)])
  return markCrossBook(all)
}

/**
 * 标记「几本书同时采用」。
 *
 * 判定用**标题归一后的完全一致** —— 不做模糊匹配。
 * 两个不同的「身份反转」链步骤可能完全不同，凑到一起会造出一个谁也不适用的模板。
 */
export function markCrossBook(templates: RefTemplate[]): RefTemplate[] {
  const bySig = new Map<string, RefTemplate[]>()
  for (const t of templates) {
    const sig = `${t.kind}::${t.steps.map((s) => s.label.trim()).join('>')}`
    bySig.set(sig, [...(bySig.get(sig) ?? []), t])
  }
  for (const group of bySig.values()) {
    if (group.length < 2) continue
    const refIds = [...new Set(group.flatMap((t) => t.sources.map((s) => s.refId)))]
    for (const t of group) {
      t.bookCount = refIds.length
      t.genres = [...new Set(t.genres.filter(Boolean))]
    }
  }
  return templates
}

/* ============================== 竞品对比 ============================== */

/** 对比表的一列 */
export interface CompareCol {
  refId: string
  title: string
  genre: string
  values: Record<string, number>
}

/** 对比维度定义；全部本地可算，0 token */
export interface CompareDim {
  key: string
  label: string
  unit?: string
  get: (b: RefAnalysisBundle) => number
  /** 该维度是否只是叙述层的弱信号 */
  weak?: boolean
}

export const COMPARE_DIMS: CompareDim[] = [
  { key: 'chapters', label: '章节数', unit: '章', get: (b) => b.structure?.chapterCount ?? 0 },
  { key: 'words', label: '总字数', unit: '字', get: (b) => b.structure?.wordCount ?? 0 },
  { key: 'volumes', label: '卷数', unit: '卷', get: (b) => b.structure?.volumeCount ?? 0 },
  { key: 'avgWords', label: '平均章长', unit: '字', get: (b) => b.structure?.avgChapterWords ?? 0 },
  { key: 'stdDev', label: '章长波动', get: (b) => b.structure?.chapterWordsStdDev ?? 0, weak: true },
  { key: 'endsOpen', label: '留白率', get: (b) => avg(b.structure?.rhythm.map((r) => r.endsOpenRatio) ?? []), weak: true },
  { key: 'tension', label: '张力标点密度', unit: '/千字', get: (b) => avg(b.structure?.rhythm.map((r) => r.tensionSignalsPerK) ?? []), weak: true },
  { key: 'beats', label: '情节拍数', get: (b) => b.plot?.beats.length ?? 0 },
  { key: 'arcs', label: '叙事线数', get: (b) => b.plot?.arcs.length ?? 0 },
  { key: 'longestArc', label: '最长情节链', unit: '章', get: (b) => longestArc(b.plot) },
  { key: 'avgBeat', label: '平均拍跨度', unit: '章', get: (b) => avgBeatSpan(b.plot) },
  { key: 'characters', label: '角色数', get: (b) => b.elements?.characters.length ?? 0 },
  { key: 'settings', label: '设定数', get: (b) => b.elements?.settings.length ?? 0 },
  { key: 'foreshadows', label: '伏笔数', get: (b) => b.elements?.foreshadows.length ?? 0 },
  { key: 'paidForeshadows', label: '已回收伏笔', get: (b) => (b.elements?.foreshadows ?? []).filter((f) => f.payoffChapter).length },
  { key: 'avgFsSpan', label: '伏笔平均跨度', unit: '章', get: (b) => avg((b.elements?.foreshadows ?? []).filter((f) => f.span > 0).map((f) => f.span)) },
]

function avg(xs: number[]): number {
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0
}

function longestArc(plot: RefPlot | null): number {
  if (!plot?.beats?.length) return 0
  const byId = new Map(plot.beats.map((b) => [b.id, b]))
  return Math.max(
    ...(plot.arcs ?? []).map((a) => {
      const bs = a.beatIds.map((id) => byId.get(id)).filter(Boolean) as typeof plot.beats
      if (!bs.length) return 0
      return Math.max(...bs.map((b) => b.toChapter)) - Math.min(...bs.map((b) => b.fromChapter)) + 1
    }),
    0,
  )
}

function avgBeatSpan(plot: RefPlot | null): number {
  const spans = (plot?.beats ?? []).map((b) => b.toChapter - b.fromChapter + 1).filter((x) => x > 0)
  return avg(spans)
}

export function buildComparison(bundles: RefAnalysisBundle[]): CompareCol[] {
  return bundles.map((b) => ({
    refId: b.ref.id,
    title: b.ref.title,
    genre: b.ref.genre,
    values: Object.fromEntries(COMPARE_DIMS.map((d) => [d.key, d.get(b)])),
  }))
}

/**
 * 某一维度上的极值（最高 / 最低）。
 *
 * 刻意不叫「最优」：章节多、字数大、伏笔跨度长本身没有好坏之分，
 * 把某一端标成「最优」是在替用户做价值判断。这里只标出差异的两端，
 * 让读者自己看出取舍。
 */
export function extremesOf(cols: CompareCol[], dim: CompareDim): { max: string[]; min: string[] } {
  if (cols.length < 2) return { max: [], min: [] }
  const vals = cols.map((c) => c.values[dim.key] ?? 0)
  const max = Math.max(...vals)
  const min = Math.min(...vals)
  // 全部相同（或都是 0）时标极值没有信息量
  if (!Number.isFinite(max) || max === min) return { max: [], min: [] }
  return {
    max: cols.filter((c) => (c.values[dim.key] ?? 0) === max).map((c) => c.refId),
    min: cols.filter((c) => (c.values[dim.key] ?? 0) === min).map((c) => c.refId),
  }
}

/** 汇总成一句可读的差异，供「差异解读」那一步用 */
export function diffSummary(cols: CompareCol[]): string {
  return COMPARE_DIMS.filter((d) => !d.weak)
    .map((d) => {
      const parts = cols.map((c) => `${c.title} ${c.values[d.key]}${d.unit ?? ''}`)
      return `${d.label}：${parts.join(' / ')}`
    })
    .join('\n')
}

export { BEAT_COLOR, BEAT_KINDS }
