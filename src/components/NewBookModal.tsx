import { useState } from 'react'
import { X, FolderOpen } from 'lucide-react'
import { actions } from '../store'
import { pickDirectory, supportsProjectFolders } from '../fs'
import { isProjectDir } from '../project'

const GENRES = ['玄幻奇幻', '武侠仙侠', '都市异能', '科幻未来', '历史架空', '游戏竞技', '悬疑灵异', '言情青春']
const COLORS = ['#6d5efc', '#f2762e', '#22b07d', '#e0467c', '#3aa0dd', '#8a63d2', '#d4463d', '#2fa3a3']

export default function NewBookModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('墨客')
  const [genre, setGenre] = useState(GENRES[0])
  const [color, setColor] = useState(COLORS[0])
  const [dailyGoal, setDailyGoal] = useState(4000)
  const [synopsis, setSynopsis] = useState('')
  const [dir, setDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!title.trim()) {
      alert('请填写书名')
      return
    }
    if (dir && (await isProjectDir(dir))) {
      alert('所选目录已是一个墨章项目（存在 book.json）。\n请选一个空目录，或在书架用「导入项目目录」打开它。')
      return
    }
    const book = actions.createBook({ title: title.trim(), author, genre, coverColor: color, dailyGoal, synopsis })
    if (dir) actions.setProjectPath(book.id, dir)
    actions.openBook(book.id, null)
    onClose()
  }

  async function chooseDir() {
    setBusy(true)
    try {
      const d = await pickDirectory()
      if (d) setDir(d)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          新建作品
          <button className="icon-btn square" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div>
            <label className="lbl">书名</label>
            <input className="field" autoFocus value={title} placeholder="例如：混沌神尊"
              onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </div>
          {supportsProjectFolders && (
            <div>
              <label className="lbl">存储目录（可选）</label>
              <div className="dir-row">
                <button className="btn btn-ghost" disabled={busy} onClick={chooseDir}>
                  <FolderOpen size={15} /> {dir ? '更换文件夹…' : '选择文件夹…'}
                </button>
                {dir && (
                  <>
                    <span className="dir-path" title={dir}>{dir}</span>
                    <button className="icon-btn" title="不落盘，仅存应用内" onClick={() => setDir(null)}><X size={14} /></button>
                  </>
                )}
              </div>
              <div className="hint">
                {dir ? '创建后本书将写入该目录（book.json + chapters/），并随编辑自动同步。' : '不选择则仅保存在应用内，之后可在工作台「文件」菜单绑定目录。'}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="lbl">作者</label>
              <input className="field" value={author} onChange={(e) => setAuthor(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="lbl">日更目标（字）</label>
              <input className="field" type="number" min={0} step={500} value={dailyGoal}
                onChange={(e) => setDailyGoal(Number(e.target.value) || 0)} />
            </div>
          </div>
          <div>
            <label className="lbl">题材类型</label>
            <div className="genre-row">
              {GENRES.map((g) => (
                <button key={g} className={`genre-chip ${g === genre ? 'sel' : ''}`} onClick={() => setGenre(g)}>{g}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="lbl">封面主色</label>
            <div className="color-row">
              {COLORS.map((c) => (
                <button key={c} className={`color-dot ${c === color ? 'sel' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
          <div>
            <label className="lbl">一句话简介 / 总纲</label>
            <textarea className="field" rows={3} value={synopsis} placeholder="简单描述这本书的核心设定与主线…"
              onChange={(e) => setSynopsis(e.target.value)} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>创建并开始写作</button>
        </div>
      </div>
    </div>
  )
}
