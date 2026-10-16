/**
 * 阶段二：要素抽取的提示词构造。
 *
 * 核心难点是**跨批次同名角色合并**：72 个批次各自独立抽取的话，
 * 同一个角色会被识别成 72 个不同的人。做法是每批都带上「已知角色/设定名单」，
 * 并要求模型对号入座、只在确属新角色时才新增。
 */
import type { BatchTask } from './aiqueue'

export const SYS_EXTRACTOR =
  '你是网文拆解分析师，逐批抽取人物、设定与伏笔。只输出符合 schema 的 JSON，不要解释或代码块。' +
  '严格依据给定正文归纳，正文没有的一律留空字符串，不得虚构。'

/** 一批的抽取结果 */
export interface BatchElements {
  characters?: {
    name?: string
    aliases?: string[]
    role?: string
    appearance?: string
    personality?: string
    background?: string
    motivation?: string
    ability?: string
    speech?: string
  }[]
  settings?: { category?: string; name?: string; desc?: string; status?: string; subtype?: string }[]
  foreshadows?: { title?: string; detail?: string; plant?: boolean; payoff?: boolean }[]
}

/** 已知名单 —— 让模型对号入座而非重复造人 */
export interface KnownIndex {
  characters: { name: string; aliases: string[] }[]
  settings: { category: string; name: string }[]
}

const CATEGORY_HINT =
  '设定类别 category 只能取：location(地点) / item(物品) / faction(势力) / rule(规则) / power(功法)。' +
  '势力类还要给 subtype，取值如 sect / dynasty / gang / academy。'

function fmtKnown(k: KnownIndex): string {
  const chars = k.characters.map((c) => (c.aliases.length ? `${c.name}(${c.aliases.join('、')})` : c.name))
  const sets = k.settings.map((s) => `${s.name}[${s.category}]`)
  const lines: string[] = []
  if (chars.length) lines.push(`已有人物（出现过的角色，请优先复用其名字与别名，不要新造同类）：${chars.join('、')}`)
  if (sets.length) lines.push(`已有设定（请优先复用）：${sets.join('、')}`)
  return lines.length ? lines.join('\n') : '此前批次未出现任何人物或设定，本批出现的人物都是新角色。'
}

/**
 * 超长批次的正文裁剪：保留头尾，中段省略。
 * 章纲信息通常在头尾，掐中段对要素抽取的损失最小。
 */
export function trimForCall(texts: string[], maxChars: number): { text: string; truncated: boolean } {
  const joined = texts.join('\n\n')
  if (joined.length <= maxChars) return { text: joined, truncated: false }
  const head = Math.floor(maxChars * 0.6)
  const tail = maxChars - head
  return {
    text: `${joined.slice(0, head)}\n\n（中间约 ${joined.length - maxChars} 字已省略）\n\n${joined.slice(-tail)}`,
    truncated: true,
  }
}

export function elementsPrompt(
  bookTitle: string,
  genre: string,
  batch: BatchTask,
  chapterTexts: { title: string; text: string }[],
  known: KnownIndex,
  maxChars: number,
): string {
  const body = trimForCall(chapterTexts.map((c) => `${c.title}\n${c.text}`), maxChars)
  return [
    `作品《${bookTitle}》（${genre}）第 ${batch.fromChapter}–${batch.toChapter} 章。`,
    '',
    fmtKnown(known),
    '',
    '本批正文：',
    '"""',
    body.text,
    '"""',
    '',
    '归纳本批出现的人物、设定与伏笔：',
    '1. characters：仅收录本批**真正出场或有明确提及**的人物。name 用作品中最主要的称呼，' +
    '其他称呼填进 aliases。若该人物在「已有人物」里，name 必须用名单里的写法。',
    '2. settings：worldbuilding 中出现的地点/物品/势力/规则/功法。' + CATEGORY_HINT,
    '3. foreshadows：埋设填 plant=true，回收填 payoff=true，两者皆可是 false。',
    '4. 所有描述性字段（appearance/personality/background/motivation/ability/speech/desc/detail）' +
    '仅依据本批正文；本批没交代的一律留空字符串，不得从后文或常识补全。',
    '',
    'schema: {"characters":[{"name":"","aliases":[],"role":"","appearance":"","personality":"",' +
    '"background":"","motivation":"","ability":"","speech":""}],' +
    '"settings":[{"category":"","name":"","desc":"","status":"","subtype":""}],' +
    '"foreshadows":[{"title":"","detail":"","plant":false,"payoff":false}]}',
  ].join('\n')
}

/* ================================ 阶段三：情节链 ================================ */

export const SYS_PLOT =
  '你是网文结构分析师，逐批判定章节的情节功能并归纳叙事线。' +
  '只输出符合 schema 的 JSON，不要解释或代码块。严格依据给定正文，不得虚构。'

export const BEAT_KIND_HINT =
  'kind 只能取：setup(开局) / build(铺垫) / conflict(冲突) / twist(反转) / payoff(爽点) / resolve(收束)。'

/** 一拍在正文里的可识别特征摘要 —— 用于跨批延续判断 */
export interface BeatBrief {
  index: number
  kind: string
  title: string
  fromChapter: number
  toChapter: number
  signal: string
  cost: string
  characters: string[]
}

export interface BatchPlot {
  beats?: {
    fromChapter?: number
    toChapter?: number
    kind?: string
    title?: string
    summary?: string
    signal?: string
    cost?: string
    characters?: string[]
    /** 本拍是否延续上一批的最后一拍（同一段情节跨批次边界） */
    continuesFromPrev?: boolean
  }[]
}

export function plotPrompt(
  bookTitle: string,
  genre: string,
  batch: BatchTask,
  chapterTexts: { title: string; text: string }[],
  /** 上一批的最后一拍，供本批判定是否延续 */
  prevBeat: BeatBrief | null,
  maxChars: number,
): string {
  const body = trimForCall(chapterTexts.map((c) => `${c.title}\n${c.text}`), maxChars)
  return [
    `作品《${bookTitle}》（${genre}）第 ${batch.fromChapter}–${batch.toChapter} 章。`,
    BEAT_KIND_HINT,
    '',
    prevBeat
      ? [
          `上一批的最后一拍：kind=${prevBeat.kind}「${prevBeat.title}」，覆盖第 ${prevBeat.fromChapter}–${prevBeat.toChapter} 章。`,
          `  它在正文里的可识别特征：${prevBeat.signal}`,
          `  它的硬性要求：${prevBeat.cost}`,
          `若本批开头仍在同一段情节里（同一场景或同一冲突尚未结束），把它的 toChapter 延伸并置 continuesFromPrev=true。`,
        ].join('\n')
      : '这是第一批，没有前序情节。',
    '',
    '本批正文：',
    '"""',
    body.text,
    '"""',
    '',
    '判定本批的情节拍。每拍给出覆盖的章序区间与：',
    '- title：这一拍叫什么（四到八字）',
    '- summary：这一拍在结构上干了什么（一两句）',
    '- signal：这一拍在正文里**可被识别的特征**。日后要拿读者自己写的章节去比对它，所以要写' +
    '可观察的内容特征（如"当众被贬、无人出面维护"），不要写抽象概念',
    '- cost：这一拍必须付出的代价或必须成立的前提。没有就给"无硬性要求"',
    '- characters：参与的主要角色名',
    '一拍的跨度由情节决定，通常跨若干章；不要把每一章都切成一拍。只依据本批正文，不得虚构。',
    '',
    'schema: {"beats":[{"fromChapter":0,"toChapter":0,"kind":"","title":"","summary":"",' +
    '"signal":"","cost":"","characters":[],"continuesFromPrev":false}]}',
  ].join('\n')
}

export interface ArcResult {
  arcs?: {
    title?: string
    /** beat 序号（对应输入 beats 的 index） */
    beatIndexes?: number[]
    /** 从这条线抽象出的可复用骨架 */
    skeleton?: {
      steps?: { key?: string; label?: string; require?: string }[]
      suggestedSpan?: number
    }
  }[]
}

/**
 * 把有序的情节拍组织成叙事线并抽出骨架。
 * 这一步**只喂拍摘要，不喂正文**，所以很便宜（全书仅一次）。
 */
export function arcPrompt(bookTitle: string, genre: string, beats: BeatBrief[]): string {
  const brief = beats
    .map(
      (b) =>
        `#${b.index} [${b.kind}] 第${b.fromChapter}-${b.toChapter}章「${b.title}」\n` +
        `  可识别特征：${b.signal}\n  硬性要求：${b.cost}`,
    )
    .join('\n')
  return [
    `作品《${bookTitle}》（${genre}）全书的情节拍如下（按章序排列）：`,
    '"""',
    brief,
    '"""',
    '',
    '把这些拍组织成叙事线（一条线是一条连贯的情节推进，通常 1-3 条）。',
    '然后为每条线抽象出**可复用的骨架**：只保留方法步骤，不含任何具体人名地名与原文。',
    '每一步给出 require（这一步必须成立的条件）。suggestedSpan 用「章」为单位给建议跨度。',
    '若某条线不构成可复用的方法（比如只是过场），可以不给 skeleton。',
    '',
    'schema: {"arcs":[{"title":"","beatIndexes":[0,1],' +
    '"skeleton":{"steps":[{"key":"","label":"","require":""}],"suggestedSpan":20}}]}',
  ].join('\n')
}
