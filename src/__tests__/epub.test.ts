import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildEpub } from '../epub'
import type { AppState } from '../types'

const state = {
  books: [{ id: 'b', title: '测试书', author: '作者', genre: 'g', synopsis: '', coverColor: '#000000', status: 'ongoing', dailyGoal: 1, createdAt: 1, updatedAt: 1 }],
  volumes: [{ id: 'v', bookId: 'b', title: '第一卷', order: 0, synopsis: '卷纲', goal: '', conflict: '' }],
  chapters: [
    { id: 'c1', bookId: 'b', volumeId: 'v', title: '第一章', content: 'hello <script> x\n\n第二段', synopsis: '', order: 0, status: 'draft', goal: '', conflict: '', turning: '', hook: '', pov: '', cast: [], foreshadowIds: [], foreshadowPayoffs: [], outlineStatus: 'written', createdAt: 1, updatedAt: 1 },
    { id: 'c2', bookId: 'b', volumeId: 'v', title: '第二章', content: '', synopsis: '', order: 1, status: 'draft', goal: '', conflict: '', turning: '', hook: '', pov: '', cast: [], foreshadowIds: [], foreshadowPayoffs: [], outlineStatus: 'plan', createdAt: 1, updatedAt: 1 },
  ],
  characters: [], settings: [], foreshadows: [], dailyLog: {},
  ui: { theme: 'dark', fontSize: 16, lastBookId: null, lastChapterId: null, jump: null, lastGoalToastDate: '' },
  ai: { baseUrl: '', apiKey: '', model: '' }, snapshots: [],
} as unknown as AppState

describe('buildEpub', () => {
  it('生成合法 EPUB3 包', async () => {
    const buf = await buildEpub(state, 'b')
    const z = await JSZip.loadAsync(buf)
    expect(await z.file('mimetype')!.async('string')).toBe('application/epub+zip')
    expect(z.file('META-INF/container.xml')).not.toBeNull()
    const opf = await z.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<dc:title>测试书</dc:title>')
    expect(opf).toContain('properties="nav"')
    const chFiles = Object.keys(z.files).filter((k) => /^OEBPS\/ch\d+\.xhtml$/.test(k))
    expect(chFiles).toHaveLength(2)
    const volFiles = Object.keys(z.files).filter((k) => /^OEBPS\/vol\d+\.xhtml$/.test(k))
    expect(volFiles).toHaveLength(1)
  })

  it('正文转义且按空段分段', async () => {
    const buf = await buildEpub(state, 'b')
    const z = await JSZip.loadAsync(buf)
    const ch1 = await z.file('OEBPS/ch2.xhtml')!.async('string')
    expect(ch1).toContain('&lt;script&gt;')
    expect(ch1).not.toContain('<script>')
    expect(ch1).toContain('<p>第二段</p>')
    const ch2 = await z.file('OEBPS/ch3.xhtml')!.async('string')
    expect(ch2).toContain('（本章暂无正文）')
  })
})
