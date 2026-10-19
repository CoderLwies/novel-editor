import { describe, it, expect } from 'vitest'
import { splitReferenceText, pickChapterFiles, describeImport } from '../reference'
import { decodeBuffer } from '../fs'

describe('decodeBuffer 编码探测', () => {
  // GBK 真实字节：中文 = D6 D0 CE C4（作为 UTF-8 解码必然失败）
  const GBK_ZHONGWEN = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]).buffer

  it('合法 utf-8 直接通过', () => {
    const r = decodeBuffer(new TextEncoder().encode('第一章 甲').buffer as ArrayBuffer)
    expect(r.encoding).toBe('utf-8')
    expect(r.text).toBe('第一章 甲')
  })

  it('非法 utf-8 回退 gb18030 并正确解出中文', () => {
    const r = decodeBuffer(GBK_ZHONGWEN)
    expect(r.encoding).toBe('gb18030')
    expect(r.text).toBe('中文')
  })

  it('GBK 解出的正文能继续走拆章链路且内容无损', () => {
    const r = decodeBuffer(GBK_ZHONGWEN)
    const split = splitReferenceText(`${r.text}\n第一章 甲\n内容`)
    expect(split.chapters.map((c) => c.title)).toEqual(['引子', '第一章 甲'])
    // 关键：GBK 解出的中文原样进了正文，没有被二次破坏
    expect(split.chapters[0].content).toBe('中文')
    expect(split.chapters[1].content).toBe('内容')
  })

  it('GBK 解出的正文不是乱码（无替换字符）', () => {
    const r = decodeBuffer(GBK_ZHONGWEN)
    expect(r.text).not.toMatch(/�/)
  })
})

describe('splitReferenceText 拆卷章', () => {
  it('识别「第X章」并归入默认卷', () => {
    const r = splitReferenceText('第一章 废柴少年\n正文一\n第二章 剑骨觉醒\n正文二')
    expect(r.chapters.map((c) => c.title)).toEqual(['第一章 废柴少年', '第二章 剑骨觉醒'])
    expect(r.chapters[0].content).toBe('正文一')
    expect(r.chapters[1].content).toBe('正文二')
    expect(r.volumes).toHaveLength(1)
    expect(r.volumes[0].chapterCount).toBe(2)
  })

  it('识别「第X卷」并正确归属', () => {
    const r = splitReferenceText('第一卷 风起\n第一章 甲\n第二章 乙\n第二卷 云涌\n第三章 丙')
    expect(r.volumes.map((v) => v.title)).toEqual(['第一卷 风起', '第二卷 云涌'])
    expect(r.volumes.map((v) => v.chapterCount)).toEqual([2, 1])
    expect(r.chapters.map((c) => c.volumeIndex)).toEqual([0, 0, 1])
  })

  it('「正文 第X章」这类前缀不误判为其他', () => {
    const r = splitReferenceText('正文 第一章 入城\n甲')
    expect(r.chapters).toHaveLength(1)
    expect(r.chapters[0].title).toBe('正文 第一章 入城')
  })

  it('序章/番外/后记各自成章', () => {
    const r = splitReferenceText('序章\n甲\n第一章 乙\n番外一 丙\n后记\n丁')
    expect(r.chapters.map((c) => c.title)).toEqual(['序章', '第一章 乙', '番外一 丙', '后记'])
  })

  it('无章节标记的开头内容收为引子', () => {
    const r = splitReferenceText('很久以前……\n第一章 甲')
    expect(r.chapters.map((c) => c.title)).toEqual(['引子', '第一章 甲'])
    expect(r.chapters[0].content).toBe('很久以前……')
  })

  it('Markdown 一级标题为卷、二级为章', () => {
    const r = splitReferenceText('# 卷一\n## 第一章 甲\n正文\n## 第二章 乙')
    expect(r.volumes[0].title).toBe('卷一')
    expect(r.chapters.map((c) => c.title)).toEqual(['第一章 甲', '第二章 乙'])
  })

  it('无任何标记的纯文本兜底为单章', () => {
    const r = splitReferenceText('就是一整段没有任何标题的文字')
    expect(r.chapters).toHaveLength(1)
    expect(r.volumes[0].title).toBe('正文')
  })

  it('正文中的长行不被误判为标题', () => {
    const long = '他走进屋子，看见桌上放着一封信，那封信上写着很长很长的一段话，长到足以超过标题长度限制'
    const r = splitReferenceText(`第一章 甲\n${long}`)
    expect(r.chapters).toHaveLength(1)
    expect(r.chapters[0].content).toContain(long)
  })

  it('兼容 CRLF 与 BOM', () => {
    const r = splitReferenceText('﻿第一章 甲\r\n内容\r\n')
    expect(r.chapters[0].title).toBe('第一章 甲')
    expect(r.chapters[0].content).toBe('内容')
  })

  // 实测一部 1171 章的作品：「第一节课」「第二节晚自习」这类正文用语
  // 被当成章节切了出来。它们在网文里极其常见，不能当标题。
  it('「第一节课」这类正文用语不被误判为章节', () => {
    const text = [
      '第一章 上学',
      '第一节课开始了，他趴在桌上。',
      '第二节晚自习，他被叫了出去。',
      '第二章 回家',
      '路上遇到熟人。',
    ].join('\n')
    const r = splitReferenceText(text)
    expect(r.chapters.map((c) => c.title)).toEqual(['第一章 上学', '第二章 回家'])
    expect(r.chapters[0].content).toContain('第一节课开始了')
    expect(r.chapters[0].content).toContain('第二节晚自习')
  })

  it('「第X节」若整行极短（疑似真章节）也不切 —— 宁可漏也不错切', () => {
    const r = splitReferenceText('第一章 甲\n第二节 某\n内容')
    expect(r.chapters).toHaveLength(1)
  })

  it('Chapter N 英文写法', () => {
    const r = splitReferenceText('Chapter 1 Arrival\nbody\nChapter 2 Departure\nbody2')
    expect(r.chapters.map((c) => c.title)).toEqual(['Chapter 1 Arrival', 'Chapter 2 Departure'])
  })
})

describe('pickChapterFiles 目录导入', () => {
  it('挑出正文文件并按自然序排序', () => {
    const entries = [
      { name: '第10章.txt', isDir: false },
      { name: '第2章.txt', isDir: false },
      { name: '第1章.txt', isDir: false },
      { name: '封面.png', isDir: false },
      { name: '子目录', isDir: true },
    ]
    expect(pickChapterFiles(entries)).toEqual(['第1章.txt', '第2章.txt', '第10章.txt'])
  })
})

describe('describeImport 导入体检', () => {
  it('汇总卷章字数与编码', () => {
    const split = splitReferenceText('第一章 甲\n一二三\n第二章 乙\n一二三四五')
    const d = describeImport(split, 'gb18030')
    expect(d.chapters).toBe(2)
    expect(d.volumes).toBe(1)
    expect(d.words).toBe(8)
    expect(d.encoding).toBe('gb18030')
  })
})
