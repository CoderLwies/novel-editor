import { useMemo, useState, useEffect } from 'react'
import {
  ChevronLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Sun, Moon, Minus, Plus, HardDrive, PenLine, Table2, Sparkles, Search, Focus,
} from 'lucide-react'
import { useStore, actions, volumesOf } from '../store'
import type { Book, Chapter } from '../types'
import { isElectron } from '../fs'
import { writeProjectToDir } from '../project'
import { todayKey, formatNumber } from '../utils'
import ChapterTree from './ChapterTree'
import Editor from './Editor'
import OutlineView from './OutlineView'
import SidePanel, { type SideTab } from './SidePanel'
import StatsBar from './StatsBar'
import FileMenu from './FileMenu'
import { AiSettingsModal } from './AiModals'
import SearchModal from './SearchModal'
import Modal from './Modal'
import { onUpdaterStatus, installUpdate, updaterText } from '../updater'

export default function Workspace({ book }: { book: Book }) {
  const state = useStore()
  const [sideTab, setSideTab] = useState<SideTab>('outline')
  const [showTree, setShowTree] = useState(true)
  const [showSide, setShowSide] = useState(true)
  const [mode, setMode] = useState<'write' | 'outline'>('write')
  const [showAi, setShowAi] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [diskSync, setDiskSync] = useState<'idle' | 'syncing' | 'synced'>('idle')
  const [toast, setToast] = useState<string | null>(null)
  const [showInstall, setShowInstall] = useState(false)

  useEffect(() => {
    return onUpdaterStatus((s) => {
      setToast(updaterText(s))
      if (s.kind === 'downloaded') setShowInstall(true)
    })
  }, [])

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

  // 绑定目录后，内容变更防抖自动落盘，并给出同步状态指示
  useEffect(() => {
    if (!book.projectPath || !isElectron) return
    setDiskSync('syncing')
    const t = setTimeout(() => {
      writeProjectToDir(book.projectPath as string, state, book.id)
        .then(() => setDiskSync('synced'))
        .catch(() => setDiskSync('idle'))
    }, 900)
    return () => clearTimeout(t)
  }, [state, book.id, book.projectPath])

  // 当日码字达成日更目标时提醒一次
  const today = todayKey(new Date())
  const todayWords = state.dailyLog[today] ?? 0
  useEffect(() => {
    if (todayWords < book.dailyGoal || state.ui.lastGoalToastDate === today) return
    actions.setGoalToastDate(today)
    setToast(`今日已写 ${formatNumber(todayWords)} 字，达成日更目标 ${formatNumber(book.dailyGoal)} 字`)
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [todayWords, book.dailyGoal, today, state.ui.lastGoalToastDate])

  return (
    <div className={`workspace ${focusMode ? 'focus' : ''}`}>
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
        {book.projectPath ? (
          <span
            className={`bound-badge ${diskSync === 'syncing' ? 'syncing' : ''}`}
            title={`已绑定目录：${book.projectPath}（自动同步）`}
          >
            <HardDrive size={13} /> {diskSync === 'syncing' ? '落盘同步中…' : '已落盘'}
          </span>
        ) : (
          <span className="bound-badge local" title="未绑定目录，数据保存在本地">
            <HardDrive size={13} /> 本地保存
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

        <button className="icon-btn square" title="全文搜索 / 替换" onClick={() => setShowSearch(true)}>
          <Search size={17} />
        </button>
        <button
          className={`icon-btn square ${focusMode ? 'active' : ''}`}
          title={focusMode ? '退出专注模式' : '专注模式（隐藏目录与侧栏）'}
          onClick={() => setFocusMode((v) => !v)}
        >
          <Focus size={17} />
        </button>
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

        <button className="icon-btn square" title="AI 接口设置" onClick={() => setShowAi(true)}>
          <Sparkles size={17} />
        </button>

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
        {showTree && !focusMode && (
          <ChapterTree book={book} volumes={volumes} currentChapterId={currentChapter?.id ?? null} />
        )}
        {mode === 'outline' ? (
          <OutlineView
            book={book}
            onOpenChapter={(id) => {
              actions.selectChapter(id)
              setMode('write')
            }}
          />
        ) : (
          <Editor chapter={currentChapter} fontSize={fontSize} focus={focusMode} typewriter={focusMode} />
        )}
        {showSide && !focusMode && (
          <SidePanel book={book} chapter={currentChapter} tab={sideTab} onTabChange={setSideTab} />
        )}
      </div>

      <StatsBar book={book} chapter={currentChapter} />
      {showAi && <AiSettingsModal onClose={() => setShowAi(false)} />}
      {showSearch && <SearchModal book={book} onClose={() => setShowSearch(false)} />}
      {showInstall && (
        <Modal
          title="更新已就绪"
          onClose={() => setShowInstall(false)}
          width={420}
          foot={
            <>
              <button className="btn btn-ghost" onClick={() => setShowInstall(false)}>稍后</button>
              <button className="btn btn-primary" onClick={() => void installUpdate()}>重启并安装</button>
            </>
          }
        >
          <div className="hint">新版本已下载完成，重启应用后自动安装。</div>
        </Modal>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
