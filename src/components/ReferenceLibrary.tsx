import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileInput, FolderInput, Trash2, BookMarked, Square, RotateCcw } from 'lucide-react'
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
import { estimateCost, DEFAULT_QUEUE_CONFIG, isPeakHour, progressRatio, AI_STAGE_LABEL, OUTPUT_TOKENS_PER_BATCH, resolveScope, scopeChapterCount, SCOPE_ALL, SCOPE_HEAD, SCOPE_PER_VOLUME, type QueueProgress, type AiStage, type ScopeSpec } from '../aiqueue'
import type { RefElements, RefPlot } from '../refschema'
import { aiReady } from '../ai'
import { readReferenceAnalysis } from '../reference'
import type { RefTemplate, TemplateKind, RefStructure } from '../refschema'
import { TEMPLATE_KIND_LABEL } from '../refschema'
import type { ChecklistItem } from '../refderive'
import { buildTemplates, buildComparison, COMPARE_DIMS, bestOf, diffSummary, type RefAnalysisBundle } from '../reftemplates'
import ElementsModal from './ElementsModal'
import PlotModal from './PlotModal'

/** 待确认的一次导入 */
interface PendingImport {
  title: string
  encoding: string
  split: SplitResult
  chapters: RefChapter[]
}

/** 一次深度拆解的界面状态 */
interface RunState {
  refId: string
  /** 区分要素抽取与情节链，两者可分别跑 */
  stage: AiStage
  progress: QueueProgress | null
  abort: AbortController
  /** 完成后展示的结果 */
  result: RefElements | null
  plot: RefPlot | null
  failedBatches: number
  pausedByBudget: boolean
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
  const [confirmRef, setConfirmRef] = useState<{ ref: Reference; stage: AiStage } | null>(null)
  /** 分析档位。默认「每卷前 20 章」：长篇的价值在卷间对比，先花小钱试水 */
  const [scopeSpec, setScopeSpec] = useState<ScopeSpec>({ kind: SCOPE_PER_VOLUME, perVolume: 20 })
  const [run, setRun] = useState<RunState | null>(null)
  const [view, setView] = useState<'books' | 'templates' | 'compare'>('books')
  const [bundles, setBundles] = useState<RefAnalysisBundle[]>([])
  const [templates, setTemplates] = useState<RefTemplate[]>([])
  const [insight, setInsight] = useState<string[] | null>(null)
  /** 打开要素详情的参考书；分析产物在磁盘上，任何时候都能回看 */
  const [elementsRef, setElementsRef] = useState<Reference | null>(null)
  const [plotRef, setPlotRef] = useState<Reference | null>(null)
  const [rebuildingId, setRebuildingId] = useState<string | null>(null)

  // 各书的分析产物汇总；模板与对比全部由此**本地推导**，不再调用模型。
  // 抽成函数是为了跑完抽取后能立即重载 —— 否则卡片看不到刚跑出来的结果。
  const loadBundles = useCallback(async () => {
    const out: RefAnalysisBundle[] = []
    for (const r of state.references) {
      const structure = await readReferenceAnalysis<RefStructure>(r, 'structure')
      const plot = await readReferenceAnalysis<RefPlot>(r, 'plot')
      const elements = await readReferenceAnalysis<RefElements>(r, 'elements')
      const clStore = await readReferenceAnalysis<Record<string, ChecklistItem[]>>(r, 'checklists')
      const checklists: Record<string, ChecklistItem[]> = {}
      // 清单要与本书实际存在的设定对得上，否则会串到别的子类型上
      if (clStore && elements?.settings?.length) {
        for (const s of elements.settings) {
          const key = `${s.category}:${s.subtype || '未分类'}`
          if (clStore[key]) checklists[key] = clStore[key]
        }
      }
      if (structure || plot || elements) out.push({ ref: r, structure, plot, elements, checklists })
    }
    setBundles(out)
    setTemplates(buildTemplates(out))
  }, [state.references])

  useEffect(() => {
    let alive = true
    void (async () => {
      if (alive) await loadBundles()
    })()
    return () => {
      alive = false
    }
  }, [loadBundles])

  const tplCount = templates.length
  const bundleOf = (rid: string) => bundles.find((b) => b.ref.id === rid)
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
      void loadBundles() // 新入库，重新汇总分析产物
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

  async function analyze(ref: Reference) {
    setAnalyzingId(ref.id)
    try {
      const s = await actions.analyzeStructure(ref.id)
      await loadBundles() // 结构统计刚写盘，重载才能在卡片与卷纲面板看到
      flash(`《${refs.find((r) => r.id === ref.id)?.title ?? ''}》统计完成：${s.chapterCount} 章 · 平均章长 ${formatNumber(s.avgChapterWords)} 字 · ${s.rhythm.length} 个节奏窗口`)
    } catch (e) {
      flash(`统计失败：${(e as Error).message}`)
    } finally {
      setAnalyzingId(null)
    }
  }

  /** 从 raw/ 缓存重建，零成本。已付费的批次不该因为最后一步失败而看不见 */
  async function rebuild(ref: Reference, stage: AiStage) {
    setRebuildingId(`${ref.id}:${stage}`)
    try {
      const r = await actions.rebuildFromCache(ref.id, stage)
      if (r.ok) {
        await loadBundles()
        flash(`已从缓存重建${stage === 'plot' ? '情节链' : '要素'}：${r.batches} 批，未产生任何费用`)
      } else {
        flash(`无法重建：${r.reason}`)
      }
    } catch (e) {
      flash(`重建失败：${(e as Error).message}`)
    } finally {
      setRebuildingId(null)
    }
  }

  const shown = filter === 'all' ? refs : refs.filter((r) => r.stage === filter)

  /* ------------------------- 阶段二：深度拆解 ------------------------- */

  async function startExtraction(ref: Reference, stage: AiStage, retryFailed = false) {
    const abort = new AbortController()
    const spec = scopeSpec
    setConfirmRef(null)
    setRun({ refId: ref.id, stage, progress: null, abort, result: null, plot: null, failedBatches: 0, pausedByBudget: false })
    const onProgress = (p: QueueProgress) => setRun((prev) => (prev ? { ...prev, progress: p } : prev))
    try {
      if (stage === 'elements') {
        const { elements, run: r } = await actions.extractElements(ref.id, { signal: abort.signal, retryFailed, onProgress, scope: spec })
        await loadBundles() // 产物刚写盘，重载后卡片与要素详情才拿得到
        setRun((prev) => (prev ? { ...prev, result: elements, failedBatches: r.checkpoint.failed.length, pausedByBudget: r.pausedByBudget } : prev))
        const c = elements.characters.length
        const s = elements.settings.length
        const f = elements.foreshadows.length
        flash(
          r.pausedByBudget
            ? `预算已用尽，暂停在 ${r.checkpoint.completed.length}/${r.checkpoint.totalBatches} 批；加预算后可继续`
            : `要素抽取完成：角色 ${c} · 设定 ${s} · 伏笔 ${f}` +
              (r.checkpoint.failed.length ? `（${r.checkpoint.failed.length} 批失败，结果有缺口）` : ''),
        )
      } else {
        const { plot, run: r, arcError } = await actions.extractPlot(ref.id, { signal: abort.signal, retryFailed, onProgress, scope: spec })
        await loadBundles() // 产物刚写盘，重载后模板库与卷纲面板才拿得到
        setRun((prev) => (prev ? { ...prev, plot, failedBatches: r.checkpoint.failed.length, pausedByBudget: r.pausedByBudget } : prev))
        const sk = plot.arcs.filter((a) => a.skeleton).length
        flash(
          arcError
            ? `情节拍已保存（${plot.beats.length} 拍），但骨架生成失败：${arcError}。重新点一次「情节链拆解」只会重跑这一步，不重跑已完成的批次。`
            : r.pausedByBudget
              ? `预算已用尽，暂停在 ${r.checkpoint.completed.length}/${r.checkpoint.totalBatches} 批；加预算后可继续`
              : `情节链完成：${plot.beats.length} 拍 · ${plot.arcs.length} 条线（其中 ${sk} 条抽出骨架）` +
                (r.checkpoint.failed.length ? `（${r.checkpoint.failed.length} 批失败，结果有缺口）` : ''),
        )
      }
    } catch (e) {
      const msg = (e as Error).message
      // 中断不是错误，不弹失败提示
      if (abort.signal.aborted) flash('已中断，进度已保存，可随时继续')
      else flash(`拆解失败：${msg}`)
    } finally {
      setRun((prev) => (prev && prev.progress ? prev : null))
    }
  }

  function stopRun() {
    run?.abort.abort()
  }

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
        <div className="lib-view-tabs">
          <button className={view === 'books' ? 'on' : ''} onClick={() => setView('books')}>作品</button>
          <button className={view === 'templates' ? 'on' : ''} onClick={() => setView('templates')}>
            模板库{tplCount ? ` ${tplCount}` : ''}
          </button>
          <button className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')}>对比</button>
        </div>
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
        {view === 'books' && (
        <>
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
                <RefCard
                  key={r.id}
                  item={r}
                  onAnalyze={analyze}
                  analyzing={analyzingId === r.id}
                  onExtract={() => setConfirmRef({ ref: r, stage: 'elements' })}
                  onExtractPlot={() => setConfirmRef({ ref: r, stage: 'plot' })}
                  extracting={run?.refId === r.id && !!run.progress}
                  running={run?.refId === r.id}
                  onStop={stopRun}
                  progress={run?.refId === r.id ? run.progress : null}
                  result={run?.refId === r.id ? run.result : null}
                  plot={run?.refId === r.id ? run.plot : null}
                  failedBatches={run?.refId === r.id ? run.failedBatches : 0}
                  onRetryFailed={() => startExtraction(r, run?.stage ?? 'elements', true)}
                  rebuilding={rebuildingId}
                  onRebuild={rebuild}
                  elements={bundleOf(r.id)?.elements ?? null}
                  plotData={bundleOf(r.id)?.plot ?? null}
                  onOpenElements={() => setElementsRef(r)}
                  onOpenPlot={() => setPlotRef(r)}
                  onRemove={() => actions.removeReference(r.id)}
                />
              ))}
            </div>
          )}
        </div>
        </>
        )}

        {view === 'templates' && <TemplateView bundles={bundles} templates={templates} />}
        {view === 'compare' && <CompareView bundles={bundles} onInsight={setInsight} insight={insight} />}
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

      {confirmRef && (
        <CostConfirmModal
          refItem={confirmRef.ref}
          stage={confirmRef.stage}
          aiReady={aiReady(state.ai)}
          structure={bundleOf(confirmRef.ref.id)?.structure ?? null}
          scopeSpec={scopeSpec}
          onScopeChange={setScopeSpec}
          onCancel={() => setConfirmRef(null)}
          onConfirm={() => startExtraction(confirmRef.ref, confirmRef.stage)}
        />
      )}

      {elementsRef && <ElementsModal refItem={elementsRef} onClose={() => setElementsRef(null)} />}
      {plotRef && <PlotModal refItem={plotRef} onClose={() => setPlotRef(null)} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function RefCard({
  item,
  onAnalyze,
  analyzing,
  onExtract,
  onExtractPlot,
  extracting,
  running,
  onStop,
  progress,
  result,
  plot,
  failedBatches,
  onRetryFailed,
  elements,
  /** 磁盘上已有的情节链产物；与本次是否跑过无关 */
  plotData,
  onOpenElements,
  onOpenPlot,
  rebuilding,
  onRebuild,
  onRemove,
}: {
  /** 注意：不要叫 `ref` —— 那是 React 保留 prop，组件内部会拿不到这个对象 */
  item: Reference
  onAnalyze: (ref: Reference) => void
  analyzing: boolean
  onExtract: () => void
  onExtractPlot: () => void
  extracting: boolean
  running: boolean
  onStop: () => void
  progress: QueueProgress | null
  result: RefElements | null
  plot: RefPlot | null
  failedBatches: number
  onRetryFailed: () => void
  /** 磁盘上已有的要素产物；与本次是否跑过无关，关掉应用重开仍可查看 */
  elements: RefElements | null
  /** 磁盘上已有的情节链产物 */
  plotData: RefPlot | null
  onOpenElements: () => void
  onOpenPlot: () => void
  /** 正在从缓存重建的 key（`${refId}:${stage}`） */
  rebuilding: string | null
  onRebuild: (ref: Reference, stage: AiStage) => void
  onRemove: () => void
}) {
  const hasElements = !!elements
  const hasPlot = !!plotData
  const st = STAGE_META[item.stage]
  const pct = progress ? Math.round(progressRatio(progress) * 100) : 0
  return (
    <div className="ref-card">
      <div className="ref-card-head">
        <div className="ref-card-title">{item.title}</div>
        <div className="ref-card-author">{item.author} · {item.genre}</div>
        <div className={`ref-ring ${st.cls}`}>{st.label}</div>
      </div>
      <div className="ref-card-stats">
        <div><b>{item.chapterCount}</b><span>章</span></div>
        <div><b>{formatNumber(Math.round(item.wordCount / 10000))}</b><span>万字</span></div>
        <div><b>{item.volumes.length}</b><span>卷</span></div>
      </div>

      {/* 运行中：进度 + 中断 */}
      {extracting && progress && (
        <div className="ref-card-run">
          <div className="rcr-top">
            <span className="rcr-txt">
              第 {progress.doneBatches + progress.failedBatches} / {progress.totalBatches} 批
            </span>
            <span className="rcr-pct mono">{pct}%</span>
          </div>
          <div className="pbar"><i style={{ width: `${pct}%` }} /></div>
          <div className="rcr-meta">
            <span>已花费 ¥{progress.spentYuan.toFixed(2)}</span>
            {progress.budgetYuan !== null && <span>/ 预算 ¥{progress.budgetYuan}</span>}
            {progress.peak && <span className="rcr-peak">高峰时段</span>}
            {progress.failedBatches > 0 && <span className="rcr-fail">{progress.failedBatches} 批失败</span>}
          </div>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={onStop}>
            <Square size={13} /> 中断（进度会保留）
          </button>
        </div>
      )}

      {/* 结果概要 */}
      {(result || plot || hasElements) && !extracting && (
        <div className="ref-card-run">
          {/* 有 elements.json 就有入口 —— 与本次是否跑过无关，关掉应用重开照样能看 */}
          {hasElements && (
            <div className="rcr-result">
              <button className="rcr-kpi" onClick={onOpenElements}>
                <b>{elements?.characters.length ?? 0}</b> 角色
              </button>
              <button className="rcr-kpi" onClick={onOpenElements}>
                <b>{elements?.settings.length ?? 0}</b> 设定
              </button>
              <button className="rcr-kpi" onClick={onOpenElements}>
                <b>{elements?.foreshadows.length ?? 0}</b> 伏笔
              </button>
              <span className="rcr-hint">点击查看详情</span>
            </div>
          )}
          {/* 与要素同理：入口由磁盘上的 plot.json 决定，关掉应用重开照样可看 */}
          {hasPlot && (
            <div className="rcr-result">
              <button className="rcr-kpi" onClick={onOpenPlot}>
                <b>{plotData?.beats.length ?? 0}</b> 情节拍
              </button>
              <button className="rcr-kpi" onClick={onOpenPlot}>
                <b>{plotData?.arcs.length ?? 0}</b> 叙事线
              </button>
              <button className="rcr-kpi" onClick={onOpenPlot}>
                <b>{(plotData?.arcs ?? []).filter((a) => a.skeleton).length}</b> 骨架
              </button>
              <span className="rcr-hint">点击查看详情</span>
            </div>
          )}
          {failedBatches > 0 && (
            <div className="rcr-gap">
              <div className="rcr-gap-t">有 {failedBatches} 批抽取失败，这部分内容缺失</div>
              <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={onRetryFailed}>
                <RotateCcw size={13} /> 只重跑失败的批次
              </button>
            </div>
          )}
        </div>
      )}

      {!running && (
        <div className="ref-card-act">
          {item.stage === 'idle' ? (
            <button className="btn btn-primary btn-sm" style={{ width: '100%', justifyContent: 'center' }}
              disabled={analyzing} onClick={() => onAnalyze(item)}>
              {analyzing ? '统计中…' : '结构与节奏统计'}
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }}
              disabled={analyzing} onClick={() => onAnalyze(item)}>
              {analyzing ? '统计中…' : '重新统计'}
            </button>
          )}
          <div className="ref-card-btns">
            <button className="btn btn-ref btn-sm" onClick={onExtract}>要素抽取</button>
            <button className="btn btn-ref btn-sm" onClick={onExtractPlot}>情节链拆解</button>
          </div>
          {/* 缺产物但缓存还在时，优先给「重建」而不是让用户重跑（重跑要花钱） */}
          {!hasElements && (
            <button className="btn btn-ghost btn-sm rc-rebuild" disabled={!!rebuilding} onClick={() => onRebuild(item, 'elements')}>
              {rebuilding === `${item.id}:elements` ? '重建中…' : '从缓存重建要素（免费）'}
            </button>
          )}
          {!hasPlot && (
            <button className="btn btn-ghost btn-sm rc-rebuild" disabled={!!rebuilding} onClick={() => onRebuild(item, 'plot')}>
              {rebuilding === `${item.id}:plot` ? '重建中…' : '从缓存重建情节链（免费）'}
            </button>
          )}
          <div className="ref-card-hint">
            {item.stage === 'idle' ? '结构统计纯本地、不花 token' : '要素与情节链需 AI，会产生费用'}
          </div>
        </div>
      )}

      <div className="ref-card-foot">
        <span className="note ellip mono" style={{ fontSize: 11 }} title={item.dir}>{item.dir || '未绑定目录'}</span>
        <button className="icon-btn square" title="移出参考库（不删除磁盘文件）" onClick={onRemove}><Trash2 size={14} /></button>
      </div>
    </div>
  )
}

/**
 * 跑之前的成本确认。
 * 必须让用户在花钱前看到量级 —— 哪怕只有几毛钱，
 * 也不该在点下去之后才知道这会调用 72 次模型。
 */
function CostConfirmModal({
  refItem,
  stage,
  aiReady: ready,
  structure,
  onCancel,
  onConfirm,
  scopeSpec,
  onScopeChange,
}: {
  refItem: Reference
  stage: AiStage
  aiReady: boolean
  structure: RefStructure | null
  onCancel: () => void
  onConfirm: () => void
  scopeSpec: ScopeSpec
  onScopeChange: (s: ScopeSpec) => void
}) {
  const cfg = DEFAULT_QUEUE_CONFIG
  const avgChars = refItem.chapterCount > 0 ? refItem.wordCount / refItem.chapterCount : 0
  const total = refItem.chapterCount || structure?.chapterCount || 0
  const scope = resolveScope(scopeSpec, total, structure?.volumes ?? [])
  const analyzed = scopeChapterCount(scope)
  const est = estimateCost(
    analyzed, cfg.batchChapters, avgChars, cfg.pricing, isPeakHour(),
    0.6, OUTPUT_TOKENS_PER_BATCH[stage],
  )

  return (
    <div className="veil" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal" style={{ width: 500 }}>
        <div className="modal-head">
          <span className="modal-title">{AI_STAGE_LABEL[stage]}《{refItem.title}》</span>
          <span style={{ flex: 1 }} />
          <button className="icon-btn square" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          {!ready && (
            <div className="rcr-gap" style={{ marginBottom: 14 }}>
              <div className="rcr-gap-t">尚未配置 AI 接口</div>
              <div className="note" style={{ fontSize: 11.5, marginTop: 4 }}>
                请先回到工作台顶栏「AI 接口设置」填好 Base URL 与 Key。结构统计不需要 AI，可以先做那一步。
              </div>
            </div>
          )}
          <div className="ref-row"><span className="k">规模</span><span className="v">{refItem.chapterCount} 章 · {formatNumber(refItem.wordCount)} 字</span></div>

          {/* 档位：跑一本书很贵，先花小钱试水再决定要不要全量 */}
          <div className="scope-picker">
            <div className="eyebrow" style={{ marginBottom: 7 }}>分析范围</div>
            <div className="scope-opts">
              {[
                { spec: { kind: SCOPE_PER_VOLUME, perVolume: 20 } as ScopeSpec, t: '每卷前 20 章', d: '推荐 · 能看到每一卷的开局节奏' },
                { spec: { kind: SCOPE_HEAD, head: 100 } as ScopeSpec, t: '前 100 章', d: '试水 · 约 ¥1' },
                { spec: { kind: SCOPE_ALL } as ScopeSpec, t: '全书', d: '完整 · 最贵' },
              ].map((o) => (
                <button key={o.t} className={`scope-opt ${JSON.stringify(scopeSpec) === JSON.stringify(o.spec) ? 'on' : ''}`}
                  disabled={o.spec.kind === SCOPE_PER_VOLUME && !structure?.volumes?.length}
                  onClick={() => onScopeChange(o.spec)}>
                  <span className="so-t">{o.t}</span>
                  <span className="so-d">{o.d}</span>
                </button>
              ))}
            </div>
            {scopeSpec.kind !== SCOPE_ALL && (
              <div className="scope-warn">
                本次只分析 {analyzed} / {total} 章。产物会标注覆盖范围，
                卷配比与模板均<b>基于已分析章节</b>，不代表全书。
              </div>
            )}
          </div>

          <div className="ref-row"><span className="k">批次</span><span className="v">{est.batches} 批（每批 {cfg.batchChapters} 章）</span></div>
          <div className="ref-row">
            <span className="k">预计花费</span>
            <span className="v">
              <b style={{ color: 'var(--accent)' }}>¥{est.costMin} ~ ¥{est.costMax}</b>
            </span>
          </div>
          {est.peak && (
            <div className="rcr-gap" style={{ marginTop: 10 }}>
              <div className="rcr-gap-t">当前是 DeepSeek 高峰时段（9:00–12:00 / 14:00–18:00），同样任务费用翻倍</div>
            </div>
          )}
          <div className="note" style={{ marginTop: 14, fontSize: 11.5, lineHeight: 1.75 }}>
            实际费用随模型输出长度浮动，预估给的是区间而非定值。中途可随时中断，进度会保存；
            失败批次不会被静默跳过，运行结束会明确告诉你缺了多少。
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" disabled={!ready} onClick={onConfirm}>
            开始拆解（约 ¥{est.costMax}）
          </button>
        </div>
      </div>
    </div>
  )
}

/* ================================ 模板库 ================================ */

const TPL_ORDER: TemplateKind[] = ['plot', 'structure', 'setting']

/**
 * 模板库：全部由各书分析产物**本地转换**而来，不调用模型。
 * 跨书共有的模板排在前面 —— 那说明是通行套路，不是个别作者的偏好。
 */
function TemplateView({ bundles, templates }: { bundles: RefAnalysisBundle[]; templates: RefTemplate[] }) {
  const [kind, setKind] = useState<'all' | TemplateKind>('all')
  const titleOf = (refId: string) => bundles.find((b) => b.ref.id === refId)?.ref.title ?? '参考书'

  if (!bundles.length) {
    return <div className="reflib-empty tpl-view"><BookMarked size={30} /><div className="reflib-empty-t">还没有可汇总的作品</div><div className="reflib-empty-d">导入并分析参考书后，它们的骨架与要素会汇入这里。</div></div>
  }
  const list = (kind === 'all' ? templates : templates.filter((t) => t.kind === kind))
    .slice()
    .sort((a, b) => b.bookCount - a.bookCount || (a.genres[0] ?? '').localeCompare(b.genres[0] ?? ''))
  const counts = TPL_ORDER.reduce((m, k) => ({ ...m, [k]: templates.filter((t) => t.kind === k).length }), {} as Record<string, number>)

  return (
    <div className="tpl-view">
      <div className="lib-view-tabs" style={{ marginBottom: 16 }}>
        <button className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>全部 {templates.length}</button>
        {TPL_ORDER.map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {TEMPLATE_KIND_LABEL[k]} {counts[k] ?? 0}
          </button>
        ))}
      </div>
      {!list.length && <div className="reflib-empty"><div className="reflib-empty-t">这一类还没有模板</div><div className="reflib-empty-d">对应阶段跑完后会自动汇总进来。</div></div>}
      <div className="tpl-grid">
        {list.map((t) => (
          <div className="tpl-card" key={t.id}>
            <div className="tc-h">
              <span className="tc-kind">{TEMPLATE_KIND_LABEL[t.kind]}</span>
              {t.bookCount > 1 && <span className="tc-multi">{t.bookCount} 本共有</span>}
            </div>
            <div className="tc-title">{t.title}</div>
            <div className="tc-sum">{t.summary}</div>
            {t.steps.length > 0 && (
              <div className="tc-skel">
                {t.steps.map((s, i) => (
                  <div className="tc-step" key={s.key || i}>
                    <span className="tc-i">{i + 1}</span>
                    <span className="tc-l">{s.label}</span>
                    {s.require && <span className="tc-r">{s.require}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="tc-src">
              {t.genres.filter(Boolean).map((g) => <span className="chip" key={g}>{g}</span>)}
              <span className="tc-srcline">
                溯源：{t.sources.slice(0, 2).map((s) => `${titleOf(s.refId)}${s.toChapter > s.fromChapter ? ` ${s.fromChapter}-${s.toChapter}章` : ''}`).join('、')}
                {t.sources.length > 2 ? ` 等 ${t.sources.length} 处` : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================ 竞品对比 ================================ */

function CompareView({
  bundles,
  insight,
  onInsight,
}: {
  bundles: RefAnalysisBundle[]
  insight: string[] | null
  onInsight: (v: string[] | null) => void
}) {
  const ready = useStore()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const cols = buildComparison(bundles)

  if (cols.length < 2) {
    return <div className="reflib-empty cmp-view"><BookMarked size={30} /><div className="reflib-empty-t">至少需要两部作品才能对比</div><div className="reflib-empty-d">当前 {cols.length} 部。导入并分析更多参考书后，这里会横向摆出各维度差异。</div></div>
  }

  async function genInsight() {
    setBusy(true)
    setErr(null)
    try {
      const r = await actions.diffInsight(diffSummary(cols))
      onInsight(r.insights ?? [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cmp-view">
      <table className="cmp-table">
        <thead>
          <tr>
            <th className="dim-col">维度</th>
            {cols.map((c) => (
              <th key={c.refId}>
                <div className="ch-t">{c.title}</div>
                <div className="ch-m">{c.genre}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_DIMS.map((d) => {
            const best = bestOf(cols, d)
            return (
              <tr key={d.key}>
                <td className="dim-col">
                  {d.label}
                  {d.unit && <span className="dim-u">{d.unit}</span>}
                  {d.weak && <span className="dim-weak">弱信号</span>}
                </td>
                {cols.map((c) => (
                  <td key={c.refId} className={`num ${best.includes(c.refId) ? 'best' : ''}`}>
                    {formatNumber(c.values[d.key] ?? 0)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="cmp-ai">
        <div className="eyebrow" style={{ marginBottom: 7 }}>差异解读（可选，一次轻量调用）</div>
        <div className="note" style={{ marginBottom: 9 }}>
          上面每一格都是本地算出来的确定值，不是估计。解读只负责组织语言 —— 它没拿到正文，无从虚构。
        </div>
        <button className="btn btn-ghost btn-sm" disabled={busy || !aiReady(ready.ai)} onClick={genInsight}>
          {busy ? '解读中…' : '解读这些差异说明了什么取舍'}
        </button>
        {err && <div className="rp-warn" style={{ marginTop: 10 }}>{err}</div>}
        {insight && insight.length > 0 && (
          <ul className="cmp-insights">
            {insight.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}
