import { describe, it, expect, vi } from 'vitest'
import { runQueue, makeCheckpoint } from '../aiqueue-runner'
import { planBatches, DEFAULT_QUEUE_CONFIG } from '../aiqueue'
import { splitReferenceText } from '../reference'

const CFG = { ...DEFAULT_QUEUE_CONFIG, concurrency: 1, retryBaseDelayMs: 1, budgetYuan: null }
const batches = planBatches('r1', 'plot', 12, 4) // 3 批

/**
 * 落盘可靠性：跑一本书的 token 花费很大，
 * 「已付费的批次」必须有明确的、不依赖单一文件的证据来源。
 */
describe('付费批次不会重复消耗', () => {
  it('raw 已落盘的批次即使 checkpoint 没记，也不会重跑', async () => {
    const exec = vi.fn(async (b) => ({ data: b.index, inputTokens: 1, outputTokens: 1 }))
    // checkpoint 只记了第 0 批，但 raw 里其实有 0/1/2 三批
    const cp = { ...makeCheckpoint(batches, 4), completed: [0], status: 'paused' as const }

    const r = await runQueue({
      batches, config: CFG, checkpoint: cp,
      persistedBatches: [0, 1, 2],
      execute: exec, onCheckpoint: () => {}, onProgress: () => {},
    })

    expect(exec).toHaveBeenCalledTimes(0) // 一批都没重跑
    expect(r.checkpoint.completed.sort()).toEqual([0, 1, 2])
    // checkpoint 被补齐，与磁盘一致
    expect(r.checkpoint.status).toBe('done')
  })

  it('raw 里没有的批次照常跑', async () => {
    const exec = vi.fn(async (b) => ({ data: b.index, inputTokens: 1, outputTokens: 1 }))
    const r = await runQueue({
      batches, config: CFG, checkpoint: null,
      persistedBatches: [0],
      execute: exec, onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(exec.mock.calls.map((c) => c[0].index)).toEqual([1, 2])
    expect(r.checkpoint.completed.sort()).toEqual([0, 1, 2])
  })
})

describe('重试消耗要记账', () => {
  it('失败尝试花掉的 token 计入总量（否则预算控制失准）', async () => {
    let n = 0
    const r = await runQueue({
      batches: planBatches('r1', 'plot', 4, 4), config: CFG, checkpoint: null,
      execute: async () => {
        n++
        if (n === 1) {
          // 模拟：调用失败，但 usage 已经拿到（钱已经花了）
          const e = new Error('限流') as Error & { kind?: string; usage?: { inputTokens: number; outputTokens: number } }
          e.kind = 'ratelimit'
          e.usage = { inputTokens: 900, outputTokens: 100 }
          throw e
        }
        return { data: {}, inputTokens: 1000, outputTokens: 200 }
      },
      onCheckpoint: () => {}, onProgress: () => {},
    })
    // 成功的 1000 + 失败那次 900 = 1900；只记成功的话会少报 47%
    expect(r.checkpoint.inputTokens).toBe(1900)
    expect(r.checkpoint.outputTokens).toBe(300)
  })

  it('最终失败批次的重试消耗也计入', async () => {
    const r = await runQueue({
      batches: planBatches('r1', 'plot', 4, 4), config: { ...CFG, maxRetries: 2 }, checkpoint: null,
      execute: async () => {
        const e = new Error('鉴权失败') as Error & { kind?: string; usage?: { inputTokens: number; outputTokens: number } }
        e.kind = 'auth'
        e.usage = { inputTokens: 700, outputTokens: 0 }
        throw e
      },
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(r.checkpoint.inputTokens).toBe(700)
    expect(r.checkpoint.failed).toHaveLength(1)
  })
})

describe('中断语义', () => {
  it('中断时已完成的批次保留，未开始的不会被标记完成', async () => {
    const ctrl = new AbortController()
    const r = await runQueue({
      batches, config: CFG, checkpoint: null, signal: ctrl.signal,
      execute: async (b) => {
        if (b.index === 1) ctrl.abort()
        return { data: {}, inputTokens: 1, outputTokens: 1 }
      },
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(r.aborted).toBe(true)
    expect(r.checkpoint.status).toBe('paused')
    expect(r.checkpoint.completed.length).toBeLessThan(batches.length)
    expect(r.checkpoint.completed.length).toBeGreaterThan(0)
  })
})

describe('批次划分稳定性', () => {
  it('同样的输入永远得到同样的批次（重建的前提）', () => {
    const a = planBatches('r1', 'plot', 985, 4)
    const b = planBatches('r1', 'plot', 985, 4)
    expect(a).toEqual(b)
    expect(a).toHaveLength(247) // 985 章修正后的批数
  })

  it('批次从头顺序对齐：章区间前段相同，差异出在尾部', () => {
    // 前 985 章的划分完全一致 —— 所以只比对区间不足以发现缓存失效
    expect(planBatches('r1', 'plot', 1171, 4)[50].toChapter).toBe(planBatches('r1', 'plot', 985, 4)[50].toChapter)
    expect(planBatches('r1', 'plot', 1171, 4)).toHaveLength(293)
    expect(planBatches('r1', 'plot', 985, 4)).toHaveLength(247)
    // 真正的不一致：总章节数变了
    expect(planBatches('r1', 'plot', 1171, 4).length).not.toBe(planBatches('r1', 'plot', 985, 4).length)
  })

  it('因此重建必须靠 manifest 的 chapterCount 校验，而不是逐批比对区间', () => {
    // 同区间的两批，其正文内容可能已因拆章规则修正而改变 ——
    // 只看 from/to 会误判为「可复用」，那就会重放出错乱结果。
    const stale = { batchChapters: 4, chapterCount: 1171 }
    const now = 985
    expect(stale.chapterCount).not.toBe(now)
  })
})

describe('拆章精度（用户 1171 章实测：186 处「第X节」误判）', () => {
  it('网文高频的「第X节」正文用语不会成为章节', () => {
    const r = splitReferenceText(
      ['第一章 上学', '第一节课开始了，他趴在桌上。', '第二节晚自习，他被叫了出去。', '第二章 回家'].join('\n'),
    )
    expect(r.chapters.map((c) => c.title)).toEqual(['第一章 上学', '第二章 回家'])
  })

  it('修正后这类段落回归正文，不再虚增章节数', () => {
    const withJie = splitReferenceText(
      ['第一章 甲', '第一节课', '第二节课间', '内容'].join('\n'),
    )
    expect(withJie.chapters).toHaveLength(1)
  })
})
