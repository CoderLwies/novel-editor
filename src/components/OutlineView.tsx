import { useState } from 'react'
import { GripVertical } from 'lucide-react'
import { useStore, actions, volumesOf, chaptersOf } from '../store'
import type { Book, OutlineStatus, ID } from '../types'
import { countWords, formatNumber } from '../utils'
import { OS_META } from '../constants/outline'

export default function OutlineView({ book, onOpenChapter }: { book: Book; onOpenChapter: (id: ID) => void }) {
  const state = useStore()
  const volumes = volumesOf(state, book.id)
  const [dragId, setDragId] = useState<ID | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const drop = (volumeId: ID, index: number) => {
    if (dragId) actions.moveChapter(dragId, volumeId, index)
    setDragId(null)
    setOver(null)
  }

  return (
    <div className="outline-view">
      <div className="ov-head">
        <span className="ov-title">全书大纲</span>
        <span className="ov-sub">拖拽行可排序或跨卷移动 · 点击行回到正文</span>
      </div>

      {volumes.map((v) => {
        const chs = chaptersOf(state, v.id)
        const words = chs.reduce((s, c) => s + countWords(c.content), 0)
        return (
          <div className="ov-vol" key={v.id}>
            <div
              className={`ov-vol-head ${over === `${v.id}:end` ? 'drop' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(`${v.id}:end`) }}
              onDrop={() => drop(v.id, chs.length)}
            >
              <span className="ov-vol-title">{v.title}</span>
              <span className="ov-vol-meta">{chs.length} 章 · {formatNumber(words)} 字</span>
              {v.synopsis && <span className="ov-vol-syn">{v.synopsis}</span>}
            </div>

            <div className="ov-grid ov-row-head">
              <span /> <span>章节</span> <span>视角</span> <span>主要冲突</span> <span>结尾钩子</span> <span>纲状态</span> <span>字数</span>
            </div>

            {chs.map((c, i) => (
              <div
                key={c.id}
                className={`ov-grid ov-row ${over === `${v.id}:${i}` ? 'drop' : ''}`}
                draggable
                onDragStart={() => setDragId(c.id)}
                onDragEnd={() => { setDragId(null); setOver(null) }}
                onDragOver={(e) => { e.preventDefault(); setOver(`${v.id}:${i}`) }}
                onDrop={() => drop(v.id, i)}
              >
                <span className="ov-grip" title="拖拽排序"><GripVertical size={13} /></span>
                <button className="ov-cell ov-name" onClick={() => onOpenChapter(c.id)} title="打开正文">
                  <span className={`os-dot ${OS_META[c.outlineStatus].cls}`} />
                  {c.title}
                </button>
                <span className="ov-cell ov-dim">{c.pov || '—'}</span>
                <span className="ov-cell ov-dim" title={c.conflict}>{c.conflict || '—'}</span>
                <span className="ov-cell ov-dim" title={c.hook}>{c.hook || '—'}</span>
                <span className="ov-cell">
                  <select
                    className="ov-select"
                    value={c.outlineStatus}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => actions.updateChapter(c.id, { outlineStatus: e.target.value as OutlineStatus })}
                  >
                    {(Object.keys(OS_META) as OutlineStatus[]).map((k) => (
                      <option key={k} value={k}>{OS_META[k].label}</option>
                    ))}
                  </select>
                </span>
                <span className="ov-cell ov-num">{formatNumber(countWords(c.content))}</span>
              </div>
            ))}

            {chs.length === 0 && <div className="ov-empty">本卷暂无章节</div>}
          </div>
        )
      })}
    </div>
  )
}
