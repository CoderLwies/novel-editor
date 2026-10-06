import type { AppState, ID } from './types'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
}

function xhtmlPage(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${esc(title)}</title></head>
<body>
${body}
</body>
</html>`
}

interface EpubItem {
  id: string
  href: string
  title: string
  body: string
}

/** 生成标准 EPUB3 包（mimetype 无压缩首条目 + container + OPF + nav/ncx + 各章 XHTML） */
export async function buildEpub(state: AppState, bookId: ID): Promise<Uint8Array> {
  // 懒加载 jszip：仅导出 EPUB 时拉取该 chunk，避免计入首屏主包
  const { default: JSZip } = await import('jszip')
  const book = state.books.find((b) => b.id === bookId)
  if (!book) throw new Error('作品不存在')
  const volumes = state.volumes.filter((v) => v.bookId === bookId).sort((a, b) => a.order - b.order)

  const items: EpubItem[] = []
  let n = 0
  for (const v of volumes) {
    const chs = state.chapters.filter((c) => c.volumeId === v.id).sort((a, b) => a.order - b.order)
    items.push({
      id: `vol${++n}`,
      href: `vol${n}.xhtml`,
      title: v.title,
      body: `<h1>${esc(v.title)}</h1>${v.synopsis ? `<p>${esc(v.synopsis)}</p>` : ''}`,
    })
    for (const c of chs) {
      items.push({
        id: `ch${++n}`,
        href: `ch${n}.xhtml`,
        title: c.title,
        body: `<h2>${esc(c.title)}</h2>\n${paragraphs(c.content) || '<p>（本章暂无正文）</p>'}`,
      })
    }
  }
  if (items.length === 0) throw new Error('没有可导出的章节')

  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  )
  for (const it of items) zip.file(`OEBPS/${it.href}`, xhtmlPage(it.title, it.body))

  const navLi = items.map((it) => `      <li><a href="${it.href}">${esc(it.title)}</a></li>`).join('\n')
  zip.file('OEBPS/nav.xhtml', xhtmlPage('目录', `<nav epub:type="toc"><ol>\n${navLi}\n</ol></nav>`))

  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${esc(book.id)}"/></head>
  <docTitle><text>${esc(book.title)}</text></docTitle>
  <navMap>
${items
  .map(
    (it, i) =>
    `    <navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(it.title)}</text></navLabel><content src="${it.href}"/></navPoint>`,
  )
  .join('\n')}
  </navMap>
</ncx>`,
  )

  const manifest = items
    .map((it) => `    <item id="${it.id}" href="${it.href}" media-type="application/xhtml+xml"/>`)
    .join('\n')
  const spine = items.map((it) => `    <itemref idref="${it.id}"/>`).join('\n')
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${esc(book.id)}</dc:identifier>
    <dc:title>${esc(book.title)}</dc:title>
    <dc:creator>${esc(book.author)}</dc:creator>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>`,
  )

  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' })
}
