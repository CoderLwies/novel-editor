import { useMemo, useState, useEffect } from 'react'
import {
  ChevronLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Sun, Moon, Minus, Plus, HardDrive, PenLine, Table2,
} from 'lucide-react'
import { useStore, actions, volumesOf } from '../store'
import type { Book, Chapter } from '../types'
import { isElectron } from '../fs'
import { writeProjectToDir } from '../project'
import ChapterTree from './ChapterTree'
import Editor from './Editor'
import OutlineView from './OutlineView'
import SidePanel, { type SideTab } from './SidePanel'
import StatsBar from './StatsBar'
import FileMenu from './FileMenu'

export default function Workspace({ book }: { book: Book }) {
  const state = useStore()
  const [sideTab, setSideTab] = useState<SideTab>('outline')
  const [showTree, setShowTree] = useState(true)
  const [showSide, setShowSide] = useState(true)
  const [mode, setMode] = useState<'write' | 'outline'>('write')

  const volumes = useMemo(() => volumesOf(state, book.id), [state, book.id])

  const bookChapters = useMemo(
    () => state.chapters.filter((c) => c.bookId === book.id),
    [state.chapters, book.id],
  )

  // 解析当前章节：优先用已选中的，否则回退到全书第一章
  const currentChapter: Chapter | undefined = useMemo(() => {
    const sel = state.ui.lastChapterId
    if (sel && bookChapters.some((c) => c.id === sel)) {
      return bookChapters.find((c) => c.id === sel)
    }
    const volOrder = new Map(volumes.map((v, i) => [v.id, i]))
    const sorted = [...bookChapters].sort((a, b) => {
      const va = volOrder.get(a.volumeId) ?? 0
      const vb = volOrder.get(b.volumeId) ?? 0
      return va - vb || a.order - b.order
    })
    return sorted[0]
  }, [state.ui.lastChapterId, bookChapters, volumes])

  const theme = state.ui.theme
  const fontSize = state.ui.fontSize

  // 绑定目录后，内容变更防抖自动落盘
  useEffect(() => {
    if (!book.projectPath || !isElectron) return
    const t = setTimeout(() => {
      writeProjectToDir(book.projectPath as string, state, book.id).catch(() => {})
    }, 900)
    return () => clearTimeout(t)
  }, [state, book.id, book.projectPath])

  return (
    <div className="workspace">
      <div className="topbar">
        <button className="icon-btn square" title="返回书架" onClick={() => actions.closeBook()}>
          <ChevronLeft size={19} />
        </button>
        <button
          className="icon-btn square"
          title={showTree ? '隐藏目录' : '显示目录'}
          onClick={() => setShowTree((v) => !v)}
        >
          {showTree ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>

        <span className="topbar-book">{book.title}</span>
        {book.projectPath && (
          <span className="bound-badge" title={`已绑定目录：${book.projectPath}（自动同步）`}>
            <HardDrive size={13} /> 已落盘
          </span>
        )}
        {currentChapter && <span className="topbar-chapter">{currentChapter.title}</span>}

        <div className="spacer" />

        <div className="seg">
          <button
            className={`seg-btn ${mode === 'write' ? 'active' : ''}`}
            title="写作模式"
            onClick={() => setMode('write')}
          >
            <PenLine size={15} /> 写作
          </button>
          <button
            className={`seg-btn ${mode === 'outline' ? 'active' : ''}`}
            title="全书大纲表"
            onClick={() => setMode('outline')}
          >
            <Table2 size={15} /> 大纲
          </button>
        </div>

        <FileMenu book={book} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button className="icon-btn square" title="减小字号" onClick={() => actions.setFontSize(fontSize - 1)}>
            <Minus size={16} />
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-faint)', width: 34, textAlign: 'center' }}>{fontSize}px</span>
          <button className="icon-btn square" title="增大字号" onClick={() => actions.setFontSize(fontSize + 1)}>
            <Plus size={16} />
          </button>
        </div>

        <button
          className="icon-btn square"
          title={theme === 'dark' ? '切换到明亮主题' : '切换到暗黑主题'}
          onClick={() => actions.setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button
          className="icon-btn square"
          title={showSide ? '隐藏侧栏' : '显示侧栏'}
          onClick={() => setShowSide((v) => !v)}
        >
          {showSide ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>
      </div>

      <div className="ws-body">
        {showTree && <ChapterTree book={book} volumes={volumes} currentChapterId={currentChapter?.id ?? null} />}
        {mode === 'outline' ? (
          <OutlineView
            book={book}
            onOpenChapter={(id) => {
              actions.selectChapter(id)
              setMode('write')
            }}
          />
        ) : (
          <Editor chapter={currentChapter} fontSize={fontSize} />
        )}
        {showSide && <SidePanel book={book} chapter={currentChapter} tab={sideTab} onTabChange={setSideTab} />}
      </div>

      <StatsBar book={book} chapter={currentChapter} />
    </div>
  )
}
