import type { AIConfig, AppState, Book, Volume, Chapter, Character, ID } from './types'
import { countWords } from './utils'

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

/** 本地事实快照：正文命中角色名即挂到章纲出场角色 */
export function snapshotCast(content: string, chars: Character[], current: ID[]): ID[] {
  const hit = chars.filter((c) => c.name && content.includes(c.name)).map((c) => c.id)
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
  const charName = new Map(state.characters.filter((c) => c.bookId === bookId).map((c) => [c.id, c.name]))

  for (const c of chs) {
    const words = countWords(c.content)
    if (words > 0 && c.outlineStatus === 'plan') {
      issues.push({ level: 'warn', chapterId: c.id, text: `《${c.title}》已有 ${words} 字正文但纲状态仍是"计划中"，建议回写章纲` })
    }
    if (words > 0) {
      for (const id of c.cast) {
        const name = charName.get(id)
        if (name && !c.content.includes(name)) {
          issues.push({ level: 'info', chapterId: c.id, text: `《${c.title}》挂了角色"${name}"但正文未出现该名字` })
        }
      }
    }
  }

  for (const f of state.foreshadows.filter((f) => f.bookId === bookId)) {
    if (f.status === 'resolved' && !chs.some((c) => c.foreshadowIds.includes(f.id))) {
      issues.push({ level: 'warn', text: `伏笔"${f.title}"标记为已回收，但没有章节挂接它` })
    }
  }

  for (const v of state.volumes.filter((v) => v.bookId === bookId)) {
    if (!chs.some((c) => c.volumeId === v.id)) {
      issues.push({ level: 'info', text: `《${v.title}》还是空卷，没有章节` })
    }
  }

  return issues
}
