import { useEffect, useMemo, useState } from 'react'
import { BookMarked, Loader2, AlertTriangle, Sparkles } from 'lucide-react'
import { useStore, actions, type LocatedBeat } from '../store'
import type { Chapter, ID } from '../types'
import type { RefPlot } from '../refschema'
import { readReferenceAnalysis } from '../reference'
import { toCandidates, CONFIDENCE_FLOOR, type CandidateBeat } from '../reflocate'
import { BEAT_KIND_LABEL } from '../refschema'
import { aiReady } from '../ai'

/**
 * 写作流内的参考面板（对应原型里的章纲参考弹窗）。
 *
 * 三条原则：
 * 1. **只读**：面板不改任何东西，「采用」只把内容追加到目标字段
 * 2. **诚实**：匹配不上或把握不准时明说，不硬给一个看着确定的答案
 * 3. **溯源常驻**：每条结论都指回「哪本书哪一卷第几拍」
 */
export default function ReferencePanel({
  chapter,
  onClose,
  onAppend,
}: {
  chapter: Chapter
  onClose: () => void
  /** 把参考内容追加到目标字段（只读语义的唯一写入口） */
  onAppend: (text: string) => void
}) {
  const state = useStore()
  const refs = state.references
  const [plots, setPlots] = useState<{ refId: ID; plot: RefPlot }[]>([])
  const [refId, setRefId] = useState<ID | ''>('')
  const [loading, setLoading] = useState(true)
  const [locating, setLocating] = useState(false)
  const [located, setLocated] = useState<LocatedBeat | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // 只读取已完成情节链拆解的参考书
  const usable = useMemo(() => refs.filter((r) => r.stage === 'done' || r.stage === 'scanned'), [refs])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setPlots([])
    ;(async () => {
      const out: { refId: ID; plot: RefPlot }[] = []
      for (const r of usable) {
        const p = await readReferenceAnalysis<RefPlot>(r, 'plot')
        if (p?.beats?.length) out.push({ refId: r.id, plot: p })
      }
      if (!alive) return
      setPlots(out)
      setRefId(out[0]?.refId ?? '')
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [usable])

  const candidates: CandidateBeat[] = useMemo(() => {
    const p = plots.find((x) => x.refId === refId)
    if (!p) return []
    return toCandidates(p.plot.arcs, p.plot.beats, (rid) => refs.find((r) => r.id === rid)?.title ?? '参考书')
  }, [plots, refId, refs])

  async function locate() {
    if (!chapter.content.trim()) {
      setErr('当前章还没有正文，先写点内容再定位')
      return
    }
    setLocating(true)
    setErr(null)
    try {
      setLocated(await actions.locateBeat({ chapterTitle: chapter.title, content: chapter.content, candidates }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLocating(false)
    }
  }

  const lowConfidence = located && located.picked && located.result.confidence < CONFIDENCE_FLOOR
  const noMatch = located && !located.picked

  return (
    <div className="refpanel">
      <div className="refpanel-head">
        <BookMarked size={15} />
        <span className="rp-title">情节参考</span>
        <span className="rp-ctx">{chapter.title}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn square" onClick={onClose} title="收起面板">✕</button>
      </div>

      <div className="refpanel-body">
        {!aiReady(state.ai) && (
          <div className="rp-warn">尚未配置 AI 接口，无法定位。请到顶栏「AI 接口设置」填好 Base URL 与 Key。</div>
        )}

        {loading && <div className="rp-note">正在读取参考书的情节链…</div>}

        {!loading && !plots.length && (
          <div className="rp-note">
            还没有可用的情节链。到参考库对一本参考书跑「情节链拆解」，之后这里就会显示可比对的拍。
          </div>
        )}

        {!loading && plots.length > 0 && (
          <>
            <div className="rp-sec">
              <div className="eyebrow" style={{ marginBottom: 7 }}>对照哪本</div>
              <div className="rp-srcs">
                {plots.map((p) => {
                  const r = refs.find((x) => x.id === p.refId)
                  return (
                    <button key={p.refId} className={`rp-src ${refId === p.refId ? 'on' : ''}`} onClick={() => { setRefId(p.refId); setLocated(null) }}>
                      {r?.title ?? '参考书'} · {p.plot.beats.length} 拍
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="rp-sec">
              <button className="btn btn-primary btn-sm" style={{ width: '100%', justifyContent: 'center' }}
                disabled={locating || !aiReady(state.ai)} onClick={locate}>
                {locating ? <><Loader2 size={14} /> 正在比对…</> : <><Sparkles size={14} /> 你现在写到第几拍</>}
              </button>
              <div className="rp-note" style={{ marginTop: 7 }}>
                拿这一章的正文去比对参考书的 {candidates.length} 个情节特征，不是按章号推算。
              </div>
            </div>

            {err && <div className="rp-warn">{err}</div>}

            {located && noMatch && (
              <div className="rp-gap">
                <AlertTriangle size={14} />
                <div>
                  <b>没能匹配到任何一拍</b>
                  <div style={{ marginTop: 4 }}>{located.result.noneReason || '这一章的写法与现有候选都差得比较远。'}</div>
                </div>
              </div>
            )}

            {located && lowConfidence && (
              <div className="rp-warn">
                把握不大（{Math.round(located.result.confidence * 100)}%），仅供参考：{located.result.reason}
              </div>
            )}

            {located && located.picked && !lowConfidence && (
              <div className="rp-result">
                <div className="rp-hitsig">
                  <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    {BEAT_KIND_LABEL[located.picked.kind]}
                  </span>
                  <span className="rp-hitt">{located.picked.title}</span>
                  <span className="rp-pct mono">{Math.round(located.result.confidence * 100)}%</span>
                </div>
                <div className="rp-why">{located.result.reason}</div>
                {located.regression.regressed && (
                  <div className="rp-warn" style={{ marginTop: 8 }}>{located.regression.note}</div>
                )}
                <div className="rp-sig">
                  <div className="k">这一拍的可识别特征</div>
                  <div className="v">{located.picked.signal}</div>
                </div>
                <div className="rp-sig">
                  <div className="k">硬性要求</div>
                  <div className="v">{located.picked.cost}</div>
                </div>
                <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                  onClick={() => onAppend(`【参考：${located.picked!.title}】\n${located.picked!.signal}\n（硬性要求：${located.picked!.cost}）`)}>
                  把这段参考追加到章纲
                </button>
                <div className="rp-src-note">
                  溯源：{located.picked.refTitle} · {located.picked.arcTitle}
                </div>
              </div>
            )}

            <div className="rp-sec">
              <div className="eyebrow" style={{ marginBottom: 7 }}>全部候选拍</div>
              <div className="rp-beats">
                {candidates.map((c) => {
                  const on = located?.picked?.beatId === c.beatId
                  const passed = located?.result.passedIndexes.includes(candidates.indexOf(c))
                  return (
                    <div key={c.beatId} className={`rp-beat ${on ? 'on' : ''} ${passed ? 'passed' : ''}`}>
                      <div className="rb-h">
                        <span className="chip" style={{ fontSize: 10 }}>{BEAT_KIND_LABEL[c.kind]}</span>
                        <span className="rb-t">{c.title}</span>
                      </div>
                      <div className="rb-s">{c.signal}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
