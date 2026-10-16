import { describe, it, expect } from 'vitest'
import {
  planBatches,
  shouldRetry,
  backoffMs,
  checkpointValid,
  pendingBatches,
  estimateCost,
  progressRatio,
  costOf,
  budgetExhausted,
  isPeakHour,
  DEFAULT_QUEUE_CONFIG,
  DEFAULT_PRICING,
  type QueueCheckpoint,
  type TaskError,
} from '../aiqueue'

const mkCp = (over: Partial<QueueCheckpoint> = {}): QueueCheckpoint => ({
  refId: 'r1',
  stage: 'elements',
  batchChapters: 4,
  totalBatches: 5,
  completed: [0, 1, 2],
  failed: [],
  inputTokens: 120000,
  outputTokens: 4800,
  status: 'paused',
  startedAt: 1,
  updatedAt: 2,
  ...over,
})

describe('planBatches 批次划分', () => {
  it('按固定批大小切分，最后一批可为残缺', () => {
    const b = planBatches('r', 'elements', 10, 4)
    expect(b.map((x) => [x.fromChapter, x.toChapter])).toEqual([
      [1, 4],
      [5, 8],
      [9, 10],
    ])
    expect(b.map((x) => x.index)).toEqual([0, 1, 2])
  })

  it('批大小为 0 或负数时不产生死循环', () => {
    expect(planBatches('r', 'plot', 5, 0).length).toBe(5)
    expect(planBatches('r', 'plot', 5, -3).length).toBe(5)
  })

  it('章数为 0 时无批次', () => {
    expect(planBatches('r', 'elements', 0, 4)).toEqual([])
  })

  it('划分是纯函数：同样输入必得同样结果（断点恢复的前提）', () => {
    const a = planBatches('r', 'elements', 286, 4)
    const b = planBatches('r', 'elements', 286, 4)
    expect(a).toEqual(b)
    expect(a).toHaveLength(72) // 286/4 向上取整
  })

  it('章不重不漏地覆盖全书', () => {
    const b = planBatches('r', 'plot', 23, 5)
    const covered = new Set<number>()
    for (const x of b) for (let i = x.fromChapter; i <= x.toChapter; i++) covered.add(i)
    expect(covered.size).toBe(23)
    expect(Math.min(...covered)).toBe(1)
    expect(Math.max(...covered)).toBe(23)
  })
})

describe('错误分类与重试', () => {
  it('鉴权与主动中断不重试', () => {
    expect(shouldRetry('auth', 1, 3)).toBe(false)
    expect(shouldRetry('aborted', 1, 3)).toBe(false)
  })

  it('解析失败最多重试一次', () => {
    expect(shouldRetry('parse', 1, 3)).toBe(true)
    expect(shouldRetry('parse', 2, 3)).toBe(false)
  })

  it('网络与限流按 maxRetries 重试', () => {
    expect(shouldRetry('network', 3, 3)).toBe(true)
    expect(shouldRetry('network', 4, 3)).toBe(false)
    expect(shouldRetry('ratelimit', 1, 3)).toBe(true)
  })

  it('退避指数增长并封顶 30s', () => {
    expect(backoffMs(1, 1000)).toBe(1000)
    expect(backoffMs(2, 1000)).toBe(2000)
    expect(backoffMs(3, 1000)).toBe(4000)
    expect(backoffMs(20, 1000)).toBe(30000)
  })
})

describe('断点续跑', () => {
  const batches = planBatches('r1', 'elements', 20, 4)

  it('批大小一致时 checkpoint 有效', () => {
    expect(checkpointValid(mkCp(), 4)).toBe(true)
    expect(checkpointValid(null, 4)).toBe(false)
  })

  it('批大小变了 checkpoint 作废（批次划分变了，旧记录无意义）', () => {
    expect(checkpointValid(mkCp({ batchChapters: 4 }), 5)).toBe(false)
  })

  it('恢复时跳过已完成与已失败的批次', () => {
    const failed: TaskError[] = [{ kind: 'parse', message: 'x', batchIndex: 2, attempt: 2 }]
    const cp = mkCp({ completed: [0, 1], failed, totalBatches: 5 })
    const p = pendingBatches(batches, cp)
    // 2 已重试耗尽，不自动重跑；要重跑失败批次需显式清空 failed
    expect(p.map((b) => b.index)).toEqual([3, 4])
  })

  it('清空 failed 后失败批次会重新入队（供「重跑失败批次」用）', () => {
    const batches5 = planBatches('r1', 'elements', 20, 4)
    const failed: TaskError[] = [{ kind: 'parse', message: 'x', batchIndex: 2, attempt: 2 }]
    const cp = mkCp({ completed: [0, 1], failed, totalBatches: 5 })
    const retried = pendingBatches(batches5, { ...cp, failed: [] })
    expect(retried.map((b) => b.index)).toEqual([2, 3, 4])
  })

  it('无 checkpoint 时跑全部批次', () => {
    expect(pendingBatches(batches, null)).toHaveLength(5)
  })

  it('已全部完成时不产生待跑批次', () => {
    const cp = mkCp({ completed: [0, 1, 2, 3, 4], totalBatches: 5 })
    expect(pendingBatches(batches, cp)).toEqual([])
  })

  it('并发乱序完成也能正确跳过（按序号集合而非完成顺序）', () => {
    // 第 2 批先完成，第 0 批还在跑
    const cp = mkCp({ completed: [2], totalBatches: 5 })
    expect(pendingBatches(batches, cp).map((b) => b.index)).toEqual([0, 1, 3, 4])
  })

  it('checkpoint 损坏（完成数超过总数）视为无效', () => {
    expect(checkpointValid(mkCp({ completed: [0, 1, 2, 3, 4, 5, 6], totalBatches: 5 }), 4)).toBe(false)
  })
})

describe('计价与预算', () => {
  it('峰谷时段判定（北京时间 9-12、14-18 为高峰）', () => {
    const at = (h: number) => isPeakHour(new Date(2026, 0, 1, h, 0, 0))
    expect(at(9)).toBe(true)
    expect(at(11)).toBe(true)
    expect(at(14)).toBe(true)
    expect(at(17)).toBe(true)
    expect(at(8)).toBe(false)
    expect(at(12)).toBe(false)
    expect(at(13)).toBe(false)
    expect(at(18)).toBe(false)
    expect(at(23)).toBe(false)
    expect(at(2)).toBe(false)
  })

  it('高峰时段成本正好翻倍', () => {
    const off = costOf(1_000_000, 200_000, DEFAULT_PRICING, false)
    const peak = costOf(1_000_000, 200_000, DEFAULT_PRICING, true)
    expect(off).toBeCloseTo(1.5 + 0.9, 4) // 1.5 + 200000/1e6*4.5
    expect(peak).toBeCloseTo(off * 2, 4)
  })

  it('输入输出按各自单价计费', () => {
    const onlyIn = costOf(1_000_000, 0, DEFAULT_PRICING, false)
    const onlyOut = costOf(0, 1_000_000, DEFAULT_PRICING, false)
    expect(onlyIn).toBeCloseTo(DEFAULT_PRICING.inputPerM, 4)
    expect(onlyOut).toBeCloseTo(DEFAULT_PRICING.outputPerM, 4)
  })

  it('预算耗尽留 5% 余量，避免最后一批正好吃穿', () => {
    expect(budgetExhausted(10, null)).toBe(false)
    expect(budgetExhausted(10, 50)).toBe(false)
    expect(budgetExhausted(47.5, 50)).toBe(true)
    expect(budgetExhausted(50, 50)).toBe(true)
  })

  it('默认预算是 50 元', () => {
    expect(DEFAULT_QUEUE_CONFIG.budgetYuan).toBe(50)
  })
})

describe('成本预估', () => {
  it('286 章长篇的成本在「几毛到几块」量级，不触顶 50 元预算', () => {
    const e = estimateCost(286, 4, 3150, DEFAULT_PRICING, false)
    expect(e.batches).toBe(72)
    expect(e.costMax).toBeGreaterThan(0)
    expect(e.costMax).toBeLessThan(2)
    expect(e.costMin).toBeLessThan(e.costMax)
    expect(e.peak).toBe(false)
  })

  it('高峰时段预估翻倍且被标记', () => {
    const off = estimateCost(286, 4, 3150, DEFAULT_PRICING, false)
    const on = estimateCost(286, 4, 3150, DEFAULT_PRICING, true)
    expect(Math.abs(on.costMin - off.costMin * 2)).toBeLessThan(0.001)
    expect(on.peak).toBe(true)
  })

  it('章数翻倍则成本翻倍（按绝对误差比较，金额只有分位有效）', () => {
    const a = estimateCost(100, 4, 3000, DEFAULT_PRICING, false)
    const b = estimateCost(200, 4, 3000, DEFAULT_PRICING, false)
    expect(Math.abs(b.costMin - a.costMin * 2)).toBeLessThan(0.001)
  })

  it('批更大 → 批数更少，但总输入基本不变', () => {
    const a = estimateCost(100, 4, 3000, DEFAULT_PRICING, false)
    const b = estimateCost(100, 8, 3000, DEFAULT_PRICING, false)
    expect(b.batches).toBeLessThan(a.batches)
    expect(Math.abs(b.inputTokens - a.inputTokens) / a.inputTokens).toBeLessThan(0.2)
  })

  it('空书不产生 NaN', () => {
    const e = estimateCost(0, 4, 0, DEFAULT_PRICING, false)
    expect(Number.isFinite(e.costMin)).toBe(true)
    expect(Number.isFinite(e.costMax)).toBe(true)
  })
})

describe('进度', () => {
  const mkProg = (over = {}) => ({
    stage: 'elements' as const,
    totalBatches: 10,
    doneBatches: 8,
    failedBatches: 0,
    activeBatchIndexes: [],
    spentYuan: 0,
    budgetYuan: 50,
    peak: false,
    startedAt: 0,
    etaMs: null,
    ...over,
  })

  it('失败批次计入已处理，否则永远到不了 100%', () => {
    expect(progressRatio(mkProg({ doneBatches: 8, failedBatches: 2 }))).toBe(1)
  })

  it('进行中按已完成比例推进', () => {
    expect(progressRatio(mkProg({ doneBatches: 3, activeBatchIndexes: [3] }))).toBe(0.3)
  })

  it('空批次集进度为 0 而非 NaN', () => {
    expect(progressRatio(mkProg({ totalBatches: 0, doneBatches: 0 }))).toBe(0)
  })
})

describe('默认配置', () => {
  it('并发不是 1（串行会让 72 批跑 20 分钟以上），也不宜过高（会撞限流）', () => {
    expect(DEFAULT_QUEUE_CONFIG.concurrency).toBeGreaterThan(1)
    expect(DEFAULT_QUEUE_CONFIG.concurrency).toBeLessThanOrEqual(4)
  })

  it('默认预算是 50 元，且不无限', () => {
    expect(DEFAULT_QUEUE_CONFIG).toHaveProperty('budgetYuan')
    expect(DEFAULT_QUEUE_CONFIG.budgetYuan).toBe(50)
  })

  it('单次喂入上限明显大于一个批次的正文（避免正常批次被截断）', () => {
    expect(DEFAULT_QUEUE_CONFIG.maxCharsPerCall).toBeGreaterThan(DEFAULT_QUEUE_CONFIG.batchChapters * 3000)
  })
})
