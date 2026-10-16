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
