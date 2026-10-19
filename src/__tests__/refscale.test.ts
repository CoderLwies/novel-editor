import { describe, it, expect } from 'vitest'
import { runQueue } from '../aiqueue-runner'
import { planAllBatches, DEFAULT_QUEUE_CONFIG, costOf, type QueueProgress } from '../aiqueue'
import { ElementsMerger } from '../refmerge'

const CFG = { ...DEFAULT_QUEUE_CONFIG, concurrency: 3, retryBaseDelayMs: 1 }

/** 模拟 72 批真实规模跑一遍 */
describe('286 章规模的端到端行为', () => {
  const CH = 286
  const batches = planAllBatches('r1', 'elements', CH, 4)

  it('批次划分正确', () => {
    expect(batches).toHaveLength(72)
    expect(batches[0].fromChapter).toBe(1)
    expect(batches[71].toChapter).toBe(286)
  })

  it('全部成功时 token 累计与预算换算正确', async () => {
    // 每批输入约 1.2 万字 × 0.6 = 7200 token，输出约 800
    const r = await runQueue({
      batches, config: CFG, checkpoint: null,
      execute: async () => ({ data: {}, inputTokens: 7200, outputTokens: 800 }),
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(r.checkpoint.completed).toHaveLength(72)
    expect(r.checkpoint.inputTokens).toBe(72 * 7200)
    const spent = costOf(r.checkpoint.inputTokens, r.checkpoint.outputTokens, CFG.pricing, false)
    // 空闲时段应落在「几毛到几块」量级
    expect(spent).toBeGreaterThan(0.1)
    expect(spent).toBeLessThan(2)
  })

  it('中途失败后断点恢复不重复调用已完成批次', async () => {
    let calls = 0
    const first = await runQueue({
      batches: planAllBatches('r1', 'elements', 20, 4), // 5 批
      config: { ...CFG, maxRetries: 0 }, checkpoint: null,
      execute: async (b) => {
        calls++
        if (b.index === 3) {
          const e = new Error('限流') as Error & { kind?: string }
          e.kind = 'ratelimit'
          throw e
        }
        return { data: {}, inputTokens: 100, outputTokens: 20 }
      },
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(first.checkpoint.completed.sort()).toEqual([0, 1, 2, 4])
    expect(first.checkpoint.failed).toHaveLength(1)

    // 直接续跑：失败批次也算「已处理」，不自动重跑（避免反复烧 token）
    calls = 0
    const all = planAllBatches('r1', 'elements', 20, 4)
    const second = await runQueue({
      batches: all, config: { ...CFG, maxRetries: 0 }, checkpoint: first.checkpoint,
      execute: async () => {
        calls++
        return { data: {}, inputTokens: 100, outputTokens: 20 }
      },
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(calls).toBe(0)
    expect(second.checkpoint.completed).toHaveLength(4)

    // 显式清空 failed（即 UI 的「重跑失败批次」）后才重跑那一批
    calls = 0
    const third = await runQueue({
      batches: all, config: { ...CFG, maxRetries: 0 },
      checkpoint: { ...first.checkpoint, failed: [] },
      execute: async () => {
        calls++
        return { data: {}, inputTokens: 100, outputTokens: 20 }
      },
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(calls).toBe(1)
    expect(third.checkpoint.completed).toHaveLength(5)
  })

  it('预算耗尽暂停后可继续，且不丢失已完成批次', async () => {
    const bs = planAllBatches('r1', 'elements', 40, 4) // 10 批
    // 每批花约 0.015 元，预算 0.05 → 约 3 批后暂停
    const first = await runQueue({
      batches: bs, config: { ...CFG, budgetYuan: 0.05 }, checkpoint: null,
      execute: async () => ({ data: {}, inputTokens: 7200, outputTokens: 800 }),
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(first.pausedByBudget).toBe(true)
    const doneFirst = first.checkpoint.completed.length
    expect(doneFirst).toBeGreaterThan(0)
    expect(doneFirst).toBeLessThan(10)

    // 加预算后续跑
    const second = await runQueue({
      batches: bs, config: { ...CFG, budgetYuan: 10 }, checkpoint: first.checkpoint,
      execute: async () => ({ data: {}, inputTokens: 7200, outputTokens: 800 }),
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(second.checkpoint.completed).toHaveLength(10)
    expect(second.checkpoint.status).toBe('done')
  })

  it('进度上报单调递增，失败批次也推进进度', async () => {
    const seen: QueueProgress[] = []
    await runQueue({
      batches: planAllBatches('r1', 'elements', 12, 2), // 6 批
      config: { ...CFG, maxRetries: 0 }, checkpoint: null,
      execute: async (b) => {
        if (b.index === 4) {
          const e = new Error('x') as Error & { kind?: string }
          e.kind = 'auth'
          throw e
        }
        return { data: {}, inputTokens: 10, outputTokens: 2 }
      },
      onCheckpoint: () => {}, onProgress: (p) => seen.push({ ...p }),
    })
    const processed = seen.map((p) => p.doneBatches + p.failedBatches)
    for (let i = 1; i < processed.length; i++) {
      expect(processed[i]).toBeGreaterThanOrEqual(processed[i - 1])
    }
    expect(processed[processed.length - 1]).toBe(6)
  })
})

/** 72 批抽取结果合并成一份要素表 */
describe('72 批结果的合并', () => {
  it('主角在每批都出现，最终只有一人且字段互补', () => {
    const m = new ElementsMerger()
    for (let b = 0; b < 72; b++) {
      const from = b * 4 + 1
      m.add(
        {
          characters: [
            { name: '林渊', role: b === 0 ? '主角' : '', background: b === 0 ? '青云镇林家' : '', ability: b === 10 ? '剑骨' : '' },
            { name: `路人${b}`, role: '配角' },
          ],
          settings: b === 0 ? [{ category: 'faction', name: '镇北司', subtype: 'sect' }] : [],
          foreshadows: b === 3 ? [{ title: '身世之谜', plant: true }] : b === 40 ? [{ title: '身世之谜', payoff: true }] : [],
        },
        [from, from + 1, from + 2, from + 3],
      )
    }
    const out = m.finish('r1')
    // 主角 1 人 + 72 个路人 = 73
    expect(out.characters).toHaveLength(73)
    const hero = out.characters.find((c) => c.name === '林渊')!
    expect(hero.role).toBe('主角')
    expect(hero.background).toBe('青云镇林家')
    expect(hero.ability).toBe('剑骨')
    expect(hero.firstChapter).toBe(1)
    expect(hero.lastChapter).toBe(288)

    expect(out.settings).toHaveLength(1)
    expect(out.settings[0].subtype).toBe('sect')

    expect(out.foreshadows).toHaveLength(1)
    // 第 4 批埋设（章 13），第 41 批回收（章 164），跨度 164-13+1 = 152
    expect(out.foreshadows[0].plantChapter).toBe(13)
    expect(out.foreshadows[0].payoffChapter).toBe(164)
    expect(out.foreshadows[0].span).toBe(152)
  })

  it('snapshot 名单有上限，避免 prompt 无限膨胀', () => {
    const m = new ElementsMerger()
    for (let i = 0; i < 200; i++) m.add({ characters: [{ name: `角色${i}` }] }, [i + 1])
    const snap = m.snapshot()
    expect(snap.characters.length).toBeLessThanOrEqual(80)
    expect(snap.settings.length).toBeLessThanOrEqual(60)
  })

  it('别名跨批对号入座（模型用别名上报时不重复建人）', () => {
    const m = new ElementsMerger()
    m.add({ characters: [{ name: '林渊', aliases: ['小林', '林少'] }] }, [1])
    m.add({ characters: [{ name: '小林' }] }, [2])
    m.add({ characters: [{ name: '林少' }] }, [3])
    expect(m.finish('r1').characters).toHaveLength(1)
  })
})
