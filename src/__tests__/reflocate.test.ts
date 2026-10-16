import { describe, it, expect } from 'vitest'
import {
  normalizeLocate,
  checkRegression,
  bigramOverlap,
  rankCandidates,
  toCandidates,
  locatePrompt,
  CONFIDENCE_FLOOR,
  type CandidateBeat,
} from '../reflocate'

const CAND: CandidateBeat[] = [
  { beatId: 'b0', arcId: 'a1', arcTitle: '身份反转', index: 0, kind: 'setup', title: '废柴开局', signal: '当众被贬，无人出面维护', cost: '主角处境要足够惨', refTitle: '参考书A' },
  { beatId: 'b1', arcId: 'a1', arcTitle: '身份反转', index: 1, kind: 'build', title: '隐忍积累', signal: '默默忍受并暗中准备', cost: '不能立刻反击', refTitle: '参考书A' },
  { beatId: 'b2', arcId: 'a1', arcTitle: '身份反转', index: 2, kind: 'payoff', title: '当众反击', signal: '在众人面前揭穿对手，身份开始反转', cost: '必须付出代价', refTitle: '参考书A' },
  { beatId: 'b3', arcId: 'a1', arcTitle: '身份反转', index: 3, kind: 'twist', title: '身世揭晓', signal: '真实身份被公开，血亲相认', cost: '相认要有名分依据', refTitle: '参考书A' },
]

describe('normalizeLocate 结果归一', () => {
  it('正常命中原样保留', () => {
    const r = normalizeLocate({ pickedIndex: 2, confidence: 0.8, reason: '正文里有当众揭穿', passedIndexes: [0, 1] }, CAND)
    expect(r.pickedIndex).toBe(2)
    expect(r.confidence).toBe(0.8)
    expect(r.passedIndexes).toEqual([0, 1])
  })

  it('越界下标归零而不是崩溃', () => {
    expect(normalizeLocate({ pickedIndex: 99 }, CAND).pickedIndex).toBe(-1)
    expect(normalizeLocate({ pickedIndex: -5 }, CAND).pickedIndex).toBe(-1)
    expect(normalizeLocate({ pickedIndex: 1.5 }, CAND).pickedIndex).toBe(-1)
    expect(normalizeLocate({}, CAND).pickedIndex).toBe(-1)
  })

  it('未命中时置信度归零，不给虚假的高分', () => {
    const r = normalizeLocate({ pickedIndex: -1, confidence: 0.9, noneReason: '都对不上' }, CAND)
    expect(r.pickedIndex).toBe(-1)
    expect(r.confidence).toBe(0)
    expect(r.noneReason).toBe('都对不上')
  })

  it('置信度被夹在 0–1', () => {
    expect(normalizeLocate({ pickedIndex: 0, confidence: 5 }, CAND).confidence).toBe(1)
    expect(normalizeLocate({ pickedIndex: 0, confidence: -3 }, CAND).confidence).toBe(0)
    expect(normalizeLocate({ pickedIndex: 0, confidence: NaN }, CAND).confidence).toBe(0)
  })

  it('passedIndexes 越界与在命中拍之后的都被剔除', () => {
    const r = normalizeLocate({ pickedIndex: 2, passedIndexes: [-1, 99, 3, 1] }, CAND)
    expect(r.passedIndexes).toEqual([1])
  })

  it('sameAsPrevious 缺省为 false', () => {
    expect(normalizeLocate({ pickedIndex: 0 }, CAND).sameAsPrevious).toBe(false)
  })
})

describe('单调性自检', () => {
  it('命中比上次更早的一拍 → 报倒退', () => {
    const cur = normalizeLocate({ pickedIndex: 1, confidence: 0.9 }, CAND)
    const r = checkRegression({ pickedIndex: 2 }, cur)
    expect(r.regressed).toBe(true)
    expect(r.note).toContain('#2 → #1')
  })

  it('同拍或更靠后 → 不报', () => {
    expect(checkRegression({ pickedIndex: 1 }, normalizeLocate({ pickedIndex: 1 }, CAND)).regressed).toBe(false)
    expect(checkRegression({ pickedIndex: 1 }, normalizeLocate({ pickedIndex: 3 }, CAND)).regressed).toBe(false)
  })

  it('没有上次记录或上次未命中 → 不报', () => {
    expect(checkRegression(null, normalizeLocate({ pickedIndex: 0 }, CAND)).regressed).toBe(false)
    expect(checkRegression({ pickedIndex: -1 }, normalizeLocate({ pickedIndex: 0 }, CAND)).regressed).toBe(false)
  })

  it('本次未命中也不算倒退', () => {
    expect(checkRegression({ pickedIndex: 2 }, normalizeLocate({ pickedIndex: -1 }, CAND)).regressed).toBe(false)
  })
})

describe('本地粗排', () => {
  it('用词重合时得分高', () => {
    const c = '他当众被贬，无人出面维护，他站在堂下听着嘲笑。'
    expect(bigramOverlap(c, '当众被贬，无人出面维护')).toBeGreaterThan(0.5)
  })

  it('完全无关时得分接近 0', () => {
    expect(bigramOverlap('他在厨房煮了一锅粥。', '当众被贬，无人出面维护')).toBeLessThan(0.2)
  })

  it('空输入不炸', () => {
    expect(bigramOverlap('', '当众被贬')).toBe(0)
    expect(bigramOverlap('正文', '')).toBe(0)
  })

  it('候选超限时取前 N，但保持原叙事顺序', () => {
    const many: CandidateBeat[] = Array.from({ length: 30 }, (_, i) => ({
      beatId: `b${i}`, arcId: 'a', arcTitle: '线', index: i, kind: 'build',
      title: `拍${i}`, signal: i === 20 ? '当众被贬，无人出面维护' : '无关特征',
      cost: 'c', refTitle: 'r',
    }))
    const ranked = rankCandidates(many, '他当众被贬，无人出面维护。', 5)
    expect(ranked).toHaveLength(5)
    expect(ranked.some((c) => c.index === 20)).toBe(true)
    // 顺序仍是原叙事顺序（升序），不是按得分排
    const idxs = ranked.map((c) => c.index)
    expect([...idxs].sort((a, b) => a - b)).toEqual(idxs)
  })

  it('候选不足上限时原样返回', () => {
    expect(rankCandidates(CAND, '正文', 100)).toBe(CAND)
  })
})

describe('候选摊平', () => {
  it('从 arc + beats 组装候选，保留叙事线与序号', () => {
    const arcs = [{ id: 'a1', title: '身份反转', beatIds: ['b0', 'b1'] }, { id: 'a2', title: '复仇线', beatIds: ['b2'] }]
    const beats = [
      { id: 'b0', refId: 'r1', kind: 'setup' as const, title: '开局', signal: 's0', cost: 'c0' },
      { id: 'b1', refId: 'r1', kind: 'build' as const, title: '铺垫', signal: 's1', cost: 'c1' },
      { id: 'b2', refId: 'r2', kind: 'twist' as const, title: '反转', signal: 's2', cost: 'c2' },
    ]
    const c = toCandidates(arcs, beats, (id) => (id === 'r1' ? '参考书A' : '参考书B'))
    expect(c).toHaveLength(3)
    expect(c[0].arcTitle).toBe('身份反转')
    expect(c[0].index).toBe(0)
    expect(c[1].index).toBe(1)
    expect(c[2].refTitle).toBe('参考书B')
  })

  it('arc 指向不存在的 beat 时跳过而不崩', () => {
    const c = toCandidates([{ id: 'a', title: 'x', beatIds: ['missing', 'b0'] }], [
      { id: 'b0', refId: 'r', kind: 'build' as const, title: 't', signal: 's', cost: 'c' },
    ], () => 'r')
    expect(c).toHaveLength(1)
  })
})

describe('定位 prompt', () => {
  it('带上候选的可识别特征与硬性要求', () => {
    const p = locatePrompt('第65章', '正文内容', CAND, null, 10000)
    expect(p).toContain('当众被贬，无人出面维护')
    expect(p).toContain('主角处境要足够惨')
    expect(p).toContain('参考书A')
    expect(p).toContain('身份反转')
  })

  it('给了上次定位时会问是否同一拍', () => {
    const p = locatePrompt('第65章', '正文', CAND, { pickedIndex: 2, title: '当众反击' }, 10000)
    expect(p).toContain('#2「当众反击」')
    expect(p).toContain('sameAsPrevious')
  })

  it('明确要求匹配不上就说匹配不上', () => {
    const p = locatePrompt('第65章', '正文', CAND, null, 10000)
    expect(p).toContain('pickedIndex 给 -1')
    expect(p).toContain('不得虚构')
  })

  it('正文过长时掐中段', () => {
    const p = locatePrompt('第65章', '甲'.repeat(5000), CAND, null, 1000)
    expect(p).toContain('中间已省略')
    expect(p.length).toBeLessThan(4000)
  })

  it('置信度阈值是可用常量', () => {
    expect(CONFIDENCE_FLOOR).toBeGreaterThan(0)
    expect(CONFIDENCE_FLOOR).toBeLessThan(1)
  })
})
