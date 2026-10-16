import { describe, it, expect, vi } from 'vitest'
import { runQueue, makeCheckpoint, type BatchOutput } from '../aiqueue-runner'
import { planBatches, DEFAULT_QUEUE_CONFIG, type QueueCheckpoint, type QueueProgress } from '../aiqueue'
import { ElementsMerger } from '../refmerge'
import { trimForCall, elementsPrompt, SYS_EXTRACTOR, type BatchElements } from '../refprompt'

const CFG = { ...DEFAULT_QUEUE_CONFIG, concurrency: 2, retryBaseDelayMs: 1, budgetYuan: null }

describe('runQueue 执行', () => {
  const batches = planBatches('r1', 'elements', 20, 4) // 5 批

  it('全部批次被完成', async () => {
    const exec = vi.fn(async (b): Promise<BatchOutput> => ({ data: b.index, inputTokens: 100, outputTokens: 20 }))
    const cps: QueueCheckpoint[] = []
    const r = await runQueue({
      batches, config: CFG, checkpoint: null, execute: exec,
      onCheckpoint: (cp) => { cps.push({ ...cp }) },
      onProgress: () => {},
    })
    expect(r.checkpoint.completed.sort()).toEqual([0, 1, 2, 3, 4])
    expect(r.checkpoint.status).toBe('done')
    expect(exec).toHaveBeenCalledTimes(5)
    expect(cps.length).toBeGreaterThanOrEqual(5)
  })

  it('并发不超过配置值', async () => {
    let inFlight = 0
    let peak = 0
    await runQueue({
      batches, config: CFG, checkpoint: null,
      execute: async (b) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return { data: b.index, inputTokens: 1, outputTokens: 1 }
      },
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(peak).toBeLessThanOrEqual(CFG.concurrency)
    expect(peak).toBeGreaterThan(1) // 确实并发跑，不是串行
  })

  it('token 累计到 checkpoint', async () => {
    const r = await runQueue({
      batches, config: CFG, checkpoint: null,
      execute: async () => ({ data: {}, inputTokens: 1000, outputTokens: 200 }),
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(r.checkpoint.inputTokens).toBe(5000)
    expect(r.checkpoint.outputTokens).toBe(1000)
  })

  it('已完成的批次不重复执行（断点续跑）', async () => {
    const exec = vi.fn(async (b): Promise<BatchOutput> => ({ data: b.index, inputTokens: 1, outputTokens: 1 }))
    const cp: QueueCheckpoint = { ...makeCheckpoint(batches, 4), completed: [0, 1, 2], status: 'paused' }
    const r = await runQueue({
      batches, config: CFG, checkpoint: cp, execute: exec,
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(exec).toHaveBeenCalledTimes(2)
    expect(exec.mock.calls.map((c) => c[0].index).sort()).toEqual([3, 4])
    expect(r.checkpoint.completed.length).toBe(5)
  })

  it('失败的批次被记录，不静默跳过', async () => {
    const r = await runQueue({
      batches, config: { ...CFG, maxRetries: 1 }, checkpoint: null,
      execute: async (b) => {
        if (b.index === 1) {
          const e = new Error('坏了') as Error & { kind?: string }
          e.kind = 'network'
          throw e
        }
        return { data: b.index, inputTokens: 1, outputTokens: 1 }
      },
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(r.checkpoint.failed).toHaveLength(1)
    expect(r.checkpoint.failed[0].batchIndex).toBe(1)
    expect(r.checkpoint.completed.sort()).toEqual([0, 2, 3, 4])
    // 4 完成 + 1 失败 = 5 批全部处理过，状态应为 done
    expect(r.checkpoint.status).toBe('done')
  })

  it('鉴权失败不重试', async () => {
    const exec = vi.fn(async () => {
      const e = new Error('401') as Error & { kind?: string }
      e.kind = 'auth'
      throw e
    })
    await runQueue({
      batches: planBatches('r', 'elements', 4, 4), config: CFG, checkpoint: null,
      execute: exec, onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(exec).toHaveBeenCalledTimes(1) // 只试一次
  })

  it('限流会重试后成功', async () => {
    let n = 0
    const r = await runQueue({
      batches: planBatches('r', 'elements', 4, 4), config: { ...CFG, maxRetries: 3 }, checkpoint: null,
      execute: async () => {
        n++
        if (n < 2) {
          const e = new Error('429') as Error & { kind?: string }
          e.kind = 'ratelimit'
          throw e
        }
        return { data: {}, inputTokens: 1, outputTokens: 1 }
      },
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(n).toBe(2)
    expect(r.checkpoint.completed).toEqual([0])
  })

  it('预算耗尽时暂停而非终止', async () => {
    const r = await runQueue({
      batches, config: { ...CFG, budgetYuan: 0.0001 }, checkpoint: null,
      execute: async () => ({ data: {}, inputTokens: 1_000_000, outputTokens: 500_000 }),
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(r.pausedByBudget).toBe(true)
    expect(r.checkpoint.status).toBe('paused')
    expect(r.checkpoint.completed.length).toBeLessThan(batches.length)
    // 已完成的仍保留，下次能接着跑
    expect(r.checkpoint.completed.length).toBeGreaterThan(0)
  })

  it('中断时保留已完成批次', async () => {
    const ctrl = new AbortController()
    let done = 0
    const r = await runQueue({
      batches, config: CFG, checkpoint: null, signal: ctrl.signal,
      execute: async () => {
        done++
        if (done === 2) ctrl.abort()
        return { data: {}, inputTokens: 1, outputTokens: 1 }
      },
      onCheckpoint: () => {}, onProgress: () => {},
    })
    expect(r.aborted).toBe(true)
    expect(r.checkpoint.status).toBe('paused')
    expect(r.checkpoint.completed.length).toBeLessThan(5)
  })

  it('进度回调里失败批次计入分母', async () => {
    const seen: QueueProgress[] = []
    await runQueue({
      batches: planBatches('r', 'elements', 8, 2), // 4 批
      config: { ...CFG, maxRetries: 0 }, checkpoint: null,
      execute: async (b) => {
        if (b.index === 3) {
          const e = new Error('x') as Error & { kind?: string }
          e.kind = 'auth'
          throw e
        }
        return { data: {}, inputTokens: 1, outputTokens: 1 }
      },
      onCheckpoint: () => {}, onProgress: (p) => seen.push(p),
    })
    const last = seen[seen.length - 1]
    expect(last.doneBatches + last.failedBatches).toBe(4)
  })
})

describe('ElementsMerger 跨批合并', () => {
  const mk = (o: BatchElements) => o

  it('同名角色跨批合并为一人', () => {
    const m = new ElementsMerger()
    m.add(mk({ characters: [{ name: '林渊', role: '主角', personality: '隐忍' }] }), [1, 2, 3, 4])
    m.add(mk({ characters: [{ name: '林渊', ability: '剑骨' }] }), [5, 6, 7, 8])
    const out = m.finish('r1')
    expect(out.characters).toHaveLength(1)
    expect(out.characters[0].role).toBe('主角')
    expect(out.characters[0].personality).toBe('隐忍')
    expect(out.characters[0].ability).toBe('剑骨')
    expect(out.characters[0].firstChapter).toBe(1)
    expect(out.characters[0].lastChapter).toBe(8)
  })

  it('别名能对号入座（模型可能用别名当 name 报上来）', () => {
    const m = new ElementsMerger()
    m.add(mk({ characters: [{ name: '林渊', aliases: ['小林'] }] }), [1])
    m.add(mk({ characters: [{ name: '小林', ability: '剑骨' }] }), [2])
    expect(m.finish('r1').characters).toHaveLength(1)
  })

  it('后批空串不覆盖先批已有描述', () => {
    const m = new ElementsMerger()
    m.add(mk({ characters: [{ name: '林渊', background: '青云镇林家出身' }] }), [1])
    m.add(mk({ characters: [{ name: '林渊', background: '', ability: '' }] }), [2])
    expect(m.finish('r1').characters[0].background).toBe('青云镇林家出身')
  })

  it('描述取更完整的版本', () => {
    const m = new ElementsMerger()
    m.add(mk({ characters: [{ name: '林渊', background: '短' }] }), [1])
    m.add(mk({ characters: [{ name: '林渊', background: '长长长长长的背景描述' }] }), [2])
    expect(m.finish('r1').characters[0].background).toBe('长长长长长的背景描述')
  })

  it('不同名不合并（宁可让用户手动处理，也不误并）', () => {
    const m = new ElementsMerger()
    m.add(mk({ characters: [{ name: '林渊' }, { name: '林雪' }] }), [1])
    expect(m.finish('r1').characters).toHaveLength(2)
  })

  it('同名不同类别的设定不合并', () => {
    const m = new ElementsMerger()
    m.add(mk({ settings: [{ category: 'location', name: '青云镇' }] }), [1])
    m.add(mk({ settings: [{ category: 'faction', name: '青云镇' }] }), [2])
    expect(m.finish('r1').settings).toHaveLength(2)
  })

  it('伏笔：埋设取最早章，回收取最晚章，跨度能算出来', () => {
    const m = new ElementsMerger()
    m.add(mk({ foreshadows: [{ title: '父亲的失踪', plant: true }] }), [1, 2, 3, 4])
    m.add(mk({ foreshadows: [{ title: '父亲的失踪', payoff: true }] }), [20, 21, 22, 23])
    const fs = m.finish('r1').foreshadows
    expect(fs).toHaveLength(1)
    expect(fs[0].plantChapter).toBe(1)
    expect(fs[0].payoffChapter).toBe(23)
    expect(fs[0].span).toBe(23)
  })

  it('跨批重复埋设取最早', () => {
    const m = new ElementsMerger()
    m.add(mk({ foreshadows: [{ title: 'X', plant: true }] }), [10, 11])
    m.add(mk({ foreshadows: [{ title: 'X', plant: true }] }), [5, 6])
    expect(m.finish('r1').foreshadows[0].plantChapter).toBe(5)
  })

  it('snapshot 给下一批当已知名单', () => {
    const m = new ElementsMerger()
    m.add(mk({ characters: [{ name: '林渊', aliases: ['小林'] }], settings: [{ category: 'location', name: '青云镇' }] }), [1])
    const snap = m.snapshot()
    expect(snap.characters).toEqual([{ name: '林渊', aliases: ['小林'] }])
    expect(snap.settings).toEqual([{ category: 'location', name: '青云镇' }])
  })

  it('空批次不产生脏数据', () => {
    const m = new ElementsMerger()
    m.add({}, [1])
    m.add({ characters: [{ name: '' }, { aliases: ['无名'] }], settings: [{ name: '' }] }, [2])
    const out = m.finish('r1')
    expect(out.characters).toHaveLength(0)
    expect(out.settings).toHaveLength(0)
  })

  it('counts 反映合并规模', () => {
    const m = new ElementsMerger()
    m.add(mk({ characters: [{ name: 'A' }, { name: 'B' }], settings: [{ category: 'item', name: '剑' }] }), [1])
    expect(m.counts).toEqual({ characters: 2, settings: 1, foreshadows: 0 })
  })
})

describe('prompt 构造', () => {
  it('超长批次掐中段保留头尾', () => {
    const r = trimForCall(['开头'.repeat(100), '结尾'.repeat(100)], 100)
    expect(r.truncated).toBe(true)
    expect(r.text).toContain('已省略')
    expect(r.text.startsWith('开头')).toBe(true)
    expect(r.text.endsWith('结尾')).toBe(true)
  })

  it('未超长时不裁剪', () => {
    const r = trimForCall(['短文本'], 1000)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe('短文本')
  })

  it('prompt 带上已知名单，让模型对号入座', () => {
    const batch = planBatches('r1', 'elements', 8, 4)[1]
    const p = elementsPrompt(
      '示例书', '玄幻',
      batch,
      [{ title: '第5章', text: '林渊走了进去。' }],
      { characters: [{ name: '林渊', aliases: ['小林'] }], settings: [] },
      10000,
    )
    expect(p).toContain('林渊(小林)')
    expect(p).toContain('不要新造同类')
    expect(p).toContain('第 5–8 章')
  })

  it('首批没有已知名单时明确说明都是新角色', () => {
    const batch = planBatches('r1', 'elements', 4, 4)[0]
    const p = elementsPrompt('示例书', '玄幻', batch, [{ title: '第1章', text: '正文' }], { characters: [], settings: [] }, 10000)
    expect(p).toContain('本批出现的人物都是新角色')
  })

  it('prompt 含反幻觉约束', () => {
    const batch = planBatches('r1', 'elements', 4, 4)[0]
    const p = elementsPrompt('示例书', '玄幻', batch, [{ title: '第1章', text: '正文' }], { characters: [], settings: [] }, 10000)
    expect(p).toContain('一律留空字符串')
    expect(p).toContain('不得从后文或常识补全')
    // 反幻觉的总约束写在 system prompt 里
    expect(SYS_EXTRACTOR).toContain('不得虚构')
    expect(SYS_EXTRACTOR).toContain('只输出符合 schema 的 JSON')
  })
})
