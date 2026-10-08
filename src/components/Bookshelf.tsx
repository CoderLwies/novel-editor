import { useState } from 'react'
import { Plus, Trash2, BookOpen, Feather, FolderInput, FileInput } from 'lucide-react'
import { useStore, actions, bookWordCount } from '../store'
import type { Book } from '../types'
import { formatNumber } from '../utils'
import { pickDirectory, openTextFile, supportsProjectFolders } from '../fs'
import { readProjectFromDir, isProjectDir, parseSingleText, projectWordCount } from '../project'
import NewBookModal from './NewBookModal'
import OnboardModal from './OnboardModal'

const STATUS_LABEL: Record<Book['status'], string> = {
  ongoing: '连载中',
  hiatus: '暂停',
  finished: '已完结',
}

export default function Bookshelf() {
  const state = useStore()
  const [showNew, setShowNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const totalWords = state.books.reduce((s, b) => s + bookWordCount(state, b.id), 0)
  const totalChapters = state.chapters.length

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function importFolder() {
    setBusy(true)
    try {
      const dir = await pickDirectory()
      if (!dir) return
      if (!(await isProjectDir(dir))) {
        flash('所选目录不是有效的字舟项目（缺少 book.json）')
        return
      }
      const data = await readProjectFromDir(dir)
      const book = actions.importProject(data, dir)
      flash(`已导入《${book.title}》：${data.chaptersMeta.length} 章 · ${formatNumber(projectWordCount(data))} 字`)
    } catch (e) {
      flash(`导入失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function importSingleFile() {
    setBusy(true)
    try {
      const f = await openTextFile('.txt,.md,.markdown', [
        { name: '文本 / Markdown', extensions: ['txt', 'md', 'markdown'] },
      ])
      if (!f) return
      const base = f.path.replace(/\\/g, '/').split('/').pop() ?? '导入作品'
      const title = base.replace(/\.(txt|md|markdown)$/i, '')
      const data = parseSingleText(f.text, title)
      const book = actions.importProject(data)
      flash(`已导入《${book.title}》：${data.chaptersMeta.length} 章 · ${formatNumber(projectWordCount(data))} 字`)
    } catch (e) {
      flash(`导入失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bookshelf">
      <div className="bookshelf-head">
        <div className="brand-mark">
          <img className="brand-logo" src="./logo.png" alt="字舟" />
          <div>
            <div className="bookshelf-title">字舟 · 网文编辑器</div>
            <div className="bookshelf-sub">
              {state.books.length} 部作品 · {totalChapters} 章 · 累计 {formatNumber(totalWords)} 字
            </div>
          </div>
        </div>
        <div className="bookshelf-actions">
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={importSingleFile}
            title="导入单个 TXT / Markdown 文件，自动拆分为卷章"
          >
            <FileInput size={16} /> 导入 TXT/MD
          </button>
          {supportsProjectFolders && (
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={importFolder}
              title="导入之前导出的字舟项目文件夹（含 book.json）"
            >
              <FolderInput size={16} /> 导入项目目录
            </button>
          )}
          <button className="btn btn-primary" disabled={busy} onClick={() => setShowNew(true)}>
            <Plus size={17} /> 新建作品
          </button>
        </div>
      </div>

      {(state.ui.recentBookIds ?? []).length > 0 && (
        <div className="recent-row">
          <span className="lbl" style={{ marginRight: 2 }}>最近打开</span>
          {(state.ui.recentBookIds ?? []).map((id) => {
            const b = state.books.find((x) => x.id === id)
            return b ? (
              <button key={id} className="ol-chip" onClick={() => actions.openBook(id, null)}>
                {b.title}
              </button>
            ) : null
          })}
        </div>
      )}

      <div className="book-grid">
        {state.books.map((b) => {
          const words = bookWordCount(state, b.id)
          const chCount = state.chapters.filter((c) => c.bookId === b.id).length
          const goal = b.dailyGoal * 30
          const pct = Math.min(100, Math.round((words / goal) * 100))
          return (
            <div
              key={b.id}
              className="book-card"
              onClick={() => actions.openBook(b.id, null)}
            >
              <button
                className="book-del"
                title="删除作品"
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`确定删除《${b.title}》及其全部章节？此操作不可撤销。`)) {
                    actions.deleteBook(b.id)
                  }
                }}
              >
                <Trash2 size={15} />
              </button>
              <div className="book-cover" style={{ background: `linear-gradient(135deg, ${b.coverColor}, ${shade(b.coverColor)})` }}>
                <div className="book-cover-title">{b.title}</div>
                <div className="book-cover-genre">{b.genre} · {b.author}</div>
              </div>
              <div className="book-meta">
                <div className="book-meta-row">
                  <span>
                    <span className={`status-dot status-${b.status}`} />
                    {STATUS_LABEL[b.status]}
                  </span>
                  <span>{chCount} 章</span>
                </div>
                <div className="book-meta-row">
                  <span>{formatNumber(words)} 字</span>
                  <span style={{ color: 'var(--text-faint)' }}>月更目标 {pct}%</span>
                </div>
                <div className="book-progress">
                  <i style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          )
        })}

        <button className="new-book-card" onClick={() => setShowNew(true)}>
          <BookOpen size={30} />
          <span style={{ fontSize: 13.5 }}>创建新的作品</span>
        </button>
      </div>

      {showNew && <NewBookModal onClose={() => setShowNew(false)} />}
      {state.ui.onboarded === false && <OnboardModal />}

      <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-faint)', fontSize: 12 }}>
        <Feather size={14} />
        {supportsProjectFolders
          ? '桌面版 · 数据保存在本地，可绑定目录落盘并导入导出'
          : '可交互前端原型 · 数据保存在本地浏览器（localStorage）'}
        <button className="icon-btn" style={{ marginLeft: 8 }} onClick={() => { if (confirm('恢复为初始示例数据？当前修改将被覆盖。')) actions.resetDemo() }}>
          重置示例数据
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, ((n >> 16) & 255) + 40)
  const g = Math.min(255, ((n >> 8) & 255) + 30)
  const b = Math.min(255, (n & 255) + 60)
  return `rgb(${r},${g},${b})`
}
