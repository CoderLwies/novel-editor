export interface FrontmatterData {
  title?: string
  status?: string
  outlineStatus?: string
  synopsis?: string
  goal?: string
  conflict?: string
  turning?: string
  hook?: string
  pov?: string
  cast?: string[]
  foreshadowIds?: string[]
  foreshadowPayoffs?: string[]
}

function encodeScalar(v: string): string {
  if (v.includes('\n')) {
    const body = v
      .split('\n')
      .map((l) => (l ? `  ${l}` : ''))
      .join('\n')
    return `|-\n${body}`
  }
  if (v !== v.trim() || /^[\s"'>|@`#-]|: |:$/.test(v)) return JSON.stringify(v)
  return v
}

export function encodeFrontmatter(d: FrontmatterData): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(d)) {
    if (value === undefined || value === '') continue
    if (Array.isArray(value)) {
      if (value.length > 0) lines.push(`${key}: [${value.join(', ')}]`)
      continue
    }
    lines.push(`${key}: ${encodeScalar(value)}`)
  }
  if (lines.length === 0) return ''
  return `---\n${lines.join('\n')}\n---\n\n`
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s) as string
    } catch {
      return s.slice(1, -1)
    }
  }
  return s
}

/** 解析文件头部的 YAML 子集 frontmatter；无头部时 body 为原文 */
export function parseFrontmatter(text: string): { data: FrontmatterData; body: string } {
  const data: FrontmatterData = {}
  const norm = text.replace(/\r\n?/g, '\n')
  if (!norm.startsWith('---\n')) return { data, body: text }

  const lines = norm.split('\n')
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      end = i
      break
    }
  }
  if (end === -1) return { data, body: text }

  let i = 1
  while (i < end) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*): ?(.*)$/)
    if (!m) {
      i++
      continue
    }
    const key = m[1] as keyof FrontmatterData
    const val = m[2]

    if (val === '|-' || val === '|') {
      const buf: string[] = []
      i++
      while (i < end && (lines[i].startsWith('  ') || lines[i] === '')) {
        buf.push(lines[i].startsWith('  ') ? lines[i].slice(2) : '')
        i++
      }
      while (buf.length > 0 && buf[buf.length - 1] === '') buf.pop()
      ;(data[key] as string) = buf.join('\n')
      continue
    }

    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim()
      ;(data[key] as string[]) = inner ? inner.split(',').map((s) => unquote(s.trim())) : []
    } else {
      ;(data[key] as string) = unquote(val.trim())
    }
    i++
  }

  const body = lines
    .slice(end + 1)
    .join('\n')
    .replace(/^\n/, '')
  return { data, body }
}
