import { useMemo, useState } from 'react'
import Modal from './Modal'
import { useStore, actions } from '../store'
import type { Book } from '../types'
import type { SideTab } from './SidePanel'

function Group({ label }: { label: string }) {
  return (
    <div className="side-section-label" style={{ marginTop: 12 }}>{label}</div>
  )
}

export default function UnifiedSearch({
  book,
  onClose,
  onPickSide,
}: {
  book: Book
  onClose: () => void
  onPickSide: (tab: SideTab, name: string) => void
}) {
  const state = useStore()
  const [q, setQ] = useState('')
  const kw = q.trim()

  const chapters = useMemo(() => state.chapters.filter((c) => c.bookId === book.id), [state.chapters, book.id])
  const chars = useMemo(() => state.characters.filter((c) => c.bookId === book.id), [state.characters, book.id])
  const sets = useMemo(() => state.settings.filter((c) => c.bookId === book.id), [state.settings, book.id])
  const fss = useMemo(() => state.foreshadows.filter((c) => c.bookId === book.id), [state.foreshadows, book.id])

  const titleHits = kw ? chapters.filter((c) => c.title.includes(kw)).slice(0, 8) : []
  const bodyHits = kw
    ? chapters
        .map((c) => ({ c, i: c.content.indexOf(kw) }))
        .filter((x) => x.i >= 0)
        .slice(0, 8)
    : []
  const charHits = kw
    ? chars.filter((x) => `${x.name}${(x.aliases ?? []).join('')}${x.role}`.includes(kw)).slice(0, 6)
    : []
  const setHits = kw ? sets.filter((x) => `${x.name}${x.desc}${x.status ?? ''}`.includes(kw)).slice(0, 6) : []
  const fsHits = kw ? fss.filter((x) => `${x.title}${x.detail}`.includes(kw)).slice(0, 6) : []
  const total = titleHits.length + bodyHits.length + charHits.length + setHits.length + fsHits.length

  return (
    <Modal title={`统一搜索 · ${book.title}`} onClose={onClose} width={620}>
      <input
        className="field"
        autoFocus
        value={q}
        placeholder="搜索章节标题 / 正文 / 角色 / 设定 / 伏笔…"
        onChange={(e) => setQ(e.target.value)}
      />
      {kw && total === 0 && <div className="ai-ok">没有匹配结果。</div>}

      {titleHits.length > 0 && <Group label="章节标题" />}
      {titleHits.map((c) => (
        <div className="ai-item" key={`t-${c.id}`}>
          <button
            className="ai-item-body"
            style={{ textAlign: 'left' }}
            onClick={() => {
              actions.openChapter(c.id)
              onClose()
            }}
          >
            <span className="ai-item-title">{c.title}</span>
          </button>
        </div>
      ))}

      {bodyHits.length > 0 && <Group label="正文" />}
      {bodyHits.map(({ c, i }) => (
        <div className="ai-item" key={`b-${c.id}-${i}`}>
          <button
            className="ai-item-body"
            style={{ textAlign: 'left' }}
            title="跳转到该处"
            onClick={() => {
              actions.openChapter(c.id)
              actions.requestJump(c.id, i, kw.length)
              onClose()
            }}
          >
            <span className="ai-item-title">{c.title}</span>
            <span className="ai-item-desc">
              …{c.content.slice(Math.max(0, i - 18), i + kw.length + 24)}…
            </span>
          </button>
        </div>
      ))}

      {charHits.length > 0 && <Group label="角色" />}
      {charHits.map((x) => (
        <div className="ai-item" key={`c-${x.id}`}>
          <button
            className="ai-item-body"
            style={{ textAlign: 'left' }}
            onClick={() => {
              onPickSide('characters', x.name)
              onClose()
            }}
          >
            <span className="ai-item-title">{x.name}</span>
            <span className="ai-item-desc">{x.role || '角色'}</span>
          </button>
        </div>
      ))}

      {setHits.length > 0 && <Group label="设定" />}
      {setHits.map((x) => (
        <div className="ai-item" key={`s-${x.id}`}>
          <button
            className="ai-item-body"
            style={{ textAlign: 'left' }}
            onClick={() => {
              onPickSide('settings', x.name)
              onClose()
            }}
          >
            <span className="ai-item-title">{x.name}</span>
            <span className="ai-item-desc">{x.status || '设定'}</span>
          </button>
        </div>
      ))}

      {fsHits.length > 0 && <Group label="伏笔" />}
      {fsHits.map((x) => (
        <div className="ai-item" key={`f-${x.id}`}>
          <button
            className="ai-item-body"
            style={{ textAlign: 'left' }}
            onClick={() => {
              onPickSide('foreshadow', x.title)
              onClose()
            }}
          >
            <span className="ai-item-title">{x.title}</span>
            <span className="ai-item-desc">{x.status}</span>
          </button>
        </div>
      ))}
    </Modal>
  )
}
