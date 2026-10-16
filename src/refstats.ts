/**
 * 阶段一：结构与节奏统计 —— **纯本地计算，0 token，结果可复现**。
 *
 * 这里只算「能从文字本身确定的量」：章长分布、卷规模、窗口节奏。
 * 爽点、冲突、伏笔跨度这类需要语义判断的，一律不在这里出，
 * 留给阶段二/三的 AI 判定 —— 否则就是拿统计冒充理解。
 *
 * 弱信号（tensionSignalsPerK / endsOpenRatio）只反映**叙述层面**的张力，
 * 不是情节强度。界面必须标注清楚，别让人误读成节奏分析。
 */
import type { ID } from './types'
import { countWords } from './utils'
import type { RefChapter } from './reference'
import {
  RHYTHM_WINDOW,
  SCHEMA_VERSION,
  type Quantiles,
  type RefStructure,
  type RefVolumeStat,
  type RhythmWindow,
} from './refschema'

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** 总体标准差。描述「这批章长的离散程度」用总体口径比样本口径更贴近直觉；
 *  章数 < 2 时返回 0，避免除零产出 NaN */
export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  if (lo === hi) return sorted[lo]
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo))
}

function quantilesOf(values: number[]): Quantiles {
  const s = [...values].sort((a, b) => a - b)
  return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) }
}

/**
 * 张力信号密度：每千字出现的问号 / 省略号 / 感叹号 / 破折号数量。
 * 明确是弱信号——它测的是标点密度，不是情节强度。
 */
export function tensionSignalsPerK(text: string): number {
  if (!text) return 0
  const hits = (text.match(/[？！…—]/g) ?? []).length
  const chars = Math.max(1, countWords(text))
  return Math.round((hits / chars) * 1000 * 10) / 10
}

/** 章末留白：以非句号类标点结尾，视为「这一章没说完」的弱信号 */
export function endsOpen(text: string): boolean {
  const t = text.trimEnd()
  if (!t) return false
  return !/[。．.!！？」』”）]$/.test(t)
}

export interface StructureInput {
  refId: ID
  /** 拆好的章节，按章序升序 */
  chapters: RefChapter[]
  /** 分卷标题，与 chapters 的 volumeIndex 对应 */
  volumeTitles: string[]
}

/**
 * 计算结构与节奏统计。纯函数、无 IO，便于单测与重算。
 */
export function computeStructure(input: StructureInput, now = Date.now()): RefStructure {
  const { refId, chapters, volumeTitles } = input
  const words = chapters.map((c) => countWords(c.content))

  // ---- 卷规模 ----
  const volCount = volumeTitles.length || 1
  const volumes: RefVolumeStat[] = []
  for (let v = 0; v < volCount; v++) {
    const owned = chapters.filter((c) => c.volumeIndex === v)
    const idx = chapters.reduce<number[]>((acc, c, i) => (c.volumeIndex === v ? [...acc, i + 1] : acc), [])
    const w = owned.map((c) => countWords(c.content))
    volumes.push({
      index: v,
      title: volumeTitles[v] ?? `第${v + 1}卷`,
      chapterCount: owned.length,
      wordCount: w.reduce((a, b) => a + b, 0),
      avgChapterWords: Math.round(mean(w)),
      startChapter: idx[0] ?? 0,
      endChapter: idx[idx.length - 1] ?? 0,
    })
  }

  // ---- 节奏窗口：固定 RHYTHM_WINDOW 章一格，保证不同书同粒度可比 ----
  const rhythm: RhythmWindow[] = []
  for (let from = 1; from <= chapters.length; from += RHYTHM_WINDOW) {
    const to = Math.min(from + RHYTHM_WINDOW - 1, chapters.length)
    const slice = chapters.slice(from - 1, to)
    const w = slice.map((c) => countWords(c.content))
    const sig = slice.reduce((s, c) => s + tensionSignalsPerK(c.content), 0)
    const openN = slice.filter((c) => endsOpen(c.content)).length
    rhythm.push({
      from,
      to,
      avgWords: Math.round(mean(w)),
      wordsStdDev: Math.round(stdDev(w)),
      tensionSignalsPerK: Math.round((sig / slice.length) * 10) / 10,
      endsOpenRatio: Math.round((openN / slice.length) * 100) / 100,
    })
  }

  // ---- 最短/最长章 ----
  let shortestChapter = 0
  let longestChapter = 0
  words.forEach((w, i) => {
    if (!shortestChapter || w < words[shortestChapter - 1]) shortestChapter = i + 1
    if (!longestChapter || w > words[longestChapter - 1]) longestChapter = i + 1
  })

  return {
    refId,
    schemaVersion: SCHEMA_VERSION,
    computedAt: now,
    chapterCount: chapters.length,
    volumeCount: volCount,
    wordCount: words.reduce((a, b) => a + b, 0),
    avgChapterWords: Math.round(mean(words)),
    chapterWordsStdDev: Math.round(stdDev(words)),
    chapterWordsQuantiles: quantilesOf(words),
    volumes,
    rhythm,
    shortestChapter,
    longestChapter,
  }
}
