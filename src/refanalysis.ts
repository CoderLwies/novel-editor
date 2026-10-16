/**
 * 分析流程编排：把「读原文 → 计算 → 落盘」串起来。
 *
 * 当前只实现阶段一（结构与节奏统计，纯本地、0 token、结果可复现）。
 * 阶段二要素抽取、阶段三情节链、阶段四模板生成需要 AI 与任务队列，
 * 会先跑阶段一作为体检——不值得深挖的书在这里就能看出来。
 */
import type { Reference, RefStage } from './types'
import type { RefStructure } from './refschema'
import { computeStructure } from './refstats'
import { readReferenceChapters, writeReferenceAnalysis, writeReferenceMeta } from './reference'

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
