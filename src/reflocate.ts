/**
 * 按已写内容定位当前情节链。
 *
 * 这是整个功能最核心的一环，但有一条容易被忽略的约束：
 * **读者自己的书没有情节标注**。所以「你现在写到第几拍」不能按章号算，
 * 只能拿当前章的正文去和参考书拆出来的 `signal`（可识别特征）比对。
 *
 * 两条设计底线：
 * 1. **置信度必须诚实** —— 匹配不上就说匹配不上，不能硬凑一个答案。
 *    低置信度时返回"把握不准"，好过给一个看着确定但其实错的结论。
 * 2. **一拍的跨度往往跨多章** —— 同一拍内用户会连写好几章，
 *    所以要告诉模型「上次定位到哪」，让它判断这次是不是同一拍。
 */
import type { ID } from './types'
import type { BeatKind } from './refschema'

/** 送给模型的候选拍（已按叙事线组织） */
export interface CandidateBeat {
  beatId: ID
  arcId: ID
  arcTitle: string
  /** 在该叙事线内的序号，0 起 */
  index: number
  kind: BeatKind
  title: string
  signal: string
  cost: string
  /** 来自哪本书，便于模型判断题材是否对得上 */
  refTitle: string
}

export const SYS_LOCATOR =
  '你是网文结构对照分析师。给定一段正文与若干候选情节拍，判断该正文最接近哪一拍。' +
  '只输出符合 schema 的 JSON，不要解释或代码块。严格依据正文判断，不得虚构。'

export interface LocateResult {
  /** 命中的候选下标；-1 表示没有任何一拍匹配 */
  pickedIndex: number
  /** 0–1 的置信度。低于阈值时界面应提示「把握不准」而不是硬给结论 */
  confidence: number
  reason: string
  /** 模型认为在命中拍之前已经完成的候选下标 */
  passedIndexes: number[]
  /** 相对上次定位，是否仍在同一拍（同一拍往往跨多章） */
  sameAsPrevious: boolean
  /** pickedIndex 为 -1 时的说明 */
  noneReason?: string
}

/** 置信度低于此值，界面应显示「把握不准」并展示候选而不是给结论 */
export const CONFIDENCE_FLOOR = 0.5

export function locatePrompt(
  chapterTitle: string,
  content: string,
  candidates: CandidateBeat[],
  previous: { pickedIndex: number; title: string } | null,
  maxChars: number,
): string {
  const body =
    content.length <= maxChars
      ? content
      : `${content.slice(0, Math.floor(maxChars * 0.6))}\n\n（中间已省略）\n\n${content.slice(-Math.floor(maxChars * 0.4))}`

  const lines = candidates.map(
    (c, i) =>
      `#${i} [${c.kind}] 第${i === 0 ? '' : ''}${c.title}（${c.refTitle}·${c.arcTitle}）\n` +
      `  可识别特征：${c.signal}\n  硬性要求：${c.cost}`,
  )

  return [
    `读者当前正在写的章节：${chapterTitle}`,
    previous
      ? `上一次定位判定为：#${previous.pickedIndex}「${previous.title}」。同一拍往往跨多章，` +
        '如果这次仍在同一段情节里请置 sameAsPrevious=true。'
      : '这是第一次定位，没有此前进度。',
    '',
    '当前章正文：',
    '"""',
    body,
    '"""',
    '',
    '候选情节拍：',
    '"""',
    lines.join('\n'),
    '"""',
    '',
    '判断当前章最接近哪一拍：',
    '1. 依据正文中**实际出现的可观察特征**，不要凭题材或人物名硬套，不得虚构正文里没有的情节。',
    '2. 正文的写法与所有候选都对不上时，pickedIndex 给 -1 并在 noneReason 里说明，',
    '   confidence 给低分 —— 这比勉强挑一个更有用。',
    '3. passedIndexes 给命中拍之前已经完成的候选下标（升序）。',
    '4. reason 一句话说清凭什么匹配上，要引用正文里的具体表现。',
    '',
    'schema: {"pickedIndex":0,"confidence":0.0,"reason":"","passedIndexes":[],' +
    '"sameAsPrevious":false,"noneReason":""}',
  ].join('\n')
}

/**
 * 把模型结果落到候选上，并做若干自检。
 * 模型给的 index 可能越界或格式不对，这里兜住。
 */
export function normalizeLocate(
  raw: Partial<LocateResult>,
  candidates: CandidateBeat[],
): LocateResult {
  const n = candidates.length
  let picked = Number(raw.pickedIndex)
  if (!Number.isInteger(picked) || picked < -1 || picked >= n) picked = -1
  let conf = Number(raw.confidence)
  if (!Number.isFinite(conf)) conf = 0
  conf = Math.max(0, Math.min(1, conf))
  const passed = Array.isArray(raw.passedIndexes)
    ? raw.passedIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < n && i < picked)
    : []
  return {
    pickedIndex: picked,
    confidence: picked === -1 ? 0 : conf,
    reason: (raw.reason ?? '').trim(),
    passedIndexes: passed,
    sameAsPrevious: !!raw.sameAsPrevious,
    noneReason: picked === -1 ? (raw.noneReason ?? raw.reason ?? '').trim() : undefined,
  }
}

/**
 * 单调性自检：命中拍不应该比「上次定位」更靠前。
 * 出现倒退通常意味着上次的判定错了，或候选集变了 —— 要提示而不是默默接受。
 */
export function checkRegression(
  prev: { pickedIndex: number } | null,
  next: LocateResult,
): { regressed: boolean; note?: string } {
  if (!prev || prev.pickedIndex < 0) return { regressed: false }
  if (next.pickedIndex >= 0 && next.pickedIndex < prev.pickedIndex) {
    return {
      regressed: true,
      note: `这次定位到了比上次更早的一拍（#${prev.pickedIndex} → #${next.pickedIndex}）。可能是上次判错了，也可能你换了参考书。`,
    }
  }
  return { regressed: false }
}

/** 本地粗排：正文与 signal 的二元组重合度。只用于排序，绝不做硬过滤 ——
 *  同义但用词不同的正文会被误杀，硬过滤会漏掉真正匹配的那一拍。 */
export function bigramOverlap(content: string, signal: string): number {
  const grams = (s: string) => {
    const clean = s.replace(/[\s\p{P}\p{S}]/gu, '')
    const out = new Set<string>()
    for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2))
    return out
  }
  const a = grams(content)
  if (!a.size) return 0
  const b = grams(signal)
  let hit = 0
  for (const g of b) if (a.has(g)) hit++
  return b.size ? hit / b.size : 0
}

/**
 * 候选过多时按重合度排序取前 N（送进 prompt）。
 * 保留一部分原序（得分高的排前面即可，不做语义重排 —— 模型的顺序敏感度在这里不重要，
 * 因为 prompt 里已标注了 arc 与序号）。
 */
export function rankCandidates(
  candidates: CandidateBeat[],
  content: string,
  limit: number,
): CandidateBeat[] {
  if (candidates.length <= limit) return candidates
  return [...candidates]
    .map((c, i) => ({ c, i, score: bigramOverlap(content, `${c.title}${c.signal}`) }))
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .slice(0, limit)
    .sort((x, y) => x.i - y.i) // 保持原叙事顺序，读起来才连贯
    .map((x) => x.c)
}

/** 从参考库的 plot 产物里摊平成候选拍 */
export function toCandidates(
  arcs: { id: ID; title: string; beatIds: ID[] }[],
  beats: { id: ID; refId: ID; kind: BeatKind; title: string; signal: string; cost: string }[],
  refTitleOf: (refId: ID) => string,
): CandidateBeat[] {
  const byId = new Map(beats.map((b) => [b.id, b]))
  const out: CandidateBeat[] = []
  for (const arc of arcs) {
    arc.beatIds.forEach((bid, i) => {
      const b = byId.get(bid)
      if (!b) return
      out.push({
        beatId: b.id,
        arcId: arc.id,
        arcTitle: arc.title,
        index: i,
        kind: b.kind,
        title: b.title,
        signal: b.signal,
        cost: b.cost,
        refTitle: refTitleOf(b.refId),
      })
    })
  }
  return out
}
