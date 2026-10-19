import type { ID } from './types'

/**
 * AI 任务队列 —— **设计契约**（实现前先冻结）。
 *
 * 为什么要队列：一部 286 章的长篇要做要素抽取，得分几十到上百次模型调用。
 * 现有的 chatJSON 是一次性、无进度、无断点、无重试的，直接拿来跑会遇到：
 * 中途关窗口全丢、失败静默跳过、token 花超了才发现。
 *
 * 本文件只定义**形状**，不含实现。
 */

/* ============================== 计价与预算 ============================== */

/**
 * 模型计价（元 / 百万 token）。
 *
 * 为什么做成配置而不是写死常量：DeepSeek 已于 2026-08-17 启用峰谷分时定价，
 * 且用户可以把 Base URL 改成任意中转站 —— 单价随时会变，
 * 硬编码的预算换算会悄悄失真。默认值为 V4-Flash 空闲时段价。
 */
export interface ModelPricing {
  /** 每百万输入 token（元），空闲时段 */
  inputPerM: number
  /** 每百万输出 token（元），空闲时段 */
  outputPerM: number
  /** 高峰时段倍率。DeepSeek 高峰为 2 倍 */
  peakMultiplier: number
}

/** DeepSeek V4-Flash 现行价（2026-08-17 起）。高峰时段由 peakMultiplier 推出 */
export const DEFAULT_PRICING: ModelPricing = {
  inputPerM: 1.5,
  outputPerM: 4.5,
  peakMultiplier: 2,
}

/**
 * DeepSeek 峰谷时段（北京时间）：9:00-12:00 与 14:00-18:00 为高峰。
 * 高峰时段同样任务成本翻倍 —— 深度分析是后台任务，应尽量避开。
 */
export function isPeakHour(d = new Date()): boolean {
  const h = d.getHours()
  return (h >= 9 && h < 12) || (h >= 14 && h < 18)
}

/** token 数 → 金额（元）。peak 决定是否按高峰价计 */
export function costOf(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing = DEFAULT_PRICING,
  peak = isPeakHour(),
): number {
  const m = peak ? pricing.peakMultiplier : 1
  const yuan = ((inputTokens / 1e6) * pricing.inputPerM + (outputTokens / 1e6) * pricing.outputPerM) * m
  return Math.round(yuan * 10000) / 10000
}

/** 预算是否已耗尽。留 5% 余量，避免最后一批正好把预算吃穿 */
export function budgetExhausted(spentYuan: number, budgetYuan: number | null): boolean {
  if (budgetYuan === null) return false
  return spentYuan >= budgetYuan * 0.95
}

/* ============================== 配置 ============================== */

export interface QueueConfig {
  /**
   * 并发数。默认 3 —— 桌面应用不应占满用户的 API 配额，
   * 太高会撞限流反而更慢（失败重试的开销大于并发收益）。
   */
  concurrency: number
  /**
   * 每批章数。默认 4 —— 单章 3000 字 ×4 ≈ 1.2 万字，在 flash 模型的舒适区。
   * 太大则单次失败的代价高，太小则跨批上下文拼接次数多、同名合并更易碎。
   */
  batchChapters: number
  /** 单次调用喂入的正文上限（字）。防止个别超长章把单次 token 顶爆。 */
  maxCharsPerCall: number
  /** 网络/限流类错误的最大重试次数 */
  maxRetries: number
  /** 指数退避基数：第 n 次重试等 base * 2^n */
  retryBaseDelayMs: number
  /**
   * 预算上限（元）。超出则**暂停**而非终止 —— 用户可能愿意加预算或换模型继续。
   * 默认 50 元：按 V4-Flash 现行价足够深度拆解多本长篇，是防异常的保护而非日常约束。
   * null = 不限。
   */
  budgetYuan: number | null
  /** 单价；用户换中转站或模型涨价时改这里，预算换算才不会失真 */
  pricing: ModelPricing
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  concurrency: 3,
  batchChapters: 4,
  maxCharsPerCall: 24000,
  maxRetries: 3,
  retryBaseDelayMs: 1200,
  budgetYuan: 50,
  pricing: DEFAULT_PRICING,
}

/* ============================== 阶段与批次 ============================== */

/** 需要 AI 的阶段。本地统计（结构与节奏）不在其中 —— 它 0 token 且可复现 */
export type AiStage = 'elements' | 'plot'

export const AI_STAGE_LABEL: Record<AiStage, string> = {
  elements: '要素抽取',
  plot: '情节链拆解',
}

/**
 * 一个批次。批次是 checkpoint 的最小单位：
 * 中断的最坏代价 = 重跑 1 个批次（batchChapters-1 章 = 1 次调用）。
 */
export interface BatchTask {
  refId: ID
  stage: AiStage
  /** 批序号，0 起 */
  index: number
  /** 覆盖的章序区间，1 起闭区间 */
  fromChapter: number
  toChapter: number
}

/**
 * 按固定批大小切分全书。
 *
 * 关键：**批边界只依赖总章数与批大小**，不依赖任何运行期状态 ——
 * 这样恢复时用同样的输入就能算出同样的批次，从而知道哪些已完成、哪些没有。
 */
export function planBatches(
  refId: ID,
  stage: AiStage,
  chapterCount: number,
  batchChapters: number,
): BatchTask[] {
  const out: BatchTask[] = []
  const step = Math.max(1, batchChapters)
  for (let from = 1, i = 0; from <= chapterCount; from += step, i++) {
    out.push({
      refId,
      stage,
      index: i,
      fromChapter: from,
      toChapter: Math.min(from + step - 1, chapterCount),
    })
  }
  return out
}

/* ============================== 错误分类 ============================== */

/**
 * 失败要分类处理，不能一律重试：
 * - network / ratelimit：退避后重试
 * - parse：重试一次（可能是偶发截断），仍失败则跳过并记录
 * - auth：重试无意义，必须提示用户配 API Key
 * - aborted：用户主动中断，不算失败
 */
export type TaskErrorKind = 'network' | 'ratelimit' | 'parse' | 'auth' | 'aborted' | 'unknown'

export interface TaskError {
  kind: TaskErrorKind
  message: string
  batchIndex: number
  /** 第几次尝试，1 起 */
  attempt: number
}

/** 该类错误是否值得重试 */
export function shouldRetry(kind: TaskErrorKind, attempt: number, maxRetries: number): boolean {
  if (kind === 'auth' || kind === 'aborted') return false
  if (kind === 'parse') return attempt <= 1
  return attempt <= maxRetries
}

/** 退避时长：base * 2^(attempt-1)，上限 30s */
export function backoffMs(attempt: number, base: number): number {
  return Math.min(base * 2 ** (attempt - 1), 30000)
}

/* ============================== 断点续跑 ============================== */

/**
 * 断点文件 `<ref>/analysis/checkpoint.json`。
 *
 * 设计要点：**记已完成的批次序号集合，而不是「跑到第几批」**。
 * 并发完成顺序不固定，记序号集合才能正确跳过乱序完成的批次。
 */
export interface QueueCheckpoint {
  refId: ID
  stage: AiStage
  /** 产出该 checkpoint 时的批大小。与当前 config 不一致时必须作废重跑。 */
  batchChapters: number
  totalBatches: number
  /** 已成功完成的批次序号 */
  completed: number[]
  /** 重试耗尽、被跳过的批次（结果有缺口，UI 必须可见） */
  failed: TaskError[]
  /** 累计输入 / 输出 token。分开记是因为两者单价不同 */
  inputTokens: number
  outputTokens: number
  status: 'running' | 'paused' | 'done'
  startedAt: number
  updatedAt: number
}

/** checkpoint 是否还能用（批大小变了就得重跑） */
export function checkpointValid(cp: QueueCheckpoint | null, batchChapters: number): boolean {
  return !!cp && cp.batchChapters === batchChapters && cp.completed.length + cp.failed.length <= cp.totalBatches
}

/**
 * 从 checkpoint 恢复出待跑批次。
 * 已失败的批次也跳过 —— 重试耗尽就不该自动重跑；
 * 要重跑需显式清空 failed（UI 提供「重跑失败批次」）。
 */
export function pendingBatches(batches: BatchTask[], cp: QueueCheckpoint | null): BatchTask[] {
  if (!cp) return batches
  const handled = new Set([...cp.completed, ...cp.failed.map((f) => f.batchIndex)])
  return batches.filter((b) => !handled.has(b.index))
}

/* ============================== 成本 ============================== */

/**
 * 开始前的预估。刻意给区间而不是单值 —— 模型输出长度不可预测，
 * 报一个精确数字会给人虚假的安全感。
 */
export interface CostEstimate {
  batches: number
  /** 每批正文约多少字（决定输入 token） */
  avgCharsPerBatch: number
  inputTokens: number
  outputTokens: number
  /** 金额区间（元） */
  costMin: number
  costMax: number
  /** peak=true 时按高峰价算 */
  peak: boolean
}

/**
 * 每批输出 token 的经验值（按阶段区分）。
 *
 * 情节链最初按 800 估，实测一部 1171 章的作品是 6183 token/批 —— 低估 7.7 倍。
 * 原因是每拍都带 title/summary/signal/cost/characters 五个字段，
 * 长篇一拍的文字量远超「每批几个标签」。预算提示的可信度直接取决于这个数。
 */
export const OUTPUT_TOKENS_PER_BATCH: Record<AiStage, number> = {
  elements: 900,
  plot: 6200,
}

export function estimateCost(
  chapterCount: number,
  batchChapters: number,
  avgChapterChars: number,
  pricing: ModelPricing = DEFAULT_PRICING,
  peak = isPeakHour(),
  /** 每千字约 0.6 token（DeepSeek 官方口径：1 中文字符 ≈ 0.6 token） */
  tokensPerKChars = 0.6,
  /** 输出侧粗估：按阶段取经验值，别再用统一的小数字 */
  outputTokensPerBatch = OUTPUT_TOKENS_PER_BATCH.elements,
): CostEstimate {
  const batches = Math.ceil(chapterCount / Math.max(1, batchChapters))
  const avgCharsPerBatch = Math.round(avgChapterChars * batchChapters)
  const inputTokens = Math.round(batches * (avgCharsPerBatch / 1000) * tokensPerKChars)
  const outputTokens = batches * outputTokensPerBatch
  const lo = costOf(inputTokens, Math.round(outputTokens * 0.5), pricing, peak)
  const hi = costOf(inputTokens, outputTokens, pricing, peak)
  return {
    batches,
    avgCharsPerBatch,
    inputTokens,
    outputTokens,
    costMin: lo,
    costMax: Math.round(hi * 1.8 * 100) / 100,
    peak,
  }
}

/* ============================== 进度上报 ============================== */

export interface QueueProgress {
  stage: AiStage
  totalBatches: number
  doneBatches: number
  failedBatches: number
  /** 正在处理的批次（并发时可能多个） */
  activeBatchIndexes: number[]
  /** 已花费金额（元） */
  spentYuan: number
  budgetYuan: number | null
  /** 当前是否处于高峰时段（同样任务成本翻倍） */
  peak: boolean
  startedAt: number
  /** 基于已完成批次速率的剩余时间估计；样本不足时为 null */
  etaMs: number | null
}

/** 进度比例：失败批次算「已处理」，否则用户会永远看不到 100% */
export function progressRatio(p: QueueProgress): number {
  if (!p.totalBatches) return 0
  return Math.min(1, (p.doneBatches + p.failedBatches) / p.totalBatches)
}
