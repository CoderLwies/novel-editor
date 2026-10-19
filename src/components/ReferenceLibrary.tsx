import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileInput, FolderInput, FolderPlus, Trash2, BookMarked, Square, RotateCcw } from 'lucide-react'
import { useStore, actions } from '../store'
import type { Reference, RefStage } from '../types'
import { formatNumber } from '../utils'
import { openTextFile, pickDirectory, readTextFile, supportsProjectFolders, fsLow } from '../fs'
import {
  splitReferenceText,
  pickChapterFiles,
  writeReferenceToDir,
  describeImport,
  readReferenceMeta,
  scanRawBatches,
  readRawManifest,
  type SplitResult,
  type RefChapter,
} from '../reference'
import { readCheckpoint } from '../refanalysis'
import { uid } from '../utils'
import { estimateCost, DEFAULT_QUEUE_CONFIG, isPeakHour, progressRatio, AI_STAGE_LABEL, OUTPUT_TOKENS_PER_BATCH, resolveScope, scopeChapterCount, SCOPE_ALL, SCOPE_HEAD, SCOPE_PER_VOLUME, type QueueProgress, type AiStage, type ScopeSpec, type QueueCheckpoint, type ChapterScope } from '../aiqueue'
import type { RefElements, RefPlot } from '../refschema'
import { aiReady } from '../ai'
import { readReferenceAnalysis } from '../reference'
import type { RefTemplate, TemplateKind, RefStructure } from '../refschema'
import { TEMPLATE_KIND_LABEL } from '../refschema'
import type { ChecklistItem } from '../refderive'
import { buildTemplates, buildComparison, COMPARE_DIMS, extremesOf, diffSummary, type RefAnalysisBundle } from '../reftemplates'
import ElementsModal from './ElementsModal'
import PlotModal from './PlotModal'

/** 待确认的一次导入 */
interface PendingImport {
  title: string
  encoding: string
  split: SplitResult
  chapters: RefChapter[]
}

/** 正在进行的一次深度拆解。跑完即清空 —— 卡片状态必须回到可操作。 */
interface RunState {
  refId: string
  /** 区分要素抽取与情节链，两者可分别跑 */
  stage: AiStage
  progress: QueueProgress | null
  abort: AbortController
}

/**
 * 磁盘上的断点摘要。
 * 失败批次与「已完成 X/Y 批」都必须从磁盘读 —— 只放内存的话，
 * 关掉应用再打开就看不见上次失败的批次，用户会以为结果完整。
 */
interface CpInfo {
  completed: number
  total: number
  failed: number
  status: QueueCheckpoint['status']
  batchChapters: number
  /** raw/ 里实际落盘的批次数，是「能不能重建」的真相来源 */
  cached: number
  /** 断点对应的分析档位；与当前选择不一致时不能假装还能续跑 */
  scopeLabel?: string
  /** 断点的章区间与全书章数：重跑失败批次时据此复用同一套批次划分 */
  scopeRanges?: { from: number; to: number }[]
  chapterCount?: number
}
type CpMap = Record<string, Partial<Record<AiStage, CpInfo>>>

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

/** 全部批次都因鉴权失败时，提示必须指向真正的原因，而不是「N 批失败」 */
function authHint(cp: QueueCheckpoint): string {
  return cp.failed.some((f) => f.kind === 'auth') ? '（鉴权失败：API Key 无效或未填，请检查顶栏「AI 接口设置」）' : ''
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
  const [cps, setCps] = useState<CpMap>({})
  const [insight, setInsight] = useState<string[] | null>(null)
  /** 打开要素详情的参考书；分析产物在磁盘上，任何时候都能回看 */
  const [elementsRef, setElementsRef] = useState<Reference | null>(null)
  const [plotRef, setPlotRef] = useState<Reference | null>(null)
  const [rebuildingId, setRebuildingId] = useState<string | null>(null)
  /** 本次运行的费用上限；null = 不限。跑超了会暂停，调高再点一次即可续跑 */
  const [budget, setBudget] = useState<number | null>(DEFAULT_QUEUE_CONFIG.budgetYuan)
  /** 目录导入的读取进度；上千章时逐个数却没有反馈会像卡死 */
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null)

  // 各书的分析产物汇总；模板与对比全部由此**本地推导**，不再调用模型。
  // 抽成函数是为了跑完抽取后能立即重载 —— 否则卡片看不到刚跑出来的结果。
  const loadBundles = useCallback(async () => {
    const out: RefAnalysisBundle[] = []
    const nextCps: CpMap = {}
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

      // 断点 + 已落盘批次：卡片要用它显示失败批次与「能否重建」
      const per: Partial<Record<AiStage, CpInfo>> = {}
      for (const stage of ['elements', 'plot'] as AiStage[]) {
        const cp = await readCheckpoint(r, stage)
        const manifest = await readRawManifest(r, stage)
        const cached = (await scanRawBatches(r, stage, DEFAULT_QUEUE_CONFIG.batchChapters)).length
        if (cp) {
          per[stage] = {
            completed: cp.completed.length,
            total: cp.totalBatches,
            failed: cp.failed.length,
            status: cp.status,
            batchChapters: cp.batchChapters,
            cached,
            scopeLabel: manifest?.scopeLabel,
            scopeRanges: manifest?.scopeRanges,
            chapterCount: manifest?.chapterCount,
          }
        } else if (cached) {
          // checkpoint 写失败但 raw 在：仍然算有缓存，只是不知道进度
          per[stage] = { completed: 0, total: 0, failed: 0, status: 'paused', batchChapters: DEFAULT_QUEUE_CONFIG.batchChapters, cached, scopeLabel: manifest?.scopeLabel, scopeRanges: manifest?.scopeRanges, chapterCount: manifest?.chapterCount }
        }
      }
      if (Object.keys(per).length) nextCps[r.id] = per
    }
    setBundles(out)
    setTemplates(buildTemplates(out))
    setCps(nextCps)
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
      const chapters: RefChapter[] = new Array(names.length)
      const encodings = new Set<string>()
      setImporting({ done: 0, total: names.length })
      let done = 0
      let cursor = 0
      // 逐个数读一千章会长时间没有任何反馈；小并发既快又不会打爆 IPC
      const worker = async () => {
        while (true) {
          const i = cursor++
          if (i >= names.length) return
          const { text, encoding } = await readTextFile(`${dir}/${names[i]}`)
          encodings.add(encoding)
          chapters[i] = {
            index: i + 1,
            title: names[i].replace(/\.(txt|md|markdown)$/i, ''),
            content: text,
            volumeIndex: 0,
          }
          done += 1
          setImporting({ done, total: names.length })
        }
      }
      await Promise.all(Array.from({ length: Math.min(12, names.length) }, worker))
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
      setImporting(null)
      setBusy(false)
    }
  }

  /**
   * 重新接入一个已有参考目录。
   * 移出参考库只删本地元数据、不动磁盘；没有这个入口的话，
   * 误删一次就得整本书重新导入（还会重写一遍章节文件）。
   */
  async function attachExistingDir() {
    setBusy(true)
    try {
      const dir = await pickDirectory()
      if (!dir) return
      const meta = await readReferenceMeta(dir)
      if (!meta) {
        flash('这个目录里没有 reference.json，不是字舟的参考目录')
        return
      }
      if (refs.some((r) => r.dir === dir)) {
        flash('这个目录已经在参考库里了')
        return
      }
      actions.addReference(meta)
      void loadBundles()
      flash(`已重新接入《${meta.title}》：${meta.chapterCount} 章，原有分析产物可直接查看`)
    } catch (e) {
      flash(`接入失败：${(e as Error).message}`)
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

  /** 阶段过滤只有一个口径 —— 计数与列表用同一个函数，避免「显示 3 本、列表是空」 */
  const matchesFilter = (r: Reference, f: typeof filter) =>
    f === 'all'
      ? true
      : f === 'idle'
        ? r.stage === 'idle'
        : f === 'scanned'
          ? r.stage === 'scanned' || r.stage === 'done'
          : r.stage === 'scanning' || r.stage === 'reading'

  const shown = refs.filter((r) => matchesFilter(r, filter))

  /* ------------------------- 阶段二：深度拆解 ------------------------- */

  async function startExtraction(ref: Reference, stage: AiStage, retryFailed = false, explicitScope?: ChapterScope) {
    const abort = new AbortController()
    const spec = scopeSpec
    setConfirmRef(null)
    setRun({ refId: ref.id, stage, progress: null, abort })
    const onProgress = (p: QueueProgress) =>
      setRun((prev) => (prev && prev.refId === ref.id ? { ...prev, progress: p } : prev))
    try {
      if (stage === 'elements') {
        const { elements, run: r } = await actions.extractElements(ref.id, {
          signal: abort.signal,
          retryFailed,
          onProgress,
          // 重跑失败批次时沿用上次的批次划分，绝不能让当前档位把范围改掉
          scope: explicitScope ? undefined : spec,
          explicitScope,
          config: { budgetYuan: budget },
        })
        const c = elements.characters.length
        const s = elements.settings.length
        const f = elements.foreshadows.length
        flash(
          r.pausedByBudget
            ? `预算已用尽，暂停在 ${r.checkpoint.completed.length}/${r.checkpoint.totalBatches} 批；到成本弹窗调高预算后可继续`
            : `要素抽取完成：角色 ${c} · 设定 ${s} · 伏笔 ${f}` +
                (r.checkpoint.failed.length ? `（${r.checkpoint.failed.length} 批失败，结果有缺口）` : '') +
                authHint(r.checkpoint),
        )
      } else {
        const { plot, run: r, arcError } = await actions.extractPlot(ref.id, {
          signal: abort.signal,
          retryFailed,
          onProgress,
          scope: explicitScope ? undefined : spec,
          explicitScope,
          config: { budgetYuan: budget },
        })
        const sk = plot.arcs.filter((a) => a.skeleton).length
        flash(
          arcError
            ? `情节拍已保存（${plot.beats.length} 拍），但骨架生成失败：${arcError}。重新点一次「情节链拆解」只会重跑这一步，不重跑已完成的批次。`
            : r.pausedByBudget
              ? `预算已用尽，暂停在 ${r.checkpoint.completed.length}/${r.checkpoint.totalBatches} 批；到成本弹窗调高预算后可继续`
              : `情节链完成：${plot.beats.length} 拍 · ${plot.arcs.length} 条线（其中 ${sk} 条抽出骨架）` +
                (r.checkpoint.failed.length ? `（${r.checkpoint.failed.length} 批失败，结果有缺口）` : '') +
                authHint(r.checkpoint),
        )
      }
    } catch (e) {
      const msg = (e as Error).message
      // 中断不是错误，不弹失败提示
      if (abort.signal.aborted) flash('已中断，进度已保存，可随时继续')
      else flash(`拆解失败：${msg}`)
    } finally {
      // 必须在结束时清空：留着 run 会让「运行中」永远为真，
      // 结果区与操作按钮全部被隐藏，只能退出参考库再进来
      setRun(null)
      // 无论成功失败都重载：产物与断点可能都已写盘
      await loadBundles()
    }
  }

  function stopRun() {
    run?.abort.abort()
  }

  const counts = {
    all: refs.length,
    idle: refs.filter((r) => matchesFilter(r, 'idle')).length,
    scanned: refs.filter((r) => matchesFilter(r, 'scanned')).length,
    running: refs.filter((r) => matchesFilter(r, 'scanning')).length,
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
          <>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={importDir}>
              <FolderInput size={15} /> {importing ? `读取中 ${importing.done}/${importing.total}` : '导入整本书目录'}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={attachExistingDir} title="重新接入之前导入过的参考目录（分析产物可继续用）">
              <FolderPlus size={15} /> 接入已有目录
            </button>
          </>
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
                    <>
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={importDir}>导入整本书目录</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={attachExistingDir}>接入已有目录</button>
                    </>
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
                  running={run?.refId === r.id}
                  onStop={stopRun}
                  progress={run?.refId === r.id ? run.progress : null}
                  cp={cps[r.id] ?? {}}
                  onRetryFailed={(stage) => {
                    const info = cps[r.id]?.[stage]
                    // 沿用断点记录的范围与批次划分，只把失败的那些重新入队
                    const explicit: ChapterScope | undefined = info?.scopeRanges?.length
                      ? {
                          label: info.scopeLabel ?? '（断点范围）',
                          ranges: info.scopeRanges,
                          totalChapters: info.chapterCount ?? r.chapterCount,
                        }
                      : undefined
                    void startExtraction(r, stage, true, explicit)
                  }}
                  rebuilding={rebuildingId}
                  onRebuild={rebuild}
                  elements={bundleOf(r.id)?.elements ?? null}
                  plotData={bundleOf(r.id)?.plot ?? null}
                  onOpenElements={() => setElementsRef(r)}
                  onOpenPlot={() => setPlotRef(r)}
                  onRemove={() => { actions.removeReference(r.id); flash(`已移出《${r.title}》，磁盘文件保留，可随时用「接入已有目录」加回来`) }}
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
          cp={cps[confirmRef.ref.id]?.[confirmRef.stage] ?? null}
          budget={budget}
          onBudgetChange={setBudget}
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
  running,
  onStop,
  progress,
  cp,
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
  running: boolean
  onStop: () => void
  progress: QueueProgress | null
  /** 磁盘断点摘要：失败批次与可重建批次都来自这里 */
  cp: Partial<Record<AiStage, CpInfo>>
  onRetryFailed: (stage: AiStage) => void
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
  const st = STAGE_META[item.stage] ?? STAGE_META.idle
  const pct = progress ? Math.round(progressRatio(progress) * 100) : 0
  const failElements = cp.elements?.failed ?? 0
  const failPlot = cp.plot?.failed ?? 0
  // 只有磁盘上真有批次，才提「从缓存重建」；否则点了必然报「没有批次」
  const canRebuildElements = !hasElements && (cp.elements?.cached ?? 0) > 0
  const canRebuildPlot = !hasPlot && (cp.plot?.cached ?? 0) > 0
  const [confirmRemove, setConfirmRemove] = useState(false)

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
      {running && progress && (
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

      {/* 结果概要：完全由磁盘产物驱动，跑没跑过都一样 */}
      {!running && (hasElements || hasPlot) && (
        <div className="ref-card-run">
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
            </div>
          )}
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
            </div>
          )}
          <div className="rcr-hint" style={{ textAlign: 'right', marginTop: 6 }}>点击数字查看详情</div>
        </div>
      )}

      {/* 失败批次：从 checkpoint 读，重启后依然可见 */}
      {!running && (failElements > 0 || failPlot > 0) && (
        <div className="ref-card-run">
          {failElements > 0 && (
            <div className="rcr-gap">
              <div className="rcr-gap-t">要素抽取有 {failElements} 批失败，这部分内容缺失</div>
              <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onRetryFailed('elements')}>
                <RotateCcw size={13} /> 只重跑失败的 {failElements} 批
              </button>
            </div>
          )}
          {failPlot > 0 && (
            <div className="rcr-gap" style={{ marginTop: failElements > 0 ? 8 : 0 }}>
              <div className="rcr-gap-t">情节链有 {failPlot} 批失败，这部分内容缺失</div>
              <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onRetryFailed('plot')}>
                <RotateCcw size={13} /> 只重跑失败的 {failPlot} 批
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
          {canRebuildElements && (
            <button className="btn btn-ghost btn-sm rc-rebuild" disabled={!!rebuilding} onClick={() => onRebuild(item, 'elements')}>
              {rebuilding === `${item.id}:elements` ? '重建中…' : `从缓存重建要素（${cp.elements?.cached} 批，免费）`}
            </button>
          )}
          {canRebuildPlot && (
            <button className="btn btn-ghost btn-sm rc-rebuild" disabled={!!rebuilding} onClick={() => onRebuild(item, 'plot')}>
              {rebuilding === `${item.id}:plot` ? '重建中…' : `从缓存重建情节链（${cp.plot?.cached} 批，免费）`}
            </button>
          )}
          <div className="ref-card-hint">
            {item.stage === 'idle' ? '结构统计纯本地、不花 token' : '要素与情节链需 AI，会产生费用'}
          </div>
        </div>
      )}

      <div className="ref-card-foot">
        <span className="note ellip mono" style={{ fontSize: 11 }} title={item.dir}>{item.dir || '未绑定目录'}</span>
        {confirmRemove ? (
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button className="btn btn-ghost btn-sm" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => setConfirmRemove(false)}>取消</button>
            <button className="btn btn-sm" style={{ padding: '2px 7px', fontSize: 11, color: 'var(--danger)' }} onClick={onRemove}>确认移出</button>
          </span>
        ) : (
          <button className="icon-btn square" title="移出参考库（不删除磁盘文件）" onClick={() => setConfirmRemove(true)}><Trash2 size={14} /></button>
        )}
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
  cp,
  budget,
  onBudgetChange,
}: {
  refItem: Reference
  stage: AiStage
  aiReady: boolean
  structure: RefStructure | null
  onCancel: () => void
  onConfirm: () => void
  scopeSpec: ScopeSpec
  onScopeChange: (s: ScopeSpec) => void
  /** 该阶段的磁盘断点；有进度时这里要显示「续跑」而不是「从头开始」 */
  cp: CpInfo | null
  budget: number | null
  onBudgetChange: (v: number | null) => void
}) {
  const cfg = DEFAULT_QUEUE_CONFIG
  const avgChars = refItem.chapterCount > 0 ? refItem.wordCount / refItem.chapterCount : 0
  const total = refItem.chapterCount || structure?.chapterCount || 0
  const scope = resolveScope(scopeSpec, total, structure?.volumes ?? [])
  const analyzed = scopeChapterCount(scope)

  // 有断点时只预估**剩余**批次：预估按全额算会让续跑的人以为还要再花一遍钱。
  // 但断点的档位与当前选择不同时不能续跑 —— 缓存会被判为对不上而作废。
  const scopeChanged = !!cp?.scopeLabel && cp.scopeLabel !== scope.label
  const resumable = !!cp && cp.status !== 'done' && cp.total > 0 && !scopeChanged
  const remainingBatches = resumable ? Math.max(0, cp!.total - cp!.completed - cp!.failed) : null
  const allFailed = resumable && remainingBatches === 0 && (cp!.failed ?? 0) > 0
  const estimateChapters =
    remainingBatches !== null ? Math.min(analyzed, remainingBatches * (cp!.batchChapters || cfg.batchChapters)) : analyzed
  const est = estimateCost(
    estimateChapters, cfg.batchChapters, avgChars, cfg.pricing, isPeakHour(),
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
                { spec: { kind: SCOPE_HEAD, head: 100 } as ScopeSpec, t: '前 100 章', d: '试水 · 最便宜' },
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
            {/* 换档位后旧缓存会被判为对不上而自动作废，这里必须说清楚 */}
            {resumable && (
              <div className="scope-warn" style={{ marginTop: 8 }}>
                已有断点（{cp!.scopeLabel ?? '范围未知'}）：{cp!.completed}/{cp!.total} 批完成
                {cp!.failed > 0 ? `、${cp!.failed} 批失败` : ''}。开始后会从断点续跑。
              </div>
            )}
            {scopeChanged && (
              <div className="scope-warn" style={{ marginTop: 8 }}>
                已有断点是按「{cp!.scopeLabel}」跑的，与当前选择的范围不同 ——
                开始后会作废旧缓存并按新范围重跑，不要把旧批次的费用算进来。
              </div>
            )}
          </div>

          {allFailed ? (
            <div className="rcr-gap" style={{ marginTop: 10 }}>
              <div className="rcr-gap-t">当前范围的批次都已处理过（其中 {cp!.failed} 批失败）</div>
              <div className="note" style={{ fontSize: 11.5, marginTop: 4 }}>
                用卡片上的「只重跑失败的 N 批」把它们重新入队，直接点这里不会有新的批次可跑。
              </div>
            </div>
          ) : (
            <>
              <div className="ref-row"><span className="k">批次</span><span className="v">{est.batches} 批（每批 {cfg.batchChapters} 章）</span></div>
              <div className="ref-row">
                <span className="k">预计花费</span>
                <span className="v">
                  <b style={{ color: 'var(--accent)' }}>¥{est.costMin} ~ ¥{est.costMax}</b>
                  {resumable && <span className="note" style={{ marginLeft: 8 }}>按剩余 {remainingBatches} 批估算</span>}
                </span>
              </div>
            </>
          )}
          {est.peak && (
            <div className="rcr-gap" style={{ marginTop: 10 }}>
              <div className="rcr-gap-t">当前是 DeepSeek 高峰时段（9:00–12:00 / 14:00–18:00），同样任务费用翻倍</div>
            </div>
          )}

          {/* 预算必须可改：默认 ¥50 用尽会暂停，而「加预算」原本没有任何入口 */}
          <div className="ref-row" style={{ alignItems: 'center' }}>
            <span className="k">费用上限</span>
            <span className="v" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="field"
                type="number"
                min={0}
                step={5}
                style={{ width: 96, padding: '5px 8px', fontSize: 12.5 }}
                value={budget ?? ''}
                placeholder="不限"
                onChange={(e) => {
                  const v = e.target.value.trim()
                  onBudgetChange(v === '' ? null : Math.max(0, Number(v)))
                }}
              />
              <span className="note" style={{ fontSize: 11 }}>元 · 超出会暂停，调高后重新点开始即可续跑</span>
            </span>
          </div>

          <div className="note" style={{ marginTop: 14, fontSize: 11.5, lineHeight: 1.75 }}>
            实际费用随模型输出长度浮动，预估给的是区间而非定值。中途可随时中断，进度会保存；
            失败批次不会被静默跳过，运行结束会明确告诉你缺了多少。
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" disabled={!ready || allFailed} onClick={onConfirm}>
            {resumable ? `继续拆解（约 ¥${est.costMax}）` : `开始拆解（约 ¥${est.costMax}）`}
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
            const ex = extremesOf(cols, d)
            return (
              <tr key={d.key}>
                <td className="dim-col">
                  {d.label}
                  {d.unit && <span className="dim-u">{d.unit}</span>}
                  {d.weak && <span className="dim-weak">弱信号</span>}
                </td>
                {cols.map((c) => {
                  const isMax = ex.max.includes(c.refId)
                  const isMin = ex.min.includes(c.refId)
                  return (
                    <td key={c.refId} className={`num ${isMax ? 'hi' : ''} ${isMin ? 'lo' : ''}`}
                      title={isMax ? '本维度最高' : isMin ? '本维度最低' : undefined}>
                      {formatNumber(c.values[d.key] ?? 0)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="note" style={{ marginTop: 8, fontSize: 11 }}>
        蓝色是该维度最高、灰色是最低 —— <b>只标差异两端，不代表谁更好</b>：章节多、字数大本身没有优劣。
      </div>

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
