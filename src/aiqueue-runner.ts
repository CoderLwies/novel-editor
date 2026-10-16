/**
 * 队列执行器：把 aiqueue 的契约变成真正在跑的循环。
 *
 * 三条不可让步的约束：
 * 1. **每完成一个批次就落 checkpoint** —— 进程可能被杀掉，内存态不算数
 * 2. **按序号记完成而非完成顺序** —— 并发下第 2 批可能比第 0 批先好
 * 3. **失败必须记录** —— 静默跳过等于结果缺了一块而用户不知情
 */
import type {
  BatchTask,
  QueueCheckpoint,
  QueueConfig,
  QueueProgress,
  TaskError,
  TaskErrorKind,
} from './aiqueue'
import { backoffMs, budgetExhausted, costOf, isPeakHour, progressRatio, shouldRetry } from './aiqueue'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface BatchOutput {
  data: unknown
  inputTokens: number
  outputTokens: number
}

export interface RunOptions {
  batches: BatchTask[]
  config: QueueConfig
  /** 初始断点；null 表示全新开始 */
  checkpoint: QueueCheckpoint | null
  /** 实际执行一个批次 */
  execute: (batch: BatchTask) => Promise<BatchOutput>
  /** 每完成/失败一个批次就调用，用于落盘 checkpoint */
  onCheckpoint: (cp: QueueCheckpoint) => Promise<void> | void
  /** 进度上报 */
  onProgress: (p: QueueProgress) => void
  /** 中断信号 */
  signal?: AbortSignal
}

export interface RunResult {
  checkpoint: QueueCheckpoint
  /** 是否因预算耗尽而暂停（区别于正常跑完） */
  pausedByBudget: boolean
  aborted: boolean
}

export function makeCheckpoint(
  batches: BatchTask[],
  batchChapters: number,
  status: QueueCheckpoint['status'] = 'running',
): QueueCheckpoint {
  const first = batches[0]
  return {
    refId: first?.refId ?? '',
    stage: first?.stage ?? 'elements',
    batchChapters,
    totalBatches: batches.length,
    completed: [],
    failed: [],
    inputTokens: 0,
    outputTokens: 0,
    status,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * 跑一批，返回成功结果或最后一次失败。
 * 重试策略按错误分类区分：限流退避重试，解析失败只重试一次。
 */
async function runOne(
  batch: BatchTask,
  config: QueueConfig,
  execute: RunOptions['execute'],
  signal?: AbortSignal,
): Promise<{ ok: true; out: BatchOutput } | { ok: false; err: TaskError }> {
  let attempt = 0
  let last: TaskError = { kind: 'unknown', message: '未执行', batchIndex: batch.index, attempt: 0 }

  while (true) {
    if (signal?.aborted) {
      return { ok: false, err: { kind: 'aborted', message: '已中断', batchIndex: batch.index, attempt } }
    }
    attempt += 1
    try {
      const out = await execute(batch)
      return { ok: true, out }
    } catch (e) {
      const err = e as Error & { kind?: TaskErrorKind }
      const kind: TaskErrorKind = err.kind ?? 'unknown'
      last = { kind, message: err.message ?? String(e), batchIndex: batch.index, attempt }

      if (!shouldRetry(kind, attempt, config.maxRetries)) {
        return { ok: false, err: last }
      }
      await sleep(backoffMs(attempt, config.retryBaseDelayMs))
    }
  }
}

/**
 * 执行队列。
 *
 * 预算耗尽时**暂停**（status='paused'）而不是终止：用户可能愿意加预算或换模型继续。
 * 中断时保留已完成的部分，下次从 checkpoint 接着跑。
 */
export async function runQueue(opts: RunOptions): Promise<RunResult> {
  const { batches, config, execute, onCheckpoint, onProgress, signal } = opts

  // 已完成 / 已失败的批次直接排除，避免重复消耗 token
  const handled = new Set([
    ...(opts.checkpoint?.completed ?? []),
    ...(opts.checkpoint?.failed.map((f) => f.batchIndex) ?? []),
  ])
  const todo = batches.filter((b) => !handled.has(b.index))

  const cp: QueueCheckpoint = opts.checkpoint
    ? { ...opts.checkpoint, status: 'running', updatedAt: Date.now() }
    : makeCheckpoint(batches, config.batchChapters)

  const report = () => {
    const spentYuan = costOf(cp.inputTokens, cp.outputTokens, config.pricing, isPeakHour())
    onProgress({
      stage: cp.stage,
      totalBatches: cp.totalBatches,
      doneBatches: cp.completed.length,
      failedBatches: cp.failed.length,
      activeBatchIndexes: [...active],
      spentYuan,
      budgetYuan: config.budgetYuan,
      peak: isPeakHour(),
      startedAt: cp.startedAt,
      etaMs: estimateEta(cp, todo.length),
    })
  }

  const active = new Set<number>()
  let pausedByBudget = false
  let aborted = false
  let cursor = 0

  const worker = async () => {
    while (cursor < todo.length) {
      if (signal?.aborted) {
        aborted = true
        return
      }
      const batch = todo[cursor++]

      // 预算检查放在取任务时，这样已在飞的并发不会被硬砍
      const spent = costOf(cp.inputTokens, cp.outputTokens, config.pricing, isPeakHour())
      if (budgetExhausted(spent, config.budgetYuan)) {
        pausedByBudget = true
        return
      }

      active.add(batch.index)
      report()
      const r = await runOne(batch, config, execute, signal)
      active.delete(batch.index)

      if (r.ok) {
        cp.completed.push(batch.index)
        cp.inputTokens += r.out.inputTokens
        cp.outputTokens += r.out.outputTokens
      } else if (r.err.kind === 'aborted') {
        aborted = true
      } else {
        // 失败也要落盘：结果有缺口，UI 必须能看见
        cp.failed.push(r.err)
      }
      cp.updatedAt = Date.now()
      await onCheckpoint(cp)
      report()
    }
  }

  const n = Math.max(1, Math.min(config.concurrency, todo.length || 1))
  await Promise.all(Array.from({ length: n }, () => worker()))

  const done = cp.completed.length + cp.failed.length
  cp.status = aborted ? 'paused' : done >= cp.totalBatches || pausedByBudget ? (pausedByBudget ? 'paused' : 'done') : 'paused'
  cp.updatedAt = Date.now()
  await onCheckpoint(cp)
  report()

  return { checkpoint: cp, pausedByBudget, aborted }
}

/** 基于已完成批次的速率估算剩余时间；样本不足返回 null */
function estimateEta(cp: QueueCheckpoint, remaining: number): number | null {
  const done = cp.completed.length
  if (!done || !remaining) return null
  const perBatch = (Date.now() - cp.startedAt) / done
  return Math.round(perBatch * remaining)
}

export { progressRatio }
