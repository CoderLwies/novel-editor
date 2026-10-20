import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import {
  ChevronLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Sun, Moon, Minus, Plus, HardDrive, PenLine, Table2, Sparkles, Search, Focus, Command, HelpCircle, X,
} from 'lucide-react'
import { useStore, actions, volumesOf } from '../store'
import type { Book } from '../types'
import { isElectron } from '../fs'
import { writeProjectToDir } from '../project'
import { todayKey, formatNumber } from '../utils'
import { useCurrentChapter } from '../hooks/useCurrentChapter'
import ChapterTree from './ChapterTree'
import SidePanel, { type SideTab } from './SidePanel'
import StatsBar from './StatsBar'
import FileMenu from './FileMenu'
import { AiSettingsModal } from './AiModals'
import SearchModal from './SearchModal'
import UnifiedSearch from './UnifiedSearch'
import HelpModal from './HelpModal'
import Modal from './Modal'
import { onUpdaterStatus, installUpdate, updaterText } from '../updater'

/**
 * 工作台外壳：顶栏、侧栏开关、各弹窗、提示与落盘。
 *
 * 写作台和大纲页共用同一套外壳（同一本书不该有两个顶栏），
 * 两者只在中间的 children 不同：写作台给 Editor，大纲页给 OutlinePage。
 * 大纲页不渲染目录树与右侧侧栏。
 */
export default function WorkspaceShell({ book, children }: { book: Book; children: ReactNode }) {
  const state = useStore()
  const [sideTab, setSideTab] = useState<SideTab>('outline')
  const [showTree, setShowTree] = useState(true)
  const [showSide, setShowSide] = useState(true)
  const [showAi, setShowAi] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [sideFilter, setSideFilter] = useState('')
  const [diskSync, setDiskSync] = useState<'idle' | 'syncing' | 'synced'>('idle')
  const [toast, setToast] = useState<string | null>(null)
  const [showInstall, setShowInstall] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const view = state.ui.view ?? 'write'
  const isOutline = view === 'outline'
  const focusMode = state.ui.focusMode ?? false
  const theme = state.ui.theme
  const fontSize = state.ui.fontSize

  const showToast = useCallback((text: string, ms = 4000) => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }, [])

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = null
    setToast(null)
  }, [])

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  useEffect(() => {
    const last = { current: null as { text: string; at: number } | null }
    return onUpdaterStatus((s) => {
      const text = updaterText(s)
      const now = Date.now()
      // 同文本 10s 内去重：避免连发/周期事件反复重置 toast 计时导致不消失
      if (last.current && last.current.text === text && now - last.current.at < 10000) return
      last.current = { text, at: now }
      // 瞬时状态（如自动检查更新时的「正在检查…」）4s 后自动消失；下载进度事件会持续刷新
      showToast(text, s.kind === 'downloaded' ? 6000 : 4000)
      if (s.kind === 'downloaded') setShowInstall(true)
    })
  }, [showToast])

  // Ctrl+K 打开统一搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowPalette(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const volumes = volumesOf(state, book.id)
  const currentChapter = useCurrentChapter(book)

  // 绑定目录后，内容变更防抖自动落盘，并给出同步状态指示。
  // 依赖只列真正进磁盘的 7 个切片：写盘内容不含 ui，
  // 否则切视图/切主题这类纯 UI 变化会白白触发一次全书重写。
  useEffect(() => {
    if (!book.projectPath || !isElectron) return
    setDiskSync('syncing')
    const t = setTimeout(() => {
      writeProjectToDir(book.projectPath as string, state, book.id)
        .then(() => setDiskSync('synced'))
        .catch(() => setDiskSync('idle'))
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.books, state.volumes, state.chapters, state.characters,
    state.settings, state.foreshadows, state.snapshots,
    book.id, book.projectPath,
  ])

  // 当日码字达成日更目标时提醒一次
  const today = todayKey(new Date())
  const todayWords = state.dailyLog[today] ?? 0
  useEffect(() => {
    if (todayWords < book.dailyGoal || state.ui.lastGoalToastDate === today) return
    actions.setGoalToastDate(today)
    showToast(`今日已写 ${formatNumber(todayWords)} 字，达成日更目标 ${formatNumber(book.dailyGoal)} 字`, 5000)
  }, [todayWords, book.dailyGoal, today, state.ui.lastGoalToastDate, showToast])

  return (
    <div className={`workspace ${focusMode ? 'focus' : ''}`}>
      <div className="topbar">
        <button className="icon-btn square" title="返回书架" onClick={() => actions.closeBook()}>
          <ChevronLeft size={19} />
        </button>
        {!isOutline && (
          <button
            className="icon-btn square"
            title={showTree ? '隐藏目录' : '显示目录'}
            onClick={() => setShowTree((v) => !v)}
          >
            {showTree ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        )}

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
        {currentChapter && !isOutline && <span className="topbar-chapter">{currentChapter.title}</span>}

        <div className="spacer" />

        <div className="seg">
          <button
            className={`seg-btn ${view === 'write' ? 'active' : ''}`}
            title="写作模式"
            onClick={() => actions.setView('write')}
          >
            <PenLine size={15} /> 写作
          </button>
          <button
            className={`seg-btn ${isOutline ? 'active' : ''}`}
            title="全书大纲表"
            onClick={() => actions.setView('outline')}
          >
            <Table2 size={15} /> 大纲
          </button>
        </div>

        <button className="icon-btn square" title="全文搜索 / 替换" onClick={() => setShowSearch(true)}>
          <Search size={17} />
        </button>
        <button className="icon-btn square" title="统一搜索 (Ctrl+K)" onClick={() => setShowPalette(true)}>
          <Command size={17} />
        </button>
        <button className="icon-btn square" title="帮助与快捷键" onClick={() => setShowHelp(true)}>
          <HelpCircle size={17} />
        </button>
        {!isOutline && (
          <button
            className={`icon-btn square ${focusMode ? 'active' : ''}`}
            title={focusMode ? '退出专注模式' : '专注模式（隐藏目录与侧栏）'}
            onClick={() => actions.setFocusMode(!focusMode)}
          >
            <Focus size={17} />
          </button>
        )}
        <FileMenu book={book} />

        {!isOutline && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button className="icon-btn square" title="减小字号" onClick={() => actions.setFontSize(fontSize - 1)}>
              <Minus size={16} />
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-faint)', width: 34, textAlign: 'center' }}>{fontSize}px</span>
            <button className="icon-btn square" title="增大字号" onClick={() => actions.setFontSize(fontSize + 1)}>
              <Plus size={16} />
            </button>
          </div>
        )}

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

        {!isOutline && (
          <button
            className="icon-btn square"
            title={showSide ? '隐藏侧栏' : '显示侧栏'}
            onClick={() => setShowSide((v) => !v)}
          >
            {showSide ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        )}
      </div>

      <div className="ws-body">
        {showTree && !focusMode && !isOutline && (
          <ChapterTree book={book} volumes={volumes} currentChapterId={currentChapter?.id ?? null} />
        )}
        {children}
        {showSide && !focusMode && !isOutline && (
          <SidePanel
            book={book}
            chapter={currentChapter}
            tab={sideTab}
            onTabChange={setSideTab}
            filter={sideFilter}
            onFilterChange={setSideFilter}
          />
        )}
      </div>

      <StatsBar book={book} chapter={currentChapter} />
      {showAi && <AiSettingsModal onClose={() => setShowAi(false)} />}
      {showSearch && <SearchModal book={book} onClose={() => setShowSearch(false)} />}
      {showPalette && (
        <UnifiedSearch
          book={book}
          onClose={() => setShowPalette(false)}
          onPickSide={(tab, name) => {
            setSideTab(tab)
            setSideFilter(name)
            setShowSide(true)
          }}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
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
      {toast && (
        <div className="toast">
          <span className="toast-text">{toast}</span>
          <button className="toast-close" onClick={dismissToast} title="关闭" aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}