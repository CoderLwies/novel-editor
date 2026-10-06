import type { AIConfig, AppState, Book, Volume, Chapter, Character, ID } from './types'
import { countWords } from './utils'

/** 当前仅支持 DeepSeek flash；baseUrl 预填官方端点，用户可改为兼容中转 */
export const AI_MODEL = 'deepseek-flash'
export const DEFAULT_AI_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_AI_CONFIG: AIConfig = {
  baseUrl: DEFAULT_AI_BASE_URL,
  apiKey: '',
  model: AI_MODEL,
}

export const aiReady = (c: AIConfig) => !!c.baseUrl.trim() && !!c.model.trim()

export interface GenChapterOutline {
  title: string
  synopsis: string
  goal: string
  conflict: string
  turning: string
  hook: string
  pov: string
}

export interface GenBranch {
  label: string
  synopsis: string
  turning: string
  hook: string
}

export interface GenWriteback {
  synopsis: string
  turning: string
  hook: string
}

export function parseJsonLoose(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(t)
  } catch {
    /* 继续宽松提取 */
  }
  const starts = [t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0)
  const start = starts.length ? Math.min(...starts) : -1
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  if (start === -1 || end <= start) throw new Error('AI 返回不是有效 JSON')
  return JSON.parse(t.slice(start, end + 1))
}

export async function chatJSON<T>(config: AIConfig, system: string, user: string): Promise<T> {
  const url = `${config.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.7,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok) throw new Error(`AI 接口返回 ${res.status}`)
  const data = await res.json()
  const text: string = data?.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('AI 返回空内容')
  return parseJsonLoose(text) as T
}

export const SYS_PLANNER = '你是网文连载的outline策划，只输出符合 schema 的 JSON，不要任何解释或代码块。'

export function splitOutlinePrompt(book: Book, vol: Volume, existing: Chapter[]): string {
  return [
    `作品《${book.title}》（${book.genre}）总纲：${book.synopsis || '无'}`,
    `分卷《${vol.title}》卷纲：${vol.synopsis || '无'}；本卷目标：${vol.goal || '无'}；核心冲突：${vol.conflict || '无'}`,
    existing.length > 0
      ? `卷内已有章节：${existing.map((c) => c.title).join('、')}（不得重复或覆盖）`
      : '本卷暂无章节',
    '为本卷规划 3 到 6 个新章节。title 用"第X章 …"格式；synopsis 一句话；并给出 goal/conflict/turning/hook/pov（视角人物名）。',
    'schema: {"chapters":[{"title":"","synopsis":"","goal":"","conflict":"","turning":"","hook":"","pov":""}]}',
  ].join('\n')
}

export function branchPrompt(book: Book, ch: Chapter): string {
  return [
    `作品《${book.title}》章节《${ch.title}》当前章纲：`,
    `概括：${ch.synopsis || '无'}；目标：${ch.goal || '无'}；冲突：${ch.conflict || '无'}；转折：${ch.turning || '无'}；钩子：${ch.hook || '无'}`,
    '给出 3 个不同的剧情走向分支，每个含 label（四字以内短名）、synopsis、turning、hook。',
    'schema: {"branches":[{"label":"","synopsis":"","turning":"","hook":""}]}',
  ].join('\n')
}

export function writebackPrompt(book: Book, ch: Chapter): string {
  const body = ch.content.length > 6000 ? `${ch.content.slice(0, 6000)}\n（正文过长，已截断）` : ch.content
  return [
    `作品《${book.title}》章节《${ch.title}》正文如下：`,
    '"""',
    body,
    '"""',
    '仅依据正文归纳本章实际走向：synopsis（一两句话）、turning（转折点）、hook（留给下一章的悬念）。不得虚构正文没有的内容。',
    'schema: {"synopsis":"","turning":"","hook":""}',
  ].join('\n')
}

export interface GenCharacterCard {
  appearance?: string
  personality?: string
  background?: string
  motivation?: string
  ability?: string
  speech?: string
}

export function characterCardPrompt(book: Book, ch: Character, excerpts: string[]): string {
  return [
    `作品《${book.title}》角色"${ch.name}"${ch.role ? `（${ch.role}）` : ''}。`,
    excerpts.length > 0
      ? `该角色相关正文片段：\n"""${excerpts.join('\n---\n')}"""`
      : '暂无正文片段，仅依据角色名与定位保守推断。',
    '归纳该角色：appearance 外貌、personality 性格、background 背景身世、motivation 动机目标、ability 能力/功法、speech 口头禅或语言习惯。',
    '仅依据正文，不得虚构正文没有的事实；无依据的字段留空字符串。',
    'schema: {"appearance":"","personality":"","background":"","motivation":"","ability":"","speech":""}',
  ].join('\n')
}

/** 角色名 + 别名，正文命中索引一并匹配 */
export function charNames(c: Character): string[] {
  return [c.name, ...(c.aliases ?? [])].filter((n) => n && n.trim())
}

export interface GenContinue {
  text: string
}

export interface GenPolish {
  text: string
}

export interface GenReview {
  issues: string[]
}

export function continuePrompt(book: Book, ch: Chapter, selected: string, before: string): string {
  return [
    `作品《${book.title}》章节《${ch.title}》。`,
    `选段前文："""${before.slice(-800)}"""`,
    `选段："""${selected}"""`,
    '请顺着选段的剧情与文风续写 200 到 400 字，直接给续写正文，不要解释。',
    'schema: {"text":""}',
  ].join('\n')
}

export function polishPrompt(selected: string): string {
  return [
    '润色以下网文段落：保持原意与人物口吻，优化节奏与用词，不要增删剧情。',
    `"""${selected}"""`,
    'schema: {"text":""}',
  ].join('\n')
}

export function reviewPrompt(book: Book, ch: Chapter, selected: string): string {
  return [
    `作品《${book.title}》章节《${ch.title}》选段如下：`,
    `"""${selected}"""`,
    '以网文编辑视角审查：指出节奏、逻辑、对话、钩子问题，每条一句话。',
    'schema: {"issues":[""]}',
  ].join('\n')
}

/** 本地事实快照：正文命中角色名或别名即挂到章纲出场角色 */
export function snapshotCast(content: string, chars: Character[], current: ID[]): ID[] {
  const hit = chars.filter((c) => charNames(c).some((n) => content.includes(n))).map((c) => c.id)
  return [...new Set([...current, ...hit])]
}

export interface CheckIssue {
  level: 'warn' | 'info'
  text: string
  chapterId?: ID
}

export function consistencyCheck(state: AppState, bookId: ID): CheckIssue[] {
  const issues: CheckIssue[] = []
  const chs = state.chapters.filter((c) => c.bookId === bookId)
  const charById = new Map(state.characters.filter((c) => c.bookId === bookId).map((c) => [c.id, c]))

  for (const c of chs) {
    const words = countWords(c.content)
    if (words > 0 && c.outlineStatus === 'plan') {
      issues.push({ level: 'warn', chapterId: c.id, text: `《${c.title}》已有 ${words} 字正文但纲状态仍是"计划中"，建议回写章纲` })
    }
    if (words > 0) {
      for (const id of c.cast) {
        const ch = charById.get(id)
        if (ch && !charNames(ch).some((n) => c.content.includes(n))) {
          issues.push({ level: 'info', chapterId: c.id, text: `《${c.title}》挂了角色"${ch.name}"但正文未出现该名字或别名` })
        }
      }
      for (const [, ch2] of charById) {
        const names = charNames(ch2)
        if (names.length < 2) continue
        const used = names.filter((n) => c.content.includes(n))
        if (used.length > 1) {
          issues.push({ level: 'info', chapterId: c.id, text: `《${c.title}》对角色"${ch2.name}"混用称呼：${used.join('、')}` })
        }
      }
    }
  }

  const volOrder = new Map(state.volumes.filter((v) => v.bookId === bookId).map((v, i) => [v.id, i]))
  const sorted = [...chs].sort(
    (a, b) => (volOrder.get(a.volumeId) ?? 0) - (volOrder.get(b.volumeId) ?? 0) || a.order - b.order,
  )
  const lastWritten = sorted.reduce((m, c, i) => (countWords(c.content) > 0 ? i : m), -1)
  for (const f of state.foreshadows.filter((x) => x.bookId === bookId)) {
    const pi = sorted.findIndex((c) => c.foreshadowIds.includes(f.id))
    const yi = sorted.findIndex((c) => c.foreshadowPayoffs.includes(f.id))
    const plant = pi === -1 ? undefined : pi
    const pay = yi === -1 ? undefined : yi
    if (plant === undefined && pay === undefined) {
      issues.push({ level: 'info', text: `伏笔"${f.title}"登记后还没有挂到任何章节` })
    }
    if (plant !== undefined && pay === undefined && lastWritten - plant > 10) {
      issues.push({ level: 'warn', text: `伏笔"${f.title}"埋设后已跨 ${lastWritten - plant} 章仍未回收，注意别忘收` })
    }
    if (plant !== undefined && pay !== undefined && pay < plant) {
      issues.push({ level: 'warn', chapterId: sorted[pay].id, text: `伏笔"${f.title}"的回收章早于埋设章，顺序可能有误` })
    }
    if (f.status === 'resolved' && pay === undefined) {
      issues.push({ level: 'warn', text: `伏笔"${f.title}"标记为已回收，但没有回收章挂接它` })
    }
    if (f.status !== 'resolved' && pay !== undefined) {
      issues.push({ level: 'info', text: `伏笔"${f.title}"已有回收章挂接，但状态未同步为已回收` })
    }
  }

  const lastCh = sorted[sorted.length - 1]
  if (lastCh) {
    for (const id of lastCh.cast) {
      const ch = charById.get(id)
      if (ch?.status === 'dead') {
        issues.push({
          level: 'warn',
          chapterId: lastCh.id,
          text: `角色"${ch.name}"已标记死亡，但最新章《${lastCh.title}》仍挂接其出场`,
        })
      }
    }
  }

  let prevDay: { day: number; title: string } | null = null
  for (const c of sorted) {
    if (typeof c.storyDay === 'number' && !Number.isNaN(c.storyDay)) {
      if (prevDay && c.storyDay < prevDay.day) {
        issues.push({
          level: 'warn',
          chapterId: c.id,
          text: `《${c.title}》故事时间（第 ${c.storyDay} 天）早于前一标记章《${prevDay.title}》（第 ${prevDay.day} 天），顺序可能颠倒`,
        })
      }
      prevDay = { day: c.storyDay, title: c.title }
    }
    for (const sid of c.settingIds ?? []) {
      const st = state.settings.find((x) => x.id === sid)
      if (st && st.name && countWords(c.content) > 0 && !c.content.includes(st.name)) {
        issues.push({ level: 'info', chapterId: c.id, text: `《${c.title}》手动挂接设定"${st.name}"但正文未出现其名` })
      }
    }
  }

  for (const v of state.volumes.filter((v) => v.bookId === bookId)) {
    if (!chs.some((c) => c.volumeId === v.id)) {
      issues.push({ level: 'info', text: `《${v.title}》还是空卷，没有章节` })
    }
  }

  return issues
}
