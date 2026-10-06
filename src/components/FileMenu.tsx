import { useEffect, useRef, useState } from 'react'
import { FolderDown, FolderSync, HardDriveDownload, FileDown, FileText, ListTree, Unlink, RefreshCw, Book } from 'lucide-react'
import { useStore, actions } from '../store'
import type { Book as BookType } from '../types'
import { pickDirectory, saveTextFile, saveBinaryFile, supportsProjectFolders } from '../fs'
import { writeProjectToDir, exportBookTxt, exportBookMd, exportOutlineMd, exportSettingsMd, exportForeshadowMd, sanitizeFilename } from '../project'
import { buildEpub } from '../epub'
import { checkUpdate } from '../updater'

export default function FileMenu({ book }: { book: BookType }) {
  const state = useStore()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  async function run(fn: () => Promise<void>, label?: string) {
    setBusy(true)
    setOpen(false)
    try {
      await fn()
    } catch (e) {
      setToast(`失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
      void label
    }
  }

  const bindAndSync = () =>
    run(async () => {
      const dir = await pickDirectory()
      if (!dir) return
      await writeProjectToDir(dir, state, book.id)
      actions.setProjectPath(book.id, dir)
      setToast(`已绑定并同步：${dir}`)
    })

  const syncNow = () =>
    run(async () => {
      if (!book.projectPath) return bindAndSync()
      await writeProjectToDir(book.projectPath, state, book.id)
      setToast('已同步到磁盘')
    })

  const unbind = () =>
    run(async () => {
      actions.setProjectPath(book.id, undefined)
      setToast('已解除目录绑定（数据仍保存在应用内）')
    })

  const exportFolder = () =>
    run(async () => {
      const dir = await pickDirectory()
      if (!dir) return
      await writeProjectToDir(dir, state, book.id)
      setToast(`已导出项目包：${dir}`)
    })

  const exportTxt = () =>
    run(async () => {
      const r = await saveTextFile(`${sanitizeFilename(book.title)}.txt`, exportBookTxt(state, book.id), [
        { name: '文本文件', extensions: ['txt'] },
      ])
      if (r) setToast(r.downloaded ? `已下载：${r.path}` : `已导出：${r.path}`)
    })

  const exportMd = () =>
    run(async () => {
      const r = await saveTextFile(`${sanitizeFilename(book.title)}.md`, exportBookMd(state, book.id), [
        { name: 'Markdown', extensions: ['md'] },
      ])
      if (r) setToast(r.downloaded ? `已下载：${r.path}` : `已导出：${r.path}`)
    })

  const exportOutline = () =>
    run(async () => {
      const r = await saveTextFile(`${sanitizeFilename(book.title)}-大纲.md`, exportOutlineMd(state, book.id), [
        { name: 'Markdown', extensions: ['md'] },
      ])
      if (r) setToast(r.downloaded ? `已下载：${r.path}` : `已导出：${r.path}`)
    })

  const exportSettings = () =>
    run(async () => {
      const r = await saveTextFile(`${sanitizeFilename(book.title)}-设定集.md`, exportSettingsMd(state, book.id), [
        { name: 'Markdown', extensions: ['md'] },
      ])
      if (r) setToast(r.downloaded ? `已下载：${r.path}` : `已导出：${r.path}`)
    })

  const exportForeshadow = () =>
    run(async () => {
      const r = await saveTextFile(`${sanitizeFilename(book.title)}-伏笔表.md`, exportForeshadowMd(state, book.id), [
        { name: 'Markdown', extensions: ['md'] },
      ])
      if (r) setToast(r.downloaded ? `已下载：${r.path}` : `已导出：${r.path}`)
    })

  const exportEpub = () =>
    run(async () => {
      const data = await buildEpub(state, book.id)
      const r = await saveBinaryFile(`${sanitizeFilename(book.title)}.epub`, data, [
        { name: 'EPUB', extensions: ['epub'] },
      ])
      if (r) setToast(r.downloaded ? `已下载：${r.path}` : `已导出：${r.path}`)
    })

  return (
    <div className="filemenu" ref={rootRef}>
      <button className={`icon-btn ${open ? 'active' : ''}`} onClick={() => setOpen((v) => !v)} disabled={busy}>
        <FolderDown size={17} /> 文件
      </button>

      {open && (
        <div className="menu-pop">
          {book.projectPath ? (
            <>
              <div className="menu-bound" title={book.projectPath}>
                <HardDriveDownload size={13} />
                <span className="menu-bound-path">{book.projectPath}</span>
              </div>
              <button className="menu-item" onClick={syncNow}>
                <RefreshCw size={15} /> 立即同步到磁盘
              </button>
              <button className="menu-item" onClick={unbind}>
                <Unlink size={15} /> 解除目录绑定
              </button>
              <div className="menu-sep" />
            </>
          ) : (
            <button
              className="menu-item"
              disabled={!supportsProjectFolders}
              title={supportsProjectFolders ? '' : '需在桌面端使用'}
              onClick={bindAndSync}
            >
              <FolderSync size={15} /> 绑定目录并自动同步
            </button>
          )}

          <button
            className="menu-item"
            disabled={!supportsProjectFolders}
            title={supportsProjectFolders ? '' : '需在桌面端使用'}
            onClick={exportFolder}
          >
            <FolderDown size={15} /> 导出项目包（文件夹）
          </button>
          <div className="menu-sep" />
          <button className="menu-item" onClick={exportTxt}>
            <FileText size={15} /> 导出全书 TXT
          </button>
          <button className="menu-item" onClick={exportMd}>
            <FileDown size={15} /> 导出全书 Markdown
          </button>
          <button className="menu-item" onClick={exportOutline}>
            <ListTree size={15} /> 导出全书大纲 Markdown
          </button>
          <button className="menu-item" onClick={exportSettings}>
            <ListTree size={15} /> 导出设定集 Markdown
          </button>
          <button className="menu-item" onClick={exportForeshadow}>
            <ListTree size={15} /> 导出伏笔表 Markdown
          </button>
          <div className="menu-sep" />
          <button className="menu-item" onClick={exportEpub}>
            <Book size={15} /> 导出 EPUB 电子书
          </button>
          <button className="menu-item" onClick={() => { setOpen(false); void checkUpdate() }}>
            <RefreshCw size={15} /> 检查更新
          </button>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
