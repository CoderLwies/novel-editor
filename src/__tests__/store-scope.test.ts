import { describe, it, expect, vi } from 'vitest'
import type { Reference } from '../types'
import type { ScopeSpec } from '../aiqueue'

/**
 * 回归：分析范围与预算必须真的透传到执行层。
 *
 * 这两项都曾因「可选参数没传」而静默失效：界面按「每卷前 20 章」报价，
 * 实际却跑了全书，费用差一个量级；预算上限也传不进队列。
 * 类型检查不会报错（可选属性），只能靠这条测试守住。
 */
const seen: { scope?: ScopeSpec; explicit?: unknown; budget?: number | null }[] = []

vi.mock('../refanalysis', () => {
  const cp = () => ({
    refId: 'r',
    stage: 'elements' as const,
    batchChapters: 4,
    totalBatches: 0,
    completed: [],
    failed: [],
    inputTokens: 0,
    outputTokens: 0,
    status: 'done' as const,
    startedAt: 1,
    updatedAt: 1,
  })
  return {
    analyzeStructure: vi.fn(),
    clearFailedBatches: vi.fn(async () => 0),
    rebuildFromRaw: vi.fn(async () => ({ ok: true as const, batches: 0 })),
    runElementExtraction: vi.fn(async (_ref: Reference, opts: any) => {
      seen.push({ scope: opts.scope, explicit: opts.explicitScope, budget: opts.config?.budgetYuan })
      return {
        elements: { schemaVersion: 1, refId: 'r', computedAt: 1, characters: [], settings: [], foreshadows: [] },
        run: { checkpoint: cp(), pausedByBudget: false, aborted: false },
      }
    }),
    runPlotExtraction: vi.fn(async (_ref: Reference, opts: any) => {
      seen.push({ scope: opts.scope, explicit: opts.explicitScope, budget: opts.config?.budgetYuan })
      return {
        plot: { schemaVersion: 1, refId: 'r', computedAt: 1, beats: [], arcs: [] },
        run: { checkpoint: cp(), pausedByBudget: false, aborted: false },
        arcError: null,
      }
    }),
  }
})

const { actions } = await import('../store')

const ref: Reference = {
  id: 'ref_test',
  title: '测试书',
  author: 'x',
  genre: '玄幻',
  wordCount: 300000,
  chapterCount: 100,
  volumes: [{ title: '正文', chapterCount: 100 }],
  dir: 'D:/tmp/ref-test',
  sourceEncoding: 'utf-8',
  stage: 'scanned',
  createdAt: 1,
  updatedAt: 1,
}

describe('参考库抽取参数透传', () => {
  it('extractElements 透传 scope 与预算', async () => {
    actions.addReference(ref)
    const scope: ScopeSpec = { kind: 'perVolume', perVolume: 20 }
    await actions.extractElements('ref_test', { scope, config: { budgetYuan: 120 } })
    expect(seen.at(-1)?.scope).toEqual(scope)
    expect(seen.at(-1)?.budget).toBe(120)
  })

  it('extractPlot 透传 scope 与预算', async () => {
    const scope: ScopeSpec = { kind: 'head', head: 100 }
    await actions.extractPlot('ref_test', { scope, config: { budgetYuan: null } })
    expect(seen.at(-1)?.scope).toEqual(scope)
    expect(seen.at(-1)?.budget).toBeNull()
  })

  it('重跑失败批次时透传显式范围（不能改用当前档位）', async () => {
    const explicit = { label: '（断点范围）', ranges: [{ from: 1, to: 20 }], totalChapters: 100 }
    await actions.extractElements('ref_test', { retryFailed: true, explicitScope: explicit })
    expect(seen.at(-1)?.explicit).toEqual(explicit)
    expect(seen.at(-1)?.scope).toBeUndefined()
  })
})
