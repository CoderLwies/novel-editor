import { useEffect, useMemo, useState } from 'react'
import { Layers, ListTree, Search } from 'lucide-react'
import type { Reference } from '../types'
import type { RefPlot, PlotBeat, PlotArc } from '../refschema'
import { BEAT_KIND_LABEL } from './../refschema'
import { readReferenceAnalysis } from '../reference'
import { BEAT_COLOR } from '../refderive'

type Tab = 'arcs' | 'beats'

/**
 * 情节链详情：展示阶段三真正拆出来的东西。
 *
 * 与 ElementsModal 同一原则 —— 数据从 `analysis/plot.json` 读，
 * 入口由磁盘产物决定，与本次是否跑过无关。只读。
 */
export default function PlotModal({ refItem, onClose }: { refItem: Reference; onClose: () => void }) {
  const [data, setData] = useState<RefPlot | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('arcs')
  const [kw, setKw] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      const p = await readReferenceAnalysis<RefPlot>(refItem, 'plot')
      if (!alive) return
      setData(p)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [refItem])

  const byId = useMemo(() => new Map((data?.beats ?? []).map((b) => [b.id, b])), [data])

  const q = kw.trim()
  const arcs = useMemo(() => {
    const list = data?.arcs ?? []
    if (!q) return list
    return list.filter((a) => {
      if (a.title.includes(q)) return true
      return a.beatIds.some((id) => {
        const b = byId.get(id)
        return !!b && `${b.title}${b.summary}${b.signal}${b.cost}`.includes(q)
      })
    })
  }, [data, q, byId])

  const beats = useMemo(() => {
    const list = data?.beats ?? []
    if (!q) return list
    return list.filter((b) => `${b.title}${b.summary}${b.signal}${b.cost}`.includes(q))
  }, [data, q])

  const skCount = (data?.arcs ?? []).filter((a) => a.skeleton?.steps.length).length
  const scope = data?.scope

  return (
    <div className="veil" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal em-modal">
        <div className="modal-head">
          <span className="modal-title">情节链 · {refItem.title}</span>
          <span className="spacer" />
          <button className="icon-btn square" onClick={onClose}>✕</button>
        </div>

        {loading && <div className="modal-body"><div className="note">正在读取 analysis/plot.json…</div></div>}

        {!loading && (!data || !data.beats?.length) && (
          <div className="modal-body">
            <div className="note">
              这本书还没有情节链产物，或产物已不在目录里。到参考库点「情节链拆解」跑一次。
            </div>
          </div>
        )}

        {!loading && data?.beats?.length && (
          <>
            <div className="em-tabs">
              <button className={`em-tab ${tab === 'arcs' ? 'on' : ''}`} onClick={() => setTab('arcs')}>
                <ListTree size={13} /> 叙事线 <span className="em-n">{data.arcs.length}</span>
              </button>
              <button className={`em-tab ${tab === 'beats' ? 'on' : ''}`} onClick={() => setTab('beats')}>
                <Layers size={13} /> 全部情节拍 <span className="em-n">{data.beats.length}</span>
              </button>
              <span style={{ flex: 1 }} />
              <span className="em-summary">{skCount} 条线抽出骨架</span>
              <div className="em-search">
                <Search size={13} />
                <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索拍名 / 特征 / 硬要求…" />
              </div>
            </div>

            <div className="modal-body em-body">
              {scope?.partial && (
                <div className="scope-warn" style={{ marginBottom: 4 }}>
                  本次分析覆盖 <b>{scope.label}</b>（{scope.analyzed} / {scope.total} 章）。
                  下面只包含这些章节里出现的情节拍 —— 不代表全书结构。
                </div>
              )}
              {tab === 'arcs' &&
                arcs.map((a) => <ArcCard key={a.id} arc={a} byId={byId} />)}

              {tab === 'beats' &&
                (beats.length ? (
                  beats.map((b) => <BeatCard key={b.id} beat={b} />)
                ) : (
                  <div className="note">没有匹配的情节拍</div>
                ))}
            </div>

            <div className="modal-foot">
              <span className="note" style={{ fontSize: 11 }}>只读 · signal 供写作时定位进度，cost 是这一拍的硬性要求</span>
              <span className="spacer" />
              <button className="btn btn-ghost" onClick={onClose}>关闭</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BeatCard({ beat }: { beat: PlotBeat }) {
  return (
    <div className="em-card">
      <div className="em-c-h">
        <span className="beat-kind" style={{ background: BEAT_COLOR[beat.kind] }}>{BEAT_KIND_LABEL[beat.kind]}</span>
        <span className="em-name">{beat.title}</span>
        <span style={{ flex: 1 }} />
        <span className="em-ch">第 {beat.fromChapter}–{beat.toChapter} 章</span>
      </div>
      {beat.summary && <div className="em-desc">{beat.summary}</div>}
      <div className="beat-meta">
        <div><span className="bm-k">可识别特征</span><span className="bm-v">{beat.signal || '（未提取）'}</span></div>
        <div><span className="bm-k">硬性要求</span><span className="bm-v">{beat.cost || '（无）'}</span></div>
        {beat.characters.length > 0 && (
          <div><span className="bm-k">参与角色</span><span className="bm-v">{beat.characters.join('、')}</span></div>
        )}
      </div>
    </div>
  )
}

function ArcCard({ arc, byId }: { arc: PlotArc; byId: Map<string, PlotBeat> }) {
  const beats = arc.beatIds.map((id) => byId.get(id)).filter(Boolean) as PlotBeat[]
  return (
    <div className="arc-card">
      <div className="arc-h">
        <span className="arc-t">{arc.title}</span>
        <span className="em-ch">第 {arc.fromChapter}–{arc.toChapter} 章 · {beats.length} 拍</span>
      </div>
      <div className="arc-chain">
        {beats.map((b) => (
          <div className="arc-node" key={b.id}>
            <span className="beat-kind sm" style={{ background: BEAT_COLOR[b.kind] }}>{BEAT_KIND_LABEL[b.kind]}</span>
            <span className="arc-nt">{b.title}</span>
            <span className="arc-ch">{b.fromChapter === b.toChapter ? `第${b.fromChapter}章` : `${b.fromChapter}-${b.toChapter}章`}</span>
            {b.signal && <span className="arc-sig">{b.signal}</span>}
          </div>
        ))}
      </div>
      {arc.skeleton?.steps.length ? (
        <div className="arc-skel">
          <div className="arc-sk-h">
            可复用骨架
            {arc.skeleton.suggestedSpan ? <span className="arc-sk-span">建议跨度 {arc.skeleton.suggestedSpan} 章</span> : null}
          </div>
          <div className="arc-sk-steps">
            {arc.skeleton.steps.map((s, j) => (
              <div className="arc-sk-step" key={s.key || j}>
                <span className="tc-i">{j + 1}</span>
                <span className="tc-l">{s.label}</span>
                {s.require && <span className="tc-r">{s.require}</span>}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="note" style={{ fontSize: 11, marginTop: 8 }}>这条线没有抽出可复用骨架（多为过场或非线性结构）。</div>
      )}
    </div>
  )
}
