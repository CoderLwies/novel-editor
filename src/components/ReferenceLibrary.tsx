import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileInput, FolderInput, Trash2, BookMarked } from 'lucide-react'
import { useStore, actions } from '../store'
import type { Reference, RefStage } from '../types'
import { formatNumber } from '../utils'
import { openTextFile, pickDirectory, readTextFile, supportsProjectFolders, fsLow } from '../fs'
import {
  splitReferenceText,
  pickChapterFiles,
  writeReferenceToDir,
  describeImport,
  type SplitResult,
  type RefChapter,
} from '../reference'
import { uid } from '../utils'

/** 待确认的一次导入 */
interface PendingImport {
  title: string
  encoding: string
  split: SplitResult
  chapters: RefChapter[]
}

const STAGE_META: Record<RefStage, { label: string; cls: string }> = {
  idle: { label: '待分析', cls: 'ring-todo' },
  scanning: { label: '扫描中', cls: 'ring-run' },
  scanned: { label: '已扫描', cls: 'ring-ok' },
  reading: { label: '深读中', cls: 'ring-run' },
  done: { label: '已完成', cls: 'ring-ok' },
}

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p
}

export default function ReferenceLibrary({ onBack }: { onBack: () => void }) {
  const state = useStore()
  const refs = state.references
  const [filter, setFilter] = useState<'all' | RefStage>('all')
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [targetDir, setTargetDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  function flash(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  /* ------------------------- 导入：单个 TXT / MD ------------------------- */

  async function importFile() {
    setBusy(true)
    try {
      const f = await openTextFile('.txt,.md,.markdown', [
        { name: '文本 / Markdown', extensions: ['txt', 'md', 'markdown'] },
      ])
      if (!f) return
      const title = basename(f.path).replace(/\.(txt|md|markdown)$/i, '')
      const split = splitReferenceText(f.text)
      if (!split.chapters.length) {
        flash('没能从这份文件里拆出任何章节')
        return
      }
      setPending({ title, encoding: f.encoding, split, chapters: split.chapters })
      setTargetDir('')
    } catch (e) {
      flash(`导入失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /* ------------------------- 导入：整本书目录 ------------------------- */

  async function importDir() {
    setBusy(true)
    try {
      const dir = await pickDirectory()
      if (!dir) return
      const entries = await fsLow.readdir(dir)
      const names = pickChapterFiles(entries)
      if (!names.length) {
        flash('该目录下没有 .txt / .md 正文文件')
        return
      }
      const chapters: RefChapter[] = []
      const encodings = new Set<string>()
      for (let i = 0; i < names.length; i++) {
        const { text, encoding } = await readTextFile(`${dir}/${names[i]}`)
        encodings.add(encoding)
        chapters.push({
          index: i + 1,
          title: names[i].replace(/\.(txt|md|markdown)$/i, ''),
          content: text,
          volumeIndex: 0,
        })
      }
      // 每章一个文件即视为单卷；卷划分留给分析阶段推断
      const split: SplitResult = { volumes: [{ title: basename(dir), chapterCount: chapters.length }], chapters }
      setPending({
        title: basename(dir),
        encoding: encodings.size === 1 ? [...encodings][0] : `混合（${[...encodings].join('/')}）`,
        split,
        chapters,
      })
      setTargetDir('')
    } catch (e) {
      flash(`导入失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /* ------------------------- 确认入库 ------------------------- */

  async function confirmImport() {
    if (!pending || !targetDir) return
    setBusy(true)
    try {
      const ref = await writeReferenceToDir(
        targetDir,
        { title: pending.title, sourceEncoding: pending.encoding, volumes: pending.split.volumes, chapters: pending.chapters },
        uid('ref'),
      )
      actions.addReference(ref)
      const d = describeImport(pending.split, pending.encoding)
      setPending(null)
      flash(`已入库《${ref.title}》：${d.chapters} 章 · ${formatNumber(d.words)} 字 · 原文写入 ${targetDir}`)
    } catch (e) {
      flash(`入库失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /* ------------------------- 阶段一：结构与节奏统计 ------------------------- */

  async function analyze(refId: string) {
    setAnalyzingId(refId)
    try {
      const s = await actions.analyzeStructure(refId)
      flash(`《${refs.find((r) => r.id === refId)?.title ?? ''}》统计完成：${s.chapterCount} 章 · 平均章长 ${formatNumber(s.avgChapterWords)} 字 · ${s.rhythm.length} 个节奏窗口`)
    } catch (e) {
      flash(`统计失败：${(e as Error).message}`)
    } finally {
      setAnalyzingId(null)
    }
  }

  const shown = filter === 'all' ? refs : refs.filter((r) => r.stage === filter)
  const counts = {
    all: refs.length,
    idle: refs.filter((r) => r.stage === 'idle').length,
    scanned: refs.filter((r) => r.stage === 'scanned' || r.stage === 'done').length,
    running: refs.filter((r) => r.stage === 'scanning' || r.stage === 'reading').length,
  }

  return (
    <div className="reflib">
      <div className="reflib-head">
        <button className="icon-btn square" onClick={onBack} title="返回书架"><ArrowLeft size={16} /></button>
        <div>
          <div className="brand-title" style={{ fontSize: 15 }}>参考库</div>
          <div className="brand-sub">导入他人作品做拆解分析 · 参考书只存本地目录，不混入书架</div>
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={importFile}>
          <FileInput size={15} /> 导入 TXT / MD
        </button>
        {supportsProjectFolders && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={importDir}>
            <FolderInput size={15} /> 导入整本书目录
          </button>
        )}
      </div>

      <div className="reflib-body">
        <div className="reflib-rail">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            全部 <span className="count">{counts.all}</span>
          </button>
          <button className={filter === 'idle' ? 'active' : ''} onClick={() => setFilter('idle')}>
            待分析 <span className="count">{counts.idle}</span>
          </button>
          <button className={filter === 'scanning' ? 'active' : ''} onClick={() => setFilter('scanning')}>
            分析中 <span className="count">{counts.running}</span>
          </button>
          <button className={filter === 'scanned' ? 'active' : ''} onClick={() => setFilter('scanned')}>
            已完成 <span className="count">{counts.scanned}</span>
          </button>
        </div>

        <div className="reflib-main">
          {shown.length === 0 ? (
            <div className="reflib-empty">
              <BookMarked size={30} />
              <div className="reflib-empty-t">
                {refs.length === 0 ? '参考库还是空的' : '这个筛选下没有作品'}
              </div>
              <div className="reflib-empty-d">
                {refs.length === 0
                  ? '导入一本已完成的小说，字舟会拆好卷章、存进本地目录，之后可以对它做结构与情节拆解。'
                  : '换一个筛选看看。'}
              </div>
              {refs.length === 0 && (
                <div style={{ display: 'flex', gap: 9, marginTop: 6 }}>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={importFile}>导入 TXT / MD</button>
                  {supportsProjectFolders && (
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={importDir}>导入整本书目录</button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="reflib-grid">
              {shown.map((r) => (
                <RefCard key={r.id} ref={r} onAnalyze={analyze} analyzing={analyzingId === r.id} onRemove={() => actions.removeReference(r.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {pending && (
        <div className="veil" onClick={(e) => { if (e.target === e.currentTarget) setPending(null) }}>
          <div className="modal" style={{ width: 560 }}>
            <div className="modal-head">
              <span className="modal-title">确认导入</span>
              <span className="spacer" />
              <button className="icon-btn square" onClick={() => setPending(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="ref-row"><span className="k">书名</span><span className="v">{pending.title}</span></div>
              <div className="ref-row">
                <span className="k">识别编码</span>
                <span className="v">
                  <span className={pending.encoding === 'utf-8' ? 'chip' : 'chip chip-warn'}>{pending.encoding}</span>
                  {pending.encoding !== 'utf-8' && (
                    <span className="note" style={{ marginLeft: 8 }}>原文将以 UTF-8 重新写入目录，后续读取无损</span>
                  )}
                </span>
              </div>
              <div className="ref-row"><span className="k">拆出</span><span className="v">{pending.split.volumes.length} 卷 · {pending.chapters.length} 章 · {formatNumber(describeImport(pending.split, pending.encoding).words)} 字</span></div>

              <div className="eyebrow" style={{ margin: '16px 0 7px' }}>章节预览</div>
              <div className="ref-preview">
                {pending.chapters.slice(0, 6).map((c) => (
                  <div key={c.index} className="ref-preview-row">
                    <span className="mono" style={{ fontSize: 11, opacity: .6 }}>{String(c.index).padStart(3, '0')}</span>
                    <span className="ellip">{c.title}</span>
                    <span className="mono" style={{ fontSize: 11, opacity: .6 }}>{formatNumber(c.content.length)}</span>
                  </div>
                ))}
                {pending.chapters.length > 6 && (
                  <div className="ref-preview-row" style={{ justifyContent: 'center', opacity: .6 }}>
                    还有 {pending.chapters.length - 6} 章
                  </div>
                )}
              </div>

              <div className="eyebrow" style={{ margin: '16px 0 7px' }}>存到哪里</div>
              <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
                  const d = await pickDirectory()
                  if (d) setTargetDir(d)
                }}>选择目录</button>
                <span className="note mono ellip" style={{ flex: 1, fontSize: 11.5 }}>
                  {targetDir || '尚未选择 —— 参考书原文必须落盘，不进 localStorage'}
                </span>
              </div>
              <div className="note" style={{ marginTop: 8, fontSize: 11.5 }}>
                将写入 <span className="mono">reference.json</span> 与 <span className="mono">chapters/</span>；分析产物后续存 <span className="mono">analysis/</span>。
              </div>
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button className="btn btn-ghost" onClick={() => setPending(null)}>取消</button>
              <button className="btn btn-primary" disabled={!targetDir || busy} onClick={confirmImport}>确认入库</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function RefCard({
  ref,
  onAnalyze,
  analyzing,
  onRemove,
}: {
  ref: Reference
  onAnalyze: (id: string) => void
  analyzing: boolean
  onRemove: () => void
}) {
  const st = STAGE_META[ref.stage]
  return (
    <div className="ref-card">
      <div className="ref-card-head">
        <div className="ref-card-title">{ref.title}</div>
        <div className="ref-card-author">{ref.author} · {ref.genre}</div>
        <div className={`ref-ring ${st.cls}`}>{st.label}</div>
      </div>
      <div className="ref-card-stats">
        <div><b>{ref.chapterCount}</b><span>章</span></div>
        <div><b>{formatNumber(Math.round(ref.wordCount / 10000))}</b><span>万字</span></div>
        <div><b>{ref.volumes.length}</b><span>卷</span></div>
      </div>
      <div className="ref-card-foot">
        <span className="note ellip mono" style={{ fontSize: 11 }} title={ref.dir}>{ref.dir || '未绑定目录'}</span>
        <button className="icon-btn square" title="移出参考库（不删除磁盘文件）" onClick={onRemove}><Trash2 size={14} /></button>
      </div>
      {ref.stage === 'idle' ? (
        <div className="ref-card-act">
          <button className="btn btn-primary btn-sm" style={{ width: '100%', justifyContent: 'center' }}
            disabled={analyzing} onClick={() => onAnalyze(ref.id)}>
            {analyzing ? '统计中…' : '结构与节奏统计'}
          </button>
          <div className="ref-card-hint">纯本地计算，不花 token · 语义拆解待后续</div>
        </div>
      ) : ref.stage === 'scanned' ? (
        <div className="ref-card-act">
          <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }}
            disabled={analyzing} onClick={() => onAnalyze(ref.id)}>
            {analyzing ? '统计中…' : '重新统计'}
          </button>
          <div className="ref-card-hint">节奏与卷规模已就绪 · 要素与情节链待 AI 阶段</div>
        </div>
      ) : null}
    </div>
  )
}
