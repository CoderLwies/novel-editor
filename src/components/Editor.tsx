import { useEffect, useRef, useState } from 'react'
import { FileText, CheckCircle2, Undo2, Redo2, History, Loader2 } from 'lucide-react'
import { useStore, actions } from '../store'
import type { Book, Chapter, ChapterStatus } from '../types'
import { countWords, formatNumber, relativeTime } from '../utils'
import {
  aiReady, chatJSON, continuePrompt, polishPrompt, reviewPrompt, SYS_PLANNER,
  type GenContinue, type GenPolish, type GenReview,
} from '../ai'
import Modal from './Modal'

const STATUS: { value: ChapterStatus; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'reviewing', label: '待审' },
  { value: 'published', label: '已发布' },
]

export default function Editor({
  chapter,
  fontSize,
  focus,
  typewriter,
}: {
  chapter?: Chapter
  fontSize: number
  focus?: boolean
  typewriter?: boolean
}) {
  const state = useStore()
  const [content, setContent] = useState(chapter?.content ?? '')
  const [title, setTitle] = useState(chapter?.title ?? '')
  const [showHistory, setShowHistory] = useState(false)
  const [sel, setSel] = useState<{ start: number; end: number; text: string } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiResult, setAiResult] = useState<
    { kind: 'continue' | 'polish' | 'review'; text?: string; issues?: string[] } | null
  >(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastId = useRef<string | null>(chapter?.id ?? null)
  const past = useRef<string[]>([])
  const future = useRef<string[]>([])
  const lastPush = useRef(0)

  // 切换章节时，重置本地内容与撤销栈
  useEffect(() => {
    if (chapter && chapter.id !== lastId.current) {
      lastId.current = chapter.id
      setContent(chapter.content)
      setTitle(chapter.title)
      past.current = []
      future.current = []
      setCanUndo(false)
      setCanRedo(false)
      setSel(null)
      setAiResult(null)
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

  function scrollToCaret(pos: number) {
    const ta = taRef.current
    const box = scrollRef.current
    if (!ta || !box) return
    const line = ta.value.slice(0, pos).split('\n').length - 1
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || fontSize * 1.9
    box.scrollTop = Math.max(0, line * lh - box.clientHeight / 2)
  }

  // 选区跟踪：selectionchange 覆盖鼠标/键盘/程序化选区变化
  useEffect(() => {
    const onSelChange = () => {
      const ta = taRef.current
      if (!ta || document.activeElement !== ta) return
      const s = ta.selectionStart
      const en = ta.selectionEnd
      setSel(s !== en ? { start: s, end: en, text: ta.value.slice(s, en) } : null)
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => document.removeEventListener('selectionchange', onSelChange)
  }, [])

  // 搜索跳转：选中命中区间并滚动到视口中部
  const jump = state.ui.jump
  useEffect(() => {
    if (!jump || !chapter || jump.chapterId !== chapter.id) return
    requestAnimationFrame(() => {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(jump.index, jump.index + jump.length)
      scrollToCaret(jump.index)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.nonce])

  function pushHistory(prev: string) {
    const now = Date.now()
    if (now - lastPush.current < 600) return
    past.current.push(prev)
    if (past.current.length > 100) past.current.shift()
    future.current = []
    lastPush.current = now
    setCanUndo(true)
    setCanRedo(false)
  }

  function commit(v: string) {
    setContent(v)
    if (chapter) actions.updateChapter(chapter.id, { content: v })
  }

  function onContentChange(v: string) {
    pushHistory(content)
    commit(v)
  }

  function undo() {
    const prev = past.current.pop()
    if (prev === undefined || !chapter) return
    future.current.push(content)
    lastPush.current = 0
    commit(prev)
    setCanUndo(past.current.length > 0)
    setCanRedo(true)
  }

  function redo() {
    const next = future.current.pop()
    if (next === undefined || !chapter) return
    past.current.push(content)
    lastPush.current = 0
    commit(next)
    setCanUndo(true)
    setCanRedo(future.current.length > 0)
  }

  function onKey(e: React.KeyboardEvent) {
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'z') {
      e.preventDefault()
      undo()
    } else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (e.shiftKey && k === 'z'))) {
      e.preventDefault()
      redo()
    } else if (typewriter && (e.key === 'Enter' || e.key === 'Backspace' || e.key.length === 1)) {
      requestAnimationFrame(() => scrollToCaret(taRef.current?.selectionStart ?? 0))
    }
  }

  function onTitleChange(v: string) {
    setTitle(v)
    if (chapter) actions.updateChapter(chapter.id, { title: v })
  }

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
  const snaps = state.snapshots.filter((s) => s.chapterId === chapter.id).slice().reverse()
  const book: Book | undefined = state.books.find((b) => b.id === chapter.bookId)

  async function runAi(kind: 'continue' | 'polish' | 'review') {
    if (!sel || !book || !chapter) return
    setAiBusy(true)
    setAiResult(null)
    try {
      if (kind === 'continue') {
        const r = await chatJSON<GenContinue>(state.ai, SYS_PLANNER, continuePrompt(book, chapter, sel.text, content.slice(0, sel.start)))
        setAiResult({ kind, text: r.text ?? '' })
      } else if (kind === 'polish') {
        const r = await chatJSON<GenPolish>(state.ai, SYS_PLANNER, polishPrompt(sel.text))
        setAiResult({ kind, text: r.text ?? '' })
      } else {
        const r = await chatJSON<GenReview>(state.ai, SYS_PLANNER, reviewPrompt(book, chapter, sel.text))
        setAiResult({ kind, issues: r.issues ?? [] })
      }
    } catch (e) {
      setAiResult({ kind, text: `失败：${(e as Error).message}` })
    } finally {
      setAiBusy(false)
    }
  }

  function applyAi() {
    if (!aiResult || !sel || aiResult.kind === 'review') return
    pushHistory(content)
    const ins = aiResult.text ?? ''
    if (aiResult.kind === 'continue') commit(content.slice(0, sel.end) + ins + content.slice(sel.end))
    else commit(content.slice(0, sel.start) + ins + content.slice(sel.end))
    setAiResult(null)
    setSel(null)
  }

  return (
    <div className={`editor-pane ${focus ? 'focus' : ''}`}>
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
          <span className="editor-tools">
            <button className="icon-btn" title="撤销 (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
              <Undo2 size={15} />
            </button>
            <button className="icon-btn" title="重做 (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
              <Redo2 size={15} />
            </button>
            <button className="icon-btn" title="版本历史 / 快照" onClick={() => setShowHistory(true)}>
              <History size={15} />
            </button>
          </span>
          {sel && aiReady(state.ai) && (
            <span className="editor-tools">
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} disabled={aiBusy} onClick={() => runAi('continue')}>
                {aiBusy && <Loader2 size={12} className="spin" />} 续写
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} disabled={aiBusy} onClick={() => runAi('polish')}>
                润色
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} disabled={aiBusy} onClick={() => runAi('review')}>
                审查
              </button>
            </span>
          )}
        </div>
      </div>

      <div className="editor-scroll" ref={scrollRef}>
        <textarea
          ref={taRef}
          className="editor-textarea"
          style={{ fontSize }}
          value={content}
          placeholder="从这里开始写下你的故事…"
          onChange={(e) => onContentChange(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
        />
      </div>

      {showHistory && (
        <Modal title={`版本历史 · ${chapter.title}`} onClose={() => setShowHistory(false)} width={560}>
          <div className="hint">回滚前会自动为当前内容存一份快照；每章最多保留 10 份。</div>
          <button
            className="btn btn-ghost"
            onClick={() => {
              actions.saveSnapshot(chapter.id)
              setShowHistory(false)
            }}
          >
            为当前内容存快照
          </button>
          {snaps.length === 0 && <div className="ai-ok">暂无快照，点上方按钮存第一份。</div>}
          {snaps.map((s) => (
            <div className="ai-item" key={s.id}>
              <span className="ai-item-body">
                <span className="ai-item-title">
                  {new Date(s.at).toLocaleString()} · {formatNumber(countWords(s.content))} 字
                </span>
                <span className="ai-item-desc">{s.content.slice(0, 60) || '（空内容）'}</span>
              </span>
              <button
                className="btn btn-ghost"
                style={{ flex: '0 0 auto' }}
                onClick={() => {
                  actions.restoreSnapshot(s.id)
                  past.current = []
                  future.current = []
                  setCanUndo(false)
                  setCanRedo(false)
                  setContent(s.content)
                  setShowHistory(false)
                }}
              >
                回滚
              </button>
            </div>
          ))}
        </Modal>
      )}
      {aiResult && (
        <Modal
          title={aiResult.kind === 'continue' ? 'AI 续写' : aiResult.kind === 'polish' ? 'AI 润色' : 'AI 审查'}
          onClose={() => setAiResult(null)}
          width={560}
          foot={
            aiResult.kind !== 'review' ? (
              <>
                <button className="btn btn-ghost" onClick={() => setAiResult(null)}>取消</button>
                <button className="btn btn-primary" onClick={applyAi}>采用</button>
              </>
            ) : undefined
          }
        >
          {aiResult.kind === 'review' ? (
            (aiResult.issues ?? []).length === 0 ? (
              <div className="ai-ok">未发现问题。</div>
            ) : (
              (aiResult.issues ?? []).map((t, i) => (
                <div className="ai-issue" key={i}><span>{t}</span></div>
              ))
            )
          ) : (
            <textarea
              className="field"
              rows={10}
              value={aiResult.text ?? ''}
              placeholder="AI 结果…"
              onChange={(e) => setAiResult({ ...aiResult, text: e.target.value })}
            />
          )}
        </Modal>
      )}
    </div>
  )
}
