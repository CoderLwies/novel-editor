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
  /** 章纲：故事内时间（第 N 天），留空表示不标记 */
  storyDay?: number
  /** 章纲：手动挂接的设定 id（与名称命中自动索引互补） */
  settingIds?: ID[]
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
  /** 成长弧线：阶段/境界变更，可关联章节 */
  arc?: { id: ID; stage: string; chapterId?: ID }[]
}

export interface SettingItem {
  id: ID
  bookId: ID
  category: SettingCategory
  name: string
  desc: string
  /** 设定当前状态/演变（如势力：活跃/覆灭） */
  status?: string
  /** 子类型（势力：sect/dynasty/gang；宗门：inner/outer …），用于匹配参考库拆解出的要素清单 */
  subtype?: string
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
  /** 关联设定 id */
  settingIds?: ID[]
}

/** date(YYYY-MM-DD) -> 当日新增字数 */
export type DailyLog = Record<string, number>

/* ------------------------------ 参考库 ------------------------------ */

/**
 * 参考作品的分析阶段。
 * idle 仅完成拆章入库；scanning 快速扫描；scanned 扫描完成可决定是否深挖；
 * reading 深度精读；done 全部完成。
 */
export type RefStage = 'idle' | 'scanning' | 'scanned' | 'reading' | 'done'

/** 参考作品的一个卷（仅概要，不载正文） */
export interface RefVolume {
  title: string
  chapterCount: number
}

/**
 * 参考作品：导入他人小说做拆解分析。
 * 与 Book 刻意分开 —— 参考书没有写作语义（无日更目标 / 字数统计 / 章树编辑），
 * 产出是分析报告与借鉴模板，不是章节正文。原文一律落盘，本地仅存这份轻量元数据。
 */
export interface Reference {
  id: ID
  title: string
  author: string
  genre: string
  /** 原文总字数 */
  wordCount: number
  chapterCount: number
  /** 分卷概要（按序） */
  volumes: RefVolume[]
  /** 绑定的本地目录（reference.json + chapters/ + analysis/） */
  dir: string
  /** 导入时探测到的源编码，便于回溯乱码问题 */
  sourceEncoding: string
  stage: RefStage
  createdAt: number
  updatedAt: number
}

export interface UIState {
  theme: 'light' | 'dark'
  fontSize: number
  lastBookId: ID | null
  lastChapterId: ID | null
  jump: JumpTarget | null
  lastGoalToastDate: string
  /** 是否已完成新手引导 */
  onboarded?: boolean
  /** 最近打开的书 id（最多 8） */
  recentBookIds?: ID[]
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
  /** 参考库（他人作品，仅拆解分析，不参与日更与字数统计） */
  references: Reference[]
  dailyLog: DailyLog
  ui: UIState
  ai: AIConfig
  snapshots: ChapterSnapshot[]
}
