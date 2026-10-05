import { describe, it, expect } from 'vitest'
import { encodeFrontmatter, parseFrontmatter } from '../frontmatter'

describe('frontmatter', () => {
  it('无头部时 body 为原文', () => {
    const r = parseFrontmatter('正文无头')
    expect(r.data).toEqual({})
    expect(r.body).toBe('正文无头')
  })

  it('空数据不产生头部', () => {
    expect(encodeFrontmatter({})).toBe('')
    expect(encodeFrontmatter({ title: '', cast: [] })).toBe('')
  })

  it('标量/引号/多行块/数组往返', () => {
    const text =
      encodeFrontmatter({
        title: '第一章 冒号: 与引号',
        synopsis: '第一行\n第二行',
        cast: ['char_1', 'char_2'],
        foreshadowIds: [],
        outlineStatus: 'written',
      }) + '正文开始'
    const r = parseFrontmatter(text)
    expect(r.body).toBe('正文开始')
    expect(r.data.title).toBe('第一章 冒号: 与引号')
    expect(r.data.synopsis).toBe('第一行\n第二行')
    expect(r.data.cast).toEqual(['char_1', 'char_2'])
    expect(r.data.foreshadowIds).toBeUndefined()
    expect(r.data.outlineStatus).toBe('written')
  })
})
