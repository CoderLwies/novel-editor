/**
 * 分析流程编排：把「读原文 → 计算 → 落盘」串起来。
 *
 * 当前只实现阶段一（结构与节奏统计，纯本地、0 token、结果可复现）。
 * 阶段二要素抽取、阶段三情节链、阶段四模板生成需要 AI 与任务队列，
 * 会先跑阶段一作为体检——不值得深挖的书在这里就能看出来。
 */
import type { AIConfig, Reference, RefStage } from './types'
import type { RefStructure, RefElements, RefPlot, PlotArc, ScopeNote } from './refschema'
import { computeStructure } from './refstats'
import { readReferenceChapters, writeReferenceAnalysis, writeReferenceMeta, scanRawBatches, readRawManifest, writeRawManifest, readReferenceAnalysis } from './reference'
import { fsLow } from './fs'
import { planBatches, resolveScope, scopeChapterCount, scopeIsPartial, DEFAULT_QUEUE_CONFIG, SCOPE_ALL, type BatchTask, type AiStage, type QueueCheckpoint, type QueueConfig, type QueueProgress, type ScopeSpec, type ChapterScope } from './aiqueue'
import { runQueue, type RunResult } from './aiqueue-runner'
import { chatJSONWithUsage } from './ai'
import { elementsPrompt, SYS_EXTRACTOR, plotPrompt, arcPrompt, SYS_PLOT, type BatchElements, type BatchPlot, type ArcResult } from './refprompt'
import { ElementsMerger } from './refmerge'
import { BeatCollector, assembleArcs } from './refbeats'
import { SCHEMA_VERSION } from './refschema'

export interface AnalyzeProgress {
  /** 当前阶段 */
  stage: RefStage
  /** 人类可读的当前动作 */
  message: string
}

/**
 * 阶段一：结构与节奏统计。
 * 纯本地计算，不调用 AI，重复跑结果一致（computedAt 除外）。
 */
export async function runStructureAnalysis(ref: Reference): Promise<RefStructure> {
  const chapters = await readReferenceChapters(ref)
  const structure = computeStructure({
    refId: ref.id,
    chapters,
    volumeTitles: ref.volumes.map((v) => v.title),
  })
  await writeReferenceAnalysis(ref, 'structure', structure)
  return structure
}

/**
 * 跑阶段一并推进 Reference.stage。
 * 返回推进后的 stage 与统计结果。
 */
export async function analyzeStructure(
  ref: Reference,
): Promise<{ structure: RefStructure; stage: RefStage }> {
  // 先把 stage 落盘：中途退出后重启能看到「分析中」而不是回到未开始
  const marked: Reference = { ...ref, stage: 'scanning' }
  await writeReferenceMeta(marked)

  const structure = await runStructureAnalysis(marked)
  // 阶段一完成 = scanned（快速扫描的本地部分已就绪，语义部分待选）
  await writeReferenceMeta({ ...marked, stage: 'scanned' })
  return { structure, stage: 'scanned' }
}

/* ======================= 阶段二：要素抽取（需 AI） ======================= */

/** 解析本次要分析的范围：默认全书；分档需要结构统计提供卷区间 */
async function resolveRunScope(
  ref: Reference,
  spec: ScopeSpec | undefined,
): Promise<{ scope: ChapterScope; structure: RefStructure | null }> {
  const structure = await readReferenceAnalysis<RefStructure>(ref, 'structure')
  const total = ref.chapterCount || structure?.chapterCount || 0
  return {
    scope: resolveScope(spec ?? { kind: SCOPE_ALL }, total, structure?.volumes ?? []),
    structure,
  }
}

export interface ExtractOptions {
  config?: Partial<QueueConfig>
  /** 分析档位；不传即全书 */
  scope?: ScopeSpec
  ai: AIConfig
  onProgress?: (p: QueueProgress) => void
  signal?: AbortSignal
}

/**
 * 阶段二：跨批次抽取角色 / 设定 / 伏笔。
 *
 * 每批都把「已累积的角色设定名单」带进 prompt —— 否则 72 个批次会把同一个角色
 * 识别成 72 个人。合并时按名字+别名精确匹配，宁可留待用户手动合并也不误并。
 */
export async function runElementExtraction(
  ref: Reference,
  opts: ExtractOptions,
): Promise<{ elements: RefElements; run: RunResult }> {
  const config: QueueConfig = { ...DEFAULT_QUEUE_CONFIG, ...opts.config }
  const chapters = await readReferenceChapters(ref)
  const { scope } = await resolveRunScope(ref, opts.scope)
  const batches = planBatches(ref.id, 'elements', scope, config.batchChapters)
  if (!batches.length) throw new Error('没有可分析的章节')

  const marked: Reference = { ...ref, stage: 'reading' }
  await writeReferenceMeta(marked)

  // 恢复断点：批大小一致才认，否则旧记录无意义
  const saved = await readCheckpoint(marked, 'elements')
  const checkpoint = saved && saved.batchChapters === config.batchChapters ? saved : null

  // 合并器按批次序号重放，保证乱序完成也能得到一致结果
  const merger = new ElementsMerger()
  const outputs = new Map<number, BatchElements>()

  // 先重放已完成的批次，累积出「已知名单」供新批次使用
  for (const batch of batches) {
    const raw = await readBatchOutput<BatchElements>(marked, 'elements', batch.index)
    if (raw) {
      outputs.set(batch.index, raw)
      merger.add(raw, chaptersOf(chapters, batch).map((c) => c.index))
    }
  }

  const execute = async (batch: (typeof batches)[number]) => {
    const texts = chaptersOf(chapters, batch)
    const prompt = elementsPrompt(
      ref.title,
      ref.genre,
      batch,
      texts.map((c) => ({ title: c.title, text: c.content })),
      merger.snapshot(),
      config.maxCharsPerCall,
    )
    const { data, usage } = await chatJSONWithUsage<BatchElements>(
      opts.ai,
      SYS_EXTRACTOR,
      prompt,
      120000,
    )
    // 立刻落盘原始结果：断点恢复靠它重放，不必重新调用
    await writeBatchOutput(marked, 'elements', batch.index, data)
    outputs.set(batch.index, data)
    merger.add(data, texts.map((c) => c.index))
    return { data, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
  }

  const run = await runQueue({
    batches,
    config,
    checkpoint,
    execute,
    // raw 已落盘的批次视为完成：checkpoint 写失败也不会重复付费
    persistedBatches: (await scanRawBatches(marked, 'elements', config.batchChapters)).map((b) => b.index),
    onCheckpoint: async (cp) => {
      await writeRawManifest(marked, {
        stage: 'elements',
        batchChapters: config.batchChapters,
        chapterCount: chapters.length,
        scopeLabel: scope.label,
        scopeRanges: scope.ranges,
        totalBatches: batches.length,
        batches: batches.map((b) => ({ index: b.index, from: b.fromChapter, to: b.toChapter })),
      })
      await writeCheckpoint(marked, 'elements', cp)
    },
    onProgress: (p) => opts.onProgress?.(p),
    signal: opts.signal,
  })

  await writeReferenceMeta({ ...marked, stage: run.checkpoint.status === 'done' ? 'done' : 'scanned' })

  const merged = merger.finish(ref.id)
  const scopeNote: ScopeNote = {
    label: scope.label,
    analyzed: scopeChapterCount(scope),
    total: scope.totalChapters,
    partial: scopeIsPartial(scope),
  }
  const elements: RefElements = {
    schemaVersion: SCHEMA_VERSION,
    refId: ref.id,
    computedAt: Date.now(),
    scope: scopeNote,
    ...merged,
  }
  await writeReferenceAnalysis(marked, 'elements', elements)
  return { elements, run }
}

/* ====================== 阶段三：情节链拆解（需 AI） ====================== */

/**
 * 阶段三：逐批判定情节拍 → 跨批合并 → 一次全局调用组织成叙事线与骨架。
 *
 * 最后那步只喂拍摘要、不喂正文，所以全书只多花一次调用。
 */
export async function runPlotExtraction(
  ref: Reference,
  opts: ExtractOptions,
): Promise<{ plot: RefPlot; run: RunResult; arcError: string | null }> {
  const config: QueueConfig = { ...DEFAULT_QUEUE_CONFIG, ...opts.config }
  const chapters = await readReferenceChapters(ref)
  const { scope } = await resolveRunScope(ref, opts.scope)
  const scopeNote: ScopeNote = {
    label: scope.label,
    analyzed: scopeChapterCount(scope),
    total: scope.totalChapters,
    partial: scopeIsPartial(scope),
  }
  const batches = planBatches(ref.id, 'plot', scope, config.batchChapters)
  if (!batches.length) throw new Error('没有可分析的章节')

  const marked: Reference = { ...ref, stage: 'reading' }
  await writeReferenceMeta(marked)

  const saved = await readCheckpoint(marked, 'plot')
  const checkpoint = saved && saved.batchChapters === config.batchChapters ? saved : null

  const collector = new BeatCollector()

  // 重放已完成的批次，恢复出有序拍列表
  for (const batch of batches) {
    const raw = await readBatchOutput<BatchPlot>(marked, 'plot', batch.index)
    if (raw) collector.add(raw, batch.fromChapter, batch.toChapter)
  }

  const execute = async (batch: BatchTask) => {
    const texts = chaptersOf(chapters, batch)
    const prompt = plotPrompt(
      ref.title,
      ref.genre,
      batch,
      texts.map((c) => ({ title: c.title, text: c.content })),
      collector.lastBrief(),
      config.maxCharsPerCall,
    )
    const { data, usage } = await chatJSONWithUsage<BatchPlot>(opts.ai, SYS_PLOT, prompt, 120000)
    await writeBatchOutput(marked, 'plot', batch.index, data)
    collector.add(data, batch.fromChapter, batch.toChapter)
    return { data, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
  }

  const run = await runQueue({
    batches,
    config,
    checkpoint,
    execute,
    // raw 已落盘的批次视为完成：checkpoint 写失败也不会重复付费
    persistedBatches: (await scanRawBatches(marked, 'plot', config.batchChapters)).map((b) => b.index),
    // 记录批次覆盖的章区间，重建时据此校验拆分章规则是否变过
    onCheckpoint: async (cp) => {
      await writeRawManifest(marked, {
        stage: 'plot',
        batchChapters: config.batchChapters,
        chapterCount: chapters.length,
        scopeLabel: scope.label,
        scopeRanges: scope.ranges,
        totalBatches: batches.length,
        batches: batches.map((b) => ({ index: b.index, from: b.fromChapter, to: b.toChapter })),
      })
      await writeCheckpoint(marked, 'plot', cp)
    },
    onProgress: (p) => opts.onProgress?.(p),
    signal: opts.signal,
  })

  const beats = collector.finish(ref.id)
  const briefs = collector.briefs()

  // 关键：**先把 beats 写盘**。组织骨架是最后一步且只有一次调用，
  // 它失败绝不能连带丢掉前面几十上百批的成果 —— 那意味着用户的 token 全白花。
  const base: RefPlot = {
    schemaVersion: SCHEMA_VERSION,
    refId: ref.id,
    computedAt: Date.now(),
    scope: scopeNote,
    beats,
    arcs: [],
  }
  await writeReferenceAnalysis(marked, 'plot', base)

  // 组织叙事线与骨架：只喂拍摘要，不喂正文。失败不致命 —— beats 已经可用。
  let arcs: PlotArc[] = []
  let arcError: string | null = null
  if (beats.length) {
    try {
      const { data } = await chatJSONWithUsage<ArcResult>(
        opts.ai,
        SYS_PLOT,
        arcPrompt(ref.title, ref.genre, briefs),
        60000,
      )
      arcs = assembleArcs(ref.id, beats, data, briefs)
    } catch (e) {
      arcError = (e as Error).message
      console.warn('[字舟] 骨架生成失败，已保留情节拍：', arcError)
    }
  }

  const plot: RefPlot = { ...base, arcs }
  await writeReferenceAnalysis(marked, 'plot', plot)
  await writeReferenceMeta({ ...marked, stage: run.checkpoint.status === 'done' ? 'done' : 'scanned' })
  return { plot, run, arcError }
}

function chaptersOf(chapters: Awaited<ReturnType<typeof readReferenceChapters>>, batch: { fromChapter: number; toChapter: number }) {
  return chapters.filter((c) => c.index >= batch.fromChapter && c.index <= batch.toChapter)
}

/* ---------------------- 断点与批次原始结果的落盘 ---------------------- */

const batchFile = (ref: Reference, stage: AiStage, i: number) =>
  `${ref.dir}/analysis/raw/${stage}-${String(i).padStart(4, '0')}.json`

/** 断点按阶段分文件：elements 与 plot 各自独立，互不覆盖 */
const checkpointFile = (ref: Reference, stage: AiStage) => `${ref.dir}/analysis/checkpoint-${stage}.json`

/**
 * 每批输出 token 的经验值。
 *
 * 最初按 800 估，实测一部 1171 章的作品是 **6183 token/批**（1.81M ÷ 293），
 * 低估了 7.7 倍。原因是情节拍的输出不是「每批几个标签」，而是每拍都带
 * title/summary/signal/cost/characters 五个字段，长篇一拍的文字量相当可观。
 * 这个数字直接决定预算提示的可信度，宁可保守。
 */
export const PLOT_OUTPUT_TOKENS_PER_BATCH = 6200
export const ELEMENTS_OUTPUT_TOKENS_PER_BATCH = 900

async function writeBatchOutput(ref: Reference, stage: AiStage, i: number, data: unknown): Promise<void> {
  await fsLow.writeFile(batchFile(ref, stage, i), JSON.stringify(data))
}

async function readBatchOutput<T>(ref: Reference, stage: AiStage, i: number): Promise<T | null> {
  try {
    return JSON.parse(await fsLow.readFile(batchFile(ref, stage, i))) as T
  } catch {
    return null
  }
}

async function writeCheckpoint(ref: Reference, stage: AiStage, cp: QueueCheckpoint): Promise<void> {
  await fsLow.writeFile(checkpointFile(ref, stage), JSON.stringify(cp, null, 2))
}

async function readCheckpoint(ref: Reference, stage: AiStage): Promise<QueueCheckpoint | null> {
  try {
    return JSON.parse(await fsLow.readFile(checkpointFile(ref, stage))) as QueueCheckpoint
  } catch {
    return null
  }
}

/** 实际 token 用量（供结算与预估校准） */
export interface PlotUsage {
  inputTokens: number
  outputTokens: number
  batches: number
}

/** 从 checkpoint 反推上一轮的真实消耗，用于校准下一次预估 */
export async function readPlotUsage(ref: Reference): Promise<PlotUsage | null> {
  const cp = await readCheckpoint(ref, 'plot')
  if (!cp || !cp.totalBatches) return null
  return {
    inputTokens: cp.inputTokens,
    outputTokens: cp.outputTokens,
    batches: cp.totalBatches,
  }
}

/**
 * 从 raw/ 缓存重建产物 —— **不调用任何模型，零成本**。
 *
 * 存在的理由：跑一本书的 token 花费不小，任何环节失败都不该让已付费的成果
 * 不可见。这是最后一道保险：只要 raw/ 还在，就能拼回产物。
 *
 * 拆章规则若改过（章节数变了），缓存与当前划分对不上，会明确拒绝而不是
 * 静默产出错乱结果 —— 那种错乱比没有更糟。
 */
export async function rebuildFromRaw(
  ref: Reference,
  stage: AiStage,
): Promise<{ ok: true; batches: number } | { ok: false; reason: string }> {
  const chapters = await readReferenceChapters(ref)
  const config: QueueConfig = { ...DEFAULT_QUEUE_CONFIG }
  const persisted = await scanRawBatches(ref, stage, config.batchChapters)

  if (!persisted.length) return { ok: false, reason: '缓存目录里没有任何批次结果，无法重建' }

  const manifest = await readRawManifest(ref, stage)
  if (manifest && manifest.chapterCount !== chapters.length) {
    return {
      ok: false,
      reason: `缓存是按 ${manifest.chapterCount} 章落盘的，当前是 ${chapters.length} 章 —— 拆章规则已变，缓存对不上，需要重跑`,
    }
  }

  // 按缓存记录的范围重建批次（分档跑时不是全书），并校验档位是否变过
  const scope: ChapterScope = manifest?.scopeRanges?.length
    ? {
        label: manifest.scopeLabel ?? '（缓存档位）',
        ranges: manifest.scopeRanges,
        totalChapters: manifest?.chapterCount ?? chapters.length,
      }
    : { label: '全书', ranges: [{ from: 1, to: chapters.length }], totalChapters: chapters.length }
  const batches = planBatches(ref.id, stage, scope, config.batchChapters)

  // 匹配只看批次序号是否在当前划分内。
  // 不能要求 from/to 严格相等 —— 末批常常是残缺的（章数不整除批大小）。
  const usable = persisted.filter((p) => batches.some((b) => b.index === p.index))
  if (!usable.length) {
    return { ok: false, reason: `缓存批次与当前划分无法对应，需要重跑` }
  }

  const collector = new BeatCollector()
  for (const b of [...usable].sort((x, y) => x.index - y.index)) {
    const raw = await readBatchOutput<BatchPlot>(ref, stage, b.index)
    if (raw) collector.add(raw, b.from, b.to)
  }
  if (!collector.length) return { ok: false, reason: '缓存内容无法解析，重建失败' }

  if (stage === 'plot') {
    const beats = collector.finish(ref.id)
    const plot: RefPlot = {
      schemaVersion: SCHEMA_VERSION, refId: ref.id, computedAt: Date.now(), beats, arcs: [],
    }
    await writeReferenceAnalysis(ref, 'plot', plot)
  } else {
    const merger = new ElementsMerger()
    for (const b of [...usable].sort((x, y) => x.index - y.index)) {
      const raw = await readBatchOutput<BatchElements>(ref, stage, b.index)
      if (raw) merger.add(raw, chapters.filter((c) => c.index >= b.from && c.index <= b.to).map((c) => c.index))
    }
    const merged = merger.finish(ref.id)
    await writeReferenceAnalysis(ref, 'elements', {
      schemaVersion: SCHEMA_VERSION, refId: ref.id, computedAt: Date.now(), ...merged,
    })
  }
  await writeReferenceMeta({ ...ref, stage: ref.stage === 'idle' ? 'scanned' : ref.stage })
  return { ok: true, batches: usable.length }
}

/**
 * 清空失败批次记录，使它们重新入队。
 * 对应 UI 的「重跑失败批次」——失败默认不自动重跑，避免反复烧 token。
 */
export async function clearFailedBatches(ref: Reference, stage: AiStage = 'elements'): Promise<number> {
  const cp = await readCheckpoint(ref, stage)
  if (!cp || !cp.failed.length) return 0
  const n = cp.failed.length
  await writeCheckpoint(ref, stage, { ...cp, failed: [], status: 'paused', updatedAt: Date.now() })
  return n
}
