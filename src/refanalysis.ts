/**
 * 分析流程编排：把「读原文 → 计算 → 落盘」串起来。
 *
 * 当前只实现阶段一（结构与节奏统计，纯本地、0 token、结果可复现）。
 * 阶段二要素抽取、阶段三情节链、阶段四模板生成需要 AI 与任务队列，
 * 会先跑阶段一作为体检——不值得深挖的书在这里就能看出来。
 */
import type { AIConfig, Reference, RefStage } from './types'
import type { RefStructure, RefElements, RefPlot, PlotArc } from './refschema'
import { computeStructure } from './refstats'
import { readReferenceChapters, writeReferenceAnalysis, writeReferenceMeta } from './reference'
import { fsLow } from './fs'
import { planBatches, DEFAULT_QUEUE_CONFIG, type BatchTask, type AiStage, type QueueCheckpoint, type QueueConfig, type QueueProgress } from './aiqueue'
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

export interface ExtractOptions {
  config?: Partial<QueueConfig>
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
  const batches = planBatches(ref.id, 'elements', chapters.length, config.batchChapters)
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
    onCheckpoint: (cp) => writeCheckpoint(marked, 'elements', cp),
    onProgress: (p) => opts.onProgress?.(p),
    signal: opts.signal,
  })

  await writeReferenceMeta({ ...marked, stage: run.checkpoint.status === 'done' ? 'done' : 'scanned' })

  const merged = merger.finish(ref.id)
  const elements: RefElements = {
    schemaVersion: SCHEMA_VERSION,
    refId: ref.id,
    computedAt: Date.now(),
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
): Promise<{ plot: RefPlot; run: RunResult }> {
  const config: QueueConfig = { ...DEFAULT_QUEUE_CONFIG, ...opts.config }
  const chapters = await readReferenceChapters(ref)
  const batches = planBatches(ref.id, 'plot', chapters.length, config.batchChapters)
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
    onCheckpoint: (cp) => writeCheckpoint(marked, 'plot', cp),
    onProgress: (p) => opts.onProgress?.(p),
    signal: opts.signal,
  })

  const beats = collector.finish(ref.id)
  const briefs = collector.briefs()

  // 组织叙事线与骨架：只喂拍摘要，不喂正文
  let arcs: PlotArc[] = []
  if (beats.length) {
    const { data } = await chatJSONWithUsage<ArcResult>(
      opts.ai,
      SYS_PLOT,
      arcPrompt(ref.title, ref.genre, briefs),
      60000,
    )
    arcs = assembleArcs(ref.id, beats, data, briefs)
  }

  const plot: RefPlot = {
    schemaVersion: SCHEMA_VERSION,
    refId: ref.id,
    computedAt: Date.now(),
    beats,
    arcs,
  }
  await writeReferenceAnalysis(marked, 'plot', plot)
  await writeReferenceMeta({ ...marked, stage: run.checkpoint.status === 'done' ? 'done' : 'scanned' })
  return { plot, run }
}

function chaptersOf(chapters: Awaited<ReturnType<typeof readReferenceChapters>>, batch: { fromChapter: number; toChapter: number }) {
  return chapters.filter((c) => c.index >= batch.fromChapter && c.index <= batch.toChapter)
}

/* ---------------------- 断点与批次原始结果的落盘 ---------------------- */

const batchFile = (ref: Reference, stage: AiStage, i: number) =>
  `${ref.dir}/analysis/raw/${stage}-${String(i).padStart(4, '0')}.json`

/** 断点按阶段分文件：elements 与 plot 各自独立，互不覆盖 */
const checkpointFile = (ref: Reference, stage: AiStage) => `${ref.dir}/analysis/checkpoint-${stage}.json`

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
