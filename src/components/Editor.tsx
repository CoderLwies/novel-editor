import { useEffect, useRef, useState } from 'react'
import { FileText, CheckCircle2 } from 'lucide-react'
import { actions } from '../store'
import type { Chapter, ChapterStatus } from '../types'
import { countWords, formatNumber, relativeTime } from '../utils'

const STATUS: { value: ChapterStatus; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'reviewing', label: '待审' },
  { value: 'published', label: '已发布' },
]

export default function Editor({
  chapter,
  fontSize,
}: {
  chapter?: Chapter
  fontSize: number
}) {
  const [content, setContent] = useState(chapter?.content ?? '')
  const [title, setTitle] = useState(chapter?.title ?? '')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const lastId = useRef<string | null>(chapter?.id ?? null)

  // 切换章节时，重置本地内容
  useEffect(() => {
    if (chapter && chapter.id !== lastId.current) {
      lastId.current = chapter.id
      setContent(chapter.content)
      setTitle(chapter.title)
      requestAnimationFrame(() => taRef.current?.focus())
    }
    if (!chapter) lastId.current = null
  }, [chapter])

  // 自动伸缩 textarea 高度
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }, [content, fontSize])

  if (!chapter) {
    return (
      <div className="editor-pane">
        <div className="editor-empty">
          <FileText size={42} strokeWidth={1.2} />
          <div>
            <div style={{ fontSize: 15, marginBottom: 6 }}>还没有章节</div>
            <div style={{ fontSize: 13 }}>在左侧目录中点击 <b>+</b> 新建第一章，开始你的创作</div>
          </div>
        </div>
      </div>
    )
  }

  const wc = countWords(content)

  function onContentChange(v: string) {
    setContent(v)
    if (chapter) actions.updateChapter(chapter.id, { content: v })
  }

  function onTitleChange(v: string) {
    setTitle(v)
    if (chapter) actions.updateChapter(chapter.id, { title: v })
  }

  return (
    <div className="editor-pane">
      <div className="editor-head">
        <input
          className="editor-title-input"
          value={title}
          placeholder="章节标题…"
          onChange={(e) => onTitleChange(e.target.value)}
        />
        <div className="editor-sub">
          <select
            className="field"
            style={{ width: 'auto', padding: '3px 8px', fontSize: 12 }}
            value={chapter.status}
            onChange={(e) => actions.updateChapter(chapter.id, { status: e.target.value as ChapterStatus })}
          >
            {STATUS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <span>{formatNumber(wc)} 字</span>
          <span>·</span>
          <span>更新于 {relativeTime(chapter.updatedAt)}</span>
          {chapter.status === 'published' && (
            <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={13} /> 已发布
            </span>
          )}
        </div>
      </div>

      <div className="editor-scroll">
        <textarea
          ref={taRef}
          className="editor-textarea"
          style={{ fontSize }}
          value={content}
          placeholder="从这里开始写下你的故事…"
          onChange={(e) => onContentChange(e.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  )
}
