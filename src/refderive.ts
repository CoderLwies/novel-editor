/**
 * 参考数据的本地推导。
 *
 * 两条原则：**能本地算的绝不调 AI**。
 * 卷功能配比只要把 beats 按章区间聚合就出来了；设定缺口只要按关键词匹配就能判定。
 * 这些都是确定性的计算，调模型既花钱又可能出错。
 */
import type { ID } from './types'
import type { RefStructure, RefElements, RefPlot, BeatKind, SettingCategory } from './refschema'
import { BEAT_KINDS, BEAT_KIND_LABEL } from './refschema'

/** 一个卷内各情节类型的章数占比 */
export interface VolumeMix {
  index: number
  title: string
  startChapter: number
  endChapter: number
  chapterCount: number
  /** 该卷内落在每一类 beat 覆盖范围内的章数 */
  counts: Record<BeatKind, number>
  /** 占比，和为 1 */
  ratios: Record<BeatKind, number>
}

/**
 * 从 plot.json 的 beats 推导每卷的情节配比。
 * 一章可能被多拍覆盖（翻转会嵌套），这里按「至少被一拍覆盖」计一次，避免重复计数。
 */
export function volumeMixFrom(structure: RefStructure, plot: RefPlot): VolumeMix[] {
  const beats = plot?.beats ?? []
  return (structure.volumes ?? []).map((v) => {
    const counts = Object.fromEntries(BEAT_KINDS.map((k) => [k, 0])) as Record<BeatKind, number>
    const span = Math.max(1, v.endChapter - v.startChapter + 1)
    for (const k of BEAT_KINDS) {
      // 该卷内被 kind=k 的拍覆盖到的章数
      const covered = new Set<number>()
      for (const b of beats) {
        if (b.kind !== k) continue
        const lo = Math.max(b.fromChapter, v.startChapter)
        const hi = Math.min(b.toChapter, v.endChapter)
        for (let c = lo; c <= hi; c++) covered.add(c)
      }
      counts[k] = covered.size
    }
    const ratios = Object.fromEntries(
      BEAT_KINDS.map((k) => [k, Math.round((counts[k] / span) * 100) / 100]),
    ) as Record<BeatKind, number>
    return {
      index: v.index,
      title: v.title,
      startChapter: v.startChapter,
      endChapter: v.endChapter,
      chapterCount: v.chapterCount,
      counts,
      ratios,
    }
  })
}

/** 配色：与 schema 的六类枚举一一对应 */
export const BEAT_COLOR: Record<BeatKind, string> = {
  setup: '#64748b',
  build: '#0d9488',
  conflict: '#d97706',
  twist: '#e11d48',
  payoff: '#6d5efc',
  resolve: '#059669',
}

export function mixBar(m: VolumeMix): { label: string; pct: number; kind: BeatKind }[] {
  return BEAT_KINDS.map((k) => ({ kind: k, label: BEAT_KIND_LABEL[k], pct: m.ratios[k] })).filter(
    (x) => x.pct > 0,
  )
}

/* ============================== 设定要素清单 ============================== */

/** 要素清单项。keywords 用于本地判定用户是否已写到，不是给模型看的 */
export interface ChecklistItem {
  key: string
  label: string
  why: string
  keywords: string[]
}

/** 单条设定的要素覆盖情况 */
export interface ItemCoverage {
  item: ChecklistItem
  hit: boolean
  /** 命中的关键词，便于告诉用户「因为你写了『祖制』所以这条算有」 */
  matchedKeyword?: string
}

/**
 * 本地判定：设定的描述/状态里是否覆盖了某个要素。
 * 用关键词而非 AI 判定 —— 结果可解释，也不会因为模型抽风就误报缺失。
 */
export function coverChecklist(
  setting: { desc?: string; status?: string },
  items: ChecklistItem[],
): ItemCoverage[] {
  const hay = `${setting.desc ?? ''} ${setting.status ?? ''}`
  return items.map((item) => {
    const kw = item.keywords.find((k) => k && hay.includes(k))
    return { item, hit: !!kw, matchedKeyword: kw }
  })
}

/** 按 category + subtype 把多本参考书的设定分组 */
export function groupBySubtype(
  elementsByRef: { refId: ID; refTitle: string; elements: RefElements }[],
  category: SettingCategory,
): { subtype: string; items: { name: string; desc: string; status: string; refTitle: string }[] }[] {
  const map = new Map<string, { name: string; desc: string; status: string; refTitle: string }[]>()
  for (const { refTitle, elements } of elementsByRef) {
    for (const s of elements.settings ?? []) {
      if (s.category !== category) continue
      const key = s.subtype?.trim() || '未分类'
      const list = map.get(key) ?? []
      list.push({ name: s.name, desc: s.desc, status: s.status, refTitle })
      map.set(key, list)
    }
  }
  return [...map.entries()]
    .map(([subtype, items]) => ({ subtype, items }))
    .filter((g) => g.items.length > 0)
}

/** 已知子类型的显示名；不在表里的直接用原值，不硬编码一张永远不全的表 */
export const SUBTYPE_LABEL: Record<string, string> = {
  sect: '宗门',
  dynasty: '王朝',
  gang: '帮派',
  academy: '学院',
  inner: '内门',
  outer: '外门',
  guild: '公会',
  clan: '家族',
  court: '朝廷势力',
}

export const subtypeLabel = (s: string) => SUBTYPE_LABEL[s] ?? s

/* ============================== 设定类型清单 ============================== */

export const SETTING_CATEGORY_LABEL: Record<SettingCategory, string> = {
  location: '地点',
  item: '物品',
  faction: '势力',
  rule: '规则',
  power: '功法',
}

/* 说明：卷配比与缺口判定都在这里，纯本地计算。
   原因见文件头 —— 能本地算的绝不调 AI。 */
