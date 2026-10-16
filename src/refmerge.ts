/**
 * 跨批次结果合并。
 *
 * 队列跑完得到的是 72 份碎片，这里把它们合成一份去重的要素表。
 * 合并靠**精确名 + 别名**匹配，不做模糊匹配 —— 两个不同的「林」很容易被
 * 误合并，宁可让用户在界面上手动合并，也不要悄悄把两个角色并成一个。
 */
import { uid } from './utils'
import type { RefCharacter, RefSetting, RefForeshadow } from './refschema'
import type { BatchElements, KnownIndex } from './refprompt'

/** 合并后的中间形态（还没分配稳定 id） */
export interface MergedCharacter {
  name: string
  aliases: Set<string>
  role: string
  appearance: string
  personality: string
  background: string
  motivation: string
  ability: string
  speech: string
  chapters: Set<number>
}

export interface MergedSetting {
  category: string
  name: string
  desc: string
  status: string
  subtype: string
  chapters: Set<number>
}

const CHAR_FIELDS = ['role', 'appearance', 'personality', 'background', 'motivation', 'ability', 'speech'] as const
const SET_FIELDS = ['desc', 'status', 'subtype'] as const

function emptyChar(name: string): MergedCharacter {
  return {
    name,
    aliases: new Set(),
    role: '',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    ability: '',
    speech: '',
    chapters: new Set(),
  }
}

/**
 * 合并后的文本字段取「更长的那个」：跨批时后出现的批次常带更完整的信息，
 * 但不能简单以后者覆盖前者（后者可能是空串）。
 */
function mergeField(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return b.length > a.length ? b : a
}

export class ElementsMerger {
  private chars: MergedCharacter[] = []
  private settings: MergedSetting[] = []
  /** 名字/别名 -> 角色下标，用于跨批对号入座 */
  private charIndex = new Map<string, number>()
  private settingIndex = new Map<string, number>()
  private foreshadows: RefForeshadow[] = []
  private fsIndex = new Map<string, number>()

  /** 每批开始前取快照，作为下一批的「已知名单」 */
  snapshot(): KnownIndex {
    return {
      characters: this.chars
        .slice(0, 80)
        .map((c) => ({ name: c.name, aliases: [...c.aliases].slice(0, 4) })),
      settings: this.settings.slice(0, 60).map((s) => ({ category: s.category, name: s.name })),
    }
  }

  /** 吸收一个批次的结果。chapters 为该批覆盖的章序 */
  add(batch: BatchElements, chapters: number[]): void {
    for (const raw of batch.characters ?? []) {
      const name = (raw.name ?? '').trim()
      if (!name) continue
      const aliases = (raw.aliases ?? []).map((a) => a.trim()).filter(Boolean)
      // 先按别名找，再按主名找 —— 模型可能用别名当 name 报上来
      let idx = this.findChar(aliases) ?? this.charIndex.get(name)
      if (idx === undefined) {
        this.chars.push(emptyChar(name))
        idx = this.chars.length - 1
        this.charIndex.set(name, idx)
      }
      const c = this.chars[idx]
      for (const a of aliases) {
        c.aliases.add(a)
        // 别名也必须注册进索引：模型可能拿别名当 name 报上来（第二、三批）
        if (!this.charIndex.has(a)) this.charIndex.set(a, idx)
      }
      for (const f of CHAR_FIELDS) {
        const v = raw[f]
        if (v) c[f] = mergeField(c[f], v)
      }
      for (const ch of chapters) c.chapters.add(ch)
    }

    for (const raw of batch.settings ?? []) {
      const name = (raw.name ?? '').trim()
      if (!name) continue
      const category = (raw.category ?? 'rule').trim()
      const key = `${category}:${name}`
      let s = this.settings[this.settingIndex.get(key) ?? -1]
      if (!s) {
        s = { category, name, desc: '', status: '', subtype: '', chapters: new Set() }
        this.settings.push(s)
        this.settingIndex.set(key, this.settings.length - 1)
      }
      for (const f of SET_FIELDS) {
        const v = raw[f]
        if (v) s[f] = mergeField(s[f], v)
      }
      for (const ch of chapters) s.chapters.add(ch)
    }

    for (const raw of batch.foreshadows ?? []) {
      const title = (raw.title ?? '').trim()
      if (!title) continue
      let i = this.fsIndex.get(title)
      if (i === undefined) {
        this.foreshadows.push({
          id: uid('rf'),
          title,
          detail: '',
          plantChapter: 0,
          payoffChapter: null,
          span: 0,
          provenance: { refId: '', fromChapter: chapters[0] ?? 0, toChapter: chapters[0] ?? 0 },
        })
        i = this.foreshadows.length - 1
        this.fsIndex.set(title, i)
      }
      const f = this.foreshadows[i]
      if (raw.detail) f.detail = mergeField(f.detail, raw.detail)
      // 埋设章取最早，回收章取最晚 —— 一条线跨多个批次是常态
      if (raw.plant) f.plantChapter = f.plantChapter ? Math.min(f.plantChapter, chapters[0] ?? 0) : (chapters[0] ?? 0)
      if (raw.payoff) f.payoffChapter = Math.max(f.payoffChapter ?? 0, chapters[chapters.length - 1] ?? 0)
      if (f.plantChapter) {
        f.provenance = { ...f.provenance, fromChapter: Math.min(f.provenance.fromChapter, chapters[0] ?? 0) }
        f.provenance.toChapter = Math.max(f.provenance.toChapter, chapters[chapters.length - 1] ?? 0)
      }
    }
  }

  private findChar(aliases: string[]): number | undefined {
    for (const a of aliases) {
      const i = this.charIndex.get(a)
      if (i !== undefined) return i
    }
    return undefined
  }

  /** 产出最终形态：算跨度、排序 */
  finish(refId: string): { characters: RefCharacter[]; settings: RefSetting[]; foreshadows: RefForeshadow[] } {
    const chapters = this.foreshadows.map((f) => {
      const span = f.payoffChapter && f.plantChapter ? f.payoffChapter - f.plantChapter + 1 : 0
      return { ...f, span, provenance: { ...f.provenance, refId } }
    })

    return {
      characters: this.chars.map((c) => {
        const list = [...c.chapters].sort((a, b) => a - b)
        return {
          id: uid('rc'),
          name: c.name,
          aliases: [...c.aliases],
          role: c.role,
          appearance: c.appearance,
          personality: c.personality,
          background: c.background,
          motivation: c.motivation,
          ability: c.ability,
          speech: c.speech,
          firstChapter: list[0] ?? 0,
          lastChapter: list[list.length - 1] ?? 0,
          provenance: { refId, fromChapter: list[0] ?? 0, toChapter: list[list.length - 1] ?? 0 },
        }
      }),
      settings: this.settings.map((s) => {
        const list = [...s.chapters].sort((a, b) => a - b)
        return {
          id: uid('rs'),
          category: (s.category || 'rule') as RefSetting['category'],
          name: s.name,
          desc: s.desc,
          status: s.status,
          subtype: s.subtype,
          chapters: list,
          provenance: { refId, fromChapter: list[0] ?? 0, toChapter: list[list.length - 1] ?? 0 },
        }
      }),
      foreshadows: chapters.sort((a, b) => a.plantChapter - b.plantChapter),
    }
  }

  get counts() {
    return { characters: this.chars.length, settings: this.settings.length, foreshadows: this.foreshadows.length }
  }
}
