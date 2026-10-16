import { useEffect, useMemo, useState } from 'react'
import type { Reference } from '../types'
import type { RefStructure, RefPlot } from '../refschema'
import { readReferenceAnalysis } from '../reference'
import { volumeMixFrom, mixBar, BEAT_COLOR } from '../refderive'
import PanelShell, { WarnBox, EmptyNote, SourceNote } from './PanelShell'

/** 卷配比所需的参考书数据 */
interface RefBundle {
  ref: Reference
  structure: RefStructure | null
  plot: RefPlot | null
}

/** 卷纲面板要回答的是「有哪些走法可选」，不是「我现在在哪」—— 所以不需要调用模型。 */
export default function VolumeReferencePanel({
  volumeTitle,
  chapterCount,
  hasOutline,
  onClose,
  onAppend,
}: {
  volumeTitle: string
  chapterCount: number
  /** 本卷是否已拆章；没拆就看不出真实配比 */
  hasOutline: boolean
  onClose: () => void
  onAppend: (text: string) => void
}) {
  const [bundles, setBundles] = useState<RefBundle[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      const refs: Reference[] = JSON.parse(localStorage.getItem('zizhou-state-v1') ?? '{}').references ?? []
      const out: RefBundle[] = []
      for (const ref of refs) {
        const structure = await readReferenceAnalysis<RefStructure>(ref, 'structure')
        const plot = await readReferenceAnalysis<RefPlot>(ref, 'plot')
        if (structure || plot) out.push({ ref, structure, plot })
      }
      if (alive) {
        setBundles(out)
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const withMix = useMemo(
    () =>
      bundles
        .map((b) => ({ ...b, mix: b.structure && b.plot ? volumeMixFrom(b.structure, b.plot) : [] }))
        .filter((b) => b.mix.length > 0),
    [bundles],
  )

  // 参考书的「走法」直接来自阶段三抽出的骨架，不需要再调一次模型
  const skeletons = useMemo(
    () =>
      withMix.flatMap((b) =>
        (b.plot?.arcs ?? [])
          .filter((a) => a.skeleton?.steps.length)
          .map((a) => ({
            refTitle: b.ref.title,
            arcTitle: a.title,
            steps: a.skeleton!.steps,
            span: a.skeleton!.suggestedSpan,
          })),
      ),
    [withMix],
  )

  return (
    <PanelShell
      title="卷纲参考"
      context={volumeTitle}
      onClose={onClose}
      footer={withMix.length ? `《${withMix.map((b) => b.ref.title).join('》《')}》 · 本地统计，无 token 消耗` : undefined}
    >
      {!hasOutline && (
        <WarnBox>
          本卷还没拆章，看不出真实配比。下面是同题材的参考卷节奏，可作参照。
        </WarnBox>
      )}

      {loading && <EmptyNote>正在读取参考书…</EmptyNote>}

      {!loading && !withMix.length && (
        <EmptyNote>
          还没有可对照的数据。到参考库对一本参考书跑「结构与节奏统计」与「情节链拆解」，
          这里就会显示每一卷的情节配比。
        </EmptyNote>
      )}

      {!loading && withMix.length > 0 && (
        <>
          <div className="rp-sec">
            <div className="eyebrow" style={{ marginBottom: 7 }}>每卷的情节配比</div>
            <div className="rp-note" style={{ marginBottom: 9 }}>
              按参考书各卷实际的情节类型占比统计。「你的卷二」为空表示还没拆章。
            </div>
            {chapterCount > 0 && (
              <div className="vp-row">
                <span className="vp-n mine">你的卷二</span>
                <div className="vp-bar empty" />
                <span className="vp-c">{hasOutline ? '待拆章' : `${chapterCount} 章`}</span>
              </div>
            )}
            {withMix.map((b) =>
              b.mix.map((m) => (
                <div className="vp-row" key={`${b.ref.id}-${m.index}`}>
                  <span className="vp-n">{b.ref.title} 卷{m.index + 1}</span>
                  <div className="vp-bar">
                    {mixBar(m).map((x) => (
                      <i key={x.kind} style={{ width: `${x.pct * 100}%`, background: BEAT_COLOR[x.kind] }} title={`${x.label} ${Math.round(x.pct * 100)}%`} />
                    ))}
                  </div>
                  <span className="vp-c">{m.chapterCount} 章</span>
                </div>
              )),
            )}
          </div>

          {skeletons.length > 0 && (
            <div className="rp-sec">
              <div className="eyebrow" style={{ marginBottom: 7 }}>可借的叙事骨架</div>
              <div className="rp-note" style={{ marginBottom: 9 }}>
                只含方法步骤，不含原文。点「采用」追加到本卷卷纲。
              </div>
              {skeletons.map((s, i) => (
                <div className="vp-skel" key={i}>
                  <div className="vs-h">
                    <span className="vs-t">{s.arcTitle}</span>
                    <span className="vs-span mono">跨度约 {s.span} 章</span>
                  </div>
                  <div className="vs-steps">
                    {s.steps.map((st, j) => (
                      <div className="vs-step" key={st.key || j}>
                        <span className="vs-i">{j + 1}</span>
                        <span className="vs-l">{st.label}</span>
                        <span className="vs-r">{st.require}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 9 }}
                    onClick={() =>
                      onAppend(
                        `【参考骨架：${s.arcTitle}】\n` +
                          s.steps.map((st, j) => `${j + 1}. ${st.label}${st.require ? `（${st.require}）` : ''}`).join('\n'),
                      )
                    }
                  >
                    采用这个骨架
                  </button>
                  <SourceNote>
                    {s.refTitle} · {s.arcTitle} · 建议跨度 {s.span} 章
                  </SourceNote>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </PanelShell>
  )
}
