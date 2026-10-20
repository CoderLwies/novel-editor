import { useState } from 'react'
import { ChevronRight, ChevronDown, Plus, Trash2, FilePlus2, Layers } from 'lucide-react'
import { useStore, actions, chaptersOf } from '../store'
import type { Book, Volume, AppState } from '../types'
import { countWords, formatNumber } from '../utils'
import { OS_META } from '../constants/outline'

export default function ChapterTree({
  book,
  volumes,
  currentChapterId,
}: {
  book: Book
  volumes: Volume[]
  currentChapterId: string | null
}) {
  const state: AppState = useStore()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ type: 'vol' | 'ch'; id: string } | null>(null)

  function toggleVol(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function addVolume() {
    const title = `第${volumes.length + 1}卷`
    actions.createVolume(book.id, title)
  }

  const totalWords = state.chapters
    .filter((c) => c.bookId === book.id)
    .reduce((s, c) => s + countWords(c.content), 0)

  return (
    <div className="tree">
      <div className="tree-head">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Layers size={14} /> 目录 · {formatNumber(totalWords)} 字
        </span>
        <button className="icon-btn square" title="新建分卷" onClick={addVolume}>
          <Plus size={16} />
        </button>
      </div>

      <div className="tree-scroll">
        {volumes.map((vol) => {
          const chs = chaptersOf(state, vol.id)
          const isCollapsed = collapsed.has(vol.id)
          const volWords = chs.reduce((s, c) => s + countWords(c.content), 0)
          return (
            <div className="vol-block" key={vol.id}>
              <div className="vol-head" onClick={() => toggleVol(vol.id)}>
                {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                {editing?.type === 'vol' && editing.id === vol.id ? (
                  <input
                    className="inline-edit"
                    autoFocus
                    defaultValue={vol.title}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { actions.updateVolume(vol.id, { title: e.target.value.trim() || vol.title }); setEditing(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }}
                    style={{ fontSize: 13, fontWeight: 600 }}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => { e.stopPropagation(); setEditing({ type: 'vol', id: vol.id }) }}
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title="双击重命名"
                  >
                    {vol.title}
                  </span>
                )}
                <span className="vol-count">{chs.length} 章</span>
                <button
                  className="icon-btn square"
                  style={{ width: 22, height: 22 }}
                  title="在此卷新建章节"
                  onClick={(e) => { e.stopPropagation(); const c = actions.createChapter(book.id, vol.id); actions.selectChapter(c.id) }}
                >
                  <FilePlus2 size={14} />
                </button>
              </div>

              {!isCollapsed && (
                <div>
                  {chs.map((ch) => {
                    const wc = countWords(ch.content)
                    const active = ch.id === currentChapterId
                    return (
                      <div
                        key={ch.id}
                        className={`ch-item ${active ? 'active' : ''}`}
                        onClick={() => actions.selectChapter(ch.id)}
                      >
                        <span className={`ch-status st-${ch.status}`} title={statusLabel(ch.status)} />
                        <span
                          className={`os-dot ${OS_META[ch.outlineStatus].cls}`}
                          title={`章纲：${OS_META[ch.outlineStatus].label}`}
                        />
                        {editing?.type === 'ch' && editing.id === ch.id ? (
                          <input
                            className="inline-edit"
                            autoFocus
                            defaultValue={ch.title}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => { actions.updateChapter(ch.id, { title: e.target.value.trim() || ch.title }); setEditing(null) }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }}
                            style={{ fontSize: 13 }}
                          />
                        ) : (
                          <span
                            className="ch-title"
                            onDoubleClick={(e) => { e.stopPropagation(); setEditing({ type: 'ch', id: ch.id }) }}
                            title="双击重命名"
                          >
                            {ch.title}
                          </span>
                        )}
                        <span className="ch-wc">{wc > 0 ? formatNumber(wc) : '—'}</span>
                        <button
                          className="ch-del"
                          title="删除章节"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(`删除《${ch.title}》？`)) actions.deleteChapter(ch.id)
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )
                  })}
                  {chs.length === 0 && (
                    <div style={{ padding: '6px 8px 6px 26px', fontSize: 12, color: 'var(--text-faint)' }}>
                      空卷，点击 + 新建章节
                    </div>
                  )}
                </div>
              )}

              {!isCollapsed && (
                <div style={{ padding: '2px 8px 6px 26px', display: 'flex', gap: 12 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>本卷 {formatNumber(volWords)} 字</span>
                  <button
                    className="icon-btn"
                    style={{ height: 20, padding: 0, fontSize: 11, color: 'var(--text-faint)' }}
                    title="删除本卷（含章节）"
                    onClick={() => { if (confirm(`删除《${vol.title}》及其 ${chs.length} 个章节？`)) actions.deleteVolume(vol.id) }}
                  >
                    <Trash2 size={12} /> 删卷
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {volumes.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            还没有分卷，点击上方 + 新建
          </div>
        )}
      </div>
    </div>
  )
}

function statusLabel(s: string) {
  return s === 'published' ? '已发布' : s === 'reviewing' ? '待审' : '草稿'
}
