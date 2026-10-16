/**
 * 情节拍的跨批合并。
 *
 * 一段情节经常跨批次边界（上一批打了一半的冲突，这一批还没打完）。
 * 模型用 `continuesFromPrev` 声明延续，合并器据此把两批接成一拍 ——
 * 否则全书会出现大量被批次边界「劈成两半」的假拍。
 */
import { uid } from './utils'
import type { BeatKind, PlotBeat, PlotArc, PlotSkeleton } from './refschema'
import type { BatchPlot, ArcResult, BeatBrief } from './refprompt'

const KINDS = new Set(['setup', 'build', 'conflict', 'twist', 'payoff', 'resolve'])

interface RawBeat {
  fromChapter: number
  toChapter: number
  kind: BeatKind
  title: string
  summary: string
  signal: string
  cost: string
  characters: string[]
  continuesFromPrev: boolean
}

function toRaw(b: NonNullable<BatchPlot['beats']>[number], fallbackFrom: number, fallbackTo: number): RawBeat | null {
  const kind = (b.kind ?? '') as BeatKind
  const title = (b.title ?? '').trim()
  if (!KINDS.has(kind) || !title) return null
  const from = Number(b.fromChapter) || fallbackFrom
  const to = Number(b.toChapter) || fallbackTo
  return {
    fromChapter: Math.min(from, to),
    toChapter: Math.max(from, to),
    kind,
    title,
    summary: (b.summary ?? '').trim(),
    signal: (b.signal ?? '').trim(),
    cost: (b.cost ?? '').trim() || '无硬性要求',
    characters: (b.characters ?? []).map((c) => String(c).trim()).filter(Boolean),
    continuesFromPrev: !!b.continuesFromPrev,
  }
}

export class BeatCollector {
  private beats: RawBeat[] = []

  /** 吸收一批。batchFrom/batchTo 用于模型漏填章序时兜底 */
  add(batch: BatchPlot, batchFrom: number, batchTo: number): void {
    for (const b of batch.beats ?? []) {
      const raw = toRaw(b, batchFrom, batchTo)
      if (!raw) continue

      const prev = this.beats[this.beats.length - 1]
      if (raw.continuesFromPrev && prev) {
        // 延续：并入上一拍，章序区间取并集；描述取更完整者
        prev.toChapter = Math.max(prev.toChapter, raw.toChapter)
        prev.fromChapter = Math.min(prev.fromChapter, raw.fromChapter)
        if (raw.signal && raw.signal.length > prev.signal.length) prev.signal = raw.signal
        if (raw.summary.length > prev.summary.length) prev.summary = raw.summary
        if (raw.cost && raw.cost !== '无硬性要求') prev.cost = raw.cost
        for (const c of raw.characters) if (!prev.characters.includes(c)) prev.characters.push(c)
        continue
      }
      this.beats.push(raw)
    }
  }

  get length(): number {
    return this.beats.length
  }

  /** 供下一批判定延续用的摘要 */
  lastBrief(): BeatBrief | null {
    const b = this.beats[this.beats.length - 1]
    if (!b) return null
    return {
      index: this.beats.length - 1,
      kind: b.kind,
      title: b.title,
      fromChapter: b.fromChapter,
      toChapter: b.toChapter,
      signal: b.signal,
      cost: b.cost,
      characters: b.characters,
    }
  }

  briefs(): BeatBrief[] {
    return this.beats.map((b, i) => ({
      index: i,
      kind: b.kind,
      title: b.title,
      fromChapter: b.fromChapter,
      toChapter: b.toChapter,
      signal: b.signal,
      cost: b.cost,
      characters: b.characters,
    }))
  }

  /** 落成 schema 形态 */
  finish(refId: string): PlotBeat[] {
    return this.beats.map((b) => ({
      id: uid('pb'),
      refId,
      fromChapter: b.fromChapter,
      toChapter: b.toChapter,
      kind: b.kind,
      title: b.title,
      summary: b.summary,
      signal: b.signal,
      cost: b.cost,
      characters: b.characters,
    }))
  }
}

/**
 * 按模型给出的组织方案组装叙事线与骨架。
 * beatIndexes 越界或为空的部分直接丢掉 —— 宁可少一条线，也不要错一条。
 */
export function assembleArcs(
  refId: string,
  beats: PlotBeat[],
  result: ArcResult,
  byIndex: BeatBrief[],
): PlotArc[] {
  const out: PlotArc[] = []
  for (const a of result.arcs ?? []) {
    const idxs = (a.beatIndexes ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < beats.length)
    if (!idxs.length) continue
    const skeleton = a.skeleton
    const steps = (skeleton?.steps ?? [])
      .map((s) => ({
        key: (s.key ?? '').trim(),
        label: (s.label ?? '').trim(),
        require: (s.require ?? '').trim(),
      }))
      .filter((s) => s.label)
    const span = steps.length
      ? (skeleton?.suggestedSpan ?? idxs.length)
      : undefined
    out.push({
      id: uid('pa'),
      refId,
      title: (a.title ?? '').trim() || `情节线 ${out.length + 1}`,
      beatIds: idxs.map((i) => beats[i].id),
      fromChapter: byIndex[idxs[0]]?.fromChapter ?? 0,
      toChapter: byIndex[idxs[idxs.length - 1]]?.toChapter ?? 0,
      skeleton: steps.length
        ? ({ steps, suggestedSpan: span as number } as PlotSkeleton)
        : undefined,
    })
  }
  return out
}
