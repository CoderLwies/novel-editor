export type ID = string

export type ChapterStatus = 'draft' | 'reviewing' | 'published'
export type BookStatus = 'ongoing' | 'hiatus' | 'finished'
export type ForeshadowStatus = 'planted' | 'progressing' | 'resolved'
export type SettingCategory = 'location' | 'item' | 'faction' | 'rule' | 'power'
/** 章纲进度：计划中 / 已成文 / 已修纲 */
export type OutlineStatus = 'plan' | 'written' | 'revised'

export interface Book {
  id: ID
  title: string
  author: string
  genre: string
  synopsis: string
  coverColor: string
  status: BookStatus
  dailyGoal: number
  /** 绑定的本地项目目录（Electron 落盘）；未绑定为 undefined */
  projectPath?: string
  createdAt: number
  updatedAt: number
}

export interface Volume {
  id: ID
  bookId: ID
  title: string
  order: number
  /** 卷纲：一句话概括本卷 */
  synopsis: string
  /** 本卷目标（主角要达成什么） */
  goal: string
  /** 本卷核心冲突 */
  conflict: string
}

export interface Chapter {
  id: ID
  bookId: ID
  volumeId: ID
  title: string
  content: string
  synopsis: string
  order: number
  status: ChapterStatus
  /** 章纲：本章目标 */
  goal: string
  /** 章纲：主要冲突 */
  conflict: string
  /** 章纲：转折点 */
  turning: string
  /** 章纲：结尾钩子 */
  hook: string
  /** 章纲：视角人物 */
  pov: string
  /** 章纲：出场角色 id */
  cast: ID[]
  /** 章纲：本章埋设的伏笔 id */
  foreshadowIds: ID[]
  /** 章纲：本章回收的伏笔 id */
  foreshadowPayoffs: ID[]
  /** 章纲进度 */
  outlineStatus: OutlineStatus
  createdAt: number
  updatedAt: number
}

export type CharacterState = 'alive' | 'dead' | 'missing' | 'retired'

export interface Character {
  id: ID
  bookId: ID
  name: string
  role: string
  desc: string
  /** 别名/曾用名，正文命中索引一并匹配 */
  aliases?: string[]
  status?: CharacterState
  appearance?: string
  personality?: string
  background?: string
  motivation?: string
  ability?: string
  /** 口头禅 / 语言习惯 */
  speech?: string
  /** 角色关系：目标角色 + 关系称谓 */
  relations?: { targetId: ID; relation: string }[]
}

export interface SettingItem {
  id: ID
  bookId: ID
  category: SettingCategory
  name: string
  desc: string
  /** 设定当前状态/演变（如势力：活跃/覆灭） */
  status?: string
}

export type ForeshadowPriority = 'main' | 'sub' | 'detail'

export interface Foreshadow {
  id: ID
  bookId: ID
  title: string
  detail: string
  status: ForeshadowStatus
  /** 重要度：主线/支线/细节 */
  priority?: ForeshadowPriority
  /** 关联角色 id */
  characterIds?: ID[]
}

/** date(YYYY-MM-DD) -> 当日新增字数 */
export type DailyLog = Record<string, number>

export interface UIState {
  theme: 'light' | 'dark'
  fontSize: number
  lastBookId: ID | null
  lastChapterId: ID | null
  jump: JumpTarget | null
  lastGoalToastDate: string
  /** 是否已完成新手引导 */
  onboarded?: boolean
}

export interface ChapterSnapshot {
  id: ID
  chapterId: ID
  at: number
  content: string
}

export interface JumpTarget {
  chapterId: ID
  index: number
  length: number
  nonce: number
}

/** OpenAI 兼容接口配置；baseUrl 为空表示未启用 AI */
export interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface AppState {
  books: Book[]
  volumes: Volume[]
  chapters: Chapter[]
  characters: Character[]
  settings: SettingItem[]
  foreshadows: Foreshadow[]
  dailyLog: DailyLog
  ui: UIState
  ai: AIConfig
  snapshots: ChapterSnapshot[]
}
