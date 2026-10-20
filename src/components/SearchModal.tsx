import { useMemo, useState } from 'react'
import Modal from './Modal'
import { useStore, actions } from '../store'
import type { Book, Chapter } from '../types'

interface Hit {
  ch: Chapter
  index: number
}

export default function SearchModal({ book, onClose }: { book: Book; onClose: () => void }) {
  const state = useStore()
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')

  const chapters = useMemo(
    () => state.chapters.filter((c) => c.bookId === book.id),
    [state.chapters, book.id],
  )

  const hits = useMemo<Hit[]>(() => {
    const q = find.trim() ? find : ''
    if (!q) return []
    const out: Hit[] = []
    for (const ch of chapters) {
      let i = ch.content.indexOf(q)
      while (i >= 0 && out.length < 200) {
        out.push({ ch, index: i })
        i = ch.content.indexOf(q, i + q.length)
      }
    }
    return out
  }, [find, chapters])

  function snippet(ch: Chapter, index: number) {
    const s = Math.max(0, index - 20)
    return `${s > 0 ? '…' : ''}${ch.content.slice(s, index + find.length + 20)}…`
  }

  function replaceAt(ch: Chapter, index: number) {
    const next = ch.content.slice(0, index) + replace + ch.content.slice(index + find.length)
    actions.updateChapter(ch.id, { content: next })
  }

  function replaceAll() {
    for (const ch of chapters) {
      if (ch.content.includes(find)) {
        actions.updateChapter(ch.id, { content: ch.content.split(find).join(replace) })
      }
    }
  }

  return (
    <Modal
      title={`全文搜索 · ${book.title}`}
      onClose={onClose}
      width={620}
      foot={
        find ? (
          <>
            <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--text-faint)' }}>
              {hits.length} 处命中（上限 200）
            </span>
            <button className="btn btn-ghost" disabled={hits.length === 0} onClick={replaceAll}>
              全部替换
            </button>
            <button className="btn btn-primary" onClick={onClose}>完成</button>
          </>
        ) : undefined
      }
    >
      <input
        className="field"
        autoFocus
        value={find}
        placeholder="搜索关键词…"
        onChange={(e) => setFind(e.target.value)}
      />
      <input
        className="field"
        value={replace}
        placeholder="替换为（留空表示删除匹配）…"
        onChange={(e) => setReplace(e.target.value)}
      />
      {find && hits.length === 0 && <div className="ai-ok">未找到匹配内容。</div>}
      {hits.map((h, i) => (
        <div className="ai-item" key={i}>
          <button
            className="ai-item-body"
            style={{ textAlign: 'left' }}
            title="点击跳转到该处"
            onClick={() => {
              actions.openChapter(h.ch.id)
              actions.requestJump(h.ch.id, h.index, find.length)
              onClose()
            }}
          >
            <span className="ai-item-title">{h.ch.title}</span>
            <span className="ai-item-desc">{snippet(h.ch, h.index)}</span>
          </button>
          <button
            className="btn btn-ghost"
            style={{ flex: '0 0 auto' }}
            disabled={!find}
            onClick={() => replaceAt(h.ch, h.index)}
          >
            替换
          </button>
        </div>
      ))}
    </Modal>
  )
}
