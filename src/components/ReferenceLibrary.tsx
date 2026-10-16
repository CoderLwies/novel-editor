import { useEffect, useRef, useState } from 'react'
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
import { estimateCost, DEFAULT_QUEUE_CONFIG, isPeakHour, progressRatio, AI_STAGE_LABEL, type QueueProgress, type AiStage } from '../aiqueue'
import type { RefElements, RefPlot } from '../refschema'
import { aiReady } from '../ai'

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
  const [run, setRun] = useState<RunState | null>(null)
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

  /* ------------------------- 阶段二：深度拆解 ------------------------- */

  async function startExtraction(ref: Reference, stage: AiStage, retryFailed = false) {
    const abort = new AbortController()
    setConfirmRef(null)
    setRun({ refId: ref.id, stage, progress: null, abort, result: null, plot: null, failedBatches: 0, pausedByBudget: false })
    const onProgress = (p: QueueProgress) => setRun((prev) => (prev ? { ...prev, progress: p } : prev))
    try {
      if (stage === 'elements') {
        const { elements, run: r } = await actions.extractElements(ref.id, { signal: abort.signal, retryFailed, onProgress })
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
        const { plot, run: r } = await actions.extractPlot(ref.id, { signal: abort.signal, retryFailed, onProgress })
        setRun((prev) => (prev ? { ...prev, plot, failedBatches: r.checkpoint.failed.length, pausedByBudget: r.pausedByBudget } : prev))
        const sk = plot.arcs.filter((a) => a.skeleton).length
        flash(
          r.pausedByBudget
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
                  onRemove={() => actions.removeReference(r.id)}
                />
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

      {confirmRef && (
        <CostConfirmModal
          refItem={confirmRef.ref}
          stage={confirmRef.stage}
          aiReady={aiReady(state.ai)}
          onCancel={() => setConfirmRef(null)}
          onConfirm={() => startExtraction(confirmRef.ref, confirmRef.stage)}
        />
      )}

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
  onRemove,
}: {
  /** 注意：不要叫 `ref` —— 那是 React 保留 prop，组件内部会拿不到这个对象 */
  item: Reference
  onAnalyze: (id: string) => void
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
  onRemove: () => void
}) {
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
      {(result || plot) && !extracting && (
        <div className="ref-card-run">
          {result && (
            <div className="rcr-result">
              <span><b>{result.characters.length}</b> 角色</span>
              <span><b>{result.settings.length}</b> 设定</span>
              <span><b>{result.foreshadows.length}</b> 伏笔</span>
            </div>
          )}
          {plot && (
            <div className="rcr-result">
              <span><b>{plot.beats.length}</b> 情节拍</span>
              <span><b>{plot.arcs.length}</b> 叙事线</span>
              <span><b>{plot.arcs.filter((a) => a.skeleton).length}</b> 骨架</span>
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
              disabled={analyzing} onClick={() => onAnalyze(item.id)}>
              {analyzing ? '统计中…' : '结构与节奏统计'}
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }}
              disabled={analyzing} onClick={() => onAnalyze(item.id)}>
              {analyzing ? '统计中…' : '重新统计'}
            </button>
          )}
          <div className="ref-card-btns">
            <button className="btn btn-ref btn-sm" onClick={onExtract}>要素抽取</button>
            <button className="btn btn-ref btn-sm" onClick={onExtractPlot}>情节链拆解</button>
          </div>
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
  onCancel,
  onConfirm,
}: {
  refItem: Reference
  stage: AiStage
  aiReady: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const cfg = DEFAULT_QUEUE_CONFIG
  const avgChars = refItem.chapterCount > 0 ? refItem.wordCount / refItem.chapterCount : 0
  const est = estimateCost(refItem.chapterCount, cfg.batchChapters, avgChars, cfg.pricing, isPeakHour())

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
