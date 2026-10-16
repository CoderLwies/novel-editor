/**
 * 参考库分析产物的 schema —— **P1 起冻结**。
 *
 * 为什么单独一个文件而不是塞进 types.ts：
 * 1. 多书对比要求各书同一维度字段严格可比，所以这里的枚举、窗口大小、单位
 *    必须集中定义、不能各处随手加；
 * 2. 显式区分 `local`（本地统计，确定性事实）与 `ai`（模型归纳，可能出错），
 *    报告与对比里不能把两者混为一谈；
 * 3. 字段一旦发布就不能改——历史分析产物要能回读，多本对比要靠旧数据。
 *
 * 落盘位置：<参考目录>/analysis/{structure,elements,plot,templates,checklists}.json
 */
import type { ID } from './types'

/** 数据来源。报告里必须能区分「算出来的」和「模型说的」 */
export type Provenance = 'local' | 'ai'

/* ============================== structure.json ============================== */

/** 节奏窗口的章数。固定值 —— 不同书用同一粒度才可比 */
export const RHYTHM_WINDOW = 20

/**
 * 节奏窗口。窗口内统计的都是本地计算的确定性量：
 * 章长、章数、以及基于标点/短段落的弱信号密度。
 */
export interface RhythmWindow {
  /** 窗口覆盖的章序区间，1 起闭区间 */
  from: number
  to: number
  avgWords: number
  /** 章长标准差（窗口内），衡量节奏稳不稳 */
  wordsStdDev: number
  /**
   * 窗口内「张力信号密度」：单位正文字符中出现的问句/省略号/独白感叹等标点数。
   * 这是**弱信号**，只反映叙述层面的张力，不代表情节强度 —— 界面必须这样标注。
   */
  tensionSignalsPerK: number
  /** 窗口末章是否留白（以非句号结尾）——同样是弱信号 */
  endsOpenRatio: number
}

/** 每卷的规模统计（本地计算） */
export interface RefVolumeStat {
  /** 0 起，与 Reference.volumes 下标对应 */
  index: number
  title: string
  chapterCount: number
  wordCount: number
  avgChapterWords: number
  /** 在全书的章序区间，1 起 */
  startChapter: number
  endChapter: number
}

/** 规模分布的分位数，固定这几个便于跨书比较 */
export interface Quantiles {
  p10: number
  p50: number
  p90: number
}

/**
 * 结构与节奏（阶段一，纯本地计算，0 token）。
 * 这个文件不依赖 AI，任何时候都能重算，结果稳定可复现。
 */
export interface RefStructure {
  refId: ID
  /** 分析产物的 schema 版本，用于将来迁移 */
  schemaVersion: number
  computedAt: number

  chapterCount: number
  volumeCount: number
  wordCount: number
  avgChapterWords: number
  /** 章长标准差：越大说明节奏起伏越大 */
  chapterWordsStdDev: number
  chapterWordsQuantiles: Quantiles

  volumes: RefVolumeStat[]
  rhythm: RhythmWindow[]

  /** 最短/最长的章序，便于直接跳读 */
  shortestChapter: number
  longestChapter: number
}

/* ================================ plot.json ================================ */

/**
 * 情节类型。六类互斥且穷尽 —— 固定枚举是多书对比的前提，
 * 不能再加第七类而不改所有历史数据。
 */
export const BEAT_KINDS = ['setup', 'build', 'conflict', 'twist', 'payoff', 'resolve'] as const
export type BeatKind = (typeof BEAT_KINDS)[number]

export const BEAT_KIND_LABEL: Record<BeatKind, string> = {
  setup: '开局',
  build: '铺垫',
  conflict: '冲突',
  twist: '反转',
  payoff: '爽点',
  resolve: '收束',
}

/**
 * 溯源。模板、要素、情节拍都必须能指回原文位置，
 * 这是「借鉴」不变成「抄袭」的产品前提。
 */
export interface ProvenanceRef {
  refId: ID
  /** 章序区间，1 起；单章时 from === to */
  fromChapter: number
  toChapter: number
}

/**
 * 情节拍：一段有结构功能的连续章节。
 *
 * signal 与 cost 是这两个字段撑起了「自动定位当前写到哪一拍」：
 * 用户的书没有情节标注，不能按章号推，只能拿他当前章的正文去和 signal 比对。
 * cost 则是硬要求（如「不能全身而退」），让模板有约束力而不只是描述。
 */
export interface PlotBeat {
  id: ID
  refId: ID
  fromChapter: number
  toChapter: number
  kind: BeatKind
  title: string
  /** 这一拍在结构上干了什么 */
  summary: string
  /** 可识别特征：用于匹配用户当前进度 */
  signal: string
  /** 这一拍必须付出的代价 / 必须成立的前提 */
  cost: string
  /** 参与的主要角色名 */
  characters: string[]
  /** 模型判定所依据的原文摘录（可空） */
  evidence?: string
}

/**
 * 情节链：有序的情节拍序列，构成一条完整叙事线。
 * skeleton 是从这条链抽象出的可复用骨架 —— 借鉴模板的原料。
 */
export interface PlotArc {
  id: ID
  refId: ID
  title: string
  /** 有序的 PlotBeat id */
  beatIds: ID[]
  /** 覆盖的章序区间 */
  fromChapter: number
  toChapter: number
  skeleton?: PlotSkeleton
}

/** 可迁移的骨架步骤 */
export interface SkeletonStep {
  key: string
  label: string
  /** 这一步必须成立的条件 */
  require: string
}

/** 可复用骨架 —— 不含任何原文，只有方法 */
export interface PlotSkeleton {
  steps: SkeletonStep[]
  /** 建议跨度（章） */
  suggestedSpan: number
}

export interface RefPlot {
  schemaVersion: number
  refId: ID
  computedAt: number
  beats: PlotBeat[]
  arcs: PlotArc[]
}

/* ============================== elements.json ============================== */

/** 要素抽取结果。字段对齐现有 Character/SettingItem，便于直接转成可用的卡 */
export interface RefCharacter {
  id: ID
  name: string
  /** 别名/曾用名，跨批次合并的锚点 */
  aliases: string[]
  /** 定位：主角/反派/配角… */
  role: string
  appearance: string
  personality: string
  background: string
  motivation: string
  ability: string
  speech: string
  /** 首次出场章 / 末次出场章 */
  firstChapter: number
  lastChapter: number
  provenance: ProvenanceRef
}

export type SettingCategory = 'location' | 'item' | 'faction' | 'rule' | 'power'

export interface RefSetting {
  id: ID
  category: SettingCategory
  name: string
  desc: string
  status: string
  /**
   * 子类型（势力：sect/dynasty/gang/academy；宗门：inner/outer…）。
   * 用于匹配 SettingChecklist —— 不同势力类型的要素清单不同。
   */
  subtype: string
  /** 出现章序（去重升序） */
  chapters: number[]
  provenance: ProvenanceRef
}

export interface RefForeshadow {
  id: ID
  title: string
  detail: string
  /** 埋设章 / 回收章；未回收时 payoffChapter 为 null */
  plantChapter: number
  payoffChapter: number | null
  /** 跨了多少章 —— 节奏分析里最硬的一个指标 */
  span: number
  provenance: ProvenanceRef
}

export interface RefElements {
  schemaVersion: number
  refId: ID
  computedAt: number
  characters: RefCharacter[]
  settings: RefSetting[]
  foreshadows: RefForeshadow[]
}

/* ============================ templates.json ============================ */

export const TEMPLATE_KINDS = ['structure', 'plot', 'setting'] as const
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  structure: '结构',
  plot: '情节',
  setting: '设定',
}

/**
 * 借鉴模板：只包含方法与要素清单，不含原文。
 * 套用时生成的是骨架，不是抄袭素材。
 */
export interface RefTemplate {
  id: ID
  refId: ID
  kind: TemplateKind
  title: string
  summary: string
  steps: SkeletonStep[]
  /** 适用题材，跨书匹配用 */
  genres: string[]
  provenance: ProvenanceRef
}

export interface RefTemplates {
  schemaVersion: number
  computedAt: number
  templates: RefTemplate[]
}

/* =========================== checklists.json =========================== */

/**
 * 要素清单：**拆解产物**，不是代码常量。
 * 做法：先给参考书里每个势力打 subtype，聚合同 subtype 的共性要素得到清单。
 * `why` 是关键 —— 有「为什么需要这一项」才是诊断，否则只是填空题。
 */
export interface SettingChecklist {
  id: ID
  refId: ID
  /** 子类型键，与 RefSetting.subtype 对应 */
  subtype: string
  title: string
  items: { key: string; label: string; why: string }[]
  /** 聚合自哪几处（同一 subtype 的多个势力） */
  provenance: ProvenanceRef[]
}

export interface RefChecklists {
  schemaVersion: number
  computedAt: number
  checklists: SettingChecklist[]
}

/* ============================== 进度判定 ============================== */

/**
 * 「用户当前写到哪一拍」的判定结果 —— 支撑写作时的参考弹窗。
 * 由用户当前章正文与候选拍 signal 比对得出，不是按章号推算。
 */
export interface BeatLocator {
  arcId: ID
  beatId: ID
  /** 0–1；低于阈值时应提示「把握不准」，而不是硬给一个答案 */
  confidence: number
  /** 为什么判定在这一拍 */
  reason: string
  /** 已完成的前序拍 */
  passedBeatIds: ID[]
}

export const SCHEMA_VERSION = 1

/* ============================ 跨书对比维度 ============================ */

/** 对比表的一列 */
export interface CompareRow {
  key: string
  label: string
  get: (s: RefStructure) => number
  /** 单位，显示在对比表里 */
  unit?: string
  /**
   * 该维度是否只是**叙述层面的弱信号**（对比表需标注，避免被读成情节分析）。
   */
  weak?: boolean
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/**
 * 跨书对比维度。**随 schema 一起冻结**：
 * 后续新增维度只对之后的分析生效；历史数据缺字段时对比表应跳过该行，
 * 而不是拿默认值参与比较——那会让不同版本的数字被误读为可比。
 */
export const COMPARE_DIMENSIONS: CompareRow[] = [
  { key: 'chapterCount', label: '章节数', get: (s) => s.chapterCount, unit: '章' },
  { key: 'wordCount', label: '总字数', get: (s) => s.wordCount, unit: '字' },
  { key: 'volumeCount', label: '卷数', get: (s) => s.volumeCount, unit: '卷' },
  { key: 'avgChapterWords', label: '平均章长', get: (s) => s.avgChapterWords, unit: '字' },
  { key: 'chapterWordsStdDev', label: '章长波动', get: (s) => s.chapterWordsStdDev },
  { key: 'p10', label: '章长 P10', get: (s) => s.chapterWordsQuantiles.p10, unit: '字' },
  { key: 'p50', label: '章长中位数', get: (s) => s.chapterWordsQuantiles.p50, unit: '字' },
  { key: 'p90', label: '章长 P90', get: (s) => s.chapterWordsQuantiles.p90, unit: '字' },
  {
    key: 'endsOpen',
    label: '留白率',
    get: (s) => avg(s.rhythm.map((r) => r.endsOpenRatio)),
    weak: true,
  },
  {
    key: 'tension',
    label: '张力标点密度',
    get: (s) => avg(s.rhythm.map((r) => r.tensionSignalsPerK)),
    unit: '/千字',
    weak: true,
  },
]
